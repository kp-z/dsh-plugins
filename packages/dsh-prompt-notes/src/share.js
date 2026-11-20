/**
 * 分享：把便签导成一份 JSON，再从 JSON 导入回来（单张 / 一组 / 全部）。
 *
 * 这里的每一条规则都是为了「导入别人的东西不会悄悄改变我的环境」：
 *   1. 导入的 MCP 便签**一律未钉住**——钉上等于在本机执行一条命令；
 *      预览里必须把将要执行的命令原样显示出来，让用户自己决定要不要钉。
 *   2. 文件带 `format` / `version`；不认识的格式、超大的文件、逐条坏掉的便签，
 *      都只报告、不半途写入（导入是「先预览、后确认」两步）。
 *   3. 冲突（同 id / 同技能名 / 同 MCP 名）默认**重命名**：一个文件丢进别人的便签簿，
 *      最安全的默认不是覆盖他已有的东西。
 *   4. 导入的每一条都要过 parseNoteInput —— 和面板手写、助手创建同一个校验口径。
 */
import { LIMITS, SKILL_NAME, MCP_NAME, parseNoteInput } from './notes.js'

export const SHARE_FORMAT = 'dsh-prompt-notes'
export const SHARE_VERSION = 1
export const SHARE_LIMITS = Object.freeze({
  /** 一份导入文件最多这么大（字符数，含 JSON 结构）。 */
  bytes: 200 * 1024,
  /** 一份导入文件最多这么多条。 */
  notes: LIMITS.notes,
})
/** 冲突策略。默认重命名。 */
export const STRATEGIES = Object.freeze(['rename', 'skip', 'overwrite'])

const pick = (note) => ({
  id: note.id,
  kind: note.kind,
  scope: note.scope,
  target: note.target,
  title: note.title,
  body: note.body,
  tags: note.tags,
  color: note.color,
  enabled: note.enabled,
  ...(note.skill ? { skill: note.skill } : {}),
  ...(note.mcp ? { mcp: note.mcp } : {}),
})

/**
 * 导出：把若干张便签包成一份可分享的文件。
 * @param {object[]} notes 全部便签
 * @param {{ ids?: string[] }} [opts] 只导出这些 id（缺省 = 全部）
 */
export function packBundle(notes, opts = {}) {
  const wanted = Array.isArray(opts.ids) && opts.ids.length ? new Set(opts.ids) : null
  const picked = notes.filter((n) => !wanted || wanted.has(n.id))
  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    exportedAt: new Date().toISOString(),
    notes: picked.map(pick),
  }
}

/**
 * 解析导入文件：检查格式 / 版本 / 体积 / 条数，再逐条校验。
 * 坏的条目单条丢弃并报告，不因为一条坏就整份失败。
 * @returns {{ ok: true, notes: object[], dropped: object[] } | { ok: false, error: string }}
 */
export function parseBundle(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '导入内容必须是一个 JSON 对象' }
  if (raw.format !== SHARE_FORMAT) return { ok: false, error: `不是便签文件（format 应为 "${SHARE_FORMAT}"）` }
  const version = Number(raw.version)
  if (!Number.isFinite(version) || version < 1 || version > SHARE_VERSION) return { ok: false, error: `不支持的版本 ${raw.version}` }
  if (!Array.isArray(raw.notes)) return { ok: false, error: 'notes 必须是数组' }
  if (raw.notes.length > SHARE_LIMITS.notes) return { ok: false, error: `一次最多导入 ${SHARE_LIMITS.notes} 条` }
  let bytes = 0
  try { bytes = JSON.stringify(raw).length } catch { return { ok: false, error: '导入内容无法序列化' } }
  if (bytes > SHARE_LIMITS.bytes) return { ok: false, error: `文件太大（${Math.round(bytes / 1024)}KB > ${Math.round(SHARE_LIMITS.bytes / 1024)}KB）` }

  const notes = []
  const dropped = []
  for (const [index, item] of raw.notes.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { dropped.push({ index, reason: '不是对象' }); continue }
    const { id: sourceId, createdAt, updatedAt, ...fields } = item
    const parsed = parseNoteInput(fields)
    if (!parsed.ok) { dropped.push({ index, reason: parsed.error }); continue }
    // 导入的 MCP 一律未钉住：钉上等于在本机执行一条命令，只能由人决定。
    const value = parsed.value.kind === 'mcp' ? { ...parsed.value, enabled: false } : parsed.value
    notes.push({ ...value, sourceId: typeof sourceId === 'string' ? sourceId : undefined })
  }
  return { ok: true, notes, dropped }
}

