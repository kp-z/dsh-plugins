/**
 * S3：让模型把这一轮说成人话。
 *
 * 三条硬约束：
 * 1. **不自建密钥通道**：只调宿主的 `llm` 服务（`ctx.get('llm').stream`），路由取
 *    `agentDefaultModel.currentSelection()`——照 `dsh-contract-butler/src/hostAi.ts` 的注入式写法。
 * 2. **不阻塞播放**：6 秒拿不到就用本地截断，宁可念得糙，也不让用户干等。
 * 3. **三级回落**：模型 → 本地截断（首段）→ 原始首句。每一级都记下为什么降级。
 */
import { buildPrompt, type PromptInput } from './prompt.js'
import { cleanModelOutput, firstSentence, summarizeLocally } from './sanitize.js'

/** 宿主流里我们认得的两块（多的一律忽略）。 */
export interface LlmChunkLike {
  readonly type?: string
  readonly text?: string
  readonly reason?: { readonly kind?: string; readonly failure?: { readonly message?: string } }
}

/** `llm` 服务的最小面：只声明用到的那一个方法。 */
export interface LlmLike {
  stream(options: Record<string, unknown>): unknown
}

/** `agentDefaultModel` 服务的最小面。 */
export interface DefaultModelLike {
  currentSelection(): { provider?: string; model?: string } | null | undefined
}

/** 宿主服务的**现取**结果（服务可能晚挂上来，所以每次调用都重取）。 */
export interface HostServicesLike {
  readonly llm?: LlmLike | undefined
  readonly defaultModel?: DefaultModelLike | undefined
}

export interface SummarizeOptions extends PromptInput {
  /** 播报字数上限。 */
  readonly maxChars: number
  /** 模型超时（ms），默认 6000。 */
  readonly timeoutMs?: number
  /** 关掉就只用本地截断（省 token / 排查用）。 */
  readonly useModel?: boolean
  readonly services?: HostServicesLike
  readonly now?: () => number
}

export type SummarySource = 'model' | 'local' | 'raw'

export interface SummaryResult {
  readonly text: string
  readonly source: SummarySource
  /** 模型这次走的 `provider · model`（本地回落时为空）。 */
  readonly channel?: string
  readonly ms: number
  /** 降级原因（没降级就是空串）。 */
  readonly reason?: string
}

/** 挑路由：宿主选定的默认模型。挑不出来只给原因，不猜别的 provider。 */
export function pickRoute(services: HostServicesLike): { provider: string; model: string } | { reason: string } {
  if (services.llm === undefined) return { reason: '宿主没有 llm 服务' }
  const picker = services.defaultModel
  if (picker === undefined) return { reason: '宿主没有 agentDefaultModel 服务' }
  try {
    const selection = picker.currentSelection()
    const provider = typeof selection?.provider === 'string' ? selection.provider.trim() : ''
    const model = typeof selection?.model === 'string' ? selection.model.trim() : ''
    if (provider === '' || model === '') return { reason: '宿主没有选定默认模型' }
    return { provider, model }
  } catch {
    return { reason: '读宿主的默认模型时出错' }
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<LlmChunkLike> {
  return value !== null && typeof value === 'object' && Symbol.asyncIterator in (value as object)
}

function timeoutMessage(ms: number): string {
  return `模型超过 ${Math.round(ms / 1000)} 秒没有响应`
}

/** 把宿主的流收成一段文本；终止块说失败就抛。 */
async function collectStream(streamed: unknown, signal: AbortSignal, timeoutMs: number): Promise<string> {
  const parts: string[] = []
  let finish = ''
  let failure = ''
  const chunks = (isAsyncIterable(streamed) ? streamed : await streamed) as AsyncIterable<LlmChunkLike>
  if (!isAsyncIterable(chunks)) throw new Error('宿主的 llm.stream 没有返回可迭代的流')

  for await (const chunk of chunks) {
    if (chunk === null || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') parts.push(chunk.text)
    else if (chunk.type === 'finish') {
      finish = typeof chunk.reason?.kind === 'string' ? chunk.reason.kind : ''
      failure = typeof chunk.reason?.failure?.message === 'string' ? chunk.reason.failure.message : ''
    }
  }

  if (signal.aborted) throw new Error(timeoutMessage(timeoutMs))
  if (finish === 'error' || finish === 'aborted') throw new Error(`模型这一路失败了：${failure !== '' ? failure : finish}`)
  return parts.join('')
}

/** 超时是硬限制：宿主不认 signal 也不能把播报卡住。 */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage(timeoutMs))), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    void signal
  }
}

/**
 * 生成一句能念的播报。
 *
 * 返回值永远有内容（除非原料里真的一个字都念不出来，那时才抛）。
 * `source` 告诉你这次是模型写的，还是本地截断的——日志与调试都靠它。
 */
export async function summarizeReply(options: SummarizeOptions): Promise<SummaryResult> {
  const started = (options.now ?? Date.now)()
  const maxChars = options.maxChars
  const timeoutMs = options.timeoutMs ?? 6000
  const services = options.services ?? {}
  let reason = ''

  if (options.useModel !== false) {
    const route = pickRoute(services)
    if ('reason' in route) {
      reason = route.reason
    } else {
      try {
        const { system, user } = buildPrompt({ text: options.text, tools: options.tools, kind: options.kind })
        const signal = AbortSignal.timeout(timeoutMs)
        const streamed = (services.llm as LlmLike).stream({
          provider: route.provider,
          model: route.model,
          system,
          messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
          maxTokens: 200,
          signal,
        })
        const raw = await withTimeout(collectStream(streamed, signal, timeoutMs), timeoutMs, signal)
        const cleaned = cleanModelOutput(raw, maxChars)
        if (cleaned !== '') {
          return {
            text: cleaned,
            source: 'model',
            channel: `${route.provider} · ${route.model}`,
            ms: (options.now ?? Date.now)() - started,
          }
        }
        reason = '模型返回了空内容'
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error)
      }
    }
  } else {
    reason = '配置里关掉了模型改写'
  }

  const local = summarizeLocally(options.text, maxChars)
  if (local !== '') {
    return { text: local, source: 'local', ms: (options.now ?? Date.now)() - started, reason }
  }

  const raw = firstSentence(options.text, maxChars)
  if (raw !== '') {
    return { text: raw, source: 'raw', ms: (options.now ?? Date.now)() - started, reason }
  }

  throw new Error(`这一轮没有可播报的文字${reason !== '' ? `（${reason}）` : ''}`)
}
