import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseNoteInput, planInjection, renderSection, normalizeTags, describeNotes, displayTitle, appliesTo,
  pathWithin, parseArgs, effectiveNotes, skillCandidate, skillDefinition, mcpEntry, LIMITS,
} from '../src/notes.js'
import { NoteStore } from '../src/store.js'
import { createHandler, GUARD_HEADER } from '../src/routes.js'
import { createNote, deleteNote, restoreNote } from '../src/mutations.js'
import { collectSystem, _resetSystemCache } from '../src/system.js'
import { apply } from '../index.js'

const note = (over = {}) => ({
  id: 'a', kind: 'prompt', scope: 'global', target: '', title: 'T', body: 'body', tags: [], color: 'yellow',
  enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
})
const skillNote = (over = {}) => note({ kind: 'skill', color: 'blue', body: '# steps\n1. do it', skill: { name: 'go-review', description: 'Review Go code' }, ...over })
const mcpNote = (over = {}) => note({ kind: 'mcp', color: 'green', body: '', mcp: { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'srv'], url: '' }, ...over })
/** 等 pollMs=20 的探测至少跑过一轮（探测间隔 20ms，留足余量）。 */
const tick = () => new Promise((r) => setTimeout(r, 120))
const tmp = () => mkdtempSync(join(tmpdir(), 'pn-'))

// ───────── 作用域 ─────────
test('pathWithin: 子目录/相等为真；兄弟前缀不算；相对路径与空值为假', () => {
  assert.equal(pathWithin('/a/b/c', '/a/b'), true)
  assert.equal(pathWithin('/a/b', '/a/b'), true)
  assert.equal(pathWithin('/a/b/', '/a/b'), true)
  assert.equal(pathWithin('/a/bc', '/a/b'), false)
  assert.equal(pathWithin('/a', '/a/b'), false)
  assert.equal(pathWithin('rel', '/a'), false)
  assert.equal(pathWithin(undefined, '/a'), false)
})

test('appliesTo: global 总适用；session 只认同 id；workspace 看 cwd；无上下文只剩 global', () => {
  const g = note(); const s = note({ scope: 'session', target: 'S1' }); const w = note({ scope: 'workspace', target: '/proj' })
  assert.equal(appliesTo(g, {}), true)
  assert.equal(appliesTo(s, { sessionId: 'S1' }), true)
  assert.equal(appliesTo(s, { sessionId: 'S2' }), false)
  assert.equal(appliesTo(s, {}), false)
  assert.equal(appliesTo(w, { cwd: '/proj/sub' }), true)
  assert.equal(appliesTo(w, { cwd: '/other' }), false)
  assert.equal(appliesTo(w, undefined), false)
})

// ───────── 校验 ─────────
test('parseNoteInput: prompt 默认 global/yellow/启用；缺正文拒绝', () => {
  assert.equal(parseNoteInput({ title: 'x' }).ok, false)
  assert.equal(parseNoteInput([]).ok, false)
  const r = parseNoteInput({ body: '  hi\r\nthere  ' })
  assert.deepEqual(r.value, { kind: 'prompt', scope: 'global', target: '', title: '', body: 'hi\nthere', tags: [], color: 'yellow', enabled: true })
})

test('parseNoteInput: skill 需要 kebab 名 + 描述 + 正文；默认蓝纸', () => {
  const ok = parseNoteInput({ kind: 'skill', body: 'steps', skill: { name: 'go-review', description: ' Review   Go ' } })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.skill.description, 'Review Go')
  assert.equal(ok.value.color, 'blue')
  for (const bad of [
    { kind: 'skill', body: 'x', skill: { name: 'Go_Review', description: 'd' } },
    { kind: 'skill', body: 'x', skill: { name: 'ok', description: '' } },
    { kind: 'skill', body: '', skill: { name: 'ok', description: 'd' } },
    { kind: 'skill', body: 'x' },
  ]) assert.equal(parseNoteInput(bad).ok, false, JSON.stringify(bad))
})

test('parseNoteInput: mcp 按 transport 校验；默认不启用；url 只收 http(s)', () => {
  const stdio = parseNoteInput({ kind: 'mcp', mcp: { name: 'fs', transport: 'stdio', command: 'npx', args: '-y "my pkg" --flag' } })
  assert.equal(stdio.ok, true)
  assert.deepEqual(stdio.value.mcp.args, ['-y', 'my pkg', '--flag'])
  assert.equal(stdio.value.enabled, false)
  assert.equal(stdio.value.color, 'green')
  assert.equal(parseNoteInput({ kind: 'mcp', mcp: { name: 'w', transport: 'streamable-http', url: 'http://localhost:3000/mcp' } }).ok, true)
  for (const bad of [
    { kind: 'mcp', mcp: { name: 'bad name!', transport: 'stdio', command: 'x' } },
    { kind: 'mcp', mcp: { name: 'a', transport: 'stdio', command: '' } },
    { kind: 'mcp', mcp: { name: 'a', transport: 'streamable-http', url: 'file:///etc/passwd' } },
    { kind: 'mcp', mcp: { name: 'a', transport: 'ws', url: 'http://x' } },
    { kind: 'mcp' },
  ]) assert.equal(parseNoteInput(bad).ok, false, JSON.stringify(bad))
})

test('parseNoteInput: scope 校验（session 要 id；workspace 要绝对路径并规整；global 清空 target）', () => {
  assert.equal(parseNoteInput({ body: 'x', scope: 'session' }).ok, false)
  assert.equal(parseNoteInput({ body: 'x', scope: 'session', target: 'bad id!' }).ok, false)
  assert.equal(parseNoteInput({ body: 'x', scope: 'workspace', target: 'rel/path' }).ok, false)
  assert.equal(parseNoteInput({ body: 'x', scope: 'galaxy' }).ok, false)
  assert.equal(parseNoteInput({ body: 'x', scope: 'workspace', target: '/a/b/../c/' }).value.target, '/a/c')
  assert.equal(parseNoteInput({ body: 'x', scope: 'global', target: '/ignored' }).value.target, '')
})

test('parseNoteInput: 类型/枚举/长度不合法一律拒绝', () => {
  assert.equal(parseNoteInput({ body: 1 }).ok, false)
  assert.equal(parseNoteInput({ body: 'x', color: 'neon' }).ok, false)
  assert.equal(parseNoteInput({ body: 'x', enabled: 'yes' }).ok, false)
  assert.equal(parseNoteInput({ body: 'x'.repeat(LIMITS.body + 1) }).ok, false)
  assert.equal(parseNoteInput({ kind: 'laser', body: 'x' }).ok, false)
})

