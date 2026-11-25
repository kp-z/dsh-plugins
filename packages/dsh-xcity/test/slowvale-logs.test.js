import assert from 'node:assert/strict'
import { test } from 'node:test'

import { logsOf } from '../lib/adapters/slowvale/logs.js'

const base = {
  datetime: '2026-01-01T08:00:00',
  dayNumber: 1,
  epoch: 'epoch-w1',
  startDate: '2026-01-01',
  nameOf: (id) => (id === 'agent-1' ? '阿金' : id),
  placeOf: (id) => (id === 'place:office.tech_company_1' ? { asset: 'company', name: '科技公司 · 办公室' } : null),
}

test('一段活动就是一条 event 条目，带 phase（前端要求的形状）', () => {
  const { recent } = logsOf({
    ...base,
    activities: [
      { id: 'act-7', agentId: 'agent-1', kind: 'work', skill: 'code', placeId: 'place:office.tech_company_1', status: 'completed', startedAt: 10, endsAt: 40, endedAt: 40 },
    ],
  })
  const entry = recent.entries[0]
  assert.ok(entry.record_entry_id > 0)
  assert.equal(entry.kind, 'event')
  assert.equal(entry.phase.kind, 'activity')
  assert.equal(entry.phase.activity_id, 'act-7')
  assert.equal(entry.phase.activity_type, 'ProgrammerActivity')
  assert.equal(entry.phase.status, 'completed')
  assert.equal(typeof entry.phase.is_viewer_activity, 'boolean')
  assert.ok(entry.game_time.current_datetime)
  assert.ok(entry.game_time.day_number > 0)
})

test('卡片按场所切，标题用场所名', () => {
  const { recent } = logsOf({
    ...base,
    activities: [
      { id: 'act-1', agentId: 'agent-1', kind: 'work', placeId: 'place:office.tech_company_1', status: 'completed', startedAt: 0, endsAt: 10 },
    ],
  })
  assert.equal(recent.card_upserts[0].card_id, 'card.place.company')
  assert.equal(recent.card_upserts[0].title, '科技公司 · 办公室')
})

test('条目 id 由活动身份派生：同一条活动重复投影得到同一个 id', () => {
  const activity = { id: 'act-42', agentId: 'agent-1', kind: 'visit', placeId: 'place:office.tech_company_1', status: 'active', startedAt: 5, endsAt: 60 }
  const first = logsOf({ ...base, activities: [activity] }).recent.entries[0].record_entry_id
  const second = logsOf({ ...base, activities: [{ ...activity }] }).recent.entries[0].record_entry_id
  assert.equal(first, 42)
  assert.equal(second, 42)
})

test('时间按 tick 换算：1 tick = 1 游戏分钟', () => {
  const { recent } = logsOf({
    ...base,
    activities: [
      { id: 'act-60', agentId: 'agent-1', kind: 'work', placeId: 'place:office.tech_company_1', status: 'completed', startedAt: 60, endsAt: 90 },
    ],
  })
  assert.equal(recent.entries[0].game_time.current_datetime, '2026-01-01T01:00:00')
})

test('空世界：合法空态，但两个硬字段仍在', () => {
  const { recent, catchUp } = logsOf({ ...base, activities: [] })
  assert.deepEqual(recent.entries, [])
  assert.equal(recent.feed_head_record_entry_id, 0)
  assert.equal(recent.realtime_epoch, 'epoch-w1')
  assert.equal(catchUp.outcome, 'page')
})
