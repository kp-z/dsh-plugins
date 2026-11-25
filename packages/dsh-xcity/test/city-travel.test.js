import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'
import { TRAVEL_TICKS, arriveTravelers, beginTravel } from '../lib/sim/travel.js'

function freshWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
}

test('建世界就有场所：默认场所 + 站点归属它', () => {
  const world = freshWorld()
  assert.ok(world.places.length >= 1, 'places 不能为空')
  assert.equal(world.defaultPlaceId, world.places[0].id)
  for (const station of world.stations) {
    assert.equal(station.placeId, world.defaultPlaceId, '默认场景的站点属于默认场所')
  }
  for (const agent of world.agents) {
    assert.equal(agent.placeId, world.defaultPlaceId)
  }
})

test('跨场所的活：先进 traveling，到点换场所并落在入口', () => {
  const world = freshWorld()
  const agent = world.agents[0]
  const other = { id: 'place:test.park', name: '公园', asset: 'park', spawn: { x: 5, z: 5 } }
  world.places.push(other)

  let s = step(world, [{ kind: 'agentActivity', agentId: agent.id, activity: 'work', ticks: 40, placeId: other.id }])
  s = step(world, [])
  assert.equal(agent.state, 'traveling', '不同场所要先出行')
  assert.equal(agent.travelTo, other.id)
  assert.equal(agent.pendingActivity?.kind, 'work', '活动要攒着，到了再重放')

  for (let i = 0; i < TRAVEL_TICKS + 2; i += 1) step(world, [])
  assert.equal(agent.placeId, other.id, '到点必须换场所')
  assert.equal(agent.travelTo, undefined, '路上状态要清掉')
  assert.notEqual(agent.state, 'traveling')
})

test('同场所的活不触发出行', () => {
  const world = freshWorld()
  const agent = world.agents[0]
  step(world, [{ kind: 'agentActivity', agentId: agent.id, activity: 'work', ticks: 40 }])
  assert.notEqual(agent.state, 'traveling')
})

test('落地就落在场所入口（travel 模块本身）', () => {
  const world = freshWorld()
  const agent = world.agents[0]
  const park = { id: 'place:test.park2', name: '公园', asset: 'park', spawn: { x: 7, z: 9 } }
  world.places.push(park)
  assert.equal(beginTravel(world, agent, park.id, { kind: 'work', ticks: 30 }), true)
  world.tick += TRAVEL_TICKS
  assert.deepEqual(arriveTravelers(world), [agent.id])
  assert.equal(agent.placeId, park.id)
  assert.deepEqual(agent.position, { x: 7, z: 9 })
  assert.equal(agent.travelTo, undefined)
})
