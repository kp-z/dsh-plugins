/**
 * 播放层：把一段音频送到扬声器。
 *
 * macOS 上 ffplay 通常没装（本机实测没有），而 afplay 是系统自带 —— 所以
 * 「能不能出声」这一层必须自己选，不能照抄 voice-announcer 的 ffplay 路径。
 *
 * 优先级：afplay（macOS 自带）→ ffplay（装了 ffmpeg 才有）→ say（完全离线兜底）。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { sayRateFromPercent } from './prosody.js'

const execFileAsync = promisify(execFile)

/** 可用的播放方式；none = 这台机器既没有 afplay/ffplay，也不能用 say。 */
export type PlayerKind = 'afplay' | 'ffplay' | 'say' | 'none'

/** macOS 上常见的可执行文件目录，PATH 里没有时补上。 */
const FALLBACK_BIN_DIRS = ['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin']

/** 找可执行文件（PATH + 常见目录）。测试可传入假的 exists 替换。 */
export function hasCommand(command: string, options: { pathEnv?: string; exists?: (path: string) => boolean } = {}): boolean {
  const exists = options.exists ?? existsSync
  const pathEnv = options.pathEnv ?? process.env.PATH ?? ''
  const dirs = pathEnv.split(delimiter).filter(Boolean).concat(FALLBACK_BIN_DIRS)
  return dirs.some((dir) => exists(join(dir, command)))
}

/**
 * 选播放方式。纯逻辑（探测结果由调用方注入），所以能单测：
 * - macOS + afplay：最省事，afplay 会把整个文件播完
 * - 有 ffplay：跨平台兜底
 * - 只剩 say：离线合成 + 直接播（用它自己的音色，音质差但一定有声音）
 */
export function pickPlayer(options: { platform?: NodeJS.Platform; has?: (command: string) => boolean } = {}): PlayerKind {
  const platform = options.platform ?? process.platform
  const has = options.has ?? ((command: string) => hasCommand(command))
  if (platform === 'darwin' && has('afplay')) return 'afplay'
  if (has('ffplay')) return 'ffplay'
  if (platform === 'darwin' && has('say')) return 'say'
  return 'none'
}

/**
 * afplay 参数。volume 是 0–100 的配置值 → afplay 的 -v 倍数（1 = 原样）。
 *
 * 为什么必须接上：`volume` 这个配置项以前只喂给 edge-tts 的 SSML，afplay 根本没收到它——
 * 等于一个死配置。耳机音量偏小时用户调它没有任何效果。
 * -v 支持大于 1 的倍数（放大），所以 >100 也照实传，让人能救回小音量。
 */
export function afplayArgs(file: string, volume = 100): string[] {
  const level = Number.isFinite(volume) ? Math.max(0, volume) / 100 : 1
  return level === 1 ? [file] : ['-v', String(level), file]
}

/** ffplay 参数：-nodisp -autoexit 不弹窗、播完退出，日志压到最低。 */
export function ffplayArgs(file: string): string[] {
  return ['-nodisp', '-autoexit', '-loglevel', 'error', file]
}

/** say 参数：-v 音色，-r 语速（词/分），最后是文本。 */
export function sayArgs(text: string, options: { voice?: string; rate?: number } = {}): string[] {
  return ['-v', options.voice ?? 'Tingting', '-r', String(options.rate ?? 190), text]
}

/** 播一个音频文件。 */
export async function playFile(
  kind: PlayerKind,
  file: string,
  options: { signal?: AbortSignal | undefined; volume?: number | undefined } = {},
): Promise<void> {
  if (kind === 'afplay') {
    await execFileAsync('afplay', afplayArgs(file, options.volume ?? 100), { signal: options.signal })
    return
  }
  if (kind === 'ffplay') {
    await execFileAsync('ffplay', ffplayArgs(file), { signal: options.signal })
    return
  }
  throw new Error(`没有可用的播放器（${kind}）`)
}

/** 用系统 say 直接念（离线兜底，不需要音频文件）。 */
export async function sayOffline(text: string, options: { voice?: string; rate?: number; signal?: AbortSignal | undefined } = {}): Promise<void> {
  const args = sayArgs(text, { voice: options.voice ?? 'Tingting', rate: options.rate ?? sayRateFromPercent('+0%') })
  await execFileAsync('say', args, { signal: options.signal })
}
