/**
 * 播报链路：合成 → 落临时文件 → 播放 → 删临时文件。
 *
 * 三级回落，顺序即音质顺序：
 *   1. **edge-tts**（微软神经网络，最好）——目前对本机一律 403，保留着随时会好
 *   2. **百度在线语音**（`fanyi.baidu.com/gettts`，免费无需密钥，中文自然）
 *   3. **系统 say**（离线保底，拼接式合成，偏机械）
 *
 * 用户在选择器里选过音色时**只走那一条**：选了在线就不要偷偷换成 say，否则「换了还是难听」
 * 这种事会再发生一次。只有没选过（auto）才按上面的顺序回落。
 *
 * 依赖全部可注入（deps），所以回落链能在不打网络、不出声的情况下被测到。
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BAIDU_VOICE_ID, synthesizeBaidu } from './baidu-tts.js'
import type { BroadcastConfig } from './config.js'
import { synthesize } from './edge-tts.js'
import { pickPlayer, playFile, sayOffline } from './player.js'
import { sayRateFromPercent, volumeToProsody, normalizeRate } from './prosody.js'
import { DEFAULT_SAY_VOICE, normalizeVoiceId, sayVoiceOf } from './voices.js'

/** 临时音频目录：os.tmpdir()/dsh-broadcast/。 */
export function tempDir(): string {
  return join(tmpdir(), 'dsh-broadcast')
}

/** 把 mp3 写到临时目录，返回路径。 */
export function writeTempAudio(audio: Buffer): string {
  const dir = tempDir()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `speak-${Date.now()}-${randomUUID().slice(0, 8)}.mp3`)
  writeFileSync(file, audio)
  return file
}

/** 删临时文件；删不掉不算错（系统会自己清临时目录）。 */
export function removeTempAudio(file: string): void {
  try {
    rmSync(file, { force: true })
  } catch { /* 忽略 */ }
}

/** 播一个音频文件：选播放器，选不出来就抛（交给上层回落）。 */
async function playTempAudio(file: string, signal?: AbortSignal | undefined, volume = 100): Promise<void> {
  const kind = pickPlayer()
  if (kind === 'none' || kind === 'say') {
    throw new Error(kind === 'say' ? '只有 say 可用，播不了 mp3' : '找不到可用的播放器（afplay / ffplay）')
  }
  await playFile(kind, file, { signal, volume })
}

export interface SpeakDeps {
  synthesizeEdge?: (text: string, options: { voice: string; rate: string; volume: string; signal?: AbortSignal | undefined }) => Promise<Buffer>
  synthesizeBaidu?: (text: string, options: { rate: string; signal?: AbortSignal | undefined }) => Promise<Buffer>
  play?: (file: string) => Promise<void>
  say?: (text: string, options: { voice: string; rate: number }) => Promise<void>
  writeTemp?: (audio: Buffer) => string
  remove?: (file: string) => void
  now?: () => number
  signal?: AbortSignal | undefined
}

/** 实际出声的那一档。 */
export type SpeakEngine = 'edge' | 'baidu' | 'say'

/** 播报结果：用了哪个引擎、花了多久、换了几个才成功/为什么。 */
export interface SpeakResult {
  engine: SpeakEngine
  ms: number
  /** 有没有被回落（换了引擎时非空，内容是上一档失败的原因）。 */
  fallbackReason?: string | undefined
}

/** 去掉多余空白并截到上限（完整清洗在 sanitize.ts，这里只保证不会念一大段）。 */
export function clipForSpeech(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!Number.isFinite(maxChars) || maxChars <= 0) return flat
  return flat.length <= maxChars ? flat : flat.slice(0, maxChars).trim()
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 这次按什么顺序尝试。
 *
 * 一条铁律：**在选择器里选了什么，听到的就是什么**。上一版「换到在线音色，听到的还是
 * 系统 say」正是没有守住这条。
 *
 * - 选了本机音色（'say:xxx'）→ 只用它（离线，一定出声）
 * - 选了在线（'baidu'）→ 用百度；挂了才退到本机默认音色（宁可机械也要有声音，并在结果里说清）
 * - engine='edge'/'baidu'/'say' 显式指定时只走那一条（失败直接抛，调试用）
 *
 * edge-tts 不参与自动回落：它的端点当前对本机一律 403，而且即使恢复了，用户选的是「在线女声」，
 * 不该悄悄换成另一个在线声音。想试 edge 就把 engine 设成 'edge'。
 */
