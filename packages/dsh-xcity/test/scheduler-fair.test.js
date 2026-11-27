/**
 * 派单公平（R514）。
 *
 * 现场（H6）：agent-1 连做 task-1 / task-3，agent-3 一张没拿到。根因是候选顺序
 * 就是 `world.agents` 原序——**交完工回到队首的人，下一张单还是他的**。
 *
 * 这里钉住新口径：
 * - 同一轮里一个人最多一张（`taken`，老约束）；
 * - 跨轮按「今天经手最少的人」优先；
 * - 平手按 `agent.id`，同一世界同一 tick 可复现。
 *
 * 负载只用既有数据算（世界里的工单 owner + 时间戳），不新增状态；
 * 见 `src/sim/scheduler.ts` 的 `loadToday`。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { claimTasks } from '../lib/sim/scheduler.js'
import { step } from '../lib/sim/step.js'

const DAY_TICKS = 1440

/** 三个人（lead / engineer / engineer）、三张 code 工位的小镇。 */
function makeWorld({ agents = 3, tick = 0 } = {}) {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const world = createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets: ['task.quick-fix'],
    maxAgents: agents,
  })
  world.tick = tick
  return world
}

/**
 * 把世界里的工单换成 `count` 张可领取的 code 单。
 *
 * code 单是刻意的：默认小镇有三张 code 工位（各 1 个座位），
 * 正好能观察"三个人一人一张"，而不会被站点容量卡住。
 * `suggestedRole: null` 是为了让同职业优先不介入，只看公平序。
 */
function codeTasks(world, count, { createdAtTick = 0 } = {}) {
  const base = world.tasks[0]
  assert.ok(base, '世界应当至少装了一套工单')
  world.tasks = Array.from({ length: count }, (_, i) => ({
    ...base,
    id: `task-${i + 1}`,
    key: `k${i + 1}`,
    ordinal: i + 1,
    status: 'ready',
    owner: null,
    station: null,
    attemptId: null,
    progress: 0,
    blockedBy: [],
    requires: ['code'],
    suggestedRole: null,
    createdAtTick,
    finishedAtTick: null,
  }))
  return world.tasks
}

/** 追加一张"已经交掉"的单，记在 `ownerId` 名下——用来制造既有负载。 */
function finishedTask(world, id, ownerId, { finishedAtTick = world.tick, createdAtTick = 0 } = {}) {
  const base = world.tasks[0]
  const task = {
    ...base,
    id,
    key: id,
    ordinal: 900,
    status: 'done',
    owner: ownerId,
    station: null,
    attemptId: null,
    progress: 1,
    blockedBy: [],
    requires: ['code'],
    suggestedRole: null,
    createdAtTick,
    finishedAtTick,
  }
  world.tasks.push(task)
  return task
}

// ── 同一轮：一人一张 ────────────────────────────────────────────────────────

test('公平：三个人三张单，一人一张', () => {
  const world = makeWorld()
  codeTasks(world, 3)

  const { claims } = claimTasks(world)

  assert.equal(claims.length, 3, '三个空闲的人 + 三张单应当派满')
  assert.deepEqual(
    claims.map((c) => c.agentId).sort(),
    ['agent-1', 'agent-2', 'agent-3'],
    '不能有人拿两张、有人一张没有',
  )
})

test('公平：平手按 agent.id，同一世界同一 tick 派单可复现', () => {
  const first = makeWorld()
  codeTasks(first, 3)
  const second = makeWorld()
  codeTasks(second, 3)

  const a = claimTasks(first).claims
  const b = claimTasks(second).claims

  assert.deepEqual(a, b, '同输入必须得到同一份派单')
  assert.deepEqual(
    a.map((c) => c.agentId),
    ['agent-1', 'agent-2', 'agent-3'],
    '三人同为空手时按 id 序取人',
  )
})

// ── 跨轮：今天经手最少的人优先 ──────────────────────────────────────────────

test('公平：今天已经交过一张的人，下一张让给还没拿到的人', () => {
  const world = makeWorld({ tick: 120 })
  codeTasks(world, 1)
  finishedTask(world, 'task-done-1', 'agent-1')

  const { claims } = claimTasks(world)

  assert.equal(claims.length, 1)
  assert.equal(claims[0].agentId, 'agent-2', 'agent-1 今天已经经手一张，该轮到别人')
})

test('公平：单张时给今天最空的人（不是队首的人）', () => {
  const world = makeWorld({ tick: 200 })
  codeTasks(world, 1)
  finishedTask(world, 'task-done-1', 'agent-1')
  finishedTask(world, 'task-done-2', 'agent-1')
  finishedTask(world, 'task-done-3', 'agent-2')

  const { claims } = claimTasks(world)

  assert.equal(claims.length, 1)
  assert.equal(claims[0].agentId, 'agent-3', '两人有账、一人空手，空的拿')
})

test('公平：昨天交的单不算今天的负载', () => {
  const world = makeWorld({ tick: DAY_TICKS + 10 })
  codeTasks(world, 1)
  finishedTask(world, 'task-done-1', 'agent-2', { finishedAtTick: DAY_TICKS - 1, createdAtTick: 0 })

  const { claims } = claimTasks(world)

  assert.equal(claims.length, 1)
  assert.equal(claims[0].agentId, 'agent-1', '昨天的账不压今天：三人平手，回到 id 序')
})

// ── 端到端：H6 现场 ─────────────────────────────────────────────────────────

test('公平：流水线跑完，三个人各经手一张（H6 现场不再复现）', () => {
  const world = makeWorld()
  assert.equal(world.tasks.length, 3, 'quick-fix 是三张串联的单')
  for (const task of world.tasks) task.estimateTicks = 30

  for (let i = 0; i < 6000; i += 1) step(world)

  const done = world.tasks.filter((t) => t.status === 'done')
  assert.equal(done.length, 3, `三张单都该完工，实际 ${done.length}/3`)
  assert.deepEqual(
    done.map((t) => t.owner).sort(),
    ['agent-1', 'agent-2', 'agent-3'],
    '串行的三张单应当轮流落到三个人身上',
  )
})
