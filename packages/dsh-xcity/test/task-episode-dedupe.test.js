/**
 * R530：工单裁决**不能把同一件事写两遍**，完工的单也不能记成没做。
 *
 * 现场（审计 R3 实测）：
 *  - 完工后 episodes 是 ["工单「盘点小镇」","工单「盘点小镇」做完了"]，两条 salience 0.9/0.6
 *    把 memoryMood 顶到 +1，等于把「记忆影响决策」变成当天常数偏置；
 *  - 纯模拟完工的单被活动结账记成 interrupted，记忆写成「没做完：工单「X」」。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { syncActivities } from '../lib/sim/activity.js'
import { step } from '../lib/sim/step.js'

const baseWorld = () => ({
  id: 'w',
  tick: 500,
  seed: 1,
  agents: [{
    id: 'agent-1',
    name: 'agent-1',
    role: 'engineer',
    placeId: 'place:office',
    state: 'working',
    position: { x: 0, z: 0 },
    facing: 0,
    station: 'station.seat-1',
    targetStation: null,
    path: [],
    carrying: 'task-1',
    hangout: null,
    needs: { hunger: 100, energy: 100, social: 100 },
    traits: { diligence: 0.5, duty: 0.5 },
    affinity: {},
    episodes: [],
    commitments: [],
    activityId: 'act-1',
    activityKind: 'work',
    activityPurpose: 'work',
    activityUntil: 900,
  }],
  stations: [],
  tasks: [{
    id: 'task-1',
    title: '盘点小镇',
    status: 'in_progress',
    ordinal: 1,
    requires: ['code'],
    createdAtTick: 0,
    owner: 'agent-1',
    station: 'station.seat-1',
    attemptId: 'attempt-1',
    progress: 0.5,
  }],
  activities: [{
    id: 'act-1',
    agentId: 'agent-1',
    kind: 'work',
    purpose: 'work',
    status: 'active',
    startedAt: 400,
    startedLogSeq: 1,
    stationId: 'station.seat-1',
    taskAttemptId: 'attempt-1',
    // 真实活动带触发文案（「开始执行工单「X」」），记忆摘要从这里取单名。
    trigger: { kind: 'task', text: '开始执行工单「盘点小镇」' },
  }],
  messages: [],
  districts: [],
  places: [],
  nav: null,
  seq: 0,
  messageSeq: 0,
  logSeq: 0,
  activitySeq: 2,
  events: [],
})

test('R530：工单完工只留一条情节，且是「做完了」', () => {
  const world = baseWorld()
  step(world, [{ kind: 'taskComplete', taskId: 'task-1', attemptId: 'attempt-1', output: '完成' }])
  syncActivities(world)
  const summaries = (world.agents[0].episodes ?? []).map((row) => row.summary)
  const aboutTask = summaries.filter((row) => row.includes('盘点小镇'))
  assert.equal(aboutTask.length, 1, '同一件事只能有一条：' + JSON.stringify(summaries))
  // 完工态的文案是「工单「X」」（memoryMood 按「工单」判正向），不能带「没做完：」前缀。
  assert.ok(!aboutTask[0].startsWith('没做完：'), '完工必须记成做完，不能记成没做完：' + aboutTask[0])
})

test('R530：纯模拟完工（活动还在跑、单已 done）也记成做完', () => {
  const world = baseWorld()
  world.tasks[0].status = 'done'
  syncActivities(world)
  const summaries = (world.agents[0].episodes ?? []).map((row) => row.summary)
  assert.equal(summaries.length, 1, JSON.stringify(summaries))
  assert.ok(!summaries[0].startsWith('没做完：'), '完工不该被记成没做完：' + summaries[0])
  assert.ok(summaries[0].includes('盘点小镇'), '摘要要能说出是哪张单：' + summaries[0])
})

test('R530：失败的单记成「没做完：」', () => {
  const world = baseWorld()
  step(world, [{ kind: 'taskFail', taskId: 'task-1', attemptId: 'attempt-1', reason: '工具不够' }])
  syncActivities(world)
  const summaries = (world.agents[0].episodes ?? []).map((row) => row.summary)
  assert.equal(summaries.length, 1, JSON.stringify(summaries))
  assert.ok(summaries[0].startsWith('没做完：'), summaries[0])
})
