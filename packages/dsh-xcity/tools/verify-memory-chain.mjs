#!/usr/bin/env node
/**
 * H7 验收：三日记忆链真的成立。**只读**——只 GET 快照、只顺序读事件流；不写世界、不改代码、不启进程。
 *
 * 用法：
 *   node tools/verify-memory-chain.mjs --base http://127.0.0.1:3190 --days 3
 *   node tools/verify-memory-chain.mjs --base ... --days 3 --sample 10 --state .testhome/profiles/xcity-3/state
 *
 * 判定（ok = 三条全过）：
 *   [1] 日小结：每个 agent 都要有 D1..D{days} 各一条 kind==='day' 的情节；同一天出现两条也算不合格。
 *   [2] 抽查：每个 agent 随机取 --sample 条非 day 情节，每条都要对得上一份证据——
 *       world.activities 里**同角色、同 kind、tick 落在活动区间内**的活动，
 *       或当前世代事件流里**同角色、±2 tick** 的真实事件。
 *       对不上的进 mismatches（活动环形只留最近 64 条，所以老情节主要靠事件流旁证）。
 *   [3] 承诺：status 分布里至少一条 kept、一条 missed——"兑现/违约都有记录"。
 * 失败时 stderr 一行卡点（unreachable / no-agents / no-events / digest-missing / mismatch / no-kept / no-missed），退出码 1。
 *
 * --state 缺省 ../profiles/xcity-3/state；该目录不存在时退回 <cwd>/.testhome/profiles/xcity-3/state。
 * --seed 只影响抽样（缺省 1），同 seed 同快照必得同一批样本，review 时能复现。
 */

import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { arg, baseUrl, failVerify, getJson } from './lib/cli.mjs';

// [0] 参数：解析与 base 归一化在 tools/lib/cli.mjs（各脚本共用一份，纯 .mjs 不经构建）
const base = baseUrl();
const days = Number(arg('days', 3));
const sample = Number(arg('sample', 10));
const seed = Number(arg('seed', 1));
for (const [flag, value] of [['--days', days], ['--sample', sample]]) {
  if (!(Number.isInteger(value) && value > 0)) {
    console.error(flag + ' 必须是正整数');
    process.exit(2);
  }
}
if (!Number.isFinite(seed)) {
  console.error('--seed 必须是数字');
  process.exit(2);
}

const stateArg = arg('state', null);
const stateCandidates = stateArg === null
  ? [resolve(process.cwd(), '../profiles/xcity-3/state'), resolve(process.cwd(), '.testhome/profiles/xcity-3/state')]
  : [resolve(process.cwd(), String(stateArg))];
const stateDir = stateCandidates.find((dir) => existsSync(dir)) ?? stateCandidates[0];
const eventsFile = resolve(stateDir, 'events.jsonl');

const DAY_TICKS = 1440;
const REQUEST_MS = 8000;
// 证据容差：情节 tick 就是活动结束 tick，留 2 tick 容纳"落盘前一拍"的事件。
const EVENT_SLACK = 2;
// 事件流里每个世代都以 seq=1/tick=0 开场（一次 world.reset 就换一代）；只认最后一代。
const SUBSTANTIVE = new Set([
  'agent.state', 'agent.intent', 'agent.initiative', 'agent.affinity',
  'task.completed', 'task.assigned', 'message.sent',
]);

const dayOf = (tick) => Math.floor(Math.max(0, tick) / DAY_TICKS) + 1;

