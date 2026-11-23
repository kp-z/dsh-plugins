/**
 * 「切回来还在原来的页面」——iframe 重建不该把人踢回世界列表。
 *
 * 机制：访问 /world/... 时由服务端下发 Cookie 记住路径；iframe 从 / 重建时 302 回去。
 * 这不动前端：前端照常自己的路由，只是入口被换成了上次那个。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createSlowvaleBridge } from '../lib/adapters/slowvale/server.js'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(here, '..', '..', '..', 'slowvale-mirror', 'site')
const world = { id: 'w1', name: 'w', tick: 1, agents: [{ id: 'agent-1', name: 'A' }] }

test('访问 /world/... 记下路径；之后进 / 会被 302 回那个路径', async () => {
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1', port: 0, assetsDir, pushMs: 0,
    account: { email: 'a@b.c', password: 'x' },
    opts: { worldId: 'w1', viewerRoleId: '', place: 'place:office.tech_company_1', startDate: '2026-01-01' },
    getWorld: () => world,
  })
  try {
    const base = 'http://127.0.0.1:' + String(bridge.port)
    const deep = await fetch(base + '/world/w1?role_id=agent-1', { redirect: 'manual' })
    const cookie = (deep.headers.get('set-cookie') ?? '').split(';')[0]
    assert.ok(cookie.startsWith('xcity_resume='), '访问世界页应该下发 resume cookie')

    const root = await fetch(base + '/', { headers: { cookie }, redirect: 'manual' })
    assert.equal(root.status, 302)
    assert.equal(root.headers.get('location'), '/world/w1?role_id=agent-1')
  } finally {
    await bridge.close()
  }
})
