/**
 * R528：意图归因计数——"角色为什么没有自选动作"。
 *
 * 为什么需要：H25 现场 40 人 / 容量 34，峰值 30 人没有座位，但"无站点等待活动 = 0"。
 * 这说明那些人**根本没产生意图**，而不是抢不到座；可 `intentOptions` 有十来条出口，
 * 从外面看不出是哪一支返回了空，只能回去读代码猜。
 *
 * 所以这里只做一件事：给每个出口记一格。**不是**行为开关、不进 World、不进存档——
 * 计数与决策无关，纯观测。
 */

/**
 * 一个出口。
 *
 * `ok` = 这一次真的拿到了意图；其余的键都是"为什么没拿到"，名字对应 intentOptions
 * 里那一档缺的东西（槽位 → 见 `sim/life.ts` 的编号注释）。
 */
export type IntentReason =
  /** 这一刻轮不到他自己安排：在走、在忙、手上有单，或已经有安排了。 */
  | 'not-available'
  /** 有单等人领：把人留给调度器，别先用"生活"占住。 */
  | 'task-ready'
  /** 饿了，但世界上一个茶水位（breakroom）都没有。 */
  | 'hungry-no-breakroom'
  /** 夜里想睡，但一个休息位都没有（连"去附近排队"的目标都挑不出来）。 */
  | 'night-no-rest'
  /** 累了要歇，但一个休息位都没有。 */
  | 'no-rest-station'
  /**
   * 想说话，但找不到能坐下的地方。
   *
   * 注意：当前代码里这一档**不致命**——社交没座位只是少一个候选，人会继续落到
   * 干活/学习那一档，于是整轮仍然拿到意图、记成 `ok`。所以这一格恒为 0 是**预期**，
   * 不是计数漏了。留着它，是因为"社交没位置"本身仍是可观测事实，等哪天真成了
   * 独立出口再接线。
   */
  | 'no-social-station'
  /** 上班的点想干活，但一个工位都没有。 */
  | 'no-work-station'
  /** 一圈走完（最后一档学习也没有站点）：没有任何可做的事。 */
  | 'need-null'
  /** 拿到意图了。 */
  | 'ok'

/**
 * 全部出口，顺序即梯形顺序（ok 在最后）。
 *
 * 快照里每个键**都在**，0 也要看得见：`byReason.no-work-station === 0` 本身就是结论
 * （"没座位不是工位的问题是床位的问题"），键缺失则读不出这个结论。
 */
export const INTENT_REASONS: readonly IntentReason[] = [
  'not-available',
  'task-ready',
  'hungry-no-breakroom',
  'night-no-rest',
  'no-rest-station',
  'no-social-station',
  'no-work-station',
  'need-null',
  'ok',
]

/** 一次读取的结果：总数 + 每个出口的次数。 */
export interface IntentStatsSnapshot {
  total: number
  byReason: Record<IntentReason, number>
}

/** 计数器。 */
export interface IntentStats {
  /** 记一次出口。只累加，不做任何判断。 */
  observe(reason: IntentReason): void
  /** 读一份**拷贝**：读到的人改不动计数。 */
  snapshot(): IntentStatsSnapshot
  /** 归零（测试与环境切换用）。 */
  reset(): void
}

/** 全零的一份计数表。 */
function emptyCounts(): Record<IntentReason, number> {
  const counts = {} as Record<IntentReason, number>
  for (const reason of INTENT_REASONS) counts[reason] = 0
  return counts
}

export function createIntentStats(): IntentStats {
  let total = 0
  let counts = emptyCounts()
  return {
    observe(reason: IntentReason): void {
      // 类型挡住了绝大多数误用；这里再挡一次"从 JSON/JS 传进来的野字符串"，
      // 免得 counts[野值] 变成 NaN 或凭空多一个键。
      if (!(reason in counts)) return
      counts[reason] += 1
      total += 1
    },
    snapshot(): IntentStatsSnapshot {
      return { total, byReason: { ...counts } }
    },
    reset(): void {
      total = 0
      counts = emptyCounts()
    },
  }
}

/**
 * 全局那一份：`sim/life.ts` 的每个出口往里记一笔，`routes/api.ts` 的快照把它读给外面看。
 *
 * 为什么是模块级单例而不是传参：`intentOptions` 是纯函数式内核，为了计数去改它
 * 以及所有调用方的签名，等于让"观测"污染"决策"；而这份计数本来就只关心进程内总量。
 */
export const intentStats = createIntentStats()
