/**
 * R526：state 目录不存在时也要能拿到所有权。
 *
 * 现场：全新 DSH_HOME 里 <profile>/state 还没有，openSync(...,'wx') 拿到 ENOENT，
 * 于是 owned=false → 桥不启动（世界照建、端口不监听）。端到端冒烟就是卡在这，
 * 表面看像"spawn 失败"。这条测试钉住"目录会自动建出来"。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { acquireOwnerLock } from '../lib/runtime/owner-lock.js'

test('R526：目录不存在时自动创建并拿到锁', () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-lock-'))
  try {
    const missing = join(root, 'state', 'nested')
    const lock = acquireOwnerLock(missing)
    assert.equal(lock.owned, true, '目录不存在不该让所有权静默丢失')
    lock.release()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
