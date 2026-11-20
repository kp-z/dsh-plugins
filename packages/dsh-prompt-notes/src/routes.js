/**
 * HTTP 路由：面板（客户端半体）读写便签、读取系统注入内容的唯一通道。
 *
 *   GET    /dsh-prompt-notes/state?session=&cwd=   → 全量状态（相对该会话/工作目录的观察者）
 *   GET    /dsh-prompt-notes/preview?session=&cwd= → 该观察者的 system prompt 里实际注入的便签文本
 *   GET    /dsh-prompt-notes/system?session=&cwd=  → 系统自带注入内容（真实 assemble 结果 / skills / MCP）
 *   POST   /dsh-prompt-notes/notes                 → 新建
 *   PUT    /dsh-prompt-notes/notes/:id             → 部分更新
 *   DELETE /dsh-prompt-notes/notes/:id             → 删除（进回收站，不是真删）
 *   POST   /dsh-prompt-notes/notes/:id/restore     → 从回收站捡回来
 *   PUT    /dsh-prompt-notes/paused                → {paused:boolean} 总开关
 *   GET    /dsh-prompt-notes/export?ids=a,b        → 导出一组（缺省全部）便签的分享文件
 *   POST   /dsh-prompt-notes/import/preview        → {bundle,strategy} 只算「会发生什么」，不写
 *   POST   /dsh-prompt-notes/import                → {bundle,strategy} 真的导入，回全量状态
 *
 * 导入是两步：先 preview 看「新建 / 重命名 / 覆盖 / 跳过」和将被执行的 MCP 命令，再确认。
 *
 * 所有写接口都回「写完之后的全量状态」，客户端直接替换，不用自己合并。
 *
 * 写接口的防护：本机服务上的 POST 可以被任意网页用 <form> 跨站发起，
 * 而这些便签最终会进模型的 system prompt（MCP 便签甚至会启动本地进程）——
 * 等于给别人一个远程改提示词/执行命令的口子。所以写请求必须带自定义头
 * （跨站请求带自定义头会触发预检，而本路由不答 CORS，浏览器直接拦掉），
 * 并且显式拒绝 Sec-Fetch-Site: cross-site。读请求不受此限（同样没有 CORS 头，跨站读不到）。
 */
import { isAbsolute } from 'node:path'
import { LIMITS, describeNotes, displayTitle, planInjection, renderSection } from './notes.js'
import { createNote, deleteNote, restoreNote, updateNote } from './mutations.js'
import { applyImport, packBundle, parseBundle, planImport } from './share.js'

export const ROUTE_PREFIX = '/dsh-prompt-notes/'
export const GUARD_HEADER = 'x-dsh-prompt-notes'
const MAX_BODY_BYTES = 256 * 1024
const SESSION_ID = /^[A-Za-z0-9_.:-]{1,128}$/

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve(undefined)
      try { resolve(JSON.parse(text)) } catch { reject(new Error('invalid JSON')) }
    })
    req.on('error', reject)
  })
}

/**
 * @param {{ store, maxChars: number, order: number, file: string,
 *           host?: { resolveViewer?, liveSessionIds?, system?, mcpRuntime?, mcpAllowed? } }} deps
 *   host 是 index.js 提供的、需要 cordis 服务的能力；单测可以不传（退化成「只看 query 里的观察者」）。
 */
