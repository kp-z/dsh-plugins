/**
 * dsh-broadcast —— 会话结束语音播报。
 *
 * 当前阶段：S0 骨架（能加载、能编译）。真正的播报在 S1/S2/S3 里长出来，
 * 阶段表见 `docs/plans/dsh-broadcast.md`。
 */
import type { Context } from '@deepseek-ai/cordis'
import { BroadcastConfig, resolveConfig } from './config.js'

export { BroadcastConfig }
export const name = 'broadcast'
export const inject = ['tools']

export function apply(ctx: Context, raw: Partial<BroadcastConfig> = {}) {
  const config = resolveConfig(raw)
  const logger = ctx.logger('broadcast')
  logger.info('dsh-broadcast 已加载（enabled=%s engine=%s）', config.enabled, config.engine)
}
