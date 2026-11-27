/**
 * R519：工单做完/失败都要进记忆。
 *
 * 现场：工单是外部裁决的（taskComplete 只改 task 状态、不产生 Activity），
 * 于是"干成一件大事"在记忆里没有任何痕迹——记忆链里只剩吃了顿饭、睡了一觉。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { step } from '../lib/sim/step.js'

const agent = (id) => ({
  id,
  name: id,
  role: 'engineer',
  placeId: 'place:office',
  state: 'idle',
  position: { x: 0, z: 0 },
  facing: 0,
  station: null,
  targetStation: null,
  path: [],
  carrying: null,
  hangout: null,
  needs: { hunger: 100, energy: 100, social: 100 },
  traits: { diligence: 0.5, duty: 0.5 },
  affinity: {},
  episodes: [],
  commitments: [],
})

const task = () => ({
  id: 'task-1',
  title: '盘点小镇',
  status: 'in_progress',
  ordinal: 1,
  requires: ['code'],
  createdAtTick: 0,
  owner: 'agent-1',
  station: null,
  attemptId: 'attempt-1',
  progress: 0,
})

const world = () => ({
  id: 'w',
  tick: 100,
  seed: 1,
  agents: [agent('agent-1')],
  stations: [],
  tasks: [task()],
  activities: [],
  messages: [],
  districts: [],
  places: [],
  nav: null,
  // 事件/日志水位：step() 会 emit 事件，缺了这三个字段会当场 TypeError。
  seq: 0,
  messageSeq: 0,
  logSeq: 0,
  activitySeq: 0,
  events: [],
})

test('R519：工单完成 → 记忆里出现"工单「…」做完了"', () => {
  const w = world()
  step(w, [{ kind: 'taskComplete', taskId: 'task-1', attemptId: 'attempt-1', output: '做完了' }])
  const episodes = w.agents[0].episodes
  assert.equal(episodes.length, 1, JSON.stringify(episodes))
  assert.equal(episodes[0].kind, 'task')
  assert.ok(episodes[0].summary.includes('盘点小镇'), episodes[0].summary)
  assert.ok(episodes[0].summary.includes('做完'), episodes[0].summary)
})

test('R519：工单失败 → 记忆写"没做完："（心情会记成负向）', () => {
  const w = world()
  step(w, [{ kind: 'taskFail', taskId: 'task-1', attemptId: 'attempt-1', reason: '工具不够' }])
  const episodes = w.agents[0].episodes
  assert.equal(episodes.length, 1, JSON.stringify(episodes))
  assert.ok(episodes[0].summary.startsWith('没做完：'), episodes[0].summary)
  assert.ok(episodes[0].summary.includes('工具不够'), episodes[0].summary)
})

test('R519：没有 owner 的单不写记忆（不编造是谁干的）', () => {
  const w = world()
  w.tasks[0].owner = null
  step(w, [{ kind: 'taskComplete', taskId: 'task-1', attemptId: 'attempt-1', output: 'x' }])
  assert.equal(w.agents[0].episodes.length, 0)
})

test('R519：旧代次的完成不写记忆（被拒的裁决不留痕）', () => {
  const w = world()
  step(w, [{ kind: 'taskComplete', taskId: 'task-1', attemptId: 'attempt-0', output: 'x' }])
  assert.equal(w.agents[0].episodes.length, 0)
})
