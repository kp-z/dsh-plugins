#!/usr/bin/env node
/**
 * 验收：多人压测 + 断线重连。**只读**——只 GET 快照、只看事件流；不写世界、不派单、不启进程。
 *
 * 用法：
 *   node tools/verify-scale.mjs --base http://127.0.0.1:3190 --bridge http://127.0.0.1:7791 --agents 8 --seconds 60
 *   node tools/verify-scale.mjs --seconds 15 --agents 3      # 对当前跑着的宿主做一次快速体检
 *
 * 判定（ok = 四条全过）：
 *   [2] 无 tick 停滞：同一 tick 持续 >= 2s 记一次 stall；
 *   [2] 无抢座：同一次采样里某个工位的占用数超过它的 capacity（座位 cap=1，休息区 cap=6）；
 *   [2] agent 数稳定：全程与起点一致；
 *   [3] 断线重连可用：断开再连后能收到帧，且 cursor 前进（epoch 换世代或 seq 变大）。
 * 只报告不判定（[2.2]，卡 task-27）：seating（站点数/总容量/峰值占用/峰值需求/没座位峰值）、
 *   waiting（没 station 的人峰值、窗口内"连续没 station"的最久秒数）、
 *   pressure（超容量事件数、同坐标叠人事件数）。overCapacityEvents > 0 会写进 notes。
 * 失败时 stderr 一行卡点（unreachable / no-samples / stall / seat-conflict / agent-count-unstable / reconnect），退出码 1。
 *
 * --agents 只用来报告"世界人数是否等于压测目标"，**不参与 ok**：人数由宿主的世界决定，本脚本不改世界。
 * 世界快照只有 {base}/agent-world/api/world 一个出口。
 * 事件流用桥上的 GET /api/game/stream（见 src/adapters/slowvale/server.ts:435）：
 * 每帧是 slowvale 信封，cursor 在 data.cursor；断开后重新 fetch 再读即可，桥不给 Last-Event-ID 补发。
 */

import { arg, baseUrl, failVerify, getJson, sleep } from './lib/cli.mjs';

// [0] 参数：解析与 base 归一化在 tools/lib/cli.mjs（各脚本共用一份，纯 .mjs 不经构建）
const base = baseUrl();
const bridge = String(arg('bridge', 'http://127.0.0.1:7791')).replace(/\/+$/, '');
const agentsExpected = Number(arg('agents', 8));
const seconds = Number(arg('seconds', 60));
for (const [flag, value] of [['--agents', agentsExpected], ['--seconds', seconds]]) {
  if (!(Number.isInteger(value) && value > 0)) {
    console.error(flag + ' 必须是正整数');
    process.exit(2);
  }
}

const SAMPLE_MS = 1000;
const REQUEST_MS = 5000;
const STALL_MS = 2000;
const PROBE_MS = 2500;          // 第一条 SSE 连接读多久
const RECONNECT_GAP_MS = 500;   // 断开多久后重连
const RECONNECT_WAIT_MS = 8000; // 重连后等新包的上限
const WORLD_URL = base + '/agent-world/api/world';
const STREAM_URL = bridge + '/api/game/stream';

async function worldSnapshot() {
  const body = await getJson(WORLD_URL, REQUEST_MS);
  if (body.world === null || body.world === undefined) throw new Error('快照里没有 world');
  return body.world;
}

// [1] 起点：tick / agent 数 / 坐下关系（每个 agent 的 station、state）
let origin = null;
let fetchError = null;
try {
  origin = await worldSnapshot();
} catch (error) {
  fetchError = error.message;
}

// [1.1] 工位容量：座位 capacity=1，休息区 capacity=6 —— "多人同一 station" 本身不是抢座，
//       占超过容量才是（否则五个 agent 在休息区睡觉就会被误判成重复精灵）。
const capacityOf = new Map();
for (const station of origin === null ? [] : origin.stations ?? []) {
  if (typeof station.id === 'string' && Number.isInteger(station.capacity)) {
    capacityOf.set(station.id, station.capacity);
  }
}

