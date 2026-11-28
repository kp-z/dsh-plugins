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
 *      ——前提是"证据地平线"还够得着：claim 的 tick 早于任一方活动环的最早 tick 时，环里已经没有当时的活动，
 *      只能记 stale（证据过期），不能当成"没见面"。所以 unproven 只收"环里看得见、但对不上"的条。
 *   2. 收紧：breakdown.workWith（样本里 work/study 情节带 with 的条数）必须为 0——干活的人不是同行者。
 *      （样本内 workWith > 0 的条目必然同时进 unproven，所以不单独进 ok 判定。）
 *
 * 为什么有 stale：world.activities 是环形（sim/activity.ts 的 ACTIVITY_KEEP 家族——**镜像常量**：
 *   每 agent 留 24 条、下限 64 条，即上限 = max(64, 24 × 人数)，24 人时 576 条。
 *   这里不 import 内核常量，是为了这个工具能脱离源码单独跑；口径变了要同步改这行注释），
 * 老情节的活动早被挤掉了。那种记录不是"记忆错了"，是没有证据可查——记进 stale、不算失败，
 * 否则这个检查在任何长跑宿主上都必然红，红的原因不是记忆坏了而是证据过期了。
 *
 * 过期要**两边都看**（H18 现场踩的坑）：旧版只问"我自己那条活动还在不在"，对手那条被挤掉时，
 * 一旦自己的活动还在环里，就会被记成 no-overlap——那是拿"看不见"当"没见面"，把证据过期说成记忆撒谎。
 * 现在先算双方各自的地平线（该 agent 现存活动的最小 startedAt；没有活动 = 无地平线，任何 tick 都不过期），
 * claim 的 tick **严格小于**任一方地平线就记 stale，并带上 side（agent / peer / both）与两边地平线数字。
 * 与 tools/verify-commitments.mjs 的 stale 同源：窗口早已滑出活动环时，"没找到证据"撑不起否定结论；
 * 那边把同一理由用在承诺裁决的 meet 通道盲区（meetBlind）上，这边用在同行者的活动通道上。
 *
 * stale 的粒度与 unproven 一致：一条 with 声明（claim × peer）一条，所以 stale.count 不是情节条数。
 *
 * 失败时 stderr 一行卡点（unreachable / no-episodes / no-recent-evidence / unproven），退出码 1。
 */

import { arg, baseUrl, failVerify, getJson } from './lib/cli.mjs';

// [0] 参数：解析与 base 归一化在 tools/lib/cli.mjs（各脚本共用一份，纯 .mjs 不经构建）
const base = baseUrl();
const sample = Number(arg('sample', 10));
if (!(Number.isInteger(sample) && sample > 0)) {
  console.error('--sample 必须是正整数');
  process.exit(2);
}

const REQUEST_MS = 8000;

// [1] 快照：世界只有 base 这一个出口；失败也要给明确 reason
let world = null;
let fetchError = null;
try {
  world = (await getJson(base + '/agent-world/api/world', REQUEST_MS)).world ?? null;
} catch (error) {
  fetchError = error.message;
}
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

// [4] 证据地平线：某 agent 的活动环还看得见的最早 tick。没有活动 = 无地平线（null），
//     任何 tick 都不能拿"过期"当挡箭牌——那时候这条通道根本没记录，不是记录过期。
const horizonOf = (agentId) => {
  const rows = activitiesByAgent.get(agentId) ?? [];
  return rows.length === 0
    ? null
    : rows.reduce((min, activity) => Math.min(min, activity.startedAt), Number.POSITIVE_INFINITY);
};

