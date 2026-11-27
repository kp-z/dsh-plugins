import assert from 'node:assert/strict'
import test from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { PLAN_MINUTE, createDailyPlanner } from '../lib/bridge/daily-plan.js'
import { buildPlanPrompt, parsePlan } from '../lib/bridge/plan-prompt.js'
import { promiseBetween } from '../lib/sim/commitments.js'

const content = new ContentRegistry()
content.loadAll(builtinPacks())
const world = createWorld({
  content, scene: 'scene.office', name: 'plan-world', maxAgents: 3,
  places: [{ id: 'place:office.tech_company_1', name: 'Office', asset: 'company', spawn: { x: 480, z: 800 } }],
})

const planner = createDailyPlanner({
  ask: async (agentId) => (agentId === 'agent-1' ? '[{"with":"agent-2","what":"午饭后一起对进度","due":"12:30"}]' : '[]'),
  promptFor: (agentId) => buildPlanPrompt({
    agentName: agentId, persona: '', todaySummary: [], nowTick: world.tick,
    knownPeers: world.agents.filter((a) => a.id !== agentId).map((a) => ({ id: a.id, name: a.name })),
  }),
  parse: (text, agentId) => parsePlan(text, {
    nowTick: world.tick, agentId, peerIds: world.agents.filter((a) => a.id !== agentId).map((a) => a.id),
  }).commitments,
  apply: (agentId, rows) => {
    for (const row of rows) if (row.with !== '') promiseBetween(world, agentId, row.with, { what: row.what, dueTick: row.dueTick, source: 'plan' })
  },
})

test('R500：06:30 一次提问 → 世界里的承诺双方各一条（模型用假数据，其余全是真的）', async () => {
  world.tick = PLAN_MINUTE
  assert.equal(planner.tick(world.agents, world.tick), 3, '三个角色各问一次')
  await new Promise((r) => setTimeout(r, 20))
  const a = world.agents[0].commitments ?? []
  const b = world.agents[1].commitments ?? []
  assert.equal(a.length, 1, '问出来一条就该落一条')
  assert.equal(b.length, 1, '对方也要有一条')
  assert.equal(a[0].what, '午饭后一起对进度')
  assert.equal(a[0].source, 'plan')
  assert.equal(a[0].id, b[0].id)
  assert.equal((world.agents[2].commitments ?? []).length, 0, '返回 [] 的人不该凭空多出承诺')
})
