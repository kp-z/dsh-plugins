import assert from 'node:assert/strict'
import { test } from 'node:test'

import { projectSnapshot } from '../lib/adapters/slowvale/project.js'

const opts = { worldId: 'w1', place: 'place:office.tech_company_1', startDate: '2026-01-01', viewerRoleId: '' }

function worldWith(kind, startedAt = 600, endsAt = 660) {
  return {
    id: 'world-1',
    name: '测试世界',
    tick: 610,
    paused: false,
    places: [{ id: 'place:office.tech_company_1', name: '办公室', asset: 'company', spawn: { x: 0, z: 0 } }],
    defaultPlaceId: 'place:office.tech_company_1',
    agents: [{ id: 'agent-1', name: '阿金', placeId: 'place:office.tech_company_1', position: { x: 1, z: 2 }, state: 'idle', activityId: 'act-1' }],
    activities: [{ id: 'act-1', agentId: 'agent-1', kind, skill: 'code', placeId: 'place:office.tech_company_1', stationId: null, status: 'active', startedAt, endsAt }],
    stations: [],
    events: [],
  }
}

test('头顶徽章 + 进度锚点三件套（前端 ev() 靠它们算进度）', () => {
  const snapshot = projectSnapshot(worldWith('work'), opts)
  const active = snapshot.role_public_statuses['agent-1'].active_activity
  assert.equal(active.activity_type, 'ProgrammerActivity')
  assert.equal(active.name, '干活')
  assert.equal(active.duration_seconds, 3600, '60 tick = 3600 游戏秒')
  assert.equal(active.progress_elapsed_seconds, 0)
  assert.equal(active.progress_anchor_game_time, '2026-01-01T10:00:00', '锚点是活动开始的游戏时间')
})

test('锚点随开始时间变化：不同开始时间给出不同 ISO', () => {
  const snapshot = projectSnapshot(worldWith('rest', 1440, 1500), opts)
  assert.equal(snapshot.role_public_statuses['agent-1'].active_activity.progress_anchor_game_time, '2026-01-02T00:00:00')
})

test('R478：吃饭/睡觉沿用 rest 活动，但徽章与动作要分开', () => {
  const meal = worldWith('rest')
  meal.agents[0].activityPurpose = 'meal'
  const mealSnap = projectSnapshot(meal, opts)
  assert.equal(mealSnap.role_public_statuses['agent-1'].active_activity.activity_type, 'EatActivity')
  assert.equal(mealSnap.role_public_statuses['agent-1'].active_activity.name, '吃饭')
  assert.equal(mealSnap.actors['agent-1'].visual_state.anim, 'eat')

  const sleep = worldWith('rest')
  sleep.agents[0].activityPurpose = 'sleep'
  const sleepSnap = projectSnapshot(sleep, opts)
  assert.equal(sleepSnap.role_public_statuses['agent-1'].active_activity.activity_type, 'SleepActivity')
  assert.equal(sleepSnap.actors['agent-1'].visual_state.anim, 'sleep')

  const nap = worldWith('rest')
  nap.agents[0].activityPurpose = 'rest'
  const napSnap = projectSnapshot(nap, opts)
  assert.equal(napSnap.role_public_statuses['agent-1'].active_activity.activity_type, 'RestActivity')
  assert.equal(napSnap.actors['agent-1'].visual_state.anim, 'sit')
})

test('R481：learning 在 code 工位也显示 SkillStudyActivity / 学习', () => {
  const world = worldWith('work')
  world.agents[0].activityPurpose = 'study'
  const snapshot = projectSnapshot(world, opts)
  assert.equal(snapshot.role_public_statuses['agent-1'].active_activity.activity_type, 'SkillStudyActivity')
  assert.equal(snapshot.role_public_statuses['agent-1'].active_activity.name, '学习')
})

test('没有活动时不给这些字段', () => {
  const world = worldWith('work')
  world.agents[0].activityId = undefined
  const snapshot = projectSnapshot(world, opts)
  assert.equal(snapshot.role_public_statuses['agent-1'].active_activity, undefined)
})
