/**
 * dsh-prompt-notes —— 纯逻辑层（无 I/O，可直接单测）。
 *
 * 一张「便签」是用户保存的一条常驻配置，有三种形态（kind）：
 *   prompt  一段常驻提示词（语言规范、团队编码要求……），注入 system prompt
 *   skill   一个技能（名称 + 描述 + 正文），登记进 skill 注册表，模型按需加载
 *   mcp     一个 MCP 服务器（stdio 命令 / HTTP 地址），登记进 mcpManager，工具出现在工具列表
 * 以及三种作用域（scope）：
 *   global     所有会话
 *   workspace  工作目录在某个路径之内的会话
 *   session    仅某一个会话
 *
 * 「适用」是相对一个观察者（viewer = 会话 id + 工作目录）而言的：同一张便签，
 * 对会话 A 生效、对会话 B 不生效。这里所有判定都以 viewer 为参数。
 */
import { isAbsolute, relative, resolve } from 'node:path'

export const KINDS = Object.freeze(['prompt', 'skill', 'mcp'])
export const SCOPES = Object.freeze(['global', 'workspace', 'session'])
/** 便签纸色。具体色值由前端决定；这里只是个枚举。 */
export const PAPERS = Object.freeze(['yellow', 'pink', 'blue', 'green', 'lilac'])
/** 每种形态默认的纸色：一眼分辨是提示词、技能还是 MCP。 */
export const DEFAULT_PAPER = Object.freeze({ prompt: 'yellow', skill: 'blue', mcp: 'green' })
/** v1 用的是主题 token 名，升级时映射到纸色。 */
const LEGACY_PAPER = Object.freeze({ brand: 'yellow', success: 'green', warn: 'pink', error: 'pink', idle: 'lilac' })

export const LIMITS = Object.freeze({
  title: 80,
  body: 20000,
  description: 300,
  whenToUse: 300,
  tags: 8,
  tag: 24,
  notes: 200,
  target: 1024,
  command: 512,
  url: 1024,
  args: 32,
  arg: 512,
})

/** 与 dsh-skill 的 SKILL_NAME 一致（kebab-case）。 */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** 与 dsh-mcp-client 的 SERVER_NAME_PATTERN 一致；同时也是工具前缀 mcp__<name>__。 */
export const MCP_NAME = /^[A-Za-z0-9_-]{1,32}$/
const SESSION_ID = /^[A-Za-z0-9_.:-]{1,128}$/

/** 默认的注入预算（字符数，仅对 prompt 便签计）。0 = 不限。 */
export const DEFAULT_MAX_CHARS = 8000

const HEADER = [
  "## Standing instructions from the user's prompt notes",
  '',
  'The user keeps the notes below and has switched them on for this session. ' +
    "Treat each one as a standing instruction unless the user's current message says otherwise.",
].join('\n')

function clip(text, max) {
  return text.length > max ? text.slice(0, max) : text
}

// ───────────────────────── 作用域 ─────────────────────────

/** 去掉末尾分隔符并规整；不碰符号链接（纯字符串层面，无 I/O）。 */
export function normalizePath(p) {
  return resolve(p)
}

/** cwd 是否在 root 之内（含相等）。用 relative 判定，Windows/POSIX 通吃，且不会把 /a/bc 当成 /a/b 的子目录。 */
export function pathWithin(cwd, root) {
  if (typeof cwd !== 'string' || typeof root !== 'string' || !cwd || !root) return false
  if (!isAbsolute(cwd) || !isAbsolute(root)) return false
  const rel = relative(normalizePath(root), normalizePath(cwd))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * 便签是否适用于某个观察者。
 * @param {{scope:string,target:string}} note
 * @param {{sessionId?:string,cwd?:string}} [viewer] 缺省 = 没有会话上下文，只有全局便签适用
 */
export function appliesTo(note, viewer = {}) {
  if (note.scope === 'global') return true
  if (note.scope === 'session') return Boolean(viewer.sessionId) && note.target === viewer.sessionId
  if (note.scope === 'workspace') return pathWithin(viewer.cwd, note.target)
  return false
}

// ───────────────────────── 校验 ─────────────────────────

export function normalizeTags(input) {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,，\n]/) : []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const tag = clip(raw.replace(/^#+/, '').replace(/\s+/g, ' ').trim(), LIMITS.tag)
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= LIMITS.tags) break
  }
  return out
}

