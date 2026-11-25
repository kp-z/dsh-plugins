import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'
import { endActivity, liveActivityOf, startActivity } from '../lib/sim/activity.js'

function freshWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
}

test('开始活动：有身份、有起止、挂在人身上', () => {
  const world = freshWorld()
  const agent = world.agents[0]
  const activity = startActivity(world, agent, { kind: 'work', skill: 'code', ticks: 40 })
  assert.match(activity.id, /^act-\d+$/)
  assert.equal(activity.status, 'active')
  assert.equal(activity.startedAt, world.tick)
  assert.equal(activity.endsAt, world.tick + 40)
  assert.equal(agent.activityId, activity.id)
  assert.equal(liveActivityOf(world, agent)?.id, activity.id)
})

test('新活动打断旧活动：旧的那条记 interrupted，不是悄悄消失', () => {
  const world = freshWorld()
  const agent = world.agents[0]
  const first = startActivity(world, agent, { kind: 'work', ticks: 100 })
  const second = startActivity(world, agent, { kind: 'visit', ticks: 20 })
  assert.equal(first.status, 'interrupted')
  assert.equal(first.endedAt, world.tick)
  assert.equal(agent.activityId, second.id)
})

test('到点自动完成（对账发生在 step 里）', () => {
  const world = freshWorld()
  const agent = world.agents[0]
  world.places = world.places ?? []
  const activity = startActivity(world, agent, { kind: 'visit', ticks: 3 })
  for (let i = 0; i < 5; i += 1) step(world, [])
  assert.equal(activity.status, 'completed')
  assert.equal(agent.activityId, undefined)
})

test('idle 命令结束活动并释放站点', () => {
  const world = freshWorld()
  const agent = world.agents[0]
  const activity = startActivity(world, agent, { kind: 'work', ticks: 100 })
  step(world, [{ kind: 'agentActivity', agentId: agent.id, activity: 'idle', ticks: 0 }])
  assert.equal(activity.status, 'completed')
  assert.equal(agent.activityKind, undefined)
  assert.equal(agent.station, null)
})

test('老代码只写 activityKind 时会被采纳成正式活动', () => {
  const world = freshWorld()
  const agent = world.agents[0]
  agent.activityKind = 'meet'
  agent.activityUntil = world.tick + 50
  step(world, [])
  const live = liveActivityOf(world, agent)
  assert.ok(live !== null, '应当有一条活动记录')
  assert.equal(live.kind, 'meet')
})
