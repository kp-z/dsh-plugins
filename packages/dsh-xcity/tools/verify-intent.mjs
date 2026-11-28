#!/usr/bin/env node
/**
 * 意图归因的核对脚本（R528）。**只读**——只 GET 快照；不写世界、不派单、不启任何进程。
 *
 * 目的：把「为什么这些人没有自选动作」从一句猜测变成一张表。
 *
 * 用法：
 *   node tools/verify-intent.mjs --base http://127.0.0.1:3190
 *   node tools/verify-intent.mjs --base http://127.0.0.1:3190 --seconds 30
 *
 * 口径：
 *   - counts 读快照**顶层**的 `runtime.intentStats`（`{ total, byReason }`，与 plan / turnCost 同构，
 *     不是 `world.runtime`）；读不到就是 no-stats，不猜。
 *   - byReason 的键是 sim/life.ts 里 intentOptions 的各个出口；脚本按**全表**打印，
 *     不预设"哪些键必须出现"（键名漂移只进 notes，不判失败）。
 *   - 计数器是**自世界启动以来的累计值**，不是本窗口增量；所以另算 `delta` = 末样本 − 首样本。
 *     计数器变小（世界被重建/重置）时 delta 为 null——这种情况不编数。
 *   - context 取**最后一个样本那一刻**：在场人数、站点容量与占用、各 state 人数、tasks 状态分布。
 *   - cross 是两张表之间的一致性检查，不是阈值判定。两张表**不在同一时间轴**上（counts 是累计，
 *     context 是那一刻），所以规则只有一条：**只有本窗口内新增（delta > 0）的观测，才要求现场作证**。
 *     历史累计对不上现场不算矛盾——那些人早就走完了，拿"现在没人走路"去否"十分钟前有人走路"是弱逻辑。
 *       total-is-sum                  total 必须等于 byReason 各项之和（不看时间，直接判）；
 *       task-ready-has-ready-task     窗口内新增 task-ready ⇒ 窗口里出现过 status=ready 的单
 *                                     （对应 life.ts 的 `tasks.some(status === 'ready') return []`）；
 *       not-available-has-busy-agent  窗口内新增 not-available ⇒ 窗口里有人不满足 available()
 *                                     （available() = state idle 且没拿单、没活动、没站点、没目标站点、路径为空；
 *                                      这里把六个条件**照着抄一遍**当独立口径，不是复用内核代码）。
 *     后两条取采样**窗口最大值**而不是最后那一刻：人走完路就回 idle，拿某一瞬间当证据会假报矛盾。
 *     delta 量不出来（计数被重置）时这两条记 unverifiable，不判失败。
 *
 * 输出：
 *   [1] counts   { total, byReason, delta }
 *   [2] context  { tick, agents, stationCapacity, states, tasks, windowMax }
 *   [3] cross    [{ check, ok, expect, actual }]
 *   [4] ok = intentStats 可读 + 至少采到一个样本 + cross 无矛盾
 *   失败时 stderr 一行卡点（unreachable / no-samples / no-stats / cross-contradiction），退出码 1；参数错退出码 2。
 */

import { arg, baseUrl, failVerify, getJson, sleep } from './lib/cli.mjs';

// [0] 参数：解析与 base 归一化在 tools/lib/cli.mjs（各脚本共用一份，纯 .mjs 不经构建）
const base = baseUrl();
const seconds = Number(arg('seconds', 30));
if (!(Number.isFinite(seconds) && seconds > 0)) {
  console.error('--seconds 必须是正数');
  process.exit(2);
}
if (!Number.isInteger(seconds)) {
  console.error('--seconds 必须是正整数');
  process.exit(2);
}

// 契约里的 reason 常量（task-47 的 intent-stats.ts）。只用来标"这个键没见过"，
// **不**用来判失败：新出口该上线就上线，别让核对脚本卡住实现。
const KNOWN_REASONS = new Set([
  'not-available',
  'task-ready',
  'no-work-station',
  'no-rest-station',
  'no-social-station',
  'night-no-rest',
  'hungry-no-breakroom',
  'need-null',
  'ok',
]);

const SAMPLE_MS = 1000;
const REQUEST_MS = 5000;
const WORLD_URL = base + '/agent-world/api/world';

async function worldSnapshot() {
  const body = await getJson(WORLD_URL, REQUEST_MS);
  if (body === null || typeof body !== 'object') throw new Error(WORLD_URL + ' 返回的不是对象');
  if (body.world === null || body.world === undefined) throw new Error('快照里没有 world');
  return body;
}

/**
 * [1.1] 读 runtime.intentStats；形状不对就当没装。
 *
 * 为什么严格要求 byReason 是对象：这张表就是本脚本的全部证据面，
 * 只有 total 没有分项等于量不到原因，宁可报 no-stats 也不报个 0。
 */
