/**
 * 插件配置。
 *
 * Loader 传进来的 config 是 patch 里的**原始值**，schema 的 default 不会自动填，
 * 所以 `apply` 一律走 `resolveConfig()` 用 `??` 兜底（见 docs/DEVELOPMENT.md §2）。
 */
import z from '@deepseek-ai/schemastery'

export const BroadcastConfig = z.object({
  /** 总开关。默认关——装完先试听再开，别半夜被吓一跳。 */
  enabled: z.boolean().default(false),

  /** 引擎：edge-tts（联网、最像人）/ say（macOS 离线）/ auto（先 edge 再 say）。 */
  engine: z.string().default('auto'),

  /** edge-tts 音色。默认晓晓：温暖、长句稳。 */
  voice: z.string().default('zh-CN-XiaoxiaoNeural'),

  /** 离线 say 的音色（音色选择器写这个）。空串 = 按 voice 推导。 */
  sayVoice: z.string().default(''),

  /** 语速增量，如 '+8%'。空串 = 原速。 */
  rate: z.string().default('+8%'),

  /** 音量 0–100。 */
  volume: z.number().default(100),

  /** 摘要长度上限（字）。80 字约 16 秒，再长就听不下去了。 */
  maxChars: z.number().default(80),

  /** 是否让宿主的模型把这一轮说成人话（关掉就只做本地截断）。 */
  useModel: z.boolean().default(true),

  /** 模型改写超时（ms）：拿不到就用本地截断，不让播放干等。 */
  modelTimeoutMs: z.number().default(6000),

  /** 回复短于这个字数就不播（'收到' 这类不值得开口）。 */
  minChars: z.number().default(30),

  /** 是否播报子代理会话。默认否。 */
  announceSubagent: z.boolean().default(false),

  /** 同一会话两次播报的最小间隔（ms）：防连播、防抖。 */
  debounceMs: z.number().default(2000),

  /** 出错 / 中止时是否也给一句提示。 */
  announceFailure: z.boolean().default(true),

  /** 安静时段（本地时间，HH:MM–HH:MM，跨零点可写 23:00–08:00）。空串 = 不启用。 */
  quietHours: z.string().default(''),
})

export type BroadcastConfig = Schemastery.TypeT<typeof BroadcastConfig>

/** 把 patch 里的原始值补全成完整配置。 */
export function resolveConfig(raw: Partial<BroadcastConfig> = {}): BroadcastConfig {
  return {
    enabled: raw.enabled ?? false,
    engine: raw.engine ?? 'auto',
    voice: raw.voice ?? 'zh-CN-XiaoxiaoNeural',
    sayVoice: raw.sayVoice ?? '',
    rate: raw.rate ?? '+8%',
    volume: raw.volume ?? 100,
    maxChars: raw.maxChars ?? 80,
    useModel: raw.useModel ?? true,
    modelTimeoutMs: raw.modelTimeoutMs ?? 6000,
    minChars: raw.minChars ?? 30,
    announceSubagent: raw.announceSubagent ?? false,
    debounceMs: raw.debounceMs ?? 2000,
    announceFailure: raw.announceFailure ?? true,
    quietHours: raw.quietHours ?? '',
  }
}
