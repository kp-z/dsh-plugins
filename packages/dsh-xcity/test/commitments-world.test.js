import assert from 'node:assert/strict'
import test from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'
import { MISS_GRACE_TICKS, promiseBetween, settleCommitments } from '../lib/sim/commitments.js'

const content = new ContentRegistry()
content.loadAll(builtinPacks())

function world() {
  return createWorld({
    content, scene: 'scene.office', name: 'promise', maxAgents: 3,
    places: [{ id: 'place:office.tech_company_1', name: 'Office', asset: 'company', spawn: { x: 480, z: 800 } }],
  })
}

test('R500：一次约定双方各一条，id 相同', () => {
  const w = world()
  const written = promiseBetween(w, 'agent-1', 'agent-2', { what: '午饭一起吃', dueTick: w.tick + 120, source: 'plan' })
  assert.ok(written !== null)
  const a = w.agents[0].commitments ?? []
  const b = w.agents[1].commitments ?? []
  assert.equal(a.length, 1)
  assert.equal(b.length, 1)
  assert.equal(a[0].id, b[0].id, '双方共用一个 id，裁决才不会一边一个结果')
  assert.equal(a[0].with, 'agent-2')
  assert.equal(b[0].with, 'agent-1')
})

test('R500/R513：两个宽限都过了一定给出 kept/missed，不会永远 open', () => {
  const w = world()
  w.tick = 600
  const written = promiseBetween(w, 'agent-1', 'agent-2', { what: '一起吃饭', dueTick: 610, source: 'plan' })
  assert.ok(written !== null)
  // 到期后先走忙碌宽限（BUSY_GRACE_TICKS=60），再走失约宽限（MISS_GRACE_TICKS），所以要多推一段。
  while (w.tick <= 610 + MISS_GRACE_TICKS + 70) step(w, [], { selfLife: true })
  const settled = settleCommitments(w, w.tick)
  const all = [...(w.agents[0].commitments ?? []), ...(w.agents[1].commitments ?? [])]
  assert.equal(all.filter((c) => c.status === 'open').length, 0, '到期不该还挂着 open：' + JSON.stringify(settled))
  assert.ok(all.every((c) => c.status === 'kept' || c.status === 'missed'))
})

test('R500：对不存在的对方不写，也不编', () => {
  const w = world()
  assert.equal(promiseBetween(w, 'agent-1', 'agent-9', { what: 'x', dueTick: w.tick + 10, source: 'plan' }), null)
  assert.equal((w.agents[0].commitments ?? []).length, 0)
})
