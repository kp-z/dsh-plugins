import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveConfig } from '../lib/config.js'
import { createRuntime } from '../lib/runtime/index.js'
import { buildSnapshot } from '../lib/routes/api.js'
import {
  LEVEL_THRESHOLDS,
  MAX_LEVEL,
  POINTS_PRACTICE,
  levelForPoints,
  skillBoardOf,
  skillLabel,
  skillLineForPrompt,
  skillsOf,
} from '../lib/sim/skills.js'
import { createPluginState } from '../lib/state.js'

/** 一次"练习"活动的最小形状（只写派生真正读的字段）。 */
function activity(over) {
  return {
    id: 'act-1',
    agentId: 'agent-1',
    kind: 'work',
    skill: 'code',
    purpose: 'work',
    placeId: 'place:office',
    stationId: 'station.seat-01',
    status: 'completed',
    startedAt: 100,
    endsAt: 140,
    endedAt: 140,
    ...over,
  }
}

/** 一张工单的最小形状。 */
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

/** 造 n 次同能力的练习（序号不同，避免 id/时间撞车）。 */
function practices(n, over) {
  return Array.from({ length: n }, (_, i) => activity({ id: 'act-' + String(i), startedAt: 100 + i * 10, endsAt: 130 + i * 10, endedAt: 130 + i * 10, ...over }))
}

test('R541：空世界 / 没干过活 → 空数组 + 空提示词行', () => {
  assert.deepEqual(skillsOf({ activities: [], tasks: [] }, 'agent-1'), [])
  assert.equal(skillLineForPrompt({ activities: [], tasks: [] }, 'agent-1'), '')
  // 两个来源都缺（老存档/半截快照）也不炸
  assert.deepEqual(skillsOf({}, 'agent-1'), [])
  assert.equal(skillLineForPrompt({}, 'agent-1'), '')
  // 别人的活动不给我算
  assert.deepEqual(skillsOf({ activities: [activity({ agentId: 'agent-2' })] }, 'agent-1'), [])
})

test('R541：主来源是活动——work + completed + skill → 每次 +8', () => {
  // R542 重标阈值后 L1=32：3 次练习（24）还不够，4 次（32）才刚好进 1 级。
  const world = { activities: practices(4) }
  assert.deepEqual(skillsOf(world, 'agent-1'), [
    { skill: 'code', level: 1, points: 32, sample: 4, failed: 0, lastUsedTick: 160 },
  ])
  assert.equal(skillLineForPrompt(world, 'agent-1'), '近期手感：工程 1 级（练了 4 次）')
})

test('R541：只数"真在站点上把这条能力用掉"的活动（别的全不算）', () => {
  const world = {
    activities: [
      activity({ id: 'act-1', kind: 'rest', skill: undefined }),
      activity({ id: 'act-2', kind: 'meet', skill: 'converse' }),
      activity({ id: 'act-3', status: 'active' }),
      activity({ id: 'act-4', status: 'interrupted' }),
      activity({ id: 'act-5', skill: undefined }),
      activity({ id: 'act-6', skill: '' }),
      activity({ id: 'act-7', agentId: 'agent-2' }),
    ],
  }
  assert.deepEqual(skillsOf(world, 'agent-1'), [])
  assert.equal(skillLineForPrompt(world, 'agent-1'), '')
})

test('R541：时长不影响分值（被打断也会落成 completed，按时长给分会把噪声当资历）', () => {
  const world = {
    activities: [
      activity({ id: 'act-1', startedAt: 0, endedAt: 1 }), // 1 tick
      activity({ id: 'act-2', startedAt: 0, endedAt: 40 }), // 中位
      activity({ id: 'act-3', startedAt: 0, endedAt: 300 }), // 最长
    ],
  }
  const rows = skillsOf(world, 'agent-1')
  assert.equal(rows[0].points, 24, '一次练习就是一个单位')
  assert.equal(rows[0].sample, 3)
})

test('R541/R542：补充来源是工单——完工单按 25/张 涨级（2/3/7/12/18 张到 L5）', () => {
  // R542：阈值按主来源的单位（一次练习 +8）重标，活动 4/9/20/35/55 次 = 工单 2/3/7/12/18 张。
  assert.deepEqual([...LEVEL_THRESHOLDS], [32, 72, 160, 280, 440])
  assert.equal(MAX_LEVEL, 5)

  const tasks = []
  const expectedLevel = [0, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4]
  for (let i = 1; i <= 12; i++) {
    tasks.push(task({ id: 'task-' + String(i), key: 'k' + String(i), ordinal: i }))
    const rows = skillsOf({ tasks }, 'agent-1')
    assert.equal(rows[0].points, 25 * i, '第 ' + String(i) + ' 张后累计分')
    assert.equal(rows[0].level, expectedLevel[i - 1], '第 ' + String(i) + ' 张后的等级')
    assert.equal(rows[0].sample, i)
  }
  assert.equal(levelForPoints(99999), MAX_LEVEL, '等级上限就是门槛数')
})

