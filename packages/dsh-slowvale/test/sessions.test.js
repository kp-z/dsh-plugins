
/**
 * H2 验收：给角色开一个会话，上下文（persona/场合/处境）真的送到了，且能说话。
 *
 * 用确定性替身，不调模型——测的是"接缝与路由"，不是"模型答得好不好"。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CharacterSessions } from '../lib/runtime/character-sessions.js'
import { createScriptedPort, createUnavailablePort, SessionError } from '../lib/runtime/session-port.js'
import { CHARACTERS, findCharacter } from '../lib/content/characters.js'

function build(port) {
  return new CharacterSessions({ port, resolveCharacter: (id) => findCharacter(id) })
}

test('给角色开一个会话，上下文里带着他自己的人格与场合', async () => {
  const port = createScriptedPort({})
  const sessions = build(port)
  const lin = findCharacter('role.lin')
  assert.ok(lin)
  const opened = await sessions.open({ character: lin, channel: 'work', tick: 1, situation: '在科技公司三楼工位' })
  const context = port.contextOf(opened.sessionId)
  assert.ok(context)
  assert.match(context, /林野/)
  assert.match(context, /短句、克制/)
  assert.match(context, /工作场合/)
  assert.match(context, /在科技公司三楼工位/)
  assert.equal(sessions.bindingsOf('role.lin').length, 1)
})

test('三个人各开一个会话：三份上下文互不相同，人格各是各的', async () => {
  const port = createScriptedPort({})
  const sessions = build(port)
  const contexts = []
  for (const character of CHARACTERS) {
    const opened = await sessions.open({ character, channel: 'all', tick: 1 })
    contexts.push(port.contextOf(opened.sessionId) ?? '')
  }
  assert.equal(new Set(contexts).size, 3)
  assert.match(contexts[0] ?? '', /林野/)
  assert.match(contexts[1] ?? '', /小满/)
  assert.match(contexts[2] ?? '', /老周/)
})

test('说话按角色路由到 primary，回复能拿到', async () => {
  const port = createScriptedPort({ 'role.lin': ['行。', '不行。'] })
  const sessions = build(port)
  const lin = findCharacter('role.lin')
  assert.ok(lin)
  await sessions.open({ character: lin, channel: 'work', role: 'primary', tick: 1 })
  assert.equal(await sessions.say('role.lin', '这单能接吗'), '行。')
  assert.equal(await sessions.say('role.lin', '明天呢'), '不行。')
  assert.equal(port.spoken.length, 2)
})

test('只有旁观口时不能对外发言（observer 不是嘴）', async () => {
  const port = createScriptedPort({ 'role.lin': ['...'] })
  const sessions = build(port)
  const lin = findCharacter('role.lin')
  assert.ok(lin)
  await sessions.open({ character: lin, channel: 'work', role: 'observer', tick: 1 })
  await assert.rejects(() => sessions.say('role.lin', '在吗'), (error) => error instanceof SessionError)
})

test('同角色同频道的重复开会复用同一个会话（避免精神分裂）', async () => {
  const port = createScriptedPort({})
  const sessions = build(port)
  const lin = findCharacter('role.lin')
  assert.ok(lin)
  const a = await sessions.open({ character: lin, channel: 'work', tick: 1 })
  const b = await sessions.open({ character: lin, channel: 'work', tick: 2 })
  assert.equal(a.sessionId, b.sessionId)
  assert.equal(sessions.bindingsOf('role.lin').length, 1)
})

test('关掉会话后解绑，历史仍在', async () => {
  const port = createScriptedPort({ 'role.lin': ['行。'] })
  const sessions = build(port)
  const lin = findCharacter('role.lin')
  assert.ok(lin)
  const opened = await sessions.open({ character: lin, channel: 'work', role: 'primary', tick: 1 })
  assert.equal(await sessions.close(opened.sessionId, 5), true)
  assert.equal(sessions.speakerOf('role.lin'), null)
  assert.equal(sessions.table.history().length, 1, '绑定变更必须可回放')
  assert.deepEqual(sessions.table.validate(), [])
})

test('没有会话服务时报清楚的错，而不是静默', async () => {
  const sessions = build(createUnavailablePort('宿主没挂 sessionController'))
  const lin = findCharacter('role.lin')
  assert.ok(lin)
  await assert.rejects(
    () => sessions.open({ character: lin, channel: 'all', tick: 1 }),
    (error) => error instanceof SessionError && /sessionController/.test(error.message),
  )
})
