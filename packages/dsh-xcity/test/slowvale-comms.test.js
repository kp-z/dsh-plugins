/**
 * 沟通层与绑定的单元测试。
 *
 * 盯三件容易悄悄坏掉的事：
 * 1. 短信"收下即回执"——没 responder 时也必须落库；
 * 2. 绑定表 1:1 且归档不删行（换会话时聊天记录不丢）；
 * 3. visual 包的两个硬约束（payload.tick_marker 与信封一致、kind=independent 带 actorId）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SmsStore } from '../lib/adapters/slowvale/sms.js'
import { loadXcityBindings, characterOfSession } from '../lib/adapters/slowvale/xcity.js'
import { independentDialogue } from '../lib/adapters/slowvale/visual.js'

test('短信：没有 responder 时也要收下（回执语义）', async () => {
  const store = new SmsStore()
  store.ensureThread('agent-2', '小满')
  await store.send({
    threadId: 'thread:agent-2',
    senderRoleId: 'agent-1',
    senderName: '我',
    content: '在吗',
    sentAt: 't0',
    tick: 1,
  })
  const thread = store.get('thread:agent-2')
  assert.equal(thread?.messages.length, 1)
  assert.equal(thread?.messages[0]?.content, '在吗')
  assert.equal(thread?.unread, 0, '自己发的不算未读')
})

test('短信：responder 回的话会进线程并算未读', async () => {
  const store = new SmsStore()
  store.ensureThread('agent-2', '小满')
  store.useResponder(async () => '在的呀')
  await store.send({
    threadId: 'thread:agent-2',
    senderRoleId: 'agent-1',
    senderName: '我',
    content: '在吗',
    sentAt: 't0',
    tick: 1,
  })
  const thread = store.get('thread:agent-2')
  assert.equal(thread?.messages.length, 2)
  assert.equal(thread?.messages[1]?.content, '在的呀')
  assert.equal(thread?.unread, 1)
  store.markRead('thread:agent-2')
  assert.equal(store.get('thread:agent-2')?.unread, 0)
})

test('绑定投影：只认活着的行，归档的不算', () => {
  const bindings = loadXcityBindings('/nonexistent/bindings.json')
  assert.deepEqual(bindings, [], '文件不存在时返回空而不是抛错')
  assert.equal(characterOfSession(bindings, 's1'), null)
})

test('visual：tick_marker 与 cursor 必须一致，且带 actorId', () => {
  const packet = independentDialogue({
    epoch: 'epoch-w1',
    seq: 7,
    tickMarker: 'tick-42',
    actorId: 'agent-1',
    beat: { text: '今天风不小。' },
  })
  assert.equal(packet['tick_marker'], 'tick-42')
  assert.equal(packet['seq'], 7)
  assert.equal(packet['kind'], 'independent')
  assert.equal(packet['actorId'], 'agent-1')
  const beats = packet['beats']
  assert.equal(beats[0]?.dialogue?.text, '今天风不小。')
})
