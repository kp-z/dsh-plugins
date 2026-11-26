import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'

import { logsOf } from '../lib/adapters/slowvale/logs.js'
import { createSlowvaleBridge } from '../lib/adapters/slowvale/server.js'
import { projectSnapshot } from '../lib/adapters/slowvale/project.js'

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

test('活动开始和完成分别有前端可消费的 phase', () => {
  const { recent } = logsOf({ ...base, activities: [activity()] })
  const entry = recent.entries[0]
  assert.ok(entry.record_entry_id > 0)
  assert.equal(entry.kind, 'event')
  assert.equal(entry.phase.kind, 'activity')
  assert.equal(entry.phase.activity_id, 'act-7')
  assert.equal(entry.phase.activity_type, 'ProgrammerActivity')
  assert.equal(entry.phase_id, 'act-7')
  assert.equal(entry.phase.items[0].lifecycle, 'start')
  assert.equal(recent.entries[1].phase.items[0].lifecycle, 'complete')
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
  assert.equal(entry.card_id, 'card.town.3')
})

test('三类条目按时间排，旧记录 id 独立于数组位置', () => {
  const input = {
    ...base,
    activities: [activity({ id: 'act-9', startedAt: 100, endsAt: 130, endedAt: 130, trigger: { kind: 'player', text: '去上班' } })],
    notices: [{ seq: 1, tick: 10, type: 'world.reset', text: '小镇重新开始了。' }],
  }
  const first = logsOf(input).recent.entries
  assert.deepEqual(first.map((entry) => entry.record_entry_id), [8, 37, 38, 39], '公告在前，决策与阶段在后')
  assert.equal(first[0].kind, 'standalone')
  assert.ok(first[1].decision !== undefined)
  assert.ok(first[2].phase !== undefined)
  const again = logsOf(input).recent.entries
  assert.deepEqual(again.map((entry) => entry.record_entry_id), [8, 37, 38, 39], '重复投影 id 不变')
})

test('时间按 tick 换算：1 tick = 1 游戏分钟', () => {
  const { recent } = logsOf({ ...base, activities: [activity({ id: 'act-60', startedAt: 60, endsAt: 90, endedAt: 90 })] })
  assert.equal(recent.entries[0].game_time.current_datetime, '2026-01-01T01:00:00')
})

test('空世界：合法空态，但两个硬字段仍在', () => {
  const { recent, catchUp } = logsOf({ ...base, activities: [] })
  assert.deepEqual(recent.entries, [])
  assert.equal(recent.feed_head_record_entry_id, 0)
  assert.equal(recent.realtime_epoch, 'epoch-w1')
  assert.equal(catchUp.outcome, 'page')
})

test('补拉不改写开始记录，快照与日志使用同一水位', () => {
  const active = logsOf({ ...base, activities: [activity({ status: 'active' })] }).recent
  const world = { id: 'w1', name: '测试', tick: 40, agents: [], activities: [activity()] }
  const { recent, catchUp } = logsOf({ ...base, ...world, query: new URLSearchParams({
    after_record_entry_id: String(active.feed_head_record_entry_id), realtime_epoch: base.epoch,
  }) })
  assert.deepEqual(recent.entries[0], active.entries[0])
  assert.equal(catchUp.realtime_epoch, base.epoch)
  assert.deepEqual(catchUp.entries, [recent.entries[1]])
  assert.equal(catchUp.next_record_entry_id, recent.feed_head_record_entry_id)
  assert.equal(projectSnapshot(world, {
    worldId: 'w1', viewerRoleId: '', place: 'company', startDate: base.startDate,
  }).feed_head_record_entry_id, recent.feed_head_record_entry_id)
})

test('历史查询按日期窗口和复合游标翻页', () => {
  const input = { ...base, activities: [activity({ trigger: { kind: 'task', text: '巡检' } })] }
  const first = logsOf({ ...input, query: new URLSearchParams({
    from_game_time: '2026-01-01T00:00:00', before_game_time: '2026-01-01T00:30:00', limit: '1',
  }) }).recent
  const second = logsOf({ ...input, query: new URLSearchParams({
    since_game_time: first.updated_until_game_time,
    since_record_entry_id: String(first.page_end_record_entry_id), before_game_time: '2026-01-01T00:30:00',
  }) }).recent
  assert.equal(first.has_more, true)
  assert.ok(first.entries[0].decision)
  assert.deepEqual(second.entries.map((e) => e.phase.items[0].lifecycle), ['start'])
  assert.equal(second.has_more, false)
})

