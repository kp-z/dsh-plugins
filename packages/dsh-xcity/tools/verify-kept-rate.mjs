#!/usr/bin/env node
/**
 * 验收：承诺兑现率（keptRate）与爽约原因分布。**只读**——只 GET 快照；不写世界、不改代码、不启进程。
 *
 * 用法：
 *   node tools/verify-kept-rate.mjs --base http://127.0.0.1:3190 [--days 3] [--target 0.7]
 *
 * 口径照抄 src/sim/commitments.ts（核对脚本不自创证据定义）：
 *   一条约定 = 同 id 的双方两行，按 id 去重成**一个裁决单位**；状态取双方一致的那个
 *   （状态不一致由 tools/verify-commitments.mjs 报，这里不重复判）。
 *   窗口 = 约定 dueTick 落在最近 --days 天里（[tick - days*1440, tick]）。
 *   裁决证据窗口 = [createdAtTick, dueTick + MISS_GRACE_TICKS]（判 missed 时它就封在 graceEnd，之后不再倒填）。
 *
 * 输出：
 *   window     {fromTick, toTick, days}
 *   counts     kept/missed/open/released，**按承诺 id 去重**（按行数算恒为 2 倍，所以另给 rows 做对照）
 *   keptRate   kept / (kept + missed)；没有已裁决的条时 null（"算不出来"不是 0）
 *   missedReasons  逐条 missed 的"为什么没成"＋ distribution
 *
 * 爽约原因只用快照里查得到的事实，四类（不新造码，与 tools/verify-with.mjs 的 no-overlap / place-mismatch 同族）：
 *   one-slept        一方在裁决窗口内**整段**在睡（sleep 活动 span 覆盖整个窗口）
 *   different-place  双方窗口内出现过的地点没有交集（人在不同地方，见不着）
 *   no-overlap       双方到过同一地点，但没有**时间重叠的会面（meet）**（都在场，没谈上；
 *                    facts.coPresent 说明是"没碰上"还是"同处一室却没触发 meet"）
 *   unknown          查不到：窗口起点早于活动环地平线（证据过期），或某方窗口内没有任何活动记录
 *   四类里没有"同处一室但两边都不是 meet"这个码：它归到 no-overlap（同地点的会面没有重叠），
 *   facts.coPresent 非空就说明是这种——要单独出码得先跟人确认（不擅自加概念）。
 *
 * 证据过期不算"没发生"（同 verify-with / verify-commitments 的 stale 纪律）：窗口没被活动环完整盖住就记
 * unknown，不拿看不见当否定结论。这条很要紧——活动环按每人 24 条留（sim/activity.ts），
 * 24 人时约一天，--days 3 的窗口后段才有活动可查。
 *
 * ok 判定：**只报告不改真相**——ok = keptRate 算得出来（!== null）。要判阈值必须显式传 --target 0.7；
 * 不传就不判（阈值随世界阶段变，写死在工具里就成了假标准）。
 *
 * 失败时 stderr 一行卡点（unreachable / no-commitments / no-settled / below-target），退出码 1。
 */

// [0] 参数：手写解析，不引依赖（与 tools/verify-commitments.mjs 同风格）
function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

const base = String(arg('base', 'http://127.0.0.1:3190')).replace(/\/+$/, '');
const days = Number(arg('days', 3));
if (!(Number.isInteger(days) && days > 0)) {
  console.error('--days 必须是正整数');
  process.exit(2);
}
const targetArg = arg('target', null);
const target = targetArg === null || targetArg === true ? null : Number(targetArg);
if (target !== null && !(Number.isFinite(target) && target >= 0 && target <= 1)) {
  console.error('--target 必须是 0..1 的数（不传就不判阈值）');
  process.exit(2);
}

// 镜像常量：src/sim/memory.ts 的 DAY_TICKS、src/sim/commitments.ts 的 MISS_GRACE_TICKS。
// 不 import 内核，是为了这个工具能脱离源码单独跑；口径变了要同步改这两行。
const DAY_TICKS = 1440;
const GRACE_TICKS = 180;
const REQUEST_MS = 8000;

