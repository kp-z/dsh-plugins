/**
 * R517：每轮输入体积的计数与超限提示。
 *
 * 模块只收"已经算好的字符数"，所以这里不需要造会话事件——正好可以把积分、平均、
 * 告警和快照语义逐条钉死；事件侧怎么算（user/message + 工具结果）由 index.ts 的监听负责。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_WARN_INPUT_CHARS, createTurnCost } from '../lib/runtime/turn-cost.js'

test('R517：累计轮次与输入/输出字符数', () => {
  const cost = createTurnCost()
  assert.deepEqual(cost.observe(100, 40), null)
  assert.deepEqual(cost.observe(200, 60), null)
  assert.deepEqual(cost.snapshot(), {
    turns: 2,
    inputChars: 300,
    outputChars: 100,
    avgInputChars: 150,
    warns: 0,
  })
})

test('R517：平均输入字符数按轮次四舍五入', () => {
  const cost = createTurnCost()
  cost.observe(100, 0)
  cost.observe(101, 0)
  // 100.5 → 101：显示用整数，不把浮点尾巴带出去。
  assert.equal(cost.snapshot().avgInputChars, 101)
})

test('R517：超限那一轮只记一次告警，并带回本轮的数和阈值', () => {
  const cost = createTurnCost({ warnInputChars: 100 })
  assert.equal(cost.observe(100, 0), null, '正好压在线上不算超过')
  assert.deepEqual(cost.observe(101, 25), { inputChars: 101, warnInputChars: 100 })
  const snap = cost.snapshot()
  assert.equal(snap.warns, 1, '一次超限只加一次，不能重复计')
  assert.deepEqual(
    [snap.turns, snap.inputChars, snap.outputChars],
    [2, 201, 25],
    '告警不影响累计',
  )
})

test('R517：连续超限的每一轮各记一次（warns 是超限轮数）', () => {
  const cost = createTurnCost({ warnInputChars: 100 })
  cost.observe(500, 0)
  cost.observe(500, 0)
  assert.equal(cost.snapshot().warns, 2)
})

test('R517：snapshot 是快照，后续 observe 不改旧对象', () => {
  const cost = createTurnCost()
  const before = cost.snapshot()
  cost.observe(10, 5)
  assert.deepEqual(before, { turns: 0, inputChars: 0, outputChars: 0, avgInputChars: 0, warns: 0 })
  const after = cost.snapshot()
  assert.notEqual(after, before, '每次都要新对象，别让读取方共享可变状态')
  assert.equal(after.turns, 1)
})

test('R517：空输入与非法字符数不报错', () => {
  const cost = createTurnCost()
  assert.deepEqual(cost.snapshot(), { turns: 0, inputChars: 0, outputChars: 0, avgInputChars: 0, warns: 0 })
  assert.equal(cost.observe(0, 0), null)
  // 上游算错（负数、NaN）只归零，不抛异常、不污染平均。
  assert.equal(cost.observe(-3, Number.NaN), null)
  assert.deepEqual(cost.snapshot(), { turns: 2, inputChars: 0, outputChars: 0, avgInputChars: 0, warns: 0 })
})

test('R517：默认提示线 120000 字符，超过才提示', () => {
  assert.equal(DEFAULT_WARN_INPUT_CHARS, 120_000)
  const cost = createTurnCost()
  assert.equal(cost.observe(DEFAULT_WARN_INPUT_CHARS, 0), null)
  assert.deepEqual(cost.observe(DEFAULT_WARN_INPUT_CHARS + 1, 0), {
    inputChars: DEFAULT_WARN_INPUT_CHARS + 1,
    warnInputChars: DEFAULT_WARN_INPUT_CHARS,
  })
  assert.equal(cost.snapshot().warns, 1)
})