// [0.1] 抽样用的确定性 PRNG（mulberry32）：同一 seed 复现同一批样本
function makeRandom(initial) {
  let state = initial >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = makeRandom(seed);

function pickSome(rows, count) {
  const pool = [...rows];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

// [1] 快照：世界只有 base 这一个出口
let world = null;
let fetchError = null;
try {
  world = (await getJson(base + '/agent-world/api/world', REQUEST_MS)).world ?? null;
} catch (error) {
  fetchError = error.message;
}
const agents = (world === null ? [] : world.agents ?? []).map((agent) => ({
  id: agent.id,
  name: agent.name ?? agent.id,
  episodes: agent.episodes ?? [],
  commitments: agent.commitments ?? [],
}));

// [2] 日小结：**最近 days 天**一天一条。
//
// ⚠️ 不能写死 D1..D{days}：情节记忆只保留最近 7 天（sim/memory.ts 的 EPISODE_KEEP_DAYS），
// 宿主跑到第 11 天时 D1 早被裁掉，那样这条检查在任何长期运行的宿主上必然红——
// 红的原因不是记忆坏了，而是检查的坐标错了。窗口末端取"世界当前天"。
const digestRows = agents.map((agent) => {
  const byDay = new Map();
  for (const episode of agent.episodes) {
    if (episode.kind !== 'day') continue;
    byDay.set(episode.day, (byDay.get(episode.day) ?? 0) + 1);
  }
  const missing = [];
  const duplicates = [];
  // 只要求**已经过完**的天：第 N 天的日小结是在第 N+1 天 00:00 写的，
  // 所以窗口末端取"昨天"（当前天 - 1），否则每次都会把还没结束的今天算成缺失。
  const today = world === null ? days : Math.floor((world.tick ?? 0) / 1440) + 1;
  const windowEnd = Math.max(1, today - 1);
  const windowStart = Math.max(1, windowEnd - days + 1);
  for (let day = windowStart; day <= windowEnd; day += 1) {
    const count = byDay.get(day) ?? 0;
    if (count === 0) missing.push(day);
    else if (count > 1) duplicates.push(day);
  }
  return {
    agentId: agent.id,
    name: agent.name,
    have: [...byDay.keys()].sort((a, b) => a - b),
    window: [windowStart, windowEnd],
    missing,
    duplicates,
  };
});
const digestsOk = digestRows.length > 0 && digestRows.every((row) => row.missing.length === 0 && row.duplicates.length === 0);

// [3] 活动证据：同角色 + 同 kind + tick 落在 [startedAt, endedAt]
const ACTIVITY_SLACK = 1;
const activitiesByAgent = new Map();
for (const activity of (world === null ? [] : world.activities ?? [])) {
  const rows = activitiesByAgent.get(activity.agentId) ?? [];
  const end = activity.endedAt ?? activity.endsAt;
  rows.push({
    kind: activity.purpose ?? activity.kind,
    startedAt: activity.startedAt,
    endedAt: end,
    status: activity.status,
  });
  activitiesByAgent.set(activity.agentId, rows);
}

function activityEvidence(agentId, episode) {
  for (const activity of activitiesByAgent.get(agentId) ?? []) {
    if (activity.kind !== episode.kind) continue;
    const inside = activity.startedAt <= episode.tick && episode.tick <= activity.endedAt;
    const atEnd = Math.abs(activity.endedAt - episode.tick) <= ACTIVITY_SLACK;
    if (inside || atEnd) {
      return activity.status === 'active'
        ? 'activity-window:' + activity.kind + '@' + activity.startedAt
        : 'activity-end:' + activity.kind + '@' + activity.endedAt;
    }
  }
  return null;
}

// [4] 事件证据：流式读 events.jsonl，只保留最后一代、只留同角色可归因的事件
function agentIdsOf(event) {
  const payload = event.payload ?? {};
  switch (event.type) {
    case 'agent.state': return [payload.id];
    case 'agent.intent': case 'agent.initiative': case 'agent.affinity': return [payload.agentId];
    case 'task.completed': return [payload.agentId];
    case 'task.assigned': return [payload.owner];
    case 'message.sent': return [payload.from, payload.to];
    default: return [];
  }
}

async function readEvents(file) {
  const index = new Map();
  const stats = { file, ok: false, error: null, lines: 0, badLines: 0, kept: 0, generations: 0, tickRange: null };
  let tickMin = Infinity;
  let tickMax = -1;
  try {
    const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of reader) {
      if (line === '') continue;
      stats.lines += 1;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        stats.badLines += 1;
        continue;
      }
      if (event.type === 'world.reset' || (event.seq === 1 && event.tick === 0)) {
        index.clear();
        stats.generations += 1;
        stats.kept = 0;
        tickMin = Infinity;
        tickMax = -1;
      }
      if (!SUBSTANTIVE.has(event.type)) continue;
      const ids = agentIdsOf(event).filter((id) => typeof id === 'string' && id !== '');
      if (ids.length === 0) continue;
      for (const id of ids) {
        let byTick = index.get(id);
        if (byTick === undefined) {
          byTick = new Map();
          index.set(id, byTick);
        }
        const types = byTick.get(event.tick) ?? [];
        if (!types.includes(event.type)) types.push(event.type);
        byTick.set(event.tick, types);
      }
      stats.kept += 1;
      if (event.tick < tickMin) tickMin = event.tick;
      if (event.tick > tickMax) tickMax = event.tick;
    }
    stats.ok = true;
  } catch (error) {
    stats.error = error.message;
  }
  stats.tickRange = tickMax < 0 ? null : [tickMin, tickMax];
  return { index, stats };
}

