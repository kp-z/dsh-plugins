/**
 * R482：人和人的关系。
 *
 * 守四件事：
 * 1. affinity 缺省 50、单次 +2、封顶 100；
 * 2. 同屋（同 district）聊天完成，双方都涨；不同屋不涨；
 * 3. 同一 tick 同一对只涨一次；
 * 4. 单角色世界不生成 social（留给主动短信）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { chooseLife } from '../lib/sim/life.js'
import { affinityOf, applyMeetAffinity, bumpAffinity } from '../lib/sim/relationships.js'
import { startActivity } from '../lib/sim/activity.js'
import { step } from '../lib/sim/step.js'
import { createWorld } from '../lib/world/create.js'

function makeWorld(agentCount = 8) {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const world = createWorld({ content, scene: 'scene.office', name: 'rel', createdAt: '2026-01-01T00:00:00.000Z', taskSets: [] })
  if (agentCount < world.agents.length) world.agents = world.agents.slice(0, agentCount)
  return world
}

function agent(id, position = { x: 0, z: 0 }) {
  return {
    id,
    name: id,
    role: 'engineer',
    state: 'talking',
    carrying: null,
    station: null,
    targetStation: null,
    path: [],
    position,
    facing: 0,
    hangout: null,
    boundAgentId: null,
    needs: { energy: 80, hunger: 80, social: 50 },
  }
}

function meetingStations(world) {
  const converse = world.stations.filter((station) => station.capabilities.includes('converse'))
  for (const first of converse) {
    const second = converse.find((station) => station.id !== first.id && station.district === first.district)
    if (second !== undefined) return [first, second]
  }
  throw new Error('场景里需要两个同屋 converse 站点')
}

test('affinity：缺省 50，单次 +2，封顶 100', () => {
  const a = { affinity: undefined }
  assert.equal(affinityOf(a, 'b'), 50)
  assert.equal(bumpAffinity(a, 'b'), 52)
  assert.equal(affinityOf(a, 'b'), 52)
  a.affinity.b = 99
  assert.equal(bumpAffinity(a, 'b'), 100)
  assert.equal(bumpAffinity(a, 'b'), 100)
})

test('同屋聊天：双方都 +2；不同屋不涨；同 tick 只加一次', () => {
  const world = makeWorld()
  const [s1, s2] = meetingStations(world)
  const one = agent('a1')
  const two = agent('a2')
  one.station = s1.id
  one.activityKind = 'meet'
  two.station = s2.id
  two.activityKind = 'meet'
  world.agents = [one, two]

  const activity = { id: 'act-1', agentId: 'a1', kind: 'meet', stationId: s1.id, status: 'completed', startedAt: 1, endsAt: 2 }
  const seen = new Set()
  const bumps = applyMeetAffinity(world, activity, seen)
  assert.equal(bumps.length, 2)
  assert.equal(affinityOf(one, 'a2'), 52)
  assert.equal(affinityOf(two, 'a1'), 52)

  // 第二次完成（同一 tick）：pair 已记过，不再加。
  assert.deepEqual(applyMeetAffinity(world, { ...activity, agentId: 'a2', stationId: s2.id }, seen), [])
  assert.equal(affinityOf(one, 'a2'), 52)
})

test('不同房间：不产生关系变化', () => {
  const world = makeWorld()
  const converse = world.stations.filter((station) => station.capabilities.includes('converse'))
  const different = converse.find((station, index) => converse.some((other, j) => j > index && other.district !== station.district))
  const other = converse.find((station) => station.district !== different.district)
  const one = agent('a1')
  const two = agent('a2')
  one.station = different.id
  two.station = other.id
  world.agents = [one, two]
  const activity = { id: 'act-1', agentId: 'a1', kind: 'meet', stationId: different.id, status: 'completed', startedAt: 1, endsAt: 2 }
  assert.deepEqual(applyMeetAffinity(world, activity, new Set()), [])
})

test('社交：有第二个角色 → 去 converse；单角色 → 不生成 social', () => {
  const two = makeWorld()
  two.tick = 20 * 60
  for (const row of two.agents) row.needs = { energy: 90, hunger: 90, social: 90 }
  two.agents[0].needs.social = 0
  const intent = chooseLife(two, two.agents[0])
  assert.equal(intent?.purpose, 'social')
  const station = two.stations.find((row) => row.id === intent.stationId)
  assert.ok(station.capabilities.includes('converse'))

  const solo = makeWorld(1)
  solo.tick = 20 * 60
  solo.agents[0].needs = { energy: 90, hunger: 90, social: 0 }
  assert.notEqual(chooseLife(solo, solo.agents[0])?.purpose, 'social')
})

test('step：meet 完成时发 agent.affinity，双方都涨', () => {
  const world = makeWorld()
  world.tick = 10 * 60
  const [s1, s2] = meetingStations(world)
  const one = world.agents[0]
  const two = world.agents[1]
  one.state = 'talking'
  one.station = s1.id
  one.activityKind = 'meet'
  two.state = 'talking'
  two.station = s2.id
  two.activityKind = 'meet'
  startActivity(world, one, { kind: 'meet', ticks: 5, stationId: s1.id })
  one.station = s1.id
  one.state = 'talking'
  one.activityUntil = world.tick

  const result = step(world, [])
  const events = result.events.filter((item) => item.type === 'agent.affinity')
  assert.equal(events.length, 2, '双方各一条')
  assert.equal(affinityOf(one, two.id), 52)
  assert.equal(affinityOf(two, one.id), 52)
})
