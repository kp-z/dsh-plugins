
/**
 * 成本与稳定性的两道闸：预算与并发。
 *
 * ## 为什么放在"世界"这一层，而不是每个调用点各写一遍
 *
 * 模型调用是这个系统唯一的真金白银。它可能来自四个地方：玩家发短信、角色互聊、
 * 派活、日程唤醒。如果每个入口各自限流，上限就永远是"加起来不知道多少"。
 * 所以预算是**一个对象**，谁用谁扣。
 *
 * ## 为什么超时属于这里
 *
 * 端口各有各的超时，但"多久没回就不等了"是产品决定，不是传输细节。
 * 放在外面统一，换端口不会改变手感。
 */
export class BudgetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BudgetError'
  }
}

export interface BudgetOptions {
  /** 每 tick 允许的模型调用次数。 */
  perTick?: number
}

/** 每 tick 的调用预算。按 tick 计，因为一次交互的往返都在同一个 tick 内。 */
export class Budget {
  private readonly perTick: number
  private readonly used = new Map<number, number>()

  constructor(options: BudgetOptions = {}) {
    this.perTick = options.perTick ?? 16
  }

  /** 申请一次调用；超额直接拒，不排队（排队会让延迟变成不可控）。 */
  spend(tick: number, what = '模型调用'): void {
    const current = this.used.get(tick) ?? 0
    if (current >= this.perTick) {
      throw new BudgetError('本轮预算用完了（' + what + '，上限 ' + String(this.perTick) + ' 次/tick）')
    }
    this.used.set(tick, current + 1)
  }

  usedIn(tick: number): number {
    return this.used.get(tick) ?? 0
  }

  remaining(tick: number): number {
    return Math.max(0, this.perTick - this.usedIn(tick))
  }

  /** 世界往前走了：丢掉旧 tick 的计数，避免无界增长。 */
  forgetBefore(tick: number): void {
    for (const key of [...this.used.keys()]) if (key < tick) this.used.delete(key)
  }
}

export interface GuardOptions {
  /** 同时在飞的调用数上限。 */
  maxInFlight?: number
  /** 单次调用最长等待。 */
  timeoutMs?: number
}

export class GuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuardError'
  }
}

/**
 * 并发与超时。
 *
 * 并发**不排队**：满了就拒，并告诉调用方"现在忙"。排队会把"他反应慢"变成
 * "他过了很久突然说一句莫名其妙的话"，那比明确拒绝难查得多。
 */
export class Guard {
  private readonly maxInFlight: number
  private readonly timeoutMs: number
  private inFlight = 0

  constructor(options: GuardOptions = {}) {
    this.maxInFlight = options.maxInFlight ?? 4
    this.timeoutMs = options.timeoutMs ?? 60_000
  }

  get active(): number {
    return this.inFlight
  }

  /** 跑一次调用；并发满、超时都抛 GuardError。 */
  async run<T>(work: () => Promise<T>, what = '调用'): Promise<T> {
    if (this.inFlight >= this.maxInFlight) {
      throw new GuardError('同时在跑的' + what + '太多（上限 ' + String(this.maxInFlight) + '）')
    }
    this.inFlight += 1
    try {
      return await withTimeout(work(), this.timeoutMs, what)
    } finally {
      this.inFlight -= 1
    }
  }
}

/** 超时包装：超时就抛，不返回 undefined——"没回"和"返回空"是两件事。 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what = '调用'): Promise<T> {
  if (!(timeoutMs > 0)) throw new GuardError('超时时间必须为正数')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new GuardError(what + '超时（' + String(timeoutMs) + 'ms）')), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
