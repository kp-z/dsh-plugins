import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  createStateStore,
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

test('写读往返：开关与音色都能重启后恢复', async () => {
  const dir = tempDir()
  const file = join(dir, 'state.json')
  try {
    await writeState(file, { enabled: true, sayVoice: 'Meijia' })
    assert.deepEqual(readState(file), { enabled: true, sayVoice: 'Meijia' })
    assert.match(readFileSync(file, 'utf8'), /"enabled":\s*true/)
    assert.match(readFileSync(file, 'utf8'), /"sayVoice":\s*"Meijia"/)

    await writeState(file, { enabled: false, sayVoice: '' })
    assert.deepEqual(readState(file), { enabled: false, sayVoice: '' })
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

    writeFileSync(file, JSON.stringify([1, 2, 3]))
    assert.equal(readState(file), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('老格式（只有 enabled）仍能读出来，新字段给默认', () => {
  const dir = tempDir()
  const file = join(dir, 'state.json')
  try {
    writeFileSync(file, JSON.stringify({ enabled: true, updatedAt: 'x' }))
    assert.deepEqual(readState(file), { enabled: true })

    writeFileSync(file, JSON.stringify({ enabled: 'yes', sayVoice: 'Flo (中文（中国大陆）)' }))
    assert.deepEqual(readState(file), { sayVoice: 'Flo (中文（中国大陆）)' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createStateStore：持久化值优先于配置默认值', () => {
  const dir = tempDir()
  const file = join(dir, 'state.json')
  try {
    writeFileSync(file, JSON.stringify({ enabled: true, sayVoice: 'Reed (中文（中国大陆）)' }))
    const store = createStateStore({ fallback: { enabled: false, sayVoice: '' }, file })
    assert.deepEqual(store.get(), { enabled: true, sayVoice: 'Reed (中文（中国大陆）)' })

    const missing = createStateStore({ fallback: { enabled: true, sayVoice: 'Tingting' }, file: join(dir, 'missing.json') })
    assert.deepEqual(missing.get(), { enabled: true, sayVoice: 'Tingting' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createStateStore：合并写，立刻生效并落盘', async () => {
  const dir = tempDir()
  const file = join(dir, 'state.json')
  try {
    const errors: unknown[] = []
    const store = createStateStore({ fallback: { enabled: false, sayVoice: '' }, file, onPersistError: (e) => errors.push(e) })

    await store.set({ enabled: true })
    assert.deepEqual(store.get(), { enabled: true, sayVoice: '' })
    assert.deepEqual(readState(file), { enabled: true, sayVoice: '' })

    await store.set({ sayVoice: 'Meijia' })
    assert.deepEqual(store.get(), { enabled: true, sayVoice: 'Meijia' })
    assert.deepEqual(readState(file), { enabled: true, sayVoice: 'Meijia' })
    assert.deepEqual(errors, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createStateStore：落盘失败只在回调里报，进程内状态照样生效', async () => {
  const errors: unknown[] = []
  const store = createStateStore({
    fallback: { enabled: false, sayVoice: '' },
    file: '/dev/null/nope/state.json',
    onPersistError: (error) => errors.push(error),
  })
  await store.set({ enabled: true })
  assert.equal(store.get().enabled, true)
  assert.equal(errors.length, 1)
})
