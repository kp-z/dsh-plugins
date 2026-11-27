/**
 * R510：到站落位到自己的槽位（修 8 人压测里"精灵叠成一坨"）。
 *
 * 现场：5 个睡觉的角色位置完全一样（都等于 station.anchor）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { advanceMovement } from '../lib/sim/movement.js'

const station = {
  id: 'station.lounge-01',
  placeId: 'place:office',
  anchor: { x: 30, z: -6 },
  slots: [
    { x: 0, z: 0 },
    { x: 2, z: 0 },
    { x: 4, z: 0 },
  ],
  capacity: 3,
  capabilities: ['rest'],
}

const agent = (id, position, stationId = null) => ({
  id,
  name: id,
  placeId: 'place:office',
  state: 'walking',
  position,
  facing: 0,
  station: stationId,
  targetStation: 'station.lounge-01',
  path: [{ x: 30, z: -6 }],
  activityKind: 'rest',
})

const worldOf = (agents) => ({ tick: 10, stations: [station], agents, activities: [] })

/** 一步只走 WALK_SPEED，推到全部到站为止（最多 300 tick）。 */
const walkUntilArrived = (world) => {
  for (let i = 0; i < 300; i += 1) {
    advanceMovement(world)
    if (world.agents.every((item) => item.state !== 'walking')) return
  }
}

test('R510：第一个人坐锚点，后面的人自动错开槽位', () => {
  const world = worldOf([
    agent('agent-1', { x: 28, z: -6 }),
    agent('agent-2', { x: 26, z: -6 }),
    agent('agent-3', { x: 24, z: -6 }),
  ])
  walkUntilArrived(world)
  const spots = world.agents.map((item) => String(item.position.x) + ',' + String(item.position.z))
  assert.deepEqual(spots, ['30,-6', '32,-6', '34,-6'])
})

test('R510：已有的同站占位会被避开（不抢别人的位置）', () => {
  const sitting = {
    ...agent('agent-9', { x: 32, z: -6 }),
    state: 'sleeping',
    station: 'station.lounge-01',
  }
  const world = worldOf([sitting, agent('agent-1', { x: 28, z: -6 })])
  walkUntilArrived(world)
  assert.equal(world.agents[1].position.x, 30, '锚点空着就用锚点')
})

test('R510：槽位占满后退回锚点（容量判定不在这里）', () => {
  const full = [0, 2, 4].map((dx, i) => ({
    ...agent('seat-' + String(i), { x: 30 + dx, z: -6 }),
    state: 'sleeping',
    station: 'station.lounge-01',
  }))
  const world = worldOf([...full, agent('agent-1', { x: 28, z: -6 })])
  walkUntilArrived(world)
  const me = world.agents.at(-1)
  assert.deepEqual(me.position, { x: 30, z: -6 })
  assert.equal(me.state, 'sleeping')
})
