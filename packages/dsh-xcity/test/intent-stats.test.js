/**
 * R528：意图归因计数。
 *
 * 守四件事：
 * 1. 每个出口都有自己的格子，快照里全表都在（0 也要看得见）；
 * 2. `ok` 与"为什么没拿到"互斥——不是靠调用方自觉，是 `attributed` 按结果定的；
 * 3. snapshot 是拷贝，读的人改不动计数；reset 归零；
 * 4. 出口真的能走：把地点里那一类站点拿掉，就落到对应的那一格。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { intentOptions } from '../lib/sim/life.js'
import { INTENT_REASONS, createIntentStats, intentStats } from '../lib/sim/intent-stats.js'

const content = new ContentRegistry()
content.loadAll(builtinPacks())

const WORK_TIME = 10 * 60
const NOON = 12 * 60
const NIGHT = 2 * 60

function makeWorld() {
  return createWorld({ content, scene: 'scene.office', createdAt: '2026-01-01T00:00:00.000Z' })
}

/** 被测的那位：站着、没单、没有活动——即 available() 认的那个人。 */
function subjectOf(world) {
  const agent = world.agents[0]
  assert.ok(agent, '场景里至少要有一个人')
  agent.state = 'idle'
  agent.station = null
  agent.targetStation = null
  agent.path = []
  agent.carrying = null
  agent.activityUntil = undefined
  return agent
}

/** 把某一类站点从这个地点里**移走**（不是塞满）：塞满只影响 freeStation，pickStation 仍能挑到它。 */
function dropStations(world, predicate) {
  let dropped = 0
  for (let i = world.stations.length - 1; i >= 0; i -= 1) {
    if (predicate(world.stations[i])) {
      world.stations.splice(i, 1)
      dropped += 1
    }
  }
  assert.ok(dropped > 0, '这个场景里应当有这类站点，否则测试自己就没意义了')
}

/** 走一次 intentOptions，读一份快照；返回 [候选意图列表, 快照]。 */
function observe(world, agent) {
  intentStats.reset()
  const options = intentOptions(world, agent)
  return [options.map((option) => option.intent), intentStats.snapshot()]
}

/** 除 ok 以外的格子里一格都不许有。 */
function assertNoMiss(snapshot) {
  for (const reason of INTENT_REASONS) {
    if (reason === 'ok') continue
    assert.equal(snapshot.byReason[reason], 0, '拿到意图时不该同时记 ' + reason)
  }
}

test('R528：每个出口各有一格，快照里全表都在（0 也看得见）', () => {
  const stats = createIntentStats()
  assert.deepEqual(Object.keys(stats.snapshot().byReason), [...INTENT_REASONS])
  assert.equal(stats.snapshot().total, 0)

  for (const reason of INTENT_REASONS) stats.observe(reason)

  const snapshot = stats.snapshot()
  assert.equal(snapshot.total, INTENT_REASONS.length)
  for (const reason of INTENT_REASONS) assert.equal(snapshot.byReason[reason], 1, reason)
})

test('R528：snapshot 是拷贝——读的人改不动计数，旧快照也不跟着涨', () => {
  const stats = createIntentStats()
  stats.observe('ok')

  const before = stats.snapshot()
  before.byReason.ok = 99
  before.total = 99
  assert.deepEqual([stats.snapshot().total, stats.snapshot().byReason.ok], [1, 1])

  const later = stats.snapshot()
  stats.observe('ok')
  assert.equal(later.total, 1, '旧快照是快照，不随后续 observe 变化')
  assert.notEqual(stats.snapshot().byReason, later.byReason, '每次读都要新对象')
})

test('R528：reset 把总数与每一格都归零', () => {
  const stats = createIntentStats()
  stats.observe('ok')
  stats.observe('no-work-station')
  stats.reset()

  const snapshot = stats.snapshot()
  assert.equal(snapshot.total, 0)
  assert.deepEqual(Object.values(snapshot.byReason), INTENT_REASONS.map(() => 0))
})

test('R528：表外的原因不计数（挡住从 JSON/JS 传进来的野值）', () => {
  const stats = createIntentStats()
  stats.observe('wat')
  assert.equal(stats.snapshot().total, 0)
  assert.equal('wat' in stats.snapshot().byReason, false)
})

