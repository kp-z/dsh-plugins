import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import {
  ACTIVITY_KEEP_FLOOR,
  ACTIVITY_KEEP_PER_AGENT,
  activityKeepFor,
  syncActivities,
} from '../lib/sim/activity.js'

function freshWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
}

/** 把世界的人数换成 n（syncActivities 只按 agents.length 算上限）。 */
function withAgents(world, n) {
  world.agents = Array.from({ length: n }, (_, index) => ({ id: 'a' + String(index) }))
  return world
}

function completed(id, tick) {
  return {
    id,
    agentId: 'a0',
    kind: 'work',
    placeId: null,
    stationId: null,
    status: 'completed',
    startedAt: tick,
    startedLogSeq: tick,
    endsAt: tick,
    endedAt: tick,
    endedLogSeq: tick,
  }
}

function active(id, tick) {
  return { ...completed(id, tick), status: 'active', endedAt: undefined, endedLogSeq: undefined }
}

function completedOf(world) {
  return world.activities.filter((activity) => activity.status !== 'active')
}

test('上限按人数算：少人走下限，多人按每人 24 条', () => {
  assert.equal(ACTIVITY_KEEP_FLOOR, 64)
  assert.equal(ACTIVITY_KEEP_PER_AGENT, 24)
  // 2 人 × 24 = 48 < 64，下限生效；3 人起就按人数走（24 × 3 = 72）。
  assert.equal(activityKeepFor({ agents: Array.from({ length: 2 }, () => ({})) }), ACTIVITY_KEEP_FLOOR)
  assert.equal(activityKeepFor({ agents: Array.from({ length: 3 }, () => ({})) }), 72)
  assert.equal(activityKeepFor({ agents: Array.from({ length: 10 }, () => ({})) }), 240)
  assert.equal(activityKeepFor({ agents: Array.from({ length: 24 }, () => ({})) }), 576)
})

test('裁剪只删已完成：进行中的活动一条不少', () => {
  const world = withAgents(freshWorld(), 24)
  world.activities = []
  for (let i = 0; i < 600; i += 1) world.activities.push(completed('done-' + String(i), i))
  world.activities.push(active('live-1', 1000), active('live-2', 1001))

  syncActivities(world)

  const live = world.activities.filter((activity) => activity.status === 'active')
  assert.equal(completedOf(world).length, 576)
  assert.equal(live.length, 2)
  assert.deepEqual(live.map((activity) => activity.id), ['live-1', 'live-2'])
  assert.equal(world.activities.length, 578)
})

test('进行中的活动永不删（全是进行中时环不收缩）', () => {
  const world = withAgents(freshWorld(), 3)
  world.activities = Array.from({ length: 100 }, (_, i) => active('live-' + String(i), i))

  syncActivities(world)

  assert.equal(world.activities.length, 100)
  assert.ok(world.activities.every((activity) => activity.status === 'active'))
})

test('按 tick 保新弃旧，原顺序不变', () => {
  const world = withAgents(freshWorld(), 24)
  world.activities = Array.from({ length: 600 }, (_, i) => completed('act-' + String(i), i))

  syncActivities(world)

  const kept = world.activities.map((activity) => activity.id)
  assert.equal(kept.length, 576)
  assert.equal(kept[0], 'act-24')
  assert.equal(kept[kept.length - 1], 'act-599')
  assert.deepEqual(kept, [...kept].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4))))
})

test('确定性：同样的世界裁出同样的环', () => {
  const build = () => {
    const world = withAgents(freshWorld(), 24)
    world.activities = Array.from({ length: 700 }, (_, i) => completed('act-' + String(i), i))
    syncActivities(world)
    return world.activities.map((activity) => activity.id)
  }
  assert.deepEqual(build(), build())
})
