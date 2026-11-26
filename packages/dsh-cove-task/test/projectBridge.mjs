import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { createCreationLedger } from '../creationLedger.js'
import { normalizeGroups, projectOf, workspaceKeyOf } from '../workspaceGroups.js'
import { buildTemporalSuggestions } from '../organizeSuggestions.js'
import { projectNameOf } from '../src/overview/model.js'

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const extract = name => {
  const match = source.match(new RegExp('  (?:async )?function ' + name + '\\([^]*?\\n  }'))
  assert.ok(match, name)
  return match[0]
}
const copy = value => JSON.parse(JSON.stringify(value))
const project = 'Demo'
const defs = [{ guid: 'p', name: '项目', type: 'text' }]
function harness() {
  const calls = []
  const h = {
    settings: { cliBackend: 'fake', taskFields: { project: '项目', workspace: '工作区', trigger: '触发条件', legacyAuto: '自动开工' }, managedTasklist: { guid: 'list' } },
    state: { tasks: [], workspaceGroups: [], workspaceLinks: {}, workspaceWrites: {}, relationSync: {}, relations: [], taskCreationReceipts: {} },
    asString: value => value == null ? '' : String(value), nowMs: () => 100_000,
    safeSyncDetail: String, persistState: async () => {}, enrichWorkspace: task => task,
    normalizeGroups, projectOf, workspaceKeyOf, projectNameOf, creationPending: () => false,
    remoteCache: { fields: new Map(), tasklists: new Map(), users: new Map() }, REMOTE_TTL: {}, cached: () => undefined,
    customFieldValue: field => field.text_value || '', selectTaskList: () => ({ guid: 'list' }),
    parseTaskMeta: () => ({ workspace: '', project: '' }), parseTrigger: () => undefined,
    formatDay: () => '', formatStamp: () => '', feishuTaskNo: () => 0, extractDocLinks: () => [], ETA_FIELD_DEFAULT: '预期完成',
    raw: { guid: 'task', custom_fields: [] }, defs, valid: true,
  }
  const scope = {
    settings: h.settings, backend: 'fake', valid: () => h.valid,
    enrich: async () => ({ fields: { list: h.defs }, errors: h.readError ? [h.readError] : [] }),
    actions: async actions => {
      calls.push(copy(actions))
      if (actions[0]?.op === 'task_get') return { ok: true, actions: [{ ok: true, task: h.raw }] }
      return h.writeError ? { ok: false, actions: actions.map(a => ({ op: a.op, ok: false, error: h.writeError })) }
        : { ok: true, actions: actions.map(a => ({ op: a.op, ok: true })) }
    },
  }
  h.captureBackendScope = () => scope
  vm.createContext(h)
  vm.runInContext(['readProjectFields', 'adoptTaskProject', 'writeProjectFields', 'retryProjectWrites', 'readFieldConfig', 'normalizeTask', 'organizeScopeTasks'].map(extract).join('\n'), h)
  return { h, calls, scope }
}

test('legacy project migration freezes name across workspace moves and JSON reload', () => {
  const { h } = harness()
  const task = { id: 'task', workspaceTitle: '[Demo] 工作区 A' }
  assert.equal(h.adoptTaskProject(task), true)
  assert.equal(task.project, project)
  task.workspaceTitle = '[Other] 工作区 B'
  const reloaded = copy(task)
  assert.equal(h.adoptTaskProject(reloaded), false)
  assert.equal(reloaded.project, project)
})

test('unattributed tasks persist empty string without remote writes and can later acquire a project', async () => {
  const { h, calls } = harness()
  const task = { id: 'empty' }
  assert.equal(h.adoptTaskProject(task), true)
  assert.equal(task.project, '')
  assert.equal(task.projectSyncPending, false)
  assert.equal((await h.writeProjectFields(task)).ok, true)
  assert.equal(calls.length, 0)
  const reloaded = copy(task)
  assert.equal(h.adoptTaskProject(reloaded), false)
  reloaded.workspaceTitle = '[Demo] first workspace'
  assert.equal(h.adoptTaskProject(reloaded), true)
  assert.equal(reloaded.project, project)
  assert.equal(h.normalizeTask({ guid: 'empty' }, new Map()).project, '')
})