export function createHandler({ store, maxChars, order, file, host = {} }) {
  const viewerFrom = (url) => {
    const s = url.searchParams.get('session') ?? ''
    const c = url.searchParams.get('cwd') ?? ''
    const query = {
      sessionId: SESSION_ID.test(s) ? s : undefined,
      cwd: c && isAbsolute(c) && c.length <= LIMITS.target ? c : undefined,
    }
    return host.resolveViewer ? host.resolveViewer(query) : { sessionId: query.sessionId, cwd: query.cwd }
  }

  const buildState = (viewer) => {
    const doc = store.snapshot()
    const plan = planInjection(doc.notes, maxChars, { paused: doc.paused, viewer })
    const runtime = host.mcpRuntime ? host.mcpRuntime() : {}
    return {
      revision: store.revision,
      paused: doc.paused,
      viewer: { sessionId: viewer.sessionId ?? null, cwd: viewer.cwd ?? null },
      notes: describeNotes(doc.notes, plan, { paused: doc.paused, viewer, runtime }),
      budget: { used: plan.used, max: plan.max },
      limits: LIMITS,
      sectionOrder: order,
      file,
      mcpAllowed: host.mcpAllowed !== false,
      liveSessions: host.liveSessionIds ? host.liveSessionIds() : [],
    }
  }

  const guardWrite = (req, res) => {
    if (req.headers[GUARD_HEADER] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') {
      sendJson(res, 403, { error: 'forbidden' })
      return false
    }
    return true
  }

  const handle = async (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase()
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(ROUTE_PREFIX)) return sendJson(res, 404, { error: 'not found' })
    const path = url.pathname.slice(ROUTE_PREFIX.length - 1) // 保留前导 /

    if (method === 'GET' || method === 'HEAD') {
      const viewer = viewerFrom(url)
      if (path === '/state') return sendJson(res, 200, buildState(viewer))
      if (path === '/export') {
        const ids = (url.searchParams.get('ids') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
        return sendJson(res, 200, packBundle(store.snapshot().notes, { ids }))
      }
      if (path === '/preview') {
        const doc = store.snapshot()
        const plan = planInjection(doc.notes, maxChars, { paused: doc.paused, viewer })
        const text = renderSection(plan.injected)
        return sendJson(res, 200, { text, chars: text.length, count: plan.injected.length, paused: doc.paused })
      }
      if (path === '/system') {
        if (!host.system) return sendJson(res, 200, { session: { id: viewer.sessionId ?? null, cwd: viewer.cwd ?? null, found: false }, sections: [], contexts: [], skills: [], mcp: [], tools: { count: 0, mcpCount: 0 }, errors: ['system linkage unavailable'] })
        return sendJson(res, 200, await host.system({ sessionId: viewer.sessionId, cwd: viewer.cwd }))
      }
      return sendJson(res, 404, { error: 'not found' })
    }

    if (!guardWrite(req, res)) return
    // 写接口回的状态也要相对调用者的观察者，所以写请求同样带 ?session=&cwd=
    const viewer = viewerFrom(url)

    if (path === '/notes' && method === 'POST') {
      const result = await createNote(store, await readJsonBody(req))
      if (!result.ok) return sendJson(res, result.status, { error: result.error })
      return sendJson(res, 201, buildState(viewer))
    }

    if ((path === '/import/preview' || path === '/import') && method === 'POST') {
      const body = await readJsonBody(req)
      const parsed = parseBundle(body && body.bundle)
      if (!parsed.ok) return sendJson(res, 400, { error: parsed.error })
      const plan = planImport(store.snapshot().notes, parsed.notes, body && body.strategy)
      if (path === '/import/preview') {
        // 预览只说「会发生什么」：动作 + 名字 + 将被执行的命令 + 被丢弃的条目
        return sendJson(res, 200, {
          counts: plan.counts,
          warnings: plan.warnings,
          dropped: parsed.dropped,
          actions: plan.actions.map((a) => ({
            action: a.action,
            kind: a.note ? a.note.kind : undefined,
            title: a.note ? displayTitle(a.note) : a.title,
            name: a.note && a.note.mcp ? a.note.mcp.name : a.note && a.note.skill ? a.note.skill.name : undefined,
            reason: a.reason,
          })),
        })
      }
      const result = await applyImport(store, plan)
      return sendJson(res, 200, { ...buildState(viewer), imported: result, counts: plan.counts, warnings: plan.warnings })
    }

    if (path === '/paused' && method === 'PUT') {
      const body = await readJsonBody(req)
      if (!body || typeof body.paused !== 'boolean') return sendJson(res, 400, { error: 'body must be {"paused": boolean}' })
      await store.mutate((doc) => { doc.paused = body.paused })
      return sendJson(res, 200, buildState(viewer))
    }

    const restore = /^\/notes\/([A-Za-z0-9-]{1,64})\/restore$/.exec(path)
    if (restore && method === 'POST') {
      const result = await restoreNote(store, restore[1])
      if (!result.ok) return sendJson(res, result.status, { error: result.error })
      return sendJson(res, 200, buildState(viewer))
    }

    const m = /^\/notes\/([A-Za-z0-9-]{1,64})$/.exec(path)
    if (m) {
      const id = m[1]
      if (method === 'PUT') {
        const result = await updateNote(store, id, await readJsonBody(req))
        if (!result.ok) return sendJson(res, result.status, { error: result.error })
        return sendJson(res, 200, buildState(viewer))
      }
      if (method === 'DELETE') {
        await deleteNote(store, id)
        return sendJson(res, 200, buildState(viewer))
      }
    }

    res.writeHead(405, { allow: 'GET, HEAD, POST, PUT, DELETE' })
    res.end()
  }

  return (req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) sendJson(res, 400, { error: String(error?.message ?? error) })
      else res.end()
    })
  }
}
