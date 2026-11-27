/**
 * R513：承诺要真的驱动行为。
 *
 * 现场：22 条 missed 里 0 条有交集——不是裁决误判，而是人许完愿照常上班/学习，
 * 从来没去赴约。这条测试钉住"临近到期的约定会变成一条高优先级的赴约意图"。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { APPOINTMENT_WINDOW, dueAppointmentOf, intentOptions } from '../lib/sim/life.js'

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

const commitment = (id, withId, dueTick) => ({
  id,
  with: withId,
  what: '一起把工单对一遍',
  dueTick,
  status: 'open',
  source: 'plan',
  createdAtTick: 0,
})

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
  const appointment = options.find((option) => (option.intent?.reason ?? '').includes('答应的'))
  assert.ok(appointment, '应该出现赴约意图，实际：' + JSON.stringify(options.map((o) => o.intent?.reason ?? null)))
  assert.equal(appointment.intent?.purpose, 'social')
  assert.ok(appointment.score >= 0.85, '赴约优先级要高于上班/学习')
})
