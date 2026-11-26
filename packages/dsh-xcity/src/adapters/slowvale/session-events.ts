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

import { extractFrontendReply } from './reply.js'

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
 * 会话事件要不要顺手让角色走一步？
 *
 * 一律做：工具调用 → 去工位干活；工具返回 → 收工。
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

/** Bind a delivered SMS prompt to the DSH turn that consumed it. */
export function createSmsReplyTracker(ttlMs: number, now = Date.now) {
  type Pending = { peerRoleId: string; kind: 'player-sms' | 'initiative'; expiresAt: number }
  type State = { queued: Map<string, Pending>; turn?: number; smsTurn?: number; pending?: Pending | undefined }
  const sessions = new Map<string, State>()
  const prune = (sessionId: string, state: State): void => {
    for (const [text, pending] of state.queued) {
      if (now() >= pending.expiresAt) state.queued.delete(text)
    }
    if (state.queued.size === 0 && state.smsTurn === undefined) sessions.delete(sessionId)
  }
  return {
    track(peerRoleId: string, sessionId: string, text: string, kind: 'player-sms' | 'initiative' = 'player-sms'): () => void {
      const state = sessions.get(sessionId) ?? { queued: new Map<string, Pending>() }
      const pending = { peerRoleId, kind, expiresAt: now() + ttlMs }
      state.queued.set(text, pending)
      sessions.set(sessionId, state)
      return () => {
        state.queued.delete(text)
        if (state.pending === pending) delete state.pending
        prune(sessionId, state)
      }
    },
    observe(sessionId: string, type: string | undefined, data: Record<string, unknown> | undefined, blocks: readonly unknown[]) {
      const state = sessions.get(sessionId)
      if (state === undefined) return null
      const eventTurn = data?.['turn']
      if (typeof eventTurn === 'number' && type !== 'turn/end') state.turn = eventTurn
      if (type === 'turn/end' && typeof eventTurn === 'number' && eventTurn === state.smsTurn) {
        delete state.smsTurn
        delete state.pending
        prune(sessionId, state)
        return null
      }
      if (type === 'user/message') {
        const text = textOfBlocks(blocks)
        const pending = state.queued.get(text)
        if (pending !== undefined && state.turn !== undefined) {
          state.queued.delete(text)
          state.smsTurn = state.turn
          state.pending = pending
        } else if (state.smsTurn === state.turn && (data?.['source'] as { kind?: unknown } | undefined)?.kind === 'user') {
          // R473：只有真正的用户发言才算"另一个请求"。同一轮里 runtime-context /
          // time-context / plugin:* / model-selection 是宿主自动补的上下文，不是插队，
          // 之前一律清掉待回写，真实会话于是每轮都把短信回复丢掉。
          state.pending = undefined
        }
      }
      prune(sessionId, state)
      if (state.smsTurn === undefined || state.turn !== state.smsTurn) return null
      const pending = state.pending
      const text = type === 'assistant/message' && pending && now() < pending.expiresAt
        ? extractFrontendReply(textOfBlocks(blocks)) : null
      if (text === null || pending === undefined) return { reply: null }
      state.pending = undefined
      return { reply: { peerRoleId: pending.peerRoleId, text, kind: pending.kind } }
    },
  }
}
