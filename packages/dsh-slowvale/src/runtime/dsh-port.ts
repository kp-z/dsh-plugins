
/**
 * DSH 会话端口 —— 真的把话递给 DSH 的 Agent。
 *
 * ## 依赖按"实际用到的"算
 *
 * 两件服务：\`sessionController.prompt\`（发话）与 \`ctx.on('session/event')\`（收话）。
 * 任何一件缺了，\`createDshPort\` 返回 undefined——由调用方换成不可用端口并给出人话原因，
 * 而不是在第一次说话时才炸。
 *
 * ## 为什么不让端口自己建会话
 *
 * 建会话是**宿主的事**（谁付钱、用哪个模型、什么权限都是宿主决定的）。
 * 端口只接受"已经存在的一个会话 id"：\`attach(sessionId)\`。
 * 这样插件既能在用户自己开的会话上工作，也能在 H6 派活时由上层创建。
 *
 * ## 事件形状的假设（下一小时真机验）
 *
 * 回复从 \`session/event\` 里取：\`event.type === 'assistant/message'\`，
 * 文本在 \`event.message.content[].text\`。这个形状取自 agent-world 的 decode 模块，
 * 但**没有真机验证过**，所以抽成了 \`extractReply\` 可替换参数。
 */
import type { Channel } from '../model/persona.js'
import { SessionError, type OpenSessionInput, type SessionPort } from './session-port.js'

type AnyRecord = Record<string, unknown>

function pluck(target: unknown, key: string): ((...args: unknown[]) => unknown) | undefined {
  if (typeof target !== 'object' || target === null) return undefined
  const value = (target as AnyRecord)[key]
  return typeof value === 'function' ? (value as (...args: unknown[]) => unknown) : undefined
}

/** 极简的服务读取：宿主可能用 get 也可能挂属性。 */
function serviceOf(ctx: unknown, name: string): unknown {
  const get = pluck(ctx, 'get')
  if (get !== undefined) {
    try {
      const found = get.call(ctx, name)
      if (found !== undefined && found !== null) return found
    } catch {
      // 没挂这个服务时 get 可能抛；退回属性访问
    }
  }
  return typeof ctx === 'object' && ctx !== null ? (ctx as AnyRecord)[name] : undefined
}

/** 默认的回复提取：只认 assistant 消息，取文本片段。 */
export function defaultExtractReply(event: AnyRecord): string | null {
  if (event.type !== 'assistant/message') return null
  const message = event.message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as AnyRecord).content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const part of content) {
    if (typeof part === 'object' && part !== null && typeof (part as AnyRecord).text === 'string') {
      parts.push((part as AnyRecord).text as string)
    }
  }
  return parts.length === 0 ? null : parts.join('')
}

export interface DshPortOptions {
  /** 默认 60 秒；超时按失败处理，不返回空串。 */
  replyTimeoutMs?: number
  /** 测试与真机差异的缓冲：默认上面那个提取器。 */
  extractReply?: (event: AnyRecord) => string | null
  /** 会话事件可能把会话包在对象里；默认读 session.id 或 sessionId。 */
  sessionIdOf?: (session: unknown) => string | null
  /** 发话时的客户端时区（宿主用于展示），可不给。 */
  clientTimeZone?: string
}

export interface DshPort extends SessionPort {
  /** 接上一个已经存在的 DSH 会话（角色 id → 会话 id 的映射由上层存）。 */
  attach(input: OpenSessionInput, sessionId: string): void
}

const DEFAULT_TIMEOUT_MS = 60_000

function defaultSessionIdOf(session: unknown): string | null {
  if (typeof session === 'string') return session
  if (typeof session !== 'object' || session === null) return null
  const record = session as AnyRecord
  if (typeof record.id === 'string') return record.id
  if (typeof record.sessionId === 'string') return record.sessionId
  return null
}

/** 建端口；缺服务返回 undefined（让调用方给出可读原因）。 */
export function createDshPort(ctx: unknown, options: DshPortOptions = {}): DshPort | undefined {
  const controller = serviceOf(ctx, 'sessionController')
  const prompt = pluck(controller, 'prompt')
  const on = pluck(ctx, 'on')
  if (prompt === undefined || on === undefined) return undefined

  const timeoutMs = options.replyTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const extractReply = options.extractReply ?? defaultExtractReply
  const sessionIdOf = options.sessionIdOf ?? defaultSessionIdOf
  const attached = new Map<string, string>()
  const waiting = new Map<string, (text: string) => void>()

  const maybeDispose = on.call(ctx, 'session/event', (session: unknown, event: unknown) => {
    const sessionId = sessionIdOf(session)
    if (sessionId === null) return
    if (typeof event !== 'object' || event === null) return
    const text = extractReply(event as AnyRecord)
    if (text === null) return
    const resolve = waiting.get(sessionId)
    if (resolve !== undefined) {
      waiting.delete(sessionId)
      resolve(text)
    }
  })
  void maybeDispose

  let counter = 0
  return {
    attach(input, sessionId) {
      attached.set(input.characterId, sessionId)
    },
    async open(input) {
      // 已经有该角色的会话就直接接上；否则如实说"需要一个会话"。
      const existing = attached.get(input.characterId)
      if (existing !== undefined) return { sessionId: existing }
      throw new SessionError(
        'DSH 端口不会自己创建会话：请先 attach 一个现有会话（' + input.characterId + '）',
      )
    },
    async say(sessionId, text) {
      const reply = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(sessionId)
          reject(new SessionError('等待 ' + sessionId + ' 回复超时（' + String(timeoutMs) + 'ms）'))
        }, timeoutMs)
        waiting.set(sessionId, (value) => {
          clearTimeout(timer)
          resolve(value)
        })
      })
      counter += 1
      const request = {
        requestId: 'slowvale-' + String(counter),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
        ...(options.clientTimeZone === undefined ? {} : { clientTimeZone: options.clientTimeZone }),
      }
      try {
        await prompt.call(controller, request, new AbortController().signal)
      } catch (error) {
        waiting.delete(sessionId)
        throw new SessionError('发话失败：' + (error instanceof Error ? error.message : String(error)))
      }
      return reply
    },
    async close(sessionId) {
      waiting.delete(sessionId)
    },
  }
}
