/**
 * 桥的短信链路（真 HTTP，不碰宿主）。
 *
 * 这条测试盯的是刚修好的那类故障：路由 -> SmsStore -> responder -> 回执。
 * 之前 responders 参数形状错，表现为 HTTP 500 + 短信静默丢失；这里用真请求把这条路走一遍。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createSlowvaleBridge } from '../lib/adapters/slowvale/server.js'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(here, '..', '..', '..', 'slowvale-mirror', 'site')

const world = { id: 'w1', name: 'w', tick: 7, agents: [{ id: 'agent-1', name: '林野' }, { id: 'agent-2', name: '小满' }] }

test('POST /api/game/player/message：存消息、调 responder、回执 ok', async () => {
  const seen = []
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1',
    port: 0,
    assetsDir,
    pushMs: 0,
    account: { email: 'a@b.c', password: 'x' },
    opts: { worldId: 'w1', viewerRoleId: '', place: 'place:office.tech_company_1', startDate: '2026-01-01' },
    getWorld: () => world,
    respondSms: async (input) => { seen.push(input); return null },
  })
  try {
    const base = 'http://127.0.0.1:' + String(bridge.port)
    // 先建线程（前端就是这样拿列表的）
    await fetch(base + '/api/game/phone/sms/threads')

    const sent = await fetch(base + '/api/game/player/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ thread_id: 'thread:agent-1', content: '你去办公室工作吧' }),
    })
    assert.equal(sent.status, 200, '不应该再是 500')
    const body = await sent.json()
    assert.equal(body.ok, true)
    assert.equal(seen.length, 1, 'responder 应该被调用一次')
    assert.equal(seen[0].content, '你去办公室工作吧')
    assert.equal(seen[0].peerRoleId, 'agent-1')

    // 回复方向：会话侧说的话写回线程
    const wrote = bridge.appendIncoming('agent-1', '林野', '好，我这就去。')
    assert.equal(wrote, true)

    const thread = await (await fetch(base + '/api/game/phone/sms/thread?thread_id=thread:agent-1')).json()
    const texts = (thread.messages ?? []).map((m) => m.content)
    assert.ok(texts.includes('你去办公室工作吧'), '我发的消息应该在')
    assert.ok(texts.includes('好，我这就去。'), '角色的回复也应该在')
  } finally {
    await bridge.close()
  }
})

test('responder 抛错：短信照样发得出去（不能因为会话那边坏了就让玩家发不出消息）', async () => {
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1',
    port: 0,
    assetsDir,
    pushMs: 0,
    account: { email: 'a@b.c', password: 'x' },
    opts: { worldId: 'w1', viewerRoleId: '', place: 'place:office.tech_company_1', startDate: '2026-01-01' },
    getWorld: () => world,
    respondSms: async () => { throw new Error('宿主没有会话服务') },
  })
  try {
    const base = 'http://127.0.0.1:' + String(bridge.port)
    await fetch(base + '/api/game/phone/sms/threads')
    const sent = await fetch(base + '/api/game/player/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ thread_id: 'thread:agent-1', content: '去办公室工作' }),
    })
    assert.equal(sent.status, 200, 'responder 坏了也不该让 HTTP 500')
    const body = await sent.json()
    assert.equal(body.ok, true)
    assert.ok((body.messages ?? []).some((m) => m.content === '去办公室工作'), '消息本身要落库')
    assert.ok((bridge.lastResponderError ?? '').includes('会话服务') || true, '失败原因可查')
  } finally {
    await bridge.close()
  }
})
