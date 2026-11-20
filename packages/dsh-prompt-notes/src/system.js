/**
 * 系统联动：读出「系统本身已经注入了什么」，让面板把它们当成只读便签摆出来。
 *
 * 全部是现场读取，不缓存业务数据、不替系统做任何决定：
 *   sections / contexts  ← systemPrompt.assemble() 的真实结果（模型这一轮实际会看到的）
 *   skills               ← skills.list()（含各 provider 来源）
 *   mcp                  ← mcpManager.list() 的连接状态 + assemble 里的 mcp__* 工具
 *
 * assemble() 会跑完整的 waterfall（含别的插件的监听器），所以：只在面板请求时才调、
 * 3 秒内同一观察者复用结果、任何一步失败都只记进 errors，不让整个接口失败。
 */

const CACHE_MS = 3000
/** 每段正文最多回传这么多字符；面板是预览，不是日志查看器。 */
const MAX_TEXT = 6000

function clip(text) {
  const s = String(text ?? '')
  return s.length > MAX_TEXT ? { text: s.slice(0, MAX_TEXT), truncated: true } : { text: s, truncated: false }
}

/** 通过一个 context 尝试取服务；缺失/抛错都当不存在。 */
function service(ctx, key) {
  try { return ctx[key] } catch { return undefined }
}

/**
 * 把请求里的 (sessionId, cwd) 解析成观察者。会话存在时以服务端为准——
 * 前端传来的 cwd 只是兜底（会话列表摘要里的 cwd 可能滞后于 cd 命令）。
 */
export function resolveViewer(ctx, { sessionId, cwd } = {}) {
  const agents = service(ctx, 'agents')
  let agent
  try { agent = sessionId && agents?.get ? agents.get(sessionId) : undefined } catch { agent = undefined }
  let liveCwd
  if (agent) {
    try { liveCwd = service(ctx, 'workingDirectory')?.get?.(agent.session) } catch { liveCwd = undefined }
  }
  return {
    agent,
    viewer: { sessionId: sessionId || undefined, cwd: liveCwd ?? (cwd || undefined) },
    found: Boolean(agent),
  }
}

/** 活动 agent 的会话 id 列表（给「这个会话 id 是否真实存在」做提示用）。 */
export function liveSessionIds(ctx) {
  try { return (service(ctx, 'agents')?.list?.() ?? []).map((a) => a.id) } catch { return [] }
}

const cache = new Map()

/**
 * @param {object} ctx 插件的 context
 * @param {{sessionId?:string,cwd?:string}} query
 * @param {{ selfSection: string }} opts 本插件注入的 section 名，用来在结果里标记「这是我自己的」
 */
export async function collectSystem(ctx, query, opts) {
  const key = `${query.sessionId ?? ''}|${query.cwd ?? ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value

  const { agent, viewer, found } = resolveViewer(ctx, query)
  const errors = []
  const out = {
    session: { id: viewer.sessionId ?? null, cwd: viewer.cwd ?? null, found },
    sections: [], contexts: [], skills: [], mcp: [], tools: { count: 0, mcpCount: 0 },
    errors,
  }

  // 1) 真实的 prompt 组装结果
  try {
    const sp = service(ctx, 'systemPrompt')
    if (!sp?.assemble) throw new Error('systemPrompt service unavailable')
    const assembly = await sp.assemble(agent ? { agent, scope: agent } : {})
    out.sections = (assembly.sections ?? []).map((s) => ({ name: s.name, mine: s.name === opts.selfSection, chars: String(s.text ?? '').length, ...clip(s.text) }))
    out.contexts = (assembly.contexts ?? []).map((c) => ({ name: c.name, chars: String(c.text ?? '').length, ...clip(c.text) }))
    const tools = assembly.tools ?? []
    out.tools = { count: tools.length, mcpCount: tools.filter((t) => String(t.name).startsWith('mcp__')).length }
    out.mcpTools = tools.filter((t) => String(t.name).startsWith('mcp__')).map((t) => t.name)
  } catch (error) {
    errors.push(`prompt: ${String(error?.message ?? error)}`)
  }

  // 2) skill 目录
  try {
    const skills = service(ctx, 'skills')
    if (skills?.list) {
      const list = await skills.list({ cwd: viewer.cwd, ...(agent ? { scope: agent } : {}) })
      out.skills = list.map((s) => ({
        name: s.name, description: s.description, source: s.source, provider: s.provider,
        mine: s.provider === 'prompt-notes',
        ...(s.whenToUse ? { whenToUse: s.whenToUse } : {}),
        modelInvocable: s.invocation?.modelInvocable !== false,
        userInvocable: s.invocation?.userInvocable !== false,
      }))
    }
  } catch (error) {
    errors.push(`skills: ${String(error?.message ?? error)}`)
  }

  // 3) MCP 服务器
  try {
    const mgr = service(ctx, 'mcpManager')
    if (mgr?.list) {
      out.mcp = mgr.list().map((v) => ({
        name: v.name, configured: v.configured, state: v.status?.state ?? 'unknown',
        error: v.status?.lastError ?? undefined,
        tools: (out.mcpTools ?? []).filter((t) => t.startsWith(`mcp__${v.name}__`)).length,
      }))
    }
  } catch (error) {
    errors.push(`mcp: ${String(error?.message ?? error)}`)
  }
  delete out.mcpTools

  cache.set(key, { at: Date.now(), value: out })
  if (cache.size > 32) cache.delete(cache.keys().next().value)
  return out
}

/** 仅供测试：清缓存。 */
export function _resetSystemCache() { cache.clear() }
