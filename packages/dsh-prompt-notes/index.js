/**
 * dsh-prompt-notes —— host 半体。
 *
 * 把用户的「便签」按作用域送进系统的三个入口：
 *   prompt → system prompt 的一个段（按当前会话/工作目录过滤）
 *   skill  → skill 注册表的一个提供方（全局/工作区走全局提供方，会话级走每个 agent 自己的提供方）
 *   mcp    → mcpManager.register 登记服务器；工具调用按作用域经 tools.guard 拦截
 * 另外开一组 HTTP 路由给右侧栏的便签面板读写，并读出系统自带的注入内容供面板展示。
 *
 * 默认没有便签 → 三条通道都是空的 → 装上这个插件不会改变任何一次请求。
 *
 * 配置（cordis.patch.yml 的 config，均可省略）：
 *   enabled   boolean  false 时整个插件休眠。默认 true
 *   maxChars  number   每个会话里 prompt 便签合计的字符预算；0 = 不限。默认 8000
 *   order     number   system prompt 段位置（0=persona，500=plan policy）。默认 100
 *   file      string   数据文件路径。默认 $DSH_HOME/prompt-notes/notes.json
 *   mcp       boolean  false 时不登记 MCP 便签（MCP 会启动本地进程，想彻底关掉就设 false）。默认 true
 *   pollMs    number   探测数据文件被外部改动的间隔（毫秒，≥10）。默认 2000
 */
import {
  DEFAULT_MAX_CHARS, appliesTo, effectiveNotes, mcpEntry, pathWithin, planInjection, renderSection,
  skillCandidate, skillDefinition,
} from './src/notes.js'
import { NoteStore, resolveDataFile } from './src/store.js'
import { ROUTE_PREFIX, createHandler } from './src/routes.js'
import { collectSystem, liveSessionIds, resolveViewer } from './src/system.js'
import { registerNoteTools } from './src/tools.js'

export const name = 'prompt-notes'
export const inject = ['systemPrompt']

const SECTION_NAME = 'prompt-notes:injected'
const PROVIDER = 'prompt-notes'

function warn(...args) {
  try { console.warn('[prompt-notes]', ...args) } catch { /* ignore */ }
}

/**
 * 从「服务持有者」取 cwd。
 *
 * 为什么不直接 ctx.workingDirectory：Cordis 要求访问 ctx.<服务> 时当前 fiber 链上声明过该依赖，
 * 否则抛 "cannot get property … without inject"。可选依赖的惯用法是嵌套的 ctx.inject([...], cb)，
 * 在回调里拿到服务并存进 svc（见 apply 里的 want）。曾经直接在外层 ctx 上取、再把异常吞掉，
 * 结果在真实系统里 cwd 永远是 undefined，工作区作用域悄悄失效——所以这里不吞异常，只在服务缺席时返回空。
 */
function viewerOfAgent(svc, agent) {
  if (!agent) return {}
  const wd = svc.workingDirectory
  return { sessionId: agent.id, cwd: wd?.get ? wd.get(agent.session) : undefined }
}

