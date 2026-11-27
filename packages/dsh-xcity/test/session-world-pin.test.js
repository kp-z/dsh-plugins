/**
 * R509：世界归**第一个激活者**，且首次激活只认领、不重建。
 *
 * 现场背景（H6）：启动时 ensureWorld() 已把世界建好，但 activeSessionId 还是 null；
 * 第一次工具调用（比如派单）激活某个会话时又 build 了一个新世界，把小镇整座换掉，
 * 表现为 tick 倒退、工单凭空消失。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { resolveConfig } from '../lib/config.js'
import { createPluginState } from '../lib/state.js'

const dirs = []
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

async function freshState() {
  const dir = await mkdtemp(join(tmpdir(), 'aw-pin-'))
  dirs.push(dir)
  const state = createPluginState(
    resolveConfig({ autoStart: false, scene: 'scene.default-town' }),
    { storeDir: dir, initialAgents: 'captain' },
  )
  return state
}

test('R509：首次激活认领已在内存的世界，不重建', async () => {
  const state = await freshState()
  const booted = state.ensureWorld()
  booted.tick = 1234
  booted.tasks.push({
    id: 'task-1', title: '盘点', status: 'ready', ordinal: 1, set: 'task.x',
    dependsOn: [], stationId: null, owner: null, progress: 0, createdAtTick: 0,
  })

  const claimed = state.activateSession('session-a')
  assert.equal(claimed, booted, '必须是同一个世界对象')
  assert.equal(claimed.tick, 1234, 'tick 不能被重置')
  assert.equal(claimed.tasks.length, 1, '工单不能消失')
  assert.equal(state.activeSessionId, 'session-a')
})

test('R509：别的会话来激活时不抢世界', async () => {
  const state = await freshState()
  state.ensureWorld().tick = 77
  const first = state.activateSession('session-a')
  const second = state.activateSession('session-b')
  assert.equal(second, first, '第二个会话拿到的是同一个世界')
  assert.equal(second.tick, 77)
  assert.equal(state.activeSessionId, 'session-a', '持有者不变')
})

test('R509：持有者卸下后，别的会话可以接管', async () => {
  const state = await freshState()
  state.ensureWorld().tick = 99
  state.activateSession('session-a')
  state.deactivate()
  const next = state.activateSession('session-b')
  assert.equal(state.activeSessionId, 'session-b')
  assert.ok(next !== null)
})
