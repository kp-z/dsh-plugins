/**
 * dsh-broadcast —— 会话结束语音播报。
 *
 * 当前阶段：S2（触发 + 文本清洗）。每轮结束自动播报这一轮说了什么，
 * 但还没有「说人话」的模型改写（S3）：S2 的文案是本地清洗 + 首段截断。
 * 阶段表见 `docs/plans/dsh-broadcast.md`。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { speak } from './announce.js'
import { BroadcastConfig, resolveConfig } from './config.js'
import { createSessionListener } from './wiring.js'

export { BroadcastConfig }
export const name = 'broadcast'
export const inject = ['tools']

export function apply(ctx: Context, raw: Partial<BroadcastConfig> = {}) {
  const config = resolveConfig(raw)
  const logger = ctx.logger('broadcast')
  logger.info('dsh-broadcast 已加载（enabled=%s engine=%s voice=%s）', config.enabled, config.engine, config.voice)

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

  const listener = createSessionListener({
    config,
    speak: enqueue,
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