test('parseNoteInput: 更新只返回变化字段；不能改 kind；不能清空正文；改 scope 须带 target', () => {
  const base = note({ id: 'n1' })
  assert.deepEqual(parseNoteInput({ enabled: false }, { base }).value, { enabled: false })
  assert.equal(parseNoteInput({ kind: 'skill' }, { base }).ok, false)
  assert.equal(parseNoteInput({ body: '  ' }, { base }).ok, false)
  assert.equal(parseNoteInput({ scope: 'session' }, { base }).ok, false)
  assert.deepEqual(parseNoteInput({ scope: 'session', target: 'S1' }, { base }).value, { scope: 'session', target: 'S1' })
  const sk = skillNote()
  assert.deepEqual(parseNoteInput({ skill: { description: 'New desc' } }, { base: sk }).value, { skill: { name: 'go-review', description: 'New desc' } })
})

test('normalizeTags / parseArgs', () => {
  assert.deepEqual(normalizeTags('#Go, go ,，TS\nrust'), ['Go', 'TS', 'rust'])
  assert.equal(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, LIMITS.tags)
  assert.deepEqual(parseArgs("a 'b c' \"d \\\"e\\\"\""), ['a', 'b c', 'd "e"'])
  assert.deepEqual(parseArgs(['x', 3, 'y']), ['x', 'y'])
})

// ───────── 注入计划 ─────────
test('planInjection: 只注入适用于观察者的 prompt 便签；顺序按创建时间', () => {
  const notes = [
    note({ id: 'late', createdAt: '2026-03-01T00:00:00Z' }),
    note({ id: 'early', createdAt: '2026-01-01T00:00:00Z' }),
    note({ id: 'off', enabled: false }),
    note({ id: 'mine', scope: 'session', target: 'S1', createdAt: '2026-04-01T00:00:00Z' }),
    note({ id: 'theirs', scope: 'session', target: 'S2', createdAt: '2026-04-02T00:00:00Z' }),
    note({ id: 'ws', scope: 'workspace', target: '/proj', createdAt: '2026-04-03T00:00:00Z' }),
    skillNote({ id: 'skill' }),
  ]
  const ids = (viewer) => planInjection(notes, 0, { viewer }).injected.map((n) => n.id)
  assert.deepEqual(ids({}), ['early', 'late'])
  assert.deepEqual(ids({ sessionId: 'S1' }), ['early', 'late', 'mine'])
  assert.deepEqual(ids({ sessionId: 'S2', cwd: '/proj/x' }), ['early', 'late', 'theirs', 'ws'])
})

test('planInjection: 超预算整条放弃（不截断），后面更短的仍可入选；paused 全不注入', () => {
  const big = note({ id: 'big', body: 'x'.repeat(500) })
  const small = note({ id: 'small', body: 'y', createdAt: '2026-01-02T00:00:00Z' })
  const plan = planInjection([big, small], 400)
  assert.deepEqual(plan.injected.map((n) => n.id), ['small'])
  assert.deepEqual(plan.overflow, ['big'])
  assert.ok(!renderSection(plan.injected).includes('xxxxx'))
  const paused = planInjection([note()], 8000, { paused: true })
  assert.deepEqual([paused.injected, paused.overflow], [[], []])
})

test('预算只算 prompt；换一个观察者，溢出的也跟着变', () => {
  const notes = [note({ id: 'a', body: 'x'.repeat(300) }), note({ id: 'b', scope: 'session', target: 'S1', body: 'y'.repeat(300) })]
  assert.deepEqual(planInjection(notes, 700, { viewer: {} }).overflow, [])
  assert.deepEqual(planInjection(notes, 700, { viewer: { sessionId: 'S1' } }).overflow, ['b'])
})

