/**
 * 诊断 → 长期结论的端到端测试（不联网、不真调模型）。
 *
 * 覆盖 R5 的三段接线：
 *   ① 行为档案真的进了给模型的材料
 *   ② 模型返回的 longTerm 会按契约归一化（fact 命中档案）
 *   ③ 校验失败时不覆盖还没过期的旧结论；/api/insight 跨天带出来
 */
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isolatedHome } from './isolatedHome.mjs'

const HOME = await isolatedHome('dsh-cove-task-diag-longterm-')
delete process.env.DSH_WEB_URL
const { apply } = await import('../index.js')

const dayKey = (offset = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const pad = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
const until = dayKey(7)
const metricsByDay = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [dayKey(i - 19), { wip: 3 }]))
const profileLine = '在跑（n=20 天）：中位 3，85 分位 3'

let capturedPrompt = ''
let badFact = false
const llm = {
  stream(opts) {
    capturedPrompt = opts?.messages?.[0]?.content?.[0]?.text || ''
    const line = /在跑（n=\d+ 天）[^\n]*/.exec(capturedPrompt)?.[0] || profileLine
    const payload = {
      summary: '示例诊断', headline: '一句判断', today: '今天推了一条', issues: [], advice: '先做 T1 的一件事',
      commentary: '', charts: [], score: { focus: 50, throughput: 50, hygiene: 50 },
      fulfillmentComment: '', delayPatterns: [], strengths: [], improve: [],
      longTerm: {
        lens: 'inversion',
        fact: badFact ? '编造（n=999）：不存在' : line,
        hypothesis: '承诺偏乐观', falsifier: '下周估时占比 <30%', secondOrder: '缓冲太多会松',
        action: '当写预期时，就先乘 1.5', metric: '在跑', until,
      },
    }
    async function* gen() {
      yield { type: 'text-delta', text: JSON.stringify(payload) }
    }
    return gen()
  },
}

const routes = []
const ctx = {
  logger: () => ({ info: () => {}, error: () => {} }),
  effect(fn) { fn(); return () => {} },
  get: (name) => {
    if (name === 'agents') return { list: () => [] }
    if (name === 'llm') return llm
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'test-model' }) }
    return undefined
  },
  tools: { register: () => () => {} },
  webServer: { register: (route) => (routes.push(route), () => {}) },
}

await mkdir(join(HOME, 'dsh-cove-task'), { recursive: true })
await writeFile(join(HOME, 'dsh-cove-task', 'settings.json'), JSON.stringify({ autoSync: false, managedTasklist: { enabled: false } }))
await writeFile(join(HOME, 'dsh-cove-task', 'state.json'), JSON.stringify({
  tasks: [{ id: 't1', no: 1, title: '示例任务', done: false, meta: { workspace: 'w1' } }],
  metricsByDay,
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
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ' — ' + detail}`)
}
const json = async (path, init) => {
  const res = await fetch(base + path, init)
  return { status: res.status, data: await res.json().catch(() => null) }
}
const diagnose = () => json('/api/insight/diagnose', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ wait: true, force: true, mode: 'diagnose' }),
})

const first = await diagnose()
check('行为档案进了给模型的材料',
  capturedPrompt.includes('【行为档案】') && capturedPrompt.includes('在跑（n=20 天）'),
  capturedPrompt.slice(0, 120))
check('诊断返回 longTerm，fact 命中行为档案',
  first.status === 200 && first.data?.data?.longTerm?.fact === profileLine,
  JSON.stringify(first.data?.data?.longTerm || first.data).slice(0, 160))
check('longTerm 带到期日与样本天数',
  first.data?.data?.longTerm?.until === until && first.data?.data?.longTerm?.sampleDays === 20,
  JSON.stringify(first.data?.data?.longTerm || null).slice(0, 160))

const view = await json('/api/insight')
check('/api/insight 跨天带出 longTerm（独立于当天 results）',
  view.data?.longTerm?.data?.lens === 'inversion' && view.data?.longTerm?.data?.fact === profileLine)

/* 校验失败：fact 编造 → 本次 longTerm=null，但还没过期的旧结论保留 */
badFact = true
const second = await diagnose()
check('编造 fact 被丢弃（本次 longTerm=null）', second.status === 200 && second.data?.data?.longTerm === null)
const view2 = await json('/api/insight')
check('未过期的旧结论不被清空', view2.data?.longTerm?.data?.fact === profileLine)

server.close()
console.log(failed ? 'DIAGNOSE_LONGTERM_FAILED' : 'DIAGNOSE_LONGTERM_OK')
if (failed) process.exitCode = 1