// [1.2] 站点规模：总容量决定 24 人坐不坐得下（只报告，见 [2.2]）
const stationTotal = capacityOf.size;
const totalCapacity = [...capacityOf.values()].reduce((sum, capacity) => sum + capacity, 0);

// [2] 每秒采样一次，持续 --seconds（t=0..seconds 共 seconds+1 次）
const samples = [];
const counts = [];
const seatRows = new Map();   // 工位+人员 → 抢座事件（跨采样去重，记次数）
const duplicateRows = new Map(); // 坐标+人员 → 同坐标叠人事件（跨采样去重，记次数）
const noStationRuns = new Map(); // agent → { since, longestSec }：这段没 station 从哪开始、已结算的最长
let pausedSamples = 0;
let failedSamples = 0;
let occupiedMax = 0;   // [2.2] 峰值占用：一个采样里最多几人坐在 station 上
let demandMax = 0;     // [2.2] 峰值需求：一个采样里最多几人在场（都要座位）
let unseatedMax = 0;   // [2.2] 没座位的人峰值

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

    const agents = (world.agents ?? []).map((agent) => ({
      id: agent.id,
      state: agent.state ?? null,
      station: typeof agent.station === 'string' ? agent.station : '',
      x: agent.position?.x,
      z: agent.position?.z,
    }));
    const at = Date.now();
    counts.push(agents.length);
    if (world.paused === true) pausedSamples += 1;
    samples.push({ at, tick: world.tick });

    // [2.2] 座位压力：需求 = 在场人数，占用 = 有 station 的人，没座位 = 两者之差
    const seated = agents.filter((agent) => agent.station !== '').length;
    occupiedMax = Math.max(occupiedMax, seated);
    demandMax = Math.max(demandMax, agents.length);
    unseatedMax = Math.max(unseatedMax, agents.length - seated);

    // [2.2] 同坐标叠人：两个及以上 agent 落在完全相同的 (x, z) 就是一格多人
    const byPosition = new Map();
    for (const agent of agents) {
      if (!Number.isFinite(agent.x) || !Number.isFinite(agent.z)) continue;
      const key = agent.x + ',' + agent.z;
      const ids = byPosition.get(key) ?? [];
      ids.push(agent.id);
      byPosition.set(key, ids);
    }
    for (const [position, ids] of byPosition) {
      if (ids.length < 2) continue;
      const key = position + '|' + [...ids].sort().join(',');
      const row = duplicateRows.get(key) ?? { position, agents: [...ids].sort(), samples: 0 };
      row.samples += 1;
      duplicateRows.set(key, row);
    }

    // [2.2] 谁连续没 station：逐人记这段空座的起点，坐下时结算秒数
    for (const agent of agents) {
      const run = noStationRuns.get(agent.id) ?? { since: null, longestSec: 0 };
      if (agent.station === '') {
        if (run.since === null) run.since = at;
      } else if (run.since !== null) {
        run.longestSec = Math.max(run.longestSec, (at - run.since) / 1000);
        run.since = null;
      }
      noStationRuns.set(agent.id, run);
    }

    const byStation = new Map();
    for (const agent of agents) {
      if (agent.station === '') continue;
      const ids = byStation.get(agent.station) ?? [];
      ids.push(agent.id);
      byStation.set(agent.station, ids);
    }
    for (const [station, ids] of byStation) {
      const capacity = capacityOf.get(station) ?? 1;
      if (ids.length <= capacity) continue;
      const key = station + '|' + [...ids].sort().join(',');
      const row = seatRows.get(key) ?? { station, capacity, agents: [...ids].sort(), samples: 0 };
      row.samples += 1;
      seatRows.set(key, row);
    }
  }
}

// [2.1] 停滞：同一 tick 持续 >= STALL_MS 记一次（每个 tick 平台只记一次）
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

const first = samples[0] ?? null;
const last = samples[samples.length - 1] ?? null;
const spanSec = first === null ? 0 : (last.at - first.at) / 1000;
const ticksPerSecond = first === null || last === null || spanSec <= 0
  ? null
  : Number(((last.tick - first.tick) / spanSec).toFixed(2));

