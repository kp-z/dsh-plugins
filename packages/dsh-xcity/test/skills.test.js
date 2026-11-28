import assert from 'node:assert/strict'
import test from 'node:test'

import { LEVEL_THRESHOLDS, MAX_LEVEL, levelForPoints, skillLabel, skillLineForPrompt, skillsOf } from '../lib/sim/skills.js'

/** 一张工单的最小形状：只写派生真正读的字段，其余给固定值。 */
function task(over) {
  return {
    id: 'task-1',
    key: 'impl',
    set: 'pipeline',
    ordinal: 1,
    suggestedRole: null,
    title: 't',
    description: '',
    status: 'done',
    owner: 'agent-1',
    station: null,
    requires: ['code'],
    blockedBy: [],
    progress: 1,
    attemptId: null,
    acceptance: 'a',
    estimateTicks: 600,
    createdAtTick: 0,
    finishedAtTick: 100,
    externalId: null,
    output: null,
    failureReason: null,
    ...over,
  }
}

test('R541：空世界 / 没干过活 → 空数组 + 空提示词行', () => {
  assert.deepEqual(skillsOf({ tasks: [] }, 'agent-1'), [])
  assert.equal(skillLineForPrompt({ tasks: [] }, 'agent-1'), '')
  // 世界里有别人的单，也不该给我算出一行"0 级"
  const world = { tasks: [task({ owner: 'agent-2' })] }
  assert.deepEqual(skillsOf(world, 'agent-1'), [])
  assert.equal(skillLineForPrompt(world, 'agent-1'), '')
})

test('R541：完工单按阈值升级（25/张 → 1/3/5/8/12 张到 L5）', () => {
  // 依据 docs/research/GROWTH.md:231：need(n)=20·n(n+1)/2 → 20/60/120/200/300
  assert.deepEqual([...LEVEL_THRESHOLDS], [20, 60, 120, 200, 300])
  assert.equal(MAX_LEVEL, 5)

  const tasks = []
  const expectedLevel = [1, 1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5]
  for (let i = 1; i <= 12; i++) {
    tasks.push(task({ id: 'task-' + String(i), key: 'k' + String(i), ordinal: i }))
    const rows = skillsOf({ tasks }, 'agent-1')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].points, 25 * i, '第 ' + String(i) + ' 张后累计分')
    assert.equal(rows[0].level, expectedLevel[i - 1], '第 ' + String(i) + ' 张后的等级')
    assert.equal(rows[0].sample, i)
    assert.equal(rows[0].failed, 0)
  }
  // 12 张正好 300 分 = L5；再多也不越级（等级上限是门槛数）
  assert.equal(levelForPoints(99999), MAX_LEVEL)
})

test('R541：打回不扣分，只记账（失败原因常与能力无关）', () => {
  const done = [1, 2, 3].map((i) => task({ id: 'task-' + String(i), key: 'k' + String(i), ordinal: i }))
  const failed = [4, 5].map((i) => task({ id: 'task-' + String(i), key: 'k' + String(i), ordinal: i, status: 'failed' }))
  const rows = skillsOf({ tasks: [...done, ...failed] }, 'agent-1')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].points, 75, '打回不给负分')
  assert.equal(rows[0].level, 2, '打回不让等级倒退')
  assert.equal(rows[0].sample, 3)
  assert.equal(rows[0].failed, 2)
  assert.equal(skillLineForPrompt({ tasks: [...done, ...failed] }, 'agent-1'), '你干这行的手感：工程 2 级（做成了 3 张，打回 2 张）')
})

