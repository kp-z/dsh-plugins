/**
 * 音色清单与选择规则。
 *
 * 分两类，界面上分组显示：
 * - **在线**（百度神经网络女声）：中文自然、长句稳，是目前最好听的一档，默认推荐。
 * - **本机**（macOS `say`）：离线可用、音色多（男女/粤语/台湾国语），但拼接式合成偏机械。
 *
 * 选择规则只有一条：**用户选了什么就用什么**；没选过才按 auto（edge → 在线 → 本机）走。
 * 这样「换了音色还是难听」就不会再发生——换到在线音色，听到的一定是在线音色。
 */
import { BAIDU_VOICE_ID } from './baidu-tts.js'

export type VoiceKind = 'online' | 'offline'

export interface VoiceOption {
  /** 存进状态的 id：在线是 'baidu'，本机是 'say:<say -v 的名字>'。 */
  readonly id: string
  /** 选择器里显示的名字。 */
  readonly label: string
  readonly kind: VoiceKind
  /** 一句话说明（用在分组标题下的提示）。 */
  readonly hint?: string
}

/** 默认音色：在线女声（没有选过时用它）。 */
export const DEFAULT_VOICE_ID = BAIDU_VOICE_ID

/** 在线合成挂掉、又没指定本机音色时用它——系统自带，一定有。 */
export const DEFAULT_SAY_VOICE = 'Tingting'

/** 本机 `say` 音色：id 后面那段就是传给 `say -v` 的名字（含语言变体的完整写法）。 */
const SAY_VOICES: readonly { id: string; label: string }[] = [
  { id: 'Tingting', label: '婷婷' },
  { id: 'Meijia', label: '美佳' },
  { id: 'Sinji', label: '善怡' },
  { id: 'Sandy (中文（中国大陆）)', label: 'Sandy' },
  { id: 'Shelley (中文（中国大陆）)', label: 'Shelley' },
  { id: 'Flo (中文（中国大陆）)', label: 'Flo' },
  { id: 'Eddy (中文（中国大陆）)', label: 'Eddy' },
  { id: 'Reed (中文（中国大陆）)', label: 'Reed' },
  { id: 'Rocko (中文（中国大陆）)', label: 'Rocko' },
  { id: 'Grandma (中文（中国大陆）)', label: 'Grandma' },
  { id: 'Grandpa (中文（中国大陆）)', label: 'Grandpa' },
  { id: 'Samantha', label: 'Samantha' },
  { id: 'Daniel', label: 'Daniel' },
]

/** 完整清单（顺序即界面顺序）。 */
export const VOICE_OPTIONS: readonly VoiceOption[] = [
  { id: BAIDU_VOICE_ID, label: '在线女声', kind: 'online', hint: '神经网络合成，中文最自然' },
  ...SAY_VOICES.map((voice) => ({
    id: `say:${voice.id}`,
    label: voice.label,
    kind: 'offline' as const,
  })),
]

/** 老配置里写的 edge 音色 → 本机音色（迁移用）。 */
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

export function isKnownVoice(id: string): boolean {
  return VOICE_OPTIONS.some((option) => option.id === id)
}

/** 'say:Eddy (中文（中国大陆）)' → 'Eddy (中文（中国大陆）)'；不是 say 音色返回 undefined。 */
export function sayVoiceOf(id: string): string | undefined {
  return id.startsWith('say:') ? id.slice(4) : undefined
}

/**
 * 把状态/配置里可能出现的各种写法归一成一个合法 voiceId。
 * 认得：'baidu'、'say:xxx'、老配置里的 edge 音色名、裸的 say 名字；都不认 → 默认值。
 */
export function normalizeVoiceId(raw: string | undefined): string {
  const value = raw?.trim() ?? ''
  if (value === '') return DEFAULT_VOICE_ID
  if (isKnownVoice(value)) return value
  const mapped = EDGE_TO_SAY[value]
  if (mapped !== undefined) return `say:${mapped}`
  // 裸的 say 名字（老版本 state.json 里存的就是它）
  const asSay = VOICE_OPTIONS.find((option) => sayVoiceOf(option.id) === value)
  if (asSay !== undefined) return asSay.id
  return DEFAULT_VOICE_ID
}

/** 选中的音色是哪一类。 */
export function voiceKindOf(id: string): VoiceKind {
  return sayVoiceOf(id) === undefined ? 'online' : 'offline'
}

/** 试听用的句子：说清是谁在说话，短（约 2–3 秒）。 */
export function auditionText(voiceId: string): string {
  const option = VOICE_OPTIONS.find((candidate) => candidate.id === voiceId)
  const name = option?.label ?? '这个音色'
  const tail = voiceKindOf(voiceId) === 'offline' ? '（本机离线音色，会比在线的机械一些）' : ''
  return `我是${name}，这样念这一轮的收尾，你听着还行吗？${tail}`
}
