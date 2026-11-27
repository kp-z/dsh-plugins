/**
 * R485：活动读入口。
 *
 * 守三件事：
 * 1. Activity 是首选，老字段只在没有活动记录时兜底；
 * 2. needs 的恢复真的走 Activity 的 purpose（不是只写了选择器没人用）；
 * 3. 仿真里 activityId 与 active 记录不漂移。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { startActivity } from '../lib/sim/activity.js'
import { activityKindOf, activityPurposeOf, activitySkillOf, currentActivityOf } from '../lib/sim/activity-view.js'
import { selfLifeCommands } from '../lib/sim/life.js'
import { advanceNeeds } from '../lib/sim/needs.js'
import { step } from '../lib/sim/step.js'
import { createWorld } from '../lib/world/create.js'

function makeWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({ content, scene: 'scene.office', name: 'activity-view', createdAt: '2026-01-01T00:00:00.000Z', taskSets: [] })
}

function agent(overrides = {}) {
  return {
    id: 'a1',
    name: 'A',
    role: 'engineer',
    state: 'working',
    carrying: null,
    station: 'station.seat-01',
    targetStation: null,
    path: [],
    position: { x: 0, z: 0 },
    facing: 0,
    hangout: null,
    boundAgentId: null,
    ...overrides,
  }
}

test('currentActivityOf：只认 activityId 指向的 active 记录', () => {
  const world = { activities: [
    { id: 'act-1', agentId: 'a1', kind: 'work', status: 'active', startedAt: 1, endsAt: 5, stationId: null, placeId: 'p' },
    { id: 'act-2', agentId: 'a1', kind: 'work', status: 'completed', startedAt: 1, endsAt: 2, stationId: null, placeId: 'p' },
  ], agents: [] }
  assert.equal(currentActivityOf(world, agent({ activityId: 'act-1' })).id, 'act-1')
  assert.equal(currentActivityOf(world, agent({ activityId: 'act-2' })), null)
  assert.equal(currentActivityOf(world, agent({ activityId: 'missing' })), null)
  assert.equal(currentActivityOf(world, agent()), null)
})

test('purpose/skill/kind：Activity 优先，老字段兜底', () => {
  const world = { activities: [
    { id: 'act-1', agentId: 'a1', kind: 'sleep', skill: 'research', purpose: 'study', status: 'active', startedAt: 1, endsAt: 5, stationId: null, placeId: 'p' },
  ], agents: [] }
  const a = agent({ activityId: 'act-1', activityPurpose: 'rest', activitySkill: 'code', activityKind: 'work' })
  assert.equal(activityPurposeOf(world, a), 'study')
  assert.equal(activitySkillOf(world, a), 'research')
  assert.equal(activityKindOf(world, a), 'rest', 'sleep 归到 rest 老口径')

  const b = agent({ activityPurpose: 'meal', activitySkill: 'code', activityKind: 'rest' })
  assert.equal(activityPurposeOf(world, b), 'meal')
  assert.equal(activitySkillOf(world, b), 'code')
  assert.equal(activityKindOf(world, b), 'rest')
})

test('needs 真的走 Activity 的 purpose：mirror 缺了也按吃饭恢复', () => {
  const world = makeWorld()
  world.tick = 10 * 60
  const eater = world.agents[0]
  const room = world.stations.find((station) => station.kind === 'breakroom')
  assert.ok(room)
  eater.activityPurpose = 'meal'
  startActivity(world, eater, { kind: 'rest', ticks: 50, stationId: room.id })
  eater.state = 'sleeping'
  eater.station = room.id
  // 模拟老字段丢了 purpose，只剩 Activity 记录。
  eater.activityPurpose = undefined
  eater.needs = { energy: 50, hunger: 50, social: 50 }
  for (let i = 0; i < 40; i += 1) advanceNeeds(world)
  assert.ok(eater.needs.hunger > 80, `应当按 meal 恢复，实际 ${eater.needs.hunger}`)
})

test('仿真不变量：有 activityId 就必须有 active 记录，mirror 不漂移', () => {
  const world = makeWorld()
  world.tick = 8 * 60
  for (let i = 0; i < 240; i += 1) {
    step(world, selfLifeCommands(world))
    for (const row of world.agents) {
      if (row.activityId === undefined) continue
      const activity = (world.activities ?? []).find((item) => item.id === row.activityId)
      assert.ok(activity, `${row.id} 的 activityId 指向了不存在的记录`)
      assert.equal(activity.status, 'active')
      assert.equal(activity.agentId, row.id)
      if (activity.purpose !== undefined) assert.equal(row.activityPurpose, activity.purpose, 'purpose mirror 漂移')
      if (activity.skill !== undefined) assert.equal(row.activitySkill, activity.skill, 'skill mirror 漂移')
    }
  }
})
