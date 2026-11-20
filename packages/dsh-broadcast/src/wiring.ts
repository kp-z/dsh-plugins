/**
 * 事件接线：`session/event` → 累积这一轮 → `turn/end` 判定 → 生成播报文案 → 交给播放层。
 *
 * 文案怎么来由外面决定（S3 的模型改写 / 本地截断），这层只管三件事：
 * 累积、判定、去重（同一轮 `turn/end` 重复到达时不重复播）。
 * 播放函数也是注入的，所以整层能在不联网、不出声的情况下被完整测试。
 */
import type { BroadcastConfig } from './config.js'
import { summarizeLocally } from './sanitize.js'
import {
  decodeAssistantMessage,
  decodeTurnEnd,
  decodeUserMessage,
  isSubagentSession,
  sessionIdOf,
  type ToolAction,
} from './session.js'
import { decideTurn, inQuietHours, type TurnDecision, type TurnPolicy } from './turn.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 生成播报文案的入参。原料越具体，模型越能说「你让我做的事做到哪了」。 */
export interface SummaryInput {
  /** 用户这一轮的原话。 */
  readonly ask: string
  readonly text: string
  readonly tools: readonly string[]
  /** 做过的事（名字 + 对象），按顺序。 */
  readonly actions: readonly ToolAction[]
  readonly kind: string
}

/** 每个会话记住的东西。 */
interface TurnState {
  turn: number
  /** 用户这一轮的原话（多句取最后一句非审批的）。 */
  ask: string
  texts: string[]
  tools: string[]
  actions: ToolAction[]
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
    quietHours: config.quietHours,
  }
}

export function createSessionListener(deps: SessionListenerDeps): (session: unknown, event: unknown) => void {
  const states = new Map<string, TurnState>()
  const now = deps.now ?? Date.now
  const summarize = deps.summarize ?? (async (input) => ({ text: summarizeLocally(input.text, deps.config.maxChars) }))

  const prune = (): void => {
    while (states.size > MAX_SESSIONS) {
      const oldest = states.keys().next()
      if (oldest.done === true) return
      states.delete(oldest.value)
    }
  }

  /** 新一轮的空状态；同一轮就沿用原来的（新事件不该把已累积的东西清掉）。 */
  const stateFor = (previous: TurnState | undefined, turn: number): TurnState => {
    if (previous !== undefined && previous.turn === turn) return previous
    return {
      turn,
      ask: previous?.ask ?? '',
      texts: [],
      tools: [],
      actions: [],
      lastSpokenAt: previous?.lastSpokenAt,
      handledTurn: previous?.handledTurn,
    }
  }
  /** 事件里带的 turn（user/message 也有，但类型上是 unknown）。 */
  const asTurn = (data: unknown): number | undefined => {
    if (!isRecord(data)) return undefined
    const turn = data.turn
    return typeof turn === 'number' && Number.isFinite(turn) ? turn : undefined
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

    // 用户这一轮要什么：这是「汇报」和「复述」的分水岭
    if (event.type === 'user/message') {
      const decoded = decodeUserMessage(event.data)
      if (decoded !== null && decoded.fromHuman) {
        const previous = states.get(sessionId)
        const turn = asTurn(event.data) ?? previous?.turn ?? 0
        const state = stateFor(previous, turn)
        // 多句时说最后一句：前面的多半是背景，最后一句才是要求
        state.ask = decoded.text
        states.set(sessionId, state)
        prune()
      }
      return
    }

    if (event.type === 'assistant/message') {
      const decoded = decodeAssistantMessage(event.data)
      if (decoded === null) return
      const state = stateFor(states.get(sessionId), decoded.turn)
      if (decoded.text !== '') state.texts.push(decoded.text)
      state.tools.push(...decoded.tools)
      state.actions.push(...decoded.actions)
      states.set(sessionId, state)
      prune()
      return
    }

    if (event.type !== 'turn/end') return
    const ended = decodeTurnEnd(event.data)
    if (ended === null) return

    const state: TurnState = states.get(sessionId) ?? stateFor(undefined, ended.turn)

    // 同一轮重复到达（重放、宿主重复提交）：不重复播
    if (state.handledTurn === ended.turn) {
      emit(sessionId, { action: 'silent', reason: '同一轮已经处理过' }, state.tools)
      return
    }
    state.handledTurn = ended.turn

    const text = state.texts.join('\n\n')
    const at = now()
    // 策略每轮现算：总开关可以在运行时被对话框里的按钮改掉
    const decision = decideTurn(
      {
        isSubagent: isSubagentSession(session),
        kind: ended.kind,
        text,
        now: at,
        lastSpokenAt: state.lastSpokenAt,
        quietNow: inQuietHours(new Date(at), deps.config.quietHours),
      },
      policyFromConfig(deps.config),
    )

    emit(sessionId, decision, state.tools)

    if (decision.action === 'notice') {
      state.lastSpokenAt = at
      void deps.speak(decision.text).catch((error: unknown) => deps.onError?.(error))
    } else if (decision.action === 'speak') {
      // 判定通过就记下时间：文案生成可能要等模型，去抖不该被这段延迟绕过
      state.lastSpokenAt = at
      void announce(sessionId, {
        ask: state.ask,
        text,
        tools: state.tools,
        actions: state.actions,
        kind: ended.kind,
      }).catch((error: unknown) => deps.onError?.(error))
    }

    // 这一轮结束了：正文与工具清空，会话状态留着（记去抖与去重）
    state.turn = ended.turn
    state.texts = []
    state.tools = []
    states.set(sessionId, state)
  }
}
