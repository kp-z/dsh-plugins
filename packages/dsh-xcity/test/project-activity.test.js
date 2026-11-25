import assert from 'node:assert/strict'
import { test } from 'node:test'

import { projectSnapshot } from '../lib/adapters/slowvale/project.js'

const opts = { worldId: 'w1', place: 'place:office.tech_company_1', startDate: '2026-01-01', viewerRoleId: '' }

function worldWith(activityKind) {
  return {
    id: 'world-1',
    name: '测试世界',
    tick: 120,
    paused: false,
    places: [{ id: 'place:office.tech_company_1', name: '办公室', asset: 'company', spawn: { x: 0, z: 0 } }],
    defaultPlaceId: 'place:office.tech_company_1',
    agents: [{ id: 'agent-1', name: '阿金', placeId: 'place:office.tech_company_1', position: { x: 1, z: 2 }, state: 'idle', activityKind }],
    activities: [
      { id: 'act-1', agentId: 'agent-1', kind: activityKind, skill: 'code', placeId: 'place:office.tech_company_1', stationId: null, status: 'active', startedAt: 100, endsAt: 160 },
    ],
    stations: [],
    events: [],
  }
}

test('有活动：头顶给出 activity_type（前端徽章查表能命中的类型名）', () => {
  const world = worldWith('work')
  world.agents[0].activityId = 'act-1'
  const snapshot = projectSnapshot(world, opts)
  const status = snapshot.role_public_statuses['agent-1']
  assert.equal(status.status, 'online')
  assert.equal(status.active_activity.activity_type, 'ProgrammerActivity')
})

test('没有活动：只给 offline，不给 active_activity（前端不画徽章）', () => {
  const world = worldWith('work')
  const snapshot = projectSnapshot(world, opts)
  const status = snapshot.role_public_statuses['agent-1']
  assert.equal(status.status, 'offline')
  assert.equal(status.active_activity, undefined)
})

test('不同活动映射到不同前端类型', () => {
  for (const [kind, expected] of [['rest', 'RestActivity'], ['meet', 'SpeakActivity'], ['visit', 'WaitActivity']]) {
    const world = worldWith(kind)
    world.agents[0].activityId = 'act-1'
    world.activities[0].kind = kind
    const snapshot = projectSnapshot(world, opts)
    assert.equal(snapshot.role_public_statuses['agent-1'].active_activity.activity_type, expected)
  }
})
