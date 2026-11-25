import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  actorForSession,
  activityForEvent,
  smsReplyOf,
  textOfBlocks,
} from '../lib/adapters/slowvale/session-events.js'

const agents = [
  { id: 'agent-1', name: '阿金', boundAgentId: 'sub-1' },
  { id: 'agent-2', name: '小蓝', boundAgentId: null },
]

test('找角色：显式子 agent 绑定优先', () => {
  const actor = actorForSession({ agents, sessionId: 'sub-1', activeSessionId: 'other' })
  assert.equal(actor?.id, 'agent-1')
})

test('找角色：当前激活会话落到队长', () => {
  const actor = actorForSession({ agents, sessionId: 'main', activeSessionId: 'main' })
  assert.equal(actor?.id, 'agent-2')
})

test('找角色：xcity 绑定表兜底；认不出就是 null（普通会话不硬塞角色）', () => {
  const bound = actorForSession({
    agents,
    sessionId: 'xcity-lin',
    activeSessionId: 'main',
    characterOfSession: (id) => (id === 'xcity-lin' ? 'role.lin' : null),
    agentOfCharacter: (c) => (c === 'role.lin' ? 'agent-1' : null),
  })
  assert.equal(bound?.id, 'agent-1')
  assert.equal(actorForSession({ agents, sessionId: 'unrelated', activeSessionId: 'main' }), null)
  assert.equal(actorForSession({ agents, sessionId: '', activeSessionId: 'main' }), null)
})

const text = (t) => ({ type: 'text', text: t })

test('气泡文本：多段用空行分开，空段丢掉', () => {
  assert.equal(textOfBlocks([text('一'), text('  '), text('二')]), '一\n\n二')
  assert.equal(textOfBlocks([{ type: 'reasoning', text: '想' }]), '')
})

test('短信回执：只有在等回复且没过期才写回', () => {
  const blocks = [text('<xcity-reply>我这就去</xcity-reply>')]
  assert.equal(smsReplyOf({ blocks, askedAt: 1000, now: 2000, ttlMs: 5000 }), '我这就去')
  assert.equal(smsReplyOf({ blocks, askedAt: undefined, now: 2000, ttlMs: 5000 }), null)
  assert.equal(smsReplyOf({ blocks, askedAt: 1000, now: 9000, ttlMs: 5000 }), null)
})

test('干活映射：工具调用去工位、工具返回收工、别的什么都不做', () => {
  const call = activityForEvent({ type: 'assistant/message', blocks: [{ type: 'tool-call', name: 'read_file' }], agentId: 'agent-1', skillOf: () => 'research' })
  assert.deepEqual(call, { kind: 'agentActivity', agentId: 'agent-1', activity: 'work', ticks: 60, skill: 'research' })
  const done = activityForEvent({ type: 'tool/result', blocks: [], agentId: 'agent-1', skillOf: () => 'code' })
  assert.deepEqual(done, { kind: 'agentActivity', agentId: 'agent-1', activity: 'idle', ticks: 0 })
  assert.equal(activityForEvent({ type: 'assistant/message', blocks: [text('只是说话')], agentId: 'agent-1', skillOf: () => 'code' }), null)
  assert.equal(activityForEvent({ type: 'user/message', blocks: [], agentId: 'agent-1', skillOf: () => 'code' }), null)
})
