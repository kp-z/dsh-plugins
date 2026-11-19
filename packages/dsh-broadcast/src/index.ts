/**
 * dsh-broadcast —— 会话结束语音播报。
 *
 * 当前阶段：S1（骨架 + 能出声）。对外只有一个手动触发的调试工具 `broadcast_say`，
 * 用来验证「真的能从扬声器出声」；自动播报（turn/end）在 S2 接上，
 * 阶段表见 `docs/plans/dsh-broadcast.md`。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { speak } from './announce.js'
import { BroadcastConfig, resolveConfig } from './config.js'

export { BroadcastConfig }
export const name = 'broadcast'
export const inject = ['tools']

export function apply(ctx: Context, raw: Partial<BroadcastConfig> = {}) {
  const config = resolveConfig(raw)
  const logger = ctx.logger('broadcast')
  logger.info('dsh-broadcast 已加载（enabled=%s engine=%s voice=%s）', config.enabled, config.engine, config.voice)

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
      logger.info('播报完成（%s，%dms）%s', engine, result.ms, reason)
      return `已播报（${engine}，${result.ms}ms）${reason}`
    },
  }))
}
