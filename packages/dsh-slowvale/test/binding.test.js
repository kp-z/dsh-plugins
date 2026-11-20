
/**
 * 绑定表：一个角色同一时刻只有一张嘴。
 *
 * 这些不变量是"人的模型"的直接翻译，不是防御性代码。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { BindingError, BindingTable } from '../lib/model/binding.js'

test('一个角色只能有一个活会话', () => {
  const table = new BindingTable()
  table.bind({ sessionId: 's1', characterId: 'role.lin', tick: 0 })
  assert.throws(
    () => table.bind({ sessionId: 's2', characterId: 'role.lin', tick: 1 }),
    (error) => error instanceof BindingError && /先 archive/.test(error.message),
  )
  assert.equal(table.current('role.lin')?.sessionId, 's1')
})

test('一个会话只能代表一个人', () => {
  const table = new BindingTable()
  table.bind({ sessionId: 's1', characterId: 'role.lin', tick: 0 })
  assert.throws(
    () => table.bind({ sessionId: 's1', characterId: 'role.mei', tick: 1 }),
    (error) => error instanceof BindingError && /已经是角色/.test(error.message),
  )
})

test('归档后可以开新的，历史留着', () => {
  const table = new BindingTable()
  table.bind({ sessionId: 's1', characterId: 'role.lin', channel: 'work', tick: 0 })
  assert.equal(table.archive('s1', 10, '换场'), true)
  assert.equal(table.current('role.lin'), null)
  table.bind({ sessionId: 's2', characterId: 'role.lin', channel: 'personal', tick: 11 })
  assert.equal(table.current('role.lin')?.sessionId, 's2')
  assert.equal(table.sessionsOf('role.lin').length, 2)
  const archived = table.history()[0]
  assert.equal(archived?.archivedAtTick, 10)
  assert.equal(archived?.archivedReason, '换场')
  assert.deepEqual(table.validate(), [])
})

test('归档后的会话不再是任何人的嘴', () => {
  const table = new BindingTable()
  table.bind({ sessionId: 's1', characterId: 'role.mei', tick: 0 })
  table.archive('s1', 5)
  assert.equal(table.characterOf('s1'), null)
  assert.equal(table.archive('s1', 6), false, '重复归档是无操作')
})

test('体检能发现被人为破坏的状态', () => {
  const table = new BindingTable()
  table.bind({ sessionId: 's1', characterId: 'role.lin', tick: 0 })
  assert.deepEqual(table.validate(), [])
  // 直接改行模拟数据损坏（回放/迁移场景）
  const row = table.history()[0]
  assert.ok(row)
  Object.assign(row, { sessionId: 's1' })
  const second = table.bind({ sessionId: 's2', characterId: 'role.zhou', tick: 1 })
  Object.assign(second, { characterId: 'role.lin' })
  const problems = table.validate()
  assert.ok(problems.some((item) => /多个活会话/.test(item)))
})
