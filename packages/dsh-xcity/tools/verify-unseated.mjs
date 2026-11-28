#!/usr/bin/env node
/**
 * 验收：**人多座少**时会发生什么。**只读**——只 GET 世界快照；不写世界、不派单、不启进程。
 *
 * 用法：
 *   node tools/verify-unseated.mjs --base http://127.0.0.1:3190 --seconds 60
 *   node tools/verify-unseated.mjs --seconds 15 --hold-min 2      # 快速体检
 *
 * 口径（都从 /agent-world/api/world 的快照里算，不引依赖）：
 *   - 无座 = agent.station === null（区别于 verify-scale 的"没 station 人峰值"，那里只报峰值）。
 *   - 座位 = station.capacity 之和；工位数与总容量来自快照 stations，不猜。
 *   - 位置是 **place 内坐标**（Vec2 俯视 x/z），Place.spawn 是地图格坐标（480,800 那种），
 *     两者不同坐标系，**不能拿 spawn 算距离**——所以"到目标 place 的距离"取
 *     "到 targetStation.anchor 的距离"（targetStation 才是那个人正在去的物理点），
 *     跨 place（targetStation 在别的 place）或没有 targetStation 的一律记 unmeasurable，不进平均。
 *   - 时长用 **tick** 记（world.tick 是逻辑时钟），秒数由采样期实测 ticksPerSecond 换算；
 *     "超过 X 分钟"的 X 由 --hold-min 给（默认 2 分钟）。
 *   - 占用时长优先用快照里 active activity 的 startedAt（能覆盖采样窗口之前就开始的占用），
 *     没有 activity 的退回"采样期里这次坐下的起点 tick"。
 *
 * 输出：
 *   [1] seats    { stations, totalCapacity, occupiedMax, unseatedMax, unseatedShare }
 *   [2] waiting  无座者的位置分布：到 targetStation 的距离均值 / p90、同 place 同坐标叠人峰值 dupMax
 *   [3] rotation 同一 agent 连续无座时长（tick 的 p50/p95/max）+ 单次占用超过 X 分钟的人数
 *   [4] fairness 无座者里有几个是因为"目标座位被长期占着"（对照占用时长分布与占用集中度）
 *   [5] 判定 ok = tick 稳定 + dupMax <= 2 + unseatedShare 有值（不判阈值，只判"量到了"）
 *   失败时 stderr 一行卡点（unreachable / no-samples / stall / duplicate-stack / no-unseated-share），退出码 1。
 */

import { arg, baseUrl, failVerify, getJson, percentile, sleep } from './lib/cli.mjs';

// [0] 参数：解析与 base 归一化在 tools/lib/cli.mjs（各脚本共用一份，纯 .mjs 不经构建）
const base = baseUrl();
const seconds = Number(arg('seconds', 60));
const holdMinutes = Number(arg('hold-min', 2));
for (const [flag, value] of [['--seconds', seconds], ['--hold-min', holdMinutes]]) {
  if (!(Number.isFinite(value) && value > 0)) {
    console.error(flag + ' 必须是正数');
    process.exit(2);
  }
}
if (!Number.isInteger(seconds)) {
  console.error('--seconds 必须是正整数');
  process.exit(2);
}

const SAMPLE_MS = 1000;
const REQUEST_MS = 5000;
const STALL_MS = 2000;
const DUP_LIMIT = 2;
const WORLD_URL = base + '/agent-world/api/world';

async function worldSnapshot() {
  const body = await getJson(WORLD_URL, REQUEST_MS);
  if (body.world === null || body.world === undefined) throw new Error('快照里没有 world');
  return body.world;
}

// [1] 起点：座位供给。容量表 + 总容量是后面一切"够不够坐"的分母。
let origin = null;
let fetchError = null;
try {
  origin = await worldSnapshot();
} catch (error) {
  fetchError = error.message;
}