/** 名字冲突时找一个没被占用的后缀：go-review → go-review-2 → go-review-3 …（砍到长度上限仍不合法就放弃） */
function freeName(base, isTaken, max) {
  const clip = (s) => (s.length > max ? s.slice(0, max) : s)
  if (!isTaken(clip(base))) return clip(base)
  for (let i = 2; i < 100; i++) {
    const candidate = clip(`${base}-${i}`)
    if (!isTaken(candidate)) return candidate
  }
  return null
}

/**
 * 算出「这份文件导入进来会发生什么」。不写盘——预览和真正导入用的是同一个函数，
 * 所以预览里看到的动作就是点下去之后会做的事。
 *
 * @param {object[]} existing 现有便签
 * @param {object[]} incoming parseBundle 的结果
 * @param {'rename'|'skip'|'overwrite'} strategy
 * @returns {{ actions: object[], counts: object, warnings: string[] }}
 */
export function planImport(existing, incoming, strategy = 'rename') {
  const mode = STRATEGIES.includes(strategy) ? strategy : 'rename'
  const byId = new Map(existing.map((n) => [n.id, n]))
  // skill 名只在同一个 scope+target 里唯一，MCP 名全局唯一 —— 用两个复合键的集合表达
  const usedSkill = new Set(existing.filter((n) => n.kind === 'skill' && n.skill).map((n) => `${n.skill.name}|${n.scope}|${n.target}`))
  const usedMcp = new Set(existing.filter((n) => n.kind === 'mcp' && n.mcp).map((n) => n.mcp.name))
  // 同一份文件里也可能自己撞自己：新占用的名字立刻进集合，下一条就能看到
  const takenSkill = (name, scope, target) => usedSkill.has(`${name}|${scope}|${target}`)
  const takenMcp = (name) => usedMcp.has(name)
  const remember = (n) => {
    if (n.skill) usedSkill.add(`${n.skill.name}|${n.scope}|${n.target}`)
    if (n.mcp) usedMcp.add(n.mcp.name)
  }

  const actions = []
  const warnings = []
  const counts = { create: 0, rename: 0, overwrite: 0, skip: 0 }

  for (const note of incoming) {
    const idHit = note.sourceId && byId.has(note.sourceId) ? byId.get(note.sourceId) : null
    const nameHit = note.kind === 'mcp'
      ? (note.mcp && takenMcp(note.mcp.name) ? 'name' : null)
      : note.kind === 'skill'
        ? (note.skill && takenSkill(note.skill.name, note.scope, note.target) ? 'name' : null)
        : null

    const note_mcp = note.kind === 'mcp' ? note.mcp : null
    if (note_mcp) {
      // 预览里要给出「钉上之后会执行的完整一行命令」，而不是只给命令名
      const line = [note_mcp.command, ...(Array.isArray(note_mcp.args) ? note_mcp.args : [])].filter(Boolean).join(' ') || note_mcp.url
      warnings.push(`MCP "${note_mcp.name}" 导入后是未钉住的；钉上会执行：${line}`)
    }

    const push = (action, extra) => {
      counts[action]++
      actions.push({ index: actions.length, action, ...extra })
    }

    // 1) 同 id
    if (idHit) {
      if (mode === 'skip') { push('skip', { reason: '同 id 已存在', title: idHit.title }); continue }
      if (mode === 'overwrite') {
        push('overwrite', { replaceId: idHit.id, note: { ...note, id: idHit.id, createdAt: idHit.createdAt } })
        continue
      }
      // rename：id 换成新的，然后照常处理名字冲突
      const entry = { ...note, id: undefined }
      if (nameHit) {
        const renamed = renameFor(entry, takenSkill, takenMcp)
        if (!renamed) { push('skip', { reason: '找不到可用的新名字' }); continue }
        remember(renamed)
        push('rename', { note: renamed, reason: '同 id 已存在' })
        continue
      }
      push('rename', { note: entry, reason: '同 id 已存在，另存一份' })
      continue
    }

    // 2) 名字冲突（mcp 名全局唯一；skill 名在 scope+target 内唯一）
    if (nameHit) {
      if (mode === 'skip') { push('skip', { reason: '名字已被占用' }); continue }
      if (mode === 'overwrite') {
        const victim = note.kind === 'mcp'
          ? existing.find((n) => n.kind === 'mcp' && n.mcp && n.mcp.name === note.mcp.name)
          : existing.find((n) => n.kind === 'skill' && n.skill && n.skill.name === note.skill.name && n.scope === note.scope && n.target === note.target)
        push('overwrite', { replaceId: victim.id, note: { ...note, id: victim.id, createdAt: victim.createdAt } })
        continue
      }
      const renamed = renameFor(note, takenSkill, takenMcp)
      if (!renamed) { push('skip', { reason: '找不到可用的新名字' }); continue }
      remember(renamed)
      push('rename', { note: renamed, reason: '名字已被占用' })
      continue
    }

    // 3) 干净的新便签
    const entry = { ...note }
    remember(entry)
    push('create', { note: entry })
  }

  return { actions, counts, warnings }
}

