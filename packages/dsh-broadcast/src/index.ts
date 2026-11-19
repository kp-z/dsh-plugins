/**
 * dsh-broadcast —— 会话结束语音播报。
 *
 * 当前阶段：S4（对话框开关 + 状态）。host 持有开关真值（持久化在 profile 目录），
 * 客户端只是遥控器：`/dsh-broadcast/state` 读写，播报中还能点一下停掉。
 * 阶段表见 `docs/plans/dsh-broadcast.md`。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { speak } from './announce.js'
import { BroadcastConfig, resolveConfig } from './config.js'
import { registerStateRoute } from './routes.js'
import { createSwitch } from './state.js'
import { summarizeReply, type HostServicesLike } from './summarizer.js'
import { createSessionListener, type SummaryInput } from './wiring.js'

export { BroadcastConfig }
export const name = 'broadcast'
export const inject = ['tools']

/** 日志器：沙箱可能不给 `ctx.logger`，但插件绝不能因此加载失败（那个后果是整个 profile 起不来）。 */
interface Logger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  debug(...args: unknown[]): void
}

function safeLogger(ctx: Context): Logger {
  try {
    return ctx.logger('broadcast') as unknown as Logger
  } catch {
    const fallback = (...args: unknown[]): void => {
      try { console.warn('[broadcast]', ...args) } catch { /* 连 console 都没有就算了 */ }
    }
    return { info: fallback, warn: fallback, debug: fallback }
  }
}

export function apply(ctx: Context, raw: Partial<BroadcastConfig> = {}) {
  const config = resolveConfig(raw)
  const logger = safeLogger(ctx)

  // 开关真值：持久化值优先（重启后保持），其次才是配置里的默认值。
  const sw = createSwitch({
    fallback: config.enabled,
    onPersistError: (error) => logger.warn('开关状态写盘失败：%s', error instanceof Error ? error.message : String(error)),
  })
  config.enabled = sw.isEnabled()
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

  /** 当前这条播报的取消手柄；speaking 只反映「扬声器里现在有没有声音」。 */
  let current: AbortController | null = null
  let speaking = false

  // 播放串行化：两条会话同时结束也不能叠音（前一条念完再念下一条）。
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = (text: string): Promise<unknown> => {
    const controller = new AbortController()
    current = controller
    speaking = true
    queue = queue
      .then(() => speak(text, config, { signal: controller.signal }))
      .catch((error: unknown) => {
        // 用户点了停止：这不是错误，别在日志里吓人一跳
        if (controller.signal.aborted) return
        logger.warn('播报失败：%s', error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (current === controller) {
          current = null
          speaking = false
        }
      })
    return queue
  }

  const stop = (): void => {
    current?.abort()
    current = null
    speaking = false
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

  // 对话框里的扬声器按钮：读开关、写开关、停掉正在播的那条。
  registerStateRoute(ctx, {
    isEnabled: () => sw.isEnabled(),
    setEnabled: async (next) => {
      config.enabled = next
      await sw.setEnabled(next)
      logger.info('播报开关 → %s', next ? '开' : '关')
    },
    isSpeaking: () => speaking,
    stop,
  })
}
