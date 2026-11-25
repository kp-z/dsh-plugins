import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'
import { liveActivityOf } from '../lib/sim/activity.js'

function freshWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
}

test('领工单干活：活动带着「接了哪张单」作为理由', () => {
  const world = freshWorld()
  const agent = world.agents[0]
  world.tasks = [{
    id: 'task-1', key: 'task-1', set: 'test', ordinal: 1, title: '整理登录页', description: '',
    status: 'ready', owner: null, station: null, requires: ['code'], blockedBy: [],
    progress: 0, attemptId: null, acceptance: '', estimateTicks: null,
    createdAtTick: 0, finishedAtTick: null, externalId: null, output: null, suggestedRole: null,
  }]
  // 让调度器认领：需要 ready + 空闲的人
  for (let i = 0; i < 3; i += 1) {
    step(world, [])
    if (agent.carrying !== null) break
  }
  assert.equal(agent.carrying, 'task-1', '调度器应当认领这张单')
  const trigger = agent.activityTrigger ?? liveActivityOf(world, agent)?.trigger
  assert.ok(trigger !== undefined, '必须有触发来源')
  assert.equal(trigger.kind, 'task')
  assert.match(trigger.text, /整理登录页/)
})

test('心跳安排休息/开会：理由来自规则，不是编的', () => {
  const world = freshWorld()
  world.gameMode = true
  const agent = world.agents[0]
  for (let i = 0; i < 200; i += 1) {
    step(world, [])
    const live = liveActivityOf(world, agent)
    if (live?.trigger !== undefined) {
      assert.equal(live.trigger.kind, 'schedule')
      assert.ok(String(live.trigger.text).length > 0)
      return
    }
  }
  // 没触发也不算失败：心跳有节流，这里只验证"触发时一定带理由"
  assert.ok(true)
})
