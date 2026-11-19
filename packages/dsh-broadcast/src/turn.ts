/**
 * 该不该播（纯决策，表驱动测试）。
 *
 * 决策只依赖注入进来的一小撮事实，不读时钟、不碰 IO：
 * 会话是不是子代理、这一轮怎么结束的、回复多长、上次播报是什么时候。
 */

/** 播报策略（来自配置）。 */
export interface TurnPolicy {
  readonly enabled: boolean
  readonly announceSubagent: boolean
  readonly announceFailure: boolean
  readonly minChars: number
  readonly debounceMs: number
}

/** 一次 turn/end 的全部判定依据。 */
export interface TurnSignal {
  readonly isSubagent: boolean
  /** `turn/end` 的 `reason.kind`。 */
  readonly kind: string
  /** 这一轮累积的助手正文（未清洗）。 */
  readonly text: string
  readonly now: number
  /** 这个会话上次真正开口的时间；没播过就是 undefined。 */
  readonly lastSpokenAt: number | undefined
}

export type TurnDecision =
  | { readonly action: 'speak'; readonly text: string }
  | { readonly action: 'notice'; readonly text: string }
  | { readonly action: 'silent'; readonly reason: string }

/** 失败/中断时念的一句话：短、别吓人、说清「要不要你管」。 */
const NOTICES: Record<string, string> = {
  error: '这一轮出错了，需要你看一眼。',
  aborted: '这一轮被打断了。',
  blocked: '这一轮卡住了，需要你定个方向。',
  'max-tokens': '这一轮太长，被截断了。',
  interrupted: '这一轮被中断了。',
}

export function failureNotice(kind: string): string {
  return NOTICES[kind] ?? '这一轮没有正常收尾，需要你看一眼。'
}

/**
 * 判定顺序 = 优先级：
 * 总开关 → 子代理 → 收尾方式 → 太短 → 去抖。
 *
 * 为什么去抖放最后：只有「本来要念」的才需要压制，否则错误提示会被自己压掉。
 */
export function decideTurn(signal: TurnSignal, policy: TurnPolicy): TurnDecision {
  if (!policy.enabled) return { action: 'silent', reason: '总开关关闭' }
  if (signal.isSubagent && !policy.announceSubagent) return { action: 'silent', reason: '子代理会话默认静默' }

  if (signal.kind !== 'completed') {
    if (!policy.announceFailure) return { action: 'silent', reason: `这一轮是 ${signal.kind}，且关掉了失败提示` }
    return { action: 'notice', text: failureNotice(signal.kind) }
  }

  const length = signal.text.trim().length
  if (length < policy.minChars) return { action: 'silent', reason: `回复只有 ${length} 字，不值得开口` }

  if (
    signal.lastSpokenAt !== undefined
    && policy.debounceMs > 0
    && signal.now - signal.lastSpokenAt < policy.debounceMs
  ) {
    return { action: 'silent', reason: '刚播过，去抖' }
  }

  return { action: 'speak', text: signal.text }
}