test('R541：打回不扣分，只记账（失败原因常与能力无关）', () => {
  const done = [1, 2, 3].map((i) => task({ id: 'task-' + String(i), key: 'k' + String(i), ordinal: i }))
  const failed = [4, 5].map((i) => task({ id: 'task-' + String(i), key: 'k' + String(i), ordinal: i, status: 'failed' }))
  const world = { tasks: [...done, ...failed] }
  const rows = skillsOf(world, 'agent-1')
  assert.equal(rows[0].points, 75, '打回不给负分')
  assert.equal(rows[0].level, 2, '打回不让等级倒退（75 分 ≥ L2 的 72）')
  assert.equal(rows[0].sample, 3)
  assert.equal(rows[0].failed, 2)
  assert.equal(skillLineForPrompt(world, 'agent-1'), '近期手感：工程 2 级（练了 3 次，打回 2 张）')
})

test('R541：带 taskAttemptId 的活动不重复计分（同一件事只付一次）', () => {
  const world = {
    activities: [activity({ taskAttemptId: 'att-1', endedAt: 500 })],
    tasks: [task({ finishedAtTick: 500 })],
  }
  // 25 分够不上 L1(32)：R542 之后，**一张单不再直接进 1 级**（这正是重标要的效果）。
  assert.deepEqual(skillsOf(world, 'agent-1'), [
    { skill: 'code', level: 0, points: 25, sample: 1, failed: 0, lastUsedTick: 500 },
  ])
})

test('R541：两个来源合并计数，lastUsedTick 取最近一次', () => {
  const world = {
    activities: [activity({ id: 'act-1', endedAt: 100 }), activity({ id: 'act-2', endedAt: 200 }), activity({ id: 'act-3', endedAt: 300 })],
    tasks: [
      task({ id: 'task-1', key: 'a', ordinal: 1, finishedAtTick: 400 }),
      task({ id: 'task-2', key: 'b', ordinal: 2, finishedAtTick: 600 }),
    ],
  }
  assert.deepEqual(skillsOf(world, 'agent-1'), [
    { skill: 'code', level: 2, points: 24 + 50, sample: 5, failed: 0, lastUsedTick: 600 },
  ])
})

test('R541：确定性（同存档两次全等）且角色之间互不串', () => {
  const world = {
    activities: [activity({ id: 'act-1', agentId: 'agent-1', skill: 'code' }), activity({ id: 'act-2', agentId: 'agent-2', skill: 'review' })],
  }
  assert.deepEqual(skillsOf(world, 'agent-1'), skillsOf(world, 'agent-1'))
  assert.deepEqual(skillsOf(world, 'agent-1').map((row) => row.skill), ['code'])
  assert.deepEqual(skillsOf(world, 'agent-2').map((row) => row.skill), ['review'])
  assert.deepEqual(skillsOf(world, 'agent-3'), [], '不存在的人不该继承别人的记录')
})

test('R541：够不上 1 级时不写进提示词行（8 分 ≠ 有本事）', () => {
  const world = { activities: [activity()] }
  assert.deepEqual(skillsOf(world, 'agent-1'), [
    { skill: 'code', level: 0, points: 8, sample: 1, failed: 0, lastUsedTick: 140 },
  ])
  assert.equal(skillLineForPrompt(world, 'agent-1'), '')
})

test('R541：同一 (set,key) 重复派单递减（25 → 10 → 5），跨集同名不算重复', () => {
  const sameKey = [1, 2, 3].map((i) => task({ id: 'task-' + String(i), key: 'impl', set: 'pipeline', ordinal: i }))
  const rows = skillsOf({ tasks: sameKey }, 'agent-1')
  assert.equal(rows[0].points, 40, '25 + 10 + 5')
  assert.equal(rows[0].sample, 3)
  // 40 分还够不上 L2(60)：三刷同一张单不会把人刷成"熟练"，这正是递减要的效果。
  assert.equal(rows[0].level, 1)

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
})

