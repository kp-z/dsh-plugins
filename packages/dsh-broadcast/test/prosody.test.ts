import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SAY_BASE_RATE,
  normalizeRate,
  ratePercent,
  sayRateFromPercent,
  volumeToProsody,
} from '../lib/prosody.js'

test('normalizeRate 把各种写法统一成 SSML 的 +/-百分比', () => {
  assert.equal(normalizeRate('+8%'), '+8%')
  assert.equal(normalizeRate('8%'), '+8%')
  assert.equal(normalizeRate('-10%'), '-10%')
  assert.equal(normalizeRate(''), '+0%')
  assert.equal(normalizeRate('   '), '+0%')
  assert.equal(normalizeRate('fast'), '+0%')
  assert.equal(normalizeRate(undefined as unknown as string), '+0%')
})

test('ratePercent 只取数值部分', () => {
  assert.equal(ratePercent('+8%'), 8)
  assert.equal(ratePercent('-10%'), -10)
  assert.equal(ratePercent('nope'), 0)
})

test('sayRateFromPercent 以 190 为基准换算并夹紧', () => {
  assert.equal(SAY_BASE_RATE, 190)
  assert.equal(sayRateFromPercent('+0%'), 190)
  assert.equal(sayRateFromPercent('+8%'), 205)
  assert.equal(sayRateFromPercent('-10%'), 171)
  assert.equal(sayRateFromPercent('+500%'), 400) // 夹到上限
  assert.equal(sayRateFromPercent('-100%'), 80) // 夹到下限
})

test('volumeToProsody 把 0–100 映射成 SSML 相对音量', () => {
  assert.equal(volumeToProsody(100), '+0%')
  assert.equal(volumeToProsody(50), '-50%')
  assert.equal(volumeToProsody(0), '-100%')
  assert.equal(volumeToProsody(120), '+0%') // 越界夹紧
  assert.equal(volumeToProsody(-5), '-100%')
  assert.equal(volumeToProsody(Number.NaN), '+0%') // 非法值按满音量
})
