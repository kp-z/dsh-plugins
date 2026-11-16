import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { createCreationLedger } from '../creationLedger.js'
import { createBackendScope } from '../backendScope.js'

// Every operation below runs actual production functions with pure mock adapters.
// No index import, credentials, real CLI, API, server, installation or disk state IO.
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const clone = value => JSON.parse(JSON.stringify(value))
function extract(startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `production extraction: ${startText}`)
  return source.slice(start, end)
}
const createSource = extract('  async function createTaskFromSession(', '\n  /**\n   * 从会话记录派生任务草稿')
const syncSource = extract('  async function applyTaskSync()', '\n  async function syncDocs()')
const creationPendingSource = extract('  function creationPending(', '  function pendingCreationWriteBlocked(')
const filterSource = extract('  function filterTasks(', '  function syncTasks(')
const settings = () => ({ cliBackend: 'feishu-sync', cliPath: '/mock/sync', larkCliPath: '/mock/lark', larkAccountMode: 'user', managedTasklist: { enabled: true, guid: 'list', name: 'DSH' }, taskFields: {}, priorityOptions: ['P0','P1'], tasks: { includeCompleted: false }, titlesMigrated: true })

function creationHarness({ remote, failSaveAt = 0, loaded = {} } = {}) {
  let durable = clone(loaded), saves = 0
  const calls = []
  const h = { settings: settings(), backendGeneration: 0, lifecycleDisposed: false,
    state: { tasks: [], taskCreationReceipts: clone(loaded), relations: [], relationSync: {}, workspaceLinks: {}, workspaceWrites: {} },
    backendContext: { getStore: () => null }, activeCreationKeys: new Set(), createHash, asString: v => v == null ? '' : String(v), nowMs: Date.now,
    updateRelations: () => ({ ok: true, edges: [] }), service: () => undefined, ctx: {},
    ensureManagedTasklist: async () => ({ ok: true, guid: 'list' }), defaultsFromState: () => ({ assignee: 'ou_mock', tasklistGuid: 'list' }),
    extractDocLinks: () => [], persistState: async () => {}, taskNo: () => 1, decorateTitle: title => title,
    /* 编号来自飞书任务号；这里 task_get 返回空，所以创建出来的任务没有号。 */
    feishuTaskNo: () => 0,
    writeTaskRelations: async () => ({ ok: true }), syncTasks: async () => ({ ok: true }), linkTask: async () => ({ ok: true }), relationView: () => ({ edges: [] }),
  }
  const impl = {
    createTask: async (captured, input) => { calls.push({ backend: captured.cliBackend, op: 'create', input }); return remote ? remote(h) : { ok: true, guid: 'created', tasklistGuid: 'list' } },
    updateTask: async () => { calls.push({ op: 'rename' }); return { ok: true } },
    actions: async () => { calls.push({ op: 'actions' }); return { ok: true, actions: [] } },
  }
  h.captureBackendScope = () => createBackendScope({ getSettings: () => h.settings, getGeneration: () => h.backendGeneration, isDisposed: () => h.lifecycleDisposed, resolveBackend: () => impl })
  const reload = () => { h.taskCreationLedger = createCreationLedger({ load: async () => clone(durable), save: async rows => {
    saves++; if (saves === failSaveAt) throw new Error('mock durable save failure')
    durable = clone(rows); h.state.taskCreationReceipts = clone(rows)
  }, now: Date.now }) }
  reload(); vm.createContext(h); vm.runInContext(createSource + '\n' + creationPendingSource, h)
  return { h, calls, reload, durable: () => clone(durable) }
}
async function blockedRetries(h, calls, taskId = 'created') {
  for (const input of [{ summary: 'different key' }, { summary: 'follow-up different key', followUp: true, requestId: 'another' }]) {
    const result = await h.createTaskFromSession('session', input)
    assert.equal(result.ok, false); assert.equal(result.taskId, taskId)
  }
  assert.equal(calls.filter(c => c.op === 'create').length, 1)
}
// A creates a GUID, switching to B during create stops everything after POST.
{
  const { h, calls, reload, durable } = creationHarness({ remote: async h => {
    h.settings.cliBackend = 'lark-cli'; h.backendGeneration++
    return { ok: true, guid: 'created', tasklistGuid: 'list' }
  } })
  const result = await h.createTaskFromSession('session', { summary: 'original', requestId: 'original' })
  assert.equal(result.ok, false); assert.equal(result.partial, true); assert.equal(result.taskId, 'created')
  /* 建完还会 task_get 读飞书任务号（编号来源），所以这里只看创建那一次。 */
  assert.deepEqual(calls.filter(c => c.op !== 'actions').map(c => c.op), ['create'])
  assert.equal(h.state.tasks[0].creationBackend, 'feishu-sync')
  assert.equal(Object.values(durable())[0].status, 'partial')
  assert.equal(Object.values(durable())[0].taskId, 'created')
  await blockedRetries(h, calls)
  // Production applyTaskSync must retain the partial task even when both the
  // remote result and filter exclude it, without relying on a binding or done flag.
  Object.assign(h, {
    backendInfo: () => ({ label: 'mock' }), backend: () => ({ listTasks: async () => ({ ok: true, list: [{ id: 'created', title: 'filtered remote task', done: false }] }) }),
    enrichRemote: async () => {}, normalizeTask: raw => raw, enrichWorkspace: x => x,
    auditBindings: () => false, renumberTasks: () => {},
  })
  for (const name of ['backfillDocTitles','ensureWorkspaceOptions','recordDailyMetrics','fillWorkspaceFields','pushTaskChanges','repairSessionWorkspaces']) h[name] = async () => {}
  h.settings.tasks.keyword = 'does-not-match-any-task'
  h.settings.tasks.dueWithinDays = 0
  vm.runInContext(filterSource + '\n' + syncSource, h)
  assert.equal(h.filterTasks([{ id: 'created', title: 'filtered remote task', done: false }]).length, 0)
  const synced = await h.applyTaskSync()
  assert.equal(synced.ok, true); assert.equal(h.state.tasks.length, 1); assert.equal(h.state.tasks[0].id, 'created')
  assert.equal(h.state.tasks[0].done, false); assert.equal(h.state.bindings, undefined)
  await blockedRetries(h, calls)
  h.state.tasks = []
  await blockedRetries(h, calls)
  reload(); await blockedRetries(h, calls)
  assert.equal(Object.values(await h.taskCreationLedger.list())[0].status, 'partial')
  // A genuinely fresh VM/ledger loaded only from durable receipts still blocks.
  const fresh = creationHarness({ loaded: durable() })
  for (const input of [{ summary: 'new' }, { summary: 'follow-up', followUp: true }]) assert.equal((await fresh.h.createTaskFromSession('session', input)).taskId, 'created')
  assert.equal(fresh.calls.length, 0)
}
// Successful completion is reused by requestId even with changed title/followUp and no tasks snapshot.
{
  const { h, calls, reload } = creationHarness()
  const first = await h.createTaskFromSession('session', { summary: 'done', requestId: 'stable' })
  assert.equal(first.ok, true)
  assert.equal((await h.taskCreationLedger.list())[0].status, 'done')
  h.state.tasks = []; reload()
  const reused = await h.createTaskFromSession('session', { summary: 'changed', requestId: 'stable', followUp: true })
  assert.equal(reused.ok, true); assert.equal(reused.reused, true); assert.equal(reused.taskId, first.taskId)
  assert.equal(calls.filter(c => c.op === 'create').length, 1)
}
// Both preparation and sending persistence must succeed before create IO.
for (const failSaveAt of [1, 2]) {
  const { h, calls } = creationHarness({ failSaveAt })
  assert.equal((await h.createTaskFromSession('session', { summary: 'save failure' })).ok, false)
  assert.equal(calls.length, 0, `save ${failSaveAt} must fail closed before IO`)
}
// Definitive failed delivery is retryable; uncertain actual dispatch is not.
for (const unknownDelivery of [false, true]) {
  const { h, calls } = creationHarness({ remote: async () => ({ ok: false, beforeRequest: false, unknownDelivery, detail: 'mock delivery failure' }) })
  assert.equal((await h.createTaskFromSession('session', { summary: 'failed' })).ok, false)
  assert.equal((await h.taskCreationLedger.list())[0].status, unknownDelivery ? 'unknown' : 'failed')
  await h.createTaskFromSession('session', { summary: 'second', followUp: true })
  assert.equal(calls.length, unknownDelivery ? 1 : 2)
}
console.log('PR3_LIFECYCLE_REGRESSION_OK: persistent partial create, sync retention, reload, reuse and fail-closed saves')
