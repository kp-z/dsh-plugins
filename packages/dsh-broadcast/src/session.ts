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
  /** 与 tools 一一对应的动作摘要（名字 + 对象）。 */
  readonly actions: readonly ToolAction[]
}

export function decodeAssistantMessage(data: unknown): AssistantMessageInfo | null {
  if (!isRecord(data)) return null
  const message = data.message
  if (!isRecord(message) || message.role !== 'assistant') return null

  const content = Array.isArray(message.content) ? message.content : []
  const texts: string[] = []
  const tools: string[] = []
  const actions: ToolAction[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text)
    } else if (block.type === 'tool-call' && typeof block.name === 'string' && block.name !== '') {
      tools.push(block.name)
      actions.push({ name: block.name, detail: describeToolCall(block.name, block.arguments) })
    }
  }

  return {
    text: texts.join('\n\n'),
    turn: asNumber(data.turn, 0),
    step: asNumber(data.step, 0),
    tools,
    actions,
  }
}

/** 一条 tool-call 的摘要（名字 + 一个能看懂的对象）。 */
export interface ToolAction {
  readonly name: string
  /** 这一调用最值得说的那个参数（路径/命令/描述），已截断；没有就是 undefined。 */
  readonly detail: string | undefined
}

/** 从参数 JSON 里挑一个能说明「在干什么」的值。按工具名挑，绝不猜。 */
export function describeToolCall(name: string, rawArguments: unknown): string | undefined {
  if (typeof rawArguments !== 'string' || rawArguments.trim() === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim() !== '') return clipDetail(value)
    }
    return undefined
  }
  // run_code 的 code 是几千字，只有 description 值得给模型看
  if (name === 'run_code') return pick('description')
  return pick('file_path', 'path', 'command', 'url', 'pattern', 'query', 'description', 'prompt')
}

function clipDetail(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length <= 48 ? flat : `${flat.slice(0, 48)}…`
}

/**
 * 「这条 user/message 是谁说的」。
 *
 * 实测（真机日志）：`data.source.kind` 把来源分得很清楚——人说的话是 `user`，
 * 定时任务是 `schedule`；而运行环境、技能清单、插件指令、时间戳、后台任务回执、审批变更
 * 全都是**各自一条** user/message，带着自己的 kind。所以只认这两种，其余一律不算人话。
 * source 缺失（老日志）时按人话处理。
 */
const HUMAN_SOURCES = new Set(['user', 'schedule'])

/**
 * 定时任务的 user/message 是 `[SCHEDULE REMINDER]` + 一段 JSON（指令在 `reminder_prompt` 里）。
 * 直接把这坨 JSON 当「用户原话」喂给模型，等于让它去念 UUID。所以取出真正的指令。
 */
export function unwrapSchedule(text: string): string {
  const prefix = '[SCHEDULE REMINDER]'
  if (!text.startsWith(prefix)) return text
  // 真实形状（被压成一行后）：
  //   [SCHEDULE REMINDER] This is a scheduled message from the user schedule_id_json: "…"
  //   occurrence_at: … reminder_prompt_json: "…"
  // 指令在 reminder_prompt_json 里，是个 JSON 字符串（里面有 \n 与 \" 转义）。
  const single = /reminder_prompt_json:\s*("(?:[^"\\]|\\.)*")/.exec(text)
  const batch = /reminders_json:\s*(\[[\s\S]*?\])\s*(?:$|[a-z_]+_json:)/i.exec(text)
  const candidates = [single?.[1], batch?.[1]]
  for (const candidate of candidates) {
    if (candidate === undefined) continue
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (typeof parsed === 'string' && parsed.trim() !== '') return parsed.trim()
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (isRecord(item)) {
            const prompt = item['reminder_prompt']
            if (typeof prompt === 'string' && prompt.trim() !== '') return prompt.trim()
          }
        }
      }
    } catch {
      // 这条候选解不出来就试下一条
    }
  }
  return text
}

/**
 * 一条 user/message 里的**人话**。
 *
 * 真实日志里，用户那条消息后面常粘着 `<system-reminder>` 段（环境说明、记忆、技能清单），
 * 审批变更也会以 user/message 出现。这些都不是「用户要的活」，算进播报原料只会把模型带偏——
 * 所以先把它们剥掉，剥完什么都不剩就当没说过。
 */
export function decodeUserMessage(data: unknown): { readonly text: string; readonly fromHuman: boolean } | null {
  if (!isRecord(data)) return null
  const content = Array.isArray(data.content) ? data.content : []
  const texts: string[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
  }
  // 真实格式：用户的话在前，`<system-reminder>` 段在后；再后面还有几行运行时间统计。
  // 所以先按第一个 reminder 切开只取前半段，再去掉 harness 自己加的那几行。
  const stripped = texts
    .join('\n')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (stripped === '') return null
  const source = isRecord(data.source) ? data.source.kind : undefined
  const fromHuman = source === undefined || HUMAN_SOURCES.has(String(source))
  return { text: source === 'schedule' ? unwrapSchedule(stripped) : stripped, fromHuman }
}

/** 一条 tool/result 成没成。 */
export function decodeToolResult(data: unknown): { readonly callId: string; readonly ok: boolean } | null {
  if (!isRecord(data)) return null
  const message = data.message
  if (!isRecord(message)) return null
  const callId = typeof message.toolCallId === 'string' ? message.toolCallId : ''
  if (callId === '') return null
  return { callId, ok: message.isError !== true }
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