test('real load restores stopped creation and migrates old objects using name only', async () => {
  const { h } = harness()
  const saved = { tasks: [], taskCreationReceipts: { key: { taskId: 'task', status: 'partial', summary: 'created', sessionId: 'session', creation: { tasklistGuid: 'list', project: { id: 'old-id', name: project } } } }, workspaceGroups: [] }
  Object.assign(h, { SETTINGS_FILE: 'settings', stateFile: 'state', DEFAULT_SETTINGS: h.settings, DEFAULT_STATE: { cli: {} }, LEGACY_AUTO_START_PROMPTS: [], lifecycleDisposed: false,
    readJson: async file => file === 'settings' ? h.settings : copy(saved), sanitizeSettings: input => input,
    recoverSyncHistory: value => value || [], normalizeOkrMeta: value => value || {}, rememberSelfUser: () => {}, applySelfNames: () => {}, earlyReopenTurns: new Map(),
  })
  let persisted = null
  h.persistState = async () => { persisted = copy(h.state) }
  vm.runInContext(extract('load'), h)
  await h.load()
  assert.equal(h.state.tasks[0].project, project)
  assert.equal(persisted.tasks[0].project, project)
  assert.equal(h.state.tasks[0].projectSyncPending, true)
  saved.tasks = [{ id: 'legacy', project: { id: 'do-not-guess' } }, { id: 'named', project: { id: 'ignored', name: project }, workspaceTitle: '[Other] new worktree' }]
  saved.taskCreationReceipts = {}
  await h.load()
  assert.equal(persisted.tasks[0].project, '', 'id alone is not a project name')
  assert.equal(persisted.tasks[1].project, project)
  saved.tasks = persisted.tasks
  await h.load()
  assert.equal(h.state.tasks[1].project, project)
})

test('sync reads the single project field independently of workspace and preserves pending local value', () => {
  const { h } = harness()
  const previous = new Map([['task', { id: 'task', project, projectSyncPending: true, projectSyncError: 'retry' }]])
  let task = h.normalizeTask({ guid: 'task', custom_fields: [] }, previous)
  assert.equal(task.project, project)
  assert.equal(task.projectSyncPending, true)
  task = h.normalizeTask({ guid: 'task', custom_fields: [{ name: '项目', text_value: 'Human' }, { name: '工作区', text_value: '[Other] workspace' }] }, previous)
  assert.equal(task.project, 'Human')
  assert.equal(task.meta.workspace, '[Other] workspace')
  assert.equal(task.projectSyncPending, false)
  assert.equal(task.projectSyncError, '')
})

test('writes ensure/set only one project text column and expose failed receipts', async () => {
  const { h, calls } = harness()
  const task = { id: 'task', tasklistGuid: 'list', project, projectSyncPending: true }
  h.state.tasks = [task]
  assert.equal((await h.writeProjectFields(task)).ok, true)
  const writes = calls.flat().filter(a => a.op !== 'task_get')
  assert.deepEqual(writes.map(a => [a.op, a.name]), [['ensure_custom_field','项目'],['set_custom_field','项目']])
  assert.equal(writes[1].expected_type, 'text')
  assert.equal(writes[1].value, project)
  assert.equal(task.projectSyncPending, false)
  h.writeError = 'permission denied'
  task.projectSyncPending = true
  assert.equal((await h.writeProjectFields(task)).ok, false)
  assert.equal(task.projectSyncPending, true)
  assert.equal(task.projectSyncError, 'permission denied; permission denied')
})

test('retry adopts human nonempty project including duplicates and never writes over it', async () => {
  const { h, calls } = harness()
  const task = { id: 'task', tasklistGuid: 'list', project, projectSyncPending: true }
  h.state.tasks = [task]
  h.raw.custom_fields = [{ guid: 'p', text_value: '' }, { name: '项目', text_value: 'Human' }]
  assert.equal((await h.writeProjectFields(task)).ok, true)
  assert.equal(calls.flat().filter(a => a.op !== 'task_get').length, 0)
  assert.equal(task.project, 'Human')
  assert.equal(task.projectSyncPending, false)
})