// [1] 快照：世界只有 base 这一个出口；失败也要给明确 reason
let snapshot = null;
let fetchError = null;
try {
  const res = await fetch(base + '/agent-world/api/world', { signal: AbortSignal.timeout(REQUEST_MS) });
  if (!res.ok) throw new Error(base + '/agent-world/api/world → HTTP ' + res.status);
  snapshot = await res.json();
} catch (error) {
  fetchError = error.message;
}
const world = snapshot === null ? null : (snapshot.world ?? null);
const tick = world === null ? 0 : (world.tick ?? 0);

// [2] 活动：只留核对要用的形状。结束 tick 与 sim/activity.ts 的 spanOf 同口径——
//     还在进行的按"现在"截断，否则 active 的 endsAt 会把未来算成在场。
//     sleep 认两条来源：kind === 'sleep'（domain/types.ts 的 ActivityKind）或 purpose === 'sleep'
//     （sim/life.ts 的睡前活动落成 kind: 'rest' + purpose: 'sleep'）；meet 只认 kind（同 sharedMeet 口径）。
const activities = (world === null ? [] : world.activities ?? []).map((activity) => ({
  agentId: activity.agentId,
  placeId: activity.placeId,
  sleep: activity.kind === 'sleep' || activity.purpose === 'sleep',
  meet: activity.kind === 'meet',
  startedAt: activity.startedAt,
  endedAt: activity.status === 'active'
    ? Math.max(activity.startedAt, tick)
    : (activity.endedAt ?? activity.endsAt ?? activity.startedAt),
}));
const activitiesByAgent = new Map();
for (const activity of activities) {
  const rows = activitiesByAgent.get(activity.agentId) ?? [];
  rows.push(activity);
  activitiesByAgent.set(activity.agentId, rows);
}
// 证据地平线：某 agent 的活动环还看得见的最早 tick。没有活动 = 无地平线（null）。
const horizonOf = (agentId) => {
  const rows = activitiesByAgent.get(agentId) ?? [];
  return rows.length === 0
    ? null
    : rows.reduce((min, activity) => Math.min(min, activity.startedAt), Number.POSITIVE_INFINITY);
};
const activityFloor = activities.length === 0
  ? null
  : activities.reduce((min, activity) => Math.min(min, activity.startedAt), Number.POSITIVE_INFINITY);

// [3] 承诺：按 id 去重成"一条约定"（裁决的单位是约定，不是行）
const merged = new Map();
for (const agent of (world === null ? [] : world.agents ?? [])) {
  for (const row of agent.commitments ?? []) {
    const promise = merged.get(row.id) ?? {
      id: row.id,
      statuses: new Set(),
      parties: new Set(),
      from: Number.POSITIVE_INFINITY,
      due: Number.NEGATIVE_INFINITY,
      what: row.what ?? '',
    };
    promise.statuses.add(row.status);
    promise.parties.add(agent.id);
    promise.parties.add(row.with);
    // 窗口两端照 settleCommitments 的取法：from 取各行最小，due 取各行最大。
    promise.from = Math.min(promise.from, Number.isFinite(row.createdAtTick) ? row.createdAtTick : 0);
    promise.due = Math.max(promise.due, Number.isFinite(row.dueTick) ? row.dueTick : promise.from);
    merged.set(row.id, promise);
  }
}
const promises = [...merged.values()].map((promise) => {
  const parties = [...promise.parties].filter((id) => id !== '').sort();
  const statuses = [...promise.statuses].sort();
  return {
    id: promise.id,
    pair: [parties[0] ?? '', parties[1] ?? ''],
    statuses,
    status: statuses[0] ?? 'open',
    from: promise.from,
    due: promise.due,
    what: promise.what,
  };
});

