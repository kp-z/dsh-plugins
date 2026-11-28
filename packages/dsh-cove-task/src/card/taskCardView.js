/**
 * 任务卡渲染（DOM）—— 只把 taskCardModel 的模型拼成节点，不做业务判断。
 *
 * 与 panel.html 里 taskNode() 的关系：结构和类名 1:1 照搬（.task / .task-main /
 * .task-head / .task-meta / .chip / .badge / .task-actions …），所以面板原有 CSS
 * 只要套一层 `.tc-scope` 就能直接生效；关系画布把同样的类名映射到 `--tc-*` 变量。
 *
 * 事件一律来自 deps.handlers：没有对应 handler 的元素就渲染成不可点（span/disabled），
 * 不假装能点。这样「画布上没有同步/文档」不需要在渲染层写 if 业务分支。
 */

import * as commentsModule from './taskCardComments.js'

const str = (value) => (value == null ? '' : String(value))

/** 默认的建节点工具（测试里可注入自己的 el）。 */
const SVG_NS = 'http://www.w3.org/2000/svg'
/* 这几个标签必须走 createElementNS：用 createElement 建出来的是 HTML 未知元素，浏览器不会绘制，量出来是 0×0。 */
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text'])

function defaultEl(doc) {
  return function el(tag, attrs, children) {
    const svg = SVG_TAGS.has(String(tag).toLowerCase()) && typeof doc.createElementNS === 'function'
    const node = svg ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag)
    const map = attrs && typeof attrs === 'object' ? attrs : {}
    for (const key of Object.keys(map)) {
      const value = map[key]
      if (value == null || value === false) continue
      if (key === 'text') { node.textContent = str(value); continue }
      if (key === 'className' || key === 'class') { node.setAttribute('class', str(value)); continue }
      if (key === 'style' && typeof value === 'object') {
        for (const prop of Object.keys(value)) node.style.setProperty(prop, str(value[prop]))
        continue
      }
      node.setAttribute(key, value === true ? '' : str(value))
    }
    for (const child of [].concat(children == null ? [] : children)) {
      if (child == null || child === false) continue
      /* 字符串先包成文本节点：默认工厂要能接住 h('span', null, '已挂起') 这种写法。 */
      node.appendChild(child && typeof child === 'object' && child.nodeType ? child : doc.createTextNode(str(child)))
    }
    return node
  }
}

function resolveEl(deps) {
  if (deps && typeof deps.el === 'function') return deps.el
  const doc = (deps && deps.document) || (typeof document !== 'undefined' ? document : null)
  if (!doc) throw new Error('renderTaskCard: 缺少 el() 或 document')
  return defaultEl(doc)
}

function addHandler(node, event, fn) {
  if (typeof node.addEventListener === 'function' && typeof fn === 'function') node.addEventListener(event, fn)
}

/**
 * @param {object} model buildTaskCardModel() 的输出
 * @param {object} deps
 *   - el(tag, attrs, children?) 自定义建节点（默认用 document）
 *   - handlers: {
 *       priority(model), session(model), openTask(model),
 *       chip: { start, end, schedule, eta, workspace },
 *       action: { start, bind, complete, docs, sync, comments, suspend, more },
 *       doc(model, doc), docEdit?, docUnbind?,
 *     }
 * @returns 根节点（class="task"）
 */