test('真实 HTTP 日志路由：历史分页、快照水位及旧 epoch 重置', async () => {
  const world = { id: 'w1', name: '测试', tick: 40, agents: [{ id: 'agent-1', name: '阿金' }], activities: [activity()] }
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1', port: 0, assetsDir: '.', pushMs: 0,
    account: { email: 'test@example.invalid', password: 'test' },
    opts: { worldId: 'w1', viewerRoleId: 'agent-1', place: 'company', startDate: base.startDate },
    getWorld: () => world,
  })
  try {
    const get = async (path) => {
      const res = await fetch('http://127.0.0.1:' + bridge.port + '/api/game/' + path)
      assert.equal(res.status, 200)
      return res.json()
    }
    const snapshot = await get('state/world?role_id=agent-1')
    assert.equal(snapshot.clock.game_time.current_datetime, '2026-01-01T00:40:00')
    const first = await get('logs/recent?role_id=agent-1&limit=1')
    assert.equal(first.realtime_epoch, snapshot.cursor.epoch)
    assert.equal(first.feed_head_record_entry_id, snapshot.feed_head_record_entry_id)
    assert.equal(first.entries[0].phase_id, 'act-7')
    assert.deepEqual(first.card_upserts[0].game_time, first.entries[0].game_time)
    assert.equal(first.card_upserts[0].game_time.modern_time, '00:10')
    assert.equal(first.has_more, true)
    const query = new URLSearchParams({ role_id: 'agent-1', realtime_epoch: first.realtime_epoch,
      after_record_entry_id: String(first.page_end_record_entry_id) })
    const next = await get('logs/catch-up?' + query)
    assert.deepEqual(next.entries.map((e) => e.phase.items[0].lifecycle), ['complete'])
    assert.equal(next.next_record_entry_id, first.feed_head_record_entry_id)
    query.set('realtime_epoch', base.epoch)
    const stale = await get('logs/catch-up?' + query)
    assert.equal(stale.outcome, 'reset_required')
    assert.equal(stale.realtime_epoch, snapshot.cursor.epoch)
    assert.deepEqual(stale.entries, [])
  } finally {
    await bridge.close()
  }
})

test('裁剪和晚完成不会重编号，冻结目标不会误吃后续记录', () => {
  const prior = activity({ id: 'act-6', startedLogSeq: 1, endedLogSeq: 2, startedAt: 1, endedAt: 3 })
  const current = activity({ status: 'active', startedLogSeq: 3 })
  const before = logsOf({ ...base, activities: [prior, current], logSeq: 3 }).recent
  const later = activity({ id: 'act-8', status: 'active', startedAt: 40, startedLogSeq: 4 })
  const completed = { ...current, status: 'completed', endedAt: 40, endedLogSeq: 5 }
  const input = { ...base, activities: [completed, later], logSeq: 6 }
  const { recent, catchUp } = logsOf({ ...input, query: new URLSearchParams({
    after_record_entry_id: String(before.feed_head_record_entry_id), limit: '1',
  }) })
  assert.deepEqual(recent.entries[0], before.entries.at(-1))
  assert.equal(catchUp.entries[0].phase_id, 'act-8')
  assert.equal(catchUp.has_more, true)
  const next = logsOf({ ...input, activities: [...input.activities, activity({ id: 'act-9', status: 'active', startedAt: 41, startedLogSeq: 7 })], logSeq: 7,
    query: new URLSearchParams({ after_record_entry_id: String(catchUp.next_record_entry_id), target_record_entry_id: String(catchUp.target_record_entry_id) }),
  }).catchUp
  assert.deepEqual(next.entries.map((e) => e.phase.items[0].lifecycle), ['complete'])
  assert.equal(next.next_record_entry_id, recent.feed_head_record_entry_id)
})

