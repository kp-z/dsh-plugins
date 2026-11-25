/**
 * 会话事件 → 世界动作的判定规则。
 *
 * 为什么单独拎出来：这三件事原本都塞在 index.ts 的同一个 `session/event` 回调里——
 * 短信回执、工具→工位、对话气泡。它们互相独立，却共享一坨内联逻辑，
 * 结果就是"改一处怕碰坏另一处"，而且任何一条都无法单独断言。
 *
 * 这里只放**纯判断**：给定事件与上下文，回答"写不写回、发不发命令、发哪句话"。
 * 副作用（appendIncoming / runtime.enqueue / channel.publish）留在调用方。
 */

import { extractFrontendReply, pickReplyText } from './reply.js'

/** 世界上能被认出"是谁"的最小形状。 */
export interface SessionActor {
  id: string
  name: string
}

/**
 * 这条会话对应世界里的哪个角色。
 *
 * 三条路按可靠性排序：显式子 agent 绑定 → 当前激活会话的队长 → xcity 绑定表。
 * 都认不出来就返回 null（普通 profile 里大量会话与小镇无关，不该被硬塞一个角色）。
 */
export function actorForSession(input: {
  agents: readonly (SessionActor & { boundAgentId?: string | null })[]
  sessionId: string
  activeSessionId: string | null
  /** xcity 绑定：会话 -> 角色 id。 */
  characterOfSession?: (sessionId: string) => string | null
  /** xcity 绑定：角色 id -> 世界里的 agentId。 */
  agentOfCharacter?: (characterId: string) => string | null
}): SessionActor | null {
  const { agents, sessionId } = input
  if (sessionId === '') return null

  const bound = agents.find((agent) => agent.boundAgentId === sessionId)
  if (bound !== undefined) return bound

  if (sessionId === input.activeSessionId) {
    const lead = agents.find((agent) => agent.boundAgentId === null)
    if (lead !== undefined) return lead
  }

  const character = input.characterOfSession?.(sessionId) ?? null
  if (character === null) return null
  const agentId = input.agentOfCharacter?.(character) ?? null
  if (agentId === null) return null
  return agents.find((agent) => agent.id === agentId) ?? null
}

/** 消息块里的纯文本（气泡用：多段之间留空行）。 */
export function textOfBlocks(blocks: readonly unknown[]): string {
  return blocks
    .filter((block): block is { type: string; text: string } => {
      const b = block as Record<string, unknown>
      return b?.['type'] === 'text' && typeof b['text'] === 'string' && b['text'].trim() !== ''
    })
    .map((block) => block.text)
    .join('\n\n')
    .trim()
}

/**
 * 这条 assistant 消息该不该当成短信回执写回游戏？写什么？
 *
 * 只认"确实有一条短信在等回复"且没超时的那一条——否则每次普通对话都会往玩家手机里塞消息。
 */
export function smsReplyOf(input: {
  blocks: readonly unknown[]
  /** 这条短信被转发进会话的时刻；undefined = 没有在等回复。 */
  askedAt: number | undefined
  now: number
  ttlMs: number
}): string | null {
  const { askedAt } = input
  if (askedAt === undefined || input.now - askedAt >= input.ttlMs) return null
  return extractFrontendReply(pickReplyText(input.blocks))
}

/**
 * 会话事件要不要顺手让角色走一步？
 *
 * 只有游戏模式才做：工具调用 → 去工位干活；工具返回 → 收工。
 * 这是"看起来在干活"的最低成本映射，不参与任何业务判断。
 */
export function activityForEvent(input: {
  type: string
  blocks: readonly unknown[]
  agentId: string
  skillOf: (toolName: string) => string
}): { kind: 'agentActivity'; agentId: string; activity: 'work' | 'idle'; ticks: number; skill?: string } | null {
  if (input.type === 'tool/result') {
    return { kind: 'agentActivity', agentId: input.agentId, activity: 'idle', ticks: 0 }
  }
  if (input.type !== 'assistant/message') return null
  const tool = input.blocks.find((block) => (block as Record<string, unknown>)?.['type'] === 'tool-call')
  if (tool === undefined) return null
  const name = String((tool as Record<string, unknown>)['name'] ?? '')
  return { kind: 'agentActivity', agentId: input.agentId, activity: 'work', ticks: 60, skill: input.skillOf(name) }
}