test('R528：拿到意图只记 ok，不叠记任何"为什么没拿到"', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)

  const [intents, snapshot] = observe(world, agent)
  assert.ok(intents.some((intent) => intent !== null), '上班时段应当有活可干')
  assert.equal(snapshot.total, 1, '一次调用只记一次')
  assert.equal(snapshot.byReason.ok, 1)
  assertNoMiss(snapshot)
})

test('R528：不在空闲的人记 not-available', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  agent.state = 'walking'

  const [intents, snapshot] = observe(world, agent)
  assert.deepEqual(intents, [], '在走的人不该被自己派活')
  assert.deepEqual([snapshot.total, snapshot.byReason['not-available'], snapshot.byReason.ok], [1, 1, 0])
})

test('R528：有 ready 单时记 task-ready', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  // intentOptions 只看 status：这里不需要一张能跑完的工单，只要求"有单在等人领"。
  world.tasks.push({ id: 'task-ready-for-attribution', status: 'ready', owner: null, carrying: null })

  const [intents, snapshot] = observe(world, agent)
  assert.deepEqual(intents, [], '有单等人领时不能先用"生活"占住人')
  assert.deepEqual([snapshot.total, snapshot.byReason['task-ready'], snapshot.byReason.ok], [1, 1, 0])
})

test('R528：饿了却没有茶水位 → hungry-no-breakroom', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  agent.needs = { hunger: 10, energy: 90, social: 90 }
  dropStations(world, (station) => station.kind === 'breakroom')

  const [intents, snapshot] = observe(world, agent)
  assert.deepEqual(intents, [null], '饿了没地方吃是"卡住"，不落到下一档')
  assert.deepEqual([snapshot.total, snapshot.byReason['hungry-no-breakroom'], snapshot.byReason.ok], [1, 1, 0])
})

test('R528：夜里连休息位都没有 → night-no-rest', () => {
  const world = makeWorld()
  world.tick = NIGHT
  const agent = subjectOf(world)
  agent.needs = { hunger: 90, energy: 90, social: 90 }
  dropStations(world, (station) => station.capabilities.includes('rest'))

  const [intents, snapshot] = observe(world, agent)
  assert.deepEqual(intents, [null], '连"去附近排队"的目标都挑不出来')
  assert.deepEqual([snapshot.total, snapshot.byReason['night-no-rest'], snapshot.byReason.ok], [1, 1, 0])
})

test('R528：累了却没有休息位 → no-rest-station', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  agent.needs = { hunger: 90, energy: 10, social: 90 }
  dropStations(world, (station) => station.capabilities.includes('rest'))

  const [intents, snapshot] = observe(world, agent)
  assert.deepEqual(intents, [null])
  assert.deepEqual([snapshot.total, snapshot.byReason['no-rest-station'], snapshot.byReason.ok], [1, 1, 0])
})

test('R528：上班的点一个工位都没有 → no-work-station', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  agent.needs = { hunger: 90, energy: 90, social: 90 }
  dropStations(world, (station) => station.capabilities.some((capability) => capability === 'code' || capability === 'review' || capability === 'research' || capability === 'compute'))

  const [intents, snapshot] = observe(world, agent)
  assert.deepEqual(intents, [null])
  assert.deepEqual([snapshot.total, snapshot.byReason['no-work-station'], snapshot.byReason.ok], [1, 1, 0])
})

test('R528：一圈走完没有可做的事 → need-null', () => {
  const world = makeWorld()
  world.tick = NOON
  const agent = subjectOf(world)
  agent.needs = { hunger: 90, energy: 90, social: 90 }
  dropStations(world, (station) => station.capabilities.includes('code') || station.capabilities.includes('research'))

  const [intents, snapshot] = observe(world, agent)
  assert.deepEqual(intents, [null])
  assert.deepEqual([snapshot.total, snapshot.byReason['need-null'], snapshot.byReason.ok], [1, 1, 0])
})

test('R528：归因不碰决策——同一世界连跑两次，候选与顺序一模一样', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)

  const first = observe(world, agent)[0]
  const second = observe(world, agent)[0]
  assert.deepEqual(second, first)
});
