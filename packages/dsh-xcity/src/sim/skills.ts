/**
 * R541：熟练度——把"干过什么"派生成"多熟练"。**纯派生，零存档字段**。
 *
 * ## 为什么是派生，不是 Agent 上的 xp/level 字段
 *
 * 权威数据已经在世界里：`world.activities`（干过什么）与 `world.tasks`（做成了什么）。
 * 熟练度只是它们的一次投影——存成字段就有两个真相（发放点与读点必然漂移），还要给老档补迁移。
 * 所以这里只做 `(world, agentId) → 数值`，同输入同输出，不读 `Date.now()`/`Math.random()`。
 *
 * ## 主来源是活动，不是工单（真机证据）
 *
 * 现场存档 `~/.dsh/profiles/desktop/.xcity/world.json`（tick 42000）：**工单 0 张**
 * （从来没人派过单），活动 75 条，其中 `kind=work` 且 `completed` 的 52 条。
 * 只按工单派生会**永远全空**——所以主来源是活动，工单是补充（有单时才有）。
 *
 * ## 两本账，各自记什么
 *
 * | 来源 | 单位 | 分 | 依据 |
 * |---|---|---|---|
 * | `Activity`（`kind=work` + `completed` + `skill` 非空） | 一次"练习" | `+8` | GROWTH.md §4.2 的**学习块 +8**：一次到站点上把一条能力用掉一段时间的活动，就是同一粒度 |
 * | `Task`（`status=done`） | 一张"成果" | 首张 `+25`，同 `(set,key)` 第 2 次 `+10`，第 3 次起 `+5` | GROWTH.md §4.2；递减压住"反复刷同一张廉价单" |
 *
 * 为什么不按时长给活动分（research 里"学习块 +8"没分档）：实测那 48 条计入活动的时长是
 * 最短 1 tick / 中位 40 / 最长 300，其中 33 条 ≤30 tick——被瞬时打断的活动也会落成 `completed`，
 * 按分钟给分等于**让噪声变成资历**。所以一次练习就是一个单位。
 *
 * **同一件事不付两次**：带 `taskAttemptId` 的活动是工单在站点上干活的那一段，
 * 它的成果已经由 ② 的 `+25` 结过账，这里跳过（否则一张单变成 25+8）。
 *
 * 口径为什么用 `requires`/`skill`（能力），而不是 `suggestedRole`（岗位）或 `Episode`：
 * 岗位是"建议派给谁"，不是"练到了什么"；一张单可能同时要 `code + review`（`default.ts:371-374`），
 * 只有能力说得准。`Episode`（`domain/types.ts:218`）根本没有技能字段，
 * 从摘要文字里猜能力是脆的（改一句文案就全错）。
 *
 * ## 边界：这是一个**滚动窗口**，所以等级是"近期手感"而不是一辈子的资历
 *
 * 活动环只留 `activityKeepFor(world) = max(64, 24 × 人数)` 条（`sim/activity.ts:31-39`）：
 * 3 人世界 = **72 条**（实测存档 75 条 = 72 completed + 3 active），按该文件的注释约等于
 * **每人一个游戏日**。于是：
 * - 老活动被裁掉后分数自然回落、等级跟着降——这是环形缓冲**免费给的粗粒度衰减**，
 *   本轮因此不需要再写一条衰减曲线（GROWTH.md §4.3 的 graceDays/perDay/floor 还要标定）；
 * - 满级 300 分 ≈ 38 次练习，一个窗口内几乎达不到。现场存档采样（tick≈42000–43200，
 *   窗口边转边算，数字会漂）：最勤的人 38–40 次 = 304–320 分（L5），另一人 5–10 次 = 40–80 分（L1），
 *   最闲的一位 2–3 次 = 16–24 分（够不上 L1 → **不写进提示词**）。
 *   阈值 `20/60/120/200/300` 是按"一张单 = 25"标的，活动权重是 8，分布要不要重标是 H37b 的事
 *   ——这一轮只做"算得出来 + 说得出来"。
 *
 * ## 衰减：这一轮不做，但 `lastUsedTick` 已经返回
 *
 * 注意 `Task.finishedAtTick`（`domain/types.ts:377`）与 `Activity.endedAt` 都存在，
 * 所以"每条能力最后一次用到的 tick"今天就派生得出来，下一轮做 RimWorld 式懒衰减**不用加字段**。
 * **不许**拿 `Episode.tick` 冒充：情节 7 天就被裁，而且一条情节不记它是哪条能力。
 */