// [5] 一条 with（agent 对 peer）的证据判定：先判过期，再判对不上。
//     过期：claim 的 tick 严格小于任一方地平线 → stale（证据已过期，不敢下否定结论），带上是哪一方、两边地平线多少。
//     对不上（按"离证明最近"排序，报最靠前的那一个）：
//     not-social：同地同时在，但有一方不是社交活动（旧的"同屋即同伴"口径就是栽在这里）
//     no-overlap / place-mismatch / no-peer-activity：peer 的活动在时间或地点上对不上
const REASON_ORDER = ['not-social', 'no-overlap', 'place-mismatch', 'no-peer-activity'];
function judgePeer(agentId, episode, peerId) {
  const horizon = { agent: horizonOf(agentId), peer: horizonOf(peerId) };
  // 严格小于：tick 正好等于地平线时，环里那条活动还在（窗口是闭区间，见 [3]）。
  const ownExpired = horizon.agent !== null && episode.tick < horizon.agent;
  const peerExpired = horizon.peer !== null && episode.tick < horizon.peer;
  if (ownExpired || peerExpired) {
    const side = ownExpired ? (peerExpired ? 'both' : 'agent') : 'peer';
    return { stale: true, side, horizon };
  }
  const mine = windowsAt(agentId, episode.placeId, episode.tick);
  // 自己的环覆盖了这个 tick，却拿不到"自己在这个地点"的活动：地点和自己的活动记录对不上。
  // 这既不是过期（环看得见），也不是 peer 的错，沿用同族原因码 place-mismatch，不新造码。
  if (mine.length === 0) return { reason: 'place-mismatch' };
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

// [6] 抽样：每个 agent 最近 --sample 条 with 非空的情节。
//     先逐对判过期：一条 claim 的每个 peer 都过期，说明这条情节当时根本没证据可查 → 进 stale、不占抽样名额，
//     否则老情节会把样本吃光（长跑世界里 claims 远多于 --sample）。
//     部分 peer 过期的仍参与抽样：过期那几条单独进 stale、不算 unproven，剩下的 peer 该证就证、该报就报。
const agents = (world === null ? [] : world.agents ?? []).map((agent) => ({
  id: agent.id,
  name: agent.name ?? agent.id,
  episodes: agent.episodes ?? [],
}));
const rows = [];
const stale = [];
let claims = 0;
for (const agent of agents) {
  const claimed = agent.episodes
    .filter((episode) => Array.isArray(episode.with) && episode.with.length > 0)
    .sort((a, b) => b.tick - a.tick);
  claims += claimed.length;
  const judged = claimed.map((episode) => ({
    episode,
    peers: episode.with.map((peerId) => ({ peerId, ...judgePeer(agent.id, episode, peerId) })),
  }));
  for (const claim of judged) {
    for (const peer of claim.peers) {
      if (peer.stale !== true) continue;
      stale.push({
        agentId: agent.id,
        tick: claim.episode.tick,
        with: peer.peerId,
        side: peer.side,
        horizon: peer.horizon,
      });
    }
  }
  const checkable = judged.filter((claim) => claim.peers.some((peer) => peer.stale !== true));
  for (const claim of checkable.slice(0, sample)) {
    rows.push({
      agentId: agent.id,
      tick: claim.episode.tick,
      kind: claim.episode.kind,
      failing: claim.peers.filter((peer) => peer.proven !== true && peer.stale !== true),
    });
  }
}

// [7] 结果：没找到证据的"和谁"逐条列出；一行 = 一条 claim，with 是那个 peer id。
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
// 过期的条逐条摆出来会淹没真正的结论（24 人长跑下上千条），所以按"过期在哪一方"聚合，
// 再给最多 5 条样本带上两边的地平线数字——复核时照着数字回环里查就行。
const staleBySide = { agent: 0, peer: 0, both: 0 };
for (const claim of stale) staleBySide[claim.side] += 1;
const staleReport = { count: stale.length, bySide: staleBySide, samples: stale.slice(0, 5) };

// [8] 判定 + 卡点
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
  stale: staleReport,
  ...(fetchError === null ? {} : { fetchError }),
};
console.log(JSON.stringify(summary, null, 1));

if (!ok) {
  const stuck = (() => {
    if (reason === 'unreachable') return fetchError ?? base;
    if (reason === 'no-episodes') return '没有任何 with 非空的情节';
    // 全过期也会落到这里：这时"一条都对不上"是假象，直接把过期条数摆出来。
    if (reason === 'no-recent-evidence') return '带 with 的情节 ' + claims + ' 条（其中 stale ' + stale.length
      + ' 条，可核的 0 条），活动环里 ' + activities.length
      + ' 条、证据窗口 ' + (windowStart === null ? '空' : windowStart + '..' + windowEnd);
    const head = unproven.slice(0, 8).map((row) => row.agentId + '@' + row.tick + '(with=' + row.with + ':' + row.reason + ')');
    return head.join(', ') + (unproven.length > head.length ? ' … 共 ' + unproven.length + ' 条，全量见 stdout 的 unproven' : '');
  })();
  failVerify(reason, { stuck, base, error: fetchError });
}
