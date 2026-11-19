/**
 * 事件接线：`session/event` → 累积这一轮 → `turn/end` 判定 → 生成播报文案 → 交给播放层。
 *
 * 文案怎么来由外面决定（S3 的模型改写 / 本地截断），这层只管三件事：
 * 累积、判定、去重（同一轮 `turn/end` 重复到达时不重复播）。
 * 播放函数也是注入的，所以整层能在不联网、不出声的情况下被完整测试。
 */
import type { BroadcastConfig } from './config.js'
import { summarizeLocally } from './sanitize.js'
import { decodeAssistantMessage, decodeTurnEnd, isSubagentSession, sessionIdOf } from './session.js'
import { decideTurn, type TurnDecision, type TurnPolicy } from './turn.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 生成播报文案的入参。 */
export interface SummaryInput {
  readonly text: string
  readonly tools: readonly string[]
  readonly kind: string
}

/** 每个会话记住的东西。 */
interface TurnState {
  turn: number
  texts: string[]
  tools: string[]
  /** 上次真正出声的时间（去抖用，跨轮保留）。 */
  lastSpokenAt: number | undefined
  /** 上一轮已经处理过 `turn/end` 的轮次号（重复事件去重用）。 */
  handledTurn: number | undefined
}

/** 状态表上限：会话很多时别把内存撑爆（超了从头淘汰）。 */
const MAX_SESSIONS = 200

export interface SessionListenerDeps {
  readonly config: BroadcastConfig
  /** 真正出声的那一下（S1 的 speak 链）。失败要自己负责兜住。 */
  readonly speak: (text: string) => Promise<unknown>
  /** 文案生成（默认本地截断；S3 在 index 里注入模型改写）。 */
  readonly summarize?: (input: SummaryInput) => Promise<{ text: string }>
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
  const summarize = deps.summarize ?? (async (input) => ({ text: summarizeLocally(input.text, deps.config.maxChars) }))

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

  /** 出一次声：先生成文案，再交给播放层。去抖时间由调用方在判定时就记下（不在这里等）。 */
  const announce = async (sessionId: string, input: SummaryInput): Promise<void> => {
    const summary = await summarize(input)
    if (summary.text === '') {
      emit(sessionId, { action: 'silent', reason: '文案为空' }, input.tools)
      return
    }
    await deps.speak(summary.text)
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
          ? {
              turn: decoded.turn,
              texts: [],
              tools: [],
              lastSpokenAt: previous?.lastSpokenAt,
              handledTurn: previous?.handledTurn,
            }
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

    const state: TurnState = states.get(sessionId) ?? {
      turn: ended.turn,
      texts: [],
      tools: [],
      lastSpokenAt: undefined,
      handledTurn: undefined,
    }

    // 同一轮重复到达（重放、宿主重复提交）：不重复播
    if (state.handledTurn === ended.turn) {
      emit(sessionId, { action: 'silent', reason: '同一轮已经处理过' }, state.tools)
      return
    }
    state.handledTurn = ended.turn

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

    if (decision.action === 'notice') {
      state.lastSpokenAt = at
      void deps.speak(decision.text).catch((error: unknown) => deps.onError?.(error))
    } else if (decision.action === 'speak') {
      // 判定通过就记下时间：文案生成可能要等模型，去抖不该被这段延迟绕过
      state.lastSpokenAt = at
      void announce(sessionId, { text, tools: state.tools, kind: ended.kind }).catch((error: unknown) =>
        deps.onError?.(error),
      )
    }

    // 这一轮结束了：正文与工具清空，会话状态留着（记去抖与去重）
    state.turn = ended.turn
    state.texts = []
    state.tools = []
    states.set(sessionId, state)
  }
}
