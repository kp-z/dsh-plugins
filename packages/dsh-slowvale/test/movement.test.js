
/**
 * 手感契约的三条判别式：不瞬移、不斜飘、到点吸附。
 *
 * 这不是"实现细节测试"——它就是"游戏性没被改坏"的证据。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_STEP_PIXELS, facingFor, stepToward, ticksToReach } from '../lib/rules/movement.js'

const start = { x: 100, y: 100, facing: 'right', moving: false }

test('每 tick 位移不超过上限（瞬移判别式）', () => {
  let state = start
  for (let i = 0; i < 200; i += 1) {
    const next = stepToward(state, { x: 900, y: 700 })
    const moved = Math.hypot(next.x - state.x, next.y - state.y)
    assert.ok(moved <= DEFAULT_STEP_PIXELS + 1e-9, '第 ' + String(i) + ' 步位移 ' + String(moved))
    state = next
  }
})

test('斜着走也不超过上限（按欧氏距离算）', () => {
  const next = stepToward(start, { x: 500, y: 500 })
  assert.ok(Math.hypot(next.x - start.x, next.y - start.y) <= DEFAULT_STEP_PIXELS + 1e-9)
})

test('朝向只能是四向，取主轴', () => {
  assert.equal(facingFor(10, 1, 'down'), 'right')
  assert.equal(facingFor(-10, 1, 'down'), 'left')
  assert.equal(facingFor(1, 10, 'left'), 'down')
  assert.equal(facingFor(1, -10, 'left'), 'up')
  assert.equal(facingFor(0, 0, 'up'), 'up', '不动的时候不该转身')
})

test('到点吸附：不会停在目标旁边，moving 归 false', () => {
  const near = { x: 100, y: 100, facing: 'right', moving: true }
  const next = stepToward(near, { x: 101, y: 100 })
  assert.equal(next.x, 101)
  assert.equal(next.y, 100)
  assert.equal(next.moving, false)
})

test('走得越远，预计 tick 越多，且是上取整', () => {
  assert.equal(ticksToReach({ x: 0, y: 0 }, { x: 10, y: 0 }, 2), 5)
  assert.equal(ticksToReach({ x: 0, y: 0 }, { x: 11, y: 0 }, 2), 6)
  assert.ok(ticksToReach({ x: 0, y: 0 }, { x: 100, y: 0 }) > ticksToReach({ x: 0, y: 0 }, { x: 10, y: 0 }))
})

test('非法步长直接报错，不静默变成瞬移', () => {
  assert.throws(() => stepToward(start, { x: 0, y: 0 }, 0))
  assert.throws(() => stepToward(start, { x: 0, y: 0 }, -1))
})
