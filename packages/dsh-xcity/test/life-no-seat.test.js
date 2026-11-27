/**
 * R527：抢不到座位的人不能站在歇脚点发呆。
 *
 * 现场：24 人 / 26 站点 / 34 容量，实测 unseatedMax 11——这 11 个人五档意图全是 null，
 * selfLifeCommands 直接跳过，于是他们被 spreadHangout 错开在原地，看起来像在发呆。
 *
 * 这里钉四件事：
 * 1. 有目标但一个空位都没有 → 出现等待意图（复用 rest、30~60 tick、无站点），并去目的地附近等；
 * 2. 有目标且有空位 → 仍是正常意图，行为一个字都不该变；
 * 3. 没有目标（这地方压根没有他要去的那类地方）→ 不发等待意图，不排队；
 * 4. 确定性：同一世界重复调用一致，窗口内时长不抖（不是每 tick 重抽）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { distance } from '../lib/domain/geometry.js'
import { chooseLife, intentOptions, selfLifeCommands } from '../lib/sim/life.js'
import { step } from '../lib/sim/step.js'
import { createWorld } from '../lib/world/create.js'

const content = new ContentRegistry()
content.loadAll(builtinPacks())

const WORK_TIME = 10 * 60

function makeWorld() {
  return createWorld({ content, scene: 'scene.office', createdAt: '2026-01-01T00:00:00.000Z' })
}

/** 把某一类站点**真的坐满**（每个座位塞一个人），而不是把 capacity 改成 0。 */
function fillSeats(world, capabilities) {
  const template = world.agents[0]
  let seat = 0
  for (const station of world.stations) {
    if (!station.capabilities.some((capability) => capabilities.includes(capability))) continue
    for (let i = 0; i < station.capacity; i += 1) {
      seat += 1
      world.agents.push({
        ...template,
        id: 'sitter-' + String(seat),
        name: 'sitter-' + String(seat),
        state: 'working',
        station: station.id,
        targetStation: null,
        path: [],
        position: { ...station.anchor },
      })
    }
  }
  assert.ok(seat > 0, '这个场景里应当有这类站点，否则测试自己就没意义了')
  return seat
}

/** 被测的那位：站着、没单、需求都满足（不然先触发吃饭/睡觉/休息，走不到座位这一档）。 */
function subjectOf(world) {
  const agent = world.agents[0]
  agent.state = 'idle'
  agent.station = null
  agent.targetStation = null
  agent.path = []
  agent.needs = { hunger: 90, energy: 90, social: 90 }
  return agent
}

function placeOf(world, agent) {
  const place = world.places.find((row) => row.id === agent.placeId)
  assert.ok(place, '角色所在地点必须能查回来')
  return place
}

test('R527：想干活但一个空位都没有 → 等一会儿，并且去目的地附近等', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  const hangoutBefore = { ...agent.hangout }

  fillSeats(world, ['code', 'review', 'research', 'compute'])

  const intent = chooseLife(world, agent)
  assert.equal(intent?.purpose, 'rest', '没座位时该"等着"，而不是装作能干活')
  assert.equal(intent?.stationId, null, '等待没有座位——普通 rest 一定带站点')
  assert.ok(intent.ticks >= 30 && intent.ticks <= 60, '等待时长应当在 30~60 tick，实际 ' + String(intent.ticks))

  const command = selfLifeCommands(world).find((row) => row.agentId === agent.id)
  assert.equal(command?.activity, 'rest', '复用 rest，不新增 purpose/状态')
  assert.equal(command?.purpose, 'rest')
  assert.equal(command?.stationId, undefined)

  const gap = distance(agent.hangout, placeOf(world, agent).spawn)
  assert.ok(gap < 8, '等待点应当在目的地的出生点附近（< 8），实际 ' + gap.toFixed(2))
  assert.notDeepEqual(agent.hangout, hangoutBefore, '不能还站在原来的歇脚点上')
})

test('R527：想学习但一个空位都没有 → 同样是等待', () => {
  const world = makeWorld()
  world.tick = 20 * 60
  const agent = subjectOf(world)
  fillSeats(world, ['code', 'research'])

  const intent = chooseLife(world, agent)
  assert.equal(intent?.purpose, 'rest')
  assert.equal(intent?.stationId, null)
  assert.ok(intent.ticks >= 30 && intent.ticks <= 60)
})