const capacityOf = new Map();
const placeOfStation = new Map();
for (const station of origin === null ? [] : origin.stations ?? []) {
  if (typeof station.id !== 'string') continue;
  if (Number.isInteger(station.capacity)) capacityOf.set(station.id, station.capacity);
  if (typeof station.placeId === 'string') placeOfStation.set(station.id, station.placeId);
}
// anchor 只对同 place 有意义；带上 placeId 一起存，跨 place 时用它判"不可测"。
const anchorOf = new Map();
for (const station of origin === null ? [] : origin.stations ?? []) {
  const anchor = station.anchor;
  if (typeof station.id === 'string' && Number.isFinite(anchor?.x) && Number.isFinite(anchor?.z)) {
    anchorOf.set(station.id, { x: anchor.x, z: anchor.z });
  }
}
const stationTotal = capacityOf.size;
const totalCapacity = [...capacityOf.values()].reduce((sum, capacity) => sum + capacity, 0);

// [2] 每秒采样一次，持续 --seconds（t=0..seconds 共 seconds+1 次）
const samples = [];              // { at, tick, agents }
const agentCounts = [];
const unseatedShares = [];       // 每次采样的 无座/在场
let occupiedMax = 0;
let unseatedMax = 0;
let noTargetMax = 0;             // 无座且没有 targetStation（站在歇脚点，没有"想去哪"）
let dupMax = 0;
let waitingMax = 0;              // 无座且有"无站点活动"的人数峰值（R527 等待意图的痕迹，改造前应为 0）
let waitingSamples = 0;          // 同上，采样人次
const dupRows = new Map();       // place|坐标|人员 → 出现次数
const unseatedRuns = new Map();  // agent → { startTick, station:null } 当前这段无座的起点
const finishedUnseatedRuns = []; // { agent, startTick, endTick }
const seatRuns = new Map();      // agent → { station, startTick } 采样期内这次坐下的起点
const seatHoldRuns = new Map();  // agent|station|起点 → { agent, station, startTick, holdTicks }
const seatedSamplesByAgent = new Map();
let failedSamples = 0;
let pausedSamples = 0;

/** 同一 agent 在某个 station 上的这次占用：优先 activity.startedAt，退化到采样期起点。 */
function noteSeatHold(agent, station, tick, activityStartedAt) {
  const run = seatRuns.get(agent);
  const startTick = Number.isFinite(activityStartedAt)
    ? activityStartedAt
    : run !== null && run !== undefined && run.station === station ? run.startTick : tick;
  const key = agent + '|' + station + '|' + startTick;
  const row = seatHoldRuns.get(key) ?? { agent, station, startTick, holdTicks: 0 };
  row.holdTicks = Math.max(row.holdTicks, tick - startTick);
  seatHoldRuns.set(key, row);
}

