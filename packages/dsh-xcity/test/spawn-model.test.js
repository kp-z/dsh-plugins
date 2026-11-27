import assert from 'node:assert/strict'
import test from 'node:test'

import { spawnCharacterSession } from '../lib/adapters/slowvale/spawn.js'

const ports = (overrides = {}) => {
  const calls = []
  return {
    calls,
    ...{
      createAgent: async (input) => { calls.push(['create', input.sessionId]) },
      attachToWorkspace: async () => false,
      selectModel: async (sessionId, choice) => { calls.push(['select', sessionId, choice.provider, choice.model]); return true },
    },
    ...overrides,
  }
}

test('R503：配置了角色模型就在建会话后选上', async () => {
  const p = ports()
  const result = await spawnCharacterSession({
    characterId: 'agent-1', cwd: '/tmp/x', now: 1, ports: p,
    model: { provider: 'mmt-product', model: 'deepseek-v4.1-flash' },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(p.calls[1], ['select', result.sessionId, 'mmt-product', 'deepseek-v4.1-flash'])
})

test('R503：没配模型就不选（保持旧行为）', async () => {
  const p = ports()
  await spawnCharacterSession({ characterId: 'agent-1', cwd: '/tmp/x', now: 2, ports: p })
  assert.deepEqual(p.calls.map((c) => c[0]), ['create'])
})

test('R503：选模型失败不拦建会话', async () => {
  const p = ports({ selectModel: async () => { throw new Error('no model service') } })
  const result = await spawnCharacterSession({
    characterId: 'agent-1', cwd: '/tmp/x', now: 3, ports: p,
    model: { provider: 'mmt-product', model: 'x' },
  })
  assert.equal(result.ok, true)
  assert.ok(result.sessionId)
})
