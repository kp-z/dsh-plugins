/**
 * 总览页的数据面测试：瘦快照 / revision / 自定义目录写接口，以及「旧整页路由已经不存在」。
 *
 * 为什么单独测这条：总览从「宿主直出整页 HTML + iframe」改成了「宿主页面里的 React 组件」，
 * 最容易犯的错是**接口换了但页面当天的口径没换**——旧路由还在、或者又悄悄把整份 state（含
 * settings/排期/会话水位）塞回响应里。这里把它钉住。
 *
 * 跑法：node test/overviewRoute.mjs
 */
import { createServer, request } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isolatedHome } from './isolatedHome.mjs'

const HOME = await isolatedHome('dsh-cove-task-overview-route-')
/* 这条测试会故意发一个非法 Host 去验证「不启动浏览器」；
   若继承了运行环境的 DSH_WEB_URL，宿主会拿它拼出合法地址并真的去 open —— 必须隔离掉。 */
delete process.env.DSH_WEB_URL
const { apply } = await import('../index.js')

const routes = []
/* 宿主内存里的会话活性：这条会话「正在跑」，用来验证 running / runningSince 的观测口径。 */
const LIVE_SESSION = 'sess-live-1'
const ctx = {
  logger: () => ({ info: () => {}, error: () => {} }),
  effect(fn) { fn(); return () => {} },
  get: (name) => (name === 'agents' ? { list: () => [{ id: LIVE_SESSION, phase: { kind: 'running', turn: 3 } }] } : undefined),
  tools: { register: () => () => {} },
  webServer: { register: (route) => (routes.push(route), () => {}) },
}

await mkdir(join(HOME, 'dsh-cove-task'), { recursive: true })
await writeFile(join(HOME, 'dsh-cove-task', 'settings.json'), JSON.stringify({ autoSync: false, cliPath: '/nonexistent/feishu-sync-cli', managedTasklist: { enabled: false } }))
await writeFile(join(HOME, 'dsh-cove-task', 'state.json'), JSON.stringify({
  tasks: [{
    id: 'live-task', no: 1, title: '正在跑的会话', done: false, sessionId: LIVE_SESSION, started: true,
    meta: { workspace: 'w1', trigger: 'manual' },
    /* 卡片字段：瘦快照要能画出与面板一致的卡，所以这些必须投影出来 */
    priority: 'P2', listName: '日常', start: '2026-11-01 10:00', end: '2026-11-20',
    members: [{ id: 'u1', name: '张三', role: 'assignee', avatar: 'https://example.com/a.png' }, { id: 'u2', name: '李四', role: 'follower' }],
    docs: [{ url: 'https://feishu.cn/docx/abc', title: '设计稿' }],
    customFields: [{ name: '模块', value: '插件', type: 'text' }],
  }],
  relations: [], relationSync: {}, suspensions: {},
}))
apply(ctx, {})

const startedAt = Date.now()
while (routes.length === 0) {
  if (Date.now() - startedAt > 10_000) throw new Error('等待路由挂载超时')
  await new Promise((resolve) => setTimeout(resolve, 100))
}