test('renderSection: 无注入 → 空串；{{ 原样保留；标题缺省取正文首行', () => {
  assert.equal(renderSection([]), '')
  assert.match(renderSection([note({ title: '', body: '## 规则\n用 Go 1.22' })]), /### 规则\n## 规则/)
  assert.ok(renderSection([note({ body: 'use {{{a}}} literally' })]).includes('{{{a}}}'))
  assert.equal(displayTitle(skillNote({ title: '' })), 'go-review')
  assert.equal(displayTitle(mcpNote({ title: '' })), 'fs')
})

test('describeNotes: 状态五分（injected/overflow/paused/elsewhere/off），MCP 带运行时状态', () => {
  const notes = [
    note({ id: '1' }),
    note({ id: '2', enabled: false }),
    note({ id: '3', body: 'z'.repeat(5000), createdAt: '2026-02-01T00:00:00Z' }),
    note({ id: '4', scope: 'session', target: 'OTHER' }),
    skillNote({ id: '5' }),
    mcpNote({ id: '6', enabled: true }),
  ]
  const viewer = { sessionId: 'S1' }
  const plan = planInjection(notes, 600, { viewer })
  const d = describeNotes(notes, plan, { viewer, runtime: { fs: { state: 'connected' } } })
  assert.deepEqual(Object.fromEntries(d.map((n) => [n.id, n.status])), { 1: 'injected', 2: 'off', 3: 'overflow', 4: 'elsewhere', 5: 'injected', 6: 'injected' })
  assert.equal(d[5].runtime.state, 'connected')
  const offMcp = describeNotes([mcpNote({ enabled: false })], plan, { viewer, runtime: { fs: { state: 'connected' } } })[0]
  assert.equal(offMcp.runtime, undefined) // 未启用的便签不借用同名服务器的状态
  assert.equal(describeNotes(notes, planInjection(notes, 600, { viewer, paused: true }), { viewer, paused: true })[0].status, 'paused')
})

test('effectiveNotes / skill 与 MCP 适配', () => {
  const notes = [skillNote({ id: 's' }), skillNote({ id: 'x', enabled: false }), skillNote({ id: 'w', scope: 'workspace', target: '/p', skill: { name: 'w-skill', description: 'd' } })]
  assert.deepEqual(effectiveNotes(notes, 'skill', { cwd: '/p/a' }).map((n) => n.id), ['s', 'w'])
  assert.deepEqual(effectiveNotes(notes, 'skill', { cwd: '/p/a' }, true), [])
  const c = skillCandidate(notes[0])
  assert.equal(c.name, 'go-review'); assert.equal(c.locator, 's'); assert.equal(c.invocation.modelInvocable, true)
  assert.equal(skillDefinition(notes[0]).content, notes[0].body)
  assert.ok(!('locator' in skillDefinition(notes[0])))
  assert.deepEqual(mcpEntry(mcpNote()), { transport: 'stdio', command: 'npx', args: ['-y', 'srv'] })
  assert.deepEqual(mcpEntry(mcpNote({ mcp: { name: 'w', transport: 'streamable-http', command: '', args: [], url: 'http://x/mcp' } })), { transport: 'streamable-http', url: 'http://x/mcp' })
})

// ───────── store ─────────
test('NoteStore: 写盘 → 重开可读回；原子写不留临时文件', async () => {
  const dir = tmp(); const file = join(dir, 'sub', 'notes.json')
  await new NoteStore(file).mutate((d) => { d.notes.push(note({ id: 'n1' })) })
  assert.deepEqual(readdirSync(join(dir, 'sub')), ['notes.json'])
  assert.equal(new NoteStore(file).snapshot().notes[0].id, 'n1')
  const onDisk = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(onDisk.version, 3)
  assert.deepEqual(onDisk.trash, [], '新文件带一个空的回收站')
  rmSync(dir, { recursive: true })
})

test('NoteStore: v1 文件自动升级（补 kind/scope，旧颜色映射到纸色），不丢数据', () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  writeFileSync(file, JSON.stringify({ version: 1, paused: true, notes: [
    { id: 'old', title: 'Go', body: '用 errors.Is', tags: ['go'], color: 'success', enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
  ] }))
  const s = new NoteStore(file); const n = s.snapshot().notes[0]
  assert.deepEqual([n.id, n.kind, n.scope, n.color, n.enabled, n.createdAt, s.snapshot().paused], ['old', 'prompt', 'global', 'green', true, '2026-01-01T00:00:00Z', true])
  rmSync(dir, { recursive: true })
})

test('NoteStore: 损坏文件 → 留备份、按空处理；非法条目被跳过并留备份', () => {
  const dir = tmp(); const bad = join(dir, 'bad.json'); writeFileSync(bad, '{ not json')
  const warns = []
  assert.deepEqual(new NoteStore(bad, (m) => warns.push(m)).snapshot().notes, [])
  assert.ok(readdirSync(dir).some((f) => f.includes('.corrupt-')))
  const part = join(dir, 'part.json')
  writeFileSync(part, JSON.stringify({ notes: [{ id: 'ok', body: 'fine' }, { id: 'bad', kind: 'skill', body: 'x', skill: { name: 'BAD NAME', description: 'd' } }, 'garbage'] }))
  const s = new NoteStore(part, (m) => warns.push(m))
  assert.deepEqual(s.snapshot().notes.map((n) => n.id), ['ok'])
  assert.ok(readdirSync(dir).some((f) => f.startsWith('part.json.invalid-')))
  rmSync(dir, { recursive: true })
})

test('NoteStore: mutate 前重读不覆盖外部手改；并发 mutate 不丢更新', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json'); const s = new NoteStore(file)
  await s.mutate((d) => { d.notes.push(note({ id: 'mine' })) })
  const disk = JSON.parse(readFileSync(file, 'utf8')); disk.notes.push(note({ id: 'external' }))
  writeFileSync(file, JSON.stringify(disk))
  await s.mutate((d) => { d.notes.find((n) => n.id === 'mine').title = 'edited' })
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).notes.map((n) => n.id).sort(), ['external', 'mine'])
  await Promise.all(Array.from({ length: 15 }, (_, i) => s.mutate((d) => { d.notes.push(note({ id: `n${i}` })) })))
  assert.equal(s.snapshot().notes.length, 17)
  rmSync(dir, { recursive: true })
})

test('NoteStore: poll 感知外部改动并通知订阅者；mutate 也通知', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json'); const s = new NoteStore(file)
  let hits = 0; const off = s.subscribe(() => { hits++ })
  await s.mutate((d) => { d.notes.push(note({ id: 'a' })) })
  assert.equal(hits, 1)
  assert.equal(s.poll(), false)
  const disk = JSON.parse(readFileSync(file, 'utf8')); disk.notes.push(note({ id: 'b' })); writeFileSync(file, JSON.stringify(disk))
  assert.equal(s.poll(), true)
  assert.equal(hits, 2)
  assert.equal(s.snapshot().notes.length, 2)
  off(); await s.mutate((d) => { d.paused = true }); assert.equal(hits, 2)
  rmSync(dir, { recursive: true })
})

