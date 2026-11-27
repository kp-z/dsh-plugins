import assert from 'node:assert/strict'
import { test } from 'node:test'

import { handleApi } from '../lib/adapters/slowvale/routes.js'

const opts = { worldId: 'w1', viewerRoleId: 'agent-b', place: 'office', startDate: '2026-01-28' }
const agents = [{ id: 'agent-a', name: '甲' }, { id: 'agent-b', name: '乙' }]
const world = { id: 'w1', name: '小镇', tick: 1440 + 42, agents }

function activity(extra) {
  return {
    agentId: 'agent-a',
    kind: 'work',
    placeId: 'office',
    status: 'completed',
    startedAt: 1450,
    endsAt: 1460,
    endedAt: 1460,
    ...extra,
  }
}

async function getRecap(snapshot, query = '', options = opts) {
  let status
  let body
  const handled = await handleApi(
    { opts: options, getWorld: () => snapshot },
    { method: 'GET' },
    { writeHead: (code) => { status = code }, end: (text) => { body = JSON.parse(text) } },
    new URL('http://localhost/api/game/recap' + query),
  )
  assert.equal(handled, true)
  assert.equal(status, 200)
  return body
}

test('回顾按请求角色和当前游戏日投影真实活动，并按发生时间排序', async () => {
  const activities = [
    activity({ id: 'act-1', kind: 'meet', startedAt: 1462, endsAt: 1470, endedAt: 1470 }),
    activity({ id: 'act-2', startedAt: 1435, endsAt: 1450, endedAt: 1440 }),
    activity({ id: 'act-3', agentId: 'agent-b' }),
    activity({ id: 'act-4', startedAt: 1490, status: 'active' }),
    activity({ id: 'act-5', startedAt: 1440, kind: 'rest', purpose: 'meal' }),
  ]
  const snapshot = { ...world, activities, places: [{ id: 'office', name: '办公室' }] }
  const recap = await getRecap(snapshot, '?role_id=agent-a')
  assert.equal(recap.role_id, 'agent-a')
  assert.equal(recap.anchor_game_time.current_datetime, '2026-01-29T00:00:00')
  assert.equal(recap.now_game_time.current_datetime, '2026-01-29T00:42:00')
  assert.deepEqual(recap.timeline, [
    { group: 'routine', text: '吃饭 · 办公室', day_number: 2, time_label: '00:00' },
    { group: 'routine', text: '交谈 · 办公室', day_number: 2, time_label: '00:22' },
  ])
  assert.equal(activities[0].id, 'act-1')
  const viewer = await getRecap(snapshot)
  assert.equal(viewer.role_id, 'agent-b')
  assert.deepEqual(viewer.timeline.map((entry) => entry.time_label), ['00:10'])
  assert.deepEqual((await getRecap(snapshot, '?role_id=unknown')).timeline, [])
})

test('跨零点仍在进行的活动纳入当天，不以计划结束时间当作事实', async () => {
  const recap = await getRecap({
    ...world,
    activities: [
      activity({ id: 'act-1', agentId: 'agent-b', startedAt: 1410, endsAt: 1450, endedAt: undefined }),
      activity({ id: 'act-2', agentId: 'agent-b', kind: 'rest', startedAt: 1420, endedAt: 1445 }),
      activity({
        id: 'act-3', agentId: 'agent-b', kind: 'sleep', startedAt: 1430, endsAt: 1435,
        endedAt: undefined, status: 'active',
      }),
    ],
  })
  assert.deepEqual(recap.timeline, [
    { group: 'routine', text: '继续休息', day_number: 2, time_label: '00:00' },
    { group: 'routine', text: '继续睡觉', day_number: 2, time_label: '00:00' },
  ])
})

test('没有世界或活动时保持镜像可读的空态，不把角色当前状态编成历史', async () => {
  const unopened = await getRecap(null)
  assert.deepEqual(unopened.timeline, [])
  assert.equal(unopened.player_replies, null)
  assert.equal(unopened.anchor_game_time.current_datetime, '2026-01-28T00:00:00')
  assert.deepEqual(unopened.now_game_time, unopened.anchor_game_time)

  const empty = await getRecap({ ...world, agents: [{ ...agents[0], activityKind: 'work' }] })
  assert.equal(empty.role_id, 'agent-a')
  assert.equal(empty.now_game_time.day_number, 2)
  assert.deepEqual(empty.timeline, [])
})
