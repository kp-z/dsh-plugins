/**
 * 便签的三次写操作：新建 / 修改 / 删除。
 *
 * 为什么单独一层：HTTP 路由（面板，人）和助手工具（模型）都要写同一个文件，规则必须一模一样——
 * 校验（parseNoteInput）、重名（conflictOf）、数量上限（LIMITS.notes）、原子写（store.mutate）。
 * 两边各写一遍迟早会漂移，所以只有这一份实现。
 *
 * 返回值统一成 { ok, status, error } 或 { ok, note }，让调用方决定是回 HTTP 还是抛给模型。
 */
import { randomUUID } from 'node:crypto'
import { LIMITS, conflictOf, parseNoteInput } from './notes.js'

/** 新建一张便签。 */
export async function createNote(store, raw) {
  const parsed = parseNoteInput(raw)
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
  let problem = null
  let created = null
  await store.mutate((doc) => {
    if (doc.notes.length >= LIMITS.notes) { problem = { status: 409, error: `便签数量已达上限 ${LIMITS.notes}` }; return }
    const dup = conflictOf(doc.notes, parsed.value)
    if (dup) { problem = { status: 409, error: dup }; return }
    const now = new Date().toISOString()
    created = { id: randomUUID(), createdAt: now, updatedAt: now, ...parsed.value }
    doc.notes.push(created)
  })
  if (problem) return { ok: false, ...problem }
  return { ok: true, note: created }
}

/** 改一张便签（部分更新；只提交变化的字段）。 */
export async function updateNote(store, id, raw) {
  let problem = null
  let updated = null
  await store.mutate((doc) => {
    const note = doc.notes.find((n) => n.id === id)
    if (!note) { problem = { status: 404, error: '便签不存在（可能已被删除）' }; return }
    const parsed = parseNoteInput(raw, { base: note })
    if (!parsed.ok) { problem = { status: 400, error: parsed.error }; return }
    const dup = conflictOf(doc.notes, { ...note, ...parsed.value }, id)
    if (dup) { problem = { status: 409, error: dup }; return }
    Object.assign(note, parsed.value, { updatedAt: new Date().toISOString() })
    updated = note
  })
  if (problem) return { ok: false, ...problem }
  return { ok: true, note: updated }
}

/**
 * 删一张便签：**不是真删**，进文件的 `trash` 区（最近 50 条 / 30 天），面板上可以撤销。
 * id 不存在也算成功（幂等：助手重试不会报错）。
 */
export async function deleteNote(store, id, now = new Date().toISOString()) {
  let removed = false
  await store.mutate((doc) => {
    const note = doc.notes.find((n) => n.id === id)
    if (!note) return
    doc.notes = doc.notes.filter((n) => n.id !== id)
    doc.trash = Array.isArray(doc.trash) ? doc.trash : []
    doc.trash.unshift({ deletedAt: now, note })
    removed = true
  })
  return { ok: true, removed }
}

/** 从回收站捡回来（同一个 id，所以面板上「撤销」之后它还在原来的位置）。 */
export async function restoreNote(store, id, now = new Date().toISOString()) {
  let restored = null
  let problem = null
  await store.mutate((doc) => {
    const index = (Array.isArray(doc.trash) ? doc.trash : []).findIndex((t) => t.note && t.note.id === id)
    if (index < 0) { problem = { status: 404, error: '回收站里没有这张便签' }; return }
    if (doc.notes.some((n) => n.id === id)) { problem = { status: 409, error: '这张便签已经在便签簿里了' }; return }
    if (doc.notes.length >= LIMITS.notes) { problem = { status: 409, error: `便签数量已达上限 ${LIMITS.notes}` }; return }
    const [{ note }] = doc.trash.splice(index, 1)
    restored = { ...note, updatedAt: now }
    doc.notes.push(restored)
  })
  if (problem) return { ok: false, ...problem }
  return { ok: true, note: restored }
}