#!/usr/bin/env node
/**
 * 验收：承诺裁决（open/kept/missed/released）可不可信。**只读**——只 GET 快照；不写世界、不改代码、不启进程。
 *
 * 用法：
 *   node tools/verify-commitments.mjs --base http://127.0.0.1:3190 [--sample 10] [--seed 28490]
 *
 * 口径直接照抄 src/sim/commitments.ts（**核对脚本不许自创证据定义**，否则核的是自己）：
 *   窗口 = [from, dueTick]，from 取同 id 各行 createdAtTick 的最小值，dueTick 取最大值（双方应相同，取大兜底）；
 *   证据 = ① 任一方 episode.tick 落在窗口内且 episode.with 含对方；
 *          ② 两人在同一地点各有 kind === 'meet' 的活动、且区间重叠（区间与窗口求交）。
 *   —— 两条都没有才是 missed。所以 missed 的窗口里**不该**出现任何一条；kept 的窗口里**必须**至少有一条。
 *
 * 判定（ok = suspicious 为空，同 task-20 卡）：
 *   1. 分布：open/kept/missed/released 各多少，给两份——distribution 按 id（裁决的单位），
 *      distributionRows 按世界里的原始行（一条约定双方各存一行、共用 id，所以恒为 2 倍，两份都在免得对不上）。
 *   2. 抽样 missed：随机取 --sample 条，窗口内找到任何证据 → suspicious（该判 kept 却判了 missed）。
 *   3. 反向抽样 kept：随机取 --sample 条，窗口内找不到任何证据 → suspicious。
 *   4. ok = suspicious 为空；unreachable / no-commitments 给明确 reason。
 *
 * 留存决定哪条结论敢下（这是本脚本唯一需要动脑的地方）：
 *   两条证据通道的留存期不一样——episodes 留 7 天，activities 是环形（sim/activity.ts 的 ACTIVITY_KEEP = 64 条，
 *   9 个角色只够十几个小时）。于是：
 *   · 找到证据 = 真的发生过，不管落在哪条通道，直接算数（所以抽样不预先按留存筛掉任何一条）；
 *   · 没找到 = 只在该通道还看得见这个窗口时才敢下结论。
 *     - missed 的判据是"两条都没有"：episode 那一半（7 天）核过了；meet 那一半多半已经过期，
 *       这种记 checked 并把条数摆进 meetBlind，让"没交集"的结论有多硬一眼可见。
 *     - kept 的判据是"至少有一条"：没找到证据时，如果窗口早已滑出活动环，那它很可能就是被
 *       meet 通道证明过的（跨过 dueTick 的谈话，情节写在窗口之外，只有活动能证明），
 *       属于证据过期而不是裁决错了 → 记 stale、不判可疑。
 *
 * 正向的"找到证据"不受留存影响，所以陈旧世界也能核出真问题；反向的"没找到证据"才需要 stale 兜底。
 * 这也是 tools/verify-with.mjs 同一条理由：证据过期不算失败，否则这个检查在任何长跑宿主上都必然红。
 *
 * 已知盲区：kept 还有第二类证据 keepCommitment（显式说"我办到了"），但它生产零调用
 * （docs/AUDIT-REDUNDANCY.md B3），所以 kept 查不到证据按可疑处理，不拿它当挡箭牌。
 *
 * 失败时 stderr 一行卡点（unreachable / no-commitments / suspicious），退出码 1。
 */

