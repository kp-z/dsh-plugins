/**
 * R478：由需求决定去处。
 *
 * 守三件事：
 * 1. 优先级：饿 > 夜里睡 > 累 > 社交 > 上班 > 学习；
 * 2. 该让位时让位：有 ready 工单、正在做事、站点被占；
 * 3. 吃饭/睡觉真的改变需求，而不是只发一条命令。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { chooseLife, selfLifeCommands } from '../lib/sim/life.js'
import { advanceNeeds } from '../lib/sim/needs.js'
import { step } from '../lib/sim/step.js'

function makeWorld({ taskSets = [] } = {}) {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.office',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets,
  })
}

function atMinute(world, minute) {
  world.tick = minute
  return world
}

test('场景里有 breakroom：吃饭/休息有地方可去', () => {
  const world = makeWorld()
  const room = world.stations.find((station) => station.kind === 'breakroom')
  assert.ok(room, '办公室场景应当有茶水间休息位')
  assert.ok(room.capabilities.includes('rest'))
  assert.ok(room.capacity >= 2)
})

test('饿优先：hunger 低 → 去 breakroom 吃饭', () => {
  const world = atMinute(makeWorld(), 10 * 60)
  const agent = world.agents[0]
  agent.needs = { hunger: 10, energy: 90, social: 90 }
  const intent = chooseLife(world, agent)
  assert.equal(intent?.purpose, 'meal')
  const station = world.stations.find((row) => row.id === intent?.stationId)
  assert.equal(station?.kind, 'breakroom')
})

test('夜里优先睡觉：02:00 需求都满也去睡', () => {
  const world = atMinute(makeWorld(), 2 * 60)
  const agent = world.agents[0]
  agent.needs = { hunger: 90, energy: 90, social: 90 }
  const intent = chooseLife(world, agent)
  assert.equal(intent?.purpose, 'sleep')
})

test('累优先：energy 低 → 休息；站点不是 breakroom 时也接受', () => {
  const world = atMinute(makeWorld(), 10 * 60)
  const agent = world.agents[0]
  agent.needs = { hunger: 90, energy: 10, social: 90 }
  const intent = chooseLife(world, agent)
  assert.equal(intent?.purpose, 'rest')
  assert.ok(intent?.stationId)
})

test('社交：有人且 social 低 → 去能坐两人的 converse 站点', () => {
  const world = atMinute(makeWorld(), 20 * 60)
  const agent = world.agents[0]
  agent.needs = { hunger: 90, energy: 90, social: 10 }
  const intent = chooseLife(world, agent)
  assert.equal(intent?.purpose, 'social')
  const station = world.stations.find((row) => row.id === intent?.stationId)
  assert.ok(station?.capabilities.includes('converse'), '社交应当去 converse 站点')
})

test('上班时段：需求都满足 → 工作；下班 → 学习', () => {
  const workWorld = atMinute(makeWorld(), 10 * 60)
  const worker = workWorld.agents[0]
  worker.needs = { hunger: 90, energy: 90, social: 90 }
  assert.equal(chooseLife(workWorld, worker)?.purpose, 'work')

  const studyWorld = atMinute(makeWorld(), 20 * 60)
  const student = studyWorld.agents[0]
  student.needs = { hunger: 90, energy: 90, social: 90 }
  assert.equal(chooseLife(studyWorld, student)?.purpose, 'study')
})

test('该让位时让位：有 ready 工单 / 正在做事 → 不自派', () => {
  const world = atMinute(makeWorld(), 10 * 60)
  const agent = world.agents[0]
  agent.needs = { hunger: 10, energy: 10, social: 10 }
  world.tasks.push({
    id: 'task-waiting',
    key: 'waiting',
    set: 'test',
    ordinal: 1,
    title: '等着的单',
    description: '',
    status: 'ready',
    owner: null,
    station: null,
    requires: ['code'],
    blockedBy: [],
    progress: 0,
    attemptId: null,
    acceptance: '',
    estimateTicks: 10,
    createdAtTick: 1,
    finishedAtTick: null,
    externalId: null,
    output: null,
    failureReason: null,
    suggestedRole: null,
  })
  assert.equal(chooseLife(world, agent), null)

  const busyWorld = atMinute(makeWorld(), 10 * 60)
  const busy = busyWorld.agents[0]
  busy.activityUntil = busyWorld.tick + 10
  busy.state = 'working'
  assert.equal(chooseLife(busyWorld, busy), null)
})

test('吃饭恢复饥饿，睡觉不补饥饿；都只在到站后生效', () => {
  const world = atMinute(makeWorld(), 10 * 60)
  const room = world.stations.find((station) => station.kind === 'breakroom')
  assert.ok(room)

  const eater = world.agents[0]
  eater.state = 'sleeping'
  eater.station = room.id
  eater.activityKind = 'rest'
  eater.activityPurpose = 'meal'
  eater.needs = { hunger: 50, energy: 50, social: 50 }

  const sleeper = world.agents[1]
  sleeper.state = 'sleeping'
  sleeper.station = room.id
  sleeper.activityKind = 'rest'
  sleeper.activityPurpose = 'sleep'
  sleeper.needs = { hunger: 50, energy: 50, social: 50 }

  for (let i = 0; i < 40; i += 1) advanceNeeds(world)
  assert.ok(eater.needs.hunger > 80, `吃饭应当补饥饿，实际 ${eater.needs.hunger}`)
  assert.ok(sleeper.needs.energy > eater.needs.energy, '睡觉应当多补体力')
  assert.ok(sleeper.needs.hunger < 50, '睡觉不该补饥饿')

  // 走路去吃饭的路上不算吃过：清掉 station。
  eater.station = null
  eater.state = 'walking'
  const before = eater.needs.hunger
  advanceNeeds(world)
  assert.ok(eater.needs.hunger <= before, '在路上不该恢复饥饿')
})

test('stationId 被占时退回能力搜索，不硬挤进去', () => {
  const world = atMinute(makeWorld(), 10 * 60)
  const agent = world.agents[0]
  const full = world.stations.find((station) => station.capacity === 1 && station.capabilities.includes('code'))
  assert.ok(full)
  const other = world.agents[1]
  other.state = 'working'
  other.station = full.id
  other.activityKind = 'work'

  step(world, [{ kind: 'agentActivity', agentId: agent.id, activity: 'work', ticks: 30, skill: 'code', stationId: full.id }])
  assert.notEqual(agent.targetStation, full.id, '满员的站点不能再被指定')
})

test('命令的 purpose 会落到角色身上（吃饭不是普通 rest）', () => {
  const world = atMinute(makeWorld(), 10 * 60)
  const agent = world.agents[0]
  const room = world.stations.find((station) => station.kind === 'breakroom')
  assert.ok(room)
  step(world, [{ kind: 'agentActivity', agentId: agent.id, activity: 'rest', ticks: 40, purpose: 'meal', stationId: room.id }])
  assert.equal(agent.activityPurpose, 'meal')
  assert.equal(agent.activityKind, 'rest')
})

test('命令真的会走到站点：selfLifeCommands → step → walking', () => {
  const world = atMinute(makeWorld(), 10 * 60)
  for (const agent of world.agents) agent.needs = { hunger: 90, energy: 90, social: 90 }
  const commands = selfLifeCommands(world)
  assert.ok(commands.length > 0)
  assert.ok(commands.every((command) => command.purpose === 'work' && command.stationId))
  step(world, commands)
  const walking = world.agents.filter((agent) => agent.state === 'walking' && agent.targetStation !== null)
  assert.ok(walking.length > 0)
  assert.equal(walking[0].activityPurpose, 'work')
})
