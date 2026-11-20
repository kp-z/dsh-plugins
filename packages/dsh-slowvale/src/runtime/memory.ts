
/**
 * 记忆：把"聊过的事"变成可以注入的一小段。
 *
 * ## 为什么不直接把整段线程塞进 prompt
 *
 * 上下文是有成本的，而且越长越糊：模型会开始引用二十条之前的细节，说些没人问的事。
 * 所以记忆是**有损的**：只带最近几条，每条截断。宁可少记，不可糊成一团。
 *
 * ## 为什么记忆属于角色，不属于会话
 *
 * 会话会归档、会换。人不会。所以记忆的来源是**世界里的线程**，
 * 不是某个会话的历史；换一张嘴，他照样记得。
 */
import type { SmsMessage } from './messenger.js'

/** 默认只带最近 6 条：足够接上话头，又不会把上下文撑爆。 */
export const DEFAULT_MEMORY_LIMIT = 6

/** 每条最多 80 字：聊天里的长段落对"记得什么"没有帮助。 */
export const DEFAULT_MEMORY_CHARS = 80

export interface MemoryOptions {
  limit?: number
  maxChars?: number
  /** 角色 id → 说话人显示名；缺省用 id。 */
  nameOf?(id: string): string
}

/**
 * 线程 → 记忆片段。
 *
 * 保留**时间正序**（人回忆事情是按顺序的），只保留最后 limit 条。
 * 玩家说的和自己说的都要标注说话人——否则模型分不清哪句是自己说过的。
 */
export function memoryFromThread(
  messages: readonly SmsMessage[],
  characterId: string,
  options: MemoryOptions = {},
): string[] {
  const limit = options.limit ?? DEFAULT_MEMORY_LIMIT
  const maxChars = options.maxChars ?? DEFAULT_MEMORY_CHARS
  const nameOf = options.nameOf ?? ((id: string) => id)
  const recent = messages.slice(-limit)
  return recent.map((message) => {
    const speaker = message.from === 'player' ? '对方' : nameOf(message.from)
    const text = message.text.length > maxChars ? message.text.slice(0, maxChars) + '…' : message.text
    return speaker + '：' + text
  })
}

/** 判断一句"你是不是忘了"的问法有没有依据（诊断用）。 */
export function mentionsAny(memory: readonly string[], keyword: string): boolean {
  return memory.some((line) => line.includes(keyword))
}

/** 给 CharacterSessions.open 用的便捷包装。 */
export function memoriesFor(
  messages: readonly SmsMessage[],
  characterId: string,
  options: MemoryOptions = {},
): string[] {
  if (messages.length === 0) return []
  return memoryFromThread(messages, characterId, options)
}
