#!/usr/bin/env node
/**
 * 验收：情节记忆里的"同行者"（episode.with）真有交互证据。**只读**——只 GET 快照；不写世界、不改代码、不启进程。
 *
 * 用法：
 *   node tools/verify-with.mjs --base http://127.0.0.1:3190 [--sample 10]
 *
 * 口径：一条 with 只有在"两个人在同一地点、时间段重叠、而且**双方都在社交活动里**"时才算有证据。
 * 社交活动 = Activity.kind === 'meet' || Activity.purpose === 'social'。
 *
 * 判定（ok = 两条全过）：
 *   1. 证据：每个 agent 最近 --sample 条 with 非空的情节，每条 with 都要在 world.activities 里找到配对活动；
 *      找不到的进 unproven，reason 说明差在哪一步。ok = unproven 为空 且 至少一条 proven。
 *   2. 收紧：breakdown.workWith（样本里 work/study 情节带 with 的条数）必须为 0——干活的人不是同行者。
 *      （样本内 workWith > 0 的条目必然同时进 unproven，所以不单独进 ok 判定。）
 *
 * 为什么有 stale：world.activities 是环形（sim/activity.ts 的 ACTIVITY_KEEP = 64 条已完成活动），
 * 老情节的活动早被挤掉了。那种记录不是"记忆错了"，是没有证据可查——记进 stale、不算失败，
 * 否则这个检查在任何长跑宿主上都必然红，红的原因不是记忆坏了而是证据过期了。
 *
 * 失败时 stderr 一行卡点（unreachable / no-episodes / no-recent-evidence / unproven），退出码 1。
 */

// [0] 参数：手写解析，不引依赖（与 tools/verify-tasks.mjs 同风格）
function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

const base = String(arg('base', 'http://127.0.0.1:3190')).replace(/\/+$/, '');
const sample = Number(arg('sample', 10));
if (!(Number.isInteger(sample) && sample > 0)) {
  console.error('--sample 必须是正整数');
  process.exit(2);
}

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