if (origin !== null) {
  const startAt = Date.now();
  for (let i = 0; i <= seconds; i += 1) {
    const wait = startAt + i * SAMPLE_MS - Date.now();
    if (wait > 0) await sleep(wait);

    let world;
    try {
      world = await worldSnapshot();
    } catch (error) {
      failedSamples += 1;
      fetchError = error.message;
      continue;
    }

    const at = Date.now();
    const tick = Number(world.tick);
    if (world.paused === true) pausedSamples += 1;

    // [2.1] 每个 agent 摊平成只留本卡要用的字段（快照很大，别把整份留到内存里）
    const agents = (world.agents ?? []).map((agent) => ({
      id: agent.id,
      name: typeof agent.name === 'string' ? agent.name : '',
      placeId: typeof agent.placeId === 'string' ? agent.placeId : '',
      state: agent.state ?? null,
      station: typeof agent.station === 'string' ? agent.station : null,
      targetStation: typeof agent.targetStation === 'string' ? agent.targetStation : null,
      x: agent.position?.x,
      z: agent.position?.z,
      activityId: typeof agent.activityId === 'string' ? agent.activityId : null,
    }));
    samples.push({ at, tick, agents });
    agentCounts.push(agents.length);

    // 活动表只留 active 且落了 station 的：它的 startedAt 是"这座位从什么时候被占着"的证据
    const activityStart = new Map(); // agent|station → 最晚的 startedAt
    for (const activity of world.activities ?? []) {
      if (activity?.status !== 'active') continue;
      if (typeof activity.stationId !== 'string' || typeof activity.agentId !== 'string') continue;
      if (!Number.isFinite(activity.startedAt)) continue;
      const key = activity.agentId + '|' + activity.stationId;
      activityStart.set(key, Math.max(activityStart.get(key) ?? -Infinity, activity.startedAt));
    }

    // [2.2] seats：需求 = 在场人数，占用 = 有 station 的人，没座位 = 两者之差
    const seated = agents.filter((agent) => agent.station !== null);
    const unseated = agents.filter((agent) => agent.station === null);
    occupiedMax = Math.max(occupiedMax, seated.length);
    unseatedMax = Math.max(unseatedMax, unseated.length);
    noTargetMax = Math.max(noTargetMax, unseated.filter((agent) => agent.targetStation === null).length);
    if (agents.length > 0) unseatedShares.push(unseated.length / agents.length);

    // [2.2.1] R527 观测口：无座者身上有 active 活动却**没有 station**，就是"等待"的痕迹（改造后才会出现）。
    //         只读现有 activities，不引入新概念；改造前这个数应当恒为 0（吃饭/睡觉/休息一定带站点）。
    const stationless = new Set();
    for (const activity of world.activities ?? []) {
      if (activity?.status !== 'active') continue;
      if (typeof activity.agentId !== 'string') continue;
      if (typeof activity.stationId === 'string' && activity.stationId !== '') continue;
      stationless.add(activity.agentId);
    }
    const waitingNow = unseated.filter((agent) => stationless.has(agent.id)).length;
    waitingMax = Math.max(waitingMax, waitingNow);
    waitingSamples += waitingNow;

    // [2.3] waiting 的 dupMax：只算无座者，按 place 内坐标分桶（坐标是 place 内坐标，跨 place 不能混）
    const byPosition = new Map();
    for (const agent of unseated) {
      if (!Number.isFinite(agent.x) || !Number.isFinite(agent.z)) continue;
      const key = agent.placeId + '|' + agent.x + ',' + agent.z;
      const ids = byPosition.get(key) ?? [];
      ids.push(agent.id);
      byPosition.set(key, ids);
    }
    for (const [position, ids] of byPosition) {
      if (ids.length < 2) continue;
      dupMax = Math.max(dupMax, ids.length);
      const key = position + '|' + [...ids].sort().join(',');
      const row = dupRows.get(key) ?? { place: position.split('|')[0], position: position.split('|')[1], agents: [...ids].sort(), samples: 0 };
      row.samples += 1;
      dupRows.set(key, row);
    }

    // [2.4] rotation：逐人记"连续无座"这段的起点 tick（按 tick 记，跨采样窗口的占用时长另算）
    const unseatedIds = new Set(unseated.map((agent) => agent.id));
    for (const agent of agents) {
      const run = unseatedRuns.get(agent.id) ?? { startTick: null };
      if (unseatedIds.has(agent.id)) {
        if (run.startTick === null) run.startTick = tick;
      } else if (run.startTick !== null) {
        finishedUnseatedRuns.push({ agent: agent.id, startTick: run.startTick, endTick: tick });
        run.startTick = null;
      }
      unseatedRuns.set(agent.id, run);
    }

    // [2.5] 占用时长：坐下的人各记一段；同一次坐下跨采样只更新 holdTicks，不重复计数
    for (const agent of agents) {
      if (agent.station === null) {
        seatRuns.delete(agent.id);
        continue;
      }
      const run = seatRuns.get(agent.id);
      if (run === undefined || run.station !== agent.station) {
        seatRuns.set(agent.id, { station: agent.station, startTick: tick });
      }
      noteSeatHold(agent.id, agent.station, tick, activityStart.get(agent.id + '|' + agent.station));
      seatedSamplesByAgent.set(agent.id, (seatedSamplesByAgent.get(agent.id) ?? 0) + 1);
    }
  }
}

// [2.6] 窗口结束时还开着的无座段要结算，否则"一直在等"会显示成 0
const lastSample = samples[samples.length - 1] ?? null;
const firstSample = samples[0] ?? null;
if (lastSample !== null) {
  for (const [agent, run] of unseatedRuns) {
    if (run.startTick !== null) {
      finishedUnseatedRuns.push({ agent, startTick: run.startTick, endTick: lastSample.tick });
    }
  }
}

// [3] 汇总
// [3.1] tick 速率：秒数换算的唯一依据（快照里没有 tickMs，只能实测）
const spanSec = firstSample === null || lastSample === null ? 0 : (lastSample.at - firstSample.at) / 1000;
const ticksPerSecond = firstSample === null || lastSample === null || spanSec <= 0
  ? null
  : Number(((lastSample.tick - firstSample.tick) / spanSec).toFixed(2));
