/**
 * dsh-broadcast —— 会话结束语音播报。
 *
 * 当前阶段：S3（说人话）。每轮结束先让宿主的模型把这一轮讲成 2–3 句口语，
 * 再交给 S1 的播放链念出来；模型不可用/超时/返回空就回落到本地截断。
 * 阶段表见 `docs/plans/dsh-broadcast.md`。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { speak } from './announce.js'
import { BroadcastConfig, resolveConfig } from './config.js'
import { summarizeReply, type HostServicesLike } from './summarizer.js'
import { createSessionListener, type SummaryInput } from './wiring.js'

export { BroadcastConfig }
export const name = 'broadcast'
export const inject = ['tools']

export function apply(ctx: Context, raw: Partial<BroadcastConfig> = {}) {
  const config = resolveConfig(raw)
  const logger = ctx.logger('broadcast')
  logger.info('dsh-broadcast 已加载（enabled=%s engine=%s voice=%s useModel=%s）', config.enabled, config.engine, config.voice, config.useModel)

  /** 现取宿主服务：服务可能晚于本插件挂上来，宿主重载后旧句柄也不该认死。 */
  const hostServices = (): HostServicesLike => {
    const pick = <T>(name: string): T | undefined => {
      try {
        return (ctx.get(name) as T | undefined) ?? undefined
      } catch {
        // 宿主服务不可用时 get 可能抛，探测失败就当没有
        return undefined
      }
    }
    return { llm: pick('llm'), defaultModel: pick('agentDefaultModel') }
  }

  // 播放串行化：两条会话同时结束也不能叠音（前一条念完再念下一条）。
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = (text: string): Promise<unknown> => {
    queue = queue.then(() => speak(text, config)).catch((error: unknown) => {
      logger.warn('播报失败：%s', error instanceof Error ? error.message : String(error))
    })
    return queue
  }

  ctx.tools.register(defineTool({
    name: 'broadcast_say',
    description:
      '把一段文字念出来（调试用，手动触发一次播报）。会联网调用 edge-tts 合成语音，'
      + '失败自动回落到系统 say；音频只落在临时目录、播完即删。它不受总开关控制。',
    parameters: {
      text: {
        type: 'string',
        required: true,
        description: '要念的文字，建议 80 字以内（太长会按配置截断）',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const result = await speak(args.text, config, { signal: exec.signal })
      const engine = result.engine === 'edge' ? 'edge-tts' : 'say 兜底'
      const reason = result.fallbackReason ? `；回落原因：${result.fallbackReason}` : ''
      logger.info('手动播报完成（%s，%dms）%s', engine, result.ms, reason)
      return `已播报（${engine}，${result.ms}ms）${reason}`
    },
  }))

  /** 文案：模型先说人话，失败/超时/空内容就回落到本地截断（落哪一级都记一行日志）。 */
  const summarize = async (input: SummaryInput): Promise<{ text: string }> => {
    const result = await summarizeReply({
      ...input,
      maxChars: config.maxChars,
      useModel: config.useModel,
      timeoutMs: config.modelTimeoutMs,
      services: hostServices(),
    })
    if (result.source === 'model') {
      logger.debug('播报文案来自模型（%s，%dms）', result.channel, result.ms)
    } else {
      logger.info('播报文案回落到 %s：%s', result.source, result.reason ?? '')
    }
    return { text: result.text }
  }

  const listener = createSessionListener({
    config,
    speak: enqueue,
    summarize,
    onDecision: ({ sessionId, decision, tools }) => {
      if (decision.action === 'silent') {
        logger.debug('跳过播报（%s）：%s', sessionId, decision.reason)
        return
      }
      logger.info('播报（%s，用了 %d 个工具）', sessionId, tools.length)
    },
    onError: (error) => {
      logger.warn('播报链路异常：%s', error instanceof Error ? error.message : String(error))
    },
  })

  // 插件 ctx 没有 scope 标签，能收到主会话与各子代理的全部事件。
  ctx.on('session/event', listener)
}
