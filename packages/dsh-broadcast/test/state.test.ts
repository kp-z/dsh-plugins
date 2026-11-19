import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  createSwitch,
  readState,
  resolveStateDir,
  stateFilePath,
  writeState,
} from '../lib/state.js'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-broadcast-state-'))
}

test('目录优先级：profile → DSH_HOME → ~/.dsh', () => {
  assert.equal(resolveStateDir({ DSH_PROFILE_DIR: '/p', DSH_HOME: '/h', HOME: '/u' }), '/p/broadcast')
  assert.equal(resolveStateDir({ DSH_HOME: '/h', HOME: '/u' }), '/h/broadcast')
  assert.equal(resolveStateDir({ HOME: '/u' }), '/u/.dsh/broadcast')
  assert.equal(resolveStateDir({}), undefined)
  assert.equal(stateFilePath({}), undefined)
})

test('写读往返：重启后还认得', async () => {
  const dir = tempDir()
  const file = join(dir, 'state.json')
  try {
    await writeState(file, { enabled: true })
    assert.deepEqual(readState(file), { enabled: true })
    assert.match(readFileSync(file, 'utf8'), /"enabled":\s*true/)

    await writeState(file, { enabled: false })
    assert.deepEqual(readState(file), { enabled: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('坏文件 / 缺文件 / 空目录：一律当作没存过，不抛', () => {
  const dir = tempDir()
  const file = join(dir, 'state.json')
  try {
    assert.equal(readState(undefined), undefined)
    assert.equal(readState(join(dir, 'nope.json')), undefined)

    writeFileSync(file, '{ not json')
    assert.equal(readState(file), undefined)

    writeFileSync(file, JSON.stringify({ enabled: 'yes' }))
    assert.equal(readState(file), undefined)

    writeFileSync(file, JSON.stringify([1, 2, 3]))
    assert.equal(readState(file), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createSwitch：持久化值优先于配置默认值', async () => {
  const dir = tempDir()
  const file = join(dir, 'state.json')
  try {
    await writeState(file, { enabled: true })
    const fromDisk = createSwitch({ fallback: false, file })
    assert.equal(fromDisk.isEnabled(), true, '磁盘上的值说了算')

    const missing = createSwitch({ fallback: true, file: join(dir, 'missing.json') })
    assert.equal(missing.isEnabled(), true, '没存过就用配置默认值')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createSwitch：写入立刻生效，并把值落盘', async () => {
  const dir = tempDir()
  const file = join(dir, 'state.json')
  try {
    const errors: unknown[] = []
    const sw = createSwitch({ fallback: false, file, onPersistError: (error) => errors.push(error) })
    await sw.setEnabled(true)
    assert.equal(sw.isEnabled(), true)
    assert.deepEqual(readState(file), { enabled: true })
    assert.deepEqual(errors, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createSwitch：落盘失败只在回调里报，进程内状态照样生效', async () => {
  const errors: unknown[] = []
  // 指向一个不存在的父目录下的不可写路径：写一定会失败
  const sw = createSwitch({ fallback: false, file: '/dev/null/nope/state.json', onPersistError: (error) => errors.push(error) })
  await sw.setEnabled(true)
  assert.equal(sw.isEnabled(), true)
  assert.equal(errors.length, 1)
})
