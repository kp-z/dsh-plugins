/**
 * R497：情节记忆。为什么需要它：`world.activities` 只留 64 条（实测 3 人 1.7–1.9 天），
 * 而"上周二干了什么"必须有地方可读。这里只做**纯函数**：追加、按天裁剪、打分、取 Top-K。
 *
 * 不引入向量库：3 个居民、每天十来条，关键词 + 近因 + 重要性足够；超过 2000 条再考虑。
 */
import type { Activity, Agent, Episode } from '../domain/types.js'

/** 一天多少 tick（1 tick = 1 游戏分钟）。 */
export const DAY_TICKS = 1440
/** 记忆保留天数。 */
export const EPISODE_KEEP_DAYS = 7
/** 单角色硬上限（防止异常世界把存档撑大）。 */
export const EPISODE_MAX = 150

export function dayOf(tick: number): number {
  return Math.floor(Math.max(0, tick) / DAY_TICKS) + 1
}

const PURPOSE_TEXT: Record<string, string> = {
  meal: '吃了顿饭',
  sleep: '睡了一觉',
  rest: '歇了一会儿',
  social: '和人聊了聊',
  work: '干活',
  study: '学习',
}

/** 一条活动 → 一句人话。只描述真实字段，不编动机。 */
export function summarizeActivity(activity: Activity, status: 'completed' | 'interrupted' = 'completed'): string {
  const taskName = activity.trigger?.text?.match(/「(.+?)」/)?.[1]
  // 触发文案是"开始执行工单「X」"，完成态不能照抄将来时。
  const base = taskName !== undefined ? '工单「' + taskName + '」' : (PURPOSE_TEXT[activity.purpose ?? ''] ?? activity.kind)
  const done = status === 'completed' ? base : '没做完：' + base
  return activity.kind === 'meet' && taskName === undefined ? '和人聊了聊' : done
}

/** R510：一条记忆最多记几个"和谁"——再多就不是"和谁"，是一张名单。 */
export const EPISODE_WITH_MAX = 4

/** R510-1：活动占用的时间段；还在进行的按 endedAt 截断。 */
function spanOf(activity: Activity, endedAt: number): [number, number] {
  const end = activity.endedAt ?? (activity.status === 'active' ? endedAt : activity.endsAt ?? endedAt)
  return [activity.startedAt, Math.max(activity.startedAt, end)]
}

/**
 * R510-2：这次活动期间"和谁待在一起"——同地点且时间重叠的其他角色。
 *
 * 纯函数：只读 activities，不引入新状态；没有重叠就是空数组（老行为不变）。
 * 接受 endedAt 而不是读 tick：仍在进行的那一方用调用点的"现在"截断。
 */
export function collaboratorsOf(activities: readonly Activity[], activity: Activity, endedAt: number): string[] {
  const [from, to] = spanOf(activity, endedAt)
  const ids = new Set<string>()
  for (const other of activities) {
    if (other.id === activity.id || other.agentId === activity.agentId) continue
    if (other.placeId !== activity.placeId) continue
    const [otherFrom, otherTo] = spanOf(other, endedAt)
    // R510-3：闭区间重叠（同一 tick 结束和开始算碰过面），和 commitments 的共享 meet 语义一致。
    if (Math.max(from, otherFrom) > Math.min(to, otherTo)) continue
    ids.add(other.agentId)
  }
  // R510-4：去重后按 id 排序再截断——同一批人永远算出同一份 with。
  return [...ids].sort().slice(0, EPISODE_WITH_MAX)
}

/** 活动结束时写一条记忆。salience：完成工单最高，日常最低；失败的中等偏低。 */
export function episodeOfActivity(
  activity: Activity,
  endedAt: number,
  status: 'completed' | 'interrupted' = 'completed',
  withIds: readonly string[] = [],
): Episode {
  const byTask = activity.trigger?.kind === 'task' || activity.taskAttemptId !== undefined
  const salience = status === 'interrupted'
    ? (byTask ? 0.5 : 0.2)
    : byTask ? 0.9 : activity.purpose === 'social' ? 0.6 : 0.3
  return {
    tick: endedAt,
    day: dayOf(endedAt),
    kind: activity.purpose ?? activity.kind,
    summary: summarizeActivity(activity, status),
    with: [...withIds],
    placeId: activity.placeId,
    salience,
  }
}

/** 按天裁剪（保留最近 keepDays 天内，且不超过硬上限）。 */
export function pruneEpisodes(episodes: readonly Episode[], nowTick: number, keepDays = EPISODE_KEEP_DAYS): Episode[] {
  const oldest = dayOf(nowTick) - keepDays + 1
  const kept = episodes.filter((episode) => episode.day >= oldest)
  return kept.length > EPISODE_MAX ? kept.slice(kept.length - EPISODE_MAX) : kept
}

/** 追加一条记忆并就地裁剪。纯数据修改，返回该角色新的数组。 */
export function appendEpisode(agent: Agent, episode: Episode, nowTick = episode.tick): Episode[] {
  const next = [...(agent.episodes ?? []), episode]
  agent.episodes = pruneEpisodes(next, nowTick)
  return agent.episodes
}

