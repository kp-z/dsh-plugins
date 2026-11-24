/**
 * 日志投影的形状：按前端两个校验器（mb / Dx）与它们的报错文案写成断言。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { logsOf } from '../lib/adapters/slowvale/logs.js'

const events = [
  { seq: 11, tick: 100, type: 'agent.intent', payload: { agentId: 'a' } },
  { seq: 12, tick: 101, type: 'task.changed', payload: { id: 't1' } },
]

test('recent/catch-up 的信封与条目字段齐全', () => {
  const { recent, catchUp } = logsOf({ datetime: '2026-03-14T22:25:00', events })

  assert.ok(Array.isArray(recent.entries) && recent.entries.length === 2)
  assert.ok(Array.isArray(recent.card_upserts) && recent.card_upserts.length === 1)
  assert.equal(recent.has_more, false)
  assert.equal(recent.next_record_entry_id, 12)

  assert.equal(catchUp.outcome, 'page')
  assert.ok(Array.isArray(catchUp.entries) && catchUp.entries.length === 2)
  assert.equal(catchUp.target_record_entry_id, 12)
  assert.ok(Number(catchUp.next_record_entry_id) <= Number(catchUp.target_record_entry_id))
})

test('条目的硬约束：id>0 / kind=event / 有 card 与 game_time', () => {
  const { recent } = logsOf({ datetime: '2026-03-14T22:25:00', events })
  for (const entry of recent.entries) {
    assert.ok(Number(entry.record_entry_id) > 0)
    assert.equal(entry.kind, 'event')
    assert.equal(typeof entry.card_id, 'string')
    assert.equal(typeof entry.source_aggregate_id, 'string')
    assert.equal(typeof entry.game_time.current_datetime, 'string')
  }
  const card = recent.card_upserts[0]
  assert.deepEqual(Object.keys(card).sort(), ['aggregate_id', 'card_id', 'game_time', 'title', 'viewer_role'])
  assert.ok(['initiator', 'participant', 'observer'].includes(card.viewer_role))
})

test('没有事件时给合法空态，而不是缺字段', () => {
  const { recent, catchUp } = logsOf({ datetime: '2026-03-14T22:25:00', events: [] })
  assert.deepEqual(recent.entries, [])
  assert.deepEqual(recent.card_upserts, [])
  assert.equal(catchUp.outcome, 'page')
})