import type { Activity, Task } from '../domain/types.js'

/**
 * 每级门槛（**累计**分）：`need(n) = 20·n(n+1)/2` → 20 / 60 / 120 / 200 / 300。
 *
 * 依据是 `docs/research/GROWTH.md:231` 的曲线（不是随手拍的）：按一张单 25 分算，
 * L1=1 张、L2=3 张、L3=5 张、L4=8 张、L5=12 张。工单与活动**共用**这张表——
 * 百分点只有一个公式源，两条来源只在"给多少分"上不同。
 */
export const LEVEL_THRESHOLDS: readonly number[] = [20, 60, 120, 200, 300]

/** 满级（= 门槛数）。 */
export const MAX_LEVEL = LEVEL_THRESHOLDS.length

/** 一次练习（`kind=work` 的完工活动）给多少分——沿用 GROWTH.md §4.2 的学习块口径。 */
export const POINTS_PRACTICE = 8

/** 首次做成一张单给多少分。 */
export const POINTS_FIRST = 25

/** 同一 `(set,key)` 第 2 次做成给多少分。 */
export const POINTS_REPEAT = 10

/** 同一 `(set,key)` 第 3 次起给多少分。 */
export const POINTS_AGAIN = 5

/**
 * 一行熟练度。`skill` 是能力原名（`code`/`review`/…），中文标签见 {@link skillLabel}。
 *
 * `sample` 与 `failed` 分开数：提示词要说"练了几次、打回几张"，一个数字说不清同一件事。
 */
export interface SkillRow {
  /** 能力原名（`Capability` 的线值；世界被手改过时可能是任意字符串，原样带出）。 */
  skill: string
  /** 0..5。 */
  level: number
  /** 累计熟练度分。 */
  points: number
  /** 计入的练习单位数：一次完工活动算一次，一张完工单也算一次。 */
  sample: number
  /** 打回/没做成的单张数（只记账，不扣分）。 */
  failed: number
  /** 这条能力最后一次被用到的 tick（活动取 `endedAt`，单取 `finishedAtTick`）；从没用过是 null。 */
  lastUsedTick: number | null
}

/**
 * 派生要读的世界切片。两个字段都写成可选：老存档/半截快照可能只有其中一个，
 * 装配层原样传 `world` 也能过（`World` 两个字段都有）。
 */
export interface SkillSources {
  readonly activities?: readonly Activity[] | undefined
  readonly tasks?: readonly Task[] | undefined
}

/** 能力英文 → 中文（进 prompt 的那一行；未知取值原样返回，不抛）。 */
const CAPABILITY_LABEL: Readonly<Record<string, string>> = {
  code: '工程',
  review: '评审',
  research: '调研',
  compute: '实测',
  converse: '沟通',
  deliver: '交付',
  rest: '休息',
}

/** 能力 → 中文标签。未知取值原样返回（与 `roleLabel`/`stateLabel` 同一条约定：宁可显示得怪，也不崩）。 */
export function skillLabel(skill: string): string {
  return CAPABILITY_LABEL[skill] ?? skill
}

/** 累计分 → 等级（0..MAX_LEVEL）。 */
export function levelForPoints(points: number): number {
  let level = 0
  for (const need of LEVEL_THRESHOLDS) {
    if (points >= need) level += 1
  }
  return level
}

/** 一条能力的中间账。`seen` 记的是"这条能力下，这个 `(set,key)` 做成过几次"。 */
interface Tally {
  points: number
  sample: number
  failed: number
  lastUsedTick: number | null
  seen: Map<string, number>
}

/** 工单第几次做成（1 起）给多少分。 */
function gainOf(times: number): number {
  if (times <= 1) return POINTS_FIRST
  return times === 2 ? POINTS_REPEAT : POINTS_AGAIN
}

/** 更新"最后一次用到它"的 tick。 */
function markUsed(tally: Tally, tick: number): void {
  if (tally.lastUsedTick === null || tick > tally.lastUsedTick) tally.lastUsedTick = tick
}

/**
 * 扫一遍这个人的活动与工单，按能力记账。
 *
 * **确定性**：活动按数组原序扫（活动环本身就是追加序），工单先按 `ordinal`（创建序，
 * `domain/types.ts:354` 要求一律用它排序）排好再扫——"第几次做"不依赖外部顺序，
 * 同一份世界两次调用必得同值。
 */