export function renderTaskCard(model, deps) {
  const h = resolveEl(deps)
  const handlers = (deps && deps.handlers) || {}
  const chipHandlers = handlers.chip || {}
  const actionHandlers = handlers.action || {}
  const m = model && typeof model === 'object' ? model : {}
  const task = (deps && deps.task) || { id: m.id, no: m.no, title: m.title }

  const root = h('div', {
    className: 'task' + (m.isCurrent ? ' task-current' : '') + (m.suspended ? ' is-suspended' : ''),
    'data-tone': '1',
    'data-priority': m.priority && m.priority.value ? m.priority.value : null,
    'aria-current': m.isCurrent ? 'true' : null,
    'data-session': m.session ? m.session.id : null,
  })
  const body = h('div', { className: 'task-body' })
  const main = h('div', { className: 'task-main' })

  /* ---- 标题行：优先级徽标 + 标题 + 会话胶囊 + 已挂起 ---- */
  const head = h('div', { className: 'task-head' })
  const prio = m.priority || {}
  const prioCls = 'prio' + (prio.value ? '' : ' prio-empty') + (prio.running ? ' is-running' : prio.unread ? ' is-unread' : '')
  const prioTitle = (prio.value ? '优先级 ' + prio.value : '未设置优先级')
    + (prio.running ? ' · 正在运行' : prio.unread ? ' · 运行结束，尚未查看' : '')
    + (typeof handlers.priority === 'function' ? '（点击修改优先级）' : '')
  if (typeof handlers.priority === 'function') {
    const btn = h('button', {
      type: 'button',
      className: prioCls,
      'data-value': prio.value || null,
      title: prioTitle,
      'aria-label': prioTitle,
    }, null)
    btn.textContent = prio.value || '--'
    addHandler(btn, 'click', (event) => {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
      /* 第三个参数是锚点：宿主弹菜单时要用它定位 */
      handlers.priority(task, prio.value, btn)
    })
    head.appendChild(btn)
  } else {
    const span = h('span', { className: prioCls, title: prioTitle, 'aria-label': prioTitle }, null)
    span.textContent = prio.value || '--'
    head.appendChild(span)
  }

  const title = h('div', { className: 'task-title', title: m.title }, null)
  title.textContent = str(m.title)
  if (typeof handlers.openTask === 'function') {
    addHandler(title, 'click', () => handlers.openTask(task))
  }
  if (typeof handlers.renameTitle === 'function') {
    addHandler(title, 'dblclick', (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
      handlers.renameTitle(task, title, head)
    })
  }
  head.appendChild(title)

  if (m.session) {
    const s = m.session
    const sessCls = 'sess-inline' + (s.running ? ' is-running' : '')
    const label = '会话 ' + s.id + (s.running ? '（正在运行）' : s.unread ? '（运行结束，尚未查看）' : s.alive ? '' : '（已结束）') + '（点击打开）'
    if (typeof handlers.session === 'function') {
      const chip = h('button', { type: 'button', className: sessCls, 'data-session': s.id, title: label, 'aria-label': label })
      chip.appendChild(h('span', { className: 'lamp lamp-' + s.lamp }))
      chip.appendChild(h('span', null, s.label))
      addHandler(chip, 'click', () => handlers.session(task, s.id, chip))
      if (typeof handlers.sessionTip === 'function') {
        addHandler(chip, 'mouseenter', () => handlers.sessionTip(task, s.id, chip))
        addHandler(chip, 'focus', () => handlers.sessionTip(task, s.id, chip))
      }
      if (typeof handlers.sessionTipHide === 'function') {
        addHandler(chip, 'mouseleave', () => handlers.sessionTipHide())
        addHandler(chip, 'blur', () => handlers.sessionTipHide())
      }
      head.appendChild(chip)
    } else {
      const chip = h('span', { className: sessCls, title: label, 'aria-label': label })
      chip.appendChild(h('span', { className: 'lamp lamp-' + s.lamp }))
      chip.appendChild(h('span', null, s.label))
      head.appendChild(chip)
    }
  }
  if (m.suspended) head.appendChild(h('span', { className: 'hint', title: '任务已挂起' }, '已挂起'))
  main.appendChild(head)

  /* ---- 信息行：徽标 + 人 + chips ---- */
  const meta = h('div', { className: 'task-meta' })
  if (m.due) meta.appendChild(h('span', { className: 'due' }, m.due))
  for (const badge of m.badges || []) {
    meta.appendChild(h('span', { className: badge.cls || 'badge', title: badge.title || null }, badge.label))
  }
  for (const group of m.people || []) {
    const box = h('span', { className: 'people-group', role: 'group', 'aria-label': group.label })
    const icon = h('span', { className: 'people-role-icon', tabindex: '0', 'data-tip': group.tip, 'aria-label': group.label + '，' + (group.items.length + group.more) + ' 人' })
    /* 负责人单人、关注人双人：图标本身不占宽，16px 内描边跟随主题色。 */
    icon.appendChild(h('svg', { viewBox: '0 0 16 16', width: '13', height: '13', 'aria-hidden': 'true', focusable: 'false' },
      h('g', { fill: 'none', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-width': group.role === 'assignee' ? '1.3' : '1.2' },
        group.role === 'assignee'
          ? [h('circle', { cx: '8', cy: '5.4', r: '2.4' }),
            h('path', { d: 'M3.7 12.7c0-2.3 1.9-3.9 4.3-3.9s4.3 1.6 4.3 3.9' })]
          : [h('circle', { cx: '6', cy: '5.6', r: '2' }),
            h('path', { d: 'M2.4 12.4c0-1.9 1.6-3.2 3.6-3.2s3.6 1.3 3.6 3.2' }),
            h('path', { d: 'M10.4 4.2a2 2 0 0 1 0 3.8' }),
            h('path', { d: 'M11.2 9.4c1.5.2 2.4 1.4 2.4 3' })])
    ))
    box.appendChild(icon)
    for (const person of group.items) {
      const av = h('span', {
        className: 'avatar' + (person.anon ? ' is-anon' : ''),
        tabindex: '0',
        'data-tip': person.tip,
        'aria-label': person.ariaLabel,
      })
      if (person.avatar) {
        /* 有真头像就不显示首字（先不把首字放进节点，避免 textContent 清子节点时的差异）。 */
        const img = h('img', { src: person.avatar, alt: '', loading: 'lazy' })
        if (typeof img.addEventListener === 'function') {
          /* 头像 URL 过期或被拦时退回首字/人形，别在卡片上留一张破图。 */
          img.addEventListener('error', () => {
            if (img.parentNode === av && typeof av.removeChild === 'function') av.removeChild(img)
            av.textContent = person.anon ? '' : person.initial
          })
        }
        av.appendChild(img)
      } else {
        av.textContent = person.initial
      }
      box.appendChild(av)
    }
    if (group.more > 0) {
      box.appendChild(h('span', {
        className: 'avatar more',
        text: '+' + group.more,
        tabindex: '0',
        'aria-label': group.label + '，另有 ' + group.more + ' 人',
        'data-tip': group.label + '：' + group.moreTip,
      }))
    }
    meta.appendChild(box)
  }
  for (const chip of m.chips || []) {
    const handler = chip.action && typeof chipHandlers[chip.action] === 'function' ? chipHandlers[chip.action] : null
    const attrs = {
      className: chip.cls || 'chip',
      title: chip.title || null,
      'aria-label': chip.label,
    }
    if (handler) {
      const btn = h('button', Object.assign({ type: 'button' }, attrs, { 'aria-disabled': chip.disabled === true ? 'true' : 'false' }))
      btn.appendChild(h('span', null, chip.label))
      for (const part of chip.parts || []) btn.appendChild(h('span', { className: part.cls }, part.text))
      addHandler(btn, 'click', (event) => {
        if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
        handler(task, chip.key, btn)
      })
      meta.appendChild(btn)
    } else {
      /* 有动作但没 handler（比如画布上不给切换工作区）：渲染成不可点的 span，并明确 aria-disabled。 */
      const span = h('span', chip.action ? Object.assign({}, attrs, { 'aria-disabled': 'true' }) : attrs)
      span.appendChild(h('span', null, chip.label))
      for (const part of chip.parts || []) span.appendChild(h('span', { className: part.cls }, part.text))
      meta.appendChild(span)
    }
  }
  main.appendChild(meta)

  /* ---- 文档行：只有有文档才出现 ---- */
  if ((m.docs || []).length) {
    const docs = h('div', { className: 'task-docs' })
    for (const doc of m.docs) {
      const group = h('span', { className: 'doc-chip-group' })
      const open = h('button', {
        type: 'button',
        className: 'chip chip-doc doc-open',
        title: doc.url,
        'aria-label': '打开文档 ' + doc.label,
      }, '📄 ' + doc.label)
      if (typeof handlers.doc === 'function') addHandler(open, 'click', () => handlers.doc(task, doc))
      else open.setAttribute('aria-disabled', 'true')
      group.appendChild(open)
      if (typeof handlers.docEdit === 'function') {
        const pen = h('button', { type: 'button', className: 'doc-tool', text: '✎', title: '改文档链接（改完立刻同步到飞书「文档」字段）' })
        addHandler(pen, 'click', () => handlers.docEdit(task, doc, pen))
        group.appendChild(pen)
      }
      if (typeof handlers.docUnbind === 'function') {
        const del = h('button', { type: 'button', className: 'doc-tool doc-tool-del', text: '✕', title: '从这条任务解绑（不删除飞书里的文档）' })
        addHandler(del, 'click', () => handlers.docUnbind(task, doc, del))
        group.appendChild(del)
      }
      docs.appendChild(group)
    }
    /* 面板的「＋ 文档」在「文档」菜单里，不在卡片行上，这里不渲染（避免结构漂移）。 */
    main.appendChild(docs)
  }

  /* ---- 错误块：工作区没登记 / 任务本身报错 ---- */
  if (m.workspaceError) {
    const box = h('div', { className: 'task-err' })
    box.appendChild(h('span', null, m.workspaceError.text))
    if (m.workspaceError.canRegister && typeof handlers.workspaceRegister === 'function') {
      const btn = h('button', { type: 'button', className: 'btn btn-ghost btn-xs' }, '登记为工作区')
      addHandler(btn, 'click', () => handlers.workspaceRegister(task))
      box.appendChild(btn)
    }
    main.appendChild(box)
  }
  if (m.error) main.appendChild(h('div', { className: 'task-err', text: m.error }))

  /* ---- 动作行 ---- */
  const actions = h('div', { className: 'task-actions' })
  for (const action of m.actions || []) {
    if (action.slot === 'end') continue
    const handler = typeof actionHandlers[action.key] === 'function' ? actionHandlers[action.key] : null
    if (!handler) continue
    const btn = h('button', {
      type: 'button',
      className: action.cls || 'task-text-action',
      title: action.title || null,
      disabled: action.disabled === true ? 'disabled' : null,
    }, action.label)
    addHandler(btn, 'click', () => handler(task, btn))
    actions.appendChild(btn)
  }
  /* 宿主自己的控件（评论、挂起）：卡片只负责留位置，具体节点由宿主构造。 */
  for (const extra of deps && deps.extraActions ? deps.extraActions : []) {
    if (extra && extra.node && extra.slot !== 'after-spacer') actions.appendChild(extra.node)
  }
  actions.appendChild(h('span', { className: 'task-action-spacer' }))
  for (const action of m.actions || []) {
    if (action.slot !== 'end') continue
    const handler = typeof actionHandlers[action.key] === 'function' ? actionHandlers[action.key] : null
    if (!handler) continue
    const btn = h('button', { type: 'button', className: action.cls || 'task-text-action', title: action.title || null, 'aria-label': action.key === 'more' ? '更多任务操作' : action.label }, action.label)
    addHandler(btn, 'click', () => handler(task, btn))
    actions.appendChild(btn)
  }
  for (const extra of deps && deps.extraActions ? deps.extraActions : []) {
    if (extra && extra.node && extra.slot === 'after-spacer') actions.appendChild(extra.node)
  }

  /* ---- 评论区：只有宿主显式给了评论 handler 才渲染（画布模式默认不给） ---- */
  if (m.comments && handlers.comments && typeof handlers.comments === 'object') {
    const { renderCardComments } = commentsModule
    body.appendChild(renderCardComments(m.comments, { el: h, handlers: handlers.comments }))
  }

  const actionCount = actions.childNodes ? actions.childNodes.length : actions.children.length
  if (actionCount > 1) {
    body.appendChild(main)
    body.appendChild(actions)
  } else {
    body.appendChild(main)
  }
  /* 宿主自己的区块（比如面板的评论区）：卡片不管内容，只负责挂上去。 */
  for (const extra of deps && deps.extraBody ? deps.extraBody : []) {
    if (extra) body.appendChild(extra)
  }
  root.appendChild(body)
  return root
}

export default renderTaskCard
