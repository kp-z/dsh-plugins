
/**
 * H4 验收：短信进得来、回得去、线程不随会话消失。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CharacterSessions } from '../lib/runtime/character-sessions.js'
import { Messenger } from '../lib/runtime/messenger.js'
import { createScriptedPort } from '../lib/runtime/session-port.js'
import { findCharacter } from '../lib/content/characters.js'

const lin = findCharacter('role.lin')
const mei = findCharacter('role.mei')
assert.ok(lin)
assert.ok(mei)

function setup(replies, reachability) {
  const port = createScriptedPort(replies)
  const sessions = new CharacterSessions({ port, resolveCharacter: (id) => findCharacter(id) })
  const messenger = new Messenger({
    sessions,
    resolveCharacter: (id) => findCharacter(id),
    ...(reachability === undefined ? {} : { reachability }),
  })
  return { port, sessions, messenger }
}

test('发一条短信：立刻收回执，线程里有"我发的"', async () => {
  const { messenger } = setup({ 'role.lin': ['行。'] })
  const receipt = messenger.receive('role.lin', '这单能接吗', 1)
  assert.equal(receipt.queued, true)
  assert.match(receipt.reason, /等回复/)
  const messages = messenger.messagesOf('role.lin')
  assert.equal(messages.length, 1)
  assert.equal(messages[0].from, 'player')
  assert.equal(messages[0].deliveredAtTick, null, '还没投递')
})

test('投递后线程里出现他的回复，且顺序是"我说完他说"', async () => {
  const { messenger, sessions } = setup({ 'role.lin': ['行。'] })
  messenger.receive('role.lin', '这单能接吗', 1)
  const replies = await messenger.deliver(2)
  assert.equal(replies.length, 1)
  assert.equal(replies[0].text, '行。')
  const messages = messenger.messagesOf('role.lin')
  assert.deepEqual(messages.map((message) => message.from), ['player', 'role.lin'])
  assert.equal(messages[0].deliveredAtTick, 2)
  assert.equal(sessions.currentOf('role.lin') !== null, true, '懒开了一个会话')
})

test('懒开的会话只在需要时开一次，第二句复用', async () => {
  const { messenger, port } = setup({ 'role.lin': ['行。', '嗯。'] })
  messenger.receive('role.lin', '第一句', 1)
  await messenger.deliver(2)
  messenger.receive('role.lin', '第二句', 3)
  await messenger.deliver(4)
  assert.equal(port.opened.length, 1, '不该为他开第二个会话')
  assert.equal(port.spoken.length, 2)
})

test('线程属于世界：会话归档换新后，旧记录还在，新回复接在后面', async () => {
  const { messenger, sessions } = setup({ 'role.lin': ['行。', '回来了。'] })
  messenger.receive('role.lin', '早上好', 1)
  await messenger.deliver(2)
  await sessions.rotate({ character: lin, channel: 'personal', tick: 5, reason: '下班了' })
  messenger.receive('role.lin', '晚上好', 5)
  await messenger.deliver(6)
  const messages = messenger.messagesOf('role.lin')
  assert.deepEqual(messages.map((message) => message.text), ['早上好', '行。', '晚上好', '回来了。'])
})

test('他在忙：消息留在队列里，别人照常投递', async () => {
  const { messenger, port } = setup(
    { 'role.lin': ['行。'], 'role.mei': ['在呀～'] },
    (characterId) => (characterId === 'role.lin' ? { ready: false, reason: '正在走路' } : { ready: true, reason: '' }),
  )
  const busy = messenger.receive('role.lin', '在吗', 1)
  assert.match(busy.reason, /在忙/)
  messenger.receive('role.mei', '在吗', 1)
  const replies = await messenger.deliver(2)
  assert.equal(replies.length, 1, '只有空的人回了')
  assert.equal(replies[0].characterId, 'role.mei')
  assert.equal(messenger.pendingCount(), 1, '忙的那个还在队列里')
  assert.equal(port.spoken.length, 1)
})

test('不存在的角色、空短信都直接报错', () => {
  const { messenger } = setup({})
  assert.throws(() => messenger.receive('role.nobody', '在吗', 1))
  assert.throws(() => messenger.receive('role.lin', '   ', 1))
})
