/**
 * R480：主动短信的投递形状。
 *
 * 这段从 index 抽出来的原因：只测 sim 决定、不测"到底投了什么"，
 * 真机上就会用冷冷清清的 prompt 或错误的编号投递。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { deliverInitiative } from '../lib/adapters/slowvale/initiative-delivery.js'

function deps(overrides = {}) {
  const calls = { prompts: [], tracked: [], cancelled: 0, errors: [] }
  const base = {
    characterOf: () => 'captain',
    sessionOf: () => 'session-1',
    dayContext: () => ['09:20–10:40 在工位 22干活'],
    track: (agentId, sessionId, text, kind) => {
      calls.tracked.push({ agentId, sessionId, text, kind })
      return () => {
        calls.cancelled += 1
      }
    },
    prompt: async (payload) => {
      calls.prompts.push(payload)
    },
    onError: (message) => calls.errors.push(message),
    ...overrides,
  }
  return { deps: base, calls }
}

test('投递：唯一编号、当天经历、kind=initiative', async () => {
  const { deps: d, calls } = deps()
  const ok = await deliverInitiative('agent-1', '刚忙完一件事，想跟你说一声', 600, d)
  assert.equal(ok, true)
  assert.equal(calls.tracked.length, 1)
  assert.equal(calls.tracked[0].kind, 'initiative')
  assert.equal(calls.tracked[0].agentId, 'agent-1')
  assert.equal(calls.tracked[0].sessionId, 'session-1')
  const payload = calls.prompts[0]
  assert.equal(payload.requestId, 'xcity-init:session-1:600')
  assert.equal(payload.mode, 'queue')
  assert.ok(payload.content[0].text.includes('刚忙完一件事'))
  assert.ok(payload.content[0].text.includes('09:20–10:40 在工位 22干活'))
  assert.ok(payload.content[0].text.includes('主动短信编号：xcity-init:session-1:600'))
})

test('没绑定角色/会话：不投递、不登记', async () => {
  const noCharacter = deps({ characterOf: () => null })
  assert.equal(await deliverInitiative('agent-1', '想聊聊', 600, noCharacter.deps), false)
  assert.equal(noCharacter.calls.prompts.length, 0)
  assert.equal(noCharacter.calls.tracked.length, 0)

  const noSession = deps({ sessionOf: () => null })
  assert.equal(await deliverInitiative('agent-1', '想聊聊', 600, noSession.deps), false)
  assert.equal(noSession.calls.prompts.length, 0)
})

test('投递失败：取消登记、记错误、返回 false（不重试）', async () => {
  const { deps: d, calls } = deps({
    prompt: async () => {
      throw new Error('session busy')
    },
  })
  assert.equal(await deliverInitiative('agent-1', '想聊聊', 600, d), false)
  assert.equal(calls.cancelled, 1)
  assert.equal(calls.errors.length, 1)
  assert.match(calls.errors[0], /session busy/)
})

test('摘要失败：退回没有“你今天”的 prompt，短信照发', async () => {
  const { deps: d, calls } = deps({
    dayContext: () => {
      throw new Error('world gone')
    },
  })
  assert.equal(await deliverInitiative('agent-1', '想聊聊', 600, d), true)
  assert.ok(!calls.prompts[0].content[0].text.includes('你今天到目前为止'))
})
