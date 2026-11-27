import assert from 'node:assert/strict'
import test from 'node:test'

import { PLAN_MINUTE, createDailyPlanner } from '../lib/bridge/daily-plan.js'

const AGENTS = [{ id: 'a' }, { id: 'b' }]
const commitment = (id) => ({ id, with: 'b', what: '一起吃饭', dueTick: 100, status: 'open', source: 'plan', createdAtTick: 0 })

function planner(overrides = {}) {
  const calls = []
  const applied = []
  const p = createDailyPlanner({
    ask: async (agentId, prompt) => { calls.push([agentId, prompt]); return overrides.text ?? '[{"with":"b","what":"一起吃饭","due":"12:30"}]' },
    promptFor: (agentId, day) => 'plan:' + agentId + ':' + day,
    parse: (text, agentId) => [{ ...commitment('c-' + agentId), what: text.slice(0, 6) }],
    apply: (agentId, list) => applied.push([agentId, list.length]),
    ...overrides,
  })
  return { p, calls, applied }
}

test('R500：06:30 各问一次，同一天不重复问', async () => {
  const { p, calls } = planner()
  assert.equal(p.tick(AGENTS, PLAN_MINUTE), 2)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(p.tick(AGENTS, PLAN_MINUTE), 0, '同一 tick 再调也不该重复')
  assert.equal(p.tick(AGENTS, PLAN_MINUTE + 1), 0)
  assert.equal(calls.length, 2)
  assert.equal(calls[0][1], 'plan:a:1')
})

test('R500：第二天会重新问', async () => {
  const { p, calls } = planner()
  p.tick(AGENTS, PLAN_MINUTE)
  await new Promise((r) => setTimeout(r, 0))
  p.tick(AGENTS, PLAN_MINUTE + 1440)
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(calls.map((c) => c[1]), ['plan:a:1', 'plan:b:1', 'plan:a:2', 'plan:b:2'])
})

test('R500：模型失败/空返回不阻塞，也不落空承诺', async () => {
  const boom = planner({ ask: async () => { throw new Error('no model') } })
  boom.p.tick(AGENTS, PLAN_MINUTE)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(boom.applied.length, 0)

  const empty = planner({ ask: async () => '   ' })
  empty.p.tick(AGENTS, PLAN_MINUTE)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(empty.applied.length, 0)
})

test('R500：解析出 0 条也不 apply；stop 之后不再问', async () => {
  const none = planner({ parse: () => [] })
  none.p.tick(AGENTS, PLAN_MINUTE)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(none.applied.length, 0)
  none.p.stop()
  assert.equal(none.p.tick(AGENTS, PLAN_MINUTE + 1440), 0)
})
