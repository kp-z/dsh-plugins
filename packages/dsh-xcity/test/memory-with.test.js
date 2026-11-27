/**
 * R510：情节记忆里的"和谁"。
 *
 * 只认已经发生的事实：同地点 + 时间重叠。没重叠就必须是 []（老行为不变）。
 * 这里既测纯函数 collaboratorsOf，也测两个真实的完成出口（endActivity / syncActivities）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { endActivity, syncActivities } from '../lib/sim/activity.js'
import { EPISODE_WITH_MAX, collaboratorsOf, recordActivityEpisode } from '../lib/sim/memory.js'

/** R510-1：完整的一条活动；缺省是"刚完成"。 */
function activity(overrides) {
  return {
    id: 'act-1',
    agentId: 'agent-a',
    kind: 'work',
    purpose: 'social',
    placeId: 'scene.office',
    stationId: 'station.desk-1',
    status: 'completed',
    startedAt: 100,
    endsAt: 180,
    endedAt: 180,
    ...overrides,
  }
}

/** 每人一条活动的世界；tick 是"现在"。 */
function worldWith(activities, tick = 200) {
  const agents = [...new Set(activities.map((row) => row.agentId))].map((id) => ({ id, placeId: 'scene.office', episodes: [], activityId: undefined }))
  return { tick, logSeq: 0, activitySeq: activities.length, activities, agents }
}

test('R510：一对一 —— 同地点且重叠，记忆里带上对方', () => {
  const mine = activity({ id: 'act-1', agentId: 'agent-a', startedAt: 100, endedAt: 180 })
  const theirs = activity({ id: 'act-2', agentId: 'agent-b', startedAt: 120, endedAt: 200 })
  assert.deepEqual(collaboratorsOf([mine, theirs], mine, 180), ['agent-b'])
})

test('R510：三个人在同一地点 —— 全部记下并按 id 排序', () => {
  const mine = activity({ id: 'act-1', agentId: 'agent-a' })
  const rows = [
    mine,
    activity({ id: 'act-2', agentId: 'agent-c', startedAt: 150, endedAt: 240 }),
    activity({ id: 'act-3', agentId: 'agent-b', startedAt: 90, endedAt: 120 }),
  ]
  assert.deepEqual(collaboratorsOf(rows, mine, 180), ['agent-b', 'agent-c'])
})

test('R510：时间不重叠不算 —— 一个人刚走、另一个人还没来', () => {
  const mine = activity({ id: 'act-1', agentId: 'agent-a', startedAt: 100, endedAt: 180 })
  const left = activity({ id: 'act-2', agentId: 'agent-b', startedAt: 10, endedAt: 99 })
  const later = activity({ id: 'act-3', agentId: 'agent-c', startedAt: 181, endedAt: 260 })
  assert.deepEqual(collaboratorsOf([mine, left, later], mine, 180), [])
})

test('R510：同 tick 首尾相接算碰过面（闭区间，和 commitments 的共享 meet 一致）', () => {
  const mine = activity({ id: 'act-1', agentId: 'agent-a', startedAt: 100, endedAt: 180 })
  const theirs = activity({ id: 'act-2', agentId: 'agent-b', startedAt: 180, endedAt: 240 })
  assert.deepEqual(collaboratorsOf([mine, theirs], mine, 180), ['agent-b'])
})

test('R510：不同地点不算，就算时间完全重叠', () => {
  const mine = activity({ id: 'act-1', agentId: 'agent-a', placeId: 'scene.office' })
  const theirs = activity({ id: 'act-2', agentId: 'agent-b', placeId: 'scene.plaza' })
  assert.deepEqual(collaboratorsOf([mine, theirs], mine, 180), [])
})

test('R510：还没结束的一方按"现在"截断，之后来的不算', () => {
  const mine = activity({ id: 'act-1', agentId: 'agent-a', startedAt: 100, endedAt: 180 })
  const running = activity({ id: 'act-2', agentId: 'agent-b', status: 'active', startedAt: 150, endsAt: 9999, endedAt: undefined })
  const late = activity({ id: 'act-3', agentId: 'agent-c', status: 'active', startedAt: 300, endsAt: 9999, endedAt: undefined })
  assert.deepEqual(collaboratorsOf([mine, running, late], mine, 180), ['agent-b'], '180 时 late 还没开始')
})

test('R510：一个人身上有多条重叠记录 —— 去重只留一个 id，自己不算', () => {
  const mine = activity({ id: 'act-1', agentId: 'agent-a' })
  const rows = [
    mine,
    activity({ id: 'act-2', agentId: 'agent-b' }),
    activity({ id: 'act-3', agentId: 'agent-b', startedAt: 140, endedAt: 200 }),
    activity({ id: 'act-4', agentId: 'agent-a', startedAt: 0, endedAt: 999 }),
  ]
  assert.deepEqual(collaboratorsOf(rows, mine, 180), ['agent-b'])
})

