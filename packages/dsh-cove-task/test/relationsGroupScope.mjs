#!/usr/bin/env node
/** 「项目 = 分组目录」口径回归：suggest 候选与时间兜底都按目录划分（不是按工作区）。 */
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isolatedHome } from './isolatedHome.mjs'

const HOME = await isolatedHome('dsh-cove-task-group-scope-')
const { apply } = await import('../index.js')
const NOW = 1_700_000_000_000
const at = (h) => NOW + h * 3_600_000

await mkdir(join(HOME, 'dsh-cove-task'), { recursive: true })
await writeFile(join(HOME, 'dsh-cove-task', 'settings.json'), JSON.stringify({ autoSync: false, cliPath: '/nonexistent/cli', managedTasklist: { enabled: false } }))
/* 目录 G 含 w1、w2 两个工作区；w3 在目录外。 */
const TASKS = [
  { id: 'a1', title: '接口', description: '', done: false, expectedAt: at(1), workspaceId: 'w1', workspaceTitle: 'a', members: [], customFields: [], meta: {} },
  { id: 'a2', title: '接入', description: '', done: false, expectedAt: at(2), workspaceId: 'w1', workspaceTitle: 'a', members: [], customFields: [], meta: {} },
  { id: 'b1', title: '仓库', description: '', done: false, expectedAt: at(3), workspaceId: 'w2', workspaceTitle: 'b', members: [], customFields: [], meta: {} },
  { id: 'c1', title: '另一个项目', description: '', done: false, expectedAt: at(1.5), workspaceId: 'w3', workspaceTitle: 'c', members: [], customFields: [], meta: {} },
]
await writeFile(join(HOME, 'dsh-cove-task', 'state.json'), JSON.stringify({
  tasks: TASKS,
  relations: [],
  relationSync: {},
  workspaceGroups: [{ id: 'g1', name: 'G', members: ['w1', 'w2'], labels: { w1: 'a', w2: 'b' }, createdAt: NOW, updatedAt: NOW }],
}))

const modelCalls = []
let modelText = ''
const routes = []
const ctx = {
  logger: () => ({ info() {}, warn() {}, error() {} }),
  get: (name) => ({
    llm: { async *stream(request) { modelCalls.push(request); const mid = Math.floor(modelText.length / 2); yield { type: 'text-delta', text: modelText.slice(0, mid) }; yield { type: 'text-delta', text: modelText.slice(mid) } } },
    agentDefaultModel: { currentSelection: () => ({ provider: 'fake', model: 'offline' }) },
    /* null（非 undefined）让 awaitService 立即返回，避免 15s 轮询。 */
    workspaceRegistry: null, agents: null, sessionController: null,
  })[name],
  effect(fn) { fn(); return () => {} },
  on: () => () => {},
  tools: { register() { return () => {} } },
  webServer: { register(route) { routes.push(route); return () => {} } },
}
apply(ctx, {})
const deadline = Date.now() + 5000
while (!routes.length) {
  if (Date.now() >= deadline) throw new Error('路由未挂载')
  await new Promise((resolve) => setTimeout(resolve, 20))
}
const server = createServer((req, res) => routes[0].handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/dsh-cove-task`

let checks = 0
const check = (label, ok, detail = '') => { if (!ok) process.exitCode = 1; checks += 1; console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${detail}`}`) }
const post = async (path, body) => { const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, data: await res.json().catch(() => null) } }

/* 1. suggest：任务 a1 在目录 G（w1+w2），候选应含跨工作区的 b1，不含目录外的 c1 */
{
  modelText = JSON.stringify({ predecessorIds: [], successorIds: [], sourceTaskIds: [], reason: '' })
  const result = await post('/api/tasks/relations', { action: 'suggest', taskId: 'a1' })
  check('suggest 返回 ok', result.status === 200 && result.data?.ok === true, JSON.stringify(result.data))
  const request = modelCalls.findLast((r) => (r.system || '').includes('任务关系分析器'))
  const prompt = JSON.parse(request.messages[0].content[0].text)
  const ids = prompt.candidates.map((t) => t.id)
  check('suggest：同目录跨工作区的 b1 进候选', ids.includes('b1'), JSON.stringify(ids))
  check('suggest：目录外的 c1 不进候选', !ids.includes('c1'), JSON.stringify(ids))
}

/* 2. 时间兜底：同目录跨工作区串（a2→b1），目录外 c1 不串 */
{
  modelText = JSON.stringify({ items: [], notes: '' })
  const result = await post('/api/overview/organize', { scope: { kind: 'all' } })
  check('整理返回 ok', result.status === 200 && result.data?.ok === true, JSON.stringify(result.data).slice(0, 200))
  const items = (result.data?.batch?.items || []).filter((i) => i.kind === 'temporal' && i.status === 'pending')
  const pairs = items.map((i) => `${i.from}>${i.to}`)
  check('时间兜底：同目录跨工作区串 a2→b1', items.some((i) => i.from === 'a2' && i.to === 'b1'), JSON.stringify(pairs))
  check('时间兜底：目录外 c1 不串', !items.some((i) => i.from === 'c1' || i.to === 'c1'), JSON.stringify(pairs))
}

console.log(`\n${checks} 项通过`)
console.log('RELATIONS_GROUP_SCOPE_OK')
server.close()
