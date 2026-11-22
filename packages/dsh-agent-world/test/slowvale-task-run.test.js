/**
 * 「派个活，人会不会真的去干」——端到端模拟测试。
 *
 * 这条测试盯的是用户最直接的那个问题：
 * 派单之后，有没有人被指派、有没有走到工位、进度是否推进、最后是否完成。
 *
 * 它**不碰宿主**（不起 DSH、不发 HTTP）：只调 sim 的四个阶段函数，
 * 因为"世界会不会自己转"是内核的事，和 DSH 会话无关。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { recomputeReady } from '../lib/sim/ready.js'
import { claimTasks } from '../lib/sim/scheduler.js'
import { advanceMovement } from '../lib/sim/movement.js'
import { advanceWork } from '../lib/sim/interaction.js'

function makeWorld(taskSets) {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets,
  })
}

test('派单之后：有人被指派、走到工位、进度推进、最终完成', () => {
  const world = makeWorld(['task.town-inspection'])
  assert.ok(world.tasks.length > 0, '任务集应该建出工单')

  const first = world.tasks[0]
  let owner = null
  let sawMoving = false
  let lastProgress = 0

  // 上限给足：走路 + 干活都要 tick。
  for (let tick = 0; tick < 4000; tick += 1) {
    world.tick += 1
    recomputeReady(world)
    claimTasks(world)
    advanceMovement(world)
    advanceWork(world)

    pada: {
      const current = world.tasks.find((t) => t.id === first.id)
      if (current === undefined) break pada
      if (current.owner !== null && owner === null) owner = current.owner
      if (current.status === 'in_progress') {
        if (current.progress > lastProgress) lastProgress = current.progress
        const agent = world.agents.find((a) => a.id === current.owner)
        if (agent !== undefined && agent.path.length > 0) sawMoving = true
      }
      if (current.status === 'done') break pada
    }
  }

  assert.notEqual(owner, null, '应该有角色领取第一张工单')
  assert.ok(sawMoving, '领到工单的人应该有过一段前往工位的路径')
  assert.ok(lastProgress > 0, '进度应该推进过')
  assert.equal(world.tasks.find((t) => t.id === first.id)?.status, 'done', '模拟模式下进度满即完成')
})