test('R541：确定性（同存档两次全等）且角色之间互不串', () => {
  const tasks = [
    task({ id: 'task-1', key: 'a', ordinal: 1, owner: 'agent-1', requires: ['code'] }),
    task({ id: 'task-2', key: 'b', ordinal: 2, owner: 'agent-2', requires: ['review'] }),
  ]
  assert.deepEqual(skillsOf({ tasks }, 'agent-1'), skillsOf({ tasks }, 'agent-1'))
  assert.deepEqual(skillsOf({ tasks }, 'agent-1'), [
    { skill: 'code', level: 1, points: 25, sample: 1, failed: 0 },
  ])
  assert.deepEqual(skillsOf({ tasks }, 'agent-2'), [
    { skill: 'review', level: 1, points: 25, sample: 1, failed: 0 },
  ])
  assert.deepEqual(skillsOf({ tasks }, 'agent-3'), [], '不存在的人不该继承别人的记录')
})

test('R541：同一 (set,key) 重复派单递减（25 → 10 → 5），跨集同名不算重复', () => {
  const sameKey = [1, 2, 3].map((i) => task({ id: 'task-' + String(i), key: 'impl', set: 'pipeline', ordinal: i }))
  const rows = skillsOf({ tasks: sameKey }, 'agent-1')
  assert.equal(rows[0].points, 40, '25 + 10 + 5')
  assert.equal(rows[0].sample, 3)
  assert.equal(rows[0].level, 2)

  // 两个任务集里都叫 verify，是两件不同的活：各自按首次给 25。
  const crossSet = [
    task({ id: 'task-1', key: 'verify', set: 'pipeline', ordinal: 1, requires: ['compute'] }),
    task({ id: 'task-2', key: 'verify', set: 'bugfix', ordinal: 2, requires: ['compute'] }),
  ]
  assert.equal(skillsOf({ tasks: crossSet }, 'agent-1')[0].points, 50)
})

test('R541：一张单要两种能力 → 两条能力各记一笔', () => {
  const rows = skillsOf({ tasks: [task({ requires: ['code', 'review'] })] }, 'agent-1')
  assert.deepEqual(rows.map((row) => row.skill).sort(), ['code', 'review'])
  assert.deepEqual(rows.map((row) => row.points), [25, 25])
  assert.deepEqual(rows.map((row) => row.sample), [1, 1])
})

test('R541：只算已经完结的单（ready/in_progress/blocked 一概不计）', () => {
  const tasks = ['pending', 'ready', 'in_progress', 'blocked'].map((status, i) =>
    task({ id: 'task-' + String(i), key: 'k' + String(i), ordinal: i, status }))
  assert.deepEqual(skillsOf({ tasks }, 'agent-1'), [])
  assert.equal(skillLineForPrompt({ tasks }, 'agent-1'), '')
})

test('R541：认不出的能力名原样带出，绝不产出 undefined', () => {
  const world = { tasks: [task({ requires: ['quantum'] })] }
  const rows = skillsOf(world, 'agent-1')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].skill, 'quantum')
  assert.equal(typeof rows[0].skill, 'string')
  assert.notEqual(rows[0].skill, '')
  assert.equal(skillLabel('quantum'), 'quantum')
  assert.equal(skillLabel('code'), '工程')
  assert.equal(skillLineForPrompt(world, 'agent-1'), '你干这行的手感：quantum 1 级（做成了 1 张）')
})

test('R541：提示词行只取最拿手的三条，同级按能力名固定次序', () => {
  const tasks = ['code', 'review', 'research', 'compute'].map((skill, i) =>
    task({ id: 'task-' + String(i), key: 'k' + String(i), ordinal: i, requires: [skill] }))
  // 四条都是 25 分 → 同分同级，按能力名升序：code / compute / research / review
  assert.deepEqual(skillsOf({ tasks }, 'agent-1').map((row) => row.skill), ['code', 'compute', 'research', 'review'])
  assert.equal(
    skillLineForPrompt({ tasks }, 'agent-1'),
    '你干这行的手感：工程 1 级（做成了 1 张）、实测 1 级（做成了 1 张）、调研 1 级（做成了 1 张）',
  )
  const again = skillLineForPrompt({ tasks }, 'agent-1')
  assert.equal(again, skillLineForPrompt({ tasks }, 'agent-1'))
})
