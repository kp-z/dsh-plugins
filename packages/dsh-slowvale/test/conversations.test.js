
/**
 * H6 验收：角色之间的对话过世界，且有明确的上限。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CharacterSessions } from '../lib/runtime/character-sessions.js'
import { ConversationError, Conversations } from '../lib/runtime/conversations.js'
import { createScriptedPort } from '../lib/runtime/session-port.js'
import { findCharacter } from '../lib/content/characters.js'

const lin = findCharacter('role.lin')
const mei = findCharacter('role.mei')
assert.ok(lin)
assert.ok(mei)

function setup(replies, options = {}) {
  const port = createScriptedPort(replies)
  const sessions = new CharacterSessions({ port, resolveCharacter: (id) => findCharacter(id) })
  const conversations = new Conversations({ sessions, resolveCharacter: (id) => findCharacter(id), ...options })
  return { port, sessions, conversations }
}

test('A 对 B 说一句：B 收到的文本里带着说话人，回复能拿回来', async () => {
  const { conversations, port } = setup({ 'role.mei': ['在呀，什么事？'] })
  const result = await conversations.sayTo({ fromId: 'role.lin', toId: 'role.mei', text: '下午有空吗', tick: 1 })
  assert.equal(result.reply, '在呀，什么事？')
  assert.equal(port.spoken[0].text, '林野对你说：下午有空吗', '一个会话只有一个人，对方身份必须写进文本')
})

test('对话记录进世界，可回放', async () => {
  const { conversations } = setup({ 'role.mei': ['好。'] })
  await conversations.sayTo({ fromId: 'role.lin', toId: 'role.mei', text: '走吗', tick: 1 })
  const history = conversations.history()
  assert.equal(history.length, 1)
  assert.equal(history[0].fromId, 'role.lin')
  assert.equal(history[0].toId, 'role.mei')
  assert.equal(history[0].text, '走吗')
  assert.equal(conversations.utterancesOf('role.mei').length, 1)
})

test('跳太深就拒：A→B→A→B 会被拦在第三跳', async () => {
  const { conversations } = setup({ 'role.mei': ['嗯。'], 'role.lin': ['哦。'] }, { maxHop: 2 })
  await conversations.sayTo({ fromId: 'role.lin', toId: 'role.mei', text: '一', tick: 1, hop: 0 })
  await conversations.sayTo({ fromId: 'role.mei', toId: 'role.lin', text: '二', tick: 1, hop: 1 })
  await conversations.sayTo({ fromId: 'role.lin', toId: 'role.mei', text: '三', tick: 1, hop: 2 })
  await assert.rejects(
    () => conversations.sayTo({ fromId: 'role.mei', toId: 'role.lin', text: '四', tick: 1, hop: 3 }),
    (error) => error instanceof ConversationError && /对话太长/.test(error.message),
  )
})

test('每 tick 有预算：话痨两个人也不能无限聊', async () => {
  const { conversations } = setup({ 'role.mei': ['嗯。'] }, { maxPerTick: 2, maxHop: 10 })
  await conversations.sayTo({ fromId: 'role.lin', toId: 'role.mei', text: 'a', tick: 1 })
  await conversations.sayTo({ fromId: 'role.lin', toId: 'role.mei', text: 'b', tick: 1 })
  assert.equal(conversations.usedInTick(1), 2)
  await assert.rejects(
    () => conversations.sayTo({ fromId: 'role.lin', toId: 'role.mei', text: 'c', tick: 1 }),
    (error) => error instanceof ConversationError && /本轮对话已用完/.test(error.message),
  )
  // 下一个 tick 预算刷新
  await conversations.sayTo({ fromId: 'role.lin', toId: 'role.mei', text: 'd', tick: 2 })
  assert.equal(conversations.usedInTick(2), 1)
})

test('B 没有活会话时，世界替他开一个，并告诉他"谁走过来了"', async () => {
  const { conversations, port } = setup({ 'role.zhou': ['哟，稀客。'] })
  await conversations.sayTo({ fromId: 'role.lin', toId: 'role.zhou', text: '来看看您', tick: 3 })
  const context = port.opened[0]?.contextText ?? ''
  assert.match(context, /林野走过来跟你说话/)
})

test('不能自说自话，也不能对不存在的人说', async () => {
  const { conversations } = setup({})
  await assert.rejects(() => conversations.sayTo({ fromId: 'role.lin', toId: 'role.lin', text: '嗯', tick: 1 }))
  await assert.rejects(() => conversations.sayTo({ fromId: 'role.lin', toId: 'role.nobody', text: '嗯', tick: 1 }))
})
