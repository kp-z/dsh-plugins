import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { acquireOwnerLock } from '../lib/runtime/owner-lock.js'

const dir = () => mkdtempSync(join(tmpdir(), 'xcity-lock-'))

test('R509：同一进程可以重复拿锁（不自杀）', () => {
  const d = dir()
  const first = acquireOwnerLock(d)
  assert.equal(first.owned, true)
  const again = acquireOwnerLock(d)
  assert.equal(again.owned, true)
  first.release()
})

test('R509：别的活进程持有时，第二个实例只读', () => {
  const d = dir()
  // 1 号进程一定在（launchd）；对它 kill(0) 会拿到 EPERM，必须按"活着"处理。
  writeFileSync(join(d, '.owner.lock'), '1')
  const lock = acquireOwnerLock(d)
  assert.equal(lock.owned, false)
  assert.equal(lock.ownerPid, 1)
})

test('R509：崩溃残留（进程已不在）会被接管', () => {
  const d = dir()
  writeFileSync(join(d, '.owner.lock'), '999999')
  const lock = acquireOwnerLock(d)
  assert.equal(lock.owned, true)
  assert.equal(readFileSync(join(d, '.owner.lock'), 'utf8').trim(), String(process.pid))
  lock.release()
})

test('R509：release 之后别人能拿到', () => {
  const d = dir()
  const lock = acquireOwnerLock(d)
  lock.release()
  writeFileSync(join(d, '.owner.lock.tmp'), '')
  assert.equal(acquireOwnerLock(d).owned, true)
})
