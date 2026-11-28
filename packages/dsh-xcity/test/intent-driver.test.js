/**
 * H38：动机归因（driver）。
 *
 * 守六件事：
 * 1. `byDriver` 三键齐全、初始全 0、快照是拷贝、reset 归零；
 * 2. 三种 driver 都能从**公开入口**真的走到（需求 / 赴约 / 作息）；
 * 3. 没拿到意图时不记 driver（分母是"真的拿到意图的次数"，不是 tick 数）；
 * 4. 旧 `byReason` 与改动前**逐键相等**（回归：那张表一个字都不许动）；
 * 5. driver 写进 `Activity.trigger.text`（前缀式），且不破坏既有解析；
 * 6. driver 是**派生**量：同一份世界两次跑出同样分布。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'
import { chooseLife, intentOptions, selfLifeCommands } from '../lib/sim/life.js'
import { INTENT_REASONS, MOTIVE_DRIVERS, createIntentStats, intentStats } from '../lib/sim/intent-stats.js'
import { summarizeActivity } from '../lib/sim/memory.js'
import { summarizeDay } from '../lib/sim/day-summary.js'

const content = new ContentRegistry()
content.loadAll(builtinPacks())
const OFFICE = { id: 'place:office.tech_company_1', name: 'Office', asset: 'company', spawn: { x: 480, z: 800 } }

const WORK_TIME = 10 * 60
const OFF_WORK = 20 * 60
const NIGHT = 2 * 60

function makeWorld() {
  return createWorld({
    content,
    scene: 'scene.office',
    name: 'driver',
    maxAgents: 3,
    places: [OFFICE],
    createdAt: '2026-01-01T00:00:00.000Z',
  })
}

/** 被测的那位：站着、没单、没有活动——即 available() 认的那个人。 */
function subjectOf(world) {
  const agent = world.agents[0]
  assert.ok(agent, '场景里至少要有一个人')
  agent.state = 'idle'
  agent.station = null
  agent.targetStation = null
  agent.path = []
  agent.carrying = null
  agent.activityUntil = undefined
  return agent
}

/** 其余人都给满需求，免得他们抢座/抢人把被测的人挤到别的档。 */
function calmOthers(world) {
  for (const agent of world.agents.slice(1)) {
    agent.state = 'idle'
    agent.station = null
    agent.targetStation = null
    agent.path = []
    agent.carrying = null
    agent.activityUntil = undefined
    agent.needs = { hunger: 100, energy: 100, social: 100 }
  }
}

/** 把某一类站点从地点里移走（不是塞满：塞满只影响 freeStation，pickStation 仍挑得到）。 */
function dropStations(world, predicate) {
  let dropped = 0
  for (let i = world.stations.length - 1; i >= 0; i -= 1) {
    if (predicate(world.stations[i])) {
      world.stations.splice(i, 1)
      dropped += 1
    }
  }
  assert.ok(dropped > 0, '这个场景里应当有这类站点，否则测试自己就没意义了')
}

/** 走一次 intentOptions，返回 [候选意图列表, 快照]。 */
function observe(world, agent) {
  intentStats.reset()
  const options = intentOptions(world, agent)
  return [options.map((option) => option.intent), intentStats.snapshot()]
}

/** 只调一次 chooseLife，返回 [意图, 快照]。 */
function decide(world, agent) {
  intentStats.reset()
  const intent = chooseLife(world, agent)
  return [intent, intentStats.snapshot()]
}

/** 旧 byReason 的期望表：全 0，再覆盖本次真的该记的那几格。 */
function reasons(patch) {
  const table = {}
  for (const reason of INTENT_REASONS) table[reason] = 0
  return { ...table, ...patch }
}

/** byDriver 的期望表：同样全 0 起底。 */
function drivers(patch) {
  const table = {}
  for (const driver of MOTIVE_DRIVERS) table[driver] = 0
  return { ...table, ...patch }
}

