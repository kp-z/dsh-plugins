/**
 * edge-tts 客户端：用微软 Edge 的在线语音合成（WebSocket 流式返回 mp3）。
 *
 * 协议移植自 flashyiyi/dsh-voice-announcer（BSD-3-Clause，见 NOTICE）：
 * 只保留「合成一段文字」这条路，去掉播放层与设置界面，并把
 * 「鉴权签名 / URL 拼接 / SSML 构造」拆成纯函数，方便单测。
 *
 * 这是非官方公开接口，域名与签名随时可能变（2026-10 已经失效过一次）。
 * 失败一律抛错，由上层（announce.ts）决定要不要回落系统 say。
 */
import { createHash, randomUUID } from 'node:crypto'

/** 公开的客户端 token（所有第三方 edge-tts 实现都在用同一个）。 */
export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'

/** 签名版本里带的 Chromium 版本号。 */
export const CHROMIUM_VERSION = '130.0.2849.68'

/** 默认端点。厂商换域名时改这里（或配置里的 endpoint）。 */
export const DEFAULT_ENDPOINT = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1'

/** 输出格式：24kHz 48kbps 单声道 mp3 —— afplay / ffplay 都能直接吃。 */
export const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'

/** 默认音色：晓晓，温暖、长句稳。 */
export const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'

/** Windows FILETIME 纪元（秒）。 */
const WINDOWS_EPOCH_SECONDS = 11644473600

export interface SynthOptions {
  voice?: string
  /** SSML 语速，如 '+8%'。 */
  rate?: string
  /** SSML 音量，如 '+0%'。 */
  volume?: string
  /** 覆盖默认端点（厂商换域名时用）。 */
  endpoint?: string | undefined
  timeoutMs?: number
  signal?: AbortSignal | undefined
}

/**
 * 微软的防滥用签名：把「当前时间（100ns ticks，向下取整到 5 分钟）」与 token 拼起来做 sha256。
 * 纯函数——只要 now 一样，结果就一样，所以能单测。
 */
export function secMsGec(nowMs: number, token: string = TRUSTED_CLIENT_TOKEN): string {
  let ticks = Math.floor(nowMs / 1000) + WINDOWS_EPOCH_SECONDS
  ticks -= ticks % 300
  const fileTime = BigInt(ticks) * 10000000n
  return createHash('sha256').update(`${fileTime}${token}`, 'ascii').digest('hex').toUpperCase()
}

export interface EndpointOptions {
  endpoint?: string | undefined
  /** 参与签名的时间戳，默认 Date.now()。 */
  now?: number
  connectionId?: string
}

/** 拼出带鉴权参数的 wss 地址。 */
export function buildEndpointUrl(options: EndpointOptions = {}): string {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const query = new URLSearchParams({
    TrustedClientToken: TRUSTED_CLIENT_TOKEN,
    'Sec-MS-GEC': secMsGec(options.now ?? Date.now()),
    'Sec-MS-GEC-Version': `1-${CHROMIUM_VERSION}`,
    ConnectionId: (options.connectionId ?? randomUUID()).replace(/-/g, ''),
  })
  return `${endpoint}?${query.toString()}`
}

/** SSML 里的文本要转义，否则 & < > 会让整段拒绝合成。 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 构造 SSML。 */
export function buildSsml(text: string, options: { voice?: string; rate?: string; volume?: string } = {}): string {
  const voice = options.voice ?? DEFAULT_VOICE
  const rate = options.rate ?? '+0%'
  const volume = options.volume ?? '+0%'
  return '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">'
    + `<voice name="${voice}"><prosody rate="${rate}" volume="${volume}">`
    + escapeXml(text)
    + '</prosody></voice></speak>'
}

/** speech.config 帧的内容。 */
export function buildSpeechConfig(): string {
  return JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
          outputFormat: OUTPUT_FORMAT,
        },
      },
    },
  })
}

/** 合成一段文字，返回 mp3 字节。失败（403 / 超时 / 断链）一律抛错。 */
export async function synthesize(text: string, options: SynthOptions = {}): Promise<Buffer> {
  const spoken = text.trim()
  if (!spoken) throw new Error('文本为空')

  const url = buildEndpointUrl({ endpoint: options.endpoint, now: Date.now(), connectionId: randomUUID() })
  const requestId = randomUUID().replace(/-/g, '')
  const timeoutMs = options.timeoutMs ?? 15000

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'

    const finish = (error?: Error, audio?: Buffer) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      try { socket.close() } catch { /* 已经关了 */ }
      if (error) reject(error)
      else resolve(audio as Buffer)
    }

    const onAbort = () => finish(new Error('已取消'))

    timer = setTimeout(() => finish(new Error(`edge-tts 超时（${timeoutMs}ms）`)), timeoutMs)
    if (options.signal?.aborted) onAbort()
    options.signal?.addEventListener('abort', onAbort, { once: true })

    socket.onopen = () => {
      const timestamp = new Date().toISOString()
      socket.send(
        `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n`
        + buildSpeechConfig(),
      )
      socket.send(
        `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n`
        + buildSsml(spoken, { voice: options.voice ?? DEFAULT_VOICE, rate: options.rate ?? '+0%', volume: options.volume ?? '+0%' }),
      )
    }

    socket.onmessage = (event) => {
      const data = (event as MessageEvent).data
      if (typeof data === 'string') {
        if (data.includes('Path:turn.end')) {
          if (chunks.length === 0) finish(new Error('edge-tts 返回空音频'))
          else finish(undefined, Buffer.concat(chunks))
        } else if (data.includes('Path:error')) {
          finish(new Error(`edge-tts 协议错误：${data.slice(0, 200)}`))
        }
        return
      }
      // 二进制帧 = 2 字节头长度 + 头文本 + 音频；只取 Path:audio 的帧。
      const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      if (frame.length < 2) return
      const headerLength = frame.readUInt16BE(0)
      if (frame.length < 2 + headerLength) return
      const header = frame.subarray(2, 2 + headerLength).toString('utf8')
      if (!header.includes('Path:audio')) return
      chunks.push(frame.subarray(2 + headerLength))
    }

    socket.onerror = () => finish(new Error('edge-tts 连接失败（握手被拒或网络不可达）'))
    socket.onclose = (event) => {
      if (chunks.length > 0) finish(undefined, Buffer.concat(chunks))
      else finish(new Error(`edge-tts 连接已关闭（code=${event.code}）`))
    }
  })
}