// [2] 活动：只留核对要用的形状。结束 tick 与 sim/memory.ts 的 spanOf 同口径——
//     还在进行的按"现在"截断，否则一条 active 活动的 endsAt 会把未来算成共处。
const isSocial = (activity) => activity.kind === 'meet' || activity.purpose === 'social';
const activities = (world === null ? [] : world.activities ?? []).map((activity) => ({
  agentId: activity.agentId,
  placeId: activity.placeId,
  kind: activity.kind,
  purpose: activity.purpose,
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
const windowStart = activities.length === 0 ? null : Math.min(...activities.map((activity) => activity.startedAt));
const windowEnd = activities.length === 0 ? null : Math.max(...activities.map((activity) => activity.endedAt));

// [3] 某一刻在某人、某地点的活动：闭区间，tick 落在 [startedAt, endedAt] 里。
//     情节的 tick 就是活动结束 tick，所以在场窗口天然包含它。
function windowsAt(agentId, placeId, at) {
  return (activitiesByAgent.get(agentId) ?? [])
    .filter((activity) => activity.placeId === placeId && activity.startedAt <= at && at <= activity.endedAt);
}

// R510-3 的闭区间重叠：同一 tick 结束和开始算碰过面。
function overlaps(a, b) {
  return Math.max(a.startedAt, b.startedAt) <= Math.min(a.endedAt, b.endedAt);
}

// [4] 一条 with（agent 对 peer）的证据判定。失败原因按"离证明最近"排序，报最靠前的那一个：
//     not-social：同地同时在，但有一方不是社交活动（旧的"同屋即同伴"口径就是栽在这里）
//     no-overlap / place-mismatch / no-peer-activity：peer 的活动在时间或地点上对不上
const REASON_ORDER = ['not-social', 'no-overlap', 'place-mismatch', 'no-peer-activity'];
function judgePeer(agentId, episode, peerId) {
  const mine = windowsAt(agentId, episode.placeId, episode.tick);
  if (mine.length === 0) return { stale: true };
  const theirs = activitiesByAgent.get(peerId) ?? [];
  const reasons = [];
  for (const own of mine) {
    const sameSpan = theirs.filter((activity) => overlaps(own, activity));
    const samePlace = sameSpan.filter((activity) => activity.placeId === own.placeId);
    if (isSocial(own) && samePlace.some(isSocial)) return { proven: true };
    if (samePlace.length > 0) reasons.push('not-social');
    else if (sameSpan.length > 0) reasons.push('place-mismatch');
    else if (theirs.some((activity) => activity.placeId === own.placeId)) reasons.push('no-overlap');
    else reasons.push('no-peer-activity');
  }
  return { reason: REASON_ORDER.find((code) => reasons.includes(code)) ?? 'no-peer-activity' };
}

// [5] 抽样：每个 agent 最近 --sample 条 with 非空的情节。
//     已没有证据的（活动被环形挤掉）记 stale 并跳过，不占抽样名额——否则老情节会把样本吃光。
const agents = (world === null ? [] : world.agents ?? []).map((agent) => ({
  id: agent.id,
  name: agent.name ?? agent.id,
  episodes: agent.episodes ?? [],
}));
const rows = [];
let stale = 0;
let claims = 0;
for (const agent of agents) {
  const claimed = agent.episodes
    .filter((episode) => Array.isArray(episode.with) && episode.with.length > 0)
    .sort((a, b) => b.tick - a.tick);
  claims += claimed.length;
  // 先按"自己的活动还在环里"筛一遍：没有证据的记 stale，剩下的才参与抽样。
  const checkable = claimed.filter((episode) => windowsAt(agent.id, episode.placeId, episode.tick).length > 0);
  stale += claimed.length - checkable.length;
  for (const episode of checkable.slice(0, sample)) {
    const judged = episode.with.map((peerId) => ({ peerId, ...judgePeer(agent.id, episode, peerId) }));
    rows.push({ agentId: agent.id, tick: episode.tick, kind: episode.kind, failing: judged.filter((row) => row.proven !== true) });
  }
}

// [6] 结果：没找到证据的"和谁"逐条列出；一行 = 一条 claim，with 是那个 peer id。
const unproven = rows.flatMap((row) => row.failing.map((claim) => ({
  agentId: row.agentId,
  tick: row.tick,
  with: claim.peerId,
  reason: claim.reason,
})));
const proven = rows.filter((row) => row.failing.length === 0).length;
// work/study 情节带 with 的条数：本轮要收紧到 0。socialWith 是同口径的正样本条数。
const breakdown = {
  workWith: rows.filter((row) => row.kind === 'work' || row.kind === 'study').length,
  socialWith: rows.filter((row) => row.kind === 'social' || row.kind === 'meet').length,
};

// [7] 判定 + 卡点
let reason = null;
if (world === null) reason = 'unreachable';
else if (claims === 0) reason = 'no-episodes';
else if (rows.length === 0) reason = 'no-recent-evidence';
else if (unproven.length > 0) reason = 'unproven';

const ok = reason === null;
const summary = {
  ok,
  ...(ok ? {} : { reason }),
  base,
  tick,
  sample,
  agents: agents.length,
  activities: activities.length,
  evidenceWindow: windowStart === null ? null : [windowStart, windowEnd],
  claims,
  sampled: rows.length,
  proven,
  unproven,
  breakdown,
  stale,
  ...(fetchError === null ? {} : { fetchError }),
};
console.log(JSON.stringify(summary, null, 1));

if (!ok) {
  const stuck = (() => {
    if (reason === 'unreachable') return fetchError ?? base;
    if (reason === 'no-episodes') return '没有任何 with 非空的情节';
    if (reason === 'no-recent-evidence') return '带 with 的情节 ' + claims + ' 条，活动环里 ' + activities.length
      + ' 条、证据窗口 ' + (windowStart === null ? '空' : windowStart + '..' + windowEnd) + '，一条都对不上';
    const head = unproven.slice(0, 8).map((row) => row.agentId + '@' + row.tick + '(with=' + row.with + ':' + row.reason + ')');
    return head.join(', ') + (unproven.length > head.length ? ' … 共 ' + unproven.length + ' 条，全量见 stdout 的 unproven' : '');
  })();
  console.error('VERIFY FAIL ' + reason + ' · 卡在: ' + stuck + ' · base ' + base);
  if (fetchError !== null) console.error('最后错误: ' + fetchError);
  process.exit(1);
}
