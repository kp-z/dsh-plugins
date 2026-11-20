/**
 * demo 的「后端」：在浏览器里复刻 routes.js 的行为，复用真实的 notes.js
 * （校验、作用域判定、预算规划、状态计算都是真代码），只把存储换成内存、把系统信息换成假数据。
 */
import { LIMITS, describeNotes, parseNoteInput, planInjection, renderSection } from '../src/notes.js'

// 故意设小：让那张「很长」的便签放不下，演示「超出预算」。
const MAX_CHARS = 1200
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `n${Math.random().toString(36).slice(2)}${Date.now()}`)
const day = (n) => new Date(Date.UTC(2026, 10, 1 + n)).toISOString()

const long = Array.from({ length: 36 }, (_, i) => `${i + 1}. 架构评审清单条目：模块边界、依赖方向、错误边界、可观测性、回滚方案。`).join('\n')
const seed = () => [
  { id: 'n1', kind: 'prompt', scope: 'global', target: '', title: 'Go 错误处理', body: '所有 Go 代码：\n- 错误用 fmt.Errorf("%w") 包装\n- 判断用 errors.Is / errors.As\n- 禁止吞错误，禁止用 panic 做控制流', tags: ['go', '规范'], color: 'yellow', enabled: true, createdAt: day(0), updatedAt: day(0) },
  { id: 'n2', kind: 'prompt', scope: 'global', target: '', title: '同事：提交信息', body: '使用 Conventional Commits。标题 ≤ 50 字；正文说明「为什么」而不是「做了什么」。', tags: ['团队'], color: 'pink', enabled: true, createdAt: day(1), updatedAt: day(1) },
  { id: 'n3', kind: 'prompt', scope: 'workspace', target: '/proj', title: '本仓库：包管理', body: '本仓库用 pnpm，不要用 npm 或 yarn；新增依赖前先问我。', tags: ['pnpm'], color: 'yellow', enabled: true, createdAt: day(2), updatedAt: day(2) },
  { id: 'n4', kind: 'prompt', scope: 'session', target: 'sess-A', title: '本次只做代码审查', body: '这个会话只做代码审查：不要修改任何文件，只给出问题清单与建议。', tags: ['审查'], color: 'lilac', enabled: true, createdAt: day(3), updatedAt: day(3) },
  { id: 'n5', kind: 'skill', scope: 'global', target: '', title: '', body: '# Go 代码审查清单\n1. 错误是否被包装并保留上下文\n2. goroutine 是否有退出条件、是否泄漏\n3. 接口是否过大、是否在使用方定义\n4. context 是否一路传递', tags: ['go'], color: 'blue', enabled: true, skill: { name: 'go-review', description: '审查 Go 代码时加载：错误处理、并发、接口设计的检查清单' }, createdAt: day(4), updatedAt: day(4) },
  { id: 'n6', kind: 'skill', scope: 'workspace', target: '/proj', title: '', body: '部署步骤：\n1. pnpm build\n2. 上传 dist/\n3. 刷新 CDN', tags: ['部署'], color: 'blue', enabled: true, skill: { name: 'release-checklist', description: '发布本仓库前加载：构建、上传、刷新缓存的步骤' }, createdAt: day(5), updatedAt: day(5) },
  { id: 'n7', kind: 'mcp', scope: 'global', target: '', title: '', body: '官方文件系统 MCP，只读 /tmp', tags: [], color: 'green', enabled: true, mcp: { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'], url: '' }, createdAt: day(6), updatedAt: day(6) },
  { id: 'n8', kind: 'mcp', scope: 'workspace', target: '/proj', title: '', body: '', tags: [], color: 'green', enabled: true, mcp: { name: 'github', transport: 'stdio', command: 'gh-mcp', args: ['--readonly'], url: '' }, createdAt: day(7), updatedAt: day(7) },
  { id: 'n9', kind: 'mcp', scope: 'global', target: '', title: '', body: '', tags: [], color: 'green', enabled: false, mcp: { name: 'web', transport: 'streamable-http', command: '', args: [], url: 'http://localhost:3000/mcp' }, createdAt: day(8), updatedAt: day(8) },
  { id: 'n10', kind: 'prompt', scope: 'global', target: '', title: '架构评审清单（很长）', body: long, tags: ['架构'], color: 'yellow', enabled: true, createdAt: day(9), updatedAt: day(9) },
  { id: 'n11', kind: 'prompt', scope: 'global', target: '', title: '旧规范：先别用', body: '（草稿）所有函数都必须加注释。', tags: ['草稿'], color: 'pink', enabled: false, createdAt: day(10), updatedAt: day(10) },
]

let doc = { paused: false, notes: seed() }
let revision = 1
export function resetMock() { doc = { paused: false, notes: seed() }; revision++ }

const SYSTEM = {
  sections: [
    { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
    { name: 'deployment:persona', text: '你是一名资深工程师助手，回答简洁、先给结论。' },
    { name: 'tool:bash', text: 'Use bash for shell commands. Quote paths with spaces. Prefer dedicated tools over shell for file operations. '.repeat(8) },
    { name: 'tool:read', text: 'Read files with the read tool, not cat. Use offset and limit for long files.' },
    { name: 'plan:policy', text: 'Plan mode is off. Make changes directly unless the user asks for a plan.' },
    { name: 'prompt-notes:injected', mine: true, text: '(便签贡献的部分)' },
  ],
  contexts: [{ name: 'working-directory:current', text: 'Current working directory: "{cwd}".' }],
  skills: [
    { name: 'office', description: 'Create or edit Office files; inspect Office files and PDFs.', source: 'bundled', provider: 'skill-filesystem' },
    { name: 'frontend-design', description: 'Guidance for distinctive, intentional visual design.', source: 'user-dsh', provider: 'skill-filesystem' },
  ],
  mcp: [{ name: 'browser', configured: true, state: 'connected', tools: 12 }],
}

function viewerOf(url) {
  const s = url.searchParams.get('session') || ''
  const c = url.searchParams.get('cwd') || ''
  return { sessionId: s || undefined, cwd: c || undefined }
}
function runtimeOf() {
  const out = {}
  for (const n of doc.notes) if (n.kind === 'mcp' && n.enabled) out[n.mcp.name] = n.mcp.name === 'github' ? { state: 'failed', error: 'spawn gh-mcp ENOENT' } : { state: 'connected' }
  return out
}
function stateFor(viewer) {
  const plan = planInjection(doc.notes, MAX_CHARS, { paused: doc.paused, viewer })
  return {
    revision: String(revision), paused: doc.paused, viewer: { sessionId: viewer.sessionId ?? null, cwd: viewer.cwd ?? null },
    notes: describeNotes(doc.notes, plan, { paused: doc.paused, viewer, runtime: runtimeOf() }),
    budget: { used: plan.used, max: plan.max }, limits: LIMITS, sectionOrder: 100, file: '~/.dsh/prompt-notes/notes.json',
    mcpAllowed: true, liveSessions: ['sess-A', 'sess-B'],
  }
}
function conflict(value, excludeId) {
  for (const n of doc.notes) {
    if (n.id === excludeId) continue
    if (value.kind === 'mcp' && n.kind === 'mcp' && n.mcp.name === value.mcp.name) return `已有一张 MCP 便签使用名字 "${value.mcp.name}"`
    if (value.kind === 'skill' && n.kind === 'skill' && n.skill.name === value.skill.name && n.scope === value.scope && n.target === value.target) return `这个作用域里已有同名技能 "${value.skill.name}"`
  }
  return null
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function handle(url, method, body) {
  const path = url.pathname.slice('/dsh-prompt-notes'.length)
  const viewer = viewerOf(url)
  if (method === 'GET') {
    if (path === '/state') return json(200, stateFor(viewer))
    if (path === '/preview') {
      const plan = planInjection(doc.notes, MAX_CHARS, { paused: doc.paused, viewer })
      const text = renderSection(plan.injected)
      return json(200, { text, chars: text.length, count: plan.injected.length, paused: doc.paused })
    }
    if (path === '/system') {
      const sys = JSON.parse(JSON.stringify(SYSTEM))
      const found = Boolean(viewer.sessionId)
      for (const c of sys.contexts) c.text = c.text.replace('{cwd}', viewer.cwd || '/')
      const plan = planInjection(doc.notes, MAX_CHARS, { paused: doc.paused, viewer })
      const mine = sys.sections.find((s) => s.mine); mine.text = renderSection(plan.injected) || '(当前没有便签文本被注入)'
      const skillNotes = doc.notes.filter((n) => n.kind === 'skill' && n.enabled && !doc.paused && (n.scope === 'global' || (n.scope === 'workspace' && viewer.cwd && viewer.cwd.startsWith(n.target)) || (n.scope === 'session' && n.target === viewer.sessionId)))
      for (const n of skillNotes) sys.skills.push({ name: n.skill.name, description: n.skill.description, source: 'prompt-notes', provider: 'prompt-notes', mine: true })
      sys.skills.sort((a, b) => a.name.localeCompare(b.name))
      for (const n of doc.notes) if (n.kind === 'mcp' && n.enabled && !doc.paused) sys.mcp.push({ name: n.mcp.name, configured: false, state: runtimeOf()[n.mcp.name]?.state ?? 'connecting', tools: 3 })
      for (const s of sys.sections) { s.chars = s.text.length; s.truncated = false }
      for (const c of sys.contexts) { c.chars = c.text.length; c.truncated = false }
      return json(200, { session: { id: viewer.sessionId ?? null, cwd: viewer.cwd ?? null, found }, errors: [], tools: { count: 14 + sys.mcp.length * 3, mcpCount: sys.mcp.length * 3 }, ...sys })
    }
    return json(404, { error: 'not found' })
  }
  if (path === '/notes' && method === 'POST') {
    const parsed = parseNoteInput(body)
    if (!parsed.ok) return json(400, { error: parsed.error })
    if (doc.notes.length >= LIMITS.notes) return json(409, { error: `便签数量已达上限 ${LIMITS.notes}` })
    const dup = conflict(parsed.value); if (dup) return json(409, { error: dup })
    const now = new Date().toISOString()
    doc.notes.push({ id: uid(), createdAt: now, updatedAt: now, ...parsed.value }); revision++
    return json(201, stateFor(viewer))
  }
  if (path === '/paused' && method === 'PUT') { doc.paused = !!body?.paused; revision++; return json(200, stateFor(viewer)) }
  const m = /^\/notes\/([A-Za-z0-9-]{1,64})$/.exec(path)
  if (m) {
    if (method === 'DELETE') { doc.notes = doc.notes.filter((n) => n.id !== m[1]); revision++; return json(200, stateFor(viewer)) }
    if (method === 'PUT') {
      const note = doc.notes.find((n) => n.id === m[1])
      if (!note) return json(404, { error: '便签不存在（可能已被删除）' })
      const parsed = parseNoteInput(body, { base: note })
      if (!parsed.ok) return json(400, { error: parsed.error })
      const dup = conflict({ ...note, ...parsed.value }, note.id); if (dup) return json(409, { error: dup })
      Object.assign(note, parsed.value, { updatedAt: new Date().toISOString() }); revision++
      return json(200, stateFor(viewer))
    }
  }
  return json(405, { error: 'method not allowed' })
}

export function installMock() {
  const real = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href)
    if (!url.pathname.startsWith('/dsh-prompt-notes/')) return real(input, init)
    await new Promise((r) => setTimeout(r, 60)) // 模拟一点网络延迟
    const method = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : undefined
    return handle(url, method, body)
  }
}
