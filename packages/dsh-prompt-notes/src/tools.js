/**
 * 助手工具：让模型也能读写便签（note_list / note_create / note_update / note_delete）。
 *
 * 为什么这套工具需要「安全边界」而不是简单地转发到路由：
 *   1. MCP 便签钉上 = 在本机以 DSH 的权限启动一条命令。这件事只能由人做，
 *      所以助手创建的 MCP 便签一律未钉住，助手也不能把任何 MCP 便签改成启用。
 *   2. 改一张**已在跑**的 MCP 便签的启动命令，会触发重登记 → 换一条新命令去跑。
 *      所以助手只能改 MCP 便签的标题 / 备注 / 标签这些纯装饰字段，不能动 mcp / enabled / scope / target。
 *   3. 一次调用只动一张便签（不批量），正文长度沿用 parseNoteInput 的上限，
 *      列表里的正文有总额度上限 —— 助手不该一次把整个便签簿灌进上下文。
 *   4. 校验、重名、数量上限全部复用 src/mutations.js / src/notes.js，与面板走的 HTTP 端同一条路径。
 *
 * 工具的结果一律是一段文本（JSON），模型读它就是数据；错误直接抛，工具管线会把它变成
 * 一次「工具失败」结果，不会中断整轮对话。
 */
import { appliesTo } from './notes.js'
import { createNote, deleteNote, updateNote } from './mutations.js'

export const NOTE_TOOL_NAMES = Object.freeze(['note_list', 'note_create', 'note_update', 'note_delete'])
/** 列表里最多回传这么多字符的正文（跨便签合计），超了只给摘要。 */
const LIST_BODY_BUDGET = 6000
/** 单张便签回传的正文上限。 */
const LIST_BODY_PER_NOTE = 2000

const KINDS = ['prompt', 'skill', 'mcp']
const SCOPES = ['global', 'workspace', 'session']

// execute 返回的是**值**（这里是给模型读的一段文本），render 才把它包成内容块。
const text = (value) => [{ type: 'text', text: String(value) }]
const json = (rows) => JSON.stringify(rows, null, 1)

const SKILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', description: 'kebab-case, e.g. go-review' },
    description: { type: 'string', description: 'one line; the model decides when to load the skill by this' },
    whenToUse: { type: 'string', description: 'optional: when this skill applies, e.g. "when reviewing Go code"' },
    invocation: {
      type: 'object',
      additionalProperties: false,
      description: 'who may invoke it; default both',
      properties: {
        modelInvocable: { type: 'boolean' },
        userInvocable: { type: 'boolean' },
      },
    },
  },
}
const MCP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', description: 'becomes the tool prefix mcp__<name>__' },
    transport: { type: 'string', enum: ['stdio', 'streamable-http'] },
    command: { type: 'string' },
    args: { type: 'array', items: { type: 'string' } },
    url: { type: 'string' },
  },
}

/** 便签 → 给模型看的紧凑形态（不含内部字段，正文按额度给）。 */
function brief(note, viewer, bodyBudget) {
  const out = {
    id: note.id, kind: note.kind, scope: note.scope, target: note.target || undefined,
    title: note.title || undefined, enabled: note.enabled, applies: appliesTo(note, viewer),
    chars: String(note.body || '').length, updatedAt: note.updatedAt,
  }
  if (note.kind === 'skill' && note.skill) {
    out.skill = {
      name: note.skill.name,
      description: note.skill.description,
      ...(note.skill.whenToUse ? { whenToUse: note.skill.whenToUse } : {}),
      invocation: {
        modelInvocable: note.skill.invocation?.modelInvocable !== false,
        userInvocable: note.skill.invocation?.userInvocable !== false,
      },
    }
  }
  if (note.kind === 'mcp' && note.mcp) out.mcp = { name: note.mcp.name, transport: note.mcp.transport, command: note.mcp.command || undefined, url: note.mcp.url || undefined }
  if (bodyBudget !== undefined) {
    const body = String(note.body || '')
    const take = Math.min(body.length, LIST_BODY_PER_NOTE, Math.max(0, bodyBudget))
    if (take > 0) { out.body = body.slice(0, take); if (take < body.length) out.truncated = true }
  }
  return out
}

/**
 * @param {{ store: object, viewerOf: (agent: object|undefined) => {sessionId?:string, cwd?:string} }} deps
 */
