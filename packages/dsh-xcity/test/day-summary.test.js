/**
 * R479：今天记得什么。
 *
 * 摘要只读世界事实：当天活动 + 站点名；不编、不泄露内部 id、不超预算。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { promptText, respondViaSession } from '../lib/adapters/slowvale/respond-sms.js'
import { summarizeDay } from '../lib/sim/day-summary.js'

function worldWith(activities, nowTick = 800) {
  return {
    tick: nowTick,
    activities,
    stations: [
      { id: 'station.desk-22', name: '工位 22' },
      { id: 'station.breakroom-01', name: '茶水间休息位' },
    ],
  }
}

function activity(overrides) {
  return {
    id: 'act-1',
    agentId: 'agent-1',
    kind: 'work',
    skill: 'code',
    placeId: 'scene.office',
    stationId: 'station.desk-22',
    status: 'completed',
    startedAt: 540,
    endsAt: 600,
    endedAt: 600,
    ...overrides,
  }
}

test('空世界：没有记录就返回空数组', () => {
  assert.deepEqual(summarizeDay(worldWith([]), 'agent-1', 800), [])
})

test('当天 3 条已完成：按时间正序、含站点名、末尾“现在闲着”', () => {
  const lines = summarizeDay(
    worldWith([
      activity({ id: 'a', startedAt: 540, endedAt: 600, stationId: 'station.desk-22' }),
      activity({ id: 'b', startedAt: 610, endedAt: 660, stationId: 'station.breakroom-01', kind: 'rest', trigger: { kind: 'self', text: '饿了，去吃点东西' } }),
      activity({ id: 'c', startedAt: 700, endedAt: 760, stationId: 'station.desk-22' }),
    ]),
    'agent-1',
    800,
  )
  assert.equal(lines.length, 4)
  assert.match(lines[0], /^09:00–10:00 在工位 22/)
  assert.match(lines[1], /10:10–11:00 在茶水间休息位吃饭/)
  assert.match(lines[2], /^11:40–12:40/)
  assert.equal(lines[3], '现在闲着')
})

test('跨天：只取当天，不混昨天的', () => {
  const lines = summarizeDay(
    worldWith([
      activity({ id: 'old', startedAt: 100, endedAt: 160 }),
      activity({ id: 'new', startedAt: 1450, endedAt: 1500 }),
    ], 1500),
    'agent-1',
    1500,
  )
  assert.equal(lines.length, 2)
  assert.match(lines[0], /^00:10–01:00/)
  assert.ok(!lines.some((line) => line.includes('02:40')))
})

test('跨午夜：昨晚的觉按今天凌晨算（起点夹到 00:00）', () => {
  const lines = summarizeDay(
    worldWith([
      activity({
        id: 'sleep',
        kind: 'rest',
        startedAt: 1380,
        endsAt: 1500,
        endedAt: 1500,
        stationId: 'station.breakroom-01',
        trigger: { kind: 'self', text: '夜深了，去睡一觉' },
      }),
    ], 1560),
    'agent-1',
    1560,
  )
  assert.ok(lines[0].startsWith('00:00–01:00 '), lines[0])
  assert.ok(lines[0].includes('睡觉'), lines[0])
})

test('当前活动：单独一行“现在在…”，不会重复出现在已完成里', () => {
  const lines = summarizeDay(
    worldWith([
      activity({ id: 'done', startedAt: 540, endedAt: 600 }),
      activity({ id: 'live', status: 'active', startedAt: 780, endedAt: undefined }),
    ], 800),
    'agent-1',
    800,
  )
  assert.equal(lines.at(-1), '现在在工位 22干活')
  assert.equal(lines.filter((line) => line.startsWith('现在')).length, 1)
})

test('预算：最多 5 条已完成 + 现在闲着；总长不超过 300 字，不泄露内部 id', () => {
  const many = Array.from({ length: 8 }, (_, index) => activity({
    id: 'a' + index,
    startedAt: 540 + index * 30,
    endedAt: 560 + index * 30,
  }))
  const lines = summarizeDay(worldWith(many), 'agent-1', 1200)
  assert.ok(lines.length <= 6)
  assert.ok(lines.join('；').length <= 300)
  for (const line of lines) {
    assert.ok(!line.includes('agent-'), line)
    assert.ok(!line.includes('station.'), line)
    assert.ok(!line.includes('task-'), line)
  }
})

test('跨午夜的当前活动：只写“现在在…”，不编完成时间', () => {
  const lines = summarizeDay(
    worldWith([
      activity({
        id: 'sleeping',
        kind: 'rest',
        status: 'active',
        startedAt: 1380,
        endsAt: 1860,
        endedAt: undefined,
        stationId: 'station.breakroom-01',
        trigger: { kind: 'self', text: '夜深了，去睡一觉' },
      }),
    ], 1500),
    'agent-1',
    1500,
  )
  assert.deepEqual(lines, ['现在在茶水间休息位睡觉'])
})

test('只取这个角色的活动，不把别人的经历写进来', () => {
  const lines = summarizeDay(
    worldWith([
      activity({ id: 'mine', startedAt: 540, endedAt: 600 }),
      activity({ id: 'other', agentId: 'agent-2', startedAt: 610, endedAt: 660 }),
    ]),
    'agent-1',
    800,
  )
  assert.equal(lines.filter((line) => line.includes('11:10')).length, 0)
  assert.equal(lines.filter((line) => line.startsWith('09:00')).length, 1)
})

test('prompt：有摘要才加“你今天”，没有就不加', () => {
  assert.ok(!promptText('在吗').includes('你今天'))
  const text = promptText('在吗', ['09:20–10:40 在工位 22干活'])
  assert.ok(text.includes('你今天到目前为止：'))
  assert.ok(text.includes('09:20–10:40 在工位 22干活'))
  assert.ok(!text.includes('agent-'))
})

test('dayContext 抛错也不能把短信弄丢（退回无摘要）', async () => {
  let sent = null
  await respondViaSession(
    { peerRoleId: 'agent-1', content: '在吗' },
    {
      characterOf: () => 'agent-1',
      sessionOf: () => 'session-1',
      dayContext: () => {
        throw new Error('world gone')
      },
      prompt: async (payload) => {
        sent = payload.content[0].text
      },
    },
    () => 'nonce',
  )
  assert.ok(sent.includes('你在 xcity 小镇里'))
  assert.ok(!sent.includes('你今天到目前为止'))
})

test('respondViaSession 把 dayContext 的摘要带进真正投递的文本', async () => {
  let sent = null
  await respondViaSession(
    { peerRoleId: 'agent-1', content: '今天干嘛了' },
    {
      characterOf: () => 'agent-1',
      sessionOf: () => 'session-1',
      dayContext: () => ['09:20–10:40 在工位 22干活'],
      prompt: async (payload) => {
        sent = payload.content[0].text
      },
    },
    () => 'nonce',
  )
  assert.ok(sent.includes('09:20–10:40 在工位 22干活'))
  assert.ok(sent.includes('短信投递编号：xcity-sms:session-1:nonce'))
})
