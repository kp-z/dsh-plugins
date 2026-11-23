/**
 * 同一个场景不该每秒重推一遍。
 *
 * 实测（正式桥）：5 秒里收到 5 个 scene_state，scenes 全是 ['company']。
 * 前端收到场景变化会走切换逻辑，重复推 = 反复重启场景。
 * 这条测试盯 sceneStateOnChangeOnly：开了之后，同一个场景只推第一次。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createSlowvaleBridge } from '../lib/adapters/slowvale/server.js'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(here, '..', '..', '..', 'slowvale-mirror', 'site')
const world = { id: 'w1', name: 'w', tick: 5, agents: [{ id: 'agent-1', name: 'A', station: 'place:office.tech_company_1' }] }

async function collect(pushMs, changeOnly, ms = 600) {
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1', port: 0, assetsDir, pushMs,
    sceneStateOnChangeOnly: changeOnly,
    account: { email: 'a@b.c', password: 'x' },
    opts: { worldId: 'w1', viewerRoleId: 'agent-1', place: 'place:office.tech_company_1', startDate: '2026-01-01' },
    getWorld: () => world,
  })
  try {
    const res = await fetch('http://127.0.0.1:' + String(bridge.port) + '/api/game/stream?world_id=w1&role_id=agent-1')
    const reader = res.body.getReader()
    const chunks = []
    const until = Date.now() + ms
    while (Date.now() < until) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((r) => setTimeout(() => r({ done: false, value: undefined }), 100)),
      ])
      if (done) break
      if (value) chunks.push(Buffer.from(value).toString('utf8'))
    }
    void reader.cancel()
    const text = chunks.join('')
    const count = (kind) => (text.match(new RegExp('"kind":"' + kind + '"', 'g')) ?? []).length
    return { sceneState: count('scene_state'), state: count('state') }
  } finally {
    await bridge.close()
  }
}

test('sceneStateOnChangeOnly：同一场景只推一次；关掉就每轮都推', async () => {
  const dedup = await collect(60, true, 600)
  assert.ok(dedup.state > 1, 'state 应该持续推（说明推送确实在跑）：' + JSON.stringify(dedup))
  assert.ok(dedup.sceneState <= 1, '同一场景不该重复推：' + JSON.stringify(dedup))

  const everyTick = await collect(60, false, 600)
  assert.ok(everyTick.sceneState > dedup.sceneState, '关掉去重时应该推更多：' + JSON.stringify(everyTick))
})
