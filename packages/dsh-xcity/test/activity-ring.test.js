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

test('H37/R542：忙闲悬殊时每人保底 24 条——忙碌者不能物理删掉别人的练习记录', () => {
  // 3 人世界 = 上限 72。agent-1 最近连轴转（70 条，tick 100–169），另两人早些时候各干过 10 条（tick 1–10）。
  // 旧实现按全局 FIFO 保新弃旧：90 - 72 = 18 条最老的会被砍掉，正好是**两个闲人的全部记录**
  // （实测现场 3 人 41 / 5 / 4 就是这么来的）。派生近期手感读这个环，闲人于是看起来没干过活。
  const world = withAgents(freshWorld(), 3)
  world.activities = []
  for (const agentId of ['a1', 'a2']) {
    for (let i = 0; i < 10; i += 1) world.activities.push({ ...completed(agentId + '-early-' + String(i), i + 1), agentId })
  }
  for (let i = 0; i < 70; i += 1) {
    world.activities.push({ ...completed('a0-busy-' + String(i), 100 + i), agentId: 'a0' })
  }

  syncActivities(world)

  const byAgent = { a0: [], a1: [], a2: [] }
  for (const activity of completedOf(world)) byAgent[activity.agentId].push(activity.id)
  // 闲人一条不丢（他们的记录全在"保底"里）。
  assert.equal(byAgent.a1.length, 10, '闲人 a1 的 10 条记录一条都不该被忙碌者挤掉')
  assert.equal(byAgent.a2.length, 10, '闲人 a2 同理')
  assert.deepEqual(byAgent.a1, Array.from({ length: 10 }, (_, i) => 'a1-early-' + String(i)))
  // 忙碌者仍留得住自己**最近**的 24 条（保底），超出的按全局 FIFO 退。
  assert.ok(byAgent.a0.length >= ACTIVITY_KEEP_PER_AGENT, '忙碌者自己也有 24 条保底')
  assert.deepEqual(byAgent.a0.slice(-24), Array.from({ length: 24 }, (_, i) => 'a0-busy-' + String(46 + i)), '保底的是最近 24 条')
  assert.equal(byAgent.a0[0], 'a0-busy-18', '超出的部分按时间序丢：最老的先走')
  // 总上限没被"保底"顶破。
  assert.equal(completedOf(world).length, 72)
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
