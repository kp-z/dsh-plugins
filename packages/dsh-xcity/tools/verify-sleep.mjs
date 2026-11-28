#!/usr/bin/env node
/**
 * 验收：**夜里到底多少人睡得着**。**只读**——只 GET 世界快照；不写世界、不派单、不启进程。
 *
 * 用法：
 *   node tools/verify-sleep.mjs --base http://127.0.0.1:3190 --seconds 60
 *
 * 口径（docs/REST-DEMAND.md §6 的三个陷阱逐条兑掉）：
 *   - 一天 1440 tick（1 tick = 1 游戏分钟），夜里 = [23:00, 07:00)（`src/sim/life.ts:104-108`），
 *     所以"一夜"是硬窗口 [d*1440+1380, (d+1)*1440+420)，480 个 tick。
 *   - **`world.activities` 是环形缓冲（24 条/人，`src/sim/activity.ts:31`），窗口不是一天**：
 *     所有统计先按"夜"分窗、再在窗内逐 tick 扫线；**全文没有一处"总时长 ÷ 1440"**。
 *   - 床位供给 = `capabilities` 含 `rest` 的站点容量之和（`life.ts:424` 的 `freeStation(…, ['rest'])`），不猜；
 *     同一批座位也用来吃饭，但本卡只算 `purpose === 'sleep'`。
 *   - 睡眠区间 = `[startedAt, endedAt ?? min(endsAt, world.tick))`（与 REST-DEMAND §7 的 dur 同口径）。
 *   - 被环形缓冲截断的夜记 partial，**不进 coverage / turnover 的分布**（只报个数），
 *     否则首尾两夜必然算低——分母错了，后面怎么算都错。
 *
 * 输出：
 *   [1] beds     { restStations, restCapacity, sleepOccupiedMax, sleepOccupiedShare }
 *                —— 逐 tick 扫线的同睡人数峰值；share = 峰值 ÷ restCapacity（床位的打满率）
 *   [2] coverage 每个完整夜"睡过的人（去重 agent 数）÷ 总人数"：逐夜值 + p50 / max
 *   [3] energy   采样快照里全体 energy 的 p10/p50/p90；夜里 `state=idle && energy<60` 的人数峰值
 *                （夜里人人想睡、`idle` 与 `sleeping` 是两个状态，所以 idle 就是"没睡到"）
 *   [4] turnover 同一张床一晚服务过几个人（夜 × 站点的去重 agent 数）的 p50/p95/max
 *   [5] ok = 采到样本 + 没有 tick 停滞（只判"量到了"，不判阈值）
 *   失败时 stdout 给 { ok:false, reason }（unreachable / no-samples / stall），退出码 1。
 */

import { arg, baseUrl, fail, getJson, percentile } from './lib/cli.mjs';

// [0] 参数与常量：与 `src/sim/life.ts` 同一套时间口径（.mjs 不能 import .ts，常量在这里对齐）
const DAY_TICKS = 1440;
const NIGHT_FROM = 23 * 60;                                  // life.ts:105-107
const NIGHT_TO = 7 * 60;
const NIGHT_TICKS = DAY_TICKS - NIGHT_FROM + NIGHT_TO;       // 480
const ENERGY_UNSLEPT = 60;

const SAMPLE_MS = 1000;
const REQUEST_MS = 5000;
const STALL_MS = 2000;

const base = baseUrl();
const seconds = Number(arg('seconds', 60));
if (!Number.isInteger(seconds) || seconds <= 0) {
  console.error('--seconds 必须是正整数');
  process.exit(2);
}

const WORLD_URL = base + '/agent-world/api/world';