/** 按 kind 把名字改成没被占用的那个。名字有长度上限，用 SKILL_NAME / MCP_NAME 再校验一次。 */
function renameFor(note, takenSkill, takenMcp) {
  if (note.kind === 'skill' && note.skill) {
    const next = freeName(note.skill.name, (n) => takenSkill(n, note.scope, note.target), 64)
    if (!next || !SKILL_NAME.test(next)) return null
    return { ...note, skill: { ...note.skill, name: next } }
  }
  if (note.kind === 'mcp' && note.mcp) {
    const next = freeName(note.mcp.name, takenMcp, 32)
    if (!next || !MCP_NAME.test(next)) return null
    return { ...note, mcp: { ...note.mcp, name: next } }
  }
  // 提示词没有名字可改：同 id 的情况已经另起了新 id，这里只可能是不该发生的情况
  return { ...note }
}

/**
 * 执行计划：一次 mutate 写完全部动作（中间不会有半份状态）。
 * @returns {Promise<{added:number, replaced:number, skipped:number}>}
 */
export async function applyImport(store, plan, now = new Date().toISOString()) {
  let added = 0
  let replaced = 0
  let skipped = 0
  await store.mutate((doc) => {
    for (const action of plan.actions) {
      if (action.action === 'skip') { skipped++; continue }
      if (action.action === 'overwrite' && action.replaceId) {
        const idx = doc.notes.findIndex((n) => n.id === action.replaceId)
        if (idx < 0) { skipped++; continue }
        doc.notes[idx] = { ...doc.notes[idx], ...action.note, id: action.replaceId, updatedAt: now }
        replaced++
        continue
      }
      if (doc.notes.length >= LIMITS.notes) { skipped++; continue }
      // 不带 id：由 store 的清洗环节分配（它同时会重建 allowlist 过的字段）
      doc.notes.push({ ...action.note, createdAt: now, updatedAt: now })
      added++
    }
  })
  return { added, replaced, skipped }
}