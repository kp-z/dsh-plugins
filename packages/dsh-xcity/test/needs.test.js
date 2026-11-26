/**
 * R477：内在状态（体力 / 饥饿 / 社交）的衰减与恢复。
 *
 * 这一层只回答“量怎么变”，所以断言全部是数值方向与夹紧，不涉及“因此去哪”。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { advanceNeeds, needsOf } from '../lib/sim/needs.js'
import { step } from '../lib/sim/step.js'

function makeWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets: [],
  })
}

test('开局有需求；老数据没有时补默认值', () => {
  const world = makeWorld()
  for (const agent of world.agents) {
    assert.equal(typeof agent.needs.energy, 'number')
    assert.ok(agent.needs.energy > 0 && agent.needs.energy <= 100)
  }
  assert.deepEqual(needsOf({}), { energy: 80, hunger: 80, social: 80 })
})

test('什么都不做也会掉：三个量都随时间下降', () => {
  const world = makeWorld()
  const agent = world.agents[0]
  const before = { ...needsOf(agent) }
  for (let i = 0; i < 100; i += 1) advanceNeeds(world)
  assert.ok(agent.needs.energy < before.energy, '体力应当下降')
  assert.ok(agent.needs.hunger < before.hunger, '饥饿值应当下降')
  assert.ok(agent.needs.social < before.social, '社交值应当下降')
})

test('夹紧：最低到 0，不会变成负数', () => {
  const world = makeWorld()
  const agent = world.agents[0]
  agent.needs = { energy: 1, hunger: 1, social: 1 }
  for (let i = 0; i < 200; i += 1) advanceNeeds(world)
  assert.deepEqual(agent.needs, { energy: 0, hunger: 0, social: 0 })
})

test('睡觉恢复体力：同样 100 tick，睡着的比站着的高', () => {
  const world = makeWorld()
  const sleeper = world.agents[0]
  const idle = world.agents[1]
  sleeper.state = 'sleeping'
  idle.state = 'idle'
  sleeper.needs = { energy: 50, hunger: 50, social: 50 }
  idle.needs = { energy: 50, hunger: 50, social: 50 }
  for (let i = 0; i < 100; i += 1) advanceNeeds(world)
  assert.ok(sleeper.needs.energy > idle.needs.energy + 10, '睡觉应当明显回体力')
})

test('干活掉得更快：工作的体力低于同时间闲着的', () => {
  const world = makeWorld()
  const worker = world.agents[0]
  const idle = world.agents[1]
  worker.state = 'working'
  idle.state = 'idle'
  for (let i = 0; i < 100; i += 1) advanceNeeds(world)
  assert.ok(worker.needs.energy < idle.needs.energy, '工作应当多耗体力')
})

test('step 真的会推进需求（不是只写在模块里没人调用）', () => {
  const world = makeWorld()
  const agent = world.agents[0]
  const before = { ...needsOf(agent) }
  step(world)
  assert.ok(agent.needs.energy < before.energy)
  assert.ok(agent.needs.hunger < before.hunger)
})
