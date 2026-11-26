/**
 * R481：学习结算。
 *
 * 两件事要守住：
 * 1. 只有 purpose=study 的完成活动才结算（日常干活不算）；
 * 2. 同一个 activityId 只加一次 XP，技能名只并集一次。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { awardStudyXp } from '../lib/persona/study.js'
import { startActivity } from '../lib/sim/activity.js'
import { step } from '../lib/sim/step.js'
import { createWorld } from '../lib/world/create.js'

function makeWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({ content, scene: 'scene.office', name: 'study', createdAt: '2026-01-01T00:00:00.000Z', taskSets: [] })
}

function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial).map(([id, persona]) => [id, { xp: 0, skills: [], ...persona }]))
  return {
    map,
    list: () => [...map.values()],
    get: (id) => map.get(id) ?? null,
    upsert: (input) => {
      const previous = map.get(input.id) ?? { xp: 0, skills: [] }
      const next = { ...previous, ...input, skills: input.skills ?? previous.skills, xp: input.xp ?? previous.xp }
      map.set(input.id, next)
      return next
    },
    addXp: (id, amount) => {
      const persona = map.get(id)
      if (persona === undefined) return null
      persona.xp += amount
      return persona
    },
    linkTask: () => null,
    awardTask: () => null,
    save: () => {},
  }
}

test('完成一次学习：技能并集 +1 XP；同一个 activityId 不重复', () => {
  const store = fakeStore({ captain: { xp: 0, skills: [] } })
  const seen = new Set()
  assert.equal(awardStudyXp(store, 'captain', { activityId: 'act-1', skill: 'research' }, seen), true)
  assert.deepEqual(store.get('captain').skills, ['research'])
  assert.equal(store.get('captain').xp, 1)

  assert.equal(awardStudyXp(store, 'captain', { activityId: 'act-1', skill: 'research' }, seen), false)
  assert.equal(store.get('captain').xp, 1)

  assert.equal(awardStudyXp(store, 'captain', { activityId: 'act-2', skill: 'code' }, seen), true)
  assert.deepEqual(store.get('captain').skills, ['research', 'code'])
  assert.equal(store.get('captain').xp, 2)
})

test('没有 persona / 空 activityId / 空技能：不报错，不乱加', () => {
  const store = fakeStore({})
  const seen = new Set()
  assert.equal(awardStudyXp(store, 'nobody', { activityId: 'act-1', skill: 'research' }, seen), false)
  assert.equal(awardStudyXp(store, 'captain', { activityId: '', skill: 'research' }, seen), false)
  const withPersona = fakeStore({ captain: { xp: 0, skills: [] } })
  assert.equal(awardStudyXp(withPersona, 'captain', { activityId: 'act-9', skill: null }, seen), true)
  assert.deepEqual(withPersona.get('captain').skills, [])
  assert.equal(withPersona.get('captain').xp, 1)
})

test('活动完成事件带 kind/skill/purpose（study）', () => {
  const world = makeWorld()
  world.tick = 10 * 60
  const agent = world.agents[0]
  agent.activityPurpose = 'study'
  const station = world.stations[0]
  startActivity(world, agent, { kind: 'work', ticks: 5, skill: 'research', stationId: station.id })
  agent.activityUntil = world.tick

  const result = step(world, [])
  const event = result.events.find((item) => item.type === 'agent.state' && item.payload.status === 'completed')
  assert.ok(event, '完成活动应当发 agent.state')
  assert.equal(event.payload.agentId, agent.id)
  assert.equal(event.payload.kind, 'work')
  assert.equal(event.payload.skill, 'research')
  assert.equal(event.payload.purpose, 'study')
})

test('走 legacy 字段采纳的活动也带 skill（不能只测 startActivity 路径）', () => {
  const world = makeWorld()
  world.tick = 10 * 60
  const agent = world.agents[0]
  const station = world.stations[0]
  agent.state = 'working'
  agent.station = station.id
  agent.activityKind = 'work'
  agent.activityPurpose = 'study'
  agent.activitySkill = 'research'
  agent.activityUntil = world.tick + 5
  // 第一步：到站后被采纳成正式活动；第二步：过了结束 tick，完成并发出事件。
  step(world, [])
  world.tick = 10 * 60 + 10
  const result = step(world, [])
  const event = result.events.find((item) => item.type === 'agent.state' && item.payload.status === 'completed')
  assert.ok(event)
  assert.equal(event.payload.skill, 'research')
  assert.equal(event.payload.purpose, 'study')
})

test('日常干活（purpose=work）不进入学习结算：由 index 的过滤保证，事件里可区分', () => {
  const world = makeWorld()
  world.tick = 10 * 60
  const agent = world.agents[0]
  agent.activityPurpose = 'work'
  startActivity(world, agent, { kind: 'work', ticks: 5, skill: 'code', stationId: world.stations[0].id })
  agent.activityUntil = world.tick
  const result = step(world, [])
  const event = result.events.find((item) => item.type === 'agent.state' && item.payload.status === 'completed')
  assert.equal(event.payload.purpose, 'work')
})
