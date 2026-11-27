/**
 * R505：把「你记得什么 + 你答应过什么」渲染成一段给模型读的中文。
 *
 * 为什么单独一个模块：H4 有四个触发点（回短信 / 主动短信 / 每日计划 / 决策），
 * 每个都要同一段记忆。四处各写一遍必然漂移（条数、字数、谁先丢），所以只在这里实现一次，
 * 调用方只管把返回值拼进自己的 prompt。
 *
 * 三条硬口径：
 * - **不自己打分**：挑哪几条、超预算先丢谁，全走 `sim/memory.ts` 的 `selectEpisodes` / `scoreEpisode`。
 *   这两个函数由调用方注入（就是文件里的 `selectEpisodes` / `scoreEpisode` 字段）：
 *   `protocol/boundaries.ts` 规定 bridge 只能**值** import protocol/domain/runtime，不许伸手进模拟内核。
 *   注入的是同一份打分，不是第二套——否则同一份记忆在聊天里和在计划里会挑出不同条目。
 * - **硬预算 400 字**：超了先丢分数最低的记忆；记忆丢光了才动承诺——承诺有到期裁决，
 *   爽约的代价比忘掉一件小事贵。
 * - **空就是空**：没有任何内容返回空串，不返回「（无）」。模型会把废话当事实读进去。
 *
 * 不收角色名：这段话是读给他自己的，「你是谁」已经在 system prompt 里，再写一遍只是噪音。
 *
 * 纯函数：不读时钟、不摇随机数、不碰文件、不调模型。1 tick = 1 游戏分钟。
 */
import type { Commitment, Episode } from '../domain/types.js'

/** 一次最多回忆几条（与 H4 的 K=6 同口径）。 */
export const MEMORY_RECALL_K = 6
/** 最多带几条还没兑现的承诺。 */
export const MEMORY_OPEN_COMMITMENTS = 3
/** 这段文字的硬预算，按字符算（一个汉字 = 1，不是 UTF-8 字节）。 */
export const MEMORY_CONTEXT_MAX_CHARS = 400

/** 一天多少游戏分钟（与 `sim/memory.ts` 的 `DAY_TICKS` 同值；同一条边界规则不许这里 import 它）。 */
const MINUTES_PER_DAY = 24 * 60

export interface MemoryContextInput {
  /** 这个角色的情节记忆（`agent.episodes`；可以为空）。 */
  episodes: readonly Episode[]
  /** 这个角色的承诺（`agent.commitments`；只取 status === 'open' 的）。 */
  commitments: readonly Commitment[]
  /** 角色 id → 人名（不传就显示 id；板块边界不许 bridge 读世界）。 */
  nameOf?: (id: string) => string
  /** 现在几点（绝对 tick），只用于近因打分。 */
  nowTick: number
  /** 取分数最高的 K 条 —— 由调用方接 `sim/memory.ts` 的 `selectEpisodes`。 */
  selectEpisodes: (
    episodes: readonly Episode[],
    options: { nowTick: number; k?: number },
  ) => Episode[]
  /** 单条分数 —— 由调用方接 `sim/memory.ts` 的 `scoreEpisode`，只用来决定超预算先丢谁。 */
  scoreEpisode: (episode: Episode, options: { nowTick: number }) => number
}