// ───────── routes（真实 HTTP） ─────────
async function withServer(fn, { maxChars = 8000, host } = {}) {
  const dir = tmp(); const file = join(dir, 'notes.json'); const store = new NoteStore(file)
  const server = http.createServer(createHandler({ store, maxChars, order: 100, file, host }))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}/dsh-prompt-notes`
  const call = async (path, method = 'GET', body, headers = { [GUARD_HEADER]: '1' }) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  try { await fn(call, store) } finally { server.close(); rmSync(dir, { recursive: true }) }
}

test('routes: 新建 prompt → injected → 预览含正文；停用 → off；删除 → 消失', async () => {
  await withServer(async (call) => {
    const c = await call('/notes', 'POST', { title: 'Go', body: '用 errors.Is', tags: 'go' })
    assert.equal(c.status, 201); assert.equal(c.json.notes[0].status, 'injected')
    const p = await call('/preview'); assert.match(p.json.text, /用 errors\.Is/)
    const id = c.json.notes[0].id
    assert.equal((await call(`/notes/${id}`, 'PUT', { enabled: false })).json.notes[0].status, 'off')
    assert.equal((await call('/preview')).json.text, '')
    assert.equal((await call(`/notes/${id}`, 'DELETE')).json.notes.length, 0)
    assert.equal((await call(`/notes/${id}`, 'PUT', { enabled: true })).status, 404)
  })
})

test('routes: 状态与预览相对观察者（?session=&cwd=）', async () => {
  await withServer(async (call) => {
    await call('/notes', 'POST', { body: 'global one' })
    await call('/notes', 'POST', { body: 'session one', scope: 'session', target: 'S1' })
    await call('/notes', 'POST', { body: 'ws one', scope: 'workspace', target: '/proj' })
    const st = (q) => call(`/state?${q}`).then((r) => Object.fromEntries(r.json.notes.map((n) => [n.body, n.status])))
    assert.deepEqual(await st(''), { 'global one': 'injected', 'session one': 'elsewhere', 'ws one': 'elsewhere' })
    assert.deepEqual(await st('session=S1&cwd=%2Fproj%2Fsub'), { 'global one': 'injected', 'session one': 'injected', 'ws one': 'injected' })
    const pv = (await call('/preview?session=S2&cwd=%2Fproj')).json
    assert.ok(pv.text.includes('ws one') && pv.text.includes('global one') && !pv.text.includes('session one'))
    assert.equal((await call('/state?session=bad%20id&cwd=rel')).status, 200) // 非法查询参数被忽略而不是报错
  })
})

test('routes: skill / mcp 新建；重名冲突 409；MCP 默认不启用；不能改 kind', async () => {
  await withServer(async (call) => {
    const sk = { kind: 'skill', body: 'steps', skill: { name: 'go-review', description: 'Review Go' } }
    assert.equal((await call('/notes', 'POST', sk)).status, 201)
    assert.equal((await call('/notes', 'POST', sk)).status, 409)
    assert.equal((await call('/notes', 'POST', { ...sk, scope: 'session', target: 'S1' })).status, 201) // 不同作用域可同名
    const mc = { kind: 'mcp', mcp: { name: 'fs', transport: 'stdio', command: 'npx', args: '-y srv' } }
    const made = await call('/notes', 'POST', mc)
    assert.equal(made.status, 201)
    const m = made.json.notes.find((n) => n.kind === 'mcp'); assert.equal(m.enabled, false); assert.equal(m.status, 'off')
    assert.equal((await call('/notes', 'POST', mc)).status, 409)
    assert.equal((await call(`/notes/${m.id}`, 'PUT', { kind: 'prompt' })).status, 400)
    const upd = await call(`/notes/${m.id}`, 'PUT', { enabled: true, scope: 'workspace', target: '/proj' })
    assert.equal(upd.json.notes.find((n) => n.id === m.id).status, 'elsewhere')
  })
})

test('routes: 总开关 paused 让一切变 paused；预览为空', async () => {
  await withServer(async (call) => {
    await call('/notes', 'POST', { body: 'x' })
    assert.equal((await call('/paused', 'PUT', { paused: true })).json.notes[0].status, 'paused')
    assert.equal((await call('/preview')).json.text, '')
    assert.equal((await call('/paused', 'PUT', { paused: 'x' })).status, 400)
  })
})

test('routes: 写请求没带防护头 / 跨站 → 403；读不受限；坏输入 400；超预算 overflow', async () => {
  await withServer(async (call) => {
    assert.equal((await call('/notes', 'POST', { body: 'x' }, {})).status, 403)
    assert.equal((await call('/notes', 'POST', { body: 'x' }, { [GUARD_HEADER]: '1', 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await call('/state', 'GET', undefined, {})).status, 200)
    assert.equal((await call('/notes', 'POST', { body: '' })).status, 400)
    assert.equal((await call('/nope')).status, 404)
    assert.equal((await call('/notes', 'POST', { body: 'x'.repeat(2000) })).json.notes[0].status, 'overflow')
  }, { maxChars: 500 })
})

test('routes: /system 经 host 取真实内容；host 缺失时退化而不抛', async () => {
  let seen
  const host = { resolveViewer: (q) => q, system: async (q) => { seen = q; return { sections: [{ name: 'x' }] } }, mcpRuntime: () => ({}), liveSessionIds: () => ['S1'] }
  await withServer(async (call) => {
    assert.deepEqual((await call('/system?session=S1&cwd=%2Fp')).json, { sections: [{ name: 'x' }] })
    assert.deepEqual(seen, { sessionId: 'S1', cwd: '/p' })
    assert.deepEqual((await call('/state')).json.liveSessions, ['S1'])
  }, { host })
  await withServer(async (call) => {
    const r = await call('/system'); assert.equal(r.status, 200); assert.ok(r.json.errors.length)
  })
})

// ───────── 系统联动（用假 ctx） ─────────
test('collectSystem: 汇总真实 assemble / skills / MCP；单项失败只进 errors', async () => {
  _resetSystemCache()
  const agent = { id: 'S1', session: { s: 1 } }
  const ctx = {
    agents: { get: (id) => (id === 'S1' ? agent : undefined), list: () => [agent] },
    workingDirectory: { get: () => '/live/cwd' },
    systemPrompt: { assemble: async (c) => ({
      sections: [{ name: 'harness:identity', text: 'You are X' }, { name: 'prompt-notes:injected', text: 'mine' }],
      contexts: [{ name: 'working-directory:current', text: 'Current working directory: "/live/cwd".' }],
      tools: [{ name: 'bash' }, { name: 'mcp__fs__read' }, { name: 'mcp__fs__write' }],
      seenAgent: c.agent === agent,
    }) },
    skills: { list: async (o) => { assert.equal(o.cwd, '/live/cwd'); return [
      { name: 'a', description: 'da', source: 'user-dsh', provider: 'fs', invocation: { modelInvocable: true } },
      { name: 'go-review', description: 'd', source: 'prompt-notes', provider: 'prompt-notes', invocation: { modelInvocable: true } },
    ] } },
    mcpManager: { list: () => [{ name: 'fs', configured: false, status: { state: 'connected' } }] },
  }
  const r = await collectSystem(ctx, { sessionId: 'S1', cwd: '/stale' }, { selfSection: 'prompt-notes:injected' })
  assert.equal(r.session.cwd, '/live/cwd'); assert.equal(r.session.found, true)
  assert.deepEqual(r.sections.map((s) => [s.name, s.mine]), [['harness:identity', false], ['prompt-notes:injected', true]])
  assert.deepEqual(r.skills.map((s) => [s.name, s.mine]), [['a', false], ['go-review', true]])
  assert.deepEqual(r.mcp, [{ name: 'fs', configured: false, state: 'connected', error: undefined, tools: 2 }])
  assert.deepEqual(r.tools, { count: 3, mcpCount: 2 })
  assert.deepEqual(r.errors, [])

  _resetSystemCache()
  const broken = { ...ctx, systemPrompt: { assemble: async () => { throw new Error('boom') } }, skills: undefined, mcpManager: undefined }
  const r2 = await collectSystem(broken, { sessionId: 'nope' }, { selfSection: 'x' })
  assert.equal(r2.session.found, false)
  assert.equal(r2.errors.length, 1); assert.match(r2.errors[0], /boom/)
})

// ───────── apply：prompt / skill / MCP / guard ─────────
function fakeHost(opts = {}) {
  const sections = []; const routes = []; const providers = []; const mcp = new Map(); const guards = []; const listeners = {}
  const restrictions = [] // tools.restrict() 的调用记录
  const toolNames = opts.mcpTools ?? [] // 这个假世界里「已注册的全局工具」名
  const effects = []
  let ctx0
  const mkCtx = (extra = {}) => {
    const base = {
      effect: (fn) => { effects.push(fn) },
      on: (name, fn) => { (listeners[name] ??= []).push(fn) },
      inject: (_deps, cb) => cb(Object.defineProperties(mkCtx(extra), Object.getOwnPropertyDescriptors(ctx0?.__gated ?? {}))),
    }
    // 用描述符复制：保留 extra 里的 getter（真实 Cordis 里「未声明依赖就取服务」会抛错），而不是在展开时触发它
    return Object.defineProperties(base, Object.getOwnPropertyDescriptors(extra))
  }
  const registerProvider = (target) => (create) => {
    let invalidated = 0
    const ac = new AbortController()
    const p = create({ signal: ac.signal, invalidate: () => { invalidated++ } })
    const rec = { p, target, ac, get invalidated() { return invalidated } }
    providers.push(rec)
    return () => ac.abort()
  }
  const scopedTools = (agentId) => ({
    definitions: () => toolNames.map((name) => ({ name })),
    // 复刻真实约束：deny 里出现此刻不存在的工具名就抛错（restrict 只认已注册的全局工具）
    restrict: (filter) => {
      const known = new Set(toolNames)
      const unknown = [...filter.deny ?? [], ...filter.allow ?? []].filter((n) => !known.has(n))
      if (unknown.length) throw new Error(`tools.restrict() names unknown global tool ${unknown.join(', ')}`)
      const rec = { agent: agentId, deny: [...filter.deny ?? []], lifted: false }
      restrictions.push(rec)
      return () => { rec.lifted = true }
    },
  })
  const agents = (opts.agents ?? []).map((id) => ({ id, session: { id }, ctx: mkCtx({ skills: { registerProvider: registerProvider(id) }, tools: scopedTools(id) }) }))
  const gated = { agents: { list: () => agents, get: (id) => agents.find((a) => a.id === id) }, workingDirectory: { get: (s) => opts.cwds?.[s.id] } }
  const ctx = mkCtx({
    systemPrompt: { section: (s) => { sections.push(s); return () => {} } },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    skills: { registerProvider: registerProvider('global') },
    mcpManager: { register: (name, entry) => {
      if (opts.mcpTaken?.includes(name)) throw new Error('already configured')
      mcp.set(name, entry); return () => { mcp.delete(name) }
    }, list: () => [...mcp.keys()].map((n) => ({ name: n, configured: false, status: { state: 'connected' } })) },
    tools: {
      guard: (fn) => { guards.push(fn); return () => {} },
      definitions: () => toolNames.map((name) => ({ name })),
      // 复刻真实约束：根 ctx 上没有 scope，restrict 会拒绝（它会遮住所有 agent）
      restrict: () => { throw new Error('tools.restrict() requires a scoped context (agent.ctx)') },
    },
    // 与真实 Cordis 一致：外层 ctx 上直接访问这两个服务会抛错，只有在 inject 回调的 ctx 里才拿得到
    get agents() { throw new Error('cannot get property "agents" without inject') },
    get workingDirectory() { throw new Error('cannot get property "workingDirectory" without inject') },
    __gated: gated,
  })
  ctx0 = ctx
  return { ctx, sections, routes, providers, mcp, guards, listeners, effects, agents, restrictions }
}

test('apply: 注册 interpolate:false 的 section；无便签时为空；按 agent 的会话/cwd 过滤；enabled:false 休眠', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  const h = fakeHost({ agents: ['S1', 'S2'], cwds: { S1: '/proj/a', S2: '/other' } })
  apply(h.ctx, { file, maxChars: 5000, pollMs: 20 })
  const section = h.sections[0]
  assert.equal(section.interpolate, false); assert.equal(section.name, 'prompt-notes:injected')
  assert.equal(section.text({}), '')
  const s = new NoteStore(file)
  await s.mutate((d) => {
    d.notes.push(note({ id: 'g', body: 'GLOBAL' }), note({ id: 'w', body: 'WORKSPACE', scope: 'workspace', target: '/proj' }), note({ id: 's', body: 'SESSION', scope: 'session', target: 'S2' }))
  })
  await tick()
  const [a1, a2] = h.agents
  const t1 = section.text({ agent: a1 }); const t2 = section.text({ agent: a2 }); const t0 = section.text({})
  assert.ok(t1.includes('GLOBAL') && t1.includes('WORKSPACE') && !t1.includes('SESSION'))
  assert.ok(t2.includes('GLOBAL') && t2.includes('SESSION') && !t2.includes('WORKSPACE'))
  assert.ok(t0.includes('GLOBAL') && !t0.includes('WORKSPACE') && !t0.includes('SESSION'))
  const off = fakeHost(); apply(off.ctx, { enabled: false }); assert.equal(off.sections.length, 0)
  h.effects.forEach((f) => { try { f()?.() } catch { /* 清理定时器 */ } })
  rmSync(dir, { recursive: true })
})

test('apply: skill 提供方——全局提供方给 global+workspace；每个会话自己的提供方给 session 级；变更时 invalidate', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  await new NoteStore(file).mutate((d) => {
    d.notes.push(
      skillNote({ id: 'g', skill: { name: 'g-skill', description: 'd' } }),
      skillNote({ id: 'w', scope: 'workspace', target: '/proj', skill: { name: 'w-skill', description: 'd' } }),
      skillNote({ id: 's', scope: 'session', target: 'S1', skill: { name: 's-skill', description: 'd' } }),
      skillNote({ id: 'x', scope: 'session', target: 'S2', skill: { name: 'x-skill', description: 'd' } }),
    )
  })
  const h = fakeHost({ agents: ['S1'] })
  apply(h.ctx, { file, pollMs: 20 })
  const global = h.providers.find((p) => p.target === 'global').p
  const mine = h.providers.find((p) => p.target === 'S1').p
  const names = async (p, o) => (await p.list(o)).candidates.map((c) => c.name)
  assert.deepEqual(await names(global, { cwd: '/proj/x' }), ['g-skill', 'w-skill'])
  assert.deepEqual(await names(global, { cwd: '/elsewhere' }), ['g-skill'])
  assert.deepEqual(await names(mine, {}), ['s-skill'])
  const cand = (await global.list({ cwd: '/proj' })).candidates.find((c) => c.name === 'w-skill')
  assert.equal((await global.get(cand, { cwd: '/proj' })).content, '# steps\n1. do it')
  assert.equal(await global.get(cand, { cwd: '/elsewhere' }), undefined)
  // 后来创建的 agent 也会挂上自己的提供方
  const lateSkills = { registerProvider: (c) => { h.providers.push({ target: 'S3', p: c({ signal: new AbortController().signal, invalidate() {} }) }); return () => {} } }
  // 真实系统里 agent.ctx 必须经 inject(['skills']) 才能取到 skills；假 ctx 复刻这个约束：直接访问 .skills 会抛错
  const lateCtx = { effect() {}, get skills() { throw new Error('cannot get property "skills" without inject') }, inject: (_d, cb) => cb({ effect() {}, skills: lateSkills }) }
  const late = { id: 'S3', session: {}, ctx: lateCtx }
  await h.listeners['agent/created'][0]({ agent: late })
  assert.ok(h.providers.some((p) => p.target === 'S3'))
  // 外部改动 → 订阅者触发 invalidate
  const writer = new NoteStore(file); await writer.mutate((d) => { d.paused = true })
  const gRec = h.providers.find((p) => p.target === 'global')
  await tick()
  assert.ok(gRec.invalidated >= 1)
  assert.deepEqual(await names(global, { cwd: '/proj' }), []) // 总开关暂停 → 目录清空
  h.effects.forEach((f) => { try { f()?.() } catch { /* */ } })
  rmSync(dir, { recursive: true })
})

test('apply: MCP——启用才登记；改命令会重登记；停用/暂停撤销；重名登记失败只记录不抛；mcp:false 全不登记', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  const w = new NoteStore(file)
  await w.mutate((d) => { d.notes.push(mcpNote({ id: 'm1', enabled: true }), mcpNote({ id: 'm2', enabled: false, mcp: { name: 'other', transport: 'stdio', command: 'x', args: [], url: '' } })) })
  const h = fakeHost({ mcpTaken: ['clash'] })
  apply(h.ctx, { file, pollMs: 20 })
  assert.deepEqual([...h.mcp.keys()], ['fs'])
  await w.mutate((d) => { d.notes.find((n) => n.id === 'm1').mcp.args = ['-y', 'new'] }); await tick()
  assert.deepEqual(h.mcp.get('fs').args, ['-y', 'new'])
  await w.mutate((d) => { d.notes.push(mcpNote({ id: 'm3', enabled: true, mcp: { name: 'clash', transport: 'stdio', command: 'x', args: [], url: '' } })) }); await tick()
  assert.deepEqual([...h.mcp.keys()], ['fs']) // clash 登记失败，没有影响 fs
  const api = h.routes[0]
  assert.equal(api.path, '/dsh-prompt-notes') // 不带尾斜杠：webServer 前缀按路径段匹配，带了会 404
  // 登记失败的原因要在面板上看得到：经真实路由读 /state
  const server = http.createServer(api.handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const state = await (await fetch(`http://127.0.0.1:${server.address().port}/dsh-prompt-notes/state`)).json()
  server.close()
  const clash = state.notes.find((n) => n.id === 'm3')
  assert.deepEqual([clash.runtime.state, /already configured/.test(clash.runtime.error)], ['failed', true])
  assert.equal(state.notes.find((n) => n.id === 'm1').runtime.state, 'connected')
  await w.mutate((d) => { d.notes.find((n) => n.id === 'm1').enabled = false }); await tick()
  assert.deepEqual([...h.mcp.keys()], [])
  await w.mutate((d) => { d.notes.find((n) => n.id === 'm1').enabled = true; d.paused = true }); await tick()
  assert.deepEqual([...h.mcp.keys()], []) // 总开关
  h.effects.forEach((f) => { try { f()?.() } catch { /* */ } })
  const h2 = fakeHost(); await w.mutate((d) => { d.paused = false }); apply(h2.ctx, { file, mcp: false, pollMs: 20 })
  assert.deepEqual([...h2.mcp.keys()], [])
  h2.effects.forEach((f) => { try { f()?.() } catch { /* */ } })
  rmSync(dir, { recursive: true })
})

