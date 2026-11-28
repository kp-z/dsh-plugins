/**
 * R497：情节记忆。为什么需要它：`world.activities` 只留 64 条（实测 3 人 1.7–1.9 天），
 * 而"上周二干了什么"必须有地方可读。这里只做**纯函数**：追加、按天裁剪、打分、取 Top-K，
 * 以及 R520 的"按存档体积预算再裁一道"。
 *
 * 不引入向量库：3 个居民、每天十来条，关键词 + 近因 + 重要性足够；超过 2000 条再考虑。
 */
import type { Activity, Agent, Episode, World } from '../domain/types.js'

/** 一天多少 tick（1 tick = 1 游戏分钟）。 */
export const DAY_TICKS = 1440
/** 记忆保留天数。 */
export const EPISODE_KEEP_DAYS = 7
/** 单角色硬上限（防止异常世界把存档撑大）。 */
export const EPISODE_MAX = 150

/**
 * R520：存档体积预算（2 MiB）。
 *
 * 依据是**实测的平台期**，不是拍脑袋的余量：24 人 / 第 53 天的 world.json 是 520 KB，
 * 而情节已被 7 天窗口封顶（人均 44–68 条），所以体积到 24 人这个平台就稳住了，
 * 平台实测约 1.2 MB——2 MiB 意味着**常规运行永远碰不到它**，只有某个字段真的开始疯长
 * （消息、活动、异常世界）时才会触闸。内网磁盘与快照传输 2 MiB 都毫无压力。
 *
 * 为什么量的是"排版后的字节"而不是 280 KB 那份紧凑 JSON：落盘用 2 空格缩进，
 * 其中 46% 是缩进与重复键名，**这是刻意留的**——review 存档时要能直接读。
 * 所以预算是按"人读的那份文件"算的，压缩省不出来的那部分也得算进去。
 *
 * 预算管的是 **world 那一段**（见 `snapshotBytes`），文件里的外壳（内容包清单）另占约 5 KB；
 * 它是固定的，所以整个 world.json 最多比预算大这么多，不会跟着世界一起长。
 *
 * 它是 EPISODE_MAX / EPISODE_KEEP_DAYS 之外**额外的一道闸**，不改那两个默认值：
 * 那两个管"一个人记多少条"，这个管"整个存档多大"。
 */
export const SNAPSHOT_BUDGET_BYTES = 2 * 1024 * 1024

/** 裁剪时每丢这么多条才重新量一次体积：全量序列化不便宜，逐条量会变成 O(n²)。 */
const TRIM_MEASURE_EVERY = 32

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
 * R512：只有**社交类活动**才产出"和谁"。
 *
 * 真实取值比名字朴素：生活路径把 social 意图落到 `kind: 'meet'`（sim/life.ts 的
 * selfLifeCommands、sim/step.ts 的命令处理），命令路径会同时写 `purpose: 'social'`，
 * 老档可能只有其中一个。没有 converse/chat 这种 kind——`converse` 是内容库里
 * tasks.requires 的 skill 名，不是活动类型。
 * 同屋的 work/study/meal/sleep 不算"和谁一起"，只是碰巧在一间屋子里。
 */
function isSocialActivity(activity: Activity): boolean {
  return activity.kind === 'meet' || activity.purpose === 'social'
}

/**
 * R510-2 / R512：这次活动期间"和谁真的交谈过"——同地点、时间重叠、且双方都在社交活动里。
 *
 * 纯函数：只读 activities，不引入新状态；不是社交活动就是空数组。
 * 接受 endedAt 而不是读 tick：仍在进行的那一方用调用点的"现在"截断。
 *
 * **不导出**：唯一的生产入口是 {@link recordActivityEpisode}，测试也从那里读回。
 */