function readIntentStats(body) {
  const stats = body.runtime === null || typeof body.runtime !== 'object' ? undefined : body.runtime.intentStats;
  if (stats === null || typeof stats !== 'object' || Array.isArray(stats)) return null;
  const total = Number(stats.total);
  if (!Number.isFinite(total)) return null;
  const raw = stats.byReason;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const byReason = {};
  for (const [key, value] of Object.entries(raw)) {
    const count = Number(value);
    if (Number.isFinite(count)) byReason[key] = count;
  }
  return { total, byReason };
}

/**
 * [1.2] available() 的独立抄写（sim/life.ts:112）。
 *
 * 这是**核对**，所以必须自己写一遍：直接调用内核那个函数的确会永远算对，
 * 但也就永远发现不了"计数点被挪到别的分支"这类漂移。
 */
function unavailable(agent) {
  if (agent.state !== 'idle') return true;
  if (agent.carrying !== null && agent.carrying !== undefined) return true;
  if (agent.activityUntil !== undefined && agent.activityUntil !== null) return true;
  if (agent.station !== null && agent.station !== undefined) return true;
  if (agent.targetStation !== null && agent.targetStation !== undefined) return true;
  return Array.isArray(agent.path) && agent.path.length > 0;
}

/** 表按次数降序排：这张表是给人看的，第一名就是主要矛盾。 */
function byCountDesc(table) {
  return Object.fromEntries(Object.entries(table).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

/** 末 − 首；计数器变小或任一端缺失 = 量不出来，返回 null。 */
function deltaOf(first, last) {
  if (first === null || last === null) return null;
  if (last.total < first.total) return null;
  const keys = new Set([...Object.keys(first.byReason), ...Object.keys(last.byReason)]);
  const delta = {};
  for (const key of keys) delta[key] = (last.byReason[key] ?? 0) - (first.byReason[key] ?? 0);
  return byCountDesc(delta);
}

// [2] 每秒采一次，持续 --seconds（t=0..seconds 共 seconds+1 次）
let samples = 0;
let failedSamples = 0;
let pausedSamples = 0;
let fetchError = null;
let lastWorld = null;
let runtimeKeys = [];
let statsFirst = null;          // 第一个读到 intentStats 的样本（delta 的起点）
let statsLast = null;           // 最后一个读到 intentStats 的样本（表的内容）
let statsSamples = 0;
let statsMissingSamples = 0;
const windowMax = { agents: 0, unavailable: 0, readyTasks: 0 };

const startAt = Date.now();
for (let i = 0; i <= seconds; i += 1) {
  const wait = startAt + i * SAMPLE_MS - Date.now();
  if (wait > 0) await sleep(wait);

  let body;
  try {
    body = await worldSnapshot();
  } catch (error) {
    failedSamples += 1;
    fetchError = error.message;
    continue;
  }
  samples += 1;
  const world = body.world;
  lastWorld = world;
  if (body.runtime !== null && typeof body.runtime === 'object') runtimeKeys = Object.keys(body.runtime);
  if (world.paused === true) pausedSamples += 1;

  // [2.1] counts：同一份快照里的两个面，不让它们来自两个时刻
  const stats = readIntentStats(body);
  if (stats === null) statsMissingSamples += 1;
  else {
    statsSamples += 1;
    if (statsFirst === null) statsFirst = stats;
    statsLast = stats;
  }

  // [2.2] context 的窗口最大值：只留三个数，供 cross 用（取最大值 = 这一刻没看到也还有机会看到）
  const agents = Array.isArray(world.agents) ? world.agents : [];
  windowMax.agents = Math.max(windowMax.agents, agents.length);
  windowMax.unavailable = Math.max(windowMax.unavailable, agents.filter(unavailable).length);
  windowMax.readyTasks = Math.max(
    windowMax.readyTasks,
    (Array.isArray(world.tasks) ? world.tasks : []).filter((task) => task?.status === 'ready').length,
  );
}

// [3] 汇总：counts 取最后一份读到的表，context 取最后一个样本那一刻（两者不出自同一个 tick，所以分开报）
// [3.1] counts
const counts = statsLast === null ? null : {
  total: statsLast.total,
  byReason: byCountDesc(statsLast.byReason),
  delta: deltaOf(statsFirst, statsLast),
};

// [3.2] context
let context = null;
if (lastWorld !== null) {
  const agents = (Array.isArray(lastWorld.agents) ? lastWorld.agents : []).map((agent) => ({
    state: typeof agent.state === 'string' ? agent.state : String(agent.state),
    station: typeof agent.station === 'string' ? agent.station : null,
  }));
  const stations = Array.isArray(lastWorld.stations) ? lastWorld.stations : [];
  const capacityOfStation = stations
    .filter((station) => typeof station?.id === 'string' && Number.isFinite(station.capacity))
    .map((station) => Number(station.capacity));
  const states = {};
  for (const agent of agents) states[agent.state] = (states[agent.state] ?? 0) + 1;
  const tasksByStatus = {};
  for (const task of Array.isArray(lastWorld.tasks) ? lastWorld.tasks : []) {
    const status = typeof task?.status === 'string' ? task.status : String(task?.status);
    tasksByStatus[status] = (tasksByStatus[status] ?? 0) + 1;
  }
  context = {
    tick: Number.isFinite(Number(lastWorld.tick)) ? Number(lastWorld.tick) : null,
    agents: agents.length,
    stationCapacity: {
      stations: capacityOfStation.length,
      totalCapacity: capacityOfStation.reduce((sum, capacity) => sum + capacity, 0),
      occupied: agents.filter((agent) => agent.station !== null).length,
    },
    states: byCountDesc(states),
    tasks: {
      total: Array.isArray(lastWorld.tasks) ? lastWorld.tasks.length : 0,
      byStatus: byCountDesc(tasksByStatus),
    },
    windowMax,
  };
}

// [4] cross：counts 与 context 对着看。只留三条，每一条都写清楚它在证什么。
const cross = [];
function add(check, pass, expect, actual) {
  cross.push({ check, ok: pass, expect, actual });
}

if (counts !== null && context !== null) {
  const sum = Object.values(counts.byReason).reduce((total, count) => total + count, 0);
  add('total-is-sum', sum === counts.total, 'total === Σ byReason', { total: counts.total, sum });

  // [4.1] 只有本窗口新增的观测才要求现场作证；delta 量不出来就是 unverifiable（不判失败）
  const newIn = (key) => (counts.delta === null ? null : counts.delta[key] ?? 0);
  const newTaskReady = newIn('task-ready');
  add(
    'task-ready-has-ready-task',
    newTaskReady === null || newTaskReady === 0 || windowMax.readyTasks > 0,
    '窗口内新增 task-ready ⇒ 窗口里出现过 status=ready 的单',
    { newTaskReady: newTaskReady ?? 'unverifiable', readyMax: windowMax.readyTasks },
  );

  // [4.2] 同理：窗口里新增 not-available，就必须有人在那一刻不满足 available()
  const newNotAvailable = newIn('not-available');
  add(
    'not-available-has-busy-agent',
    newNotAvailable === null || newNotAvailable === 0 || windowMax.unavailable > 0,
    '窗口内新增 not-available ⇒ 窗口里有人不满足 available()',
    { newNotAvailable: newNotAvailable ?? 'unverifiable', unavailableMax: windowMax.unavailable },
  );
}

// [5] 判定 + 卡点：ok = 仪器可读 + 采到样本 + 没有矛盾
const contradictions = cross.filter((check) => !check.ok);
let reason = null;
if (samples === 0) reason = fetchError === null ? 'no-samples' : 'unreachable';
else if (counts === null) reason = 'no-stats';
else if (contradictions.length > 0) reason = 'cross-contradiction';
const ok = reason === null;

// [6] notes：只写看得懂的事实，不改判定
const notes = [];
if (counts !== null) {
  notes.push('byReason 是自世界启动以来的累计值；context 是最后一个样本那一刻；delta 才是本窗口增量');
  if (counts.total === 0) notes.push('intentStats 装上了但一次也没记到（世界可能刚起，或观察点没被走到）');
  const unknown = Object.keys(counts.byReason).filter((key) => !KNOWN_REASONS.has(key));
  if (unknown.length > 0) notes.push('契约外的 reason: ' + unknown.join(', ') + '（可能是新出口，核对一下 intent-stats 的常量表）');
  const nullReasons = counts.total - (counts.byReason.ok ?? 0);
  if (counts.total > 0) notes.push('没产生意图的累计次数 ' + nullReasons + '（= total − ok）');
  if (counts.delta === null) notes.push('本窗口的 delta 为空：两端没都读到，或计数器变小了（世界被重建），不编数');
}
if (statsMissingSamples > 0 && statsSamples > 0) {
  notes.push('有 ' + statsMissingSamples + ' 个样本读不到 intentStats（其余 ' + statsSamples + ' 个读到了）：宿主可能中途重建世界');
}
if (failedSamples > 0) notes.push('快照失败 ' + failedSamples + ' 次（采样有洞），最后一次: ' + String(fetchError));
if (pausedSamples > 0) notes.push('采样期间世界 paused=true 共 ' + pausedSamples + ' 次');
if (context !== null && context.agents > context.stationCapacity.totalCapacity) {
  notes.push('人比座位多 ' + (context.agents - context.stationCapacity.totalCapacity) + '（' + context.agents + ' 人 / 容量 ' + context.stationCapacity.totalCapacity + '）');
}

const summary = {
  ok,
  ...(ok ? {} : { reason }),
  base,
  seconds,
  samples,
  failedSamples,
  counts,
  context,
  cross,
  notes,
};
console.log(JSON.stringify(summary, null, 1));

if (!ok) {
  const stuck = (() => {
    if (reason === 'unreachable') return fetchError ?? WORLD_URL;
    if (reason === 'no-samples') return '采样 0 次 · ' + WORLD_URL;
    if (reason === 'no-stats') {
      return 'runtime.intentStats 读不到（形状要是 { total, byReason }）· runtime 现有键: ' + (runtimeKeys.join(',') || '（空）');
    }
    return contradictions.map((check) => check.check + ' ' + JSON.stringify(check.actual)).join(', ');
  })();
  failVerify(reason, { stuck, base, error: fetchError });
}