test('apply: MCP 作用域 guard——global 放行；workspace/session 级对不适用的调用者拒绝；非 mcp 工具不碰', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  await new NoteStore(file).mutate((d) => {
    d.notes.push(
      mcpNote({ id: 'g', enabled: true, mcp: { name: 'glob', transport: 'stdio', command: 'x', args: [], url: '' } }),
      mcpNote({ id: 'w', enabled: true, scope: 'workspace', target: '/proj', mcp: { name: 'wsonly', transport: 'stdio', command: 'x', args: [], url: '' } }),
      mcpNote({ id: 's', enabled: true, scope: 'session', target: 'S1', mcp: { name: 'wsonly_x', transport: 'stdio', command: 'x', args: [], url: '' } }),
    )
  })
  const h = fakeHost({ agents: ['S1', 'S2'], cwds: { S1: '/proj/a', S2: '/other' } })
  apply(h.ctx, { file, pollMs: 20 })
  const guard = h.guards[0]; const [s1, s2] = h.agents
  assert.equal(guard({ name: 'bash', agent: s2 }), undefined)
  assert.equal(guard({ name: 'mcp__glob__read', agent: s2 }), undefined)
  assert.equal(guard({ name: 'mcp__unknown__x', agent: s2 }), undefined)
  assert.equal(guard({ name: 'mcp__wsonly__read', agent: s1 }), undefined)
  assert.match(guard({ name: 'mcp__wsonly__read', agent: s2 }), /limited to the workspace \/proj/)
  assert.equal(guard({ name: 'mcp__wsonly_x__read', agent: s1 }), undefined) // 最长前缀匹配：wsonly_x 不被 wsonly 抢走
  assert.match(guard({ name: 'mcp__wsonly_x__read', agent: s2 }), /another session/)
  h.effects.forEach((f) => { try { f()?.() } catch { /* */ } })
  rmSync(dir, { recursive: true })
})