const ticksToMinutes = ticksPerSecond === null || ticksPerSecond <= 0
  ? null
  : (ticks) => Number((ticks / ticksPerSecond / 60).toFixed(2));

// [3.2] 停滞：同一 tick 持续 >= STALL_MS 记一次（每个 tick 平台只记一次，与 verify-scale 同口径）
const stallRows = [];
let plateau = null;
for (const sample of samples) {
  if (plateau === null || sample.tick !== plateau.tick) {
    plateau = { tick: sample.tick, startAt: sample.at, flagged: false };
    continue;
  }
  const heldMs = sample.at - plateau.startAt;
  if (!plateau.flagged && heldMs >= STALL_MS) {
    plateau.flagged = true;
    stallRows.push({ tick: plateau.tick, seconds: Number((heldMs / 1000).toFixed(1)) });
  }
}

// [3.3] seats / waiting：距离只在"同 place 且有 targetStation"时可测，别的记账不算进平均
const distances = [];
let targetMeasured = 0;
let targetElsewhere = 0;
let targetMissing = 0;
for (const sample of samples) {
  for (const agent of sample.agents) {
    if (agent.station !== null) continue;
    const anchor = agent.targetStation === null ? null : anchorOf.get(agent.targetStation);
    if (agent.targetStation === null) {
      targetMissing += 1;
      continue;
    }
    if (anchor === undefined || anchor === null) {
      targetElsewhere += 1;      // 站点 id 不认识 / 没有 anchor
      continue;
    }
    const stationPlace = placeOfStation.get(agent.targetStation);
    if (stationPlace !== undefined && stationPlace !== agent.placeId) {
      targetElsewhere += 1;      // 目标在别的 place：坐标不同系，不测
      continue;
    }
    if (!Number.isFinite(agent.x) || !Number.isFinite(agent.z)) {
      targetElsewhere += 1;
      continue;
    }
    distances.push(Math.hypot(agent.x - anchor.x, agent.z - anchor.z));
    targetMeasured += 1;
  }
}
const sortedDistances = [...distances].sort((a, b) => a - b);
const avgDistance = sortedDistances.length === 0
  ? null
  : Number((sortedDistances.reduce((sum, value) => sum + value, 0) / sortedDistances.length).toFixed(2));
const p90Distance = percentile(sortedDistances, 90);

const seats = {
  stations: stationTotal,
  totalCapacity,
  occupiedMax,
  unseatedMax,
  // 采样期"无座/在场"的均值；0 人的采样不进分母，所以 agents>0 时恒有值
  unseatedShare: unseatedShares.length === 0
    ? null
    : Number((unseatedShares.reduce((sum, value) => sum + value, 0) / unseatedShares.length).toFixed(3)),
};
const waiting = {
  unseatedMax,
  avgDistanceToTarget: avgDistance,
  p90DistanceToTarget: p90Distance,
  distanceSamples: targetMeasured,
  unmeasurable: { noTarget: targetMissing, otherPlace: targetElsewhere },
  noTargetMax,
  dupMax,
  // R527 等待意图的观测口：0 = 无座的人身上没有任何"无站点活动"（改造前的样子）
  stationlessActivityMax: waitingMax,
  stationlessActivitySamples: waitingSamples,
};

// [3.4] rotation：连续无座时长（tick）+ 单次占用超阈的人
const runTicks = finishedUnseatedRuns.map((row) => row.endTick - row.startTick).sort((a, b) => a - b);
const holdRows = [...seatHoldRuns.values()];
const holdTicksSorted = holdRows.map((row) => row.holdTicks).sort((a, b) => a - b);
const holdThresholdTicks = ticksPerSecond === null ? null : holdMinutes * 60 * ticksPerSecond;
const overHoldRows = holdThresholdTicks === null
  ? []
  : holdRows.filter((row) => row.holdTicks >= holdThresholdTicks);
