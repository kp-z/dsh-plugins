/**
 * R517：一次模型轮次的输入体积计数与超限提示。
 *
 * 为什么要它：插件拿不到宿主的 token 计数（那在模型侧），但会话事件里的文本长度是
 * 拿得到的。体积失控时，人只能在账单或"上下文被截断"里发现；这里给一条早提示。
 *
 * **这不是计费**：字符数 ≠ token，token ≠ 钱。中文、代码、JSON 的字符/token 比差很多
 * （约 1.5–4 字符/token），所以阈值只按量级定，用来发现上下文膨胀，不能拿来对账。
 *
 * 为什么保持纯：事件形状会变，解析属于调用方（`session/event` 监听）；这里只收已经
 * 算好的字符数。这样它可单测，也不会因为宿主事件字段改名而悄悄记成 0。
 */

/**
 * 默认提示线：120_000 字符/轮。
 *
 * 依据：中英混排按约 4 字符/token 粗估 ≈ 30k token，已吃掉 32k 上下文窗口的绝大部分，
 * 但在 128k 窗口里仍属低段。选这个量级是为了"够早"，不对齐任何模型的硬上限——
 * 各模型的窗口与压缩策略不同，写死某个 token 数只会误导。
 */
export const DEFAULT_WARN_INPUT_CHARS = 120_000

/** 累计快照。每次 `snapshot()` 都是新对象，调用方可以放心留着。 */
export interface TurnCostSnapshot {
  /** 已结算的轮次数。 */
  turns: number
  /** 累计输入字符数（本轮 user/message 文本 + 工具结果，由调用方统计）。 */
  inputChars: number
  /** 累计输出字符数（assistant 文本）。 */
  outputChars: number
  /** 每轮平均输入字符数（四舍五入；还没有轮次时为 0）。 */
  avgInputChars: number
  /** 超过提示线的轮次数。 */
  warns: number
}

/**
 * 一轮超限时返回的信号。
 *
 * 只带本轮的数和提示线：调用方据此记日志或指标。模块自己什么都不写——是否落日志、
 * 落哪里是宿主的事，纯计数器不该知道。
 */
export interface TurnCostWarning {
  inputChars: number
  warnInputChars: number
}

export interface TurnCostOptions {
  /** 单轮输入字符数超过它才提示；缺省用 `DEFAULT_WARN_INPUT_CHARS`。 */
  warnInputChars?: number
}

export interface TurnCost {
  /**
   * 结算一轮，返回超限信号（没超就是 `null`）。
   *
   * 每轮只该调一次：调用方在轮次结束（`turn/end`）时结算。连续超限的每一轮都会
   * 各返回一次信号——`warns` 记的是"超限轮数"，不是"是否曾经超限"。
   */
  observe(inputChars: number, outputChars?: number): TurnCostWarning | null
  snapshot(): TurnCostSnapshot
}

/** 字符数归一：非正数与 NaN/Infinity 按 0，正小数向下取整——上游算错不该让计数崩。 */
function charsOf(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** 提示线归一：非法值（0、负数、NaN）退回默认，避免"每轮都告警"或"永不告警"。 */
function resolveWarnInputChars(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_WARN_INPUT_CHARS
  return Math.floor(value)
}

export function createTurnCost(options: TurnCostOptions = {}): TurnCost {
  const warnInputChars = resolveWarnInputChars(options.warnInputChars)
  let turns = 0
  let inputChars = 0
  let outputChars = 0
  let warns = 0

  return {
    observe(input, output = 0) {
      const turnInput = charsOf(input)
      turns += 1
      inputChars += turnInput
      outputChars += charsOf(output)
      // "超过"是严格大于：正好压在线上不提示，否则线就不再是线。
      if (turnInput <= warnInputChars) return null
      warns += 1
      return { inputChars: turnInput, warnInputChars }
    },
    snapshot() {
      return {
        turns,
        inputChars,
        outputChars,
        avgInputChars: turns === 0 ? 0 : Math.round(inputChars / turns),
        warns,
      }
    },
  }
}
