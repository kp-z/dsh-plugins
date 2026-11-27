/**
 * R513：承诺要真的驱动行为。
 *
 * 现场：22 条 missed 里 0 条有交集——不是裁决误判，而是人许完愿照常上班/学习，
 * 从来没去赴约。这条测试钉住"临近到期的约定会变成一条高优先级的赴约意图"。
 *
 * R523：赴约成功率（实测三天 kept 3 / missed 4 = 43%）的两个堵点，各自钉一条：
 * 1. 只在"对方已经在 converse 站点上聊着"时才有座位 → 对方在工位上干活时干脆不出门；
 *    现在只要同一地点，就去对方所在 district 的会话座位等着（没空位退到同地点任意空位）；
 * 2. 窗口 180 撞上一个 90 tick 的活动加走路就只剩零头 → 放到 240；
 *    但对方在睡觉时不追（夜里闯休息区等不到人），这条必须显式判。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { APPOINTMENT_WINDOW, chooseLife, dueAppointmentOf, intentOptions } from '../lib/sim/life.js'

const content = new ContentRegistry()
content.loadAll(builtinPacks())
const OFFICE = { id: 'place:office.tech_company_1', name: 'Office', asset: 'company', spawn: { x: 480, z: 800 } }

const freshWorld = () => createWorld({ content, scene: 'scene.office', name: 'appt', maxAgents: 3, places: [OFFICE] })

/** 让两个人都闲着且不在任何站点上，方便谈"接下来做什么"。 */
const idleBoth = (world) => {
  for (const agent of world.agents) {
    agent.state = 'idle'
    agent.station = null
    agent.targetStation = null
    agent.path = []
    agent.activityUntil = undefined
    agent.carrying = null
    // 需求是 0–100（<35 才算低）：这里给满，避免"饿了要去吃饭"抢在赴约前面。
    agent.needs = { ...agent.needs, hunger: 100, energy: 100, social: 100 }
  }
}

