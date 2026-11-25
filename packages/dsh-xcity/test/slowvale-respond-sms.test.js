/**
 * 短信 -> 会话：到底用什么形状调了宿主。
 *
 * 这条测试存在的原因很具体：这段代码出过错——传 {sessionId, content: string}
 * 少了 requestId/mode/content[]/signal，宿主直接抛错，接口 500，短信静默丢失。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { respondViaSession, promptText } from '../lib/adapters/slowvale/respond-sms.js'

const agents = { 'agent-1': 'role.lin' }
const bindings = [{ characterId: 'role.lin', sessionId: 'xcity-lin-1' }]

function deps(overrides = {}) {
  const calls = []
  return {
    calls,
    deps: {
      characterOf: (peerRoleId) => agents[peerRoleId] ?? null,
      sessionOf: (characterId) => bindings.find((b) => b.characterId === characterId)?.sessionId ?? null,
      prompt: async (payload, signal) => { calls.push({ payload, hasSignal: signal instanceof AbortSignal }) },
      ...overrides,
    },
  }
}

test('短信投进会话：形状必须是 {requestId, sessionId, mode:queue, content:[text]} + signal', async () => {
  const { calls, deps: d } = deps()
  const result = await respondViaSession({ peerRoleId: 'agent-1', content: '去办公室工作' }, d, () => 42)

  assert.equal(result, null, '请求里不编假回复')
  assert.equal(calls.length, 1)
  const { payload, hasSignal } = calls[0]
  assert.equal(payload.sessionId, 'xcity-lin-1')
  assert.equal(payload.mode, 'queue')
  assert.deepEqual(payload.content.map((b) => b.type), ['text'])
  assert.ok(payload.content[0].text.includes('去办公室工作'), '原话要在投递文本里')
  assert.ok(payload.content[0].text.includes('<xcity-reply>'), '还要带回复格式要求')
  assert.equal(payload.requestId, 'xcity-sms:xcity-lin-1:42', 'requestId 要能唯一定位这次投递')
  assert.equal(hasSignal, true, '必须带 AbortSignal，宿主缺了会抛错')
})

test('没有这个 peer / 没绑会话：什么都不发', async () => {
  const { calls, deps: d } = deps()
  await respondViaSession({ peerRoleId: 'agent-9', content: '喂' }, d)
  await respondViaSession({ peerRoleId: 'agent-1', content: '喂' }, { ...d, sessionOf: () => null })
  assert.equal(calls.length, 0)
})

test('投进会话的话里带着「给前端看的回复」格式要求', () => {
  const text = promptText('去办公室工作')
  assert.ok(text.includes('去办公室工作'), '玩家原话要在')
  assert.ok(text.includes('<xcity-reply>'), '要有标记说明')
  assert.ok(text.includes('不会进游戏'), '要说明标记外只给 DSH 看')
})

test('转发成功后标记「这条在等回复」；没绑会话就不标记', async () => {
  const marked = []
  const d = {
    characterOf: () => 'role.lin',
    sessionOf: () => 'xcity-lin-1',
    prompt: async () => {},
    onForward: (peer) => marked.push(peer),
  }
  await respondViaSession({ peerRoleId: 'agent-1', content: 'hi' }, d)
  assert.deepEqual(marked, ['agent-1'])

  const none = []
  await respondViaSession(
    { peerRoleId: 'agent-9', content: 'hi' },
    { ...d, characterOf: () => null, onForward: (peer) => none.push(peer) },
  )
  assert.deepEqual(none, [], '没有绑定就不该等回复')
})