const events = await readEvents(eventsFile);

function eventEvidence(agentId, tick) {
  const byTick = events.index.get(agentId);
  if (byTick === undefined) return null;
  for (let delta = 0; delta <= EVENT_SLACK; delta += 1) {
    for (const at of delta === 0 ? [tick] : [tick - delta, tick + delta]) {
      const types = byTick.get(at);
      if (types === undefined) continue;
      return 'event:' + types[0] + '@' + at + (at === tick ? '' : ' (Δ' + String(at - tick) + ')');
    }
  }
  return null;
}

// [5] 抽查：每个 agent 随机取 --sample 条非 day 情节，逐条找证据
const samples = [];
const mismatches = [];
for (const agent of agents) {
  const pool = agent.episodes.filter((episode) => episode.kind !== 'day');
  for (const episode of pickSome(pool, sample)) {
    const evidence = activityEvidence(agent.id, episode) ?? eventEvidence(agent.id, episode.tick);
    const row = {
      agentId: agent.id,
      name: agent.name,
      day: episode.day,
      tick: episode.tick,
      kind: episode.kind,
      summary: episode.summary,
      evidence,
      spotInEventGen: (events.stats.tickRange !== null)
        && episode.tick >= events.stats.tickRange[0] && episode.tick <= events.stats.tickRange[1],
    };
    samples.push(row);
    if (evidence === null) mismatches.push(row);
  }
}

// [6] 承诺：status 分布 + kept/missed 都要有
const byStatus = { open: 0, kept: 0, missed: 0, released: 0 };
for (const agent of agents) {
  for (const commitment of agent.commitments) byStatus[commitment.status] = (byStatus[commitment.status] ?? 0) + 1;
}
const promisesOk = byStatus.kept >= 1 && byStatus.missed >= 1;

// [7] 判定 + 卡点
let reason = null;
if (world === null) reason = 'unreachable';
else if (agents.length === 0) reason = 'no-agents';
else if (!events.stats.ok) reason = 'no-events';
else if (!digestsOk) reason = 'digest-missing';
else if (mismatches.length > 0) reason = 'mismatch';
else if (byStatus.kept < 1) reason = 'no-kept';
else if (byStatus.missed < 1) reason = 'no-missed';

const ok = reason === null;
const summary = {
  ok,
  ...(ok ? {} : { reason }),
  base,
  days,
  sample,
  seed,
  tick: world === null ? null : world.tick,
  day: world === null ? null : dayOf(world.tick),
  digests: {
    ok: digestsOk,
    perAgent: digestRows,
  },
  samples: {
    total: samples.length,
    matched: samples.length - mismatches.length,
    mismatches,
    rows: samples,
  },
  promises: {
    ok: promisesOk,
    byStatus,
  },
  events: {
    ...events.stats,
    agentsIndexed: events.index.size,
  },
  ...(fetchError === null ? {} : { fetchError }),
};
console.log(JSON.stringify(summary, null, 1));

if (!ok) {
  const stuck = (() => {
    if (reason === 'unreachable') return fetchError ?? base;
    if (reason === 'no-events') return eventsFile + (events.stats.error === null ? '' : ' · ' + events.stats.error);
    if (reason === 'digest-missing') return digestRows.map((row) => row.agentId + ' 缺 D' + row.missing.join(',D')).join(' · ');
    if (reason === 'mismatch') return mismatches.map((row) => row.agentId + '@' + row.tick + '(' + row.kind + ')').join(', ');
    if (reason === 'no-kept') return 'kept=0';
    if (reason === 'no-missed') return 'missed=0';
    return '-';
  })();
  failVerify(reason, { stuck, base, tail: ' · state ' + stateDir, error: fetchError });
}