/** 参数串：已是数组就清洗；是字符串则按空白切分，支持成对的单/双引号。 */
export function parseArgs(input) {
  if (Array.isArray(input)) return input.filter((a) => typeof a === 'string').map((a) => clip(a, LIMITS.arg)).slice(0, LIMITS.args)
  if (typeof input !== 'string') return []
  const out = []
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(input)) && out.length < LIMITS.args) {
    out.push(clip(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : (m[2] ?? m[3]), LIMITS.arg))
  }
  return out
}

const fail = (error) => ({ ok: false, error })

/** 把 kind 对应的子对象洗成规范形态；不属于该 kind 的子对象一律丢掉。 */
function validateKind(note) {
  if (note.kind === 'prompt') {
    if (!note.body) return fail('正文不能为空')
    return { ok: true }
  }
  if (note.kind === 'skill') {
    const s = note.skill ?? {}
    if (typeof s.name !== 'string' || !SKILL_NAME.test(s.name)) return fail('技能名必须是 kebab-case（小写字母、数字、连字符，如 go-review）')
    if (s.name.length > 64) return fail('技能名过长（≤64）')
    const description = typeof s.description === 'string' ? s.description.replace(/\s+/g, ' ').trim() : ''
    if (!description) return fail('技能必须有一句描述（模型靠它决定何时加载）')
    if (description.length > LIMITS.description) return fail(`技能描述超过 ${LIMITS.description} 字`)
    if (!note.body) return fail('技能正文不能为空')

    // whenToUse：可选的「什么时候用我」，dsh-skill 会把它带进候选与摘要
    const whenToUse = typeof s.whenToUse === 'string' ? s.whenToUse.replace(/\s+/g, ' ').trim() : ''
    if (whenToUse.length > LIMITS.whenToUse) return fail(`「何时使用」超过 ${LIMITS.whenToUse} 字`)

    // invocation：两种调用方式至少要留一种；两者都可调用是默认值，不落盘
    const raw = s.invocation === undefined || s.invocation === null ? {} : s.invocation
    if (typeof raw !== 'object' || Array.isArray(raw)) return fail('invocation 必须是对象')
    const modelInvocable = raw.modelInvocable === undefined ? true : raw.modelInvocable
    const userInvocable = raw.userInvocable === undefined ? true : raw.userInvocable
    if (typeof modelInvocable !== 'boolean' || typeof userInvocable !== 'boolean') return fail('invocation 的两个开关必须是布尔值')
    if (!modelInvocable && !userInvocable) return fail('至少要留一种调用方式（模型或用户）')

    note.skill = { name: s.name, description }
    if (whenToUse) note.skill.whenToUse = whenToUse
    if (!modelInvocable || !userInvocable) note.skill.invocation = { modelInvocable, userInvocable }
    return { ok: true }
  }
  if (note.kind === 'mcp') {
    const m = note.mcp ?? {}
    if (typeof m.name !== 'string' || !MCP_NAME.test(m.name)) return fail('MCP 名只能含字母、数字、下划线、连字符（≤32），它会成为工具前缀 mcp__<名>__')
    if (m.transport !== 'stdio' && m.transport !== 'streamable-http') return fail('transport 必须是 stdio 或 streamable-http')
    if (m.transport === 'stdio') {
      const command = typeof m.command === 'string' ? m.command.trim() : ''
      if (!command) return fail('stdio 的 MCP 必须填启动命令')
      if (command.length > LIMITS.command) return fail('命令过长')
      note.mcp = { name: m.name, transport: 'stdio', command, args: parseArgs(m.args), url: '' }
    } else {
      const url = typeof m.url === 'string' ? m.url.trim() : ''
      let ok = false
      try { const u = new URL(url); ok = u.protocol === 'http:' || u.protocol === 'https:' } catch { /* 非法 URL */ }
      if (!ok) return fail('streamable-http 的 MCP 必须填 http(s) 地址')
      if (url.length > LIMITS.url) return fail('地址过长')
      note.mcp = { name: m.name, transport: 'streamable-http', command: '', args: [], url }
    }
    return { ok: true }
  }
  return fail(`kind 必须是 ${KINDS.join(' / ')} 之一`)
}

