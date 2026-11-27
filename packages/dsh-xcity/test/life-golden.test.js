import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'
import { chooseLife, selfLifeCommands } from '../lib/sim/life.js'

/**
 * R498 golden：B1/B2 重构不许悄悄改变行为。
 * 摘要 = 一天里每次"谁选了什么用途"的序列（3 人 × 1440 tick）。
 * 更新它必须先解释**为什么行为该变**，不能顺手改常量。
 */
const GOLDEN = '9c2335e0e4c2c23d800b4f92d626ac0718cdfa85'

test('R498：一天 4320 次决策与 golden 完全一致', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const world = createWorld({
    content, scene: 'scene.office', name: 'golden', maxAgents: 3,
    places: [{ id: 'place:office.tech_company_1', name: 'Office', asset: 'company', spawn: { x: 480, z: 800 } }],
  })
  const rows = []
  for (let i = 0; i < 1440; i++) {
    for (const agent of world.agents) rows.push(agent.id + ':' + (chooseLife(world, agent)?.purpose ?? '-'))
    step(world, selfLifeCommands(world))
  }
  assert.equal(rows.length, 4320)
  assert.equal(createHash('sha1').update(rows.join('|')).digest('hex'), GOLDEN)
})
