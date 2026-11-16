import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { createCreationLedger } from '../creationLedger.js'
import { createBackendScope } from '../backendScope.js'
import { listLarkPages } from '../larkPages.js'
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
assert.match(source, /name: settings\.taskFields\.doc \|\| '文档',\s*accepted_types: \['text'\],\s*allow_duplicates: true/)
assert.match(source, /name, accepted_types: \['datetime', 'text'\], allow_duplicates: true, value/)
/* 预期完成是老文本列，且清单上可能被历史重试建成了两份：写入必须能容忍重名。 */
assert.match(source, /name: etaFieldName\(\), type: 'text', accepted_types: \['text'\], allow_duplicates: true/)
/* 兼容旧清单：处理状态/优先级可能是文本字段，写入不再强制 single_select，而是按实际类型编码。 */
assert.match(source, /name: '处理状态', accepted_types: \['text', 'single_select', 'multi_select'\], allow_duplicates: true, value/)
// Task creation cannot resume on another authenticated backend after POST.
const create = source.match(/  async function createTaskFromSession\([^]*?\n  }/)?.[0]
assert.ok(create)
let releaseCreate, enterCreate
const enteredCreate = new Promise(resolve => { enterCreate = resolve })
const calls = []
const captured = { createTask: async () => { calls.push('create:lark-cli'); enterCreate(); return new Promise(resolve => { releaseCreate = resolve }) }, updateTask: async () => { calls.push('rename'); return { ok: true } } }
const ctx = { settings: { cliBackend: 'lark-cli', managedTasklist: { enabled: true, guid: 'list' } }, lifecycleDisposed: false, state: { tasks: [], relations: [], workspaceLinks: {}, workspaceWrites: {}, relationSync: {} }, asString: v => v == null ? '' : String(v), nowMs: Date.now, updateRelations: () => ({ ok: true, edges: [] }), service: () => undefined, ctx: {}, ensureManagedTasklist: async () => ({ ok: true, guid: 'list' }), defaultsFromState: () => ({ assignee: 'ou_self', tasklistGuid: 'list' }), backendFor: () => captured, extractDocLinks: () => [], persistState: async () => {}, taskNo: () => 1, decorateTitle: () => 'renamed', feishuTaskNo: () => 0 }
ctx.createHash = createHash
ctx.taskCreationLedger = createCreationLedger({ load: async () => ctx.state.taskCreationReceipts || {}, save: async rows => { ctx.state.taskCreationReceipts = rows }, now: Date.now })
ctx.activeCreationKeys = new Set()
ctx.captureBackendScope = () => createBackendScope({ getSettings: () => ctx.settings, getGeneration: () => 0, isDisposed: () => ctx.lifecycleDisposed, resolveBackend: () => captured })
vm.createContext(ctx); vm.runInContext(create, ctx)
const pending = ctx.createTaskFromSession('s', { summary: 'Create' })
await enteredCreate
ctx.settings = { ...ctx.settings, cliBackend: 'feishu-sync' }
releaseCreate({ ok: true, guid: 'created', tasklistGuid: 'list' })
const result = await pending
assert.equal(result.partial, true); assert.equal(result.taskId, 'created'); assert.deepEqual(calls, ['create:lark-cli']); assert.equal(ctx.state.tasks[0].creationBackend, 'lark-cli')
assert.equal((await ctx.createTaskFromSession('s', { summary: 'Retry' })).ok, false, 'saved receipt binding blocks accidental repeat')
// Drive lists have files, not items: all pages still precede any create decision.
let page = 0
const folders = await listLarkPages(async () => ({ ok: true, data: ++page === 1 ? { files: [], has_more: true, page_token: 'second' } : { files: [{ token: 'existing', name: 'DSH', type: 'folder' }], has_more: false } }), '/drive/files', {}, () => true, 100, 'files')
assert.equal(folders.items[0].token, 'existing'); assert.equal(page, 2)
const failed = await listLarkPages(async () => ({ ok: false, detail: 'network' }), '/drive/files', {}, () => true, 100, 'files')
assert.equal(failed.ok, false)
assert.match(source, /if \(!listed\.ok\) \{ fail\(listed\.detail \|\| '文件夹列表不完整，拒绝重复创建'\); continue \}/)
console.log('PR3_COMPATIBILITY_OK: main field types, no cross-backend create, durable uncertain fields, strict complete folder discovery')
