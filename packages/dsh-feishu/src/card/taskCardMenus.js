/**
 * 任务卡上的弹出菜单（目前：优先级；后续工作区 / 文档 / 排期 / 预期 / 更多复用同一个 mount）。
 *
 * 从 panel.html 的 openPriorityMenu + mountTaskMenu 抽出来，去掉对 app / 全局 disposeTaskMenu
 * 的依赖：位置计算只认传入的 anchor，关闭条件只认 document 事件（可注入，便于测试）。
 * 菜单样式沿用面板的 .prio-menu / .prio-item（在 taskCardStyles 的扩展里按需补）。
 */

const PRIORITY_OPTIONS = ['P0', 'P1', 'P2', 'P3']
const PRIORITY_LABEL = { P0: 'P0 最紧急', P1: 'P1 高', P2: 'P2 中', P3: 'P3 低' }

function resolveDoc(deps) {
  const doc = (deps && deps.document) || (typeof document !== 'undefined' ? document : null)
  if (!doc) throw new Error('card menu: 缺少 document')
  return doc
}

function resolveEl(deps, doc) {
  if (deps && typeof deps.el === 'function') return deps.el
  return (tag, attrs, children) => {
    const node = doc.createElement(tag)
    for (const key of Object.keys(attrs || {})) {
      const value = attrs[key]
      if (value == null || value === false) continue
      if (key === 'text') { node.textContent = String(value); continue }
      if (key === 'class' || key === 'className') { node.setAttribute('class', String(value)); continue }
      if (key === 'style') { Object.assign(node.style, value); continue }
      node.setAttribute(key, value === true ? '' : String(value))
    }
    for (const child of [].concat(children == null ? [] : children)) {
      if (child == null || child === false) continue
      node.appendChild(child)
    }
    return node
  }
}

function viewportOf(deps) {
  if (deps && deps.viewport) return deps.viewport
  if (typeof window !== 'undefined' && window && window.innerWidth) return { width: window.innerWidth, height: window.innerHeight }
  return null
}

/**
 * 把菜单挂到 body 上，定位在 anchor 下方（超出视口就上移/左收）。
 * @returns close(restoreFocus)
 */
export function mountCardMenu(menu, anchor, deps) {
  const doc = resolveDoc(deps)
  const body = (deps && deps.body) || doc.body
  body.appendChild(menu)

  const rect = anchor && typeof anchor.getBoundingClientRect === 'function'
    ? anchor.getBoundingClientRect()
    : { left: 0, top: 0, bottom: 0, width: 0, height: 0 }
  const viewport = viewportOf(deps)
  const width = (deps && deps.menuWidth) || 116
  const height = (deps && deps.menuHeight) || 150
  const maxLeft = viewport ? Math.max(8, viewport.width - width - 8) : rect.left
  const maxTop = viewport ? Math.max(8, viewport.height - height - 8) : rect.top
  const left = Math.min(Math.max(8, rect.left), maxLeft)
  const top = Math.min(Math.max(8, rect.bottom + 4), maxTop)
  menu.style.left = left + 'px'
  menu.style.top = top + 'px'

  let closed = false
  const close = (restoreFocus) => {
    if (closed) return
    closed = true
    if (doc.removeEventListener) {
      doc.removeEventListener('mousedown', onOutside, true)
      doc.removeEventListener('keydown', onKey, true)
      doc.removeEventListener('scroll', onScroll, true)
    }
    if (typeof menu.remove === 'function') menu.remove()
    else if (menu.parentNode && typeof menu.parentNode.removeChild === 'function') menu.parentNode.removeChild(menu)
    if (restoreFocus && anchor && typeof anchor.focus === 'function') anchor.focus()
  }
  const onOutside = (event) => { if (event && event.target === menu) return; close(false) }
  const onKey = (event) => { if (event && event.key === 'Escape') { close(true); return } }
  const onScroll = () => close(false)
  if (doc.addEventListener) {
    doc.addEventListener('mousedown', onOutside, true)
    doc.addEventListener('keydown', onKey, true)
    doc.addEventListener('scroll', onScroll, true)
  }
  return close
}

/**
 * 优先级菜单：P0-P3 + 清除。点一项 → onPick(value)（清除时 value 是空串）。
 */
export function buildPriorityMenu(current, onPick, deps) {
  const doc = resolveDoc(deps)
  const h = resolveEl(deps, doc)
  const menu = h('div', { class: 'prio-menu tc-menu', role: 'menu' })
  const values = PRIORITY_OPTIONS.concat([''])
  for (const value of values) {
    const item = h('button', {
      type: 'button',
      class: 'prio-item' + (value === current ? ' is-current' : ''),
      role: 'menuitem',
      'data-value': value || null,
      'aria-current': value === current ? 'true' : null,
    })
    item.appendChild(h('span', { class: 'dot' }))
    item.appendChild(h('span', { text: value ? PRIORITY_LABEL[value] : '清除优先级' }))
    item.addEventListener('click', () => {
      let picked = null
      if (deps && typeof deps.close === 'function') deps.close(true)
      picked = value
      if (typeof onPick === 'function') onPick(picked)
    })
    menu.appendChild(item)
  }
  return menu
}

/** 打开优先级菜单，返回 close()（点选后自动关）。 */
export function openPriorityMenu(anchor, current, onPick, deps) {
  const doc = resolveDoc(deps)
  let close = null
  const options = Object.assign({}, deps, { document: doc, close: (restoreFocus) => { if (close) close(restoreFocus) } })
  const menu = buildPriorityMenu(current, onPick, options)
  close = mountCardMenu(menu, anchor, options)
  return { menu, close }
}