/** 把人放到某一站上（模拟"他正在那儿干活/聊天/睡觉"）。 */
const putOn = (agent, station, patch) => {
  agent.station = station.id
  agent.targetStation = null
  agent.path = []
  Object.assign(agent, patch)
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

/** 赴约意图：理由里带"答应的"那一条（别的新档位将来加词也不会误抓）。 */
const appointmentOf = (options) => options.find((option) => (option.intent?.reason ?? '').includes('答应的'))
const stationById = (world, stationId) => world.stations.find((station) => station.id === stationId)

test('R513：还没进窗口的约定不算赴约', () => {
  const world = freshWorld()
  world.tick = 600
  const [me, peer] = world.agents
  me.commitments = [commitment('c1', peer.id, 600 + APPOINTMENT_WINDOW + 60)]
  assert.equal(dueAppointmentOf(world, me), null)
})

test('R513：进了窗口就挑最早到期的那个约', () => {
  const world = freshWorld()
  world.tick = 600
  const [me, peer, third] = world.agents
  me.commitments = [
    commitment('late', peer.id, 600 + APPOINTMENT_WINDOW - 10),
    commitment('early', third.id, 600 + 30),
  ]
  const picked = dueAppointmentOf(world, me)
  assert.equal(picked?.with, third.id)
})

test('R513：到点之前会出现一条"去找他"的高分意图', () => {
  const world = freshWorld()
  world.tick = 600
  idleBoth(world)
  const [me, peer] = world.agents
  peer.state = 'talking'
  peer.station = world.stations.find((station) => station.capabilities.includes('converse'))?.id ?? null
  me.commitments = [commitment('c1', peer.id, 600 + 60)]

  const options = intentOptions(world, me)
  const appointment = appointmentOf(options)
  assert.ok(appointment, '应该出现赴约意图，实际：' + JSON.stringify(options.map((o) => o.intent?.reason ?? null)))
  assert.equal(appointment.intent?.purpose, 'social')
  assert.ok(appointment.score >= 0.85, '赴约优先级要高于上班/学习')
})

test('R523：对方在工位上干活，也去他那个 district 的会话座位等着', () => {
  const world = freshWorld()
  world.tick = 600
  idleBoth(world)
  const [me, peer] = world.agents
  // district.1 的评审桌：既能干活也能聊，正是"他人坐在那儿忙"的典型现场。
  const workStation = world.stations.find((station) => station.district === 'district.1' && station.capabilities.includes('converse'))
  assert.ok(workStation)
  putOn(peer, workStation, { state: 'working', activityKind: 'work', activityPurpose: 'work', activityUntil: 700 })
  me.commitments = [commitment('c1', peer.id, 600 + 60)]

  const appointment = appointmentOf(intentOptions(world, me))
  assert.ok(appointment, '对方在干活也要去赴约')
  const seat = stationById(world, appointment.intent.stationId)
  assert.equal(seat.district, workStation.district, '要挑对方所在 district 的座位')
  assert.ok(seat.capabilities.includes('converse'))
  assert.notEqual(seat.id, workStation.id, '不能抢对方正坐着的椅子')
  // 真到决策口上也要赢过上班（0.9 vs 0.65）。
  assert.equal(chooseLife(world, me)?.purpose, 'social')
})

test('R523：对方所在 district 没有会话座位时，退到同地点任意空位', () => {
  const world = freshWorld()
  world.tick = 600
  idleBoth(world)
  const [me, peer] = world.agents
  // district.4 是开放工位区，整片没有 converse 座位。
  const workStation = world.stations.find((station) => station.district === 'district.4' && station.capabilities.includes('code'))
  assert.ok(workStation)
  assert.ok(!world.stations.some((station) => station.district === 'district.4' && station.capabilities.includes('converse')))
  putOn(peer, workStation, { state: 'working', activityKind: 'work', activityPurpose: 'work', activityUntil: 700 })
  me.commitments = [commitment('c1', peer.id, 600 + 60)]

  const appointment = appointmentOf(intentOptions(world, me))
  assert.ok(appointment, '没有同 district 的座位也要过去等')
  const seat = stationById(world, appointment.intent.stationId)
  assert.ok(seat.capabilities.includes('converse'))
  assert.equal(seat.placeId, me.placeId)
})

test('R523：对方在睡觉就不追', () => {
  const world = freshWorld()
  world.tick = 600
  idleBoth(world)
  const [me, peer] = world.agents
  const bed = world.stations.find((station) => station.capabilities.includes('rest'))
  assert.ok(bed)
  putOn(peer, bed, { state: 'sleeping', activityKind: 'rest', activityPurpose: 'sleep', activityUntil: 600 + 300 })
  me.commitments = [commitment('c1', peer.id, 600 + 60)]

  const options = intentOptions(world, me)
  assert.equal(appointmentOf(options), undefined, '对方睡着时不该出现赴约意图，实际：' + JSON.stringify(options.map((o) => o.intent?.reason ?? null)))
})

test('R523：对方只是歇脚（rest）不算睡觉，照样去等', () => {
  const world = freshWorld()
  world.tick = 600
  idleBoth(world)
  const [me, peer] = world.agents
  const bed = world.stations.find((station) => station.capabilities.includes('rest'))
  // 状态机里 rest 也是 state='sleeping'：只看状态会把"躺一会儿"误判成睡觉。
  putOn(peer, bed, { state: 'sleeping', activityKind: 'rest', activityPurpose: 'rest', activityUntil: 600 + 40 })
  me.commitments = [commitment('c1', peer.id, 600 + 60)]

  assert.ok(appointmentOf(intentOptions(world, me)), '歇脚的人还能被叫起来，别当他在睡')
})

test('R523：赴约窗口 240 分钟——239 在窗内、241 在窗外', () => {
  assert.equal(APPOINTMENT_WINDOW, 240)
  const world = freshWorld()
  world.tick = 600
  const [me, peer] = world.agents
  me.commitments = [commitment('in', peer.id, 600 + 239)]
  assert.equal(dueAppointmentOf(world, me)?.with, peer.id)
  me.commitments = [commitment('out', peer.id, 600 + 241)]
  assert.equal(dueAppointmentOf(world, me), null)
})

test('R523：同一个世界重复决策，赴约座位不变', () => {
  const world = freshWorld()
  world.tick = 600
  idleBoth(world)
  const [me, peer] = world.agents
  const workStation = world.stations.find((station) => station.district === 'district.1' && station.capabilities.includes('converse'))
  putOn(peer, workStation, { state: 'working', activityKind: 'work', activityPurpose: 'work', activityUntil: 700 })
  me.commitments = [commitment('c1', peer.id, 600 + 60)]

  const first = chooseLife(world, me)?.stationId
  assert.equal(chooseLife(world, me)?.stationId, first, '同一份世界两次决策必须同座')
  const twin = structuredClone(world)
  const twinMe = twin.agents.find((agent) => agent.id === me.id)
  assert.equal(chooseLife(twin, twinMe)?.stationId, first, '结构相同的世界也必须同座')
})
