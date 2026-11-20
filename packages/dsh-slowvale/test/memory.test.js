
/**
 * H5 验收：记忆是有损的、有序的、跨会话存活的。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CharacterSessions } from '../lib/runtime/character-sessions.js'
import { Messenger } from '../lib/runtime/messenger.js'
import { DEFAULT_MEMORY_LIMIT, memoryFromThread, memoriesFor } from '../lib/runtime/memory.js'
import { createScriptedPort } from '../lib/runtime/session-port.js'
import { findCharacter } from '../lib/content/characters.js'

const lin = findCharacter('role.lin')
assert.ok(lin)

function message(id, from, text, tick = 1) {
  return { id, threadId: 'thread:role.lin', from, text, tick, deliveredAtTick: tick }
}

test('记忆标注说话人，且保持时间正序', () => {
  const memory = memoryFromThread(
    [message('m1', 'player', '这单能接吗'), message('m2', 'role.lin', '行。')],
    'role.lin',
  )
  assert.deepEqual(memory, ['对方：这单能接吗', 'role.lin：行。'])
})

test('只带最近几条，早的被丢掉了', () => {
  const messages = Array.from({ length: 20 }, (_, index) =>
    message('m' + String(index), index % 2 === 0 ? 'player' : 'role.lin', '第' + String(index) + '句'),
  )
  const memory = memoryFromThread(messages, 'role.lin')
  assert.equal(memory.length, DEFAULT_MEMORY_LIMIT)
  assert.match(memory[memory.length - 1] ?? '', /第19句/)
  assert.equal(memory.some((line) => line.includes('第0句')), false)
})

test('长段落被截断，不把整段聊天塞进上下文', () => {
  const long = '很长的句子'.repeat(40)
  const memory = memoryFromThread([message('m1', 'role.lin', long)], 'role.lin', { maxChars: 10 })
  assert.match(memory[0] ?? '', /…$/)
  const text = (memory[0] ?? '').split('：')[1] ?? ''
  assert.equal(text.length, 11, '10 字 + 省略号')
})

test('空线程返回空数组（记忆层就整层不出现）', () => {
  assert.deepEqual(memoriesFor([], 'role.lin'), [])
})

test('换嘴之后，新会话的上下文里带着之前聊过的内容', async () => {
  const port = createScriptedPort({ 'role.lin': ['行。', '记得，第七单还没送。'] })
  // 记忆的来源是"世界里的线程"，所以这里用闭包晚绑定：messenger 建好之后才能读到线程
  let messenger
  const sessions = new CharacterSessions({
    port,
    resolveCharacter: (id) => findCharacter(id),
    memoryFor: (id) => memoriesFor(messenger.messagesOf(id), id, { nameOf: (speaker) => findCharacter(speaker)?.name ?? speaker }),
  })
  messenger = new Messenger({ sessions, resolveCharacter: (id) => findCharacter(id) })
  messenger.receive('role.lin', '第七单什么时候送', 1)
  await messenger.deliver(2)

  const rotated = await sessions.rotate({ character: lin, channel: 'personal', tick: 9, reason: '下班了' })
  // bundle.text 只拼各节正文（标题不进文本），所以直接找那两句话
  assert.match(rotated.contextText, /对方：第七单什么时候送/)
  assert.match(rotated.contextText, /林野：行。/)
})

test('从没聊过时，懒开的会话里不该出现记忆层', async () => {
  const port = createScriptedPort({ 'role.mei': ['在呀～'] })
  const sessions = new CharacterSessions({ port, resolveCharacter: (id) => findCharacter(id) })
  const opened = await sessions.open({ character: findCharacter('role.mei'), channel: 'personal', tick: 1 })
  assert.equal(opened.contextText.includes('你还记得'), false)
})