function tallyOf(world: SkillSources, agentId: string): Map<string, Tally> {
  const out = new Map<string, Tally>()
  const rowOf = (skill: string): Tally => {
    const found = out.get(skill)
    if (found !== undefined) return found
    const created: Tally = { points: 0, sample: 0, failed: 0, lastUsedTick: null, seen: new Map() }
    out.set(skill, created)
    return created
  }

  // ① 活动（主来源）：在站点上把一条能力用掉一段时间的"练习"。
  for (const activity of world.activities ?? []) {
    if (activity.agentId !== agentId) continue
    if (activity.kind !== 'work' || activity.status !== 'completed') continue
    const skill = activity.skill
    if (skill === undefined || skill === '') continue
    // 带单的活动是工单那一段活，成果由 ② 结账——同一件事不付两次。
    if (activity.taskAttemptId !== undefined) continue
    const tally = rowOf(skill)
    tally.points += POINTS_PRACTICE
    tally.sample += 1
    markUsed(tally, activity.endedAt ?? activity.startedAt)
  }

  // ② 工单（补充）：有"成果"的世界里，一张完工单比一次练习值钱得多。
  const mine = (world.tasks ?? [])
    .filter((task) => task.owner === agentId && (task.status === 'done' || task.status === 'failed'))
    .sort((left, right) => left.ordinal - right.ordinal || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

  for (const task of mine) {
    for (const capability of task.requires) {
      const tally = rowOf(capability)
      if (task.status === 'failed') {
        // 不罚：失败原因常常与能力无关（依赖没到、团队取消、站点被占），
        // 扣分只会让角色回避难单；当前也没有失败样本可标定（GROWTH.md §4.2）。
        tally.failed += 1
        continue
      }
      // 任务集内 key 唯一；跨集同名 key 是两件不同的活，所以重复的判定单位是 (set,key)。
      const key = task.set + '\u0000' + task.key
      const times = (tally.seen.get(key) ?? 0) + 1
      tally.seen.set(key, times)
      tally.points += gainOf(times)
      tally.sample += 1
      if (task.finishedAtTick !== null) markUsed(tally, task.finishedAtTick)
    }
  }

  return out
}

/**
 * 这个人的熟练度，按"最拿手"排序（等级 → 分 → 次数 → 能力名，全序，保证确定性）。
 *
 * 只要有过记录就有一行（**可能是 0 级**：一次练习 8 分，够不上 L1 的 20）。
 * 0 级要不要显示是展示层的选择；{@link skillLineForPrompt} 不显示它。
 */
export function skillsOf(world: SkillSources, agentId: string): SkillRow[] {
  const rows: SkillRow[] = []
  for (const [skill, tally] of tallyOf(world, agentId)) {
    if (tally.sample === 0) continue
    rows.push({
      skill,
      level: levelForPoints(tally.points),
      points: tally.points,
      sample: tally.sample,
      failed: tally.failed,
      lastUsedTick: tally.lastUsedTick,
    })
  }
  rows.sort(
    (left, right) =>
      right.level - left.level ||
      right.points - left.points ||
      right.sample - left.sample ||
      (left.skill < right.skill ? -1 : left.skill > right.skill ? 1 : 0),
  )
  return rows
}

/**
 * 一行直接进人设提示词的熟练度描述；**没有够得上 1 级的记录时返回空串**
 * （`bridge/persona-prompt.ts:146` 只在非空时渲染，所以空串 = 这一行根本不出现）。
 *
 * 只说两件可复算的事：几级、练了几次（打回过的补一句打回几张）。
 */
export function skillLineForPrompt(world: SkillSources, agentId: string): string {
  // 一行最多说三条：prompt 里这只是一句"手感"，不是看板。
  // 0 级不出现——练过一次还没长出本事，写成"0 级"只会吓人。
  const rows = skillsOf(world, agentId).filter((row) => row.level > 0).slice(0, 3)
  if (rows.length === 0) return ''
  const parts = rows.map((row) => {
    const done = '练了 ' + String(row.sample) + ' 次'
    const bounced = row.failed === 0 ? '' : '，打回 ' + String(row.failed) + ' 张'
    return skillLabel(row.skill) + ' ' + String(row.level) + ' 级（' + done + bounced + '）'
  })
  return '你干这行的手感：' + parts.join('、')
}