test('apply: MCP——只在存在适用的活动会话时才登记（会话级 / 工作区级），会话来去会跟着变', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  const mk = (name, over) => mcpNote({ enabled: true, mcp: { name, transport: 'stdio', command: 'x', args: [], url: '' }, ...over })
  await new NoteStore(file).mutate((d) => {
    d.notes.push(
      mk('glob'),
      mk('sess', { id: 's', scope: 'session', target: 'S1' }),
      mk('wsonly', { id: 'w', scope: 'workspace', target: '/proj' }),
    )
  })
  // 只有 S2 活着（cwd /other）：全局的照样登记，钉在 S1 与 /proj 上的都不该起进程
  // cwds 里先备好 S1 的目录：稍后把 S1 塞进活动列表时，workingDirectory 才查得到它
  const h = fakeHost({ agents: ['S2'], cwds: { S2: '/other', S1: '/proj/a' } })
  apply(h.ctx, { file, pollMs: 20 })
  assert.deepEqual([...h.mcp.keys()], ['glob'])

  // S1 打开（cwd 落在 /proj 里）：poll 一轮后两张都该被登记
  h.agents.push({ id: 'S1', session: { id: 'S1' }, ctx: {} })
  await tick()
  assert.deepEqual([...h.mcp.keys()].sort(), ['glob', 'sess', 'wsonly'])

  // S1 关掉：会话级与工作区级的子进程都该撤掉，全局的留着
  h.agents.splice(0, h.agents.length, { id: 'S2', session: { id: 'S2' }, ctx: {} })
  await tick()
  assert.deepEqual([...h.mcp.keys()], ['glob'])

  h.effects.forEach((f) => { try { f()?.() } catch { /* */ } })
  rmSync(dir, { recursive: true })
})