/** 绝对 tick → 当天 HH:mm（与 `bridge/plan-prompt.ts` 同口径）。 */
function clockOf(tick: number): string {
  const minute = ((Math.floor(tick) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0')
}

/** 绝对 tick → 游戏第几天（1 起，与 `sim/memory.ts` 的 `dayOf` 同口径）。 */
function dayOfTick(tick: number): number {
  return Math.floor(Math.max(0, tick) / MINUTES_PER_DAY) + 1
}

/**
 * 一条记忆 → 一行。
 *
 * 日小结（kind === 'day'）自己就带「第N天：」，它的 tick 又是当天 00:00：
 * 再套一次天数与时刻就成了「第2天 00:00 第2天：…」，既重复又是假时刻。
 */
function episodeLine(episode: Episode): string {
  if (episode.kind === 'day') return episode.summary
  return '第' + String(episode.day) + '天 ' + clockOf(episode.tick) + ' ' + episode.summary
}

/**
 * R505：承诺里存的是角色 id（agent-2），但模型该看到人名。
 * 名字由调用方注入（板块边界不许 bridge 读世界）。
 */
/** 一条承诺 → 一行：什么时候之前、对谁、做什么。with 为空表示自己一个人。 */
function commitmentLine(commitment: Commitment, nameOf?: (id: string) => string): string {
  const when = '第' + String(dayOfTick(commitment.dueTick)) + '天 ' + clockOf(commitment.dueTick) + ' 前'
  if (commitment.with === '') return when + '：' + commitment.what
  const who = nameOf?.(commitment.with) ?? commitment.with
  return when + '，和 ' + who + '：' + commitment.what
}

/** 拼成整段；某一段没有内容就整段不出现（不留空标题）。 */
function render(episodes: readonly Episode[], commitments: readonly Commitment[], nameOf?: (id: string) => string): string {
  const lines: string[] = []
  if (episodes.length > 0) {
    lines.push('你记得：')
    for (const episode of episodes) lines.push('- ' + episodeLine(episode))
  }
  if (commitments.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('你答应过：')
    for (const commitment of commitments) lines.push('- ' + commitmentLine(commitment, nameOf))
  }
  return lines.join('\n')
}

interface MemoryRow {
  episode: Episode
  /** 注入的 `scoreEpisode` 的结果，只为决定「超预算时先丢谁」。 */
  score: number
}

/** 去掉分数最低的一条；同分先丢更新的（刚发生的小事最不值钱）。 */
function withoutWeakest(rows: readonly MemoryRow[]): MemoryRow[] {
  const weakest = [...rows]
    .sort((a, b) => a.score - b.score || b.episode.tick - a.episode.tick)
    .at(0)
  if (weakest === undefined) return []
  return rows.filter((row) => row !== weakest)
}

/**
 * R505：渲染一段「你记得 / 你答应过」。
 *
 * 顺序由三件事定死，保证同一个世界状态永远渲染出同一段字：
 * 1. 先按 `selectEpisodes` 取 Top-K（分数高者先入围）；
 * 2. 入围后按 tick 升序展示（记忆要读成时间线，不是排行榜）；
 * 3. 超预算按 `scoreEpisode` 的分数从低到高丢，同分丢更新的。
 *
 * @returns 给模型读的中文；没有任何内容时是空串。
 */
export function renderMemoryContext(input: MemoryContextInput): string {
  const recall: MemoryRow[] = input.selectEpisodes(input.episodes, { nowTick: input.nowTick, k: MEMORY_RECALL_K })
    .map((episode) => ({ episode, score: input.scoreEpisode(episode, { nowTick: input.nowTick }) }))
    .sort((a, b) => a.episode.tick - b.episode.tick)

  // 承诺：只认 open，到期早的在前（他先想起最该兑现的那条）；同刻按 id 定序，避免依赖数组顺序。
  let promises = input.commitments
    .filter((commitment) => commitment.status === 'open')
    .sort((a, b) => a.dueTick - b.dueTick || a.id.localeCompare(b.id))
    .slice(0, MEMORY_OPEN_COMMITMENTS)

  let episodes = recall
  let text = render(episodes.map((row) => row.episode), promises, input.nameOf)
  // 按 JS 字符数算预算（`text.length`）：Buffer.byteLength 是 UTF-8 字节，会把中文算成 3 倍。
  while (text.length > MEMORY_CONTEXT_MAX_CHARS) {
    if (episodes.length > 0) episodes = withoutWeakest(episodes)
    else if (promises.length > 0) promises = promises.slice(0, -1)
    else return ''
    text = render(episodes.map((row) => row.episode), promises, input.nameOf)
  }
  return text
}