test('read failures and stale scope send no writes; matching remote echo clears pending', async () => {
  const { h, calls } = harness()
  const task = { id: 'task', tasklistGuid: 'list', project, projectSyncPending: true }
  h.state.tasks = [task]
  h.raw.custom_fields = [{ guid: 'p', text_value: project }]
  assert.equal((await h.writeProjectFields(task)).ok, true)
  assert.equal(calls.flat().filter(a => a.op !== 'task_get').length, 0)
  calls.length = 0
  task.projectSyncPending = true
  h.readError = 'missing scope'
  assert.equal((await h.writeProjectFields(task)).ok, false)
  assert.equal(calls.length, 0)
  h.readError = ''
  h.valid = false
  assert.equal((await h.writeProjectFields(task)).stale, true)
  assert.equal(calls.length, 0)
})

test('group scope maps directory id to name; synthetic id is name; empty string is unclassified', () => {
  const { h } = harness()
  h.workspaceList = () => []
  h.projectGroups = () => [{ id: 'dir-demo', name: project, members: ['ws'] }, { id: 'other', name: 'Other', members: ['ws'] }]
  h.UNGROUPED_KEY = '__ungrouped__'
  h.state.tasks = [{ id: 'task', workspaceId: 'ws', project }, { id: 'legacy', workspaceId: 'ws' }, { id: 'empty', workspaceId: 'ws', project: '' }, { id: 'synthetic', project: 'No directory' }]
  assert.deepEqual(copy(h.organizeScopeTasks({ kind: 'group', id: 'dir-demo' })).map(t => t.id), ['task'])
  assert.deepEqual(copy(h.organizeScopeTasks({ kind: 'group', id: 'other' })).map(t => t.id), [])
  assert.deepEqual(copy(h.organizeScopeTasks({ kind: 'group', id: 'No directory' })).map(t => t.id), ['synthetic'])
  assert.deepEqual(copy(h.organizeScopeTasks({ kind: 'group', id: '__ungrouped__' })).map(t => t.id), ['legacy','empty'])
})

function creationHarness() {
  const { h, scope } = harness()
  Object.assign(h, { createHash, activeCreationKeys: new Set(), ctx: {}, service: () => undefined,
    updateRelations: () => ({ ok: true, edges: [] }), ensureManagedTasklist: async () => ({ ok: true, guid: 'list' }),
    defaultsFromState: () => ({ assignee: 'self' }), decorateTitle: v => v,
    writeTaskRelations: async () => ({ ok: true }), relationView: () => ({}), queueWorkspaceWrite: async () => {}, linkTask: async () => ({ ok: true }),
    syncTasks: async () => ({ ok: true }),
  })
  scope.createTask = async () => ({ ok: true, guid: 'task', tasklistGuid: 'list' })
  h.taskCreationLedger = createCreationLedger({ load: async () => h.state.taskCreationReceipts, save: async rows => { h.state.taskCreationReceipts = rows } })
  vm.runInContext(extract('createTaskFromSession'), h)
  return { h, scope }
}

test('new follow-up inherits name; explicit tool input and ledger store strings; object input rejects', async () => {
  const { h } = creationHarness()
  h.state.tasks = [{ id: 'parent', sessionId: 'session', project, meta: { workspace: 'new workspace' } }]
  const result = await h.createTaskFromSession('session', { summary: 'follow-up', followUp: true })
  assert.equal(result.ok, true, result.error)
  assert.equal(result.project, project)
  assert.equal(h.state.tasks[0].project, project)
  assert.equal(Object.values(h.state.taskCreationReceipts)[0].creation.project, project)
  h.state.tasks = []
  const created = await h.createTaskFromSession('new-session', { summary: 'explicit', project: 'New Project' })
  assert.equal(created.ok, true, created.error)
  assert.equal(created.project, 'New Project')
  assert.equal(Object.values(h.state.taskCreationReceipts).at(-1).creation.project, 'New Project')
  h.state.tasks = []
  const unassigned = await h.createTaskFromSession('empty-session', { summary: 'explicit unassigned', project: '' })
  assert.equal(unassigned.ok, true, unassigned.error)
  assert.equal(unassigned.project, '')
  assert.equal(h.state.tasks[0].projectSyncPending, false)
  const rejected = await h.createTaskFromSession('invalid', { summary: 'invalid', project: { id: 'old', name: project } })
  assert.equal(rejected.ok, false)
  assert.ok(rejected.error.includes('字符串'))
})

