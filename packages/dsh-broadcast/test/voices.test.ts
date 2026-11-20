import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import {
  DEFAULT_VOICE_ID,
  VOICE_OPTIONS,
  auditionText,
  isKnownVoice,
  normalizeVoiceId,
  sayVoiceOf,
  voiceKindOf,
} from '../lib/voices.js'

test('清单：id 唯一、在线排在前面、本机音色男女都有', () => {
  const ids = VOICE_OPTIONS.map((option) => option.id)
  assert.equal(new Set(ids).size, ids.length, 'id 不能重复')
  assert.equal(VOICE_OPTIONS[0].id, 'baidu', '在线音色排第一')
  assert.equal(VOICE_OPTIONS[0].kind, 'online')
  assert.equal(DEFAULT_VOICE_ID, 'baidu')
  for (const option of VOICE_OPTIONS) {
    assert.ok(option.label.length > 0)
    assert.equal(isKnownVoice(option.id), true)
  }
})

/**
 * 本机音色 id 后面那段必须真的存在于 `say -v`——否则用户点了一个没反应的音色。
 * 需要 macOS，其它平台跳过。
 */
test('本机音色的 say 名字在这台机器上真的存在', { skip: process.platform !== 'darwin' }, () => {
  const listed = execFileSync('say', ['-v', '?']).toString()
  for (const option of VOICE_OPTIONS) {
    const name = sayVoiceOf(option.id)
    if (name === undefined) continue
    assert.ok(listed.includes(name), `say 里找不到音色：${name}`)
  }
})

test('normalizeVoiceId：认得新格式、老 edge 音色、裸 say 名字，其余给默认值', () => {
  assert.equal(normalizeVoiceId('baidu'), 'baidu')
  assert.equal(normalizeVoiceId('say:Meijia'), 'say:Meijia')
  assert.equal(normalizeVoiceId('zh-CN-XiaoxiaoNeural'), 'say:Tingting', '老 edge 音色迁移')
  assert.equal(normalizeVoiceId('Eddy (中文（中国大陆）)'), 'say:Eddy (中文（中国大陆）)', '老 state.json 里的裸名字')
  assert.equal(normalizeVoiceId(''), DEFAULT_VOICE_ID)
  assert.equal(normalizeVoiceId(undefined), DEFAULT_VOICE_ID)
  assert.equal(normalizeVoiceId('whatever'), DEFAULT_VOICE_ID)
})

test('voiceKindOf / sayVoiceOf 分得清两族', () => {
  assert.equal(voiceKindOf('baidu'), 'online')
  assert.equal(voiceKindOf('say:Tingting'), 'offline')
  assert.equal(sayVoiceOf('baidu'), undefined)
  assert.equal(sayVoiceOf('say:Tingting'), 'Tingting')
})

test('auditionText：带上音色名，本机音色额外说明会更机械', () => {
  const online = auditionText('baidu')
  assert.match(online, /在线女声/)
  assert.equal(online.includes('机械'), false)

  const offline = auditionText('say:Tingting')
  assert.match(offline, /婷婷/)
  assert.match(offline, /机械/)
  assert.ok(offline.length <= 60)

  assert.equal(auditionText('unknown').includes('这个音色'), true)
})
