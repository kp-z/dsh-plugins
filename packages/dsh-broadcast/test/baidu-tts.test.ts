import assert from 'node:assert/strict'
import { test } from 'node:test'
import { baiduSpeedFor, buildBaiduUrl } from '../lib/baidu-tts.js'

test('语速百分比 → 百度档位（1–5），4 档为基准', () => {
  assert.equal(baiduSpeedFor('+0%'), 4)
  assert.equal(baiduSpeedFor(''), 4)
  assert.equal(baiduSpeedFor('+8%'), 5)
  assert.equal(baiduSpeedFor('-16%'), 2)
  assert.equal(baiduSpeedFor('+100%'), 5, '夹到上限')
  assert.equal(baiduSpeedFor('-100%'), 1, '夹到下限')
})

test('URL 拼装：中文文本要正确编码，参数齐全', () => {
  const url = new URL(buildBaiduUrl('你好，世界', { rate: '+8%' }))
  assert.equal(url.searchParams.get('lan'), 'zh')
  assert.equal(url.searchParams.get('text'), '你好，世界')
  assert.equal(url.searchParams.get('spd'), '5')
  assert.equal(url.searchParams.get('source'), 'web')
  assert.ok(!url.toString().includes(' '), '不该出现裸空格')
  assert.ok(url.toString().includes('%E4%BD%A0'), '中文要 URL 编码')
})

test('URL 拼装：允许覆盖端点（厂商换地址时）', () => {
  const url = buildBaiduUrl('测试', { endpoint: 'https://example.test/tts' })
  assert.ok(url.startsWith('https://example.test/tts?'))
})
