import assert from 'node:assert/strict'
import { test } from 'node:test'

import { logsOf } from '../lib/adapters/slowvale/logs.js'

const input = {
  datetime: '2026-01-05T13:51:00',
  dayNumber: 7,
  epoch: 'epoch-w1',
  events: [
    { seq: 11, tick: 100, type: 'agent.intent', payload: { agentId: 'agent-1' } },
    { seq: 12, tick: 101, type: 'task.changed', payload: {} },
  ],
}

/** 前端 Zn/Pn 的硬校验：缺 feed_head / realtime_epoch 就整块失败。 */
test('recent 必须带 feed_head_record_entry_id 与 realtime_epoch', () => {
  const { recent } = logsOf(input)
  assert.ok(Number.isSafeInteger(recent.feed_head_record_entry_id))
  assert.ok(Number(recent.feed_head_record_entry_id) >= 0)
  assert.equal(typeof recent.realtime_epoch, 'string')
  assert.ok(String(recent.realtime_epoch).length > 0)
  assert.equal(recent.realtime_epoch, 'epoch-w1')
  assert.ok(Array.isArray(recent.entries))
  assert.ok(Array.isArray(recent.card_upserts))
  assert.equal(recent.has_more, false)
})

/** 前端 eb()：game_time.day_number 必须是正整数，否则「缺少有效 day_number」。 */
test('每条 entry 与每张 card 都要有正整数 day_number', () => {
  const { recent } = logsOf(input)
  for (const entry of recent.entries) {
    assert.equal(entry.game_time.current_datetime, input.datetime)
    assert.ok(Number.isSafeInteger(entry.game_time.day_number))
    assert.ok(Number(entry.game_time.day_number) > 0)
  }
  for (const card of recent.card_upserts) {
    assert.equal(card.game_time.current_datetime, input.datetime)
    assert.ok(Number(card.game_time.day_number) > 0)
  }
})

/** 我们的世界事件没有 decision/phase，所以必须走 standalone（event 会被要求二选一）。 */
test('条目用 standalone + notice，避开前端对 event 的 decision/phase 要求', () => {
  const { recent } = logsOf(input)
  for (const entry of recent.entries) {
    assert.equal(entry.kind, 'standalone')
    assert.equal(typeof entry.item, 'object')
    assert.equal(entry.item.record_type, 'system_notice')
    assert.equal(typeof entry.item.content, 'string')
    assert.ok(!('decision' in entry))
    assert.ok(!('phase' in entry))
  }
})

test('没有事件时给合法空态，但两个硬字段仍在', () => {
  const { recent, catchUp } = logsOf({ ...input, events: [] })
  assert.deepEqual(recent.entries, [])
  assert.deepEqual(recent.card_upserts, [])
  assert.equal(recent.feed_head_record_entry_id, 0)
  assert.equal(recent.realtime_epoch, 'epoch-w1')
  assert.equal(catchUp.outcome, 'page')
})