export function enginePlan(config: BroadcastConfig): { voiceId: string; engines: SpeakEngine[] } {
  const explicit = config.engine
  if (explicit === 'edge') return { voiceId: BAIDU_VOICE_ID, engines: ['edge'] }
  if (explicit === 'baidu') return { voiceId: BAIDU_VOICE_ID, engines: ['baidu'] }
  if (explicit === 'say') return { voiceId: 'say:' + (config.sayVoice || 'Tingting'), engines: ['say'] }

  const voiceId = normalizeVoiceId(config.voiceId)
  if (sayVoiceOf(voiceId) !== undefined) return { voiceId, engines: ['say'] }
  return { voiceId, engines: ['baidu', 'say'] }
}

/**
 * 播报一段文字。返回值说明这次到底是谁出的声——日志与 `broadcast_say` 都靠它，
 * 用户问「为什么听起来不对」时这就是证据。
 */
export async function speak(text: string, config: BroadcastConfig, deps: SpeakDeps = {}): Promise<SpeakResult> {
  const now = deps.now ?? Date.now
  const started = now()
  const spoken = clipForSpeech(text, config.maxChars)
  if (!spoken) throw new Error('没有可播报的文字')

  const plan = enginePlan(config)
  const sayVoice = sayVoiceOf(plan.voiceId) ?? (config.sayVoice.trim() || DEFAULT_SAY_VOICE)
  const say = deps.say ?? ((value, options) => sayOffline(value, deps.signal ? { ...options, signal: deps.signal } : options))
  const sayOptions = { voice: sayVoice, rate: sayRateFromPercent(config.rate) }

  const synthEdge = deps.synthesizeEdge ?? synthesize
  const synthBaidu = deps.synthesizeBaidu ?? synthesizeBaidu
  const writeTemp = deps.writeTemp ?? writeTempAudio
  const remove = deps.remove ?? removeTempAudio
  const play = deps.play ?? ((file: string) => playTempAudio(file, deps.signal, config.volume))

  const playAudio = async (audio: Buffer): Promise<void> => {
    const file = writeTemp(audio)
    try {
      await play(file)
    } finally {
      remove(file)
    }
  }

  let fallbackReason: string | undefined
  for (const engine of plan.engines) {
    try {
      if (engine === 'say') {
        await say(spoken, sayOptions)
        return fallbackReason === undefined
          ? { engine, ms: now() - started }
          : { engine, ms: now() - started, fallbackReason }
      }
      if (engine === 'baidu') {
        const audio = await synthBaidu(spoken, {
          rate: normalizeRate(config.rate),
          ...(deps.signal ? { signal: deps.signal } : {}),
        })
        await playAudio(audio)
      } else {
        const audio = await synthEdge(spoken, {
          voice: config.voice,
          rate: normalizeRate(config.rate),
          volume: volumeToProsody(config.volume),
          ...(deps.signal ? { signal: deps.signal } : {}),
        })
        await playAudio(audio)
      }
      return fallbackReason === undefined
        ? { engine, ms: now() - started }
        : { engine, ms: now() - started, fallbackReason }
    } catch (error) {
      const message = errorMessage(error)
      // 用户选了某一个音色（或显式指定引擎）时不偷偷换：把真实原因抛出去
      if (plan.engines.length === 1) {
        throw new Error(`${engine} 播报失败：${message}`)
      }
      fallbackReason = fallbackReason === undefined ? message : `${fallbackReason}；${message}`
    }
  }

  throw new Error(`所有播报引擎都失败了：${fallbackReason ?? '未知原因'}`)
}
