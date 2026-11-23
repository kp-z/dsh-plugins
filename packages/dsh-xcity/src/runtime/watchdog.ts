/**
 * 「有观众在，世界就不能冻」的判断。
 *
 * 为什么单独抽出来：这条规则原来写死在 index.ts 的 setInterval 里，只能靠重启 + 肉眼看验证。
 * 而它要回答的问题很窄——三个布尔量决定的策略，值得直接断言。
 */
export interface WatchdogInput {
  /** 当前有几个 SSE 观众（游戏页开着就是 1）。 */
  viewers: number
  /** 配置里是否允许推进。 */
  autoStart: boolean
  /** 运行时当前是否在跑。 */
  running: boolean
}

export function shouldRestartWorld(input: WatchdogInput): boolean {
  if (!input.autoStart) return false
  if (input.viewers <= 0) return false
  return !input.running
}
