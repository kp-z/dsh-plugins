import assert from 'node:assert/strict'
import test from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'
import { chooseLife, selfLifeCommands } from '../lib/sim/life.js'

const content = new ContentRegistry()
content.loadAll(builtinPacks())
const OFFICE = { id: 'place:office.tech_company_1', name: 'Office', asset: 'company', spawn: { x: 480, z: 800 } }

function world(agents = 3) {
  return createWorld({ content, scene: 'scene.office', name: 'diverge', maxAgents: agents, places: [OFFICE] })
}

/** 同一个处境（饿了不饿、空闲、上班时段、有人可聊），只换干劲。 */
function choiceWith(diligence) {
  const w = world()
  w.tick = 600
  for (const agent of w.agents) {
    agent.traits = { diligence, duty: 0.5 }
    agent.needs = { energy: 80, hunger: 80, social: 10 }
  }
  return w.agents.map((agent) => chooseLife(w, agent)?.purpose ?? null)
}

test('R498-B2：同一处境下，干劲高的去干活，干劲低的去聊天', () => {
  assert.deepEqual(choiceWith(0.95), ['work', 'work', 'work'])
  assert.deepEqual(choiceWith(0.1), ['social', 'social', 'social'])
})

test('R498-B2：两两分化率——量化到天，不靠感觉', () => {
  const w = world(3)
  let pairs = 0
  let differ = 0
  for (let i = 0; i < 3 * 1440; i++) {
    const picks = w.agents.map((agent) => chooseLife(w, agent)?.purpose ?? null)
    for (let a = 0; a < picks.length; a++) {
      for (let b = a + 1; b < picks.length; b++) {
        if (picks[a] === null || picks[b] === null) continue
        pairs += 1
        if (picks[a] !== picks[b]) differ += 1
      }
    }
    step(w, selfLifeCommands(w))
  }
  // 记录真实值，别把目标当结果：三人几乎总在忙，可比较的对本来就少。
  console.log('[R498] 可比较对=' + String(pairs) + ' 不同=' + String(differ))
  assert.ok(pairs > 0, '三天的仿真里至少要有可比较的时刻')
})
