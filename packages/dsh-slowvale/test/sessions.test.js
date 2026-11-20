
/**
 * H2 验收：给角色开一个会话，上下文真的送到；换嘴要显式 rotate。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CharacterSessions } from '../lib/runtime/character-sessions.js'
import { createScriptedPort, createUnavailablePort, SessionError } from '../lib/runtime/session-port.js'
import { CHARACTERS, findCharacter } from '../lib/content/characters.js'

function build(port) {
  return new CharacterSessions({ port, resolveCharacter: (id) => findCharacter(id) })
}

const lin = findCharacter('role.lin')
const mei = findCharacter('role.mei')
assert.ok(lin)
assert.ok(mei)

test('给角色开一个会话，上下文里带着他自己的人格与场合', async () => {
  const port = createScriptedPort({})
  const sessions = build(port)
  const opened = await sessions.open({ character: lin, channel: 'work', tick: 1, situation: '在科技公司三楼工位' })
  const context = port.contextOf(opened.sessionId) ?? ''
  assert.match(context, /林野/)
  assert.match(context, /短句、克制/)
  assert.match(context, /工作场合/)
  assert.match(context, /在科技公司三楼工位/)
})

test('三个人各开一个会话：上下文互不相同', async () => {
  const port = createScriptedPort({})
  const sessions = build(port)
  const contexts = []
  for (const character of CHARACTERS) {
    const opened = await sessions.open({ character, channel: 'all', tick: 1 })
    contexts.push(port.contextOf(opened.sessionId) ?? '')
  }
  assert.equal(new Set(contexts).size, 3)
  assert.match(contexts[1] ?? '', /小满/)
})

test('已经有活会话时，再 open 会被拒绝（不偷偷复用也不顶替）', async () => {
  const port = createScriptedPort({})
  const sessions = build(port)
  await sessions.open({ character: lin, channel: 'work', tick: 1 })
  await assert.rejects(
    () => sessions.open({ character: lin, channel: 'personal', tick: 2 }),
    (error) => error instanceof SessionError && /rotate/.test(error.message),
  )
  assert.equal(port.opened.length, 1, '拒绝时不该真的开第二个会话')
})

test('rotate：归档旧会话，开新的，历史可查', async () => {
  const port = createScriptedPort({ 'role.lin': ['新的一段。'] })
  const sessions = build(port)
  const first = await sessions.open({ character: lin, channel: 'work', tick: 1 })
  const rotated = await sessions.rotate({ character: lin, channel: 'personal', tick: 9, reason: '下班了' })
  assert.equal(rotated.archived, first.sessionId)
  assert.notEqual(rotated.sessionId, first.sessionId)
  assert.match(rotated.contextText, /私人场合/)
  assert.equal(sessions.currentOf('role.lin'), rotated.sessionId)
  assert.equal(sessions.table.sessionsOf('role.lin').length, 2)
  assert.equal(await sessions.say('role.lin', '在吗'), '新的一段。')
  assert.equal(port.spoken[0].sessionId, rotated.sessionId, '说话必须走新会话')
})

test('没有活会话时不能说话', async () => {
  const sessions = build(createScriptedPort({ 'role.lin': ['行。'] }))
  await assert.rejects(() => sessions.say('role.lin', '在吗'), (error) => error instanceof SessionError && /没有活会话/.test(error.message))
})

test('归档后可以给同一个角色换一个新的', async () => {
  const port = createScriptedPort({})
  const sessions = build(port)
  const first = await sessions.open({ character: mei, channel: 'work', tick: 1 })
  assert.equal(await sessions.archive('role.mei', 4, '会话崩了'), first.sessionId)
  assert.equal(sessions.currentOf('role.mei'), null)
  const second = await sessions.open({ character: mei, channel: 'work', tick: 5 })
  assert.notEqual(second.sessionId, first.sessionId)
  assert.deepEqual(sessions.health(), [])
})

test('没有会话服务时报清楚的错', async () => {
  const sessions = build(createUnavailablePort('宿主没挂 sessionController'))
  await assert.rejects(
    () => sessions.open({ character: lin, channel: 'all', tick: 1 }),
    (error) => error instanceof SessionError && /sessionController/.test(error.message),
  )
})
