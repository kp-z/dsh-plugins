/**
 * R541：熟练度——把"干过什么"派生成"多熟练"。**纯派生，零存档字段**。
 *
 * ## 为什么是派生，不是 Agent 上的 xp/level 字段
 *
 * 权威数据已经在世界里：`world.tasks` 保留**全部历史工单**（没有任何裁剪逻辑），
 * 每张单都带 `requires: Capability[]`、`status`、`owner`、`set/key`。
 * 熟练度只是它的一次投影——存成字段就会有两个真相（发放点与读点必然漂移），
 * 还要给老档补迁移。所以这里只做 `(world, agentId) → 数值`，同输入同输出。
 *
 * ## 口径：能力（`requires`），不是岗位（`suggestedRole`），不是情节（`Episode`）
 *
 * - **不用 `Episode`**：`domain/types.ts:218` 只有 tick/day/kind/summary/with/placeId/salience，
 *   里面没有技能或岗位；从摘要文字里猜"这张单算 engineering 还是 review"是脆的（改一句文案就全错）。
 * - **不用 `suggestedRole`**：一张单可能同时要 `code + review`（`default.ts:371-374`），
 *   而"哪条能力被练到了"只有 `requires` 说得准；岗位是"建议派给谁"，不是"干了什么"。
 * - 所以：**一张完工单给它 `requires` 里的每条能力各记一笔**（GROWTH.md §4.2 的口径）。
 *
 * ## 分怎么给（GROWTH.md §4.2 / §4.1）
 *
 * - 首次做一张单：`+25`；同一 `(set,key)` 第 2 次 `+10`，第 3 次起 `+5`。
 *   为什么按 `(set,key)` 而不是 `task.id`：同一套任务集可以**重复派单**（`state.ts:457`
 *   的 batch 语义，R45），第二批就是同一批 key。递减是为了压住"反复刷同一张廉价单"，
 *   而不是为了让老手变慢——第一笔永远是 25。
 * - **打回/没做成不扣分**，只记账（`failed`）。理由：失败原因常常与能力无关
 *   （依赖没到、团队取消、站点被占），扣分会让角色回避难单；且当前没有失败样本可标定。
 *
 * ## 衰减（荒废）为什么这一轮不做
 *
 * 决策是"本轮只做**算得出来 + 说得出来**"，行为变化留给 H37b。
 * 注意：`Task.finishedAtTick`（`domain/types.ts:377`）是存在的，所以"每条能力最后一次完工的 tick"
 * 今天就派生得出来、将来做衰减**不需要加字段**；本轮不做是因为衰减曲线还要三个没标定的数
 * （graceDays / perDay / floor，再加降级防抖缓冲，见 GROWTH.md §4.3、§7.3），不是缺数据。
 * **不许**拿 `Episode.tick` 冒充完工时间：情节 7 天就被裁，而且一条情节不记是哪张单。
 *
 * 学习块的 `+8`（GROWTH.md §4.2 的第二个结算入口）也不在派生里：`Activity` 只留最近若干条，
 * 且 `skill` 只在活动上，裁掉就没了；那条入口属于 R542。
 */
import type { Task } from '../domain/types.js'

/**
 * 每级门槛（**累计**分）：`need(n) = 20·n(n+1)/2` → 20 / 60 / 120 / 200 / 300。
 *
 * 依据是 `docs/research/GROWTH.md:231` 的曲线，不是随手拍的：按一张单 25 分算，
 * L1=1 张、L2=3 张、L3=5 张、L4=8 张、L5=12 张——3 人小镇一天做 3~6 张，
 * 于是"做几天就看得见变化"，又不至于第一天全员满级。
 */
export const LEVEL_THRESHOLDS: readonly number[] = [20, 60, 120, 200, 300]

/** 满级（= 门槛数）。 */
export const MAX_LEVEL = LEVEL_THRESHOLDS.length

/** 首次做一张单给多少分。 */
export const POINTS_FIRST = 25

/** 同一 `(set,key)` 第 2 次给多少分。 */
export const POINTS_REPEAT = 10

/** 同一 `(set,key)` 第 3 次起给多少分。 */
export const POINTS_AGAIN = 5