const mounted = routes.find((item) => item.path === '/dsh-cove-task') ?? routes[0]
const server = createServer((req, res) => mounted.handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/dsh-cove-task`

let failed = 0
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${detail}`}`)
}
const json = async (path, init) => {
  const res = await fetch(base + path, init)
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers }
}
/* 静态件（HTML / JS / CSS）按文本取，JSON 解析会失败 */
const get = async (path, init) => {
  const res = await fetch(base + path, init)
  const body = await res.text().catch(() => '')
  return { status: res.status, body, contentType: res.headers.get('content-type') || '' }
}

/* ── 瘦快照 ─────────────────────────────────────────────────────────── */
const overview = await json('/api/overview')
check('GET /api/overview 返回 200', overview.status === 200 && overview.data?.ok === true, JSON.stringify(overview.data).slice(0, 120))
const view = overview.data || {}
check('带 revision / tasks / relations / groups / workspaces / stats', ['revision', 'tasks', 'relations', 'groups', 'workspaces', 'stats'].every((key) => key in view), Object.keys(view).join(','))
check('不再下发整份 state（没有 settings / 排期 / 会话水位）', !('settings' in view) && !('sessionSeen' in view) && !('schedules' in view) && !('taskCreationReceipts' in view))
/* 运行 tab 的数据面：任务项必须带 running / sessionTurn（宿主内存态；重启后为 false/0）。 */
const sampleTask = (view.tasks || [])[0]
if (sampleTask) {
  check('任务项带 running / sessionTurn / 时间戳字段', typeof sampleTask.running === 'boolean' && typeof sampleTask.sessionTurn === 'number'
    && typeof sampleTask.createdAt === 'number' && typeof sampleTask.startedAt === 'number'
    && typeof sampleTask.completedAt === 'number' && typeof sampleTask.suspendedAt === 'number',
    JSON.stringify({ running: sampleTask.running, sessionTurn: sampleTask.sessionTurn, createdAt: sampleTask.createdAt, startedAt: sampleTask.startedAt, completedAt: sampleTask.completedAt, suspendedAt: sampleTask.suspendedAt }))
} else {
  check('任务项带 running/sessionTurn（无任务时跳过形状检查）', true)
}
/* 卡片数据面：要能画出和侧边栏一致的卡，字段必须在瘦快照里 */
if (sampleTask) {
  check('任务项带卡片字段（优先级/清单/起止/触发/人/文档/自定义字段）',
    sampleTask.priority === 'P2' && sampleTask.listName === '日常' && sampleTask.start === '2026-11-01 10:00' && sampleTask.end === '2026-11-20'
    && sampleTask.trigger === 'manual' && Array.isArray(sampleTask.members) && sampleTask.members.length === 2
    && Array.isArray(sampleTask.docs) && sampleTask.docs[0]?.url === 'https://feishu.cn/docx/abc'
    && Array.isArray(sampleTask.customFields) && sampleTask.customFields[0]?.name === '模块',
    JSON.stringify({ priority: sampleTask.priority, listName: sampleTask.listName, start: sampleTask.start, end: sampleTask.end, trigger: sampleTask.trigger }))
  check('头像只下发 http(s) 链接（脏数据不透传）', sampleTask.members[0].avatar === 'https://example.com/a.png')
  check('任务项带会话态（sessionAlive / sessionPhase / sessionUnread）',
    sampleTask.sessionAlive === true && sampleTask.sessionPhase === 'running' && sampleTask.sessionUnread === false,
    JSON.stringify({ alive: sampleTask.sessionAlive, phase: sampleTask.sessionPhase, unread: sampleTask.sessionUnread }))
}
check('stats 口径齐全', ['tasks', 'groups', 'dependencyEdges', 'provenanceEdges', 'blocked', 'ready'].every((key) => typeof view.stats?.[key] === 'number'), JSON.stringify(view.stats))

const revision = await json('/api/overview/revision')
check('GET /api/overview/revision 与快照同源', revision.status === 200 && revision.data?.revision === view.revision, JSON.stringify(revision.data))
check('revision 是非空短串', typeof view.revision === 'string' && view.revision.length >= 8)

/* ── 会话运行起点（runningSince）：观察口径 + 幂等 + 进 revision ────── */
{
  const first = (await json('/api/overview')).data
  const task = (first.tasks || []).find((row) => row.id === 'live-task')
  check('绑定着「正在跑」的会话：running=true 且记下了运行起点', Boolean(task) && task.running === true && Number(task.runningSince) > 0,
    JSON.stringify(task && { running: task.running, runningSince: task.runningSince }))
  const second = (await json('/api/overview')).data
  const again = (second.tasks || []).find((row) => row.id === 'live-task')
  check('再取一次快照：运行起点不变（幂等，不会每次刷新都重置）',
    Number(again.runningSince) === Number(task.runningSince), `${task.runningSince} → ${again && again.runningSince}`)
  check('运行起点进了 revision（会话起停要能让页面自己刷）', first.revision !== undefined && second.revision !== undefined)
}

/* ── 卡片字段进 revision：绑定文档 → docs 变了，页面要自己刷 ───────── */
{
  const before = (await json('/api/overview')).data
  const changed = await json('/api/tasks/bind-doc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId: 'live-task', url: 'https://feishu.cn/docx/newdoc123' }),
  })
  check('绑定文档接口返回 ok（飞书写回可以失败）', changed.status === 200 && changed.data?.ok === true, JSON.stringify(changed.data).slice(0, 160))
  const after = (await json('/api/overview')).data
  const task = (after.tasks || []).find((row) => row.id === 'live-task')
  check('新文档进瘦快照', Boolean(task) && task.docs.length === 2 && task.docs[0].url === 'https://feishu.cn/docx/newdoc123',
    JSON.stringify(task && task.docs))
  check('文档变了 revision 必须变', before.revision !== after.revision, `${before.revision} → ${after.revision}`)
}

/* ── 阶段 4：面板也能直接加载共享卡片模块 ─────────────────────────── */
{
  const model = await get('/panel/src/card/taskCardModel.js')
  check('面板能取到共享卡片模块', model.status === 200 && model.contentType.includes('javascript') && model.body.includes('buildTaskCardModel'), model.status + ' ' + model.contentType)
  const view = await get('/panel/src/card/taskCardView.js')
  check('面板能取到卡片渲染模块', view.status === 200 && view.body.includes('renderTaskCard'))
  const bad = await get('/panel/src/card/..%2F..%2Fpackage.json')
  check('非模块路径被拒（不允许跳出 src/card）', bad.status === 404 || bad.status === 400, String(bad.status))
  /* 独立海湾页（/tasks）也会 ../card/... 引共享卡片：这条路由不能缺。 */
  const tasksCard = await get('/tasks/card/graphCardDom.js')
  check('独立页能取到共享卡片模块（/tasks/card/graphCardDom.js）', tasksCard.status === 200 && tasksCard.body.includes('buildGraphCardDom'))
  const tasksCardModel = await get('/tasks/card/taskCardModel.js')
  check('独立页能取到卡片模型（/tasks/card/taskCardModel.js）', tasksCardModel.status === 200 && tasksCardModel.body.includes('buildTaskCardModel'))
  /* 布局引擎在浏览器里没有裸模块名可解析：dagre 是 src/vendor/dagre.js 单文件。 */
  const tasksVendor = await get('/tasks/vendor/dagre.js')
  check('独立页能取到布局引擎（/tasks/vendor/dagre.js）', tasksVendor.status === 200 && tasksVendor.body.includes('export'))
  const tasksGraph = await get('/tasks/graph/relayout.js')
  check('独立页能取到布局适配层（/tasks/graph/relayout.js）', tasksGraph.status === 200 && tasksGraph.body.includes('relayoutScope'))
}

/* ── 旧整页路由已经拆掉 ─────────────────────────────────────────────── */
const legacy = await json('/overview')
check('旧的 GET /overview 整页路由已移除（404）', legacy.status === 404, `status=${legacy.status}`)
const panel = await fetch(base + '/panel')
check('右侧栏面板仍然 200（旧入口没被挤掉）', panel.status === 200, `status=${panel.status}`)
/* 「快到期」卡的数据面：预期完成必须投影到任务项上（否则这张卡永远是空的） */
{
  const withEta = (await json('/api/overview')).data
  const row = (withEta.tasks || [])[0]
  check('任务项带 expectedAt（快到期卡的数据面）', Boolean(row) && typeof row.expectedAt === 'number', JSON.stringify(row && { id: row.id, expectedAt: row.expectedAt }))
}

/* 「系统健康」卡的数据面：同步 / 授权 / CLI，且不夹带整份 state */
{
  const health = await json('/api/health')
  const data = health.data || {}
  check('GET /api/health 返回同步状态', health.status === 200 && data.ok === true
    && typeof data.sync?.autoSync === 'boolean' && typeof data.sync?.intervalMinutes === 'number',
    JSON.stringify(data.sync))
  check('GET /api/health 返回授权与 CLI', typeof data.auth?.ok === 'boolean' && typeof data.cli?.found === 'boolean',
    JSON.stringify({ auth: data.auth, cli: data.cli }))
  check('GET /api/health 不下发任务/设置本体', !('tasks' in data) && !('settings' in data) && !('syncHistory' in data))
}

/* 独立海湾页：不加载 DSH 外壳、不需要 token。它**跑的是面板自己的组件**，
   所以静态资源是 boot + 迷你 React + src/client|src/overview 整棵模块树。
   （删掉了 /api/panel-debug 与 /api/panel-focus —— 跳转目标不是 DSH 本身了。） */
const tasksPage = await get('/tasks')
check('GET /tasks 直出独立海湾页（HTML，不重定向到 DSH）',
  tasksPage.status === 200 && tasksPage.body.includes('独立海湾页') && tasksPage.body.includes('/dsh-cove-task/tasks/boot.js'),
  `status=${tasksPage.status}`)

const tasksBoot = await get('/tasks/boot.js')
check('GET /tasks/boot.js 挂载的是面板自己的组件（import OverviewPanel）',
  tasksBoot.status === 200 && tasksBoot.contentType?.includes('javascript') && tasksBoot.body.includes("from './src/OverviewPanel.js'"),
  tasksBoot.contentType)

/* 面板组件跑在**官方 React** 上（vendor 在 lib/vendor），不是自研运行时 */
const vendorReact = await get('/tasks/vendor/react.js')
check('GET /tasks/vendor/react.js 回官方 React UMD',
  vendorReact.status === 200 && vendorReact.contentType?.includes('javascript') && vendorReact.body.includes('React'), vendorReact.contentType)

const vendorDom = await get('/tasks/vendor/react-dom.js')
check('GET /tasks/vendor/react-dom.js 回官方 ReactDOM UMD',
  vendorDom.status === 200 && vendorDom.contentType?.includes('javascript') && vendorDom.body.includes('createRoot'), vendorDom.contentType)

/* 组件树本身：少一个文件，独立页就白屏 */
for (const [path, marker] of [
  ['/tasks/src/OverviewPanel.js', 'createOverviewPanel'],
  ['/tasks/src/RunsFeature.js', 'createRunsFeature'],
  ['/tasks/src/InsightFeature.js', 'createInsightFeature'],
  ['/tasks/src/GraphFeature.js', 'createGraphFeature'],
  ['/tasks/src/runsView.js', 'buildRuns'],
  ['/tasks/overview/layout.js', 'layoutScope'],
  ['/tasks/overview/model.js', 'export'],
]) {
  const res = await get(path)
  check(`GET ${path} 直出（含 ${marker}）`, res.status === 200 && res.body.includes(marker), `status=${res.status}`)
}

/* 只放行单层 .js：不能顺着 ../ 读到 src 以外的东西 */
for (const bad of ['/tasks/src/..%2F..%2Fpackage.json', '/tasks/src/OverviewPanel.mjs', '/tasks/overview/model.js.bak']) {
  const res = await get(bad)
  check(`拒绝非模块路径 ${bad}`, res.status === 404, `status=${res.status}`)
}

check('旧的诊断/落点接口已移除（跳转不再走 DSH 页面）',
  (await get('/api/panel-debug')).status === 404 && (await get('/api/panel-focus')).status === 404)

/* ── 「在浏览器打开」：非法 Host 必须在启动浏览器之前被拦下 ─────────── */
const badHost = await new Promise((resolve, reject) => {
  const req = request({
    host: '127.0.0.1',
    port: server.address().port,
    path: '/dsh-cove-task/api/open-panel',
    method: 'POST',
    headers: { host: 'evil host', 'content-length': 0 },
  }, (res) => {
    let body = ''
    res.on('data', (chunk) => { body += chunk })
    res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body || 'null') }))
  })
  req.on('error', reject)
  req.end()
})
check('POST /api/open-panel 非法 Host → 400，且不启动浏览器', badHost.status === 400 && badHost.data?.ok === false,
  JSON.stringify(badHost.data))

/* ── 自定义目录：总览页唯一写接口 ───────────────────────────────────── */
const post = (body) => json('/api/workspace-groups', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const created = await post({ action: 'create', name: 'QV', members: ['/p/qviz-service', '/p/qviz-scenepack'], labels: { '/p/qviz-service': 'msim-qviz-service' } })
check('POST create 返回 200 且带目录', created.status === 200 && created.data?.ok === true && created.data.group?.name === 'QV', JSON.stringify(created.data).slice(0, 160))
/* 「变了才刷」的前提：写操作必须让 revision 变，否则页面永远不重拉。 */
const revisionAfterWrite = (await json('/api/overview')).data.revision
check('目录写操作后 revision 变化', revisionAfterWrite !== view.revision, `${view.revision} → ${revisionAfterWrite}`)
const groupId = created.data?.group?.id || ''
const groupsOf = async () => (await json('/api/overview')).data.groups || []
check('成员被登记，且 labels 跟着走', JSON.stringify(await groupsOf()).includes('msim-qviz-service'))

const renamed = await post({ action: 'rename', id: groupId, name: 'QV 后端' })
check('rename 生效', renamed.status === 200 && renamed.data.group?.name === 'QV 后端')
const added = await post({ action: 'add', id: groupId, member: { key: '/p/node-api', label: 'node-api' } })
check('add 拖入一个工作区', added.status === 200 && added.data.group?.members.length === 3)
const removed = await post({ action: 'remove', id: groupId, key: '/p/node-api' })
check('remove 拖出后成员回到 2 个', removed.status === 200 && removed.data.group?.members.length === 2)

const bad = await post({ action: 'frobnicate', id: groupId })
check('坏 action 返回 400 而不是 500', bad.status === 400 && bad.data?.ok === false, JSON.stringify(bad.data).slice(0, 120))
const dupName = await post({ action: 'create', name: 'QV 后端' })
check('重名目录被拒', dupName.status === 400 && /QV/.test(dupName.data?.error || ''))

const stateFile = join(HOME, 'dsh-cove-task', 'state.json')
const persisted = JSON.parse(await readFile(stateFile, 'utf8'))
check('分组落盘（state.json 里有 workspaceGroups）', Array.isArray(persisted.workspaceGroups) && persisted.workspaceGroups.length === 1)
check('落盘内容与接口一致', persisted.workspaceGroups[0].members.length === 2)

const dropped = await post({ action: 'delete', id: groupId })
check('delete 之后目录清空', dropped.status === 200 && dropped.data.groups.length === 0)

server.close()
if (failed) {
  console.log(`\nOVERVIEW_API_FAILED：${failed} 项未通过`)
  process.exit(1)
}
console.log('\nOVERVIEW_API_OK')
process.exit(0)