test('R510：上限 4 —— 按 id 排序后截断，与输入顺序无关', () => {
  assert.equal(EPISODE_WITH_MAX, 4)
  const mine = activity({ id: 'act-1', agentId: 'agent-a' })
  const others = ['agent-6', 'agent-3', 'agent-5', 'agent-2', 'agent-1', 'agent-4'].map((id, index) =>
    activity({ id: 'act-x' + String(index), agentId: id }),
  )
  assert.deepEqual(collaboratorsOf([mine, ...others], mine, 180), ['agent-1', 'agent-2', 'agent-3', 'agent-4'])
})

test('R510：确定性 —— 同一批人换个输入顺序，算出同一份 with', () => {
  const mine = activity({ id: 'act-1', agentId: 'agent-a' })
  const b = activity({ id: 'act-2', agentId: 'agent-b' })
  const c = activity({ id: 'act-3', agentId: 'agent-c' })
  const first = collaboratorsOf([mine, b, c], mine, 180)
  const second = collaboratorsOf([c, mine, b], mine, 180)
  assert.deepEqual(first, second)
  assert.deepEqual(first, ['agent-b', 'agent-c'])
  assert.notEqual(first, second, '不许把内部数组直接交出去')
})

test('R510：没有其他活动时仍是 []（老行为不变）', () => {
  const mine = activity({ id: 'act-1', agentId: 'agent-a' })
  assert.deepEqual(collaboratorsOf([mine], mine, 180), [])
  assert.deepEqual(collaboratorsOf([], mine, 180), [])
})

test('R510：写记忆时带上 with；world 没有 activities 也照常写', () => {
  const mine = activity({ id: 'act-1', agentId: 'agent-a', status: 'active', startedAt: 100 })
  const theirs = activity({ id: 'act-2', agentId: 'agent-b', status: 'active', startedAt: 120, endsAt: 9999, endedAt: undefined })
  const world = worldWith([mine, theirs])
  recordActivityEpisode(world, mine, 200)
  const episode = world.agents.find((row) => row.id === 'agent-a').episodes.at(-1)
  assert.deepEqual(episode.with, ['agent-b'])
  assert.equal(episode.placeId, 'scene.office')

  const alone = { agents: [{ id: 'agent-a', episodes: [] }, { id: 'agent-b', episodes: [] }] }
  recordActivityEpisode(alone, mine, 200)
  assert.deepEqual(alone.agents[0].episodes.at(-1).with, [])
})

test('R510：活动完成出口 endActivity —— 记忆自己带上"和谁"', () => {
  const mine = activity({ id: 'act-1', agentId: 'agent-a', status: 'active', startedAt: 100 })
  const theirs = activity({ id: 'act-2', agentId: 'agent-b', status: 'active', startedAt: 120, endsAt: 9999, endedAt: undefined })
  const world = worldWith([mine, theirs])
  const agentA = world.agents.find((row) => row.id === 'agent-a')
  agentA.activityId = 'act-1'
  endActivity(world, agentA, 'completed')
  const episode = agentA.episodes.at(-1)
  assert.equal(episode.tick, 200)
  assert.deepEqual(episode.with, ['agent-b'])
  assert.equal(mine.status, 'completed')
})

test('R510：活动完成出口 syncActivities —— 到点完成也带着"和谁"', () => {
  const mine = activity({ id: 'act-1', agentId: 'agent-a', purpose: 'work', status: 'active', startedAt: 100, endsAt: 150, endedAt: undefined })
  const theirs = activity({ id: 'act-2', agentId: 'agent-b', status: 'active', startedAt: 120, endsAt: 9999, endedAt: undefined })
  const world = worldWith([mine, theirs], 150)
  const agentA = world.agents.find((row) => row.id === 'agent-a')
  const agentB = world.agents.find((row) => row.id === 'agent-b')
  Object.assign(agentA, { activityId: 'act-1', activityKind: 'work', activityUntil: 150 })
  Object.assign(agentB, { activityId: 'act-2', activityKind: 'work', activityUntil: 9999 })
  const completed = syncActivities(world)
  assert.deepEqual(completed.map((row) => row.id), ['act-1'])
  assert.deepEqual(agentA.episodes.at(-1).with, ['agent-b'])
  assert.equal(agentB.episodes.length, 0, '还在忙的人不写记忆')
})

test('R510：不同地点走真实出口 —— with 仍是 []', () => {
  const mine = activity({ id: 'act-1', agentId: 'agent-a', status: 'active', startedAt: 100 })
  const elsewhere = activity({ id: 'act-2', agentId: 'agent-b', status: 'active', startedAt: 120, endsAt: 9999, endedAt: undefined, placeId: 'scene.plaza' })
  const world = worldWith([mine, elsewhere])
  const agentA = world.agents.find((row) => row.id === 'agent-a')
  agentA.activityId = 'act-1'
  endActivity(world, agentA, 'completed')
  assert.deepEqual(agentA.episodes.at(-1).with, [])
})