const overHoldAgents = [...new Set(overHoldRows.map((row) => row.agent))];
const rotation = {
  unseatedP50Ticks: percentile(runTicks, 50),
  unseatedP95Ticks: percentile(runTicks, 95),
  unseatedMaxTicks: runTicks.length === 0 ? 0 : runTicks[runTicks.length - 1],
  unseatedRuns: runTicks.length,
  holdThresholdMinutes: holdMinutes,
  holdP50Minutes: ticksToMinutes === null || holdTicksSorted.length === 0 ? null : ticksToMinutes(percentile(holdTicksSorted, 50)),
  holdP95Minutes: ticksToMinutes === null || holdTicksSorted.length === 0 ? null : ticksToMinutes(percentile(holdTicksSorted, 95)),
  holdMaxMinutes: ticksToMinutes === null || holdTicksSorted.length === 0 ? null : ticksToMinutes(holdTicksSorted[holdTicksSorted.length - 1]),
  agentsOverHold: overHoldAgents.length,
  holdsOverThreshold: overHoldRows.length,
};

// [3.5] fairness：无座者里"目标座位坐满且被长期占着"的占比
//       seatFull = 目标 station 上的人已到 capacity（坐不进去）；
//       longHold = 这些人里最久的那次占用 >= 阈值（不是"刚好有人坐着"，是"长期占着"）。
let unseatedWithTarget = 0;
let blockedByLongHold = 0;
let blockedByRotation = 0;
let targetFree = 0;
// 先按 station 归并"这个座位上最长的一次占用"，循环里就不用每次都扫全部占用段
const longestHoldByStation = new Map();
for (const row of seatHoldRuns.values()) {
  longestHoldByStation.set(row.station, Math.max(longestHoldByStation.get(row.station) ?? 0, row.holdTicks));
}
for (const sample of samples) {
  const occupantsByStation = new Map();
  for (const agent of sample.agents) {
    if (agent.station === null) continue;
    const ids = occupantsByStation.get(agent.station) ?? [];
    ids.push(agent.id);
    occupantsByStation.set(agent.station, ids);
  }
  for (const agent of sample.agents) {
    if (agent.station !== null || agent.targetStation === null) continue;
    unseatedWithTarget += 1;
    const occupants = occupantsByStation.get(agent.targetStation) ?? [];
    const capacity = capacityOf.get(agent.targetStation) ?? 1;
    if (occupants.length < capacity) {
      targetFree += 1;
      continue;
    }
    // 目标满了：看这个座位上最长的一次占用够不够"长期"
    const longest = longestHoldByStation.get(agent.targetStation) ?? 0;
    if (holdThresholdTicks !== null && longest >= holdThresholdTicks) blockedByLongHold += 1;
    else blockedByRotation += 1;
  }
}
// 目标站坐满的人次（= 长期占用 + 只是刚好有人坐着）；share 的分母
const fullTargetSamples = blockedByLongHold + blockedByRotation;
const totalSeatedSamples = [...seatedSamplesByAgent.values()].reduce((sum, value) => sum + value, 0);
const topSeatHolders = [...seatedSamplesByAgent.entries()]
  .map(([agent, seatedSamples]) => ({ agent, seatedSamples }))
  .sort((a, b) => b.seatedSamples - a.seatedSamples)
  .slice(0, 5);
const top3SeatedSamples = topSeatHolders.slice(0, 3).reduce((sum, row) => sum + row.seatedSamples, 0);
const fairness = {
  unseatedWithTarget,
  // 目标站还空着就继续走的人次：与下面两项互斥，用来证"不是座位不够，是在路上"
  targetFreeSamples: targetFree,
  blockedByLongHold,
  blockedByRotation,
  blockedByLongHoldShare: fullTargetSamples === 0 ? null : Number((blockedByLongHold / fullTargetSamples).toFixed(3)),
  // 采样人次（不是峰值）：无座且没有 targetStation 的人次，不进上面三个归因
  unseatedWithoutTargetSamples: targetMissing,
  // "同一批人长期占着"的证据面：谁坐得最多 + 前三名占了多少坐着的人次
  holdShareTop3: totalSeatedSamples === 0 ? null : Number((top3SeatedSamples / totalSeatedSamples).toFixed(3)),
  distinctSeatHolders: seatedSamplesByAgent.size,
  topSeatHolders,
  holdMinutes: { p50: rotation.holdP50Minutes, p95: rotation.holdP95Minutes, max: rotation.holdMaxMinutes },
};

