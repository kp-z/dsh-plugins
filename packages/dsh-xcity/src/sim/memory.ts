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
export const EPISODE_MAX = 1200

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
export function summarizeActivity(activity: Activity): string {
  const base = PURPOSE_TEXT[activity.purpose ?? ''] ?? activity.kind
  const who = activity.kind === 'meet' ? '和人一起' : ''
  const what = activity.kind === 'work' && activity.trigger?.kind === 'task' && activity.trigger.text !== undefined
    ? activity.trigger.text
    : base
  return who + what
}

/** 活动结束时写一条记忆。salience：完成工单最高，日常最低。 */
export function episodeOfActivity(activity: Activity, endedAt: number): Episode {
  const byTask = activity.trigger?.kind === 'task' || activity.taskAttemptId !== undefined
  return {
    tick: endedAt,
    day: dayOf(endedAt),
    kind: activity.purpose ?? activity.kind,
    summary: summarizeActivity(activity),
    with: [],
    placeId: activity.placeId,
    salience: byTask ? 0.9 : activity.purpose === 'social' ? 0.6 : 0.3,
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

/** 从活动写回角色记忆；找不到角色就什么都不做。 */
export function recordActivityEpisode(world: { agents: readonly Agent[] }, activity: Activity, endedAt: number): void {
  const agent = world.agents.find((row) => row.id === activity.agentId)
  if (agent === undefined) return
  appendEpisode(agent, episodeOfActivity(activity, endedAt), endedAt)
}

export interface RecallOptions {
  /** 现在的 tick，用于算近因。 */
  nowTick: number
  /** 关键词（中文按字、英文按词都行）；空则只看近因与重要性。 */
  query?: string
  k?: number
}

function tokensOf(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token !== '')
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
  return recency + episode.salience + relevance * 2
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
