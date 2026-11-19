/**
 * 事件接线：`session/event` → 累积这一轮 → `turn/end` 判定 → 洗文本 → 交给播放层。
 *
 * 状态（每个会话的当前轮）藏在这个闭包里，不导出、不共享；
 * 播放函数由外部注入，所以这层能在不联网、不出声的情况下被完整测试。
 */
import type { BroadcastConfig } from './config.js'
import { summarizeLocally } from './sanitize.js'
import { decodeAssistantMessage, decodeTurnEnd, isSubagentSession, sessionIdOf } from './session.js'
import { decideTurn, type TurnDecision, type TurnPolicy } from './turn.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 每个会话记住的东西。lastSpokenAt 跨轮保留（去抖要用），其余每轮清空。 */
interface TurnState {
  turn: number
  texts: string[]
  tools: string[]
  lastSpokenAt: number | undefined
}

/** 状态表上限：会话很多时别把内存撑爆（超了从头淘汰）。 */
const MAX_SESSIONS = 200

export interface SessionListenerDeps {
  readonly config: BroadcastConfig
  /** 真正出声的那一下（S1 的 speak 链）。失败要自己负责兜住。 */
  readonly speak: (text: string) => Promise<unknown>
  readonly now?: () => number
  /** 每次判定后回调，便于日志与测试断言。 */
  readonly onDecision?: (info: { sessionId: string; decision: TurnDecision; tools: readonly string[] }) => void
  readonly onError?: (error: unknown) => void
}

/** 从配置里取决策用的策略。 */
export function policyFromConfig(config: BroadcastConfig): TurnPolicy {
  return {
    enabled: config.enabled,
    announceSubagent: config.announceSubagent,
    announceFailure: config.announceFailure,
    minChars: config.minChars,
    debounceMs: config.debounceMs,
  }
}

export function createSessionListener(deps: SessionListenerDeps): (session: unknown, event: unknown) => void {
  const states = new Map<string, TurnState>()
  const now = deps.now ?? Date.now
  const policy = policyFromConfig(deps.config)

  const prune = (): void => {
    while (states.size > MAX_SESSIONS) {
      const oldest = states.keys().next()
      if (oldest.done === true) return
      states.delete(oldest.value)
    }
  }

  const emit = (sessionId: string, decision: TurnDecision, tools: readonly string[]): void => {
    try {
      deps.onDecision?.({ sessionId, decision, tools })
    } catch (error) {
      deps.onError?.(error)
    }
  }

  const announce = (sessionId: string, text: string, state: TurnState, tools: readonly string[], at: number): void => {
    const spoken = summarizeLocally(text, deps.config.maxChars)
    if (spoken === '') {
      emit(sessionId, { action: 'silent', reason: '洗完之后没剩下可念的话' }, tools)
      return
    }
    state.lastSpokenAt = at
    void deps.speak(spoken).catch((error: unknown) => deps.onError?.(error))
  }

  return function listener(session: unknown, event: unknown): void {
    const sessionId = sessionIdOf(session)
    if (sessionId === undefined) return
    if (!isRecord(event) || typeof event.type !== 'string') return

    if (event.type === 'assistant/message') {
      const decoded = decodeAssistantMessage(event.data)
      if (decoded === null) return
      const previous = states.get(sessionId)
      // 新的一轮：正文与工具清空，去抖时间保留
      const state: TurnState =
        previous === undefined || previous.turn !== decoded.turn
          ? { turn: decoded.turn, texts: [], tools: [], lastSpokenAt: previous?.lastSpokenAt }
          : previous
      if (decoded.text !== '') state.texts.push(decoded.text)
      state.tools.push(...decoded.tools)
      states.set(sessionId, state)
      prune()
      return
    }

    if (event.type !== 'turn/end') return
    const ended = decodeTurnEnd(event.data)
    if (ended === null) return

    const state = states.get(sessionId) ?? { turn: ended.turn, texts: [], tools: [], lastSpokenAt: undefined }
    const text = state.texts.join('\n\n')
    const at = now()
    const decision = decideTurn(
      {
        isSubagent: isSubagentSession(session),
        kind: ended.kind,
        text,
        now: at,
        lastSpokenAt: state.lastSpokenAt,
      },
      policy,
    )

    emit(sessionId, decision, state.tools)
    if (decision.action === 'speak') announce(sessionId, decision.text, state, state.tools, at)
    else if (decision.action === 'notice') {
      state.lastSpokenAt = at
      void deps.speak(decision.text).catch((error: unknown) => deps.onError?.(error))
    }

    // 这一轮结束了：正文与工具清空，会话状态留着（记去抖时间）
    state.turn = ended.turn
    state.texts = []
    state.tools = []
    states.set(sessionId, state)
  }
}
