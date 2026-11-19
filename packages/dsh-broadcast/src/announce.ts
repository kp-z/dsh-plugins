/**
 * 播报链路：合成 → 落临时文件 → 播放 → 删临时文件。
 *
 * 三级回落（S1 只到第二级，第三级留给 S3 的 LLM 改写）：
 *   1. edge-tts 合成，afplay / ffplay 播
 *   2. 任何一步失败 → 系统 say 直接念（离线，一定有声）
 *
 * 依赖全部可注入（deps），所以「失败回落」可以在不打网络的情况下测。
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BroadcastConfig } from './config.js'
import { synthesize } from './edge-tts.js'
import { pickPlayer, playFile, sayOffline, sayVoiceFor } from './player.js'
import { normalizeRate, sayRateFromPercent, volumeToProsody } from './prosody.js'

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

/** 播一个音频文件：选播放器，选不出来就抛（交给上层回落 say）。 */
async function playTempAudio(file: string, signal?: AbortSignal | undefined): Promise<void> {
  const kind = pickPlayer()
  if (kind === 'none' || kind === 'say') {
    throw new Error(kind === 'say' ? '只有 say 可用，播不了 mp3' : '找不到可用的播放器（afplay / ffplay）')
  }
  await playFile(kind, file, { signal })
}

export interface SpeakDeps {
  synthesize?: (text: string, options: { voice: string; rate: string; volume: string; signal?: AbortSignal | undefined }) => Promise<Buffer>
  play?: (file: string) => Promise<void>
  say?: (text: string, options: { voice: string; rate: number }) => Promise<void>
  writeTemp?: (audio: Buffer) => string
  remove?: (file: string) => void
  now?: () => number
  signal?: AbortSignal | undefined
}

/** 播报结果：用了哪个引擎、花了多久、没走 edge 时为什么。 */
export interface SpeakResult {
  engine: 'edge' | 'say'
  ms: number
  fallbackReason?: string | undefined
}

/** 去掉多余空白并截到上限（S2 才做完整清洗，这里只保证不会念一大段）。 */
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
 * 播报一段文字。
 * - engine = 'say'：只走离线 say
 * - engine = 'edge'：只走 edge-tts，失败直接抛（调试用）
 * - engine = 'auto'：先 edge，失败回落 say，并在结果里说明原因
 */
export async function speak(text: string, config: BroadcastConfig, deps: SpeakDeps = {}): Promise<SpeakResult> {
  const now = deps.now ?? Date.now
  const started = now()
  const spoken = clipForSpeech(text, config.maxChars)
  if (!spoken) throw new Error('没有可播报的文字')

  const say = deps.say ?? ((value, options) => sayOffline(value, deps.signal ? { ...options, signal: deps.signal } : options))
  const sayOptions = { voice: sayVoiceFor(config.voice), rate: sayRateFromPercent(config.rate) }

  if (config.engine === 'say') {
    await say(spoken, sayOptions)
    return { engine: 'say', ms: now() - started }
  }

  const synth = deps.synthesize ?? synthesize
  const writeTemp = deps.writeTemp ?? writeTempAudio
  const remove = deps.remove ?? removeTempAudio
  const play = deps.play ?? ((file: string) => playTempAudio(file, deps.signal))

  let fallbackReason: string | undefined
  try {
    const audio = await synth(spoken, {
      voice: config.voice,
      rate: normalizeRate(config.rate),
      volume: volumeToProsody(config.volume),
      ...(deps.signal ? { signal: deps.signal } : {}),
    })
    const file = writeTemp(audio)
    try {
      await play(file)
    } finally {
      remove(file)
    }
    return { engine: 'edge', ms: now() - started }
  } catch (error) {
    fallbackReason = errorMessage(error)
    if (config.engine === 'edge') throw new Error(`edge-tts 播报失败：${fallbackReason}`)
  }

  await say(spoken, sayOptions)
  return { engine: 'say', ms: now() - started, fallbackReason }
}