test('R527：想社交但椅子全满 → 也在目的地附近等', () => {
  const world = makeWorld()
  world.tick = 20 * 60
  const agent = subjectOf(world)
  agent.needs = { hunger: 90, energy: 90, social: 10 }
  fillSeats(world, ['converse', 'code', 'research'])

  const intent = chooseLife(world, agent)
  assert.equal(intent?.purpose, 'rest', '社交坐不下时不该原地发呆')
  assert.equal(intent?.stationId, null)
  const commands = selfLifeCommands(world)
  const command = commands.find((row) => row.agentId === agent.id)
  assert.equal(command?.purpose, 'rest')
  assert.ok(distance(agent.hangout, placeOf(world, agent).spawn) < 8)
})

test('R527：有空位时仍是正常意图，不进等待分支', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  const hangoutBefore = { ...agent.hangout }

  const intent = chooseLife(world, agent)
  assert.equal(intent?.purpose, 'work', '有空位就该正常去干活')
  assert.ok(intent?.stationId, '正常意图必须带着要去的那一站')

  const command = selfLifeCommands(world).find((row) => row.agentId === agent.id)
  assert.equal(command?.activity, 'work')
  assert.ok(command?.stationId)
  assert.deepEqual(agent.hangout, hangoutBefore, '没抢不到座位这回事，就不该动他的歇脚点')
})

test('R527：这地方压根没有他要去的地方 → 不发等待意图，不排队', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  const hangoutBefore = { ...agent.hangout }
  // 没有任何设施 = 没有"想去哪"，等待就失去意义（站着发呆反而是对的）。
  world.stations = []

  assert.equal(chooseLife(world, agent), null)
  assert.equal(selfLifeCommands(world).length, 0, '没有目标的人不该自己派活')
  assert.deepEqual(agent.hangout, hangoutBefore)
})

test('R527：同一世界重复调用一致，等待时长在窗口内不抖', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  fillSeats(world, ['code', 'review', 'research', 'compute'])

  const first = selfLifeCommands(world).find((row) => row.agentId === agent.id)
  const spot = { ...agent.hangout }
  const second = selfLifeCommands(world).find((row) => row.agentId === agent.id)
  assert.deepEqual(second, first, '同一个 tick 调两次必须一模一样')
  assert.deepEqual(agent.hangout, spot, '重复调用不该让等待点漂移')

  // 槽长 60：扫两个窗口，值只在窗口边界变——每 tick 重抽的话这里会变几十次。
  const values = []
  for (let tick = WORK_TIME; tick < WORK_TIME + 120; tick += 1) {
    world.tick = tick
    const intent = chooseLife(world, agent)
    values.push(intent.ticks)
  }
  let changes = 0
  for (let i = 1; i < values.length; i += 1) if (values[i] !== values[i - 1]) changes += 1
  assert.ok(changes <= 3, '120 tick 里最多跨 3 次窗口边界，实际变了 ' + String(changes) + ' 次')
  assert.deepEqual(agent.hangout, spot, '等待点在整段等待里不该挪')
})

test('R527：等待真的会把人走过去，而不是留在原地', () => {
  const world = makeWorld()
  world.tick = WORK_TIME
  const agent = subjectOf(world)
  // 真实现场：什么位子都没有（有空的休息位他会顺势去坐着，那就不是"原地等"这条分支了）。
  fillSeats(world, ['code', 'review', 'research', 'compute', 'converse', 'rest'])
  const spawn = placeOf(world, agent).spawn
  const before = distance(agent.position, spawn)

  for (let i = 0; i < 120; i += 1) step(world, selfLifeCommands(world))
  const after = distance(agent.position, spawn)
  assert.ok(after < 8, '两小时游戏时间里应当走到目的地附近，实际还差 ' + after.toFixed(2))
  assert.ok(after < before, '至少要比原来更靠近目的地')
})

test('R527-2：夜里没床位也去休息区排队（不是站着发呆）', () => {
  const world = makeWorld()
  // 23:30 才是夜里（NIGHT_FROM=23:00）；22:30 系统还认为该学习。
  world.tick = 23 * 60 + 30
  const me = subjectOf(world)
  fillSeats(world, ['rest'])
  const options = intentOptions(world, me)
  const waiting = options.find((option) => option.intent?.reason?.includes('等着'))
  assert.ok(waiting, '没床位时应当出现等待意图，实际：' + JSON.stringify(options.map((o) => o.intent?.reason ?? null)))
  assert.equal(waiting.intent?.purpose, 'rest')
  assert.equal(waiting.intent?.stationId, null, '等待意图不该占座')
})

