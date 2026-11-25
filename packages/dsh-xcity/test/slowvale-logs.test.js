import assert from 'node:assert/strict'
import { test } from 'node:test'

import { logsOf } from '../lib/adapters/slowvale/logs.js'

const base = {
  datetime: '2026-01-01T08:00:00',
  dayNumber: 1,
  epoch: 'epoch-w1',
  startDate: '2026-01-01',
  notices: [],
  nameOf: (id) => (id === 'agent-1' ? '阿金' : id),
  placeOf: (id) => (id === 'place:office.tech_company_1' ? { asset: 'company', name: '科技公司 · 办公室' } : null),
}

const activity = (extra = {}) => ({
  id: 'act-7',
  agentId: 'agent-1',
  kind: 'work',
  skill: 'code',
  placeId: 'place:office.tech_company_1',
  status: 'completed',
  startedAt: 10,
  endsAt: 40,
  endedAt: 40,
  ...extra,
})

test('一段活动就是一条 event 条目，带 phase（前端要求的形状）', () => {
  const { recent } = logsOf({ ...base, activities: [activity()] })
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

test('有触发来源才出 decision，reason 用原话（不加工）', () => {
  const { recent } = logsOf({
    ...base,
    activities: [activity({ trigger: { kind: 'player', text: '去办公室工作' } })],
  })
  const decision = recent.entries.find((entry) => entry.decision !== undefined)
  assert.ok(decision !== undefined, '应当有 decision 条目')
  assert.equal(decision.kind, 'event')
  assert.equal(decision.decision.reason, '去办公室工作')
  assert.equal(decision.decision.source, 'player')
  assert.equal(decision.decision.record_id, 'act-7')
  // 同一个活动仍然有 phase 条目：决策与阶段是两条，各自可读
  assert.ok(recent.entries.some((entry) => entry.phase !== undefined))
})

test('没有触发来源就不出 decision —— 空白好过编一句话', () => {
  const { recent } = logsOf({ ...base, activities: [activity()] })
  assert.equal(recent.entries.filter((entry) => entry.decision !== undefined).length, 0)
})

test('公告是 standalone 条目（notice），卡片在小镇公告', () => {
  const { recent } = logsOf({
    ...base,
    activities: [],
    notices: [{ seq: 3, tick: 5, type: 'world.reset', text: '小镇重新开始了。' }],
  })
  const entry = recent.entries[0]
  assert.equal(entry.kind, 'standalone')
  assert.equal(entry.item.record_type, 'system_notice')
  assert.equal(entry.item.content, '小镇重新开始了。')
  assert.equal(entry.card_id, 'card.town')
})

test('三类条目按时间排，id 连续且稳定', () => {
  const input = {
    ...base,
    activities: [activity({ id: 'act-9', startedAt: 100, endsAt: 130, trigger: { kind: 'player', text: '去上班' } })],
    notices: [{ seq: 1, tick: 10, type: 'world.reset', text: '小镇重新开始了。' }],
  }
  const first = logsOf(input).recent.entries
  assert.deepEqual(first.map((entry) => entry.record_entry_id), [1, 2, 3], '公告在前，决策与阶段在后')
  assert.equal(first[0].kind, 'standalone')
  assert.ok(first[1].decision !== undefined)
  assert.ok(first[2].phase !== undefined)
  const again = logsOf(input).recent.entries
  assert.deepEqual(again.map((entry) => entry.record_entry_id), [1, 2, 3], '重复投影 id 不变')
})

test('时间按 tick 换算：1 tick = 1 游戏分钟', () => {
  const { recent } = logsOf({ ...base, activities: [activity({ id: 'act-60', startedAt: 60, endsAt: 90 })] })
  assert.equal(recent.entries[0].game_time.current_datetime, '2026-01-01T01:00:00')
})

test('空世界：合法空态，但两个硬字段仍在', () => {
  const { recent, catchUp } = logsOf({ ...base, activities: [] })
  assert.deepEqual(recent.entries, [])
  assert.equal(recent.feed_head_record_entry_id, 0)
  assert.equal(recent.realtime_epoch, 'epoch-w1')
  assert.equal(catchUp.outcome, 'page')
})
