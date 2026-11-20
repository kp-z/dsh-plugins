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

/** 在线那一档（目前只有百度一个音色，见 README「已知限制」）。 */
export const ONLINE_VOICES: readonly VoiceOption[] = [
  { id: BAIDU_VOICE_ID, label: '在线女声', kind: 'online', hint: '神经网络合成，中文最自然' },
]

/**
 * 清单是**动态**的：在线那档写死（就一个），本机那档现读 `say -v '?'`——
 * 用户在系统设置里下载了「增强」音色之后，菜单里立刻能看到，不用我改代码。
 */
export function listVoices(): VoiceOption[] {
  return [...ONLINE_VOICES, ...listOfflineVoices()]
}

/** 静态兜底清单（拿来判 id 合法、跑测试用；不含动态发现的音色）。 */
export const VOICE_OPTIONS: readonly VoiceOption[] = [
  ...ONLINE_VOICES,
  ...SAY_VOICES.map((voice) => ({
    id: `say:${voice.id}`,
    label: voice.label,
    kind: 'offline' as const,
  })),
]

/**
 * 本机装了哪些 `say` 音色——**现读**，不写死。
 *
 * 为什么改成动态：macOS 的「增强 / 高级」音色要在系统设置里手动下载，装好之后
 * `say -v '?'` 里会多出 `Tingting (增强)` 这类条目，质量比默认高不少。写死清单会让
 * 用户下完却看不见——这正是「想换更好声音却没有选项」的另一种成因。
 */
export interface InstalledSayVoice {
  readonly name: string
  readonly lang: string
  /** 自带的质量标记（增强 / Enhanced / Premium），没有就是 undefined。 */
  readonly quality: string | undefined
}

/** 从 `say -v '?'` 的输出里解析（纯函数，便于用真实输出做样本测试）。 */
export function parseSayVoices(stdout: string): InstalledSayVoice[] {
  const out: InstalledSayVoice[] = []
  for (const raw of stdout.split('\n')) {
    // 形如： "Tingting            zh_CN    # 你好！我叫婷婷。"
    // 名字里可能带空格与括号："Eddy (中文（中国大陆）)  zh_CN  # ..."
    // 所以按「两个以上空格」或制表符切最后两段：语言码 + 示例
    const line = raw.replace(/\s+#.*$/, '').trimEnd()
    if (line === '') continue
    const parts = line.split(/\t| {2,}/).map((part) => part.trim()).filter((part) => part !== '')
    if (parts.length < 2) continue
    const lang = parts[parts.length - 1] ?? ''
    if (!/^[a-z]{2,3}[-_][A-Za-z]{2,4}$/.test(lang)) continue
    const name = parts.slice(0, -1).join(' ').trim()
    if (name === '') continue
    const quality = /增强|Enhanced|Premium|Premium\(/i.exec(name)?.[0]
    out.push({ name, lang, quality })
  }
  return out
}

/** 中文音色优先（普通话 > 台湾国语 > 粤语），再挑几个英文的。 */
export function pickUsableVoices(installed: readonly InstalledSayVoice[], limit = 16): VoiceOption[] {
  const rank = (lang: string): number =>
    lang === 'zh_CN' ? 0 : lang === 'zh_TW' ? 1 : lang === 'zh_HK' ? 2 : 3
  const sorted = [...installed].sort((a, b) => {
    const byLang = rank(a.lang) - rank(b.lang)
    if (byLang !== 0) return byLang
    // 中文内部：有质量标记（增强/高级）的排前面
    const qualityA = a.quality === undefined ? 1 : 0
    const qualityB = b.quality === undefined ? 1 : 0
    return qualityA - qualityB
  })

  const chinese = sorted.filter((voice) => voice.lang.startsWith('zh')).slice(0, limit)
  const english = sorted.filter((voice) => !voice.lang.startsWith('zh')).slice(0, 3)

  return [...chinese, ...english].map((voice) => {
    // 「Tingting (增强)」→ 标签写「Tingting · 增强」，让下载过的更高质量版本一眼可辨。
    // 注意：拼在模板字符串里的正则会被吃掉反斜杠（\s → s），所以这里用 new RegExp 单独构造。
    let label = voice.name
    if (voice.quality !== undefined) {
      const stripped = voice.name.replace(new RegExp(`\\s*\\(\${voice.quality}\\)`), '').trim()
      label = `${stripped === '' ? voice.name : stripped} · ${voice.quality}`
    }
    return { id: `say:${voice.name}`, label, kind: 'offline' as const }
  })
}

/** 30 秒缓存：菜单每开一次就 spawn 一次 `say` 不值得。 */
let cachedAt = 0
let cachedList: VoiceOption[] | undefined

/** 现读本机音色；读不到（非 macOS / say 不在）就退回写死的那几条。 */
export function listOfflineVoices(options: { now?: number; refreshMs?: number } = {}): VoiceOption[] {
  const now = options.now ?? Date.now()
  const refreshMs = options.refreshMs ?? 30_000
  if (cachedList !== undefined && now - cachedAt < refreshMs) return cachedList
  try {
    // 延迟 require：浏览器端不需要，Node 侧才用
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    const stdout = execFileSync('say', ['-v', '?'], { encoding: 'utf8', timeout: 5000 })
    const list = pickUsableVoices(parseSayVoices(stdout))
    if (list.length > 0) {
      cachedList = list
      cachedAt = now
      return list
    }
  } catch {
    // 读不到就用兜底清单，绝不因此让菜单空掉
  }
  return SAY_VOICES.map((voice) => ({ id: `say:${voice.id}`, label: voice.label, kind: 'offline' as const }))
}

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

/** id 合不合法：静态清单里有，或者是 `say:` 前缀（本机能念的名字现读现认）。 */
export function isKnownVoice(id: string): boolean {
  if (VOICE_OPTIONS.some((option) => option.id === id)) return true
  const sayName = sayVoiceOf(id)
  return sayName !== undefined && sayName.trim() !== ''
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