// [4] 窗口 + 计数：只算 dueTick 落在窗口里的约定；计数按 id，不用行数
const fromTick = tick - days * DAY_TICKS;
const inWindow = promises.filter((promise) => promise.due >= fromTick && promise.due <= tick);
const counts = { kept: 0, missed: 0, open: 0, released: 0 };
for (const promise of inWindow) counts[promise.status] = (counts[promise.status] ?? 0) + 1;
const settled = counts.kept + counts.missed;
const keptRate = settled === 0 ? null : counts.kept / settled;
const windowIds = new Set(inWindow.map((promise) => promise.id));
const rows = (world === null ? [] : world.agents ?? [])
  .reduce((total, agent) => total + (agent.commitments ?? []).filter((row) => windowIds.has(row.id)).length, 0);

// [5] 爽约原因：先把活动裁到裁决窗口，再用四条事实判定（顺序 = 从最能定性的往最能兜底的走）
/** 该 agent 落在窗口内的活动片段（闭区间，按窗口截断）。 */
function spansIn(agentId, from, to) {
  const spans = [];
  for (const activity of activitiesByAgent.get(agentId) ?? []) {
    const start = Math.max(activity.startedAt, from);
    const end = Math.min(activity.endedAt, to);
    if (start <= end) spans.push({ start, end, placeId: activity.placeId, meet: activity.meet, sleep: activity.sleep });
  }
  return spans;
}

/** 合并成连续区间：间隔 ≤1 tick 视为接着（闭区间里 tick 之间没有空隙）。 */
function mergedCoverage(spans) {
  const sorted = [...spans].sort((left, right) => left.start - right.start);
  const covered = [];
  for (const span of sorted) {
    const last = covered[covered.length - 1];
    if (last === undefined || span.start > last[1] + 1) covered.push([span.start, span.end]);
    else last[1] = Math.max(last[1], span.end);
  }
  return covered;
}

/** span 集合是否**整段**覆盖窗口。 */
function coversWhole(spans, from, to) {
  const covered = mergedCoverage(spans);
  return covered.length === 1 && covered[0][0] <= from && covered[0][1] >= to;
}

function placesOf(spans) {
  return [...new Set(spans.map((span) => span.placeId))].sort();
}

/** 同地点、时间重叠的一对活动（任意 kind）——即"两人同时在同一处"。 */
function coPresent(first, second) {
  for (const one of first) {
    for (const other of second) {
      if (one.placeId !== other.placeId) continue;
      const start = Math.max(one.start, other.start);
      const end = Math.min(one.end, other.end);
      if (start <= end) return { placeId: one.placeId, span: [start, end] };
    }
  }
  return null;
}

/** 同地点、时间重叠的一对 meet 活动——这是 commitments.ts 的 sharedMeet 口径，有它就该判 kept。 */
function meetOverlap(first, second) {
  return coPresent(first.filter((span) => span.meet), second.filter((span) => span.meet));
}

function judge(promise) {
  const [first, second] = promise.pair;
  const from = promise.from;
  // 判 missed 时证据窗口封在 graceEnd，所以右端取 due + GRACE_TICKS（不拿裁决时刻倒填）。
  const to = Math.min(promise.due + GRACE_TICKS, tick);
  const horizon = { [first]: horizonOf(first), [second]: horizonOf(second) };
  const facts = { window: [from, to], horizon };

  // ① 证据过期：窗口起点早于任一方地平线 → 环里没有当时的活动，不能下否定结论
  if (horizon[first] === null || horizon[second] === null) {
    return { reason: 'unknown', why: 'no-activity-ever', facts };
  }
  if (from < Math.max(horizon[first], horizon[second])) {
    return { reason: 'unknown', why: 'blind', facts };
  }

  const mine = spansIn(first, from, to);
  const theirs = spansIn(second, from, to);
  facts.activities = { [first]: mine.length, [second]: theirs.length };

  // ② 整窗在睡：睡过去了，最直接的"为什么没成"
  for (const [who, spans] of [[first, mine], [second, theirs]]) {
    if (coversWhole(spans.filter((span) => span.sleep), from, to)) {
      return { reason: 'one-slept', who, facts };
    }
  }

  // ③ 某方窗口内没有任何活动记录：地理/睡眠都查不出来 → 不猜
  if (mine.length === 0 || theirs.length === 0) {
    return { reason: 'unknown', why: 'no-activity-in-window', who: mine.length === 0 ? first : second, facts };
  }

  // ④ 地点：有没有共同的 place；没有就是人在不同地方
  facts.places = { [first]: placesOf(mine), [second]: placesOf(theirs) };
  const shared = placesOf(mine).filter((placeId) => facts.places[second].includes(placeId));
  if (shared.length === 0) return { reason: 'different-place', facts };

  // ⑤ 同地点：缺的是"时间重叠的会面"。coPresent 说明是没碰上还是在场没谈，
  //    meetOverlap 若为真则裁决本身可疑（该判 kept），一并摆出来，不在这里改判。
  return {
    reason: 'no-overlap',
    facts: { ...facts, sharedPlaces: shared, coPresent: coPresent(mine, theirs), meetOverlap: meetOverlap(mine, theirs) },
  };
}