const commitment = (id, withId, dueTick) => ({
  id,
  with: withId,
  what: '一起把工单对一遍',
  dueTick,
  status: 'open',
  source: 'plan',
  createdAtTick: 0,
})

// ── 1. 表本身 ───────────────────────────────────────────────────────────────

test('H38：byDriver 三键齐全、初始全 0（0 也要看得见）', () => {
  const snapshot = createIntentStats().snapshot()
  assert.deepEqual(Object.keys(snapshot.byDriver), [...MOTIVE_DRIVERS])
  assert.deepEqual(snapshot.byDriver, drivers({}))
  assert.equal(snapshot.total, 0)
  // 新表与旧表并列，不改旧表的键。
  assert.deepEqual(Object.keys(snapshot.byReason), [...INTENT_REASONS])
})

test('H38：observeDriver 连续计数正确；快照是拷贝；reset 归零；野值不计数', () => {
  const stats = createIntentStats()
  stats.observeDriver('need')
  stats.observeDriver('need')
  stats.observeDriver('routine')
  assert.deepEqual(stats.snapshot().byDriver, drivers({ need: 2, routine: 1 }))
  assert.equal(stats.snapshot().total, 0, 'motivation 不进 total（旧口径一个字不动）')

  const first = stats.snapshot()
  first.byDriver.need = 99
  assert.equal(stats.snapshot().byDriver.need, 2, '读快照的人改不动计数')

  stats.reset()
  assert.deepEqual(stats.snapshot().byDriver, drivers({}))

  stats.observeDriver('wat')
  assert.deepEqual(stats.snapshot().byDriver, drivers({}), '表外的动机不计数')
})

// ── 2. 三种 driver 真的能走到 ───────────────────────────────────────────────

test('H38·need：饿了去吃饭 → driver=need，trigger 文案以 need: 开头', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  calmOthers(world)
  agent.needs = { hunger: 10, energy: 90, social: 90 }

  const [intent, snapshot] = decide(world, agent)
  assert.equal(intent?.purpose, 'meal')
  assert.equal(intent?.driver, 'need')
  assert.match(intent.reason, /^need: 饿了，去吃点东西$/)
  assert.deepEqual(snapshot.byDriver, drivers({ need: 1 }))
  assert.deepEqual(snapshot.byReason, reasons({ ok: 1 }))
})

test('H38·routine：上班时段去干活、非上班时段学习都是 routine', () => {
  const working = makeWorld()
  working.tick = WORK_TIME
  const worker = subjectOf(working)
  calmOthers(working)
  worker.needs = { hunger: 90, energy: 90, social: 90 }
  const [workIntent, workSnapshot] = decide(working, worker)
  assert.equal(workIntent?.purpose, 'work')
  assert.equal(workIntent?.driver, 'routine')
  assert.deepEqual(workSnapshot.byDriver, drivers({ routine: 1 }))

  const offWork = makeWorld()
  offWork.tick = OFF_WORK
  const student = subjectOf(offWork)
  calmOthers(offWork)
  student.needs = { hunger: 90, energy: 90, social: 90 }
  const [studyIntent, studySnapshot] = decide(offWork, student)
  assert.equal(studyIntent?.purpose, 'study')
  assert.equal(studyIntent?.driver, 'routine')
  assert.deepEqual(studySnapshot.byDriver, drivers({ routine: 1 }))
})

test('H38·duty：赴约 → driver=duty（哪怕它与上班候选同时存在）', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const me = subjectOf(world)
  calmOthers(world)
  const peer = world.agents[1]
  assert.ok(peer)
  me.needs = { hunger: 90, energy: 90, social: 90 }
  // 对方在会话椅上聊着，我在窗口内有一个 open 的约。
  const seat = world.stations.find((station) => station.capabilities.includes('converse'))
  assert.ok(seat)
  peer.state = 'talking'
  peer.station = seat.id
  peer.activityUntil = world.tick + 60
  me.commitments = [commitment('c1', peer.id, world.tick + 60)]

  const [intent, snapshot] = decide(world, me)
  assert.equal(intent?.driver, 'duty', '赴约的动机是义务，不是需求')
  assert.equal(intent?.purpose, 'social')
  assert.match(intent.reason, /^duty: 快到点了/)
  // 同一次决策里还有一条"上班"候选：两条候选各记一次（分母是意图条数，不是决策数）。
  assert.deepEqual(snapshot.byDriver, drivers({ duty: 1, routine: 1 }))
  assert.deepEqual(snapshot.byReason, reasons({ ok: 1 }))
})

