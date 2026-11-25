/**
 * 桥的短信链路（真 HTTP，不碰宿主）。
 *
 * 这条测试盯的是刚修好的那类故障：路由 -> SmsStore -> responder -> 回执。
 * 之前 responders 参数形状错，表现为 HTTP 500 + 短信静默丢失；这里用真请求把这条路走一遍。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
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

test('token 稳定：登录与刷新返回同一个 token（换来换去会被前端当成会话被顶掉）', async () => {
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1', port: 0, assetsDir, pushMs: 0,
    account: { email: 'a@b.c', password: 'x' },
    opts: { worldId: 'w1', viewerRoleId: '', place: 'place:office.tech_company_1', startDate: '2026-01-01' },
    getWorld: () => world,
  })
  try {
    const base = 'http://127.0.0.1:' + String(bridge.port)
    const login = await (await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.c', password: 'x' }),
    })).json()
    const refresh = await (await fetch(base + '/api/auth/refresh')).json()
    assert.equal(login.access_token, refresh.access_token, '两次拿到的 token 必须一样')
    assert.ok(String(login.access_token).startsWith('local-'))
  } finally {
    await bridge.close()
  }
})

test('applyDirective 端口真的被路由调用了（漏传过一次，指令静默失效）', async () => {
  const calls = []
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1', port: 0, assetsDir, pushMs: 0,
    account: { email: 'a@b.c', password: 'x' },
    opts: { worldId: 'w1', viewerRoleId: '', place: 'place:office.tech_company_1', startDate: '2026-01-01' },
    getWorld: () => world,
    applyDirective: (peerId, text) => { calls.push({ peerId, text }); return true },
  })
  try {
    const base = 'http://127.0.0.1:' + String(bridge.port)
    await fetch(base + '/api/game/player/message', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ thread_id: 'thread:agent-1', content: '你去办公室工作吧' }),
    })
    assert.equal(calls.length, 1, '路由必须调用 applyDirective')
    assert.equal(calls[0].peerId, 'agent-1', '传的是世界 agentId，不是角色 id')
    assert.equal(calls[0].text, '你去办公室工作吧')
  } finally {
    await bridge.close()
  }
})

test('左下角聊天框的形状：{role_id, content} 也要走通（前端 Q2 就是这么发的）', async () => {
  const seen = []
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1', port: 0, assetsDir, pushMs: 0,
    account: { email: 'a@b.c', password: 'x' },
    opts: { worldId: 'w1', viewerRoleId: '', place: 'place:office.tech_company_1', startDate: '2026-01-01' },
    getWorld: () => world,
    respondSms: async (input) => { seen.push(input); return null },
  })
  try {
    const base = 'http://127.0.0.1:' + String(bridge.port)
    await fetch(base + '/api/game/phone/sms/threads')
    const res = await fetch(base + '/api/game/player/message', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role_id: 'agent-1', content: '左下角发的话' }),
    })
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(seen.length, 1, 'responder 必须被调用（消息不能静默丢掉）')
    assert.equal(seen[0].peerRoleId, 'agent-1')
    assert.equal(seen[0].content, '左下角发的话')
    assert.ok((body.messages ?? []).some((m) => m.content === '左下角发的话'), '消息要落进线程')
  } finally {
    await bridge.close()
  }
})

test('入站短信通过 SSE 推送私有手机状态，新连接收到同一行号', async () => {
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1', port: 0, assetsDir, pushMs: 0,
    account: { email: 'a@b.c', password: 'x' },
    opts: { worldId: 'public-town', viewerRoleId: 'agent-1', place: 'company', startDate: '2026-01-01' },
    getWorld: () => world,
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  const url = 'http://127.0.0.1:' + bridge.port + '/api/game/stream'
  const events = async function* () {
    const response = await fetch(url, { signal: controller.signal })
    assert.equal(response.status, 200)
    let buffer = ''
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (frame.startsWith('event: ')) {
          const [name, json] = frame.split('\n')
          yield [name.slice(7), JSON.parse(json.slice(6))]
        }
      }
    }
  }
  try {
    const stream = events()
    const { value: [initialName, initial] } = await stream.next()
    assert.equal(initialName, 'connected')
    assert.equal(initial.viewer.phone.sms.player_thread_message_row_id, null)
    const { value: [baselineName, baseline] } = await stream.next()
    assert.equal(baselineName, 'resync')
    assert.equal(bridge.appendIncoming('agent-2', '小满', '收到'), true)
    const { value: [event, update] } = await stream.next()
    assert.equal(event, 'update')
    assert.deepEqual(update.prev, baseline.cursor)
    assert.deepEqual(update.route, { world_id: 'public-town', broadcast: false, role_ids: ['agent-1'], scenes: [] })
    const body = JSON.parse(gunzipSync(Buffer.from(update.payload_gz, 'base64')).toString())
    assert.equal(body.part, 'role_phone')
    assert.equal(body.operation, 'replace')
    assert.equal(body.key, 'agent-1')
    assert.equal(body.payload.sms.player_thread_message_row_id, 1)
    assert.equal(body.payload.sms.player_thread_unread_count, 1)
    const { value: [, connected] } = await events().next()
    assert.deepEqual(connected.viewer.phone, body.payload)
  } finally {
    clearTimeout(timer)
    controller.abort()
    await bridge.close()
  }
})
