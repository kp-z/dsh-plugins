/**
 * 「发条短信让他去上班」——端到端（不含 HTTP、不含宿主）。
 *
 * 链路：短信原话 -> parseDirective -> directiveToCommand -> step(world, [command])
 * 判据：那个 agent 真的进入 walking，且路径非空；再跑若干 tick，位置必须发生变化。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'
import { parseDirective, directiveToCommand } from '../lib/adapters/slowvale/directive.js'
import { DEFAULT_CIRCUIT } from '../lib/adapters/slowvale/stage.js'

function makeWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
}

const places = DEFAULT_CIRCUIT.map((p) => ({ id: p.id, label: p.label, asset: p.asset }))

test('玩家发「去办公室工作」→ 角色走向工位并开干', () => {
  const world = makeWorld()
  const agent = world.agents[0]
  assert.ok(agent, '世界至少有一个角色')
  agent.state = 'idle'
  agent.station = null
  agent.targetStation = null
  agent.path = []
  agent.carrying = null

  const directive = parseDirective('你去办公室工作吧', places)
  assert.ok(directive, '这句话应该被认成指令')
  const command = directiveToCommand(directive, agent.id)
  assert.ok(command, '办公室是指令能落地的地点')

  step(world, [command])

  assert.equal(agent.state, 'walking', '应该进入走路状态')
  assert.ok(agent.path.length > 0, '应该有路径点')
  assert.ok(agent.targetStation !== null, '应该有目标工位')

  const before = { x: agent.position.x, z: agent.position.z }
  for (let i = 0; i < 40; i += 1) step(world)
  const moved = Math.abs(agent.position.x - before.x) + Math.abs(agent.position.z - before.z)
  assert.ok(moved > 0, '跑了几十 tick 之后位置应该变了（真的在走）')
})