const counts0 = counts[0] ?? null;
const agentCountStable = counts.length > 0 && counts0 !== null && counts.every((count) => count === counts0);
const conflictRows = [...seatRows.values()];
const duplicateRowsList = [...duplicateRows.values()];

// [2.2] 座位压力汇总：只报告，不进 ok（卡 task-27）
// 窗口结束时还没坐下的人要把最后一段算进去，否则"一直在等"会显示成 0 秒。
const lastAt = last === null ? null : last.at;
for (const run of noStationRuns.values()) {
  if (run.since !== null && lastAt !== null) {
    run.longestSec = Math.max(run.longestSec, (lastAt - run.since) / 1000);
  }
}
const longestNoStationSec = Number(
  [...noStationRuns.values()].reduce((max, run) => Math.max(max, run.longestSec), 0).toFixed(1),
);
const overCapacityEvents = conflictRows.reduce((sum, row) => sum + row.samples, 0);
const duplicatePositionEvents = duplicateRowsList.reduce((sum, row) => sum + row.samples, 0);
const seating = {
  stations: stationTotal,
  totalCapacity,
  occupiedMax,
  peakDemand: demandMax,
  // 与 waiting.agentsWithoutStationMax 是同一个数：这里按"座位"看，那里按"人"看。
  unseatedMax,
};
const waiting = {
  agentsWithoutStationMax: unseatedMax,
  longestNoStationSec,
};
const pressure = { overCapacityEvents, duplicatePositionEvents };

// [3] 断线重连：先读一段事件流，断开，再 fetch 一条新的，看 cursor 是否前进
function parseFrame(raw) {
  // 只用 data：cursor 在信封顶层（data.cursor），event 名（connected/update）不影响判定。
  const data = [];
  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  try {
    return { json: JSON.parse(data.join('\n')) };
  } catch {
    return null; // 非 JSON 的 data 不算帧
  }
}

function cursorOf(frame) {
  const cursor = frame.json.cursor;
  if (cursor === null || typeof cursor !== 'object') return null;
  if (typeof cursor.seq !== 'number') return null;
  return { epoch: String(cursor.epoch ?? ''), seq: cursor.seq };
}

/** 用 fetch + reader 读 SSE，until(frame) 为真或超时就断开返回。 */
async function readStream(timeoutMs, until) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const frames = [];
  let error = null;
  try {
    const res = await fetch(STREAM_URL, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!res.ok || res.body === null) throw new Error(STREAM_URL + ' → HTTP ' + res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf('\n\n');
      while (cut !== -1) {
        const raw = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf('\n\n');
        const frame = parseFrame(raw);
        if (frame === null) continue;
        frames.push(frame);
        if (until(frame)) {
          controller.abort();
          return { frames, error: null, hit: true };
        }
      }
    }
  } catch (error_) {
    if (error_.name !== 'AbortError') error = error_.message;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { frames, error, hit: false };
}

let reconnect = {
  ok: false,
  advanced: false,
  baseline: null,
  after: null,
  frames: { first: 0, second: 0 },
  error: null,
};
if (origin !== null) {
  const before = await readStream(PROBE_MS, () => false);
  let baseline = null;
  for (const frame of before.frames) {
    const cursor = cursorOf(frame);
    if (cursor !== null) baseline = cursor;
  }

  await sleep(RECONNECT_GAP_MS);

  let advancedCursor = null;
  const after = await readStream(RECONNECT_WAIT_MS, (frame) => {
    const cursor = cursorOf(frame);
    if (cursor === null || baseline === null) return false;
    if (cursor.epoch === baseline.epoch && cursor.seq <= baseline.seq) return false;
    advancedCursor = cursor;
    return true;
  });

  reconnect = {
    ok: after.frames.length > 0 && advancedCursor !== null,
    advanced: advancedCursor !== null,
    baseline,
    after: advancedCursor,
    frames: { first: before.frames.length, second: after.frames.length },
    error: before.error ?? after.error,
  };
}