export function createNoteToolDefinitions({ store, viewerOf }) {
  const viewerFor = (exec) => {
    try { return viewerOf(exec?.agent) || {} } catch { return {} }
  }

  return [
    {
      name: 'note_list',
      description: [
        "List the user's prompt notes: the sticky notes in the Notes tab that carry standing prompts, skills, and MCP server configs.",
        'Each row says which kind and scope it has, whether it applies to this session right now, and whether it is pinned (enabled).',
        'Read-only. Set includeBody to include the note text; the total is capped, so list without it first.',
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: KINDS },
          scope: { type: 'string', enum: SCOPES },
          includeBody: { type: 'boolean', description: 'include note text (capped by a total budget)' },
        },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
      execute(args = {}, exec) {
        const viewer = viewerFor(exec)
        const doc = store.snapshot()
        const picked = doc.notes
          .filter((n) => (args.kind ? n.kind === args.kind : true) && (args.scope ? n.scope === args.scope : true))
        let budget = args.includeBody ? LIST_BODY_BUDGET : undefined
        const rows = picked.map((n) => {
          const row = brief(n, viewer, budget)
          if (budget !== undefined) budget -= String(row.body || '').length
          return row
        })
        return json({ viewer, paused: doc.paused, count: rows.length, notes: rows })
      },
    },

    {
      name: 'note_create',
      description: [
        "Create one note for the user: a standing prompt (injected into sessions by scope), a skill (listed in the model's skill catalog), or an MCP server config.",
        'MCP notes are ALWAYS created unpinned and the assistant cannot enable one — only the user can pin an MCP server in the panel, because pinning starts a local process.',
        'This writes the user\'s real notes file: keep bodies short and do not paste secrets.',
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['body'],
        properties: {
          kind: { type: 'string', enum: KINDS, description: 'default prompt' },
          body: { type: 'string', description: 'note text' },
          title: { type: 'string' },
          scope: { type: 'string', enum: SCOPES, description: 'default global' },
          target: { type: 'string', description: 'session id or absolute directory, required for session / workspace scope' },
          enabled: { type: 'boolean', description: 'ignored (always false) for MCP notes' },
          tags: { type: 'array', items: { type: 'string' } },
          skill: SKILL_SCHEMA,
          mcp: MCP_SCHEMA,
        },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
      async execute(args = {}, exec) {
        const input = { ...args }
        delete input.includeBody
        // 助手建的 MCP 便签一律未钉住：钉上等于在本机启动一条命令，只能由人决定。
        if ((input.kind ?? 'prompt') === 'mcp') delete input.enabled
        const result = await createNote(store, input)
        if (!result.ok) throw new Error(result.error)
        const viewer = viewerFor(exec)
        const row = brief(result.note, viewer, 0)
        const note = (input.kind ?? 'prompt') === 'mcp'
          ? 'created unpinned; the user has to pin it in the panel to start it'
          : 'created'
        return json({ ok: true, note: row, hint: note })
      },
    },

    {
      name: 'note_update',
      description: [
        'Update one note by id; fields you omit stay unchanged. You cannot change a note\'s kind.',
        'For MCP notes you may only change title, body and tags: the assistant cannot enable an MCP note or alter its command, scope or target — only the user can edit those in the panel.',
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          scope: { type: 'string', enum: SCOPES },
          target: { type: 'string' },
          enabled: { type: 'boolean' },
          skill: SKILL_SCHEMA,
          mcp: MCP_SCHEMA,
        },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
      async execute(args = {}, exec) {
        const id = typeof args.id === 'string' ? args.id : ''
        const note = store.snapshot().notes.find((n) => n.id === id)
        if (!note) throw new Error(`no note with id "${id}" (use note_list to find one)`)
        if (note.kind === 'mcp') {
          const blocked = ['mcp', 'enabled', 'scope', 'target'].filter((k) => k in args)
          if (blocked.length) {
            throw new Error(`only the user can change ${blocked.join(', ')} on an MCP note; the assistant may change title, body or tags`)
          }
        }
        const patch = { ...args }
        delete patch.id
        delete patch.includeBody
        const result = await updateNote(store, id, patch)
        if (!result.ok) throw new Error(result.error)
        const viewer = viewerFor(exec)
        return json({ ok: true, note: brief(result.note, viewer, LIST_BODY_PER_NOTE) })
      },
    },

    {
      name: 'note_delete',
      description: 'Delete one note by id. It stops being injected / registered immediately. It goes to a trash the user can undo from; the assistant cannot restore it.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
      async execute(args = {}) {
        const id = typeof args.id === 'string' ? args.id : ''
        if (!id) throw new Error('id is required')
        const before = store.snapshot().notes.find((n) => n.id === id)
        const result = await deleteNote(store, id)
        return json({ ok: true, deleted: result.removed, id, kind: before?.kind })
      },
    },
  ]
}

/**
 * 注册到工具服务上；返回一个「全部撤销」的函数（测试和插件卸载都用得上）。
 * @param {object} tools ctx.tools（必须带 register）
 * @param {{ store: object, viewerOf: Function }} deps
 */
export function registerNoteTools(tools, deps) {
  if (!tools?.register) return () => {}
  const disposers = []
  for (const definition of createNoteToolDefinitions(deps)) disposers.push(tools.register(definition))
  return () => { for (const fn of disposers) { try { fn() } catch { /* 已随插件卸载 */ } } }
}