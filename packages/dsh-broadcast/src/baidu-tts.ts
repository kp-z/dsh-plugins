/**
 * 百度翻译的在线语音合成（`fanyi.baidu.com/gettts`）。
 *
 * 为什么是它：edge-tts 的端点现在对本机一律 403（见 README「已知限制」），而 macOS 的
 * `say` 是拼接式合成，念长句很僵。这个接口给的是神经网络女声，中文自然度明显高一档，
 * 而且不需要密钥、返回标准 mp3（afplay 直接能放）。
 *
 * 它同样是**非官方公开接口**，所以和 edge-tts 一样：失败就抛，由上层决定回落。
 */
import { normalizeRate, ratePercent } from './prosody.js'

/** 端点。厂商换地址时改这里（或调用方传入 endpoint）。 */
export const DEFAULT_BAIDU_ENDPOINT = 'https://fanyi.baidu.com/gettts'

/** 百度这一层只有一种音色（列表里叫「在线女声」）。 */
export const BAIDU_VOICE_ID = 'baidu'

export interface BaiduSynthOptions {
  /** 语速百分比（配置里的 rate），会换算成百度的 1–5 档。 */
  rate?: string
  timeoutMs?: number
  endpoint?: string
  signal?: AbortSignal | undefined
}

/**
 * 百分比语速 → 百度的 spd 档位（1 最慢，5 最快）。
 *
 * 实测（同一段 52 字）：spd=3 → 7.7s，spd=4 → 6.8s，spd=5 → 6.2s。
 * 以 4 档（约等于正常语速）为基准，每 8% 走一档，夹在 1–5。
 */
export function baiduSpeedFor(rate: string): number {
  const percent = ratePercent(normalizeRate(rate))
  const level = Math.round(4 + percent / 8)
  return Math.min(5, Math.max(1, level))
}

/** 拼请求地址（纯函数，便于单测）。 */
export function buildBaiduUrl(text: string, options: { rate?: string; endpoint?: string } = {}): string {
  const url = new URL(options.endpoint ?? DEFAULT_BAIDU_ENDPOINT)
  url.searchParams.set('lan', 'zh')
  url.searchParams.set('text', text)
  url.searchParams.set('spd', String(baiduSpeedFor(options.rate ?? '+0%')))
  url.searchParams.set('source', 'web')
  return url.toString()
}

/** 合成一段文字，返回 mp3 字节。失败（非 200 / 空 body / 超时）一律抛。 */
export async function synthesizeBaidu(text: string, options: BaiduSynthOptions = {}): Promise<Buffer> {
  const spoken = text.trim()
  if (spoken === '') throw new Error('文本为空')
  if (spoken.length > 500) throw new Error('文本过长（超过 500 字）')

  const timeoutMs = options.timeoutMs ?? 10000
  const url = buildBaiduUrl(spoken, {
    rate: options.rate ?? '+0%',
    ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
  })

  // 自己的超时优先：宿主环境的 fetch 未必支持 signal 组合，用 race 兜住
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onOuterAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    })
    if (!response.ok) throw new Error(`百度语音合成返回 HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0) throw new Error('百度语音合成返回空音频')
    // 正常是 mp3（ID3 或 MPEG 帧头）；返回 HTML 说明被拦了
    if (buffer.subarray(0, 4).toString('latin1').startsWith('<')) {
      throw new Error('百度语音合成返回了网页而不是音频（接口可能变了）')
    }
    return buffer
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`百度语音合成超时（${timeoutMs}ms）`)
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onOuterAbort)
  }
}