// [4] 判定 + 卡点
let reason = null;
if (samples.length === 0) reason = fetchError === null ? 'no-samples' : 'unreachable';
else if (stallRows.length > 0) reason = 'stall';
else if (conflictRows.length > 0) reason = 'seat-conflict';
else if (!agentCountStable) reason = 'agent-count-unstable';
else if (!reconnect.ok) reason = 'reconnect';

const ok = reason === null;

// [5] notes：只写看得懂的事实，不掩盖判定
const notes = [];
if (origin !== null && counts0 !== null && counts0 !== agentsExpected) {
  notes.push('--agents ' + agentsExpected + ' 与世界 ' + counts0 + ' 人不符（人数只看稳定性，不影响 ok）');
}
if (failedSamples > 0) notes.push('快照失败 ' + failedSamples + ' 次（采样有洞，停滞判定可能漏），最后一次: ' + String(fetchError));
if (pausedSamples > 0) notes.push('采样期间世界 paused=true 共 ' + pausedSamples + ' 次（暂停会算成 tick 停滞）');
// [2.2] 超容量是"座位不够"的硬证据，必须写进 notes（判定仍看 [4]，不因它改 ok）
if (overCapacityEvents > 0) {
  notes.push('采样期间出现 ' + overCapacityEvents + ' 次超容量（' + conflictRows.length
    + ' 组站点/人员组合，见 details.seatConflicts）');
}
if (origin !== null) {
  const originAgents = origin.agents ?? [];
  const seated = originAgents.filter((agent) => typeof agent.station === 'string' && agent.station !== '').length;
  notes.push('起点 ' + originAgents.length + ' 人，' + seated + ' 人已坐下');
}

const summary = {
  ok,
  ...(ok ? {} : { reason }),
  base,
  bridge,
  agentsExpected,
  seconds,
  ticksPerSecond,
  stalls: stallRows.length,
  seatConflicts: conflictRows.length,
  agentCountStable,
  // [2.2] 座位压力：只报告，不进 ok（卡 task-27）
  seating,
  waiting,
  pressure,
  reconnect,
  agentCount: counts0,
  tickRange: first === null ? null : [first.tick, last.tick],
  // [1] 的起点快照：谁坐在哪、在干什么（review 时对照用）
  start: origin === null ? null : {
    tick: origin.tick,
    agents: (origin.agents ?? []).map((agent) => ({
      id: agent.id,
      station: typeof agent.station === 'string' && agent.station !== '' ? agent.station : null,
      state: agent.state ?? null,
    })),
  },
  samples: samples.length,
  failedSamples,
  details: {
    stalls: stallRows,
    seatConflicts: conflictRows,
    // [2.2] 同坐标叠人：每行是"一处坐标 + 这批人 + 出现了几次采样"
    duplicatePositions: duplicateRowsList,
    agentsPerSample: counts,
  },
  notes,
};
console.log(JSON.stringify(summary, null, 1));

if (!ok) {
  const stuck = (() => {
    if (reason === 'unreachable') return fetchError ?? WORLD_URL;
    if (reason === 'no-samples') return '采样 0 次 · ' + WORLD_URL;
    if (reason === 'stall') return stallRows.map((row) => 'tick ' + row.tick + ' 停 ' + row.seconds + 's').join(', ');
    if (reason === 'seat-conflict') {
      return conflictRows.map((row) => row.station + '(' + row.agents.length + '/' + row.capacity + ') ← ' + row.agents.join('+')).join(', ');
    }
    if (reason === 'agent-count-unstable') return '人数: ' + counts.join(',');
    if (reason === 'reconnect') {
      return STREAM_URL + ' · 帧 ' + reconnect.frames.first + '→' + reconnect.frames.second
        + (reconnect.error === null ? '' : ' · ' + reconnect.error);
    }
    return '-';
  })();
  failVerify(reason, { stuck, base, tail: ' · bridge ' + bridge, error: fetchError });
}