function collaboratorsOf(activities: readonly Activity[], activity: Activity, endedAt: number): string[] {
  // R512-1：自己在干活/吃饭/睡觉 → 不带人（同屋不算同行者）。
  if (!isSocialActivity(activity)) return []
  const [from, to] = spanOf(activity, endedAt)
  const ids = new Set<string>()
  for (const other of activities) {
    if (other.id === activity.id || other.agentId === activity.agentId) continue
    if (other.placeId !== activity.placeId) continue
    // R512-2：对方也必须真的在社交活动里——坐旁边干活的人没跟他说过话。
    if (!isSocialActivity(other)) continue
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

/**
 * R520：存档里 world 那一段的字节数。
 *
 * 三处对齐 `store/worldStore.ts`，否则量出来的数跟文件对不上、预算是假的：
 * ① 不写 `world.events`——那是活客户端的补洞窗口，落盘时会剥掉；
 * ② 按存档的排版量（2 空格缩进）；
 * ③ 包在一个顶层对象里量——存档外壳正是把 world 嵌在顶层，缩进层级一致，
 *    于是与真实文件只差外壳本身（内容包清单，实测约 5 KB；它是固定的，不随世界长大）。
 *
 * 用字节而不是字符串长度：中文摘要一个字 3 字节，按字符数量会低估三倍。
 *
 * **不导出**：对外口径是 {@link trimToSnapshotBudget} 的 `bytes`（同一把尺）。
 */
function snapshotBytes(world: World): number {
  const { events: _ring, ...snapshot } = world
  return Buffer.byteLength(JSON.stringify({ world: snapshot }, null, 2))
}

export interface TrimResult {
  /** 裁掉了几条情节。 */
  dropped: number
  /** 裁完之后 world 那一段的字节数（见 `snapshotBytes`）。 */
  bytes: number
}

/**
 * R520：把世界裁进快照预算。**就地改 world**（只动情节），返回裁掉的条数与裁后的字节数。
 *
 * 规则，全为确定性，没有随机：
 * 1. 只裁 `agent.episodes`。**日小结（kind === 'day'）永远不裁**——它是那一天唯一的一句话摘要，
 *    丢掉就再也算不出来；承诺、任务、站点一概不动（它们本来也不在这里面）。
 * 2. 按 `agent.id` 排序后**轮流**丢每人最老的一条：不先把一个人的记忆掏空，也不随机挑。
 * 3. 体积落到预算内就停；谁都丢不动了（只剩日小结）也停，不空转。
 *
 * @param world - 世界本体（会被改）。
 * @param budgetBytes - 预算字节数，缺省 `SNAPSHOT_BUDGET_BYTES`。
 */
export function trimToSnapshotBudget(world: World, budgetBytes: number = SNAPSHOT_BUDGET_BYTES): TrimResult {
  const budget = Number.isFinite(budgetBytes) ? Math.max(0, Math.floor(budgetBytes)) : SNAPSHOT_BUDGET_BYTES
  let bytes = snapshotBytes(world)
  if (bytes <= budget) return { dropped: 0, bytes }

  const queues = [...world.agents]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((agent) => ({
      agent,
      // 候选按 tick 从老到新；同一 tick 保留写入顺序（Array#sort 稳定）。
      pending: [...(agent.episodes ?? [])]
        .filter((episode) => episode.kind !== 'day')
        .sort((left, right) => left.tick - right.tick),
      next: 0,
    }))

  let dropped = 0
  let exhausted = false
  while (!exhausted && bytes > budget) {
    let progress = false
    for (const queue of queues) {
      const victim = queue.pending[queue.next]
      if (victim === undefined) continue
      queue.next += 1
      queue.agent.episodes = (queue.agent.episodes ?? []).filter((episode) => episode !== victim)
      dropped += 1
      progress = true
      if (dropped % TRIM_MEASURE_EVERY === 0) {
        bytes = snapshotBytes(world)
        if (bytes <= budget) break
      }
    }
    if (!progress) exhausted = true
  }

  bytes = snapshotBytes(world)
  return { dropped, bytes }
}

/**
 * 裁剪结果的一句话（宿主日志用）。
 *
 * 放在这里而不是各个落盘点：措辞只有一处，两个写盘点不会各写一套。
 */
export function describeTrim(result: TrimResult): string {
  return `存档超过体积预算，裁掉 ${result.dropped} 条最老的情节（现在 ${result.bytes} 字节）`
}

/**
 * R519：工单的完成/失败直接写一条情节记忆。
 *
 * 为什么单独一条通路：工单不是"活动"——它是外部（会话/团队）裁决的，
 * `applyExternalTasks` 只改 task 状态、不产生 Activity，于是**做完一件大事在记忆里
 * 没有任何痕迹**（H16 现场）。这里补的就是这一笔。
 *
 * 文案沿用 `summarizeActivity` 的两个约定：完成写"工单「…」"，失败写"没做完：…"
 * （后者会被 `memoryMood` 记为负向，于是爽约/失手会真的影响心情）。
 */
export function recordTaskEpisode(
  world: { agents: readonly Agent[] },
  agentId: string,
  title: string,
  ok: boolean,
  nowTick: number,
  reason = '',
): void {
  const agent = world.agents.find((row) => row.id === agentId)
  if (agent === undefined) return
  const summary = ok
    ? '工单「' + title + '」做完了'
    : '没做完：工单「' + title + '」' + (reason === '' ? '没成' : reason)
  appendEpisode(agent, {
    tick: nowTick,
    day: dayOf(nowTick),
    kind: 'task',
    summary,
    with: [],
    placeId: agent.placeId ?? '',
    salience: ok ? 0.6 : 0.5,
  }, nowTick)
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
