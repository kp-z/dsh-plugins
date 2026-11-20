/**
 * 分享（导出 / 预览 / 导入）的单测。
 *
 * 重点不是「能读能写」，而是几条不容易想到的边界：
 *   - 导入的 MCP 一律未钉住（哪怕文件里写着 enabled:true）；
 *   - 冲突默认重命名，不覆盖用户已有的东西；
 *   - 预览和真正导入用同一个 planImport，所以预览说"跳过"就真的不会写；
 *   - 坏文件只报告不半途写入；一条坏不影响同文件里的好条目。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../src/store.js'
import { createNote } from '../src/mutations.js'
import { packBundle, parseBundle, planImport, applyImport, SHARE_FORMAT, SHARE_LIMITS } from '../src/share.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'pn-share-'))
const quiet = () => () => {}

const note = (over = {}) => ({
  id: 'n1', kind: 'prompt', scope: 'global', target: '', title: 'T', body: 'B', tags: [], color: 'yellow',
  enabled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
})
const skillNote = (over = {}) => note({ id: 's1', kind: 'skill', color: 'blue', skill: { name: 'go-review', description: 'd' }, ...over })
const mcpNote = (over = {}) => note({ id: 'm1', kind: 'mcp', color: 'green', enabled: false,
  mcp: { name: 'echo', transport: 'stdio', command: 'node', args: ['x.mjs'], url: '' }, ...over })

test('packBundle：带 format/version；可按 id 只导出一部分；不带运行时状态', () => {
  const all = [note(), skillNote(), mcpNote()]
  const full = packBundle(all)
  assert.equal(full.format, SHARE_FORMAT)
  assert.equal(full.notes.length, 3)
  assert.ok(full.exportedAt)
  assert.deepEqual(full.notes[0].runtime, undefined)
  assert.equal(full.notes[2].mcp.name, 'echo')

  const one = packBundle(all, { ids: ['s1'] })
  assert.deepEqual(one.notes.map((n) => n.id), ['s1'])
})

test('parseBundle：格式 / 版本 / 体积 / 条数不对就整体拒绝', () => {
  assert.equal(parseBundle(null).ok, false)
  assert.equal(parseBundle([]).ok, false)
  assert.equal(parseBundle({ format: 'other', version: 1, notes: [] }).ok, false)
  assert.equal(parseBundle({ format: SHARE_FORMAT, version: 99, notes: [] }).ok, false)
  assert.equal(parseBundle({ format: SHARE_FORMAT, version: 1, notes: 'x' }).ok, false)
  const tooMany = { format: SHARE_FORMAT, version: 1, notes: Array.from({ length: SHARE_LIMITS.notes + 1 }, note) }
  assert.match(parseBundle(tooMany).error, /最多/)
  const huge = { format: SHARE_FORMAT, version: 1, notes: [note({ body: 'x'.repeat(20000) }), note({ body: 'x'.repeat(20000) }), note({ body: 'x'.repeat(20000) })] }
  // 3 × 20k 还没到 200KB，多塞几条直到超限
  while (JSON.stringify(huge).length <= SHARE_LIMITS.bytes + 1000) huge.notes.push(note({ body: 'x'.repeat(20000) }))
  assert.match(parseBundle(huge).error, /太大|文件太大/)
})

test('parseBundle：坏条目单条丢弃，好条目照收；导入的 MCP 强制未钉住', () => {
  const raw = { format: SHARE_FORMAT, version: 1, notes: [
    note({ body: '' }),                                          // 正文为空 → 丢
    'not an object',                                             // 不是对象 → 丢
    note({ id: 'ok', title: '好的一条' }),                        // 收
    mcpNote({ enabled: true }),                                  // 收，但 enabled 变 false
  ] }
  const r = parseBundle(raw)
  assert.equal(r.ok, true)
  assert.equal(r.notes.length, 2)
  assert.equal(r.dropped.length, 2)
  assert.equal(r.notes.find((n) => n.kind === 'mcp').enabled, false)
  assert.equal(r.notes.find((n) => n.title === '好的一条').sourceId, 'ok')
})

test('planImport：干净文件全是 create；同 id 按策略 rename / skip / overwrite', () => {
  const existing = [note({ id: 'a', title: '旧的' })]
  const incoming = parseBundle({ format: SHARE_FORMAT, version: 1, notes: [note({ id: 'a', title: '新的' })] }).notes

  const renamed = planImport(existing, incoming, 'rename')
  assert.deepEqual(renamed.counts, { create: 0, rename: 1, overwrite: 0, skip: 0 })
  assert.equal(renamed.actions[0].note.id, undefined, '另存一份就不该再带旧 id')

  const skipped = planImport(existing, incoming, 'skip')
  assert.deepEqual(skipped.counts, { create: 0, rename: 0, overwrite: 0, skip: 1 })

  const over = planImport(existing, incoming, 'overwrite')
  assert.equal(over.counts.overwrite, 1)
  assert.equal(over.actions[0].replaceId, 'a')
  assert.equal(over.actions[0].note.title, '新的')
  assert.equal(over.actions[0].note.createdAt, '2026-01-01T00:00:00.000Z', '覆盖保留创建时间')
})

test('planImport：技能 / MCP 同名 → 默认改成 -2；overwrite 换掉那一条；skip 不写', () => {
  const existing = [skillNote(), mcpNote()]
  const incoming = parseBundle({ format: SHARE_FORMAT, version: 1, notes: [skillNote({ id: 'x' }), mcpNote({ id: 'y', enabled: true })] }).notes

  const plan = planImport(existing, incoming, 'rename')
  const skill = plan.actions.find((a) => a.note.kind === 'skill')
  const mcp = plan.actions.find((a) => a.note.kind === 'mcp')
  assert.equal(skill.note.skill.name, 'go-review-2')
  assert.equal(mcp.note.mcp.name, 'echo-2')
  assert.equal(mcp.note.enabled, false)
  assert.ok(plan.warnings.some((w) => w.includes('node x.mjs')), '预览要显示将执行的命令')

  const over = planImport(existing, incoming, 'overwrite')
  assert.equal(over.actions.find((a) => a.note.kind === 'skill').replaceId, 's1')
  assert.equal(over.actions.find((a) => a.note.kind === 'mcp').replaceId, 'm1')

  const skip = planImport(existing, incoming, 'skip')
  assert.deepEqual(skip.counts, { create: 0, rename: 0, overwrite: 0, skip: 2 })
})

test('同一份文件里自己撞自己：第二个同名技能也会被改成 -2', () => {
  const incoming = parseBundle({ format: SHARE_FORMAT, version: 1, notes: [skillNote({ id: '1' }), skillNote({ id: '2' })] }).notes
  const plan = planImport([], incoming, 'rename')
  const names = plan.actions.map((a) => a.note.skill.name)
  assert.deepEqual(names, ['go-review', 'go-review-2'])
})

test('applyImport：一次写完全部动作；MCP 落盘仍是未钉住；预览说 skip 就真的不写', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  const store = new NoteStore(file, quiet())
  await createNote(store, { kind: 'skill', body: '# x', skill: { name: 'go-review', description: 'd' } })

  const bundle = packBundle([skillNote({ id: 'in1' }), mcpNote({ id: 'in2', enabled: true })])
  const parsed = parseBundle(bundle)
  assert.equal(parsed.ok, true)
  const plan = planImport(store.snapshot().notes, parsed.notes, 'rename')
  const result = await applyImport(store, plan)
  assert.deepEqual(result, { added: 2, replaced: 0, skipped: 0 })

  const after = store.snapshot().notes
  assert.equal(after.length, 3)
  assert.ok(after.some((n) => n.kind === 'skill' && n.skill.name === 'go-review-2'))
  const mcp = after.find((n) => n.kind === 'mcp')
  assert.equal(mcp.enabled, false, '导入的 MCP 必须未钉住')
  assert.ok(mcp.id && mcp.createdAt && mcp.updatedAt, 'id / 时间戳由 store 补齐')

  // skip 计划一行不写
  const before = store.snapshot().notes.length
  const skipPlan = planImport(store.snapshot().notes, parseBundle(bundle).notes, 'skip')
  const r2 = await applyImport(store, skipPlan)
  assert.equal(r2.added, 0)
  assert.equal(store.snapshot().notes.length, before)
  rmSync(dir, { recursive: true })
})

test('导出再导入回环：条数、kind、作用域一致（导入方是空便签簿时）', async () => {
  const dirA = tmp(); const dirB = tmp()
  const a = new NoteStore(join(dirA, 'notes.json'), quiet())
  await createNote(a, { body: 'G' })
  await createNote(a, { kind: 'skill', body: '# k', skill: { name: 'k-skill', description: 'd' }, scope: 'workspace', target: '/proj' })
  await createNote(a, { kind: 'mcp', body: 'r', mcp: { name: 'srv', transport: 'stdio', command: 'node', args: ['x'] } })

  const bundle = JSON.parse(JSON.stringify(packBundle(a.snapshot().notes)))   // 过一遍 JSON，跟真实文件一样
  const parsed = parseBundle(bundle)
  const b = new NoteStore(join(dirB, 'notes.json'), quiet())
  await applyImport(b, planImport([], parsed.notes, 'rename'))
  const back = b.snapshot().notes
  assert.deepEqual(back.map((n) => n.kind).sort(), ['mcp', 'prompt', 'skill'])
  assert.equal(back.find((n) => n.kind === 'workspace' || n.kind === 'skill').scope, 'workspace')
  assert.equal(back.find((n) => n.kind === 'mcp').enabled, false)
  rmSync(dirA, { recursive: true }); rmSync(dirB, { recursive: true })
})