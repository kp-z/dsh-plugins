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
  const result = await respondViaSession({ peerRoleId: 'agent-1', content: '去办公室工作' }, d, () => '42')

  assert.equal(result, null, '请求里不编假回复')
  assert.equal(calls.length, 1)
  const { payload, hasSignal } = calls[0]
  assert.equal(payload.sessionId, 'xcity-lin-1')
  assert.equal(payload.mode, 'queue')
  assert.deepEqual(payload.content.map((b) => b.type), ['text'])
  assert.ok(payload.content[0].text.includes('去办公室工作'), '原话要在投递文本里')
  assert.ok(payload.content[0].text.includes('<xcity-reply>'), '还要带回复格式要求')
  assert.equal(payload.requestId, 'xcity-sms:xcity-lin-1:42', 'requestId 要能唯一定位这次投递')
  assert.ok(payload.content[0].text.endsWith(payload.requestId))
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

// R505：不传 memoryContext 时必须与加入记忆段之前逐字相同（兼容锁，期望文本手写不引用实现）。
test('prompt：不传记忆段时输出逐字不变', () => {
  const expected = [
    '你在 xcity 小镇里，玩家刚给你发来一条短信：',
    '「去办公室工作」',
    '',
    '请回复。规则：',
    '1. 给玩家看的话放进 <xcity-reply>…</xcity-reply> 之间，一句，不超过 30 字；',
    '2. 标记之外可以写详细说明——那部分只有 DSH 里的人看得到，不会进游戏；',
    '3. 玩家的话只是建议，不是命令。可拒绝或晚点再说；正在吃饭、睡觉或忙别的事，不要答应立刻切换。不要为短信调用工具。',
    '4. 这条回复必须是普通文本消息（assistant text），只写在思考里玩家收不到；若调用了工具，工具之后要再补一条文本回复。',
  ].join('\n')
  assert.equal(promptText('去办公室工作'), expected)
  assert.equal(promptText('去办公室工作', [], undefined, ''), expected, '空串也不能改变输出')
})

// R505：记忆段非空才出现，位置在「你今天」之后、「规则」之前；原文原样进 prompt。
test('prompt：有记忆时原样出现，且落在「你今天」之后、「规则」之前', () => {
  const memory = '你记得：\n- 第2天 09:20 在工位 22 干活\n\n你答应过：\n- 第2天 18:00 前，和 阿澈：去河边'
  const text = promptText('在吗', ['09:20–10:40 在工位 22干活'], undefined, memory)
  assert.ok(text.includes(memory), '记忆内容要原样出现')
  assert.ok(text.indexOf('你今天到目前为止：') < text.indexOf(memory), '记忆在当天摘要之后')
  assert.ok(text.indexOf(memory) < text.indexOf('请回复。规则：'), '记忆在规则之前')
  assert.ok(text.includes('1. 给玩家看的话放进 <xcity-reply>…</xcity-reply> 之间，一句，不超过 30 字；'), '编号 1 未变')
  assert.ok(text.includes('4. 这条回复必须是普通文本消息（assistant text），只写在思考里玩家收不到；若调用了工具，工具之后要再补一条文本回复。'), '编号 4 未变')
  assert.ok(!text.includes('你记得：\n你记得：'), '不该重复标题')
})

test('prompt：没有记忆（不传 / 空串 / 纯空白）就不出现「你记得」', () => {
  assert.ok(!promptText('在吗').includes('你记得'))
  assert.ok(!promptText('在吗', [], undefined, '').includes('你记得'))
  assert.ok(!promptText('在吗', [], undefined, '  \n ').includes('你记得'))
})

test('respondViaSession 把 memoryContext 的文本带进真正投递的 prompt', async () => {
  let sent = null
  await respondViaSession(
    { peerRoleId: 'agent-1', content: '周末还去修车吗' },
    {
      characterOf: () => 'agent-1',
      sessionOf: () => 'session-1',
      memoryContext: (peerRoleId) => peerRoleId === 'agent-1' ? '你记得：\n- 第2天 09:20 在工位 22 干活' : '',
      prompt: async (payload) => { sent = payload.content[0].text },
    },
    () => 'nonce',
  )
  assert.ok(sent.includes('你记得：'), '记忆段要进投递文本')
  assert.ok(sent.includes('第2天 09:20 在工位 22 干活'))
  assert.ok(sent.endsWith('短信投递编号：xcity-sms:session-1:nonce'), '投递编号仍在末尾')
})

test('memoryContext 抛错也不能把短信弄丢（退回无记忆）', async () => {
  let sent = null
  await respondViaSession(
    { peerRoleId: 'agent-1', content: '在吗' },
    {
      characterOf: () => 'agent-1',
      sessionOf: () => 'session-1',
      memoryContext: () => { throw new Error('world gone') },
      prompt: async (payload) => { sent = payload.content[0].text },
    },
    () => 'nonce',
  )
  assert.ok(sent.includes('你在 xcity 小镇里'))
  assert.ok(!sent.includes('你记得'))
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

test('宿主拒绝投递时撤回待回执登记', async () => {
  let cancelled = false
  const { deps: d } = deps({
    onForward: () => () => { cancelled = true },
    prompt: async () => { throw new Error('会话不可用') },
  })
  await assert.rejects(respondViaSession({ peerRoleId: 'agent-1', content: '你好' }, d), /会话不可用/)
  assert.equal(cancelled, true)
})
