import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import {
  DEFAULT_SAY_VOICE,
  VOICE_OPTIONS,
  auditionText,
  isKnownVoice,
  resolveSayVoice,
} from '../lib/voices.js'

test('音色清单：id 唯一、都带中文说明、默认音色在表里', () => {
  const ids = VOICE_OPTIONS.map((option) => option.id)
  assert.equal(new Set(ids).size, ids.length, 'id 不能重复')
  for (const option of VOICE_OPTIONS) {
    assert.ok(option.label.length > 0)
    assert.equal(isKnownVoice(option.id), true)
  }
  assert.ok(ids.includes(DEFAULT_SAY_VOICE))
  assert.ok(VOICE_OPTIONS.filter((option) => option.label.includes('男声')).length > 0, '男声也得有得选')
})

/**
 * 清单里的每个 id 都必须在 `say -v` 里真的存在——否则用户点了一个没反应的音色。
 * 这条会调用本机 `say`，非 macOS 上跳过。
 */
test('清单里的音色在这台机器上真的存在（调 say 校验）', { skip: process.platform !== 'darwin' }, () => {
  const listed = execFileSync('say', ['-v', '?']).toString()
  for (const option of VOICE_OPTIONS) {
    assert.ok(listed.includes(option.id), `say 里找不到音色：${option.id}`)
  }
})

test('resolveSayVoice：选择器 > 旧 edge 音色映射 > 婷婷', () => {
  assert.equal(resolveSayVoice({ sayVoice: 'Meijia' }), 'Meijia', '选过的优先')
  assert.equal(resolveSayVoice({ sayVoice: '', voice: 'zh-CN-XiaoxiaoNeural' }), 'Tingting')
  assert.equal(resolveSayVoice({ voice: 'zh-CN-YunxiNeural' }), 'Eddy (中文（中国大陆）)')
  assert.equal(resolveSayVoice({ voice: 'Eddy (中文（中国大陆）)' }), 'Eddy (中文（中国大陆）)', '直接写 say 名字也认')
  assert.equal(resolveSayVoice({ voice: 'some-unknown-voice' }), DEFAULT_SAY_VOICE)
  assert.equal(resolveSayVoice({}), DEFAULT_SAY_VOICE)
})

test('auditionText 会把音色名字念进去，长度适合当试听', () => {
  const text = auditionText('Tingting')
  assert.match(text, /婷婷/)
  assert.ok(text.length <= 40)
  assert.equal(auditionText('unknown').includes('unknown'), true)
})
