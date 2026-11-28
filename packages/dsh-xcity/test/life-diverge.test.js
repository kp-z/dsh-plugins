import assert from 'node:assert/strict'
import test from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'

const content = new ContentRegistry()
content.loadAll(builtinPacks())
const OFFICE = { id: 'place:office.tech_company_1', name: 'Office', asset: 'company', spawn: { x: 480, z: 800 } }

function run(equalTraits, ticks = 1440) {
  const w = createWorld({ content, scene: 'scene.office', name: 'ab', maxAgents: 3, places: [OFFICE] })
  if (equalTraits) for (const a of w.agents) a.traits = { diligence: 0.5, duty: 0.5 }
  const seqs = w.agents.map(() => [])
  let stuck = 0
  for (let i = 0; i < ticks; i++) {
    step(w, [], { selfLife: true })
    for (const a of w.agents) if (a.state === 'idle' && a.targetStation !== null) stuck += 1
    w.agents.forEach((a, idx) => seqs[idx].push((a.activityPurpose ?? a.state).slice(0, 4)))
  }
  return { seqs, stuck, world: w }
}

test('R498：只改性格，同种子的行为就不同（性格有因果作用）', () => {
  // R532：窗口从 1 天延长到 3 天。性格只通过 chooseLife 的加权分数起作用，而它只在
  // **多候选**的决策点上改变选择；加了夜间 energy 门槛后，1 天 3 人世界里这样的决策点只剩 3 次
  // （全部是"社交 vs 学习"，两种干劲都选社交），于是 1 天窗口量到的差异是 0——不是性格失效，
  // 是样本太少。3 天窗口有 437 次差异，判据（>100）本身没有放宽。
  const withTraits = run(false, 3 * 1440)
  const equal = run(true, 3 * 1440)
  const differ = withTraits.seqs[0].filter((v, i) => v !== equal.seqs[0][i]).length
  assert.ok(differ > 100, '干劲 0.8 与 0.5 应导致大量不同的选择，实际 ' + String(differ))
})

test('R498：活动结束即决策，不许把角色卡成 idle+targetStation', () => {
  const { stuck, world } = run(false, 3 * 1440)
  assert.equal(stuck, 0, '任何一 tick 出现 idle 却有目标工位就是状态机被打断')
  const purposes = new Set(world.activities.map((a) => a.purpose ?? a.kind))
  assert.ok(purposes.has('social'), '三天里必须有真实社交，否则等于没有生活')
  assert.ok(world.agents.every((a) => a.needs.social > 10), '社交需求要被真的补回来')
})
