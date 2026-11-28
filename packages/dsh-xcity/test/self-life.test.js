/**
 * R476：没活干的时候，角色按钟点自己安排生活。
 *
 * 守两件事：
 * 1. 上班时段、且没有 ready 工单时，空闲的人自己领一份"去工位干活"；
 * 2. 有工单 / 非上班时间 / 正在忙的人，一律不抢。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { isWorkMinute, selfLifeCommands } from '../lib/sim/life.js'
import { step } from '../lib/sim/step.js'

function makeWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.office',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets: [],
  })
}

test('作息：09:00-12:00 与 14:00-18:00 才算上班', () => {
  assert.equal(isWorkMinute(9 * 60), true)
  assert.equal(isWorkMinute(11 * 60 + 59), true)
  assert.equal(isWorkMinute(12 * 60), false, '午休不算')
  assert.equal(isWorkMinute(13 * 60), false)
  assert.equal(isWorkMinute(14 * 60), true)
  assert.equal(isWorkMinute(17 * 60 + 59), true)
  assert.equal(isWorkMinute(18 * 60), false, '下班了')
  assert.equal(isWorkMinute(2 * 60), false)
})

test('上班时段：空闲角色自己发起去工位干活，来源标记为 self', () => {
  const world = makeWorld()
  world.tick = 10 * 60
  const commands = selfLifeCommands(world)
  assert.ok(commands.length > 0, '上班时间应当有人自己找活')
  for (const command of commands) {
    assert.equal(command.kind, 'agentActivity')
    assert.equal(command.activity, 'work')
    assert.ok(command.ticks > 0)
    assert.equal(command.trigger.kind, 'self')
  }
  // 交给 step 之后真的开始走：不是只产生一条没人执行的数据。
  step(world, commands)
  const walking = world.agents.filter((agent) => agent.state === 'walking' && agent.targetStation !== null)
  assert.ok(walking.length > 0, '至少有人已经在去工位路上')
})

test('R532：夜里只安排困的人睡，睡饱的人不占床', () => {
  // 旧断言是"夜里所有人 purpose=sleep"。R532 起夜间分支带 needs.energy < 60 门槛，
  // 而 DEFAULT_NEEDS.energy=80，所以"所有人睡"不再成立——不是行为变差，正是要修的那件事：
  // 不缺觉的人也睡，22 张床整夜满，一张床一晚只能服务一个人。这里把两种人各断言一次。
  const night = makeWorld()
  night.tick = 2 * 60
  const sleepy = night.agents[0]
  sleepy.needs = { hunger: 90, energy: 40, social: 90 }
  const rested = night.agents.slice(1)
  assert.ok(rested.length > 0, '办公室里应当不止一个角色，否则这条测试没有对照')
  for (const agent of rested) agent.needs = { hunger: 90, energy: 90, social: 90 }

  const commands = selfLifeCommands(night)
  const sleepCommand = commands.find((command) => command.agentId === sleepy.id)
  assert.equal(sleepCommand?.activity, 'rest', '睡觉仍走 rest，不新增状态')
  assert.equal(sleepCommand?.purpose, 'sleep', 'energy<60 的人在夜里该去睡')
  assert.equal(sleepCommand?.ticks, 300, '一次睡 300 tick：480 会让一张床一晚只服务一个人')
  for (const agent of rested) {
    const command = commands.find((row) => row.agentId === agent.id)
    assert.notEqual(command?.purpose, 'sleep', 'energy≥60 的人夜里不该去睡，实际：' + JSON.stringify(command?.purpose ?? null))
    assert.ok(command !== undefined, '不睡不等于不安排：他应当落到后面的档（夜里 → 学习）')
  }
})

test('有 ready 工单时把人留给调度器', () => {
  const busy = makeWorld()
  busy.tick = 10 * 60
  busy.tasks.push({
    ...busy.tasks[0],
    id: 'task-waiting',
    status: 'ready',
    owner: null,
    carrying: null,
  })
  assert.deepEqual(selfLifeCommands(busy), [], '有单等人领时不能先占住人')
})

test('正在忙 / 手上有单 / 已有活动的人不会被重复安排', () => {
  const world = makeWorld()
  world.tick = 10 * 60
  for (const agent of world.agents) {
    agent.carrying = 'task-fake'
  }
  assert.deepEqual(selfLifeCommands(world), [])
})