test('持有 SSE 的客户端可在日志水位变化后按游标补拉', async () => {
  const world = { id: 'internal-town', name: '测试', tick: 40, agents: [{ id: 'agent-1', name: '阿金' }], activities: [] }
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1', port: 0, assetsDir: '.', pushMs: 20,
    account: { email: 'test@example.invalid', password: 'test' },
    opts: { worldId: 'w1', viewerRoleId: 'agent-1', place: 'company', startDate: base.startDate },
    getWorld: () => world,
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  const root = 'http://127.0.0.1:' + bridge.port + '/api/game/'
  try {
    const response = await fetch(root + 'stream', { signal: controller.signal })
    assert.equal(response.status, 200)
    let input = ''
    let lastCursor
    let logSignal
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      input += chunk
      let end
      while ((end = input.indexOf('\n\n')) >= 0) {
        const frame = input.slice(0, end)
        input = input.slice(end + 2)
        if (!frame.startsWith('event: ')) continue
        const [name, body] = frame.split('\n')
        const data = JSON.parse(body.slice(6))
        if (name === 'event: connected') {
          assert.equal(data.feed_head_record_entry_id, 0)
          world.activities.push(activity({ startedLogSeq: 1, endedLogSeq: 2 }))
        }
        if (data.kind === 'log_resync') {
          assert.deepEqual(data.prev, lastCursor)
          logSignal = data
          break
        }
        lastCursor = data.cursor
      }
      if (logSignal !== undefined) break
    }
    assert.deepEqual(logSignal.route, { world_id: 'w1', broadcast: false, role_ids: ['agent-1'], scenes: [] })
    assert.equal(logSignal.payload_gz, null)
    const query = new URLSearchParams({ role_id: 'agent-1', realtime_epoch: logSignal.cursor.epoch, after_record_entry_id: '0' })
    const page = await (await fetch(root + 'logs/catch-up?' + query)).json()
    assert.deepEqual(page.entries.map((entry) => entry.phase.items[0].lifecycle), ['start', 'complete'])
  } finally {
    clearTimeout(timer)
    controller.abort()
    await bridge.close()
  }
})

test('同一 SSE 连接获得活动开始和结束徽章，无整页重同步', async () => {
  const role = { id: 'agent-1', name: '阿金' }
  const world = { id: 'w1', name: '测试', tick: 40, agents: [role], activities: [] }
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1', port: 0, assetsDir: '.', pushMs: 20,
    account: { email: 'test@example.invalid', password: 'test' },
    opts: { worldId: 'w1', viewerRoleId: role.id, place: 'company', startDate: base.startDate },
    getWorld: () => world,
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const stream = await fetch('http://127.0.0.1:' + bridge.port + '/api/game/stream', { signal: controller.signal })
    let buffer = ''
    let previous
    let activeCount = 0
    for await (const chunk of stream.body.pipeThrough(new TextDecoderStream())) {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (!frame.startsWith('event: ')) continue
        const [name, body] = frame.split('\n')
        const data = JSON.parse(body.slice(6))
        if (name === 'event: connected') {
          const scene = await (await fetch('http://127.0.0.1:' + bridge.port + '/api/game/state/scene?scene=company')).json()
          assert.equal(scene.cursor.epoch, data.cursor.epoch)
          assert.ok(scene.cursor.seq < world.tick, '场景不能用世界 tick 跳过后续状态增量')
          role.activityId = 'act-7'
          world.activities.push(activity({ status: 'active', taskAttemptId: 'attempt-1' }))
        } else {
          assert.equal(name, 'event: update')
          assert.deepEqual(data.prev, previous)
        }
        previous = data.cursor
        if (data.kind !== 'state') continue
        const update = JSON.parse(gunzipSync(Buffer.from(data.payload_gz, 'base64')).toString())
        if (update.part !== 'role_public_status') continue
        assert.equal(update.key, role.id)
        assert.deepEqual(data.route, { world_id: 'w1', broadcast: true, role_ids: [], scenes: [] })
        if (update.payload.status === 'online') {
          activeCount += 1
          assert.equal(update.payload.active_activity.description, '干活')
          assert.equal(update.payload.active_activity.duration_seconds, undefined)
          delete role.activityId
        } else {
          assert.equal(activeCount, 1)
          assert.deepEqual(update.payload, { status: 'offline' })
          return
        }
      }
    }
    assert.fail('没有收到活动结束增量')
  } finally {
    clearTimeout(timer)
    controller.abort()
    await bridge.close()
  }
})
