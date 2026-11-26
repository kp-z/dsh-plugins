/**
 * 「派个活，人会不会真的去干」——端到端模拟测试。
 *
 * 这条测试盯的是用户最直接的那个问题：
 * 派单之后，有没有人被指派、有没有走到工位、进度是否推进、最后是否完成。
 *
 * 它**不碰宿主**（不起 DSH、不发 HTTP）：只调 sim 的四个阶段函数，
 * 因为"世界会不会自己转"是内核的事，和 DSH 会话无关。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, symlink, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { recomputeReady } from '../lib/sim/ready.js'
import { claimTasks } from '../lib/sim/scheduler.js'
import { advanceMovement } from '../lib/sim/movement.js'
import { advanceWork } from '../lib/sim/interaction.js'
import { step } from '../lib/sim/step.js'
import { startActivity } from '../lib/sim/activity.js'
import { logsOf } from '../lib/adapters/slowvale/logs.js'
import { projectSnapshot, projectScene } from '../lib/adapters/slowvale/project.js'
import { createTaskExecution } from '../lib/adapters/slowvale/task-execution.js'
import { hasXcityRoleModel, isIdleSession } from '../lib/bridge/dsh-adapter.js'
import { sessionsByAgent } from '../lib/adapters/slowvale/xcity.js'

function makeWorld(taskSets, createdAt = '2026-01-01T00:00:00.000Z') {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.default-town',
    createdAt,
    taskSets,
  })
}

test('派单之后：有人被指派、走到工位、进度推进、最终完成', () => {
  const world = makeWorld(['task.town-inspection'])
  assert.ok(world.tasks.length > 0, '任务集应该建出工单')

  const first = world.tasks[0]
  let owner = null
  let sawMoving = false
  let lastProgress = 0

  // 上限给足：走路 + 干活都要 tick。
  for (let tick = 0; tick < 4000; tick += 1) {
    world.tick += 1
    recomputeReady(world)
    claimTasks(world)
    advanceMovement(world)
    advanceWork(world)

    pada: {
      const current = world.tasks.find((t) => t.id === first.id)
      if (current === undefined) break pada
      if (current.owner !== null && owner === null) owner = current.owner
      if (current.status === 'in_progress') {
        if (current.progress > lastProgress) lastProgress = current.progress
        const agent = world.agents.find((a) => a.id === current.owner)
        if (agent !== undefined && agent.path.length > 0) sawMoving = true
      }
      if (current.status === 'done') break pada
    }
  }

  assert.notEqual(owner, null, '应该有角色领取第一张工单')
  assert.ok(sawMoving, '领到工单的人应该有过一段前往工位的路径')
  assert.ok(lastProgress > 0, '进度应该推进过')
  assert.equal(world.tasks.find((t) => t.id === first.id)?.status, 'done', '模拟模式下进度满即完成')
})

test('宿主执行工单：仅可用会话角色认领，模拟时间不是完工证据', () => {
  const world = makeWorld(['task.town-inspection'])
  const task = world.tasks[0]
  for (let i = 0; i < 10; i += 1) step(world, [], { sessionWorkers: new Set() })
  assert.equal(task.status, 'ready')
  assert.equal(task.owner, null)
  const worker = world.agents.at(-1)
  const context = { sessionWorkers: new Set([worker.id]), idleAmbient: false }
  for (let i = 0; i < 150; i += 1) step(world, [], context)
  assert.equal(task.owner, worker.id)
  assert.equal(task.status, 'in_progress')
  for (let i = 0; i < 300; i += 1) step(world, [], context)
  assert.equal(task.status, 'in_progress')
  assert.equal(task.progress, 0)
  step(world, [{ kind: 'taskComplete', taskId: task.id, attemptId: task.attemptId, output: '宿主裁决' }], { sessionWorkers: new Set() })
  assert.equal(task.status, 'done')
  assert.equal(worker.carrying, null)
})

test('宿主空闲检查不唤醒角色，不误用运行、排队、待审批或状态未知的会话', async () => {
  const signal = new AbortController().signal
  const idle = { active: true, running: false, queue: [], pendingInput: [] }
  const check = (value) => isIdleSession({ get: () => ({ state: async (input, sentSignal) => {
    assert.deepEqual(input, { sessionId: 'lin' })
    assert.equal(sentSignal, signal)
    return value
  } }) }, 'lin', signal)
  assert.equal(await check(idle), true)
  assert.equal(await check({ ...idle, active: false, queue: null }), true)
  assert.equal(await check({ ...idle, running: true }), false)
  assert.equal(await check({ ...idle, queue: [{ id: 'user-task' }] }), false)
  assert.equal(await check({ ...idle, pendingInput: ['approval'] }), false)
  assert.equal(await check({ ...idle, queue: null }), false)
  assert.equal(await check({}), false)
  assert.equal(await isIdleSession({}, 'lin', signal), false)
  assert.equal(await isIdleSession({ get: () => ({ state: async () => { throw new Error('session busy') } }) }, 'lin', signal), false)
})

test('自动派工不使用重复角色槽位或多人共用的 DSH 会话', () => {
  const slots = { 'agent-1': 'lin', 'agent-2': 'mei', 'agent-3': 'zhou' }
  const bindings = [{ characterId: 'lin', sessionId: 'ls' }, { characterId: 'mei', sessionId: 'ms' }, { characterId: 'zhou', sessionId: 'zs' }]
  assert.deepEqual([...sessionsByAgent(bindings, slots)], [['agent-1', 'ls'], ['agent-2', 'ms'], ['agent-3', 'zs']])
  assert.deepEqual([...sessionsByAgent([...bindings, { characterId: 'other', sessionId: 'ls' }], { ...slots, 'agent-4': 'mei' })], [['agent-3', 'zs']])
})

for (const interrupted of [false, true]) test(interrupted ? '工单轮次被插入其他输入且未交付，结束后只失败一次' : '空闲会话只派工一次，交付文件与当前轮次共同约束结单', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'xcity-claim-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const world = makeWorld(['task.town-inspection'])
  const task = world.tasks[0]
  const worker = world.agents[0]
  let idle = false
  const sent = []
  let output
  const commands = []
  const runner = createTaskExecution({
    world: () => world,
    cwd,
    start: (w, agent, task) => startActivity(w, agent, { kind: 'work', ticks: 0, taskAttemptId: task.attemptId }),
    settle: (currentWorld, claimed, result) => {
      assert.equal(currentWorld, world)
      output = result.output
      const identity = { taskId: claimed.id, attemptId: claimed.attemptId }
      commands.push('output' in result ? { kind: 'taskComplete', ...identity, output } : { kind: 'taskFail', ...identity, reason: result.reason })
      return true
    },
    sessions: () => new Map([[worker.id, 'lin']]),
    available: async () => idle,
    prompt: async (request) => { sent.push(request) },
  })
  const tick = () => step(world, [], { sessionWorkers: runner.workers(world), idleAmbient: false })
  tick()
  await runner.heartbeat()
  assert.equal(runner.workers(world).size, 0)
  idle = true
  await runner.heartbeat()
  for (let i = 0; i < 200; i += 1) tick()
  assert.equal(task.owner, worker.id)
  assert.equal(worker.state, 'working')
  idle = false
  await runner.heartbeat()
  assert.equal(sent.length, 0)
  idle = true
  await Promise.all([runner.heartbeat(), runner.heartbeat()])
  await runner.heartbeat()
  assert.equal(sent.length, 1)
  assert.match(sent[0].requestId, /^xcity-task:[a-f0-9]{64}$/)
  assert.equal(sent[0].sessionId, 'lin')
  assert.equal(sent[0].mode, 'queue')
  assert.equal(task.status, 'in_progress')
  const evidence = sent[0].content[0].text.match(/\.xcity-results\/[a-f0-9]+\.md/)[0]
  const report = { taskId: task.id, status: 'done', summary: '巡检结果', evidence: [evidence] }
  assert.equal(runner.report('lin', report).accepted, false, '仅入队还不能回报')
  assert.equal(world.activities.some((x) => x.taskAttemptId === task.attemptId), false, '仅投递不能记作开工')
  runner.observe('lin', 'step/start', { turn: 2 })
  runner.observe('lin', 'user/message', { source: { kind: 'user', rpcId: sent[0].requestId } })
  const opts = { worldId: 'w1', viewerRoleId: worker.id, place: 'company', startDate: '2026-01-01' }
  const activity = world.activities.find((x) => x.taskAttemptId === task.attemptId)
  assert.equal(activity.status, 'active')
  for (let i = 0; i < 50; i += 1) tick()
  assert.equal(activity.status, 'active', '实际工单不按 tick 结束')
  for (const project of [projectSnapshot, projectScene]) {
    const pub = project(world, opts).role_public_statuses[worker.id].active_activity
    assert.equal(pub.description, '干活')
    assert.equal(pub.duration_seconds, undefined)
  }
  assert.equal(runner.report('mei', report).accepted, false, '其他会话不能替交付')
  assert.equal(runner.report('lin', report).accepted, false, '口头完成不是证据')
  const path = join(cwd, evidence)
  await mkdir(dirname(path))
  const source = join(cwd, 'old.md')
  await writeFile(source, '另一项工单结果')
  await symlink(source, path)
  assert.equal(runner.report('lin', report).accepted, false, '不能引用软链接作为新产物')
  await unlink(path)
  await writeFile(path, '  ')
  assert.equal(runner.report('lin', report).accepted, false, '空产物不算完成')
  await writeFile(path, '原版场景巡检结果')
  runner.observe('lin', 'turn/end', { turn: 1 })
  assert.equal(commands.length, 0, '无关轮次结束不裁决')
  if (interrupted) {
    runner.observe('lin', 'user/message', { turn: 2, source: { kind: 'user', rpcId: 'other-input' } })
    assert.equal(runner.report('lin', report).accepted, false, '被插入其他消息后不能交付')
  } else {
    assert.equal(runner.report('lin', report).accepted, true)
    assert.match(output, /SHA-256: [a-f0-9]{64}/)
  }
  runner.observe('lin', 'turn/end', { turn: 2 })
  runner.observe('lin', 'turn/end', { turn: 2 })
  assert.equal(runner.report('lin', report).accepted, false, '防重复或迟到裁决')
  assert.equal(commands.length, 1)
  step(world, commands, { sessionWorkers: new Set(), idleAmbient: false })
  assert.equal(task.status, interrupted ? 'failed' : 'done')
  assert.equal(activity.status, interrupted ? 'interrupted' : 'completed')
  assert.equal(projectSnapshot(world, opts).role_public_statuses[worker.id].active_activity, undefined)
  const logs = logsOf({ epoch: 'e', startDate: opts.startDate, activities: world.activities, notices: [], nameOf: () => worker.name, placeOf: () => null })
  const lifecycle = logs.recent.entries.filter((entry) => entry.phase_id === activity.id).map((entry) => entry.phase.items[0].lifecycle)
  assert.deepEqual(lifecycle, ['start', interrupted ? 'interrupt' : 'complete'])
  if (interrupted) assert.match(task.failureReason, /未收到有效交付/)
  else assert.equal(task.output, output)
  assert.equal(worker.carrying, null)
  runner.stop()
})

test('自主工单不借宿主默认模型或其他已选模型代跑', () => {
  const current = (model) => hasXcityRoleModel({ get: () => ({ get: () => ({ model: { current: () => model } }) }) }, 'lin')
  assert.equal(current({ provider: 'mmt-vision', model: 'DeepSeek-V4.1' }), true)
  assert.equal(current({ provider: 'mmt-vision', model: 'DeepSeek-V4.1-lite' }), false)
  assert.equal(current({ provider: 'other', model: 'DeepSeek-V4.1' }), false)
  assert.equal(current(undefined), false)
  assert.equal(hasXcityRoleModel({}, 'lin'), false)
})

test('旧存档恢复保持请求编号，同种子开新局不会复用编号', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'xcity-receipt-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const old = makeWorld(['task.town-inspection'])
  const reset = makeWorld(['task.town-inspection'], '2026-01-02T00:00:00.000Z')
  assert.equal(old.id, reset.id)
  for (const world of [old, reset]) {
    for (let i = 0; i < 200; i += 1) step(world, [], { sessionWorkers: new Set([world.agents[0].id]), idleAmbient: false })
  }
  assert.equal(old.tasks[0].attemptId, reset.tasks[0].attemptId)
  async function request(world) {
    let requestId
    const runner = createTaskExecution({
      cwd, world: () => world,
      start: () => assert.fail('投递不是开工'),
      settle: () => assert.fail('投递不是完成'),
      sessions: () => new Map([[world.agents[0].id, 'lin']]),
      available: async () => true,
      prompt: async (input) => { requestId = input.requestId },
    })
    await runner.heartbeat()
    runner.stop()
    assert.equal(typeof requestId, 'string')
    return requestId
  }
  const original = await request(old)
  assert.equal(await request(structuredClone(old)), original)
  assert.notEqual(await request(reset), original)
})