/** 失败的活动要够长才记：否则每个瞬时 idle 都写一条"没做完"，记忆全是噪音。 */
export const INTERRUPTED_MIN_TICKS = 15

/**
 * 从活动写回角色记忆；找不到角色就什么都不做。
 *
 * 只记**真的做过**的活动：带 purpose 或带工单代次。桥把每次工具结果映射成
 * activity:'idle'（session-events），那种没有 purpose 的不能写成"完成"。
 */
export function recordActivityEpisode(
  world: { agents: readonly Agent[]; activities?: readonly Activity[] | undefined },
  activity: Activity,
  endedAt: number,
  status: 'completed' | 'interrupted' = 'completed',
): void {
  const real = activity.purpose !== undefined || activity.taskAttemptId !== undefined
  if (!real) return
  if (status === 'interrupted' && endedAt - activity.startedAt < INTERRUPTED_MIN_TICKS) return
  const agent = world.agents.find((row) => row.id === activity.agentId)
  if (agent === undefined) return
  // R510-5：写记忆的那一刻把"和谁"一次算清，读侧（承诺证据）只认事实。
  const withIds = collaboratorsOf(world.activities ?? [], activity, endedAt)
  appendEpisode(agent, episodeOfActivity(activity, endedAt, status, withIds), endedAt)
}

const KIND_TEXT: Record<string, string> = { ...PURPOSE_TEXT, work: '干活', day: '小结' }

/** 一天的记忆压成一句：只数真实发生过的条数，不解释。 */
export function summarizeDay(episodes: readonly Episode[], day: number): string | null {
  const mine = episodes.filter((episode) => episode.day === day && episode.kind !== 'day')
  if (mine.length === 0) return null
  const counts = new Map<string, number>()
  for (const episode of mine) {
    const label = KIND_TEXT[episode.kind] ?? episode.kind
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => label + '×' + String(n))
  return '第' + String(day) + '天：' + parts.join('、')
}

/**
 * 换天时给每个角色写一条日小结。
 *
 * 为什么复用 Episode 而不是新开 memories：一份"今天干了什么"已经有事实来源，
 * 再存一份只会两处打架（用户要求：如无必要勿增实体）。同一天重复调用是幂等的。
 */
export function writeDayDigest(world: { agents: readonly Agent[] }, endedDay: number): void {
  for (const agent of world.agents) {
    const episodes = agent.episodes ?? []
    if (episodes.some((episode) => episode.kind === 'day' && episode.day === endedDay)) continue
    const summary = summarizeDay(episodes, endedDay)
    if (summary === null) continue
    appendEpisode(agent, {
      tick: endedDay * DAY_TICKS,
      day: endedDay,
      kind: 'day',
      summary,
      with: [],
      placeId: agent.placeId,
      salience: 0.5,
    })
  }
}

export interface RecallOptions {
  /** 现在的 tick，用于算近因。 */
  nowTick: number
  /** 关键词（中文按字、英文按词都行）；空则只看近因与重要性。 */
  query?: string
  k?: number
}

const CJK = /[\u3400-\u9fff]/

/**
 * 中文没有空格：整串当一个 token 会让"补测试的工单"匹配不到"补测试"。
 * 含中文的 token 再拆成相邻二字组；英文/数字保持原样。
 */
function tokensOf(text: string): string[] {
  const out: string[] = []
  for (const token of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (token === '') continue
    out.push(token)
    if (CJK.test(token) && token.length > 2) {
      for (let i = 0; i + 2 <= token.length; i++) out.push(token.slice(i, i + 2))
    }
  }
  return out
}

/** 单条记忆的分数：近因（越近越高）+ 重要性 + 关键词命中。 */
export function scoreEpisode(episode: Episode, options: RecallOptions): number {
  const ageDays = Math.max(0, (options.nowTick - episode.tick) / DAY_TICKS)
  const recency = 1 / (1 + ageDays)
  const relevance = (() => {
    const query = options.query?.trim()
    if (query === undefined || query === '') return 0
    const haystack = (episode.summary + ' ' + episode.kind).toLowerCase()
    const tokens = tokensOf(query)
    if (tokens.length === 0) return 0
    const hits = tokens.filter((token) => haystack.includes(token)).length
    return hits / tokens.length
  })()
  // R497：权重 1.0（不是 2.0）——单个词命中不该压过"刚做完且重要"的记忆。
  return recency + episode.salience + relevance
}

/** 取 Top-K，按分数降序；同分时新的在前，保证确定性。 */
export function selectEpisodes(episodes: readonly Episode[], options: RecallOptions): Episode[] {
  const k = options.k === undefined ? 6 : Math.max(0, options.k)
  if (k === 0) return []
  return [...episodes]
    .map((episode) => ({ episode, score: scoreEpisode(episode, options) }))
    .sort((a, b) => b.score - a.score || b.episode.tick - a.episode.tick)
    .slice(0, k)
    .map((row) => row.episode)
}
