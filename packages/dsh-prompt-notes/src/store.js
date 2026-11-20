/**
 * 便签存储：一个 JSON 文件，同步读、原子写。
 *
 * 为什么同步读：system prompt 的 section provider 必须在「组装那一刻」同步拿到答案。
 * 所以内存里始终有一份快照；读取时最多做一次廉价的 stat，发现文件被外部改过就重读。
 *
 * TODO(prompt-notes): 互通分享。这个文件（version 2）就是预期的交换格式；还缺：
 *   - 导出/导入单张或一组便签（导入时对 id、skill 名、MCP 名冲突的处理策略）；
 *   - 导入来的 MCP 便签必须默认「未钉住」并明确提示将执行的命令，不能静默启用；
 *   - 来源与签名字段（谁分享的、是否被篡改），避免同事的提示词被悄悄替换。
 * 误删恢复：删除不是真删——被删的便签进文件的 `trash` 区（最近 50 条、30 天），
 * 面板上可以撤销；超出上限或过期的在每次写盘前清掉。MCP 便签进 trash 时进程也随之撤掉。
 *
 * 为什么放 DSH_HOME 而不是某个 profile 目录：提示词是个人/团队的偏好，不属于某个项目，
 * 也不该因为换了 profile 就丢；以后做「互通分享」时，这个文件本身就是交换格式。
 */
import { copyFileSync, readFileSync, statSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LIMITS, parseNoteInput } from './notes.js'

/** v2：新增 kind / scope / target / skill / mcp。v1 的便签读入时自动补成 prompt + global。 */
const FILE_VERSION = 3
/** 文件超过这个大小就当坏文件（200 条 × 20k 字 = 4MB 上限的两倍留给 JSON 开销）。 */
const MAX_FILE_BYTES = 8 * 1024 * 1024
/** 回收站上限：条数与天数。超过就先丢最旧的——它只是「撤销」，不是归档。 */
const TRASH_MAX = 50
const TRASH_DAYS = 30
/** 外部改动的探测间隔：太勤没意义，太懒又会让手改看起来「没生效」。 */
const STAT_INTERVAL_MS = 1000

export function resolveDataFile(configured, env = process.env) {
  if (typeof configured === 'string' && configured.trim()) return configured.trim()
  const home = env.DSH_HOME?.trim()
  if (home) return join(home, 'prompt-notes', 'notes.json')
  return join(env.HOME?.trim() || homedir(), '.dsh', 'prompt-notes', 'notes.json')
}

function emptyDoc() {
  return { version: FILE_VERSION, paused: false, notes: [], trash: [] }
}

/** v1 用主题 token 当颜色名；升级时映射到纸色（由 parseNoteInput 兜底校验）。 */
const LEGACY_PAPER = { brand: 'yellow', success: 'green', warn: 'pink', error: 'pink', idle: 'lilac' }

/**
 * 把磁盘上读到的东西洗成合法文档：未知字段丢弃，永不抛。
 * 非法的条目（手改写坏了的）不进文档，但会被计入 dropped，由调用方留备份——
 * 否则下一次保存会悄悄把它们从文件里抹掉。
 * @returns {{ doc: object, dropped: number }}
 */
function sanitizeDoc(raw) {
  const doc = emptyDoc()
  let dropped = 0
  if (!raw || typeof raw !== 'object') return { doc, dropped }
  doc.paused = raw.paused === true
  const ids = new Set()
  for (const n of Array.isArray(raw.notes) ? raw.notes : []) {
    if (!n || typeof n !== 'object') { dropped++; continue }
    const input = { ...n, kind: n.kind ?? 'prompt', scope: n.scope ?? 'global', enabled: n.enabled === true }
    if (input.color in LEGACY_PAPER) input.color = LEGACY_PAPER[input.color]
    delete input.id
    const parsed = parseNoteInput(input)
    if (!parsed.ok) { dropped++; continue }
    const id = typeof n.id === 'string' && n.id && !ids.has(n.id) ? n.id : randomUUID()
    ids.add(id)
    const now = new Date().toISOString()
    doc.notes.push({
      id,
      ...parsed.value,
      createdAt: typeof n.createdAt === 'string' ? n.createdAt : now,
      updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : now,
    })
    if (doc.notes.length >= LIMITS.notes) break
  }
  // 回收站：每条自带删除时间；坏的条目直接丢（它只是便利功能，不值得为它留备份）
  for (const item of Array.isArray(raw.trash) ? raw.trash : []) {
    if (!item || typeof item !== 'object' || !item.note || typeof item.note !== 'object') continue
    const input = { ...item.note, kind: item.note.kind ?? 'prompt', scope: item.note.scope ?? 'global', enabled: item.note.enabled === true }
    if (input.color in LEGACY_PAPER) input.color = LEGACY_PAPER[input.color]
    const id = typeof input.id === 'string' ? input.id : ''
    delete input.id
    const parsed = parseNoteInput(input)
    if (!parsed.ok || !id) continue
    doc.trash.push({ deletedAt: typeof item.deletedAt === 'string' ? item.deletedAt : new Date().toISOString(), note: { id, ...parsed.value } })
  }
  pruneTrash(doc)
  return { doc, dropped }
}

