
/**
 * 绑定表的三条不变量。
 *
 * 这些不是"顺便检查"，而是这套设计的核心：
 * 会话是嘴、角色是人——一个会话不能同时是两个人，一个人不能有两张主嘴。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { BindingError, BindingTable } from '../lib/model/binding.js'

test('一个会话只能代表一个人', () => {
  const table = new BindingTable()
  table.bind({ sessionId: 's1', characterId: 'role.lin', role: 'primary', tick: 0 })
  assert.throws(
    () => table.bind({ sessionId: 's1', characterId: 'role.mei', tick: 1 }),
    (error) => error instanceof BindingError && /已绑定/.test(error.message),
  )
  assert.equal(table.characterOf('s1'), 'role.lin')
})

test('一个人可以有多张嘴，但只能有一个 primary', () => {
  const table = new BindingTable()
  table.bind({ sessionId: 's1', characterId: 'role.lin', role: 'primary', tick: 0 })
  table.bind({ sessionId: 's2', characterId: 'role.lin', role: 'secondary', channel: 'work', tick: 0 })
  assert.equal(table.sessionsOf('role.lin').length, 2)
  assert.equal(table.primaryOf('role.lin')?.sessionId, 's1')
  assert.throws(
    () => table.bind({ sessionId: 's3', characterId: 'role.lin', role: 'primary', tick: 1 }),
    (error) => error instanceof BindingError && /只能有一个主口/.test(error.message),
  )
  assert.deepEqual(table.validate(), [])
})

test('解绑写 unboundAtTick 而不是删行', () => {
  const table = new BindingTable()
  table.bind({ sessionId: 's1', characterId: 'role.mei', role: 'primary', tick: 5 })
  assert.equal(table.unbind('s1', 9), true)
  assert.equal(table.characterOf('s1'), null)
  assert.equal(table.history().length, 1, '历史必须留着：绑定变更要能回放')
  assert.equal(table.history()[0]?.unboundAtTick, 9)
  table.bind({ sessionId: 's1', characterId: 'role.zhou', role: 'secondary', tick: 10 })
  assert.equal(table.characterOf('s1'), 'role.zhou')
})

test('observer 不能是主口，也不能看全部', () => {
  const table = new BindingTable()
  assert.throws(() => table.bind({ sessionId: 's1', characterId: 'role.lin', role: 'observer', channel: 'all', tick: 0 }))
  table.bind({ sessionId: 's2', characterId: 'role.lin', role: 'observer', channel: 'work', tick: 0 })
  assert.equal(table.speakerOf('role.lin'), null, '只有旁观口时，角色没有人能对外发言')
})

test('对外发言优先 primary，其次 secondary', () => {
  const table = new BindingTable()
  table.bind({ sessionId: 's2', characterId: 'role.lin', role: 'secondary', tick: 0 })
  assert.equal(table.speakerOf('role.lin')?.sessionId, 's2')
  table.bind({ sessionId: 's1', characterId: 'role.lin', role: 'primary', tick: 1 })
  assert.equal(table.speakerOf('role.lin')?.sessionId, 's1')
})
