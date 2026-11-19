/**
 * 会话事件解码：把 `ctx.on('session/event')` 拿到的 `unknown` 变成能用的字段。
 *
 * 形状照抄本仓 `dsh-agent-world/src/bridge/decode.ts`（真机验证过）：
 * - `assistant/message` 的 data 是 `{ turn, step, message, stream?, usage?, interrupted? }`，
 *   正文在 `message.content` 的 `text` 块里；`tool-call` 块给出这次调了哪些工具。
 * - `turn/end` 的 data 是 `{ turn, reason }`，`reason.kind` 有 7 种（completed / aborted /
 *   blocked / error / max-tokens / interrupted，插件还能 merge 新的）。
 *
 * 为什么要解码而不是断言：事件总线对任何插件开放，别人能 append 自定义事件类型，
 * 所以这里一律按 `unknown` 处理，形状不对就返回 null（宁可不念，也不抛）。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 事件回调的 session 参数（真实类型是 Session），这里只按鸭子类型取用到的字段。 */
export function sessionIdOf(session: unknown): string | undefined {
  if (!isRecord(session)) return undefined
  const id = session.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * 是不是子代理会话。判据来自 `SessionHeader`：
 * 子会话带 `origin: 'subagent'`，且 `delegationDepth` 是父会话深度 + 1。
 * 顶层会话两者的默认值分别是 undefined / 0。
 */
export function isSubagentSession(session: unknown): boolean {
  if (!isRecord(session)) return false
  const header = session.header
  if (!isRecord(header)) return false
  if (header.origin === 'subagent') return true
  const depth = header.delegationDepth
  return typeof depth === 'number' && depth > 0
}

/** 一条 `assistant/message` 里的正文与工具名。正文可能为空（只有工具调用）。 */
export interface AssistantMessageInfo {
  readonly text: string
  readonly turn: number
  readonly step: number
  readonly tools: readonly string[]
}

export function decodeAssistantMessage(data: unknown): AssistantMessageInfo | null {
  if (!isRecord(data)) return null
  const message = data.message
  if (!isRecord(message) || message.role !== 'assistant') return null

  const content = Array.isArray(message.content) ? message.content : []
  const texts: string[] = []
  const tools: string[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text)
    } else if (block.type === 'tool-call' && typeof block.name === 'string' && block.name !== '') {
      tools.push(block.name)
    }
  }

  return {
    text: texts.join('\n\n'),
    turn: asNumber(data.turn, 0),
    step: asNumber(data.step, 0),
    tools,
  }
}

/** 一轮怎么结束的。`kind` 原样带出（不枚举死，插件可以扩展）。 */
export interface TurnEndInfo {
  readonly turn: number
  readonly kind: string
  readonly errorMessage: string | undefined
}

export function decodeTurnEnd(data: unknown): TurnEndInfo | null {
  if (!isRecord(data)) return null
  const reason = data.reason
  if (!isRecord(reason) || typeof reason.kind !== 'string' || reason.kind === '') return null

  const error = reason.error
  const errorMessage =
    reason.kind === 'error' && isRecord(error) && typeof error.message === 'string' ? error.message : undefined

  return { turn: asNumber(data.turn, 0), kind: reason.kind, errorMessage }
}
