/**
 * 助手工具（note_list / note_create / note_update / note_delete）的单测。
 *
 * 这里不碰真工具注册表：直接调 createNoteToolDefinitions() 拿到的 definition，
 * 像管线那样调 definition.execute(args, exec)。注册表本身的形状（name / parameters /
 * output.render）另有一条测试单独盯住——它就是模型看到的那份 schema。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../src/store.js'
import { createNoteToolDefinitions, NOTE_TOOL_NAMES } from '../src/tools.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'pn-tools-'))
const tools = (file, viewerOf = () => ({})) => {
  const store = new NoteStore(file, () => {})
  const defs = createNoteToolDefinitions({ store, viewerOf })
  const byName = Object.fromEntries(defs.map((d) => [d.name, d]))
  return { store, defs, byName }
}
const run = (def, args, exec = {}) => def.execute(args, exec)

test('工具定义：四个名字、参数是纯 JSON、输出有 render、描述里写清了「不能启用 MCP」', () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  const { defs, byName } = tools(file)
  assert.deepEqual(defs.map((d) => d.name).sort(), [...NOTE_TOOL_NAMES].sort())
  for (const def of defs) {
    // 参数与输出必须是无损 JSON：它们要能被投影成模型看到的 schema / 结果
    assert.deepEqual(JSON.parse(JSON.stringify(def.parameters)), def.parameters)
    assert.equal(def.parameters.type, 'object')
    assert.equal(typeof def.output.render, 'function')
    assert.ok(def.output.render({}, 'x')[0].text === 'x')
  }
  assert.deepEqual(byName.note_create.parameters.required, ['body'])
  assert.deepEqual(byName.note_update.parameters.required, ['id'])
  assert.deepEqual(byName.note_delete.parameters.required, ['id'])
  assert.match(byName.note_create.description, /unpinned/i)
  assert.match(byName.note_create.description, /cannot enable/i)
  assert.match(byName.note_update.description, /MCP/i)
  rmSync(dir, { recursive: true })
})

test('note_create：提示词便签默认钉住；MCP 便签无论传什么都建成未钉住', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  const { store, byName } = tools(file)

  const made = JSON.parse((await run(byName.note_create, { body: '回答用中文', title: '语言', scope: 'global' })))
  assert.equal(made.ok, true)
  const stored = store.snapshot().notes.find((n) => n.id === made.note.id)
  assert.equal(stored.kind, 'prompt')
  assert.equal(stored.enabled, true)

  const mcp = JSON.parse((await run(byName.note_create, {
    kind: 'mcp', body: 'fixture', enabled: true, mcp: { name: 'pnecho', transport: 'stdio', command: 'node', args: ['x.mjs'] },
  })))
  assert.equal(mcp.ok, true)
  const mcpStored = store.snapshot().notes.find((n) => n.id === mcp.note.id)
  assert.equal(mcpStored.kind, 'mcp')
  assert.equal(mcpStored.enabled, false, '助手建的 MCP 必须未钉住')
  assert.match(mcp.hint, /pin/i)

  // 写的是真文件
  const onDisk = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(onDisk.notes.length, 2)
  rmSync(dir, { recursive: true })
})

test('note_create：校验走的是和 HTTP 端同一套（缺描述 / 重名都会被拒，且不写盘）', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  const { store, byName } = tools(file)
  await assert.rejects(() => run(byName.note_create, { kind: 'skill', body: '# x', skill: { name: 'go-review' } }), /描述/)
  await assert.rejects(() => run(byName.note_create, { kind: 'skill', body: '# x' }), /kebab-case|技能名/)
  assert.equal(store.snapshot().notes.length, 0)

  await run(byName.note_create, { kind: 'mcp', body: 'a', mcp: { name: 'dup', transport: 'stdio', command: 'node' } })
  await assert.rejects(() => run(byName.note_create, { kind: 'mcp', body: 'b', mcp: { name: 'dup', transport: 'stdio', command: 'node' } }), /已有一张 MCP 便签/)
  assert.equal(store.snapshot().notes.length, 1)
  rmSync(dir, { recursive: true })
})

test('note_update：改标题 / 正文可以；不能改类型；MCP 便签只能改标题正文标签', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  const { store, byName } = tools(file)
  const made = JSON.parse((await run(byName.note_create, { body: '旧正文', title: '旧标题' })))

  await run(byName.note_update, { id: made.note.id, title: '新标题', body: '新正文' })
  const updated = store.snapshot().notes.find((n) => n.id === made.note.id)
  assert.equal(updated.title, '新标题'); assert.equal(updated.body, '新正文')
  assert.equal(updated.kind, 'prompt')

  await assert.rejects(() => run(byName.note_update, { id: made.note.id, kind: 'skill' }), /不能更改便签的类型/)
  await assert.rejects(() => run(byName.note_update, { id: 'nope', title: 'x' }), /no note with id/)

  const mcp = JSON.parse((await run(byName.note_create, {
    kind: 'mcp', body: 'r', mcp: { name: 'srv', transport: 'stdio', command: 'node' },
  })))
  // 装饰字段可以改
  await run(byName.note_update, { id: mcp.note.id, title: '改名', tags: ['x'] })
  assert.equal(store.snapshot().notes.find((n) => n.id === mcp.note.id).title, '改名')
  // 但启用 / 换命令 / 换作用域一律拒绝
  await assert.rejects(() => run(byName.note_update, { id: mcp.note.id, enabled: true }), /only the user/)
  await assert.rejects(() => run(byName.note_update, { id: mcp.note.id, mcp: { name: 'srv', transport: 'stdio', command: 'rm -rf /' } }), /only the user/)
  await assert.rejects(() => run(byName.note_update, { id: mcp.note.id, scope: 'global', target: '' }), /only the user/)
  assert.equal(store.snapshot().notes.find((n) => n.id === mcp.note.id).enabled, false)
  rmSync(dir, { recursive: true })
})

test('note_delete：停止生效并进回收站（不是永久删除）；再删一次是幂等的（不抛错）', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  const { store, byName } = tools(file)
  const made = JSON.parse((await run(byName.note_create, { body: 'x' })))

  const first = JSON.parse(await run(byName.note_delete, { id: made.note.id }))
  assert.deepEqual([first.deleted, first.kind], [true, 'prompt'])
  assert.equal(store.snapshot().notes.length, 0)
  // 工具描述对模型说「进回收站、用户可撤销」——这里钉住行为，描述就不会再悄悄失真
  assert.deepEqual(store.snapshot().trash.map((t) => t.note.id), [made.note.id])
  assert.doesNotMatch(byName.note_delete.description, /permanent/i)
  assert.match(byName.note_delete.description, /trash/i)
  const second = JSON.parse(await run(byName.note_delete, { id: made.note.id }))
  assert.equal(second.deleted, false)
  rmSync(dir, { recursive: true })
})

test('note_list：按 kind 过滤；applies 相对当前会话；正文有总额度上限', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  const viewerOf = (agent) => (agent ? { sessionId: agent.id, cwd: '/proj/a' } : {})
  const { byName } = tools(file, viewerOf)

  await run(byName.note_create, { body: 'G', title: '全局的' })
  await run(byName.note_create, { body: 'S', title: '会话的', scope: 'session', target: 'S1' })
  await run(byName.note_create, { body: 'W', title: '工作区的', scope: 'workspace', target: '/proj' })
  await run(byName.note_create, { kind: 'skill', body: '# k', skill: { name: 'k-skill', description: 'd' } })

  const asS1 = JSON.parse(await run(byName.note_list, {}, { agent: { id: 'S1' } }))
  assert.equal(asS1.count, 4)
  assert.equal(asS1.notes.find((n) => n.title === '会话的').applies, true)
  assert.equal(asS1.notes.find((n) => n.title === '工作区的').applies, true)

  const asS2 = JSON.parse(await run(byName.note_list, {}, { agent: { id: 'S2' } }))
  assert.equal(asS2.notes.find((n) => n.title === '会话的').applies, false)
  assert.equal(asS2.notes.find((n) => n.title === '全局的').applies, true)

  const kinds = JSON.parse(await run(byName.note_list, { kind: 'skill' }, { agent: { id: 'S1' } }))
  assert.deepEqual(kinds.notes.map((n) => n.kind), ['skill'])

  // 正文：默认不给；要求时给，但总额度有上限
  assert.equal(asS1.notes[0].body, undefined)
  const withBody = JSON.parse(await run(byName.note_list, { includeBody: true }, { agent: { id: 'S1' } }))
  assert.ok(withBody.notes.every((n) => typeof n.body === 'string' || n.body === undefined))
  assert.ok(withBody.notes.reduce((sum, n) => sum + (n.body ? n.body.length : 0), 0) <= 6000)
  rmSync(dir, { recursive: true })
})
test('note_create / note_update：技能可以带 whenToUse 与调用策略，默认值不写进文件', async () => {
  const dir = tmp(); const file = join(dir, 'notes.json')
  const { store, byName } = tools(file)

  const made = JSON.parse(await run(byName.note_create, {
    kind: 'skill', body: '# review', skill: { name: 'go-review', description: 'd', whenToUse: '提交前', invocation: { modelInvocable: true, userInvocable: false } },
  }))
  const stored = store.snapshot().notes.find((n) => n.id === made.note.id)
  assert.deepEqual(stored.skill, { name: 'go-review', description: 'd', whenToUse: '提交前', invocation: { modelInvocable: true, userInvocable: false } })
  assert.equal(made.note.skill.whenToUse, '提交前', '工具回执里也带回来，模型才知道自己写了什么')

  // 部分更新的语义是「没给的字段不动」，所以清空要显式给空串
  await run(byName.note_update, { id: made.note.id, skill: { name: 'go-review', description: 'd', whenToUse: '', invocation: { modelInvocable: true, userInvocable: true } } })
  assert.deepEqual(store.snapshot().notes.find((n) => n.id === made.note.id).skill, { name: 'go-review', description: 'd' }, '回到默认就把 invocation / whenToUse 去掉')
  rmSync(dir, { recursive: true })
})
