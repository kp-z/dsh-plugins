import assert from 'node:assert/strict'
import test from 'node:test'

import { createSessionAsker, textOfMessage } from '../lib/adapters/slowvale/ask-session.js'

const msg = (text) => ({ message: { content: [{ type: 'text', text }] } })

test('R500：投递后收到 assistant 原文才算成功', async () => {
  const sent = []
  const asker = createSessionAsker({ prompt: async (payload) => { sent.push(payload) }, timeoutMs: 50 })
  const answer = asker.ask('s1', '今天打算做什么？')
  asker.observe('s1', 'assistant/message', msg('[{"what":"写测试","due":"10:00"}]'))
  assert.equal(await answer, '[{"what":"写测试","due":"10:00"}]')
  assert.equal(sent[0].sessionId, 's1')
  assert.equal(sent[0].message.content[0].text, '今天打算做什么？')
})

test('R500：超时返回 null，不挂在世界里', async () => {
  const asker = createSessionAsker({ prompt: async () => {}, timeoutMs: 20 })
  assert.equal(await asker.ask('s1', 'x'), null)
})

test('R500：同一会话不许并发两轮（答案会张冠李戴）', async () => {
  const asker = createSessionAsker({ prompt: async () => {}, timeoutMs: 50 })
  const first = asker.ask('s1', 'a')
  assert.equal(await asker.ask('s1', 'b'), null, '上一轮没回来，第二轮直接拒')
  asker.observe('s1', 'assistant/message', msg('回复'))
  assert.equal(await first, '回复')
})

test('R500：投递抛错不留下 pending', async () => {
  const asker = createSessionAsker({ prompt: async () => { throw new Error('no session') }, timeoutMs: 50 })
  assert.equal(await asker.ask('s1', 'x'), null)
  assert.equal(await asker.ask('s1', 'x'), null, '第二次仍可尝试，不是永久卡住')
})

test('R500：文本提取容错（字符串 / 分块 / 空）', () => {
  assert.equal(textOfMessage({ message: { content: 'hi' } }), 'hi')
  assert.equal(textOfMessage({ message: { content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }, { text: 'b' }] } }), 'ab')
  assert.equal(textOfMessage({}), '')
})