test('R541：认不出的能力名原样带出，绝不产出 undefined', () => {
  const world = { activities: practices(4, { skill: 'quantum' }) }
  const rows = skillsOf(world, 'agent-1')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].skill, 'quantum')
  assert.equal(typeof rows[0].skill, 'string')
  assert.notEqual(rows[0].skill, '')
  assert.equal(skillLabel('quantum'), 'quantum')
  assert.equal(skillLabel('code'), '工程')
  assert.equal(skillLineForPrompt(world, 'agent-1'), '近期手感：quantum 1 级（练了 4 次）')
})

test('R541：提示词行只取最拿手的三条，同级按能力名固定次序', () => {
  const skills = ['code', 'review', 'research', 'compute']
  const activities = []
  for (const [i, skill] of skills.entries()) {
    for (let n = 0; n < 4; n++) activities.push(activity({ id: 'act-' + String(i) + '-' + String(n), skill }))
  }
  const world = { activities }
  // 四条都是 32 分 / L1 → 同分同级，按能力名升序：code / compute / research / review
  assert.deepEqual(skillsOf(world, 'agent-1').map((row) => row.skill), ['code', 'compute', 'research', 'review'])
  assert.equal(
    skillLineForPrompt(world, 'agent-1'),
    '近期手感：工程 1 级（练了 4 次）、实测 1 级（练了 4 次）、调研 1 级（练了 4 次）',
  )
  assert.equal(skillLineForPrompt(world, 'agent-1'), skillLineForPrompt(world, 'agent-1'))
})

test('R542：阈值按"一次练习 +8"重标——3 次进不了 L1，封顶要 55 次', () => {
  // 三档实际数字（也是 docs 与看板口径）：练 3 次 = 24 分（0 级）、4 次 = 32 分（L1）、55 次 = 440 分（L5）。
  assert.equal(levelForPoints(3 * POINTS_PRACTICE), 0, '练 3 次不该长出等级')
  assert.equal(levelForPoints(4 * POINTS_PRACTICE), 1, '练 4 次才刚好 L1')
  assert.equal(levelForPoints(35 * POINTS_PRACTICE), 4, 'L4 = 280 分 = 35 次')
  assert.equal(levelForPoints(54 * POINTS_PRACTICE), 4, '差一次不给满级')
  assert.equal(levelForPoints(55 * POINTS_PRACTICE), 5, '封顶 = 440 分 = 55 次')
  // 每级需要的练习次数就是注释里那张表：4/9/20/35/55。用 lib 自己验一遍，防止只改了一半。
  assert.deepEqual(
    LEVEL_THRESHOLDS.map((points) => Math.ceil(points / POINTS_PRACTICE)),
    [4, 9, 20, 35, 55],
  )
})

test('R542：世界快照把每人的「近期手感」发给面板（派生只在内核，面板不重算）', () => {
  const service = createPluginState(resolveConfig({ autoStart: false, scene: 'scene.default-town' }))
  service.ensureWorld()
  const world = service.currentWorld()
  assert.ok(world.agents.length >= 2, '默认小镇至少有两个人，这个用例才有意义')
  const [first, second] = world.agents
  if (world.activities === undefined) world.activities = []
  for (let i = 0; i < 5; i += 1) {
    world.activities.push(activity({ id: 'act-snap-' + String(i), agentId: first.id, endedAt: 140 + i }))
  }

  // 与组合根（src/index.ts）同一条注入：routes 不许 import sim，派生从这里进去。
  const snap = buildSnapshot({
    service,
    runtime: createRuntime({ service, tickMs: 100 }),
    tickMs: 100,
    skillsOf: (world, agentId) => skillBoardOf(world, agentId),
  })
  const mine = snap.world.agents.find((agent) => agent.id === first.id)
  const other = snap.world.agents.find((agent) => agent.id === second.id)
  // 5 次练习 = 40 分 → L1(32)；label 由 skillLabel 解析好一起发（面板读不到内核，也不许自己抄表）。
  assert.deepEqual(mine.skills, [
    { skill: 'code', label: '工程', level: 1, points: 40, sample: 5, failed: 0, lastUsedTick: 144 },
  ])
  assert.deepEqual(other.skills, [], '没练过的人是空数组，不是 undefined（面板不用判类型）')
  // 没注入派生时也只是空数组——面板显示「—」，而不是崩（headless / 老调用方）。
  const bare = buildSnapshot({ service, runtime: createRuntime({ service, tickMs: 100 }), tickMs: 100 })
  assert.deepEqual(bare.world.agents.find((agent) => agent.id === first.id).skills, [])
  assert.notEqual(mine, world.agents[0], '快照里是拷贝：派生不许改到内核对象')
})