function validateScope(note) {
  if (!SCOPES.includes(note.scope)) return fail(`scope 必须是 ${SCOPES.join(' / ')} 之一`)
  if (note.scope === 'global') { note.target = ''; return { ok: true } }
  const target = typeof note.target === 'string' ? note.target.trim() : ''
  if (!target) return fail(note.scope === 'session' ? '会话作用域需要会话 id' : '工作区作用域需要目录路径')
  if (target.length > LIMITS.target) return fail('作用域目标过长')
  if (note.scope === 'session') {
    if (!SESSION_ID.test(target)) return fail('会话 id 含非法字符')
    note.target = target
  } else {
    if (!isAbsolute(target)) return fail('工作区路径必须是绝对路径')
    note.target = normalizePath(target)
  }
  return { ok: true }
}

/**
 * 校验并合成一张便签（新建或部分更新）。
 *
 * @param {unknown} raw 请求体（不可信）
 * @param {{ base?: object }} [opts] 更新时传现有便签；缺省 = 新建
 * @returns {{ ok: true, value: object } | { ok: false, error: string }} value 是「应写入的字段」，
 *   新建时是完整便签（除 id/时间戳），更新时只含变化的字段。
 */
export function parseNoteInput(raw, opts = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fail('请求体必须是 JSON 对象')
  const base = opts.base
  const creating = base === undefined

  if (!creating && 'kind' in raw && raw.kind !== base.kind) return fail('不能更改便签的类型（请新建一张）')

  const kind = creating ? raw.kind ?? 'prompt' : base.kind
  const note = creating
    ? { kind, scope: 'global', target: '', title: '', body: '', tags: [], color: DEFAULT_PAPER[kind] ?? 'yellow', enabled: kind !== 'mcp' }
    : structuredClone({ kind: base.kind, scope: base.scope, target: base.target, title: base.title, body: base.body,
        tags: base.tags, color: base.color, enabled: base.enabled, skill: base.skill, mcp: base.mcp })
  if (!KINDS.includes(kind)) return fail(`kind 必须是 ${KINDS.join(' / ')} 之一`)

  const touched = new Set()
  const take = (key, fn) => { if (key in raw) { const r = fn(raw[key]); if (r) return r; touched.add(key) } return null }

  const errors = [
    take('title', (v) => { if (typeof v !== 'string') return fail('title 必须是字符串'); note.title = clip(v.replace(/\s+/g, ' ').trim(), LIMITS.title) }),
    take('body', (v) => {
      if (typeof v !== 'string') return fail('body 必须是字符串')
      const body = v.replace(/\r\n?/g, '\n').trim()
      if (body.length > LIMITS.body) return fail(`正文超过 ${LIMITS.body} 字上限`)
      note.body = body
    }),
    take('tags', (v) => { note.tags = normalizeTags(v) }),
    take('color', (v) => { if (!PAPERS.includes(v)) return fail(`color 必须是 ${PAPERS.join(' / ')} 之一`); note.color = v }),
    take('enabled', (v) => { if (typeof v !== 'boolean') return fail('enabled 必须是布尔值'); note.enabled = v }),
    take('scope', (v) => { note.scope = v }),
    take('target', (v) => { note.target = v }),
    take('skill', (v) => { if (v === null || typeof v !== 'object') return fail('skill 必须是对象'); note.skill = { ...(note.skill ?? {}), ...v } }),
    take('mcp', (v) => { if (v === null || typeof v !== 'object') return fail('mcp 必须是对象'); note.mcp = { ...(note.mcp ?? {}), ...v } }),
  ].find(Boolean)
  if (errors) return errors

  // 只在 scope 变成 global 时清 target；从 global 改成别的作用域必须同时给 target。
  const sc = validateScope(note)
  if (!sc.ok) return sc
  const k = validateKind(note)
  if (!k.ok) return k
  if (kind !== 'skill') delete note.skill
  if (kind !== 'mcp') delete note.mcp

  if (creating) return { ok: true, value: note }
  // 更新：只返回真正变化的字段（scope/target 一起带上，避免半更新）
  const value = {}
  for (const key of Object.keys(note)) {
    if (JSON.stringify(note[key]) !== JSON.stringify(base[key])) value[key] = note[key]
  }
  return { ok: true, value }
}