test('apply: MCP——判断不了活会话（服务缺席）时退回「总是登记」', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  await new NoteStore(file).mutate((d) => {
    d.notes.push(mcpNote({ id: 's', enabled: true, scope: 'session', target: 'NOPE', mcp: { name: 'sess', transport: 'stdio', command: 'x', args: [], url: '' } }))
  })
  const h = fakeHost({ agents: [] })
  // 把 agents 服务从 gated 里拿掉，模拟没有 agents 服务的组合
  delete h.ctx.__gated.agents
  apply(h.ctx, { file, pollMs: 20 })
  assert.deepEqual([...h.mcp.keys()], ['sess'])
  h.effects.forEach((f) => { try { f()?.() } catch { /* */ } })
  rmSync(dir, { recursive: true })
})

test('apply: MCP——不适用会话看不到 mcp 工具（tools.restrict）；便签变成全局后立刻放开', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  const mk = (name, over) => mcpNote({ enabled: true, mcp: { name, transport: 'stdio', command: 'x', args: [], url: '' }, ...over })
  await new NoteStore(file).mutate((d) => {
    d.notes.push(mk('glob'), mk('sess', { id: 's', scope: 'session', target: 'S1' }))
  })
  // 工具名是连接成功之后才存在的：这里模拟「两个服务器都连上了」
  const h = fakeHost({ agents: ['S1', 'S2'], cwds: { S1: '/p', S2: '/q' },
    mcpTools: ['bash', 'mcp__glob__read', 'mcp__sess__read'] })
  apply(h.ctx, { file, pollMs: 20 })
  await tick()

  // 只有 S2 该被藏：S1 是这张便签的主人，全局的 glob 谁都不藏
  const active = () => h.restrictions.filter((r) => !r.lifted)
  assert.deepEqual(active().map((r) => r.agent), ['S2'])
  assert.deepEqual(active()[0].deny, ['mcp__sess__read'])

  // 把便签改成全局：S2 的限制随之撤掉
  await new NoteStore(file).mutate((d) => {
    const n = d.notes.find((x) => x.mcp?.name === 'sess')
    n.scope = 'global'; n.target = ''
  })
  await tick()
  assert.deepEqual(active(), [])

  h.effects.forEach((f) => { try { f()?.() } catch { /* */ } })
  rmSync(dir, { recursive: true })
})

test('apply: MCP——工具名还没出现时不调 restrict（连接成功后才补；不存在的名字会抛错）', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  await new NoteStore(file).mutate((d) => {
    d.notes.push(mcpNote({ id: 's', enabled: true, scope: 'session', target: 'S1', mcp: { name: 'sess', transport: 'stdio', command: 'x', args: [], url: '' } }))
  })
  const toolNames = []
  const h = fakeHost({ agents: ['S1', 'S2'], mcpTools: toolNames })
  apply(h.ctx, { file, pollMs: 20 })
  await tick()
  assert.equal(h.restrictions.length, 0) // 没有工具名 → 没有可藏的东西，也不该抛错

  // 服务器连上了、工具名出现了：下一个 tick 就该把 S2 那一份藏起来（这就是「连接状态变化要重算」）
  toolNames.push('mcp__sess__read')
  await tick()
  assert.deepEqual(h.restrictions.filter((r) => !r.lifted).map((r) => r.agent), ['S2'])
  assert.deepEqual(h.restrictions.filter((r) => !r.lifted)[0].deny, ['mcp__sess__read'])
  h.effects.forEach((f) => { try { f()?.() } catch { /* */ } })
  rmSync(dir, { recursive: true })
})

