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
    await writeState(file, { enabled: true, voiceId: 'baidu' })
    assert.deepEqual(readState(file), { enabled: true, voiceId: 'baidu' })
    assert.match(readFileSync(file, 'utf8'), /"enabled":\s*true/)
    assert.match(readFileSync(file, 'utf8'), /"voiceId":\s*"baidu"/)

    await writeState(file, { enabled: false, voiceId: 'say:Meijia' })
    assert.deepEqual(readState(file), { enabled: false, voiceId: 'say:Meijia' })
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

test('老格式：只有 enabled，或只有裸的 sayVoice，都能读出来', () => {
  const dir = tempDir()
  const file = join(dir, 'state.json')
  try {
    writeFileSync(file, JSON.stringify({ enabled: true, updatedAt: 'x' }))
    assert.deepEqual(readState(file), { enabled: true })

    // 上一版把「离线音色」存成裸名字（sayVoice），要迁成 say: 前缀
    writeFileSync(file, JSON.stringify({ enabled: false, sayVoice: 'Eddy (中文（中国大陆）)' }))
    assert.deepEqual(readState(file), { enabled: false, voiceId: 'say:Eddy (中文（中国大陆）)' })

    writeFileSync(file, JSON.stringify({ enabled: 'yes', voiceId: 'baidu' }))
    assert.deepEqual(readState(file), { voiceId: 'baidu' }, '坏字段只丢那一个')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createStateStore：持久化值优先于配置默认值', () => {
  const dir = tempDir()
  const file = join(dir, 'state.json')
  try {
    writeFileSync(file, JSON.stringify({ enabled: true, voiceId: 'say:Reed (中文（中国大陆）)' }))
    const store = createStateStore({ fallback: { enabled: false, voiceId: 'baidu' }, file })
    assert.deepEqual(store.get(), { enabled: true, voiceId: 'say:Reed (中文（中国大陆）)' })

    const missing = createStateStore({ fallback: { enabled: true, voiceId: 'baidu' }, file: join(dir, 'missing.json') })
    assert.deepEqual(missing.get(), { enabled: true, voiceId: 'baidu' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createStateStore：合并写，立刻生效并落盘', async () => {
  const dir = tempDir()
  const file = join(dir, 'state.json')
  try {
    const errors: unknown[] = []
    const store = createStateStore({ fallback: { enabled: false, voiceId: 'baidu' }, file, onPersistError: (e) => errors.push(e) })

    await store.set({ enabled: true })
    assert.deepEqual(store.get(), { enabled: true, voiceId: 'baidu' })
    assert.deepEqual(readState(file), { enabled: true, voiceId: 'baidu' })

    await store.set({ voiceId: 'say:Meijia' })
    assert.deepEqual(store.get(), { enabled: true, voiceId: 'say:Meijia' })
    assert.deepEqual(readState(file), { enabled: true, voiceId: 'say:Meijia' })
    assert.deepEqual(errors, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createStateStore：落盘失败只在回调里报，进程内状态照样生效', async () => {
  const errors: unknown[] = []
  const store = createStateStore({
    fallback: { enabled: false, voiceId: 'baidu' },
    file: '/dev/null/nope/state.json',
    onPersistError: (error) => errors.push(error),
  })
  await store.set({ enabled: true })
  assert.equal(store.get().enabled, true)
  assert.equal(errors.length, 1)
})
