/**
 * R500：向一个角色的 DSH 会话问一句话，并把**模型这一轮的原文**取回来。
 *
 * 为什么要单独一个模块：所有既有投递（短信/主动短信/工单）都只等到"已受理"，
 * 拿不到 assistant 文本（bridge/types.ts:240-241）。每日计划要的是结构化结果，
 * 只能自己认轮次。这里只做"投递 → 认一轮 → 收文本"，不碰世界、不碰存储。
 */
export interface SessionAskerDeps {
  /** 投递一句用户消息；语义与 sessionController.prompt 一致（返回即受理）。 */
  prompt: (payload: { sessionId: string; message: { role: 'user'; content: { type: 'text'; text: string }[] } }, signal: AbortSignal) => Promise<void>
  /** 超时多久放弃（毫秒）。缺省 120s：冷会话 + 长上下文的第一轮常常超过 45s。 */
  timeoutMs?: number
  /** 失败原因（投递抛错 / 超时）。默认丢弃；接线方用它计数与定位。 */
  onFailure?: (reason: 'prompt-error' | 'timeout') => void
}

export interface SessionAsker {
  /** 问一句；拿到这一轮的 assistant 原文，超时/失败返回 null。 */
  ask: (sessionId: string, text: string) => Promise<string | null>
  /** 由宿主的 session/event 回调喂进来。 */
  observe: (sessionId: string, type: string, data: unknown) => void
  /** 取消所有在途提问（插件卸载）。 */
  stop: () => void
}

interface Pending {
  resolve: (text: string | null) => void
  timer: ReturnType<typeof setTimeout>
  abort: AbortController
}

/** 从 assistant 消息里取出纯文本；结构不认识就返回空串。 */
export function textOfMessage(data: unknown): string {
  const payload = (data ?? {}) as Record<string, unknown>
  const message = (payload['message'] ?? payload) as Record<string, unknown>
  const content = message['content']
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') { parts.push(block); continue }
    if (typeof block !== 'object' || block === null) continue
    const text = (block as Record<string, unknown>)['text']
    if (typeof text === 'string') parts.push(text)
  }
  return parts.join('')
}

export function createSessionAsker(deps: SessionAskerDeps): SessionAsker {
  const pending = new Map<string, Pending>()
  const timeoutMs = deps.timeoutMs ?? 120_000

  const settle = (sessionId: string, text: string | null): void => {
    const entry = pending.get(sessionId)
    if (entry === undefined) return
    pending.delete(sessionId)
    clearTimeout(entry.timer)
    entry.resolve(text)
  }

  return {
    async ask(sessionId, text) {
      // 一个会话同时只认一轮：上一轮没回来就问下一句，答案会张冠李戴。
      if (pending.has(sessionId)) return null
      const controller = new AbortController()
      const answer = new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          deps.onFailure?.('timeout')
          settle(sessionId, null)
        }, timeoutMs)
        pending.set(sessionId, { resolve, timer, abort: controller })
      })
      try {
        await deps.prompt({
          sessionId,
          message: { role: 'user', content: [{ type: 'text', text }] },
        }, controller.signal)
      } catch {
        deps.onFailure?.('prompt-error')
        settle(sessionId, null)
      }
      return await answer
    },
    observe(sessionId, type, data) {
      if (type !== 'assistant/message') return
      if (!pending.has(sessionId)) return
      const text = textOfMessage(data).trim()
      if (text === '') return
      settle(sessionId, text)
    },
    stop() {
      for (const [sessionId, entry] of pending) {
        clearTimeout(entry.timer)
        entry.abort.abort()
        entry.resolve(null)
        pending.delete(sessionId)
      }
    },
  }
}
