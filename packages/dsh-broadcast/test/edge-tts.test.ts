import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHROMIUM_VERSION,
  DEFAULT_ENDPOINT,
  TRUSTED_CLIENT_TOKEN,
  buildEndpointUrl,
  buildSsml,
  escapeXml,
  secMsGec,
} from '../lib/edge-tts.js'

/** 固定时间戳：2026-11-19T16:00:00Z，落在 5 分钟窗口边界上。 */
const FIXED_NOW = Date.parse('2026-11-19T16:00:00Z')

test('secMsGec 输出大写十六进制 sha256，同窗口稳定、跨窗口变化', () => {
  const value = secMsGec(FIXED_NOW)
  assert.match(value, /^[0-9A-F]{64}$/)
  // 同一个 5 分钟窗口内不变（签名按 5 分钟取整，不是每毫秒都变）
  assert.equal(secMsGec(FIXED_NOW + 1000), value)
  assert.equal(secMsGec(FIXED_NOW + 4 * 60 * 1000), value)
  // 跨窗口就变
  assert.notEqual(secMsGec(FIXED_NOW + 6 * 60 * 1000), value)
  // token 参与哈希
  assert.notEqual(secMsGec(FIXED_NOW, 'other-token'), value)
})

test('buildEndpointUrl 带上鉴权参数与固定 token', () => {
  const url = new URL(buildEndpointUrl({ now: FIXED_NOW, connectionId: 'abc-123' }))
  assert.equal(`${url.origin}${url.pathname}`, new URL(DEFAULT_ENDPOINT).origin + new URL(DEFAULT_ENDPOINT).pathname)
  assert.equal(url.searchParams.get('TrustedClientToken'), TRUSTED_CLIENT_TOKEN)
  assert.equal(url.searchParams.get('Sec-MS-GEC'), secMsGec(FIXED_NOW))
  assert.equal(url.searchParams.get('Sec-MS-GEC-Version'), `1-${CHROMIUM_VERSION}`)
  assert.equal(url.searchParams.get('ConnectionId'), 'abc123')
})

test('buildEndpointUrl 默认走 wss，并允许覆盖端点', () => {
  assert.ok(buildEndpointUrl({ now: FIXED_NOW }).startsWith('wss://'))
  const custom = buildEndpointUrl({ now: FIXED_NOW, endpoint: 'wss://example.test/tts' })
  assert.ok(custom.startsWith('wss://example.test/tts?'))
})

test('escapeXml 转义 & < > 与引号', () => {
  assert.equal(escapeXml('a & b < c > d "e" \'f\''), 'a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;')
})

test('buildSsml 带音色、语速、音量，且文本已转义', () => {
  const ssml = buildSsml('你好 & 再见', { voice: 'zh-CN-XiaoxiaoNeural', rate: '+8%', volume: '-20%' })
  assert.match(ssml, /<voice name="zh-CN-XiaoxiaoNeural">/)
  assert.match(ssml, /<prosody rate="\+8%" volume="-20%">/)
  assert.match(ssml, /你好 &amp; 再见/)
  assert.ok(ssml.startsWith('<speak'))
  assert.ok(ssml.endsWith('</speak>'))
})
