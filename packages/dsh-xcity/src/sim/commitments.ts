/**
 * R497：承诺的生命周期。
 *
 * 为什么要有它：角色在每日计划（R500）里会说"下午三点找 b 看片"这类话。只写进 prompt，
 * 明天就没人替"说了没做"负责——情节记忆是散文，承诺必须有到期与裁决。
 *
 * 三条纪律：
 * 1. 一个约定在**双方各存一条**（with 指向对方），共用同一个 id；裁决只有一种结果，不是各判各的；
 * 2. 裁决只认**已经发生的事实**：窗口内和对方有交集（episode.with 含对方，或两人同地点的 meet 活动
 *    时间重叠），或有人显式调过 keepCommitment。不推断、不补写证据；
 * 3. 不新增类型字段：状态全用 Commitment.status（domain/types.ts 里已有）。
 *
 * 纯函数：不碰 IO、不读时钟（nowTick 由调用方给），就地改传入的 world 并返回裁决结果。
 */
import type { Activity, Agent, Commitment, CommitmentStatus, World } from '../domain/types.js'
import { appendEpisode, DAY_TICKS, dayOf } from './memory.js'

/** 每人同时 open 的承诺上限。超出时最旧的一条转 released——被挤掉不算违约。 */
export const OPEN_MAX = 3
/**
 * R513 失约宽限（游戏分钟）：到期**没找到证据**不判 missed，再等到 dueTick + 这个值。
 *
 * 理由是"没证据 ≠ 失约"：H10 收紧 episode.with 之后，missed 从 2 涨到 20，其中多数只是
 * 证据没落地（人可能过了点才碰上，episode/meet 也可能晚一步才写进 world），不是真的爽约。
 * 取值 180（≈3 小时）：够覆盖一个上午/下午的连续活动时段，迟到的碰面还能被同一时段的
 * meet 记到；又明显小于一个游戏日（DAY_TICKS=1440），前一天的承诺不会拖到第二天才判。
 */
export const MISS_GRACE_TICKS = 180
/** 已裁决的承诺留几天（与情节记忆同窗口）；只留最近，避免 world.json 无限长。 */
export const SETTLED_KEEP_DAYS = 7

/**
 * 稳定 id：同一对当事人、同一天、同一件事 → 同一个 id。
 *
 * 不含随机、不含当前 tick，所以重复解析同一份计划不会写出第二条（幂等靠它，不靠额外去重表）。
 * 当事人顺序无关：(a,b) 与 (b,a) 得到同一个 id。
 */
export function commitmentId(a: string, b: string, what: string, day: number): string {
  const pair = a < b ? a + '-' + b : b + '-' + a
  return 'cmt-' + String(day) + '-' + pair + '-' + hash36(what)
}

