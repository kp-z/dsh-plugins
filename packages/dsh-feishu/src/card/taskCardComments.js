/**
 * 任务卡评论区（模型 + 渲染）。
 *
 * 评论是唯一还要跟 Host 的「评论账本」打交道的块：读取、刷新、投递到原会话、忽略。
 * 这里只做**呈现**与可提交性判断；网络/轮询/缓存都留在宿主侧，通过 handlers 注入。
 *
 * 与 panel.html 的 task-card-comments 保持同一套类名与文案口径。
 */

export const COMMENT_STATUS = {
  pending: '待处理',
  delivered: '已投递',
  running: '处理中',
  replied: '已回复',
  ignored: '忽略',
  failed: '失败',
  reply_pending: '待回复',
  unknown: '待核对',
  history: '历史',
}

const str = (value) => (value == null ? '' : String(value))

function relTime(value) {
  const at = Number(value) || 0
  if (!at) return ''
  const diff = Math.max(0, Date.now() - at)
  const min = Math.round(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return min + ' 分钟前'
  const hour = Math.round(min / 60)
  if (hour < 24) return hour + ' 小时前'
  const day = Math.round(hour / 24)
  if (day < 30) return day + ' 天前'
  return new Date(at).toISOString().slice(0, 10)
}

function absTime(value) {
  const at = Number(value) || 0
  if (!at) return ''
  return new Date(at).toISOString().slice(0, 16).replace('T', ' ')
}

function authorOf(comment) {
  const c = comment && typeof comment === 'object' ? comment : {}
  const user = (c.author && typeof c.author === 'object' ? c.author : {}) || {}
  const name = str(c.authorName || user.name || c.author).trim()
  const avatar = /^https?:\/\//i.test(str(c.avatar || user.avatar)) ? str(c.avatar || user.avatar) : ''
  return {
    name: name || '未知成员',
    avatar,
    initial: name ? name.slice(0, 1).toUpperCase() : '',
    anon: !name && !avatar,
    role: str(c.authorType || user.role),
  }
}

/**
 * @param {object} state 宿主给的评论状态
 * @param {object} ctx 任务上下文：{ done, suspended, hasSession, supported, enabled }
 */
export function buildCommentsModel(state, ctx) {
  const s = state && typeof state === 'object' ? state : {}
  const c = ctx && typeof ctx === 'object' ? ctx : {}
  const loaded = s.loaded === true
  const items = Array.isArray(s.items) ? s.items : []
  const entries = Array.isArray(s.entries) ? s.entries : []
  const diag = s.diagnostic && typeof s.diagnostic === 'object' ? s.diagnostic : {}
  const enabled = s.enabled !== false && c.enabled !== false
  const supported = s.supported !== false && c.supported !== false

  let summary = '展开后读取评论'
  if (s.loading === true) summary = '读取中…'
  else if (loaded) summary = items.length ? items.length + ' 条评论' : '暂无评论'
  if (diag.lastScanAt) summary += ' · 扫描 ' + relTime(diag.lastScanAt)
  if (typeof diag.readCount === 'number') summary += ' · 读 ' + diag.readCount
  if (typeof diag.newCount === 'number') summary += ' · 新 ' + diag.newCount

  let notice = ''
  if (!supported) notice = '重启后可用：当前宿主尚不支持任务评论历史。'
  if (s.error) notice += (notice ? ' ' : '') + '读取失败：' + str(s.error)
  else if (s.complete === false) notice += (notice ? ' ' : '') + '评论读取不完整，刷新后再处理。'
  if (s.actionError) notice += (notice ? ' ' : '') + str(s.actionError)

  const disabledReason = !supported ? '当前宿主不支持任务评论历史'
    : !enabled ? '评论协作未开启，请在设置中开启'
      : c.done === true ? '任务已完成，不能处理评论'
        : c.suspended === true ? '任务已挂起，恢复后才能处理'
          : c.hasSession !== true ? '请先绑定会话，评论只投递到任务已绑定的原会话'
            : ''

  const viewItems = items.map((comment) => {
    const entry = entries.filter((row) => String(row && row.commentId) === String(comment && comment.id))[0] || null
    const statusKey = entry ? str(entry.status) : 'history'
    const author = authorOf(comment)
    const processed = !!entry && (statusKey !== 'ignored' || entry.deliveryText || entry.turn != null)
    return {
      id: str(comment && comment.id),
      author: author.name,
      initial: author.initial,
      avatar: author.avatar,
      anon: author.anon,
      role: author.role,
      statusKey,
      statusLabel: COMMENT_STATUS[statusKey] || '历史',
      timeText: relTime(comment && comment.createdAt),
      timeTitle: absTime(comment && comment.createdAt),
      text: str(comment && comment.text),
      isReply: !!str(comment && comment.replyToCommentId),
      own: /^(app|bot|ai)$/i.test(str(comment && comment.authorType)) || !!(entry && entry.reason === 'outbound-ledger'),
      canSubmit: !disabledReason && !processed && s.submitting !== true,
      canIgnore: !disabledReason && !processed && s.submitting !== true,
      disabledReason,
    }
  })

  return {
    open: s.open === true,
    loading: s.loading === true,
    summary,
    notice,
    diagnostic: str(diag.reason),
    enabled: enabled && supported,
    toolbar: { canRefresh: s.loading !== true && s.submitting !== true, canOpenSession: c.hasSession === true },
    items: viewItems,
  }
}

export function renderCardComments(model, deps) {
  const doc = (deps && deps.document) || (typeof document !== 'undefined' ? document : null)
  const el = (deps && deps.el) || ((tag, attrs, children) => {
    const node = doc.createElement(tag)
    for (const key of Object.keys(attrs || {})) {
      const value = attrs[key]
      if (value == null || value === false) continue
      if (key === 'text') { node.textContent = String(value); continue }
      if (key === 'class') { node.setAttribute('class', String(value)); continue }
      node.setAttribute(key, value === true ? '' : String(value))
    }
    for (const child of [].concat(children == null ? [] : children)) if (child != null) node.appendChild(child)
    return node
  })
  const handlers = (deps && deps.handlers) || {}
  const m = model && typeof model === 'object' ? model : {}
  const section = el('section', { class: 'task-card-comments', 'aria-label': '任务评论' })
  if (!m.open) section.setAttribute('hidden', '')
  const toolbar = el('div', { class: 'card-comments-toolbar' })
  toolbar.appendChild(el('span', { class: 'card-comments-summary', text: m.summary || '' }))
  if (m.toolbar && m.toolbar.canRefresh && typeof handlers.refresh === 'function') {
    const btn = el('button', { type: 'button', class: 'task-text-action', text: '刷新', title: '只刷新评论记录，不投递或处理' })
    if (btn.addEventListener) btn.addEventListener('click', () => handlers.refresh())
    toolbar.appendChild(btn)
  }
  if (m.toolbar && m.toolbar.canOpenSession && typeof handlers.openSession === 'function') {
    const btn = el('button', { type: 'button', class: 'task-text-action', text: '对话', title: '打开发送评论的原会话' })
    if (btn.addEventListener) btn.addEventListener('click', () => handlers.openSession())
    toolbar.appendChild(btn)
  }
  section.appendChild(toolbar)
  if (m.notice) section.appendChild(el('div', { class: 'card-comments-error', role: 'status', text: m.notice }))
  if (m.diagnostic) section.appendChild(el('div', { class: 'card-comment-note', text: m.diagnostic }))
  if ((m.items || []).length) {
    const list = el('div', { class: 'card-comments-list', role: 'list' })
    for (const item of m.items) {
      const row = el('div', { class: 'card-comment' + (item.isReply ? ' is-reply' : ''), role: 'listitem' })
      const avatar = el('span', { class: 'card-comment-avatar' + (item.anon ? ' is-anon' : ''), 'aria-hidden': 'true' })
      if (item.avatar) {
        const img = el('img', { src: item.avatar, alt: '', loading: 'lazy' })
        if (avatar.appendChild) avatar.appendChild(img)
      } else {
        avatar.textContent = item.initial
      }
      row.appendChild(avatar)
      const main = el('div', { class: 'card-comment-main' })
      const meta = el('div', { class: 'card-comment-meta' })
      meta.appendChild(el('span', { class: 'card-comment-author', text: item.author }))
      if (item.role) meta.appendChild(el('span', { class: 'card-comment-role', text: item.role }))
      meta.appendChild(el('span', { class: 'card-comment-tag', 'data-state': item.statusKey, text: item.statusLabel }))
      meta.appendChild(el('time', { class: 'card-comment-time', text: item.timeText, title: item.timeTitle }))
      main.appendChild(meta)
      main.appendChild(el('div', { class: 'card-comment-text', text: item.text }))
      if (item.own) main.appendChild(el('div', { class: 'card-comment-note', text: '自己的 AI 回复仅供查看，不会再次投递' }))
      if (typeof handlers.submit === 'function' || typeof handlers.ignore === 'function') {
        const actions = el('div', { class: 'card-comment-actions' })
        if (typeof handlers.submit === 'function') {
          const btn = el('button', { type: 'button', class: 'task-text-action', text: '处理', disabled: item.canSubmit ? null : 'disabled', title: item.disabledReason || '投递到这条任务绑定的原会话' })
          if (btn.addEventListener && item.canSubmit) btn.addEventListener('click', () => handlers.submit(item))
          actions.appendChild(btn)
        }
        if (typeof handlers.ignore === 'function') {
          const btn = el('button', { type: 'button', class: 'task-text-action', text: '忽略', disabled: item.canIgnore ? null : 'disabled' })
          if (btn.addEventListener && item.canIgnore) btn.addEventListener('click', () => handlers.ignore(item))
          actions.appendChild(btn)
        }
        main.appendChild(actions)
      }
      row.appendChild(main)
      list.appendChild(row)
    }
    section.appendChild(list)
  }
  return section
}

export default buildCommentsModel
