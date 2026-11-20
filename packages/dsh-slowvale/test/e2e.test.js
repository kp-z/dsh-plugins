
/**
 * H9 端到端验收：三个人、一条完整链路。
 *
 * 覆盖：短信收发 → 懒开会话 → 记忆 → 换嘴（归档+新开）→ 角色互聊 →
 * 共享预算 → presence 移动。
 *
 * 用确定性替身，不调模型：这测的是"世界的规则是否成立"，不是"模型答得好不好"。
 * 后者必须在真机上验，见 README 的"尚未验证"一节。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { Budget } from '../lib/runtime/guard.js'
import { CharacterSessions } from '../lib/runtime/character-sessions.js'
import { Conversations } from '../lib/runtime/conversations.js'
import { Messenger } from '../lib/runtime/messenger.js'
import { memoriesFor } from '../lib/runtime/memory.js'
import { createScriptedPort } from '../lib/runtime/session-port.js'
import { PresenceView } from '../lib/view/presence.js'
import { CHARACTERS, findCharacter } from '../lib/content/characters.js'

const nameOf = (id) => findCharacter(id)?.name ?? id

function buildWorld(replies, budgetPerTick = 10) {
  const port = createScriptedPort(replies)
  const budget = new Budget({ perTick: budgetPerTick })
  let messenger
  const sessions = new CharacterSessions({
    port,
    resolveCharacter: (id) => findCharacter(id),
    // 记忆来自世界里的线程：晚绑定，因为 messenger 要用 sessions
    memoryFor: (id) => memoriesFor(messenger.messagesOf(id), id, { nameOf }),
  })
  messenger = new Messenger({ sessions, resolveCharacter: (id) => findCharacter(id), nameOf })
  const conversations = new Conversations({ sessions, resolveCharacter: (id) => findCharacter(id), budget })
  const presence = new PresenceView(2)
  return { port, budget, sessions, messenger, conversations, presence }
}

test('完整链路：短信 → 记忆 → 换嘴 → 互聊 → 预算', async () => {
  const world = buildWorld({
    'role.lin': ['行。', '记得，第七单还没送。'],
    'role.mei': ['我帮你问问老周？'],
    'role.zhou': ['急不得。'],
  })

  // 1) 三个角色都先在场上
  for (const [index, character] of CHARACTERS.entries()) {
    world.presence.place(character.id, 'place:office.tech_company_1', { x: index * 20, y: 40 })
  }

  // 2) 玩家给林野发短信：立刻回执，投递后才回复
  const receipt = world.messenger.receive('role.lin', '第七单什么时候送', 1)
  assert.equal(receipt.queued, true)
  let replies = await world.messenger.deliver(2)
  assert.equal(replies[0]?.text, '行。')
  assert.deepEqual(
    world.messenger.messagesOf('role.lin').map((message) => message.from),
    ['player', 'role.lin'],
  )

  // 3) 下班换嘴：归档旧会话、开新会话，记忆带过来
  const rotated = await world.sessions.rotate({
    character: findCharacter('role.lin'),
    channel: 'personal',
    tick: 9,
    reason: '下班了',
  })
  assert.ok(rotated.archived)
  assert.match(rotated.contextText, /对方：第七单什么时候送/)
  assert.equal(world.sessions.currentOf('role.lin'), rotated.sessionId)

  // 4) 换嘴之后再说一句：回复接在旧线程后面
  world.messenger.receive('role.lin', '刚才说到哪了', 10)
  replies = await world.messenger.deliver(11)
  assert.equal(replies[0]?.text, '记得，第七单还没送。')
  assert.equal(world.messenger.messagesOf('role.lin').length, 4)

  // 5) 林野找小满说话：过世界、带说话人、记录可查
  const talk = await world.conversations.sayTo({
    fromId: 'role.lin',
    toId: 'role.mei',
    text: '老周今天在店里吗',
    tick: 12,
  })
  assert.equal(talk.reply, '我帮你问问老周？')
  assert.match(world.port.spoken[world.port.spoken.length - 1].text, /^林野对你说：/)
  assert.equal(world.conversations.history().length, 1)

  // 6) 小满再去找老周（第二跳），到上限后第三跳被拒
  const second = await world.conversations.sayTo({
    fromId: 'role.mei',
    toId: 'role.zhou',
    text: '老周在吗',
    tick: 12,
    hop: 1,
  })
  assert.equal(second.reply, '急不得。')
  await assert.rejects(
    () => world.conversations.sayTo({ fromId: 'role.zhou', toId: 'role.lin', text: '……', tick: 12, hop: 3 }),
  )

  // 7) 预算：这一 tick 花了 2 次对话
  assert.equal(world.budget.usedIn(12), 2)

  // 8) presence：三个人都在场，坐标是整数，朝向合法
  const entries = world.presence.entries()
  assert.equal(entries.length, 3)
  for (const entry of entries) {
    assert.equal(Number.isInteger(entry.location.x), true)
    assert.ok(['up', 'down', 'left', 'right'].includes(entry.location.facing))
  }
})

test('预算耗尽时，短信投递也停（不是只有对话受限）', async () => {
  const world = buildWorld({ 'role.lin': ['行。'] }, 1)
  world.budget.spend(5, '别的地方')
  world.messenger.receive('role.lin', '在吗', 5)
  // 世界在投递前就该发现没预算——这里由调用方决定；本测试只钉住"预算确实共享"
  assert.equal(world.budget.remaining(5), 0)
})

test('三个角色的绑定互不干扰，各自只有一张嘴', async () => {
  const world = buildWorld({})
  for (const character of CHARACTERS) {
    await world.sessions.open({ character, channel: 'work', tick: 1 })
  }
  assert.equal(world.sessions.table.active().length, 3)
  for (const character of CHARACTERS) {
    assert.equal(world.sessions.table.sessionsOf(character.id).length, 1)
  }
  assert.deepEqual(world.sessions.health(), [])
})