const minuteOfDay = (tick) => ((Math.floor(tick) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
// 夜 d = [d*1440+1380, (d+1)*1440+420)，480 tick；用它给"某个 tick 属于哪一夜"编号（以 23:00 为界）
const nightOf = (tick) => (minuteOfDay(tick) >= NIGHT_FROM ? Math.floor(tick / DAY_TICKS) : Math.floor(tick / DAY_TICKS) - 1);

async function snapshot() {
  const body = await getJson(WORLD_URL, REQUEST_MS);
  if (body.world === null || body.world === undefined) throw new Error('快照里没有 world');
  return body.world;
}

// 活动区间右端：已完成用 endedAt；在跑的用 min(endsAt, 现在)。超出 now 的按 now 截断。
const endOf = (activity, now) => {
  if (Number.isFinite(activity.endedAt)) return activity.endedAt;
  if (Number.isFinite(activity.endsAt)) return Math.min(activity.endsAt, now);
  return now;
};

// [1] 起点：床位供给 + 人数（分母）。供给取 origin 快照，采样期间不重算。
let origin = null;
let fetchError = null;
try {
  origin = await snapshot();
} catch (error) {
  fetchError = error.message;
}

const restStations = (origin === null ? [] : origin.stations ?? []).filter(
  (station) => typeof station.id === 'string' && (station.capabilities ?? []).includes('rest'),
);
const restCapacity = restStations.reduce(
  (sum, station) => sum + (Number.isInteger(station.capacity) ? station.capacity : 1),
  0,
);
const agentCount = origin === null ? null : (origin.agents ?? []).length;

// [2] 每秒采一次，持续 --seconds：只留本卡用得到的字段（快照 1MB，别全留）
const samples = [];
const energies = [];
let ring = { tick: null, activities: [] };
let nightSamples = 0;
let nightIdleNoBedMax = null;
let failedSamples = 0;

if (origin !== null) {
  const startAt = Date.now();
  for (let i = 0; i <= seconds; i += 1) {
    const wait = startAt + i * SAMPLE_MS - Date.now();
    if (wait > 0) await new Promise((done) => setTimeout(done, wait));

    let world;
    try {
      world = await snapshot();
    } catch (error) {
      failedSamples += 1;
      fetchError = error.message;
      continue;
    }

    const tick = Number(world.tick);
    const at = Date.now();

    // [2.1] 现在谁真的躺在床上（active + purpose=sleep）；"没睡到"的判定靠它，不靠 energy 猜
    const sleepingNow = new Set();
    const activities = [];
    for (const activity of world.activities ?? []) {
      if (typeof activity.agentId !== 'string' || !Number.isFinite(activity.startedAt)) continue;
      const item = {
        agentId: activity.agentId,
        purpose: activity.purpose,
        stationId: typeof activity.stationId === 'string' ? activity.stationId : null,
        start: activity.startedAt,
        end: endOf(activity, tick),
      };
      activities.push(item);
      if (activity.status === 'active' && activity.purpose === 'sleep') sleepingNow.add(activity.agentId);
    }
    ring = { tick, activities };

    // [2.2] energy 池化 + 夜间"idle 没睡到"人数：夜里（00:00–07:00 与 23:00–24:00）才有意义
    const isNight = minuteOfDay(tick) >= NIGHT_FROM || minuteOfDay(tick) < NIGHT_TO;
    let nightIdleNoBed = 0;
    for (const agent of world.agents ?? []) {
      const energy = agent.needs?.energy;
      if (Number.isFinite(energy)) energies.push(energy);
      if (!isNight) continue;
      if (agent.state !== 'idle') continue;                   // sleeping / walking 不算"没睡到"
      if (!Number.isFinite(energy) || energy >= ENERGY_UNSLEPT) continue;
      if (sleepingNow.has(agent.id)) continue;
      nightIdleNoBed += 1;
    }
    if (isNight) {
      nightSamples += 1;
      nightIdleNoBedMax = Math.max(nightIdleNoBedMax ?? 0, nightIdleNoBed);
    }

    samples.push({ at, tick });
  }
}

// [3] tick 停滞：同一 tick 持续 >= STALL_MS 记一次（与 verify-scale / verify-unseated 同口径）
const stalls = [];
let plateau = null;
for (const sample of samples) {
  if (plateau === null || sample.tick !== plateau.tick) {
    plateau = { tick: sample.tick, startAt: sample.at, flagged: false };
    continue;
  }
  const heldMs = sample.at - plateau.startAt;
  if (!plateau.flagged && heldMs >= STALL_MS) {
    plateau.flagged = true;
    stalls.push({ tick: plateau.tick, seconds: Number((heldMs / 1000).toFixed(1)) });
  }
}

// [4] 环形缓冲扫线：窗口 = [最早 startedAt, 现在]，按"夜"分窗后逐 tick 累加
const sleepActs = ring.activities.filter((activity) => activity.purpose === 'sleep' && activity.end > activity.start);
// 环形缓冲的窗口起点 = 环里最老一条活动的 startedAt（更早的已经被 FIFO 挤掉了）
const observedFrom = ring.activities.length === 0
  ? null
  : Math.min(...ring.activities.map((activity) => activity.start));
const observedTo = ring.tick;
const span = observedFrom === null || !Number.isFinite(observedTo) ? 0 : observedTo - observedFrom;

// [4.1] beds：逐 tick 扫线的同睡人数峰值（差分数组 = 每个 tick 的占用量，不抽样、不平均）
let sleepOccupiedMax = null;
if (span > 0) {
  const diff = new Int32Array(span + 1);
  for (const activity of sleepActs) {
    const from = Math.max(0, Math.floor(activity.start - observedFrom));
    const to = Math.min(span, Math.floor(activity.end - observedFrom));
    if (to <= from) continue;
    diff[from] += 1;
    diff[to] -= 1;
  }
  let level = 0;
  sleepOccupiedMax = 0;
  for (let i = 0; i < span; i += 1) {
    level += diff[i];
    if (level > sleepOccupiedMax) sleepOccupiedMax = level;
  }
}

const beds = {
  restStations: restStations.length,
  restCapacity,
  sleepOccupiedMax,
  // 打满率：峰值 ÷ 供给。分母是 0 时量不到，给 null 不给 0
  sleepOccupiedShare: sleepOccupiedMax === null || restCapacity <= 0
    ? null
    : Number((sleepOccupiedMax / restCapacity).toFixed(3)),
};

// [4.2] 分夜：夜 d 的窗口 [d*1440+1380, (d+1)*1440+420)；coveredTicks 判这个夜是不是被环形缓冲截断了
const nights = [];
if (span > 0) {
  for (let d = nightOf(observedFrom); d <= nightOf(observedTo - 1); d += 1) {
    const from = d * DAY_TICKS + NIGHT_FROM;
    const to = from + NIGHT_TICKS;
    const coveredTicks = Math.max(0, Math.min(to, observedTo) - Math.max(from, observedFrom));
    // 采样起点落在白天时 nightOf 会指向"上一个夜"，那个夜一个 tick 都没观测到——不是 partial，是不存在
    if (coveredTicks === 0) continue;
    nights.push({ night: d, from, to, coveredTicks, full: coveredTicks >= NIGHT_TICKS, slept: new Set(), perStation: new Map() });
  }
  for (const night of nights) {
    // 只在这个夜**被观测到的那一段**里算重叠，partial 夜才不会凭空多出睡眠者
    const clipFrom = Math.max(night.from, observedFrom);
    const clipTo = Math.min(night.to, observedTo);
    if (clipTo <= clipFrom) continue;
    for (const activity of sleepActs) {
      if (Math.min(activity.end, clipTo) - Math.max(activity.start, clipFrom) <= 0) continue;
      night.slept.add(activity.agentId);
      const occupants = night.perStation.get(activity.stationId) ?? new Set();
      occupants.add(activity.agentId);
      night.perStation.set(activity.stationId, occupants);
    }
  }
}

const fullNights = nights.filter((night) => night.full);
const sleptPerNight = fullNights.map((night) => night.slept.size).sort((a, b) => a - b);
const share = (count) => (agentCount === null || agentCount === 0 ? null : Number((count / agentCount).toFixed(3)));

const coverage = {
  nights: nights.length,
  fullNights: fullNights.length,
  partialNights: nights.filter((night) => !night.full).map((night) => night.night),
  agents: agentCount,
  sleptPerNight: fullNights.map((night) => ({ night: night.night, slept: night.slept.size, share: share(night.slept.size) })),
  p50Slept: percentile(sleptPerNight, 50),
  maxSlept: sleptPerNight.length === 0 ? null : sleptPerNight[sleptPerNight.length - 1],
  p50Share: sleptPerNight.length === 0 ? null : share(percentile(sleptPerNight, 50)),
  maxShare: sleptPerNight.length === 0 ? null : share(sleptPerNight[sleptPerNight.length - 1]),
  // 整环里去重睡过觉的人：跟"每晚"不是一个量，只作对照
  distinctSleepers: new Set(sleepActs.map((activity) => activity.agentId)).size,
};

// [4.3] turnover：夜 × 站点 的去重 agent 数（一张床一晚服务过几个人）
const turnoverRows = [];
for (const night of fullNights) {
  for (const [stationId, occupants] of night.perStation) {
    turnoverRows.push({ night: night.night, station: stationId, agents: occupants.size });
  }
}
const turnoverCounts = turnoverRows.map((row) => row.agents).sort((a, b) => a - b);
const turnover = {
  rows: turnoverRows.length,
  beds: new Set(turnoverRows.map((row) => row.station)).size,
  p50: percentile(turnoverCounts, 50),
  p95: percentile(turnoverCounts, 95),
  max: turnoverCounts.length === 0 ? null : turnoverCounts[turnoverCounts.length - 1],
  mean: turnoverCounts.length === 0
    ? null
    : Number((turnoverCounts.reduce((sum, value) => sum + value, 0) / turnoverCounts.length).toFixed(2)),
};

// [4.4] energy：全体池化分位 + 夜里"idle 却没睡到"的峰值
const sortedEnergy = [...energies].sort((a, b) => a - b);
// 分位保留 1 位小数：energy 是 0~100 的量，多余精度只是浮点噪声
const round1 = (value) => (value === null || value === undefined ? null : Number(value.toFixed(1)));
const energy = {
  samples: energies.length,
  p10: round1(percentile(sortedEnergy, 10)),
  p50: round1(percentile(sortedEnergy, 50)),
  p90: round1(percentile(sortedEnergy, 90)),
  unsleptBar: ENERGY_UNSLEPT,
  nightSamples,
  nightIdleNoBedMax,
};

// [5] 判定：只看"量到了"和"世界没停"，不看任何阈值（阈值属于另一方的事，验收不该自带判据）
const firstSample = samples[0] ?? null;
const lastSample = samples[samples.length - 1] ?? null;
const spanSec = firstSample === null || lastSample === null ? 0 : (lastSample.at - firstSample.at) / 1000;
const ticksPerSecond = firstSample === null || lastSample === null || spanSec <= 0
  ? null
  : Number(((lastSample.tick - firstSample.tick) / spanSec).toFixed(2));

if (samples.length === 0) {
  fail(fetchError === null ? 'no-samples' : 'unreachable', { base, seconds, error: fetchError });
}
if (stalls.length > 0) {
  fail('stall', { base, seconds, samples: samples.length, stalls });
}

const notes = [];
if (agentCount !== null) {
  notes.push('世界 ' + agentCount + ' 人 / 休息位 ' + restStations.length + ' 站 ' + restCapacity + ' 座');
}
if (span > 0) {
  notes.push('环形缓冲 ' + ring.activities.length + ' 条 / 窗口 ' + span + ' tick = '
    + (span / DAY_TICKS).toFixed(2) + ' 天：窗口不是一天，所以一切按夜分窗（REST-DEMAND §6 陷阱 1）');
}
if (nights.length > 0 && fullNights.length === 0) {
  notes.push('环形缓冲里没有一个完整的夜，coverage / turnover 为空——是"量不到"，不是 0（跑久一点再看）');
}
if (coverage.partialNights.length > 0) {
  notes.push('被环形缓冲截断的夜 ' + coverage.partialNights.join(',') + ' 不进分布（首尾两夜必然偏低）');
}
if (nightSamples === 0) {
  notes.push('采样窗口没落在夜里（23:00–07:00），nightIdleNoBedMax 为空——不是 0');
}
if (failedSamples > 0) {
  notes.push('快照失败 ' + failedSamples + ' 次（采样有洞），最后一次: ' + String(fetchError));
}
if (ticksPerSecond !== null) {
  notes.push('实测 ' + ticksPerSecond + ' tick/秒，--seconds ' + seconds + ' ≈ ' + Math.round(ticksPerSecond * seconds) + ' tick');
}

const summary = {
  ok: true,
  base,
  seconds,
  samples: samples.length,
  failedSamples,
  ticksPerSecond,
  tickRange: firstSample === null ? null : [firstSample.tick, lastSample.tick],
  beds,
  coverage,
  energy,
  turnover,
  details: {
    nights: nights.map((night) => ({
      night: night.night,
      full: night.full,
      coveredTicks: night.coveredTicks,
      slept: night.slept.size,
      perStation: [...night.perStation].map(([station, occupants]) => ({ station, agents: occupants.size })),
    })),
  },
  notes,
};
console.log(JSON.stringify(summary, null, 1));