test('H38：一次调用给出多条候选时，每条各记一次', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  calmOthers(world)
  // social 低 + 上班时段 → 候选里有"想说话"(need) 与"去干活"(routine)。
  agent.needs = { hunger: 90, energy: 90, social: 10 }

  const [intents, snapshot] = observe(world, agent)
  assert.equal(intents.filter((intent) => intent !== null).length, 2, '应当恰好两条候选')
  assert.deepEqual(snapshot.byDriver, drivers({ need: 1, routine: 1 }))
  assert.equal(snapshot.byReason.ok, 1, 'byReason 仍按"每 tick 一次"记')
})

// ── 3. 没意图就不记 ─────────────────────────────────────────────────────────

test('H38：没拿到意图时一格 driver 都不加（分母是意图条数）', () => {
  // 在走的人：一个意图都没有。
  const walking = makeWorld()
  walking.tick = WORK_TIME
  const walker = subjectOf(walking)
  walker.state = 'walking'
  const [walkerIntents, walkerSnapshot] = observe(walking, walker)
  assert.deepEqual(walkerIntents, [])
  assert.deepEqual(walkerSnapshot.byDriver, drivers({}))
  assert.deepEqual(walkerSnapshot.byReason, reasons({ 'not-available': 1 }))

  // 有 ready 工单：把人留给调度器，同样没有意图。
  const busy = makeWorld()
  busy.tick = WORK_TIME
  const worker = subjectOf(busy)
  busy.tasks.push({ id: 'task-ready-for-driver', status: 'ready', owner: null, carrying: null })
  const [busyIntents, busySnapshot] = observe(busy, worker)
  assert.deepEqual(busyIntents, [])
  assert.deepEqual(busySnapshot.byDriver, drivers({}))
  assert.deepEqual(busySnapshot.byReason, reasons({ 'task-ready': 1 }))
})

// ── 4. 旧 byReason 逐键相等（回归）──────────────────────────────────────────

test('H38：旧 byReason 与改动前逐键相等（八个出口逐格回归）', () => {
  const cases = []

  {
    const world = makeWorld()
    world.tick = WORK_TIME
    const agent = subjectOf(world)
    agent.needs = { hunger: 90, energy: 90, social: 90 }
    cases.push(['ok', world, agent, reasons({ ok: 1 })])
  }
  {
    const world = makeWorld()
    world.tick = WORK_TIME
    const agent = subjectOf(world)
    agent.state = 'walking'
    cases.push(['not-available', world, agent, reasons({ 'not-available': 1 })])
  }
  {
    const world = makeWorld()
    world.tick = WORK_TIME
    const agent = subjectOf(world)
    world.tasks.push({ id: 'task-ready', status: 'ready', owner: null, carrying: null })
    cases.push(['task-ready', world, agent, reasons({ 'task-ready': 1 })])
  }
  {
    const world = makeWorld()
    world.tick = WORK_TIME
    const agent = subjectOf(world)
    agent.needs = { hunger: 10, energy: 90, social: 90 }
    dropStations(world, (station) => station.kind === 'breakroom')
    cases.push(['hungry-no-breakroom', world, agent, reasons({ 'hungry-no-breakroom': 1 })])
  }
  {
    const world = makeWorld()
    world.tick = NIGHT
    const agent = subjectOf(world)
    agent.needs = { hunger: 90, energy: 40, social: 90 }
    dropStations(world, (station) => station.capabilities.includes('rest'))
    cases.push(['night-no-rest', world, agent, reasons({ 'night-no-rest': 1 })])
  }
  {
    const world = makeWorld()
    world.tick = WORK_TIME
    const agent = subjectOf(world)
    agent.needs = { hunger: 90, energy: 10, social: 90 }
    dropStations(world, (station) => station.capabilities.includes('rest'))
    cases.push(['no-rest-station', world, agent, reasons({ 'no-rest-station': 1 })])
  }
  {
    const world = makeWorld()
    world.tick = WORK_TIME
    const agent = subjectOf(world)
    agent.needs = { hunger: 90, energy: 90, social: 90 }
    dropStations(world, (station) => station.capabilities.some((capability) => capability === 'code' || capability === 'review' || capability === 'research' || capability === 'compute'))
    cases.push(['no-work-station', world, agent, reasons({ 'no-work-station': 1 })])
  }
  {
    const world = makeWorld()
    world.tick = 12 * 60
    const agent = subjectOf(world)
    agent.needs = { hunger: 90, energy: 90, social: 90 }
    dropStations(world, (station) => station.capabilities.includes('code') || station.capabilities.includes('research'))
    cases.push(['need-null', world, agent, reasons({ 'need-null': 1 })])
  }

  for (const [label, world, agent, expected] of cases) {
    const [, snapshot] = observe(world, agent)
    assert.deepEqual(snapshot.byReason, expected, label)
  }
})