/**
 * 同一作用域里不能重名：MCP 名全库唯一（它是登记名、也是工具前缀 mcp__<名>__）；
 * skill 名在同一个 scope + target 里唯一。
 * 路由（人写的请求）和助手工具共用这一条，免得两边判断不一致。
 * @param {object[]} notes 现有便签
 * @param {object} value 待写入的字段（新建时用它；更新时先与旧值合并）
 * @param {string} [excludeId] 更新时排除自己
 * @returns {string|null} 冲突说明（给人/给模型看的一句话），无冲突返回 null
 */
export function conflictOf(notes, value, excludeId) {
  for (const n of notes) {
    if (n.id === excludeId) continue
    if (value.kind === 'mcp' && n.kind === 'mcp' && n.mcp && value.mcp && n.mcp.name === value.mcp.name) {
      return `已有一张 MCP 便签使用名字 "${value.mcp.name}"`
    }
    if (value.kind === 'skill' && n.kind === 'skill' && n.skill && value.skill && n.skill.name === value.skill.name && n.scope === value.scope && n.target === value.target) {
      return `这个作用域里已有同名技能 "${value.skill.name}"`
    }
  }
  return null
}

// ───────────────────────── 展示与注入 ─────────────────────────

/** 标题为空时用正文首行（skill / mcp 用各自的名字）顶上。 */
export function displayTitle(note) {
  if (note.title) return note.title
  if (note.kind === 'skill' && note.skill?.name) return note.skill.name
  if (note.kind === 'mcp' && note.mcp?.name) return note.mcp.name
  const first = String(note.body ?? '').split('\n').find((line) => line.trim()) ?? ''
  const t = first.replace(/^#+\s*/, '').trim()
  return t.length > 40 ? `${t.slice(0, 40)}…` : t || '(untitled)'
}

export function renderBlock(note) {
  return `### ${displayTitle(note)}\n${note.body}`
}

/** 注入顺序固定为「创建先后」：顺序稳定，编辑某条不会让其余内容的 KV cache 前缀失效。 */
export function injectionOrder(notes) {
  return [...notes].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
}

/**
 * 决定对某个观察者，哪些 prompt 便签真的会被注入。
 *
 * 预算对「最终渲染出的字符数」算（含标题与头部），与模型实际看到的一致。
 * 一条放不下就整条放弃（不截断：被截一半的规则比没有更危险），但后面更短的仍可入选。
 *
 * @returns {{ injected: object[], overflow: string[], used: number, max: number }}
 */
export function planInjection(notes, maxChars = DEFAULT_MAX_CHARS, opts = {}) {
  const max = Number.isFinite(maxChars) && maxChars >= 0 ? Math.floor(maxChars) : DEFAULT_MAX_CHARS
  const injected = []
  const overflow = []
  if (opts.paused === true) return { injected, overflow, used: 0, max }
  let used = HEADER.length
  for (const note of injectionOrder(notes)) {
    if (note.kind !== 'prompt' || note.enabled !== true || !appliesTo(note, opts.viewer)) continue
    const cost = renderBlock(note).length + 2
    if (max > 0 && used + cost > max) { overflow.push(note.id); continue }
    injected.push(note)
    used += cost
  }
  if (injected.length === 0) used = 0
  return { injected, overflow, used, max }
}

export function renderSection(injected) {
  if (!injected.length) return ''
  return `${HEADER}\n\n${injected.map(renderBlock).join('\n\n')}`
}

/** 对某个观察者生效的 skill / MCP 便签（总开关关闭时为空）。 */
export function effectiveNotes(notes, kind, viewer, paused = false) {
  if (paused) return []
  return injectionOrder(notes).filter((n) => n.kind === kind && n.enabled === true && appliesTo(n, viewer))
}

/**
 * 给每张便签标出「相对观察者」的状态，供面板分组：
 *   injected  正在生效（prompt 已注入 / skill 已装载 / MCP 已登记）
 *   overflow  已启用且适用，但字数预算放不下（仅 prompt）
 *   paused    已启用且适用，但总开关关了
 *   elsewhere 已启用，但不适用于当前会话/工作区
 *   off       未启用
 * @param {Record<string, object>} [runtime] MCP 运行时状态，按 MCP 名索引
 */
export function describeNotes(notes, plan, opts = {}) {
  const { paused = false, viewer, runtime = {} } = opts
  const injectedIds = new Set(plan.injected.map((n) => n.id))
  const overflowIds = new Set(plan.overflow)
  return notes.map((note) => {
    const applies = appliesTo(note, viewer)
    let status
    if (!note.enabled) status = 'off'
    else if (!applies) status = 'elsewhere'
    else if (paused) status = 'paused'
    else if (note.kind === 'prompt') status = injectedIds.has(note.id) ? 'injected' : overflowIds.has(note.id) ? 'overflow' : 'off'
    else status = 'injected'
    const out = { ...note, status, applies, chars: note.kind === 'prompt' ? renderBlock(note).length : note.body.length }
    // 只有启用的便签才附运行时状态：未启用时 mcpManager 里同名的条目（比如用户自己配置的）不是这张便签的。
    if (note.kind === 'mcp' && note.enabled && note.mcp && runtime[note.mcp.name]) out.runtime = runtime[note.mcp.name]
    return out
  })
}

// ───────────────────────── skill 适配 ─────────────────────────

/** 一张 skill 便签 → dsh-skill 的候选（SkillCandidate）。 */
export function skillCandidate(note) {
  return {
    name: note.skill.name,
    description: note.skill.description,
    ...(note.skill.whenToUse ? { whenToUse: note.skill.whenToUse } : {}),
    invocation: {
      modelInvocable: note.skill.invocation?.modelInvocable !== false,
      userInvocable: note.skill.invocation?.userInvocable !== false,
    },
    source: 'prompt-notes',
    provider: 'prompt-notes',
    resourceBase: { kind: 'opaque', description: 'a sticky note kept in the user\'s prompt-notes panel; it has no files' },
    rank: 250,
    locator: note.id,
  }
}

/** 一张 skill 便签 → 完整 skill 定义（含正文）。 */
export function skillDefinition(note) {
  const { rank, locator, ...summary } = skillCandidate(note)
  return { ...summary, content: note.body }
}

/**
 * MCP 便签 → mcpManager.register 的 entry。
 *
 * TODO(prompt-notes): 暂不支持 env / headers。它们常带令牌，明文存进便签文件不合适；
 *   等接上凭据服务后用 `${credential:REF}` 模板引用（mcpManager 已支持 expandTemplates），
 *   而不是把密钥写进 notes.json。目前 stdio 子进程继承 DSH 的（已清洗的）环境变量。
 * TODO(prompt-notes): 技能还差「附带资源文件」；whenToUse 与调用策略（invocation）已经补上（M7）。
 */
export function mcpEntry(note) {
  const m = note.mcp
  return m.transport === 'stdio'
    ? { transport: 'stdio', command: m.command, args: m.args }
    : { transport: 'streamable-http', url: m.url }
}
