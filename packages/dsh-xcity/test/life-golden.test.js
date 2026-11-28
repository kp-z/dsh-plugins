import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'
import { chooseLife, selfLifeCommands } from '../lib/sim/life.js'

/**
 * R498 golden：重构不许**悄悄**改变行为。改这个常量必须在提交信息里说明为什么该变。
 * 摘要 = 一天里每次"谁选了什么用途"的序列（3 人 × 1440 tick）。
 * 更新它必须先解释**为什么行为该变**，不能顺手改常量。
 */
// R498 第二次更新：决策点改到「活动结束」+ 想聊天可以先坐下（第二条证据见 life-diverge）。
// 旧值 9c2335e0… 对应"只在空闲时决策"，那条结构下三人几乎从不空闲，社交 3 天 0 次。
const GOLDEN = '47228872fab3f9a6182eaca1c12309bf650aa613'

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
    step(world, selfLifeCommands(world), { selfLife: true })
  }
  assert.equal(rows.length, 4320)
  assert.equal(createHash('sha1').update(rows.join('|')).digest('hex'), GOLDEN)
})
