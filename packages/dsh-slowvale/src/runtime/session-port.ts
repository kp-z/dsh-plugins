
/**
 * SessionPort —— 会话这一侧的**唯一接缝**。
 *
 * ## 为什么先定接缝再接线
 *
 * "接 DSH 会话"有两种实现：真的调 sessionController（要模型、要事件流），
 * 或者一个确定性替身（测试里一次模型都不调）。两者对上层应该是同一个东西。
 * 所以上层只认这个接口，DSH 适配器在 H2.5 补，测试用 ScriptedPort。
 *
 * ## 为什么 open 要带 contextText
 *
 * 会话不是"先建好再喂人格"，而是**开口那一刻才知道自己是谁**。
 * open 时的 contextText 就是 ContextBundle 的文本形态。
 */
import type { Channel } from '../model/persona.js'

export interface OpenSessionInput {
  /** 角色 id，用于日志与路由。 */
  characterId: string
  channel: Channel
  /** ContextBundle 渲染出来的文本：他是谁、什么场合、什么处境。 */
  contextText: string
}

export interface OpenedSession {
  sessionId: string
}

export interface SessionPort {
  open(input: OpenSessionInput): Promise<OpenedSession>
  /** 说话并等回复。失败要抛，不许静默吞掉（否则上层分不清"没回"和"没连上"）。 */
  say(sessionId: string, text: string): Promise<string>
  close(sessionId: string): Promise<void>
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionError'
  }
}

/** 打开记录：测试要检查"上下文真的送到会话里了吗"。 */
export interface ScriptedPort extends SessionPort {
  readonly opened: readonly OpenSessionInput[]
  readonly spoken: readonly { sessionId: string; text: string }[]
  /** 某个会话收到的上下文文本。 */
  contextOf(sessionId: string): string | null
}

/**
 * 确定性的替身：按**角色**排队回话，不调模型。
 *
 * 测试要验的是"路由对不对、上下文有没有送到"，不是"模型答得好不好"。
 * 把模型从单测里拿掉，失败才会指向真正的 bug。
 */
export function createScriptedPort(replies: Record<string, readonly string[]>): ScriptedPort {
  const opened: OpenSessionInput[] = []
  const spoken: { sessionId: string; text: string }[] = []
  const owner = new Map<string, string>()
  const cursor = new Map<string, number>()
  let counter = 0
  const port: ScriptedPort = {
    opened,
    spoken,
    contextOf(sessionId) {
      const index = Number(sessionId.slice(1)) - 1
      return opened[index]?.contextText ?? null
    },
    async open(input) {
      counter += 1
      const sessionId = 's' + String(counter)
      owner.set(sessionId, input.characterId)
      opened.push(input)
      return { sessionId }
    },
    async say(sessionId, text) {
      spoken.push({ sessionId, text })
      const characterId = owner.get(sessionId)
      if (characterId === undefined) throw new SessionError('未打开的会话：' + sessionId)
      const queue = replies[characterId]
      if (queue === undefined || queue.length === 0) throw new SessionError('没有为 ' + characterId + ' 准备台词')
      const index = cursor.get(characterId) ?? 0
      cursor.set(characterId, index + 1)
      return queue[Math.min(index, queue.length - 1)] ?? ''
    },
    async close(sessionId) {
      owner.delete(sessionId)
    },
  }
  return port
}

/** 宿主没挂会话服务时的替身：一开口就报清楚原因。 */
export function createUnavailablePort(reason: string): SessionPort {
  return {
    async open() {
      throw new SessionError(reason)
    },
    async say() {
      throw new SessionError(reason)
    },
    async close() {
      return
    },
  }
}
