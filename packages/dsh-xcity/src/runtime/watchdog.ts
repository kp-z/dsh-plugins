/**
 * 「世界该不该被拉起来」的判断。
 *
 * 最初写成「有观众才推进」，理由是省 CPU。真机上暴露了两件事：
 * 1. 玩家把页面切走、或者只发短信不打开游戏，viewers 就是 0——
 *    于是世界冻在 tick 0，角色只会回一句「我出不了这儿」；
 * 2. 配置里的 autoStart 语义本来就是「是否推进」，再被观众数否决一次是矛盾的。
 *
 * 所以规则收敛成一句：**配置允许推进，就该推进**。观众数不再是开关。
 */
export interface WatchdogInput {
  /** 当前有几个 SSE 观众（游戏页开着就是 1）。仅用于诊断，不再参与判断。 */
  viewers: number
  /** 配置里是否允许推进。 */
  autoStart: boolean
  /** 运行时当前是否在跑。 */
  running: boolean
}

export function shouldRestartWorld(input: WatchdogInput): boolean {
  if (!input.autoStart) return false
  return !input.running
}
