/**
 * R502：每日计划的计数。
 *
 * 为什么需要它：上一轮给三种跳过写了日志，但 DSH 的日志不落 stdout，
 * 结果"提问没发生"既看不见原因也看不见次数。计划是低频动作，计数足够定位。
 */
export interface PlanStats {
  asked: number
  answered: number
  noBinding: number
  noModel: number
  noService: number
  failed: number
  applied: number
  /** 会话正忙（在跑别的轮次），本轮跳过。 */
  busy: number
  timeout: number
  promptError: number
}

export function createPlanStats(): PlanStats {
  return {
    asked: 0, answered: 0, noBinding: 0, noModel: 0, noService: 0,
    failed: 0, applied: 0, busy: 0, timeout: 0, promptError: 0,
  }
}
