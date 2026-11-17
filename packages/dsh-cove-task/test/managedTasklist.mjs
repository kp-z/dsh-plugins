import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { DEFAULT_TASKLIST_NAME } from '../tasklistSchema.js'

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const start = source.indexOf('  let tasklistFlight = null')
const end = source.indexOf('  const settingsHooks = []', start)
assert.ok(start > 0 && end > start)

function harness({ backend = 'feishu-sync', tasks = [], initial = {}, disabled = false, disposed = false } = {}) {
  const calls = []
  let persists = 0
  const bridge = async (_python, payload) => {
    calls.push(payload)
    if (payload.actions?.[0]?.op === 'ensure_tasklist') return { ok: true, actions: [{ ok: true, guid: 'list-1', name: DEFAULT_TASKLIST_NAME }] }
    return { ok: true, actions: [] }
  }
  const h = {
    settings: { cliBackend: backend, cliPath: '/mock/sync', larkTasklistGuid: '', managedTasklist: { enabled: !disabled, name: DEFAULT_TASKLIST_NAME, guid: '' } },
    state: { tasks, managedTasklist: initial, feishuFields: {} },
    lifecycleDisposed: disposed, backendGeneration: 0,
    randomUUID: () => 'create-token', nowMs: Date.now,
    resolvePython: () => '/mock/python', resolveCli: () => '/mock/cli',
    backendFor: () => ({ actions: async (_s, actions) => bridge(null, { actions }), enrich: async (_s, p) => bridge(null, p) }),
    runBridgeRaw: bridge,
    persistState: async () => { persists++ }, writeJson: async () => {}, SETTINGS_FILE: 'fake', safeSyncDetail: String,
  }
  vm.createContext(h); vm.runInContext(source.slice(start, end), h)
  return { h, calls, bridge, countPersists: () => persists }
}

// Fresh init: create/reuse list, persist GUID, ready, and no field contract is enforced.
{
  const { h, calls, countPersists } = harness()
  const result = await h.ensureManagedTasklist()
  assert.equal(result.ok, true)
  assert.equal(result.guid, 'list-1')
  assert.equal(h.settings.managedTasklist.guid, 'list-1')
  assert.equal(h.state.managedTasklist.status, 'ready')
  assert.equal(h.state.managedTasklist.backend, 'feishu-sync')
  assert.equal(h.state.managedTasklist.errors.length, 0)
  assert.ok(countPersists() >= 2)
  assert.equal(calls.filter(p => p.actions?.some(a => a.op === 'ensure_custom_field')).length, 0, 'no bulk field ensure')
  const listCalls = calls.filter(p => p.actions?.some(a => a.op === 'ensure_tasklist')).length
  assert.equal(listCalls, 1)
}

// TTL: a ready list within the window is not re-checked remotely.
{
  const { h, calls } = harness()
  assert.equal((await h.ensureManagedTasklist()).ok, true)
  const before = calls.length
  assert.equal((await h.ensureManagedTasklist()).ok, true)
  assert.equal(calls.length, before, 'TTL avoids repeated remote calls')
}

// Disabled contract restores legacy path.
{
  const { h } = harness({ disabled: true })
  assert.equal((await h.ensureManagedTasklist()).skipped, 'disabled')
}

// Multiple legacy lists without an explicit GUID never guess.
{
  const { h } = harness({ tasks: [{ tasklistGuid: 'a' }, { tasklistGuid: 'b' }] })
  const result = await h.ensureManagedTasklist()
  assert.equal(result.ok, false)
  assert.equal(h.state.managedTasklist.status, 'failed')
  assert.match(result.error, /多个历史任务清单/)
}

// Disposed instance never starts initialization.
{
  const { h, calls } = harness({ disposed: true })
  assert.equal((await h.ensureManagedTasklist()).ok, false)
  assert.equal(calls.length, 0)
}

// Backend switch re-checks and records the new backend.
{
  const { h } = harness()
  assert.equal((await h.ensureManagedTasklist()).ok, true)
  h.settings.cliBackend = 'lark-cli'
  const result = await h.ensureManagedTasklist({ force: true })
  assert.equal(result.ok, true)
  assert.equal(h.state.managedTasklist.backend, 'lark-cli')
}

// Task creation still requires an initialized list and never double-creates.
assert.match(source, /任务清单未就绪：/)
assert.match(source, /任务已创建但未加入清单，勿重复创建/)

console.log('MANAGED_TASKLIST_OK: list create/reuse, persisted GUID, TTL, multi-list guard, disposal, backend switch, no field contract')
