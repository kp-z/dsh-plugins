/**
 * 独立任务页的本地预览（node scripts/serve-tasks-page.mjs [port]）。
 *
 * 起一个只挂插件路由的临时宿主，数据来自临时 DSH_HOME 里的一份 state.json ——
 * 用来在真浏览器里看 /dsh-cove-task/tasks 长什么样，不碰真实 ~/.dsh。
 */
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isolatedHome } from '../test/isolatedHome.mjs'

const PORT = Number(process.argv[2]) || 8792
/* --snapshot <file>：用一份真实快照（curl /dsh-cove-task/api/overview 存下来）喂页面，
   这样能看到「真数据下这张卡长什么样」，而不是我自己编的 fixture。 */
const SNAPSHOT_FILE = process.argv.includes('--snapshot') ? process.argv[process.argv.indexOf('--snapshot') + 1] : ''
const DAY = 86_400_000
const HOUR = 3_600_000
const now = Date.now()

const HOME = await isolatedHome('dsh-cove-task-tasks-preview-')
delete process.env.DSH_WEB_URL
const { apply } = await import('../index.js')

const task = (over) => Object.assign({
  id: 'x', no: 0, title: '', done: false, started: false, createdAt: now - 3 * DAY,
  meta: { workspace: 'w-dsh' },
}, over)

await mkdir(join(HOME, 'dsh-cove-task'), { recursive: true })
await writeFile(join(HOME, 'dsh-cove-task', 'settings.json'), JSON.stringify({ autoSync: true, syncIntervalMinutes: 30, cliPath: '/nonexistent/feishu-sync-cli', managedTasklist: { enabled: false } }))
await writeFile(join(HOME, 'dsh-cove-task', 'state.json'), JSON.stringify({
  tasks: [
    task({ id: 't1', no: 516451, title: '飞书任务集开发', started: true, sessionId: 'sess-live-1', createdAt: now - 9 * DAY }),
    task({ id: 't2', no: 100001, title: '拆分 tile 渲染管线', started: true, sessionId: 'sess-idle-2', createdAt: now - 4 * DAY, expectedAt: now + 3 * HOUR }),
    /* 当天已经过期：验证「逾期」不是按自然日切，而是按真的过了那个点 */
    task({ id: 't2b', no: 100002, title: '修掉 bytes 被显示成 string', started: true, createdAt: now - 5 * DAY, expectedAt: now - 2 * HOUR }),
    task({ id: 't3', no: 516520, title: '关系图加上时间轴视图', priority: 'P0', createdAt: now - 6 * DAY, expectedAt: now + 2 * DAY }),
    task({ id: 't4', no: 516521, title: '导出任务周报', priority: 'P2', createdAt: now - 12 * DAY, expectedAt: now + 5 * DAY }),
    task({ id: 't5', no: 516350, title: '总览页写回飞书评论', priority: 'P1', createdAt: now - 8 * DAY, expectedAt: now - 2 * DAY }),
    task({ id: 't6', no: 516600, title: '夜里跑的整理任务', done: true, completedAt: now - 40 * 60_000, createdAt: now - 2 * DAY }),
    task({ id: 't7', no: 516601, title: '暂时不做的实验', createdAt: now - DAY }),
  ],
  relations: [
    { from: 't3', to: 't4', kind: 'depends_on' },
    { from: 't5', to: 't2', kind: 'depends_on' },
  ],
  relationSync: {},
  suspensions: { t7: { active: true, at: now - 2 * HOUR } },
  sessionRunSeen: { 'sess-live-1': now - 8 * 60_000 },
  syncHistory: [
    { status: 'success', startedAt: now - 12 * 60_000, finishedAt: now - 11 * 60_000, durationMs: 60_000, errors: [], source: 'auto' },
    { status: 'success', startedAt: now - 42 * 60_000, finishedAt: now - 41 * 60_000, durationMs: 55_000, errors: [], source: 'auto' },
    { status: 'failed', startedAt: now - 72 * 60_000, finishedAt: now - 71 * 60_000, durationMs: 20_000, errors: ['lark-cli 超时'], source: 'auto' },
  ],
  auth: { ok: true, detail: '', checkedAt: now - 5 * 60_000 },
  lastSyncAt: now - 11 * 60_000,
}))

const routes = []
const ctx = {
  logger: () => ({ info: () => {}, error: () => {} }),
  effect(fn) { fn(); return () => {} },
  get: (name) => (name === 'agents' ? { list: () => [{ id: 'sess-live-1', phase: { kind: 'running', turn: 12 } }] } : undefined),
  tools: { register: () => () => {} },
  webServer: { register: (route) => (routes.push(route), () => {}) },
}
apply(ctx, {})

const startedAt = Date.now()
while (routes.length === 0) {
  if (Date.now() - startedAt > 10_000) throw new Error('等待路由挂载超时')
  await new Promise((resolve) => setTimeout(resolve, 100))
}
const mounted = routes.find((item) => item.path === '/dsh-cove-task') ?? routes[0]
/* 真快照直出：只替换 /api/overview 的响应，其它路由照旧走插件。 */
const snapshotJson = SNAPSHOT_FILE ? await readFile(SNAPSHOT_FILE, 'utf8') : ''
/* 洞察 tab 的历史指标：同一目录下的 insight.json（curl /api/insight/stats 存下来）也一起直出。 */
const statsFile = SNAPSHOT_FILE ? SNAPSHOT_FILE.replace(/[^/]+$/, 'insight.json') : ''
const statsJson = statsFile ? await readFile(statsFile, 'utf8').catch(() => '') : ''
/* --insight <file>：喂一份诊断结果，用来在浏览器里看「有 AI 结论时」的面板长什么样。
   只影响本地预览宿主，不参与宿主真实路由。 */
const insightFile = process.argv.includes('--insight') ? process.argv[process.argv.indexOf('--insight') + 1] : ''
const insightJson = insightFile ? await readFile(insightFile, 'utf8').catch(() => '') : ''
/* --local <file>：单独喂一份真实的 local（引擎本地统计），用来验证左栏「数据」区。
   留空时左栏会退化到看板总数——这也是老宿主的真实表现。 */
const localFile = process.argv.includes('--local') ? process.argv[process.argv.indexOf('--local') + 1] : ''
const localJson = localFile ? await readFile(localFile, 'utf8').catch(() => '') : ''
const server = createServer((req, res) => {
  if (snapshotJson && req.url && req.url.startsWith('/dsh-cove-task/api/overview')) {
    const live = JSON.parse(snapshotJson)
    live.now = Date.now()
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(live))
    return
  }
  if (insightJson && req.url && /^\/dsh-cove-task\/api\/insight(\?|$)/.test(req.url)) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      ok: true,
      ...(localJson ? { local: JSON.parse(localJson) } : {}),
      ai: JSON.parse(insightJson),
    }))
    return
  }
  if (statsJson && req.url && req.url.startsWith('/dsh-cove-task/api/insight/stats')) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(statsJson)
    return
  }
  mounted.handler(req, res)
})
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
console.log(`独立任务页：http://127.0.0.1:${PORT}/dsh-cove-task/tasks`)