// ── 5. trigger.text ────────────────────────────────────────────────────────

test('H38：driver 写进 Activity.trigger.text，且既有解析照旧', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  calmOthers(world)
  agent.needs = { hunger: 10, energy: 90, social: 90 }

  const commands = selfLifeCommands(world)
  const mine = commands.find((command) => command.agentId === agent.id)
  assert.ok(mine, '应当有一条自派命令')
  assert.equal(mine.trigger.kind, 'self')
  assert.match(mine.trigger.text, /^need: 饿了，去吃点东西$/)

  // 命令只让他上路；活动在到站那一刻才落档——真跑几步，别手搓 Activity。
  step(world, commands)
  for (let i = 0; i < 240 && !world.activities.some((row) => row.agentId === agent.id); i += 1) step(world)
  const activity = world.activities.find((row) => row.agentId === agent.id)
  assert.ok(activity, '命令要真的落成活动')
  assert.match(activity.trigger.text, /^need: /, '落档的 trigger.text 同样带动机前缀')
  assert.equal(activity.purpose, 'meal')

  // 既有消费方读的是 purpose/原词，不看前缀：
  // 1) memory.summarizeActivity 按 purpose 出文案（前缀不进摘要）；
  assert.equal(summarizeActivity(activity), '吃了顿饭')
  // 2) day-summary 同样按 purpose 出标签，摘要里不出现 "need:" 这种机器词。
  const lines = summarizeDay(world, agent.id, world.tick)
  assert.ok(lines.some((line) => line.includes('吃饭')), '当天摘要仍能说出"吃饭"：' + JSON.stringify(lines))
  assert.ok(!lines.some((line) => line.includes('need:')), '机器前缀不该漏进取 prompt 的摘要')
  // 3) 前缀是"在前面加"，原句一字不改——按关键词读老逻辑的人也不受影响。
  assert.ok(activity.trigger.text.endsWith('饿了，去吃点东西'))
})

// ── 6. 派生 ────────────────────────────────────────────────────────────────

test('H38：driver 是派生量——同一份世界两次跑出同样分布', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  calmOthers(world)
  agent.needs = { hunger: 90, energy: 90, social: 10 }

  const [, first] = observe(world, agent)
  const [, second] = observe(world, agent)
  assert.deepEqual(second.byDriver, first.byDriver)
  assert.deepEqual(second.byReason, first.byReason)

  const [one] = decide(world, agent)
  const [two] = decide(world, agent)
  assert.deepEqual(two, one, '两次决策的意图（含 driver 与前缀文案）逐字段相同')
  assert.equal(one.driver, two.driver)
})