/**
 * 一行熟练度。`skill` 是能力原名（`code`/`review`/…），中文标签见 {@link skillLabel}。
 *
 * `sample` 与 `failed` 分开数：提示词要说"做成了几张、打回几张"，一个数字说不清同一件事。
 */
export interface SkillRow {
  /** 能力原名（`Capability` 的线值；世界被手改过时可能是任意字符串，原样带出）。 */
  skill: string
  /** 0..5。 */
  level: number
  /** 累计熟练度分。 */
  points: number
  /** 贡献了分的**完工**张数（打回的不算）。 */
  sample: number
  /** 打回/没做成的张数（只记账，不扣分）。 */
  failed: number
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

/** 一条能力的中间账。`seen` 记的是"这条能力下，这个 `(set,key)` 干过几次"。 */
interface Tally {
  points: number
  sample: number
  failed: number
  seen: Map<string, number>
}

/** 第几次做（1 起）给多少分。 */
function gainOf(times: number): number {
  if (times <= 1) return POINTS_FIRST
  return times === 2 ? POINTS_REPEAT : POINTS_AGAIN
}

/**
 * 扫一遍这个人的工单，按能力记账。
 *
 * **D5 式确定性**：先把他的单按 `ordinal`（创建序，`domain/types.ts:354` 要求一律用它排序）排好
 * 再扫，所以"第几次做"不依赖数组顺序；整整一局世界两次调用必得同值。
 */
function tallyOf(world: { tasks: readonly Task[] }, agentId: string): Map<string, Tally> {
  const out = new Map<string, Tally>()
  const rowOf = (skill: string): Tally => {
    const found = out.get(skill)
    if (found !== undefined) return found
    const created: Tally = { points: 0, sample: 0, failed: 0, seen: new Map() }
    out.set(skill, created)
    return created
  }

  const mine = world.tasks
    .filter((task) => task.owner === agentId && (task.status === 'done' || task.status === 'failed'))
    .sort((left, right) => left.ordinal - right.ordinal || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

  for (const task of mine) {
    for (const capability of task.requires) {
      const tally = rowOf(capability)
      if (task.status === 'failed') {
        tally.failed += 1
        continue
      }
      // 任务集内 key 唯一；跨集同名 key 是两件不同的活，所以重复的判定单位是 (set,key)。
      const key = task.set + '\u0000' + task.key
      const times = (tally.seen.get(key) ?? 0) + 1
      tally.seen.set(key, times)
      tally.points += gainOf(times)
      tally.sample += 1
    }
  }

  return out
}

/**
 * 这个人的熟练度，按"最拿手"排序（等级 → 分 → 张数 → 能力名，全序，保证确定性）。
 *
 * 只有**干成过至少一张**的能力才进榜：0 分的行当写进 prompt 只会吓人（"工程 0 级"）。
 * 打回只挂在他已经干成过的那条能力上（`failed`），不单独成行。
 */
export function skillsOf(world: { tasks: readonly Task[] }, agentId: string): SkillRow[] {
  const rows: SkillRow[] = []
  for (const [skill, tally] of tallyOf(world, agentId)) {
    if (tally.sample === 0) continue
    rows.push({
      skill,
      level: levelForPoints(tally.points),
      points: tally.points,
      sample: tally.sample,
      failed: tally.failed,
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
 * 一行直接进人设提示词的熟练度描述；**没任何记录时返回空串**
 * （`bridge/persona-prompt.ts:146` 只在非空时渲染，所以空串 = 这一行根本不出现）。
 *
 * 只说两件可复算的事：几级、做成了几张（打回过的补一句打回几张）。
 */
export function skillLineForPrompt(world: { tasks: readonly Task[] }, agentId: string): string {
  // 一行最多说三条：prompt 里这只是一句"手感"，不是看板。
  const rows = skillsOf(world, agentId).slice(0, 3)
  if (rows.length === 0) return ''
  const parts = rows.map((row) => {
    const done = '做成了 ' + String(row.sample) + ' 张'
    const bounced = row.failed === 0 ? '' : '，打回 ' + String(row.failed) + ' 张'
    return skillLabel(row.skill) + ' ' + String(row.level) + ' 级（' + done + bounced + '）'
  })
  return '你干这行的手感：' + parts.join('、')
}