export default openPriorityMenu

/**
 * 通用动作菜单（文档菜单 / 更多菜单 / 工作区菜单共用）。
 * items: [{ id, label, disabled, danger, current, title, separator, run }]
 */
export function buildActionMenu(items, deps) {
  const doc = resolveDoc(deps)
  const h = resolveEl(deps, doc)
  const menu = h('div', { class: 'prio-menu task-local-pop tc-menu', role: 'menu' })
  for (const item of [].concat(items || [])) {
    if (!item) continue
    if (item.separator) { menu.appendChild(h('div', { class: 'tc-menu-sep' })); continue }
    const row = h('button', {
      type: 'button',
      class: 'task-text-action' + (item.danger ? ' is-danger' : '') + (item.current ? ' is-current' : ''),
      role: 'menuitem',
      'aria-current': item.current ? 'true' : null,
      title: item.title || null,
      disabled: item.disabled === true ? 'disabled' : null,
    }, item.label)
    row.addEventListener('click', () => {
      if (item.disabled === true) return
      if (typeof deps.close === 'function') deps.close(true)
      if (typeof item.run === 'function') item.run()
    })
    menu.appendChild(row)
  }
  return menu
}

/**
 * 工作区菜单：列表项带路径、当前项 aria-current，空列表给一句人话。
 * options: [{ id, title, path }]；currentId 当前绑定的工作区。
 */
export function buildWorkspaceMenu(options, currentId, onPick, deps) {
  const doc = resolveDoc(deps)
  const h = resolveEl(deps, doc)
  const menu = h('div', { class: 'prio-menu ws-menu tc-menu', role: 'menu', 'aria-label': '选择工作区' })
  const list = [].concat(options || [])
  if (!list.length) {
    menu.appendChild(h('div', { class: 'ws-path', text: '还没有登记过工作区' }))
    return menu
  }
  for (const ws of list) {
    const row = h('button', { type: 'button', class: 'prio-item', role: 'menuitem', 'aria-current': String(ws.id) === String(currentId) ? 'true' : null })
    row.appendChild(h('span', { class: 'ws-dot' }))
    const label = h('span', { class: 'ws-label' })
    label.appendChild(h('span', { text: String(ws.title || ws.path || '（未命名）') }))
    if (ws.path) label.appendChild(h('span', { class: 'ws-path', text: String(ws.path) }))
    row.appendChild(label)
    row.addEventListener('click', () => {
      if (typeof deps.close === 'function') deps.close(false)
      if (typeof onPick === 'function') onPick(ws)
    })
    menu.appendChild(row)
  }
  return menu
}

/**
 * 文本浮层：排期 / 预期 / 绑定文档 共用。
 * config: {
 *   title, sub, placeholder, inputLabel, value, hint, submitLabel, clearLabel, canClear, type,
 *   message, preview, busy,
 *   onSubmit(value), onClear(), onPreview?(value)
 * }
 * @returns {{ element, input, submit, clear, message, close }}
 */
export function buildTextPopover(config, deps) {
  const doc = resolveDoc(deps)
  const h = resolveEl(deps, doc)
  const cfg = config || {}
  const pop = h('div', { class: 'chip-pop tc-menu', role: 'dialog', 'aria-label': cfg.title || '编辑' })
  if (cfg.title) pop.appendChild(h('div', { class: 'chip-pop-title', text: cfg.title }))
  if (cfg.sub) pop.appendChild(h('div', { class: 'chip-pop-sub', text: cfg.sub }))
  const input = h('input', {
    type: cfg.type || 'text',
    value: cfg.value || '',
    placeholder: cfg.placeholder || '',
    'aria-label': cfg.inputLabel || cfg.placeholder || cfg.title || '输入',
  })
  pop.appendChild(input)
  if (cfg.hint) pop.appendChild(h('div', { class: 'hint', text: cfg.hint }))
  const message = h('div', { class: 'chip-pop-msg', role: 'status', 'aria-live': 'polite', text: cfg.message || '' })
  pop.appendChild(message)
  if (cfg.preview) pop.appendChild(h('div', { class: 'chip-pop-warn', text: cfg.preview }))
  const row = h('div', { class: 'chip-pop-row' })
  const submit = h('button', { type: 'button', class: 'btn btn-primary btn-xs', text: cfg.submitLabel || '确定' })
  const cancel = h('button', { type: 'button', class: 'task-text-action', text: '取消' })
  const clear = cfg.canClear ? h('button', { type: 'button', class: 'task-text-action is-danger', text: cfg.clearLabel || '清除' }) : null

  const close = (restoreFocus) => { if (typeof deps.close === 'function') deps.close(restoreFocus) }
  cancel.addEventListener('click', () => close(true))
  submit.addEventListener('click', () => {
    const value = String(input.value || '').trim()
    if (!value) { message.textContent = cfg.emptyHint || '先填一下再提交'; if (typeof input.focus === 'function') input.focus(); return }
    if (typeof cfg.onSubmit === 'function') cfg.onSubmit(value)
  })
  if (clear) clear.addEventListener('click', () => { if (typeof cfg.onClear === 'function') cfg.onClear() })
  if (typeof input.addEventListener === 'function') {
    input.addEventListener('keydown', (event) => {
      if (event && event.key === 'Enter') { if (typeof event.preventDefault === 'function') event.preventDefault(); submit.click() }
      else if (event && event.key === 'Escape') close(true)
    })
  }
  row.appendChild(cancel)
  if (clear) row.appendChild(clear)
  row.appendChild(submit)
  pop.appendChild(row)
  return { element: pop, input, submit, clear, cancel, message, close }
}