test('stopped create branch persists the same name for reload', async () => {
  const { h, scope } = creationHarness()
  scope.createTask = async () => { h.valid = false; return { stale: true, receipt: { ok: true, guid: 'task', tasklistGuid: 'list' } } }
  const result = await h.createTaskFromSession('session', { summary: 'stopped', project })
  assert.equal(result.partial, true)
  assert.equal(h.state.tasks[0].project, project)
  const receipt = Object.values(h.state.taskCreationReceipts)[0]
  assert.equal(receipt.status, 'partial')
  assert.equal(receipt.creation.project, project)
})

test('rename during a write cannot be overwritten by an old receipt', async () => {
  const { h, scope } = harness()
  const task = { id: 'task', tasklistGuid: 'list', project, projectSyncPending: true }
  h.state.tasks = [task]
  const actions = scope.actions
  scope.actions = async rows => {
    const result = await actions(rows)
    if (rows[0]?.op !== 'task_get') task.project = 'Renamed'
    return result
  }
  assert.equal((await h.writeProjectFields(task)).stale, true)
  assert.equal(task.project, 'Renamed')
  assert.equal(task.projectSyncPending, true)
})

test('time chains use project name across workspaces and exclude different projects sharing a workspace', () => {
  const { h } = harness()
  h.workspaceList = () => []
  vm.runInContext(extract('organizeTaskViews'), h)
  const views = h.organizeTaskViews([
    { id: 'a', workspaceId: 'same', project: 'P1', expectedAt: 100 },
    { id: 'b', workspaceId: 'same', project: 'P2', expectedAt: 200 },
    { id: 'c', workspaceId: 'other', project: 'P1', expectedAt: 300 },
    { id: 'empty-a', workspaceTitle: '[P1] old workspace', project: '', expectedAt: 400 },
    { id: 'empty-b', workspaceTitle: '[P1] old workspace', project: '', expectedAt: 500 },
  ])
  assert.deepEqual(copy(views.map(task => task.project)), ['P1','P2','P1','',''])
  assert.deepEqual(buildTemporalSuggestions({ tasks: copy(views), relations: [] }).items.map(item => [item.from,item.to]), [['a','c']])
})

test('single-task relation candidates follow project name, not current workspace', async () => {
  const { h } = harness()
  h.state.tasks = [{ id: 'a', workspaceId: 'same', project: 'P1' }, { id: 'b', workspaceId: 'same', project: 'P2' }, { id: 'c', workspaceId: 'other', project: 'P1' }]
  h.parseJson = JSON.parse
  h.updateRelations = () => ({ ok: true })
  h.askModelForInsight = async (system, payload) => {
    assert.deepEqual(JSON.parse(payload).candidates.map(task => task.id), ['c'])
    return { text: JSON.stringify({ predecessorIds: [], successorIds: [], sourceTaskIds: [], reason: '无关系' }) }
  }
  vm.runInContext(extract('suggestTaskRelations'), h)
  assert.equal((await h.suggestTaskRelations('a')).ok, true)
  h.state.tasks.push({ id: 'unassigned', workspaceId: 'same', meta: { workspace: 'P1' } })
  h.askModelForInsight = async () => { throw new Error('unassigned project must not ask model') }
  assert.equal((await h.suggestTaskRelations('unassigned')).proposal.reason, '没有同项目候选')
})

test('description project name and workspace are separate keys', () => {
  const h = { asString: value => value || '', parseAutoFlag: () => undefined,
    META_WORKSPACE_KEYS: new Set(['workspace','ws','工作区']), META_PROJECT_KEYS: new Set(['project','项目']), META_AUTO_KEYS: new Set(['auto']) }
  vm.createContext(h)
  const parse = source.match(/export function parseTaskMeta\(raw\) \{[^]*?\n\}/)[0].replace('export ', '')
  vm.runInContext(parse, h)
  const meta = h.parseTaskMeta({ description: '项目: Demo\n工作区: worktree-B' })
  assert.equal(meta.workspace, 'worktree-B')
  assert.equal(meta.project, project)
})