/** 回收站只留最近 TRASH_MAX 条、TRASH_DAYS 天内的。写盘前调用，读盘后也调用。 */
export function pruneTrash(doc, now = Date.now()) {
  const cutoff = now - TRASH_DAYS * 24 * 60 * 60 * 1000
  const kept = []
  for (const item of Array.isArray(doc.trash) ? doc.trash : []) {
    const at = Date.parse(item.deletedAt)
    if (!Number.isFinite(at) || at < cutoff) continue
    kept.push(item)
    if (kept.length >= TRASH_MAX) break
  }
  doc.trash = kept
  return doc
}

export class NoteStore {
  /** @param {string} file 数据文件的绝对路径 */
  constructor(file, warn = () => {}) {
    this.file = file
    this.warn = warn
    this.doc = emptyDoc()
    this.signature = ''
    this.checkedAt = 0
    this.chain = Promise.resolve()
    this.listeners = new Set()
    this.#load()
  }

  #stat() {
    try {
      const st = statSync(this.file)
      return { sig: `${st.mtimeMs}:${st.size}`, size: st.size }
    } catch {
      return { sig: 'missing', size: 0 }
    }
  }

  #backup(tag, why) {
    this.warn(`${why}; a copy was kept as ${this.file}.${tag}-<time>`)
    try { copyFileSync(this.file, `${this.file}.${tag}-${Date.now()}`) } catch { /* 备份失败不阻断功能 */ }
  }

  #load() {
    const { sig, size } = this.#stat()
    this.signature = sig
    this.checkedAt = Date.now()
    if (sig === 'missing') { this.doc = emptyDoc(); return }
    try {
      if (size > MAX_FILE_BYTES) throw new Error(`file too large (${size} bytes)`)
      const { doc, dropped } = sanitizeDoc(JSON.parse(readFileSync(this.file, 'utf8')))
      this.doc = doc
      if (dropped > 0) this.#backup('invalid', `${dropped} invalid note(s) were skipped`)
    } catch (error) {
      // 坏文件：留一份备份再当空处理，下一次保存才不会悄悄把用户手里唯一的一份内容盖掉。
      this.#backup('corrupt', `notes file unreadable (${String(error)}), starting empty`)
      this.doc = emptyDoc()
    }
  }

  /** 订阅「内容变了」（含外部手改）。返回取消订阅函数。 */
  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  #emit() {
    for (const fn of this.listeners) {
      try { fn() } catch (error) { this.warn(`listener failed: ${String(error)}`) }
    }
  }

  /** 主动探测外部改动（供定时器调用）；有变化则重读并通知订阅者。 */
  poll() {
    const { sig } = this.#stat()
    this.checkedAt = Date.now()
    if (sig === this.signature) return false
    this.#load()
    this.#emit()
    return true
  }

  /** 同步读取当前快照（必要时先感知外部改动）。 */
  snapshot() {
    if (Date.now() - this.checkedAt >= STAT_INTERVAL_MS) this.poll()
    return this.doc
  }

  get revision() {
    return this.signature
  }

  /**
   * 串行地「重读 → 修改 → 原子写」。重读是为了不覆盖外部手改。
   * fn 收到文档的深拷贝，返回要给调用方的结果；抛错则不写盘。
   */
  mutate(fn) {
    const run = async () => {
      this.#load()
      const draft = structuredClone(this.doc)
      const result = fn(draft)
      const next = sanitizeDoc(draft).doc
      await this.#write(next)
      this.doc = next
      this.#emit()
      return result
    }
    const task = this.chain.then(run, run)
    this.chain = task.catch(() => {})
    return task
  }

  async #write(doc) {
    const body = `${JSON.stringify(doc, null, 2)}\n`
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, this.file)
    this.signature = this.#stat().sig
    this.checkedAt = Date.now()
  }
}

export { sanitizeDoc, emptyDoc }
