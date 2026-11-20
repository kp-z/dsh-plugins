
/**
 * H8：预算与并发。这两条决定"接上真模型之后会不会一夜破产"。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { Budget, BudgetError, Guard, GuardError, withTimeout } from '../lib/runtime/guard.js'
import { ConversationError, Conversations } from '../lib/runtime/conversations.js'
import { CharacterSessions } from '../lib/runtime/character-sessions.js'
import { createScriptedPort } from '../lib/runtime/session-port.js'
import { findCharacter } from '../lib/content/characters.js'

test('预算：按 tick 计，用光就拒，下个 tick 刷新', () => {
  const budget = new Budget({ perTick: 2 })
  budget.spend(1)
  budget.spend(1)
  assert.equal(budget.remaining(1), 0)
  assert.throws(() => budget.spend(1), (error) => error instanceof BudgetError && /预算用完/.test(error.message))
  budget.spend(2)
  assert.equal(budget.usedIn(2), 1)
})

test('预算：丢掉旧 tick 的账，不无界增长', () => {
  const budget = new Budget({ perTick: 1 })
  budget.spend(1)
  budget.spend(2)
  budget.forgetBefore(2)
  assert.equal(budget.usedIn(1), 0)
  assert.equal(budget.usedIn(2), 1)
})

test('并发：满了就拒，并说清上限', async () => {
  const guard = new Guard({ maxInFlight: 1, timeoutMs: 1000 })
  let release
  const slow = new Promise((resolve) => {
    release = resolve
  })
  const first = guard.run(() => slow)
  await assert.rejects(
    () => guard.run(() => Promise.resolve(1)),
    (error) => error instanceof GuardError && /同时在跑/.test(error.message),
  )
  release('done')
  assert.equal(await first, 'done')
  assert.equal(guard.active, 0, '跑完必须还回来，否则永远卡死')
})

test('超时：抛错而不是返回空', async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 10, '等回复'),
    (error) => error instanceof GuardError && /等回复超时/.test(error.message),
  )
  assert.equal(await withTimeout(Promise.resolve('ok'), 1000), 'ok')
})

test('并发数在异常时也会还回来', async () => {
  const guard = new Guard({ maxInFlight: 1, timeoutMs: 1000 })
  await assert.rejects(() => guard.run(() => Promise.reject(new Error('boom'))))
  assert.equal(guard.active, 0)
  assert.equal(await guard.run(() => Promise.resolve('ok')), 'ok')
})

test('对话用共享预算，而不是自己记一套', async () => {
  const budget = new Budget({ perTick: 2 })
  const port = createScriptedPort({ 'role.mei': ['嗯。'] })
  const sessions = new CharacterSessions({ port, resolveCharacter: (id) => findCharacter(id) })
  const conversations = new Conversations({
    sessions,
    resolveCharacter: (id) => findCharacter(id),
    budget,
    maxHop: 10,
  })
  await conversations.sayTo({ fromId: 'role.lin', toId: 'role.mei', text: 'a', tick: 1 })
  await conversations.sayTo({ fromId: 'role.lin', toId: 'role.mei', text: 'b', tick: 1 })
  assert.equal(budget.usedIn(1), 2, '对话扣的是同一个预算')
  await assert.rejects(
    () => conversations.sayTo({ fromId: 'role.lin', toId: 'role.mei', text: 'c', tick: 1 }),
    (error) => error instanceof ConversationError && /预算用完/.test(error.message),
  )
})
