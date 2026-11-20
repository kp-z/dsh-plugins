/**
 * Slow Vale 适配层的验收（P0）。
 *
 * 三件事必须锁死，任何一件松了前端就白屏，而白屏的原因极难从画面上看出来：
 * 1. 快照字段名与类型（protocol_version / cursor.epoch 是字符串 / presence.location.place_id）；
 * 2. 静态服务的 SPA fallback 与 /assets/ 的严格 404；
 * 3. SSE 的第一条事件是 connected 且带完整快照。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { projectScene, projectSnapshot, clockOf } from '../lib/adapters/slowvale/project.js'
import { createSlowvaleBridge } from '../lib/adapters/slowvale/server.js'

const WORLD = {
  id: 'w1',
  name: '测试小镇',
  tick: 90,
  paused: false,
  agents: [
    { id: 'agent-1', name: '阿吉', state: 'working', station: 'downtown_street', position: { x: 12, z: 34 }, facing: 0 },
    { id: 'agent-2', name: '小满', state: 'idle', station: null, position: { x: 1, z: 2 } },
  ],
}

const OPTS = { worldId: 'w1', viewerRoleId: 'agent-1', place: 'downtown_street', startDate: '2026-01-01' }

test('快照：protocol_version / cursor / presence 三处必须是前端认得的形状', () => {
  const snap = projectSnapshot(WORLD, OPTS)
  assert.equal(snap.protocol_version, 76)
  assert.equal(typeof snap.cursor.epoch, 'string', 'cursor.epoch 必须是字符串，数字会被判"cursor 无效"')
  assert.equal(snap.cursor.seq, 90, 'seq 必须跟着 tick 单调走，否则前端判定丢包')
  assert.equal(snap.viewer_role_id, 'agent-1')
  const presence = snap.role_presences['agent-1']
  assert.equal(presence.location.place_id, 'downtown_street', '读的是 location.place_id，不是 scene')
  assert.equal(presence.location.y, 34, 'world 的 z 要映射成前端的 y')
  assert.ok(snap.place_topology.places['downtown_street'])
  assert.equal(typeof snap.clock.day_number, 'number')
  assert.match(snap.clock.current_datetime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/)
})

test('快照：没有 station 的人落在默认地点，不会给出空 place_id', () => {
  const snap = projectSnapshot(WORLD, OPTS)
  assert.equal(snap.role_presences['agent-2'].location.place_id, 'downtown_street')
})

test('场景快照：校验需要的字段一个都不少', () => {
  const scene = projectScene(WORLD, OPTS)
  for (const key of ['world_id', 'cursor', 'tick_marker', 'scene', 'role_public_statuses', 'role_presences', 'actors', 'place_runtimes']) {
    assert.ok(key in scene, '缺少 ' + key + ' 会被前端判成无效场景快照')
  }
  assert.equal(scene.scene, 'downtown_street')
})

test('时钟：一天 1440 tick，跨天要进位', () => {
  assert.equal(clockOf({ ...WORLD, tick: 0 }, '2026-01-01').day_number, 1)
  assert.equal(clockOf({ ...WORLD, tick: 1440 }, '2026-01-01').day_number, 2)
  assert.match(clockOf({ ...WORLD, tick: 1440 }, '2026-01-01').current_datetime, /^2026-01-02/)
})

function makeSite() {
  const dir = mkdtempSync(join(tmpdir(), 'slowvale-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>sv</title>')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'main.js'), 'export const ok = 1')
  return dir
}

test('静态服务：SPA fallback 回 index.html，/assets/ 缺文件必须 404', async () => {
  const dir = makeSite()
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1',
    port: 0,
    assetsDir: dir,
    opts: OPTS,
    account: { email: 'a@b.c', password: 'p' },
    getWorld: () => WORLD,
    pushMs: 0,
  })
  try {
    const base = 'http://127.0.0.1:' + String(bridge.port)
    const world = await fetch(base + '/world/w1')
    assert.equal(world.status, 200)
    assert.match(await world.text(), /<title>sv<\/title>/)

    const missing = await fetch(base + '/assets/nope.js')
    assert.equal(missing.status, 404, 'assets 缺文件要 404，否则前端拿 HTML 当 JS 解析')

    const js = await fetch(base + '/assets/main.js')
    assert.equal(js.status, 200)
    assert.match(js.headers.get('content-type') ?? '', /javascript/)
  } finally {
    await bridge.close()
  }
})

test('API：登录 → 世界 → 快照，并且 SSE 首事件是带快照的 connected', async () => {
  const dir = makeSite()
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1',
    port: 0,
    assetsDir: dir,
    opts: OPTS,
    account: { email: 'demo@slowvale.dev', password: 'slowvale123' },
    getWorld: () => WORLD,
    pushMs: 0,
  })
  try {
    const base = 'http://127.0.0.1:' + String(bridge.port)
    const bad = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x', password: 'y' }),
    })
    assert.equal(bad.status, 401)

    const ok = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'demo@slowvale.dev', password: 'slowvale123' }),
    })
    assert.equal(ok.status, 200)
    const session = await ok.json()
    assert.equal(typeof session.access_token, 'string')

    const snap = await (await fetch(base + '/api/game/state/world')).json()
    assert.equal(snap.protocol_version, 76)

    const stream = await fetch(base + '/api/game/stream')
    assert.equal(stream.status, 200)
    const reader = stream.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    // 第一条 chunk 是注释心跳（: connected），事件本身在下一块
    for (let i = 0; i < 5 && !text.includes('event: connected'); i += 1) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value)
    }
    assert.match(text, /event: connected/)
    assert.match(text, /"protocol_version":76/, 'connected 必须带完整快照，否则前端要靠 HTTP 兜底')
    await reader.cancel()
  } finally {
    await bridge.close()
  }
})
