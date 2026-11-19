/**
 * 语音参数换算（纯函数，便于单测）。
 *
 * 两个引擎的参数格式不一样：
 * - edge-tts / SSML：rate = "+8%" / "-10%"，volume = "+0%" / "-50%"
 * - macOS say：       -r <每分钟词数>，没有 volume（只能靠系统音量）
 * 这里把用户配置的「百分比」统一换算，别让调用方各算一遍。
 */

/** say 的基准语速（Tingting 原速约 190 词/分），百分比在它上面加减。 */
export const SAY_BASE_RATE = 190

/** 规范化成 SSML 的 rate 写法：'8%' / '+8%' / '-10%' / '' → '+8%' / '+0%'。 */
export function normalizeRate(rate: string): string {
  const trimmed = (rate ?? '').trim()
  if (!trimmed) return '+0%'
  const match = /^([+-]?)(\d+(?:\.\d+)?)%$/.exec(trimmed)
  if (!match) return '+0%'
  const sign = match[1] === '-' ? '-' : '+'
  const value = match[2] ?? '0'
  return `${sign}${value}%`
}

/** 从百分比速率取出数值部分（'+8%' → 8，'-10%' → -10，非法 → 0）。 */
export function ratePercent(rate: string): number {
  const normalized = normalizeRate(rate)
  return Number.parseFloat(normalized.replace('%', '')) || 0
}

/** say 的 -r 参数：基准语速乘上百分比，取整并夹在 say 能接受的 80–400。 */
export function sayRateFromPercent(rate: string): number {
  const value = Math.round(SAY_BASE_RATE * (1 + ratePercent(rate) / 100))
  return Math.min(400, Math.max(80, value))
}

/** 0–100 的音量 → SSML prosody volume（'+0%' / '-50%'），越界夹紧。 */
export function volumeToProsody(volume: number): string {
  const percent = Math.round(Math.min(100, Math.max(0, Number.isFinite(volume) ? volume : 100))) - 100
  return `${percent >= 0 ? '+' : ''}${percent}%`
}
