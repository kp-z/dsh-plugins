/**
 * 可选的音色清单（离线 `say` 这一层）。
 *
 * 为什么以「系统音色」为准：edge-tts 的在线合成目前不可用（端点变了，见 NOTICE / README），
 * 真正决定你现在听到什么的是 `say`。所以选择器列的是**这台机器上真装了**的音色，
 * 每一项都能当场试听——而不是给一串点下去没反应的英文 ID。
 *
 * id 直接就是传给 `say -v` 的名字。macOS 的同名音色有多种语言变体
 * （例如 Eddy 同时有 en_US 与 zh_CN），必须带上括号里的完整名字才能选中中文那个。
 */

export interface VoiceOption {
  /** 传给 `say -v` 的名字（含语言变体的完整写法）。 */
  readonly id: string
  /** 选择器里显示的名字。 */
  readonly label: string
}

/** 当前机器上最常用的中文音色（外加两个英文）。顺序即选择器顺序。 */
export const VOICE_OPTIONS: readonly VoiceOption[] = [
  { id: 'Tingting', label: '婷婷 · 女声（普通话）' },
  { id: 'Meijia', label: '美佳 · 女声（台湾国语）' },
  { id: 'Sinji', label: '善怡 · 女声（粤语）' },
  { id: 'Sandy (中文（中国大陆）)', label: 'Sandy · 女声（普通话）' },
  { id: 'Shelley (中文（中国大陆）)', label: 'Shelley · 女声（普通话）' },
  { id: 'Flo (中文（中国大陆）)', label: 'Flo · 女声（普通话）' },
  { id: 'Eddy (中文（中国大陆）)', label: 'Eddy · 男声（普通话）' },
  { id: 'Reed (中文（中国大陆）)', label: 'Reed · 男声（普通话）' },
  { id: 'Rocko (中文（中国大陆）)', label: 'Rocko · 男声（普通话）' },
  { id: 'Grandma (中文（中国大陆）)', label: 'Grandma · 老年女声' },
  { id: 'Grandpa (中文（中国大陆）)', label: 'Grandpa · 老年男声' },
  { id: 'Samantha', label: 'Samantha · 女声（英语）' },
  { id: 'Daniel', label: 'Daniel · 男声（英式英语）' },
] as const

/** 默认音色（也是 `say` 一定装着的那个）。 */
export const DEFAULT_SAY_VOICE = 'Tingting'

/** edge-tts 音色 → 系统音色。旧配置里写的还是 edge 音色，这里负责接上。 */
const EDGE_TO_SAY: Record<string, string> = {
  'zh-CN-XiaoxiaoNeural': 'Tingting',
  'zh-CN-XiaoyiNeural': 'Flo (中文（中国大陆）)',
  'zh-CN-YunjianNeural': 'Reed (中文（中国大陆）)',
  'zh-CN-YunxiNeural': 'Eddy (中文（中国大陆）)',
  'zh-CN-YunyangNeural': 'Rocko (中文（中国大陆）)',
  'zh-TW-HsiaoChenNeural': 'Meijia',
  'zh-HK-HiuMaanNeural': 'Sinji',
  'en-US-AriaNeural': 'Samantha',
  'en-US-GuyNeural': 'Daniel',
}

/** 清单里有没有这一项（用来提示「你在配置里写的音色这台机器没有」）。 */
export function isKnownVoice(id: string): boolean {
  return VOICE_OPTIONS.some((option) => option.id === id)
}

/**
 * 决定这次到底用哪个系统音色：
 * 1. 用户在音色选择器里选过的（`sayVoice`，存在状态文件里）
 * 2. 旧配置里的 edge 音色 → 映射
 * 3. 都没写 → 婷婷
 */
export function resolveSayVoice(config: { sayVoice?: string | undefined; voice?: string | undefined }): string {
  const picked = config.sayVoice?.trim()
  if (picked !== undefined && picked !== '') return picked
  const legacy = config.voice?.trim()
  if (legacy !== undefined && legacy !== '') {
    return EDGE_TO_SAY[legacy] ?? (isKnownVoice(legacy) ? legacy : DEFAULT_SAY_VOICE)
  }
  return DEFAULT_SAY_VOICE
}

/** 试听用的句子：说清是谁在说话，短（约 2 秒）。 */
export function auditionText(voiceId: string): string {
  const label = VOICE_OPTIONS.find((option) => option.id === voiceId)?.label ?? voiceId
  const name = label.split(' · ')[0] ?? '这个音色'
  return `我是${name}，这样念这一轮的收尾，你听着还行吗？`
}