test('routes: 导出 → 预览导入 → 确认导入（MCP 保持未钉住；预览里给出将执行的命令）', async () => {
  await withServer(async (call) => {
    await call('/notes', 'POST', { title: '规范', body: '回答用中文' })
    await call('/notes', 'POST', { kind: 'mcp', body: 'fixture', enabled: true, mcp: { name: 'echo', transport: 'stdio', command: 'node', args: ['x.mjs'] } })

    const exported = await call('/export')
    assert.equal(exported.status, 200)
    assert.equal(exported.json.format, 'dsh-prompt-notes')
    assert.equal(exported.json.notes.length, 2)
    const bundle = exported.json

    // 只导出一部分
    const one = await call(`/export?ids=${bundle.notes[0].id}`)
    assert.equal(one.json.notes.length, 1)

    // 预览：同 id 会另存一份；MCP 那条给出将执行的完整命令
    const preview = await call('/import/preview', 'POST', { bundle, strategy: 'rename' })
    assert.equal(preview.status, 200)
    assert.deepEqual(preview.json.counts, { create: 0, rename: 2, overwrite: 0, skip: 0 })
    assert.ok(preview.json.warnings.some((w) => w.includes('node x.mjs')))
    assert.deepEqual(preview.json.dropped, [])

    // 预览不写盘
    assert.equal((await call('/state')).json.notes.length, 2)

    // 确认导入
    const imported = await call('/import', 'POST', { bundle, strategy: 'rename' })
    assert.equal(imported.status, 200)
    assert.deepEqual(imported.json.imported, { added: 2, replaced: 0, skipped: 0 })
    assert.equal(imported.json.notes.length, 4)
    // 导出文件里 MCP 是 enabled:true；导入出来的那一张必须未钉住，原来那张不受影响
    const mcp = imported.json.notes.filter((n) => n.kind === 'mcp')
    assert.deepEqual(mcp.map((n) => [n.mcp.name, n.enabled]).sort(), [['echo', true], ['echo-2', false]])

    // 坏文件整体拒绝，且不改状态
    const bad = await call('/import', 'POST', { bundle: { format: 'nope', version: 1, notes: [] } })
    assert.equal(bad.status, 400)
    assert.equal((await call('/state')).json.notes.length, 4)
  })
})

test('NoteStore: 软删除进回收站、撤销原样回来；过期与超量的会被清掉', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  const store = new NoteStore(file)
  await createNote(store, { title: '语言规范', body: '回答用中文' })
  const id = store.snapshot().notes[0].id

  const del = await deleteNote(store, id)
  assert.deepEqual(del, { ok: true, removed: true })
  assert.equal(store.snapshot().notes.length, 0)
  assert.equal(store.snapshot().trash.length, 1)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).trash.length, 1, '回收站写在文件里，重启也还在')

  const back = await restoreNote(store, id)
  assert.equal(back.ok, true)
  assert.equal(store.snapshot().notes[0].id, id, '撤销后还是同一个 id')
  assert.equal(store.snapshot().trash.length, 0)

  // 不在回收站里的 id：报 404，不算成功
  const missing = await restoreNote(store, 'no-such-id')
  assert.equal(missing.ok, false); assert.equal(missing.status, 404)

  // 过期：31 天前删的，读盘时就该丢掉
  writeFileSync(file, JSON.stringify({ version: 3, paused: false, notes: [],
    trash: [{ deletedAt: new Date(Date.now() - 31 * 86400000).toISOString(), note: note({ id: 'old' }) }] }))
  assert.equal(new NoteStore(file).snapshot().trash.length, 0)

  // 超量：最多留 50 条（最新的在前）
  const many = Array.from({ length: 55 }, (_, i) => ({ deletedAt: new Date(Date.now() - i * 1000).toISOString(), note: note({ id: `t${i}` }) }))
  writeFileSync(file, JSON.stringify({ version: 3, paused: false, notes: [], trash: many }))
  const kept = new NoteStore(file).snapshot().trash
  assert.equal(kept.length, 50)
  assert.equal(kept[0].note.id, 't0', '最新的留下')
  assert.equal(kept.at(-1).note.id, 't49')
  rmSync(dir, { recursive: true })
})

test('routes: 删除进回收站 → 撤销；404 说明回收站里没有', async () => {
  await withServer(async (call) => {
    const c = await call('/notes', 'POST', { title: '会被删', body: 'x' })
    const id = c.json.notes[0].id
    assert.equal((await call(`/notes/${id}`, 'DELETE')).json.notes.length, 0)
    const restored = await call(`/notes/${id}/restore`, 'POST')
    assert.equal(restored.status, 200)
    assert.equal(restored.json.notes.length, 1)
    assert.equal(restored.json.notes[0].id, id)
    const again = await call(`/notes/${id}/restore`, 'POST')
    assert.equal(again.status, 404)
  })
})

test('技能便签：whenToUse 与调用策略（默认两者，两个都关会被拒）', () => {
  const base = { kind: 'skill', body: '# body', skill: { name: 'go-review', description: 'd' } }
  const plain = parseNoteInput(base)
  assert.equal(plain.ok, true)
  assert.deepEqual(plain.value.skill, { name: 'go-review', description: 'd' }, '默认值不落盘，便签文件里不多个 invocation')

  const full = parseNoteInput({ ...base, skill: { name: 'go-review', description: 'd', whenToUse: '  审查 Go 代码时  ', invocation: { modelInvocable: true, userInvocable: false } } })
  assert.equal(full.ok, true)
  assert.equal(full.value.skill.whenToUse, '审查 Go 代码时')
  assert.deepEqual(full.value.skill.invocation, { modelInvocable: true, userInvocable: false })

  assert.equal(parseNoteInput({ ...base, skill: { name: 'go-review', description: 'd', invocation: { modelInvocable: false, userInvocable: false } } }).ok, false)
  assert.match(parseNoteInput({ ...base, skill: { name: 'go-review', description: 'd', invocation: { modelInvocable: 'yes' } } }).error, /布尔/)
  assert.equal(parseNoteInput({ ...base, skill: { name: 'go-review', description: 'd', whenToUse: 'x'.repeat(301) } }).ok, false)
})

test('技能便签 → SkillCandidate / 定义带上 whenToUse 与 invocation', () => {
  const note = {
    id: 's1', kind: 'skill', body: '# body', color: 'blue',
    skill: { name: 'go-review', description: 'd', whenToUse: '审查 Go 代码时', invocation: { modelInvocable: false, userInvocable: true } },
  }
  const c = skillCandidate(note)
  assert.equal(c.whenToUse, '审查 Go 代码时')
  assert.deepEqual(c.invocation, { modelInvocable: false, userInvocable: true })
  const def = skillDefinition(note)
  assert.equal(def.content, '# body')
  assert.equal(def.whenToUse, '审查 Go 代码时')
  assert.equal(def.locator, undefined, 'locator 不该进入定义')

  const bare = skillCandidate({ ...note, skill: { name: 'x-skill', description: 'd' } })
  assert.equal(bare.whenToUse, undefined, '没写就不带这个字段')
  assert.deepEqual(bare.invocation, { modelInvocable: true, userInvocable: true })
})