// [0] 参数：手写解析，不引依赖（与 tools/verify-with.mjs 同风格）
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
const seedArg = arg('seed', null);
if (seedArg !== null && seedArg !== true && !Number.isInteger(Number(seedArg))) {
  console.error('--seed 必须是整数');
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
// 默认 seed 取当前 tick：每跑一次样本不同；要复现同一份样本，把 stdout 里的 seed 传回来。
const seed = Number(seedArg === null || seedArg === true ? tick : seedArg);

// [2] 证据源：episodes（7 天）与 activities（环形 64 条）。只留核对要用的形状。
const agents = (world === null ? [] : world.agents ?? []).map((agent) => ({
  id: agent.id,
  episodes: (agent.episodes ?? []).map((episode) => ({
    tick: episode.tick,
    with: Array.isArray(episode.with) ? episode.with : [],
  })),
  commitments: agent.commitments ?? [],
}));
const episodesByAgent = new Map(agents.map((agent) => [agent.id, agent.episodes]));

const activities = (world === null ? [] : world.activities ?? []).map((activity) => ({
  agentId: activity.agentId,
  placeId: activity.placeId,
  kind: activity.kind,
  startedAt: activity.startedAt,
  endedAt: activity.endedAt,
  endsAt: activity.endsAt,
  active: activity.status === 'active',
}));
// meet 通道只认 kind === 'meet'——与 commitments.ts 的 sharedMeet 同口径，不把 purpose === 'social' 的非 meet 活动算进来。
const meetsByAgent = new Map();
for (const activity of activities) {
  if (activity.kind !== 'meet') continue;
  const bucket = meetsByAgent.get(activity.agentId) ?? [];
  bucket.push(activity);
  meetsByAgent.set(activity.agentId, bucket);
}
// 证据留存的地板：比这更早的窗口查不了（不是裁决错，是证据过期）。
const episodeFloor = agents
  .flatMap((agent) => agent.episodes.map((episode) => episode.tick))
  .reduce((min, at) => Math.min(min, at), Number.POSITIVE_INFINITY);
const activityFloor = activities
  .reduce((min, activity) => Math.min(min, activity.startedAt), Number.POSITIVE_INFINITY);
const episodeFloorValue = Number.isFinite(episodeFloor) ? episodeFloor : null;
const activityFloorValue = Number.isFinite(activityFloor) ? activityFloor : null;

// [3] 证据判定：两条通道，与 commitments.ts 的 metInWindow 一一对应（顺序也一致：先 episode，再 meet）。
/** 活动占用的时间段；还在进行的按窗口右端截断（同 commitments.ts 的 spanOf）。 */
function spanOf(activity, windowEnd) {
  const start = activity.startedAt;
  const end = activity.endedAt ?? (activity.active ? windowEnd : activity.endsAt) ?? start;
  return [start, Math.max(start, end)];
}

/** ① 任一方窗口内的情节记忆带着对方。 */
function episodeHit(first, second, from, to) {
  for (const [ownerId, peerId] of [[first, second], [second, first]]) {
    const hit = (episodesByAgent.get(ownerId) ?? [])
      .find((episode) => episode.tick >= from && episode.tick <= to && episode.with.includes(peerId));
    if (hit !== undefined) return { via: 'episode-with', detail: ownerId + '@' + hit.tick };
  }
  return null;
}

/** ② 两人在同一地点各有 meet 活动且区间重叠（与窗口求交）。 */
function meetHit(first, second, from, to) {
  for (const one of meetsByAgent.get(first) ?? []) {
    const [oneFrom, oneTo] = spanOf(one, to);
    for (const other of meetsByAgent.get(second) ?? []) {
      if (other.placeId !== one.placeId) continue;
      const [twoFrom, twoTo] = spanOf(other, to);
      const overlapFrom = Math.max(oneFrom, twoFrom, from);
      const overlapTo = Math.min(oneTo, twoTo, to);
      if (overlapFrom <= overlapTo) return { via: 'meet-overlap', detail: one.placeId + ' ' + overlapFrom + '..' + overlapTo };
    }
  }
  return null;
}

function evidenceOf(first, second, from, to) {
  return episodeHit(first, second, from, to) ?? meetHit(first, second, from, to);
}

// [4] 承诺：按 id 去重成"一条约定"。状态不一致本身就是裁决不可信的信号（R497：裁决只有一种结果）。
const commitments = new Map();
const distributionRows = { open: 0, kept: 0, missed: 0, released: 0 };
for (const agent of agents) {
  for (const row of agent.commitments) {
    distributionRows[row.status] = (distributionRows[row.status] ?? 0) + 1;
    const merged = commitments.get(row.id) ?? {
      id: row.id,
      statuses: new Set(),
      parties: new Set(),
      from: Number.POSITIVE_INFINITY,
      to: Number.NEGATIVE_INFINITY,
    };
    merged.statuses.add(row.status);
    merged.parties.add(agent.id);
    merged.parties.add(row.with);
    // 窗口两端照 settleCommitments 的取法：from 取各行最小，to 取各行最大（正常数据里各行相同）。
    merged.from = Math.min(merged.from, Number.isFinite(row.createdAtTick) ? row.createdAtTick : 0);
    merged.to = Math.max(merged.to, Number.isFinite(row.dueTick) ? row.dueTick : merged.from);
    commitments.set(row.id, merged);
  }
}
const promises = [...commitments.values()].map((merged) => {
  const parties = [...merged.parties].sort();
  const statuses = [...merged.statuses].sort();
  return {
    id: merged.id,
    pair: [parties[0] ?? '', parties[1] ?? ''],
    status: statuses[0] ?? 'open',
    statuses,
    from: merged.from,
    to: merged.to,
  };
});

const distribution = { open: 0, kept: 0, missed: 0, released: 0 };
for (const promise of promises) distribution[promise.status] = (distribution[promise.status] ?? 0) + 1;

// [5] 抽样：已裁决的全部参与，按稳定哈希取 --sample 条。
//     不在抽样前筛留存——筛了就会把"窗口起点早、但窗口里真有证据"的条当过期跳过（白丢一条正证据）；
//     留存只在 [6] 判"没找到证据"这类否定结论时才说话。
function episodeCovered(promise) {
  return episodeFloorValue !== null && promise.from >= episodeFloorValue;
}
// 窗口早于活动环 → meet 通道在这条上已经看不见了，只能由 episode 通道作证。
function meetChannelBlind(promise) {
  return activityFloorValue === null || promise.from < activityFloorValue;
}
// 稳定哈希（FNV-1a 32 位）当抽样器：同一 seed + 同一 id 永远挑同一批，复核时不用重跑整轮。
function fnv32(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
function drawOf(status) {
  // 状态不一致的条已经由 status-mismatch 报过，不再进样本（它的"状态"本来就不成立）。
  const settled = promises.filter((promise) => promise.status === status && promise.statuses.length === 1);
  const chosen = settled
    .map((promise) => ({ promise, order: fnv32(seed + '|' + promise.id) }))
    .sort((left, right) => left.order - right.order)
    .slice(0, sample)
    .map((entry) => entry.promise);
  return { settled: settled.length, chosen };
}
const missedDraw = drawOf('missed');
const keptDraw = drawOf('kept');

// [6] 核对：missed 窗口里不许有证据；kept 窗口里必须有。逐条留证，suspicious 只列出来，不猜原因。
const suspicious = [];
// 全局不变量：同 id 的双方行状态必须一致（R497：一个约定只有一种结果）。
for (const promise of promises) {
  if (promise.statuses.length > 1) {
    suspicious.push({
      id: promise.id,
      status: promise.statuses.join('|'),
      reason: 'status-mismatch(同 id 的双方行状态不一致)',
    });
  }
}

// 没找到证据的条要判"敢不敢下否定结论"，结论撑不住的记 stale（证据过期，不是裁决错）。
let stale = 0;
let missedChecked = 0;
// 计入 missedChecked 里、窗口早于活动环的条数："没有交集"这个结论只由 episode 通道支撑。
let meetBlind = 0;

for (const promise of missedDraw.chosen) {
  const hit = evidenceOf(promise.pair[0], promise.pair[1], promise.from, promise.to);
  if (hit !== null) {
    suspicious.push({ id: promise.id, status: 'missed', reason: 'has-' + hit.via + '(' + hit.detail + ')' });
    continue;
  }
  // 判 missed 靠"两条都没有"：episode 那一半过期了，就不知道当时到底有没有交集。
  if (!episodeCovered(promise)) {
    stale += 1;
    continue;
  }
  missedChecked += 1;
  if (meetChannelBlind(promise)) meetBlind += 1;
}

let keptChecked = 0;
for (const promise of keptDraw.chosen) {
  const hit = evidenceOf(promise.pair[0], promise.pair[1], promise.from, promise.to);
  if (hit !== null) {
    keptChecked += 1;
    continue;
  }
  // 判 kept 靠"至少有一条"。没找到证据而通道又过期时，它很可能就是被那条通道证明过的
  // （跨 dueTick 的谈话没有窗口内的情节、只有活动能证明）——证据过期，不判可疑。
  if (!episodeCovered(promise) || meetChannelBlind(promise)) {
    stale += 1;
    continue;
  }
  suspicious.push({
    id: promise.id,
    status: 'kept',
    reason: 'kept-without-evidence(' + promise.from + '..' + promise.to + ')',
  });
}

// [7] 判定 + 卡点
let reason = null;
if (world === null) reason = 'unreachable';
else if (promises.length === 0) reason = 'no-commitments';
else if (suspicious.length > 0) reason = 'suspicious';
const ok = reason === null;
// 一条都没核对到的"通过"没有信息量：不判失败（ok 只看 suspicious），但必须说出来。
const unchecked = missedChecked + keptChecked === 0;

const summary = {
  ok,
  ...(reason === null ? {} : { reason }),
  base,
  tick,
  seed,
  sample,
  agents: agents.length,
  commitments: promises.length,
  distribution,
  distributionRows,
  missedChecked,
  keptChecked,
  stale,
  meetBlind,
  coverage: { episodeFloor: episodeFloorValue, activityFloor: activityFloorValue },
  suspicious,
  ...(unchecked ? { note: 'no-checkable' } : {}),
  ...(fetchError === null ? {} : { fetchError }),
};
console.log(JSON.stringify(summary, null, 1));

if (!ok) {
  const stuck = (() => {
    if (reason === 'unreachable') return fetchError ?? base;
    if (reason === 'no-commitments') return '世界里有 ' + agents.length + ' 个角色，但没有一条承诺';
    const head = suspicious.slice(0, 8).map((item) => item.id + '(' + item.status + ':' + item.reason + ')');
    return head.join(', ') + (suspicious.length > head.length ? ' … 共 ' + suspicious.length + ' 条，全量见 stdout 的 suspicious' : '');
  })();
  console.error('VERIFY FAIL ' + reason + ' · 卡在: ' + stuck + ' · base ' + base);
  if (fetchError !== null) console.error('最后错误: ' + fetchError);
  process.exit(1);
}
if (unchecked) {
  console.error('WARN 一条也没核对到：missed ' + missedDraw.settled + ' / kept ' + keptDraw.settled + ' 条样本里，'
    + '没找到证据的都缺留存覆盖（episode 地板 ' + episodeFloorValue + '、活动环地板 ' + activityFloorValue
    + '），stale ' + stale + ' 条');
}
