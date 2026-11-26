/**
 * R480：主动找玩家。
 *
 * 守四件事：
 * 1. 社交低/刚忙完才想发；白天才发；
 * 2. 限频：3 小时、2 条/天、换天重置；
 * 3. 睡着/对话中不打扰；同一 tick 不重复；
 * 4. step 真的发事件，tracker 能把 initiative 回复和玩家短信分开。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { REPLY_CLOSE, REPLY_OPEN } from '../lib/adapters/slowvale/reply.js'
import { createSmsReplyTracker } from '../lib/adapters/slowvale/session-events.js'
import { initiativePromptText } from '../lib/adapters/slowvale/respond-sms.js'
import { advanceInitiative } from '../lib/sim/initiative.js'
import { step } from '../lib/sim/step.js'
import { createWorld } from '../lib/world/create.js'

function worldWith({ tick = 600, social = 10, state = 'idle', activities = [] } = {}) {
  return {
    tick,
    paused: false,
    tasks: [],
    activities,
    agents: [
      {
        id: 'agent-1',
        name: '阿金',
        state,
        carrying: null,
        activityUntil: undefined,
        activityPurpose: undefined,
        needs: { energy: 80, hunger: 80, social },
      },
    ],
  }
}

function makeWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({ content, scene: 'scene.office', name: 'initiative', createdAt: '2026-01-01T00:00:00.000Z', taskSets: [] })
}

test('社交低、白天：想发，并写回限频字段', () => {
  const world = worldWith({ tick: 10 * 60, social: 10 })
  const intents = advanceInitiative(world)
  assert.equal(intents.length, 1)
  assert.equal(intents[0].agentId, 'agent-1')
  assert.equal(world.agents[0].lastInitiatedSmsTick, 600)
  assert.equal(world.agents[0].initiatedSmsCount, 1)
  assert.equal(world.agents[0].initiatedSmsDay, 0)
})

test('夜里/清晨不发：23:30 与 06:00 都为空', () => {
  assert.deepEqual(advanceInitiative(worldWith({ tick: 23 * 60 + 30, social: 0 })), [])
  assert.deepEqual(advanceInitiative(worldWith({ tick: 6 * 60, social: 0 })), [])
})

test('限频：当天 2 条后不再发；间隔不足 3 小时也不发', () => {
  const spent = worldWith({ tick: 10 * 60, social: 0 })
  spent.agents[0].initiatedSmsDay = 0
  spent.agents[0].initiatedSmsCount = 2
  assert.deepEqual(advanceInitiative(spent), [])

  const tooSoon = worldWith({ tick: 10 * 60, social: 0 })
  tooSoon.agents[0].lastInitiatedSmsTick = 10 * 60 - 60
  assert.deepEqual(advanceInitiative(tooSoon), [])
})

test('换天重置：第二天可以再发', () => {
  const world = worldWith({ tick: 1440 + 10 * 60, social: 0 })
  world.agents[0].initiatedSmsDay = 0
  world.agents[0].initiatedSmsCount = 2
  const intents = advanceInitiative(world)
  assert.equal(intents.length, 1)
  assert.equal(world.agents[0].initiatedSmsDay, 1)
  assert.equal(world.agents[0].initiatedSmsCount, 1)
})

test('睡着/对话中不发；同一 tick 不重复', () => {
  assert.deepEqual(advanceInitiative(worldWith({ tick: 10 * 60, social: 0, state: 'sleeping' })), [])
  assert.deepEqual(advanceInitiative(worldWith({ tick: 10 * 60, social: 0, state: 'talking' })), [])

  const world = worldWith({ tick: 10 * 60, social: 0 })
  assert.equal(advanceInitiative(world).length, 1)
  assert.equal(advanceInitiative(world).length, 0, '同一 tick 再调一次不能重复')
})

test('刚忙完：社交不低也会想说一声（读完成的活动）', () => {
  const world = worldWith({
    tick: 10 * 60,
    social: 80,
    activities: [{ id: 'a', agentId: 'agent-1', kind: 'work', skill: 'research', status: 'completed', startedAt: 540, endedAt: 590, endsAt: 590, stationId: null, placeId: 'scene.office' }],
  })
  const intents = advanceInitiative(world)
  assert.equal(intents.length, 1)
  assert.match(intents[0].reason, /忙完/)
})

test('step 把意图变成 agent.initiative 事件，并写回字段', () => {
  const world = makeWorld()
  world.tick = 10 * 60
  for (const agent of world.agents) agent.needs = { energy: 80, hunger: 80, social: 0 }
  const result = step(world, [])
  const event = result.events.find((item) => item.type === 'agent.initiative')
  assert.ok(event, 'step 应当发出 agent.initiative')
  assert.equal(typeof event.payload.agentId, 'string')
  assert.equal(typeof event.payload.reason, 'string')
  const agent = world.agents.find((item) => item.id === event.payload.agentId)
  assert.equal(agent.lastInitiatedSmsTick, 10 * 60)
  assert.equal(agent.initiatedSmsCount, 1)
})

test('tracker：initiative 回复带 kind，玩家的回执仍是 player-sms', () => {
  const tracker = createSmsReplyTracker(60_000, () => 1000)
  const text = '主动短信编号：xcity-init:s1:600'
  tracker.track('agent-1', 's1', text, 'initiative')
  tracker.observe('s1', 'user/message', { turn: 1 }, [{ type: 'text', text }])
  const reply = tracker.observe('s1', 'assistant/message', { turn: 1 }, [
    { type: 'text', text: REPLY_OPEN + '在呢' + REPLY_CLOSE },
  ])
  assert.equal(reply.reply.kind, 'initiative')
  assert.equal(reply.reply.text, '在呢')

  const player = createSmsReplyTracker(60_000, () => 1000)
  player.track('agent-1', 's1', '短信投递编号：xcity-sms:s1:n')
  player.observe('s1', 'user/message', { turn: 2 }, [{ type: 'text', text: '短信投递编号：xcity-sms:s1:n' }])
  const playerReply = player.observe('s1', 'assistant/message', { turn: 2 }, [
    { type: 'text', text: REPLY_OPEN + '收到' + REPLY_CLOSE },
  ])
  assert.equal(playerReply.reply.kind, 'player-sms')
})

test('主动短信 prompt 带上念头与格式要求', () => {
  const text = initiativePromptText('刚忙完一件事，想跟你说一声')
  assert.ok(text.includes('刚忙完一件事'))
  assert.ok(text.includes(REPLY_OPEN))
  assert.ok(text.includes('不超过 30 字'))
})
