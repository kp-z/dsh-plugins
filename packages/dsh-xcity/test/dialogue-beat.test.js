/**
 * R538：说话走前端的对话通道（dialogue 拍）。
 *
 * 这里钉的是**前端契约**，不是我们自己的偏好。前端在
 * slowvale-mirror/src/js/GameView.js：
 * - `:93830` `beat.dialogue && this._spawnSpeechBubble(beat.dialogue)`（说话的唯一入口）；
 * - `:93879` 缺 speaker_id 直接 throw；
 * - `:93883` 显示前先过 s5/r5 判 audience（`:93138-93166`），缺了抛「缺少 audience」；
 * - `:93888` `JL(A, g.text, g.tone || "speech")`，tone 只认 speech/sms/thought；
 * - `:92751` 空文本 throw「泡内容为空」；
 * - `:93839` `bubble.float_up` 是另一条通道（头顶浮字，不带名字）。
 *
 * 键名或 tone/audience.kind 一旦被"顺手改名"，前端要么抛错、要么静默丢弃，
 * 所以最后一组用例直接读前端源码做交叉核对。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DIALOGUE_TONES, floatTextBeat, sayBeat } from '../lib/adapters/slowvale/visual.js'

const GAME_VIEW = new URL('../../../slowvale-mirror/src/js/GameView.js', import.meta.url)
const PLACE = { kind: 'place', place_id: 'plaza' }

test('R538：三种 tone 都产出 dialogue 拍，默认 speech', () => {
  for (const tone of DIALOGUE_TONES) {
    assert.deepEqual(sayBeat('今天风不小。', { speakerId: 'agent-1', audience: PLACE, tone }), {
      dialogue: { speaker_id: 'agent-1', text: '今天风不小。', tone, audience: PLACE },
    })
  }
  assert.deepEqual(sayBeat('在的', { speakerId: 'agent-2', audience: PLACE }), {
    dialogue: { speaker_id: 'agent-2', text: '在的', tone: 'speech', audience: PLACE },
  })
})

test('R538：speaker_id / audience 是硬要求，缺了直接抛（前端必 throw）', () => {
  assert.throws(() => sayBeat('喂', { speakerId: '', audience: PLACE }), /缺少 speaker_id/)
  assert.throws(() => sayBeat('喂', { speakerId: 'agent-1' }), /缺少 audience/)
  assert.throws(() => sayBeat('喂', { speakerId: 'agent-1', audience: { kind: 'room' } }), /未知 audience\.kind: room/)
  assert.throws(() => sayBeat('喂', { speakerId: 'agent-1', audience: { kind: 'place' } }), /place audience 缺少 place_id/)
  assert.throws(
    () => sayBeat('喂', { speakerId: 'agent-1', audience: { kind: 'role_ids', role_ids: [] } }),
    /role_ids audience 缺少角色名单/,
  )
})

test('R538：两种 audience 形状原样透传，不编第三个', () => {
  const place = sayBeat('人在这儿', { speakerId: 'agent-1', audience: { kind: 'place', place_id: 'plaza' } })
  assert.deepEqual(place.dialogue.audience, { kind: 'place', place_id: 'plaza' })

  const roster = sayBeat('小声点，别声张', {
    speakerId: 'agent-1',
    tone: 'thought',
    audience: { kind: 'role_ids', role_ids: ['agent-1', 'agent-2'] },
  })
  assert.deepEqual(roster.dialogue.audience, { kind: 'role_ids', role_ids: ['agent-1', 'agent-2'] })
})

test('R538：空文本不发拍（前端 JL 会抛 泡内容为空）', () => {
  const options = { speakerId: 'agent-1', audience: PLACE }
  assert.deepEqual(sayBeat('', options), {}, '空文本不产生泡')
  assert.deepEqual(sayBeat('   \n\t', options), {}, '纯空白同样不产生泡')
})

test('R538：非法 tone 早失败（前端 JL 会抛 未知 tone）', () => {
  assert.throws(() => sayBeat('嗨', { speakerId: 'agent-1', audience: PLACE, tone: 'shout' }), /未知 tone/)
  assert.throws(() => sayBeat('嗨', { speakerId: 'agent-1', audience: PLACE, tone: 'SPEECH' }), /未知 tone/, 'tone 区分大小写')
})

test('R538：浮字通道留给非语言反馈，两条通道不合并', () => {
  const float = floatTextBeat('嗯')
  assert.deepEqual(float, { bubble: { text: '嗯', float_up: true } })
  assert.equal(float.dialogue, undefined, '浮字不是说话，不能带 dialogue')
  assert.equal(sayBeat('嗯', { speakerId: 'agent-1', audience: PLACE }).bubble, undefined, '说话不能退回头顶浮字')
})

test('R538：前端契约——拍里 dialogue 的键、tone 白名单、audience.kind 与镜像源码一致', () => {
  const src = readFileSync(GAME_VIEW, 'utf8')

  assert.match(src, /_spawnSpeechBubble\(g\) \{\s*if \(!g\.speaker_id\) throw new Error\("\[dialogue\] 缺少 speaker_id"\)/)
  assert.match(src, /JL\(A, g\.text, g\.tone \|\| "speech"\)/)
  assert.match(src, /if \(!g\) throw new Error\(`\[SpeechBubble\] \$\{m\.actorId\} 泡内容为空`\)/)
  assert.match(src, /g\.bubble\?\.text && g\.bubble\.float_up && this\.sprite && this\._spawnFloatText/)

  // tone 白名单直接从镜像的气泡样式表里取，防止两边各写一份渐行渐远。
  const toneTable = src.slice(src.indexOf('Mp = {'), src.indexOf('};', src.indexOf('Mp = {')))
  const toneKeys = [...toneTable.matchAll(/(\w+): \{ panelKey/g)].map((hit) => hit[1])
  assert.deepEqual([...toneKeys].sort(), [...DIALOGUE_TONES].sort())

  // audience 的 kind 也只认这两种（看门的 s5/r5 这一段）。
  const gate = src.slice(src.indexOf('function s5('), src.indexOf('const Lp ='))
  assert.match(gate, /缺少 audience/)
  const audienceKinds = [...new Set([...gate.matchAll(/\.kind === "(\w+)"/g)].map((hit) => hit[1]))]
  assert.deepEqual(audienceKinds.sort(), ['place', 'role_ids'])

  // 我们发出去的键名与顺序就是上面这几个（多一个少一个前端行为都变）。
  assert.deepEqual(Object.keys(sayBeat('喂', { speakerId: 'agent-1', audience: PLACE }).dialogue), [
    'speaker_id',
    'text',
    'tone',
    'audience',
  ])
})
