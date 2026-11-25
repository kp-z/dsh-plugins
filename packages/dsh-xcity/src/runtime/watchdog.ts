/**
 * 「世界该不该被拉起来」的判断。
 *
 * 最初写的是「有观众才推进」，理由是省 CPU。真机打脸：
 * 玩家把页面切走、或只发短信不开游戏时观众数是 0，世界就冻在 tick 0，
 * 角色只会回一句「我出不了这儿」。而配置里的 autoStart 本来就意味着「推进」，
 * 再被观众数否决一次是自相矛盾的。
 *
 * 所以只剩一件事要判断：**该推进却没在跑**。
 */
export interface WatchdogInput {
  /** 配置里是否允许推进。 */
  autoStart: boolean
  /** 运行时当前是否在跑。 */
  running: boolean
}

export function shouldRestartWorld(input: WatchdogInput): boolean {
  return input.autoStart && !input.running
}