// [4] 判定 + 卡点：unseatedShare 必须有值——量不到就等于没验收
let reason = null;
if (samples.length === 0) reason = fetchError === null ? 'no-samples' : 'unreachable';
else if (stallRows.length > 0) reason = 'stall';
else if (dupMax > DUP_LIMIT) reason = 'duplicate-stack';
else if (seats.unseatedShare === null) reason = 'no-unseated-share';

const ok = reason === null;

// [5] notes：只写看得懂的事实，不掩盖判定
const notes = [];
const agentCount = agentCounts[0] ?? null;
if (origin !== null && agentCount !== null) {
  notes.push('世界 ' + agentCount + ' 人 / ' + stationTotal + ' 站点 / 总容量 ' + totalCapacity
    + '：' + (agentCount > totalCapacity ? '人比座位多 ' + (agentCount - totalCapacity) : '座位够但未必坐得上'));
}
if (failedSamples > 0) notes.push('快照失败 ' + failedSamples + ' 次（采样有洞），最后一次: ' + String(fetchError));
if (pausedSamples > 0) notes.push('采样期间世界 paused=true 共 ' + pausedSamples + ' 次（暂停会算成 tick 停滞）');
// 采样为空时下面这些"量到了什么"的细节没有意义，只留上面两条错误事实，别用空指标骗人
if (samples.length > 0) {
  if (ticksPerSecond !== null) notes.push('实测 ' + ticksPerSecond + ' tick/秒，1 分钟 ≈ ' + Math.round(ticksPerSecond * 60) + ' tick');
  if (seats.unseatedMax > totalCapacity) notes.push('无座峰值 ' + seats.unseatedMax + ' 人 > 空座总额，说明有人在有座位时也没去坐');
  if (noTargetMax > 0) notes.push('无座峰值里最多 ' + noTargetMax + ' 人没有 targetStation：站在歇脚点、没有"想去哪"，这类不算抢不到座（fairness 只归因有目标的）');
  if (waiting.distanceSamples === 0) notes.push('没有任何"同 place + 有 targetStation"的无座采样，距离指标为空（不是 0）');
  if (fairness.unseatedWithTarget > 0) {
    notes.push('有目标的无座人次 ' + fairness.unseatedWithTarget + '：目标站还空着 ' + fairness.targetFreeSamples
      + '、目标站坐满 ' + (fairness.blockedByLongHold + fairness.blockedByRotation) + '（长期占用 ' + fairness.blockedByLongHold + '）');
  }
}

const summary = {
  ok,
  ...(ok ? {} : { reason }),
  base,
  seconds,
  ticksPerSecond,
  agents: agentCount,
  samples: samples.length,
  failedSamples,
  tickRange: firstSample === null ? null : [firstSample.tick, lastSample.tick],
  seats,
  waiting,
  rotation,
  fairness,
  details: {
    stalls: stallRows,
    duplicatePositions: [...dupRows.values()],
    unseatedRuns: finishedUnseatedRuns.map((row) => ({
      agent: row.agent,
      ticks: row.endTick - row.startTick,
      seconds: ticksPerSecond === null ? null : Number(((row.endTick - row.startTick) / ticksPerSecond).toFixed(1)),
    })),
    seatHolds: holdRows
      .sort((a, b) => b.holdTicks - a.holdTicks)
      .slice(0, 10)
      .map((row) => ({
        agent: row.agent,
        station: row.station,
        minutes: ticksToMinutes === null ? null : ticksToMinutes(row.holdTicks),
      })),
  },
  notes,
};
console.log(JSON.stringify(summary, null, 1));

if (!ok) {
  const stuck = (() => {
    if (reason === 'unreachable') return fetchError ?? WORLD_URL;
    if (reason === 'no-samples') return '采样 0 次 · ' + WORLD_URL;
    if (reason === 'stall') return stallRows.map((row) => 'tick ' + row.tick + ' 停 ' + row.seconds + 's').join(', ');
    if (reason === 'duplicate-stack') {
      return 'dupMax ' + dupMax + ' > ' + DUP_LIMIT + ' · ' + [...dupRows.values()].map((row) => row.position + ' ← ' + row.agents.join('+')).join(', ');
    }
    if (reason === 'no-unseated-share') return '没有可用采样 · ' + WORLD_URL;
    return '-';
  })();
  failVerify(reason, { stuck, base, error: fetchError });
}