/** FNV-1a 32 位，base36。只为把 what 压成短串，不做安全用途。 */
function hash36(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

export interface PromiseInput {
  /** 答应了什么（一句话）。空串不写。 */
  what: string
  /** 绝对 tick。必须是将来——已经过去的约定没有意义。 */
  dueTick: number
  /** 谁提的；缺省 plan（每日计划是主入口，玩家/角色自己开口时显式传）。 */
  source?: Commitment['source']
}

export interface PromiseWritten {
  id: string
  /** 发起方这条（with 指向对方）。 */
  mine: Commitment
  /** 对方那条（with 指向发起方）。 */
  theirs: Commitment
}

/**
 * R497：写下一个约定，双方各一条。
 *
 * 幂等：同一天同一件事已写过就返回已有的两条，不重复写。
 * 非法输入（空 what、a === b、当事人不存在、dueTick 不在将来）返回 null，不写半条。
 */
export function promiseBetween(world: World, a: string, b: string, input: PromiseInput): PromiseWritten | null {
  const what = input.what.trim()
  const dueTick = Math.floor(input.dueTick)
  if (what === '' || a === b) return null
  if (!Number.isFinite(dueTick) || dueTick <= world.tick) return null
  const first = world.agents.find((agent) => agent.id === a)
  const second = world.agents.find((agent) => agent.id === b)
  if (first === undefined || second === undefined) return null

  const id = commitmentId(a, b, what, dayOf(world.tick))
  const existingMine = rowOf(first, id)
  const existingTheirs = rowOf(second, id)
  if (existingMine === undefined) {
    const row: Commitment = {
      id,
      with: b,
      what,
      dueTick,
      status: 'open',
      source: input.source ?? 'plan',
      createdAtTick: world.tick,
    }
    first.commitments = [...(first.commitments ?? []), row]
  }
  if (existingTheirs === undefined) {
    const row: Commitment = {
      id,
      with: a,
      what,
      dueTick,
      status: 'open',
      source: input.source ?? 'plan',
      createdAtTick: world.tick,
    }
    second.commitments = [...(second.commitments ?? []), row]
  }

  // 上限：先写后挤，保证"每人 open ≤3"对外恒成立。
  enforceOpenMax(world, a)
  enforceOpenMax(world, b)

  const mine = rowOf(first, id)
  const theirs = rowOf(second, id)
  if (mine === undefined || theirs === undefined) return null
  return { id, mine, theirs }
}

/**
 * R497：显式说"我办到了"。这是第二类证据：没有可观察的交集时，由调用方（玩家确认、
 * 角色自己汇报）给出的事实。立刻把双方两条一起标 kept——约定是共同的，只有一种结果。
 *
 * 返回是否真的改了状态（已经 kept/released 的返回 false，重复调用安全）。
 */
export function keepCommitment(world: World, agentId: string, id: string): boolean {
  const rows = rowsOf(world, id)
  const mine = rows.some((item) => item.owner.id === agentId)
  if (!mine) return false
  if (!rows.some((item) => item.row.status === 'open')) return false
  setStatus(world, id, 'kept')
  // R521：显式"我办到了"也是 kept 裁决，同样留痕——否则这条承诺已不是 open，
  // settleCommitments 再也不会判它，记忆里就永远查不到"答应过谁、兑现没有"。
  recordSettledEpisodes(world, id, 'kept', world.tick)
  return true
}

export interface Settlement {
  id: string
  status: 'kept' | 'missed'
  /** 约定的双方（id 排序）。 */
  pair: [string, string]
}

/**
 * R497/R513：结算到期承诺。open 且 dueTick < nowTick 的才判；到期当 tick 不判（不误判）。
 *
 * 判据（只认事实）：
 * - kept：证据窗口 [createdAtTick, min(now, dueTick + MISS_GRACE_TICKS)] 内，任一方有
 *   episode.with 含对方，或两人在同一地点各有 meet 活动且时间重叠；或显式 keepCommitment
 *   已经标过。宽限期内**任何时刻**出现证据都立刻判 kept，不等宽限结束。
 * - missed：两个宽限都用完仍无证据。不因为"看起来忙/可能去过了"就改判。
 *
 * 两个 grace，理由不同，别混：

 * - MISS_GRACE_TICKS：没有证据 → 保持 open 到宽限结束（"没证据 ≠ 失约"）。
 */
export function settleCommitments(world: World, nowTick: number): Settlement[] {
  const now = Math.max(0, Math.floor(nowTick))
  const settled: Settlement[] = []
  const done = new Set<string>()

  for (const agent of world.agents) {
    for (const row of agent.commitments ?? []) {
      if (row.status !== 'open' || row.dueTick >= now || done.has(row.id)) continue
      done.add(row.id)

      const rows = rowsOf(world, row.id)
      const pair = pairOf(rows, agent.id, row)
      const from = Math.min(row.createdAtTick, ...rows.map((item) => item.row.createdAtTick))
      const graceEnd = row.dueTick + MISS_GRACE_TICKS

      // ① R513：证据先判。宽限内右端取 now（迟到的碰面也算），宽限后封在 graceEnd，不再倒填。
      const kept =
        rows.some((item) => item.row.status === 'kept') ||
        metInWindow(world, pair[0], pair[1], from, Math.min(now, graceEnd))
      if (kept) {
        setStatus(world, row.id, 'kept')
        // R521：裁决要留痕——双方各写一条情节，心情与回忆才读得到这次兑现。
        recordSettledEpisodes(world, row.id, 'kept', now)
        settled.push({ id: row.id, status: 'kept', pair })
        continue
      }

      // ② 没证据不等于失约：宽限（MISS_GRACE_TICKS）用完才落 missed。
      //
      // 曾经这里还有一条"人还忙着就先不定罪"（BUSY_GRACE_TICKS=60）的分支。它被本行
      // 完全覆盖——now <= due+60 必然也 <= due+180，所以那条分支永远不起作用。
      // 留着它会让读者以为有两种宽限，实际只有一种（这是审计 R2 第 1 条）。
      if (now <= graceEnd) continue

      setStatus(world, row.id, 'missed')
      // R521：爽约同样双方各写一条（前缀 `没做完：` 沿用既有负向约定）。
      recordSettledEpisodes(world, row.id, 'missed', now)
      settled.push({ id: row.id, status: 'missed', pair })
    }
  }

  pruneSettled(world, now)
  return settled
}

/**
 * R521：一次裁决写进**双方**的情节记忆——"我答应过谁、兑现没有"必须有地方可读。
 *
 * 为什么写在裁决点：裁决本身只发生一次（open → kept/missed 之后 settleCommitments 直接跳过，
 * keepCommitment 也只在真有 open 行时才转），所以**幂等由状态机保证**，不另立去重表。
 *
 * 文案两个约定，与 memory.ts 的既有写法对齐：
 * - kept → `守约：答应<对方>的「<事项>」兑现了`（正向，life.ts 的 moodPolarityOf 认这个前缀）；
 * - missed → `没做完：答应<对方>的「<事项>」`（沿用 `没做完：` 这个既有负向前缀）。
 * kind 用 'social'：这是"和某人的一件事"，不新开记忆类型；with 指向对方。
 * salience 0.55 / 0.45：守约比爽约更值得记住，但都不该压过"办成一张工单"（0.9）。
 */
function recordSettledEpisodes(world: World, id: string, status: 'kept' | 'missed', nowTick: number): void {
  const rows = rowsOf(world, id)
  const head = rows[0]
  if (head === undefined) return
  const what = head.row.what
  const pair = pairOf(rows, head.owner.id, head.row)
  for (const ownerId of pair) {
    const owner = world.agents.find((agent) => agent.id === ownerId)
    if (owner === undefined) continue
    const peerId = ownerId === pair[0] ? pair[1] : pair[0]
    if (peerId === ownerId) continue
    const peer = world.agents.find((agent) => agent.id === peerId)
    if (peer === undefined) continue
    const who = peer.name.trim() === '' ? peer.id : peer.name
    const summary = status === 'kept'
      ? '守约：答应' + who + '的「' + what + '」兑现了'
      : '没做完：答应' + who + '的「' + what + '」'
    appendEpisode(owner, {
      tick: nowTick,
      day: dayOf(nowTick),
      kind: 'social',
      summary,
      with: [peerId],
      placeId: owner.placeId ?? '',
      salience: status === 'kept' ? 0.55 : 0.45,
    }, nowTick)
  }
}

function rowOf(agent: Agent, id: string): Commitment | undefined {
  return (agent.commitments ?? []).find((row) => row.id === id)
}

function rowsOf(world: World, id: string): { owner: Agent; row: Commitment }[] {
  const rows: { owner: Agent; row: Commitment }[] = []
  for (const agent of world.agents) {
    for (const row of agent.commitments ?? []) {
      if (row.id === id) rows.push({ owner: agent, row })
    }
  }
  return rows
}

function pairOf(rows: readonly { owner: Agent; row: Commitment }[], ownerId: string, row: Commitment): [string, string] {
  const ids = [...new Set([ownerId, row.with, ...rows.map((item) => item.owner.id)])].sort()
  const pair: [string, string] = [ids[0] ?? ownerId, ids[1] ?? row.with]
  return pair
}

/** 一个约定的所有行一起改状态：双方看到同一个结果。 */
function setStatus(world: World, id: string, status: CommitmentStatus): void {
  for (const agent of world.agents) {
    const rows = agent.commitments
    if (rows === undefined || rows.length === 0) continue
    if (!rows.some((row) => row.id === id && row.status !== status)) continue
    agent.commitments = rows.map((row) => (row.id === id ? { ...row, status } : row))
  }
}

/** 超上限时把最旧的 open 转 released（双方一起，约定作废不是单方面赖账）。 */
function enforceOpenMax(world: World, agentId: string): void {
  const agent = world.agents.find((item) => item.id === agentId)
  if (agent === undefined) return
  const open = (agent.commitments ?? []).filter((row) => row.status === 'open')
  if (open.length <= OPEN_MAX) return
  // sort 稳定：同 tick 写入的按插入顺序，先来的算更旧。
  const oldestFirst = [...open].sort((left, right) => left.createdAtTick - right.createdAtTick)
  for (const row of oldestFirst.slice(0, open.length - OPEN_MAX)) setStatus(world, row.id, 'released')
}

/**
 * 窗口内两人有没有"见过"。
 *
 * ① 任一方的情节记忆里带着对方（episode.with）——桥/结算以后往里写，这里只读；
 * ② 两人在同一个地点各有 meet 活动且时间重叠——同屋聊天没有 with 也能证明碰过面。
 */
function metInWindow(world: World, a: string, b: string, from: number, to: number): boolean {
  if (a === b) return false
  const first = world.agents.find((agent) => agent.id === a)
  const second = world.agents.find((agent) => agent.id === b)
  if (first !== undefined && episodesWith(first, b, from, to)) return true
  if (second !== undefined && episodesWith(second, a, from, to)) return true
  return sharedMeet(world, a, b, from, to)
}

function episodesWith(agent: Agent, peerId: string, from: number, to: number): boolean {
  return (agent.episodes ?? []).some((episode) => episode.tick >= from && episode.tick <= to && episode.with.includes(peerId))
}

function sharedMeet(world: World, a: string, b: string, from: number, to: number): boolean {
  const mine = (world.activities ?? []).filter((item) => item.agentId === a && item.kind === 'meet')
  const yours = (world.activities ?? []).filter((item) => item.agentId === b && item.kind === 'meet')
  for (const one of mine) {
    const [oneFrom, oneTo] = spanOf(one, to)
    for (const other of yours) {
      if (other.placeId !== one.placeId) continue
      const [twoFrom, twoTo] = spanOf(other, to)
      if (Math.max(oneFrom, twoFrom, from) <= Math.min(oneTo, twoTo, to)) return true
    }
  }
  return false
}

/** 活动占用的时间段；还在进行的按窗口右端截断。 */
function spanOf(activity: Activity, windowEnd: number): [number, number] {
  const start = activity.startedAt
  const end = activity.endedAt ?? (activity.status === 'active' ? windowEnd : activity.endsAt)
  const span: [number, number] = [start, Math.max(start, end)]
  return span
}

/** 已裁决的旧承诺滚出存档；open 的永远留着（有上限，不会涨）。 */
function pruneSettled(world: World, nowTick: number): void {
  const oldest = nowTick - SETTLED_KEEP_DAYS * DAY_TICKS
  for (const agent of world.agents) {
    const rows = agent.commitments
    if (rows === undefined || rows.length === 0) continue
    const kept = rows.filter((row) => row.status === 'open' || row.dueTick >= oldest)
    if (kept.length !== rows.length) agent.commitments = kept
  }
}