const distribution = { 'one-slept': 0, 'different-place': 0, 'no-overlap': 0, unknown: 0 };
const missed = [];
for (const promise of inWindow.filter((item) => item.status === 'missed')) {
  const judged = judge(promise);
  distribution[judged.reason] += 1;
  missed.push({
    id: promise.id,
    pair: promise.pair,
    what: promise.what,
    dueTick: promise.due,
    reason: judged.reason,
    ...(judged.who === undefined ? {} : { who: judged.who }),
    ...(judged.why === undefined ? {} : { why: judged.why }),
    facts: judged.facts,
  });
}
// 一条没核对到的"原因分布"没有信息量：不判失败，但必须说出来。
const unknownCount = distribution.unknown;
const unknownWhys = {};
for (const entry of missed) {
  if (entry.reason === 'unknown') unknownWhys[entry.why ?? 'unknown'] = (unknownWhys[entry.why ?? 'unknown'] ?? 0) + 1;
}

// [6] 判定 + 卡点
let reason = null;
if (world === null) reason = 'unreachable';
else if (inWindow.length === 0) reason = 'no-commitments';
else if (keptRate === null) reason = 'no-settled';
else if (target !== null && keptRate < target) reason = 'below-target';
const ok = reason === null;

const summary = {
  ok,
  ...(reason === null ? {} : { reason }),
  base,
  tick,
  window: { fromTick, toTick: tick, days },
  counts,
  rows,
  keptRate,
  ...(target === null ? {} : { target }),
  missedReasons: { distribution, entries: missed },
  coverage: { activityFloor, activities: activities.length },
  ...(fetchError === null ? {} : { fetchError }),
};
console.log(JSON.stringify(summary, null, 1));

if (!ok) {
  const stuck = (() => {
    if (reason === 'unreachable') return fetchError ?? base;
    if (reason === 'no-commitments') {
      return '窗口 ' + fromTick + '..' + tick + '（' + days + ' 天）内没有承诺；世界共 ' + promises.length + ' 条约定';
    }
    if (reason === 'no-settled') {
      return '窗口内 kept 0 / missed 0，算不出兑现率（open ' + counts.open + ' / released ' + counts.released + '）';
    }
    return 'keptRate ' + keptRate.toFixed(3) + ' < target ' + target
      + '（kept ' + counts.kept + ' / missed ' + counts.missed + '）';
  })();
  console.error('VERIFY FAIL ' + reason + ' · 卡在: ' + stuck + ' · base ' + base);
  if (fetchError !== null) console.error('最后错误: ' + fetchError);
  process.exit(1);
}
if (unknownCount > 0) {
  console.error('WARN ' + unknownCount + '/' + missed.length + ' 条 missed 的原因查不到（'
    + JSON.stringify(unknownWhys) + '；活动环地板 ' + activityFloor
    + ' —— 窗口早于它就是证据过期，不当成"没发生"）');
}