export function apply(ctx, config = {}) {
  const cfg = config && typeof config === 'object' ? config : {}
  if (cfg.enabled === false) return

  const maxChars = Number.isFinite(cfg.maxChars) && cfg.maxChars >= 0 ? cfg.maxChars : DEFAULT_MAX_CHARS
  const order = Number.isFinite(cfg.order) ? cfg.order : 100
  const allowMcp = cfg.mcp !== false
  const pollMs = Number.isFinite(cfg.pollMs) && cfg.pollMs >= 10 ? cfg.pollMs : 2000
  const file = resolveDataFile(cfg.file)
  const store = new NoteStore(file, warn)

  // 可选依赖的持有者：服务就绪时填入，卸载时清空。systemPrompt 是必需依赖，直接可用。
  const svc = { systemPrompt: ctx.systemPrompt }
  const want = (name) => {
    try {
      ctx.inject([name], (c) => {
        svc[name] = c[name]
        c.effect(() => () => { if (svc[name] === c[name]) delete svc[name] })
      })
    } catch (error) {
      warn(`${name} unavailable:`, String(error))
    }
  }
  want('agents')
  want('workingDirectory')

  // ───────── prompt ─────────
  // interpolate:false —— 便签是用户写的任意文本，里面出现 `{{` 不能让整次模型调用因
  // 「unknown prompt variable」而失败，也不该把 `{{cwd}}` 之类悄悄替换掉用户写的字面量。
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order,
    interpolate: false,
    text: (context) => {
      try {
        const doc = store.snapshot()
        const viewer = viewerOfAgent(svc, context?.agent)
        return renderSection(planInjection(doc.notes, maxChars, { paused: doc.paused, viewer }).injected)
      } catch (error) {
        // 组装 system prompt 绝不能因为便签文件出问题而失败。
        warn('failed to render notes section:', String(error))
        return ''
      }
    },
  })

  // ───────── skill ─────────
  const invalidators = new Set()
  const invalidateSkills = () => { for (const fn of invalidators) { try { fn() } catch { /* 已卸载的提供方 */ } } }
  /**
   * @param viewerOf 由提供方收到的查询选项算出观察者。提供方这一层只拿得到 cwd，拿不到会话 id，
   *   所以会话级便签必须由「挂在该 agent.ctx 上」的提供方负责——它在创建时就知道自己是哪个会话。
   */
  const skillProvider = (match, viewerOf) => (control) => {
    invalidators.add(control.invalidate)
    control.signal.addEventListener('abort', () => invalidators.delete(control.invalidate), { once: true })
    const pick = (options) => {
      const doc = store.snapshot()
      return effectiveNotes(doc.notes, 'skill', viewerOf(options), doc.paused).filter(match)
    }
    return {
      name: PROVIDER,
      list: async (options) => ({ candidates: pick(options).map(skillCandidate), complete: true }),
      get: async (candidate, options) => {
        const note = pick(options).find((n) => n.id === candidate.locator)
        return note ? skillDefinition(note) : undefined
      },
    }
  }

  try {
    ctx.inject(['skills'], (c) => {
      const skills = c.skills
      svc.skills = skills
      c.effect(() => () => { delete svc.skills })
      if (!skills?.registerProvider) return
      // 全局提供方：global 与 workspace 便签（workspace 靠调用方 cwd 过滤）
      const dispose = skills.registerProvider(skillProvider((n) => n.scope !== 'session', (o) => ({ cwd: o.cwd })))
      c.effect(() => dispose)

      // 每个会话一个提供方：只放 session 级便签。注册在 agent.ctx 上，随该 agent 一起消亡。
      // TODO(prompt-notes): 提供方随 agent.ctx 销毁时会 abort 并从 invalidators 摘掉；
      //   若发现长跑进程里仍有累积，可在 agent 销毁事件上主动回收。
      const attach = (agent) => {
        // agent.ctx 是另一棵树，没声明依赖就取不到 skills（"cannot get property skills without inject"）。
        // 所以在 agent.ctx 上再嵌一层 inject：回调里的 actx 既带 skills，又带该 agent 的作用域，
        // 注册进去的提供方只对这个会话可见，并随 agent 一起消亡。
        try {
          agent.ctx.inject(['skills'], (actx) => {
            const undo = actx.skills.registerProvider(
              skillProvider((n) => n.scope === 'session' && n.target === agent.id, () => ({ sessionId: agent.id })))
            actx.effect(() => undo)
          })
        } catch (error) {
          warn(`could not attach session skill provider for ${agent.id}:`, String(error))
        }
      }
      c.on('agent/created', ({ agent }) => { attach(agent) })
      for (const a of svc.agents?.list?.() ?? []) attach(a)
    })
  } catch (error) {
    warn('skills service unavailable, skill notes are inactive:', String(error))
  }

  // ───────── mcp ─────────
  /** MCP 登记失败的原因，按名字索引，给面板显示。 */
  const mcpFailures = new Map()
  const registered = new Map() // name → { sig, dispose }

  /**
   * 这张 MCP 便签现在该不该真的起一个进程。
   *
   * MCP 进程是全局的（连上之后工具会挂到所有会话上），但「全局」不等于「无条件」：
   * 一张钉在某个会话 / 某个目录上的便签，在没有适用的活动会话时启动一个子进程是纯浪费——
   * 用户看不到它（工具只对适用的会话有意义，调用还会被下面的 guard 拒掉），却要为它付内存与启动时间。
   *
   * 名字与便签是 1:1（路由层的 conflict 保证全库 MCP 名唯一），所以这里不需要引用计数：
   * 「该不该活」完全由那一张便签的 scope 决定。
   *
   * 服务缺席时（只可能出现在单测的假 ctx 里）返回 true：保留 v0.2 的「总是登记」，
   * 宁可多起一个进程，也不要让用户在能力齐全的环境里莫名其妙看不到自己的 MCP。
   */
  const mcpWanted = (note) => {
    if (note.scope === 'global') return true
    const listed = svc.agents?.list?.()
    if (!Array.isArray(listed)) return true
    if (note.scope === 'session') return listed.some((a) => a.id === note.target)
    const wd = svc.workingDirectory
    if (typeof wd?.get !== 'function') return true
    return listed.some((a) => {
      try { return pathWithin(wd.get(a.session), note.target) } catch { return false }
    })
  }

  const reconcileMcp = (manager) => {
    const doc = store.snapshot()
    // MCP 进程是全局的（工具挂到所有会话上），作用域靠 tools.guard 在调用时拦截；
    // 「什么时候该起进程」则由 mcpWanted 决定：没有适用的活动会话就不登记。
    const wanted = new Map()
    if (allowMcp && !doc.paused) {
      for (const n of doc.notes) if (n.kind === 'mcp' && n.enabled && mcpWanted(n)) wanted.set(n.mcp.name, n)
    }
    for (const [name, rec] of registered) {
      const note = wanted.get(name)
      if (!note || JSON.stringify(mcpEntry(note)) !== rec.sig) {
        try { rec.dispose() } catch (error) { warn(`failed to unregister mcp "${name}":`, String(error)) }
        registered.delete(name)
      }
    }
    for (const [name, note] of wanted) {
      if (registered.has(name)) continue
      const entry = mcpEntry(note)
      try {
        const dispose = manager.register(name, entry)
        registered.set(name, { sig: JSON.stringify(entry), dispose })
        mcpFailures.delete(name)
      } catch (error) {
        mcpFailures.set(name, String(error?.message ?? error))
        warn(`could not register mcp "${name}":`, mcpFailures.get(name))
      }
    }
    for (const name of [...mcpFailures.keys()]) if (!wanted.has(name)) mcpFailures.delete(name)
  }

  let mcpManager
  try {
    ctx.inject(['mcpManager'], (c) => {
      mcpManager = c.mcpManager
      svc.mcpManager = mcpManager
      if (!mcpManager?.register) { mcpManager = undefined; return }
      reconcileMcp(mcpManager)
      c.effect(() => () => {
        for (const rec of registered.values()) { try { rec.dispose() } catch { /* 随插件卸载 */ } }
        registered.clear()
        mcpManager = undefined
        delete svc.mcpManager
      })
    })
  } catch (error) {
    warn('mcpManager unavailable, mcp notes are inactive:', String(error))
  }

  /** 这个工具名属于哪一张 MCP 便签（最长前缀优先：wsonly_x 不会被 wsonly 抢走）。 */
  const mcpOwnerOf = (notes, toolName) => {
    let owner
    for (const n of notes) {
      if (n.kind !== 'mcp' || !n.mcp?.name) continue
      if (!toolName.startsWith(`mcp__${n.mcp.name}__`)) continue
      if (!owner || n.mcp.name.length > owner.mcp.name.length) owner = n
    }
    return owner
  }

  try {
    ctx.inject(['tools'], (c) => {
      svc.tools = c.tools
      c.effect(() => () => { delete svc.tools })
      // 助手工具：让模型也能读写便签（MCP 会被强制未钉住，见 src/tools.js 顶部的边界说明）
      try {
        const disposeNoteTools = registerNoteTools(c.tools, { store, viewerOf: (agent) => viewerOfAgent(svc, agent) })
        c.effect(() => disposeNoteTools)
      } catch (error) {
        warn('note tools failed to register:', String(error))
      }
      if (!c.tools?.guard) return
      // 兜底拦截：万一工具还在列表里（restrict 没跟上），调用这一刻也要按作用域放行/拒绝。
      const dispose = c.tools.guard((exec) => {
        if (typeof exec?.name !== 'string' || !exec.name.startsWith('mcp__')) return undefined
        const owner = mcpOwnerOf(store.snapshot().notes, exec.name)
        if (!owner || owner.scope === 'global') return undefined
        if (appliesTo(owner, viewerOfAgent(svc, exec.agent))) return undefined
        const where = owner.scope === 'session' ? 'another session' : `the workspace ${owner.target}`
        return `The MCP server "${owner.mcp.name}" is limited to ${where} by the user's prompt notes; it is not available here.`
      })
      c.effect(() => dispose)
    })
  } catch (error) {
    warn('tools service unavailable, mcp scope guard is inactive:', String(error))
  }

  // ───────── 把不适用的 MCP 工具从会话里藏起来 ─────────
  /**
   * 为什么要等「连接成功」之后才能做：`tools.restrict({deny})` 只接受**此刻已经存在的全局工具名**，
   * 而 MCP 的工具名要等服务器连上、把 schema 注册进来才知道。提前调只会抛
   * "names unknown global tool"。
   * 为什么只能在 `agent.ctx` 上做：restrict 的语义是「这一个 agent 继承到的全局工具」，
   * 在根 ctx 上调会被直接拒绝（那会把所有 agent 的工具一起遮掉）。
   *
   * 于是每个 tick 对齐一次：读出每个活动 agent 现在看得到的 `mcp__*`，
   * 按便签作用域算出「不该给它看的」，用 restrict 藏起来；只在 deny 集合变化时动注册表。
   */
  const restricted = new Map() // agentId → { sig, lift }
  const restrictFailures = new Set()
  const applyMcpRestrictions = () => {
    const tools = svc.tools
    if (!tools?.definitions || !tools?.restrict) return
    const listed = svc.agents?.list?.()
    if (!Array.isArray(listed)) return
    const notes = store.snapshot().notes
    const liveIds = new Set()
    for (const agent of listed) {
      liveIds.add(agent.id)
      let names
      try { names = tools.definitions(agent).map((d) => d.name) } catch { continue }
      const viewer = viewerOfAgent(svc, agent)
      const deny = names.filter((name) => {
        if (!name.startsWith('mcp__')) return false
        const owner = mcpOwnerOf(notes, name)
        return Boolean(owner) && owner.scope !== 'global' && !appliesTo(owner, viewer)
      })
      const sig = deny.slice().sort().join(',')
      const rec = restricted.get(agent.id)
      if (rec && rec.sig === sig) continue
      if (rec) { try { rec.lift() } catch { /* agent 已经消失 */ } restricted.delete(agent.id) }
      if (!deny.length) continue
      try {
        agent.ctx.inject(['tools'], (t) => {
          try {
            const lift = t.tools.restrict({ deny })
            t.effect(() => () => { try { lift() } catch { /* 随 agent 卸载 */ } })
            restricted.set(agent.id, { sig, lift })
          } catch (error) {
            // 失败不记账（下一 tick 还会重试），但同一种失败只 warn 一次，别把日志刷满
            const key = `${agent.id}|${sig}`
            if (!restrictFailures.has(key)) { restrictFailures.add(key); warn(`could not hide mcp tools from ${agent.id}:`, String(error)) }
          }
        })
      } catch (error) {
        warn(`could not attach mcp restrictions for ${agent.id}:`, String(error))
      }
    }
    for (const [id, rec] of restricted) if (!liveIds.has(id)) { try { rec.lift() } catch { /* 已随 agent 卸载 */ } restricted.delete(id) }
  }

  // ───────── 变更联动 ─────────
  /**
   * 便签没变、但「活着的会话」变了：一张钉在会话 A 上的 MCP，A 一关就该停掉子进程；
   * A 再打开（新建或恢复会话）又该起回来。list() 很便宜，用「id:cwd 拼起来的签名」判断
   * 有没有变化，变了才重算，免得每 2 秒都把注册表搅一遍（重试失败的注册还会刷日志）。
   */
  let liveSig = null
  const reconcileIfLiveChanged = () => {
    if (!mcpManager) return
    const listed = svc.agents?.list?.()
    if (!Array.isArray(listed)) return
    const wd = svc.workingDirectory
    const sig = listed.map((a) => `${a.id}:${wd?.get?.(a.session) ?? ''}`).join('|')
    if (sig === liveSig) return
    liveSig = sig
    reconcileMcp(mcpManager)
  }
  try {
    ctx.on('agent/created', () => reconcileIfLiveChanged())
  } catch (error) {
    warn('agent/created listener unavailable:', String(error))
  }

  // 外部手改数据文件也要生效：定时探测一次（只是一次 stat），变化时重登记 MCP、刷新 skill 目录。
  // 同一个 tick 里顺带看一眼活着的会话（关掉会话 → 停掉它的 MCP 子进程）：不新增定时器。
  const unsubscribe = store.subscribe(() => {
    invalidateSkills()
    if (mcpManager) reconcileMcp(mcpManager)
    try { applyMcpRestrictions() } catch (error) { warn('mcp restrict failed:', String(error)) }
  })
  const timer = setInterval(() => {
    try { store.poll() } catch (error) { warn('poll failed:', String(error)) }
    try { reconcileIfLiveChanged() } catch (error) { warn('mcp reconcile failed:', String(error)) }
    try { applyMcpRestrictions() } catch (error) { warn('mcp restrict failed:', String(error)) }
  }, pollMs)
  timer.unref?.()
  ctx.effect(() => () => { clearInterval(timer); unsubscribe() })

  // ───────── 面板路由 ─────────
  const hostApi = {
    resolveViewer: (query) => resolveViewer(svc, query).viewer,
    liveSessionIds: () => liveSessionIds(svc),
    system: (query) => collectSystem(svc, query, { selfSection: SECTION_NAME }),
    mcpRuntime: () => {
      const out = {}
      try {
        for (const v of mcpManager?.list?.() ?? []) out[v.name] = { state: v.status?.state ?? 'unknown', error: v.status?.lastError }
      } catch { /* 状态读不到就不显示 */ }
      for (const [n, message] of mcpFailures) out[n] = { state: 'failed', error: message }
      return out
    },
    mcpAllowed: allowMcp,
  }

  try {
    ctx.inject(['webServer'], (c) => {
      const webServer = c.webServer
      if (!webServer || typeof webServer.register !== 'function') return
      const dispose = webServer.register({
        kind: 'prefix',
        // 不带尾斜杠：webServer 的前缀按路径段匹配（spellbook / cove-task 都是 '/dsh-xxx'），
        // 注册成 '/dsh-prompt-notes/' 会让 '/dsh-prompt-notes/state' 匹配不上而 404。
        path: ROUTE_PREFIX.replace(/\/$/, ''),
        handler: createHandler({ store, maxChars, order, file, host: hostApi }),
      })
      c.effect(() => dispose)
    })
  } catch (error) {
    warn('webServer unavailable, panel routes not registered:', String(error))
  }
}
