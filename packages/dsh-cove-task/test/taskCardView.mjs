/**
 * 任务卡渲染测试：结构、类名、事件接线。
 *
 * 用一套极小的 Node 桩（不依赖浏览器），只验证「模型 → DOM」这一跳：
 * 该有的类名和文本在、没 handler 的控件不可点、动作行只在有 handler 时出现。
 */
import assert from 'node:assert/strict'
import { buildTaskCardModel } from '../src/card/taskCardModel.js'
import { renderTaskCard } from '../src/card/taskCardView.js'
import { NOW, minimalTask, fullTask } from './fixtures/tasks.mjs'

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log('  ok  ' + name)
  } catch (error) {
    failures.push(name)
    console.log('  FAIL ' + name)
    console.log(String((error && error.stack) || error).split('\n').slice(0, 5).map((line) => '       ' + line).join('\n'))
  }
}

class StubNode {
  constructor(tag) {
    this.tag = tag
    this.children = []
    this.attrs = {}
    this.listeners = {}
    this.textContent = ''
    this.disabled = false
    this.style = { setProperty() {} }
    this.className = ''
  }
  setAttribute(key, value) {
    this.attrs[key] = String(value)
    if (key === 'class') this.className = String(value)
    if (key === 'disabled') this.disabled = true
  }
  appendChild(node) { this.children.push(node); return node }
  addEventListener(type, fn) { this.listeners[type] = fn }
  fire(type, event) { const fn = this.listeners[type]; return fn ? fn(Object.assign({ stopPropagation() {} }, event)) : undefined }
  get text() {
    const own = this.textContent || ''
    return own + this.children.map((child) => (typeof child === 'string' ? child : child.text)).join('')
  }
  findAll(predicate) {
    const out = []
    const walk = (node) => {
      if (!(node instanceof StubNode)) return
      if (predicate(node)) out.push(node)
      for (const child of node.children) walk(child)
    }
    walk(this)
    return out
  }
}

function h(tag, attrs, children) {
  const node = new StubNode(tag)
  const map = attrs && typeof attrs === 'object' ? attrs : {}
  for (const key of Object.keys(map)) {
    const value = map[key]
    if (value == null || value === false) continue
    if (key === 'text') { node.textContent = String(value); continue }
    if (key === 'className' || key === 'class') { node.setAttribute('class', String(value)); continue }
    node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of [].concat(children == null ? [] : children)) {
    if (child == null || child === false) continue
    node.appendChild(child)
  }
  return node
}

const render = (task, handlers, ctx) => renderTaskCard(
  buildTaskCardModel(task, Object.assign({ now: NOW }, ctx)),
  { el: h, task, handlers: handlers || {} },
)

/* ---- 结构 ---- */
check('最简：根节点 .task，优先级落到 data-priority', () => {
  const node = render(minimalTask)
  assert.equal(node.className, 'task')
  assert.equal(node.attrs['data-priority'], 'P2')
  assert.equal(node.attrs['aria-current'], undefined)
})
check('最简：标题/优先级/工作区都渲染出来', () => {
  const node = render(minimalTask)
  const text = node.text
  assert.ok(text.includes('排查访客地图无数据'))
  assert.ok(text.includes('P2'))
  assert.ok(text.includes('blog_dev'))
})
check('最简：有标题行与信息行（task-head / task-meta）', () => {
  const node = render(minimalTask)
  assert.equal(node.findAll((n) => n.className.includes('task-head')).length, 1)
  assert.equal(node.findAll((n) => n.className.includes('task-meta')).length, 1)
})
check('最简：没有 handler 时动作行不渲染（不留空行）', () => {
  const node = render(minimalTask)
  assert.equal(node.findAll((n) => n.className.includes('task-actions')).length, 0)
})
check('最简：没有 handler 的 chip 是 span，不是假按钮', () => {
  const node = render(minimalTask)
  const ws = node.findAll((n) => n.className.includes('chip-workspace'))[0]
  assert.equal(ws.tag, 'span')
  assert.equal(ws.attrs['aria-disabled'], 'true')
})

/* ---- 事件接线 ---- */
check('优先级：有 handler 时是 button，点击回调带上当前值', () => {
  const calls = []
  const node = render(minimalTask, { priority: (task, value) => calls.push([task.id, value]) })
  const prio = node.findAll((n) => n.className.includes('prio'))[0]
  assert.equal(prio.tag, 'button')
  prio.fire('click')
  assert.deepEqual(calls, [['t-min', 'P2']])
})
check('chip：有 handler 的 chip 是 button，点击回调 key', () => {
  const calls = []
  const node = render(minimalTask, { chip: { workspace: (task, key) => calls.push(['ws', task.id, key]) } })
  const ws = node.findAll((n) => n.className.includes('chip-workspace'))[0]
  assert.equal(ws.tag, 'button')
  ws.fire('click')
  assert.deepEqual(calls, [['ws', 't-min', 'workspace']])
})
check('动作：只渲染有 handler 的动作，并在最后放 ···', () => {
  const calls = []
  const node = render(minimalTask, { action: { complete: (task) => calls.push(task.id), more: () => calls.push('more') } })
  const actions = node.findAll((n) => n.className.includes('task-actions'))[0]
  const labels = actions.children.filter((child) => child.tag === 'button').map((child) => child.text)
  assert.deepEqual(labels, ['完成', '···'])
  assert.equal(actions.children.some((child) => child.className.includes('task-action-spacer')), true)
  actions.children.find((child) => child.text === '完成').fire('click')
  assert.deepEqual(calls, ['t-min'])
})
check('会话胶囊：有 handler 时可点，回调带会话 id', () => {
  const calls = []
  const node = render(fullTask, { session: (task, sid) => calls.push([task.id, sid]) })
  const chip = node.findAll((n) => n.className.includes('sess-inline'))[0]
  assert.equal(chip.tag, 'button')
  chip.fire('click')
  assert.deepEqual(calls, [['t-full', 'sess-1']])
})
check('会话灯：运行中给 lamp-running', () => {
  const node = render(fullTask)
  const lamp = node.findAll((n) => n.className.includes('lamp-'))[0]
  assert.equal(lamp.className, 'lamp lamp-running')
})
check('文档：有 handler 时可点，编辑/解绑按钮跟着出现', () => {
  const calls = []
  const node = render(fullTask, {
    doc: (task, doc) => calls.push(['open', doc.url]),
    docEdit: (task, doc) => calls.push(['edit', doc.url]),
    docUnbind: (task, doc) => calls.push(['unbind', doc.url]),
  })
  const docs = node.findAll((n) => n.className.includes('task-docs'))[0]
  assert.equal(docs.children.length, 2)
  const open = docs.children[0].children[0]
  open.fire('click')
  assert.deepEqual(calls, [['open', 'https://feishu.cn/docx/abc123']])
  assert.equal(docs.children[0].children.filter((n) => n.className.includes('doc-tool')).length, 2)
})
check('全字段：优先级色条/徽标在，未同步跟在预期 chip 里', () => {
  const node = render(fullTask)
  const eta = node.findAll((n) => n.className.includes('chip-eta'))[0]
  assert.ok(eta.text.includes('📅 预期 · 11-18 18:00'))
  assert.equal(eta.children.some((child) => child.className === 'chip-eta-sync'), true)
})
check('全字段：人、文档、关系都上屏', () => {
  const node = render(fullTask)
  assert.equal(node.findAll((n) => n.className === 'people-group').length, 2)
  assert.equal(node.findAll((n) => n.className.includes('doc-chip-group')).length, 2)
  assert.ok(node.text.includes('飞书接口限流') === false)
})

check('评论：宿主给了状态 + handler 才渲染评论区', () => {
  const ctx = { comments: { open: true, loaded: true, items: [] }, commentsSupported: true }
  const withHandlers = render(minimalTask, { comments: { refresh() {} } }, ctx)
  assert.equal(withHandlers.findAll((n) => n.className.includes('task-card-comments')).length, 1)
  const withoutHandlers = render(minimalTask, {}, ctx)
  assert.equal(withoutHandlers.findAll((n) => n.className.includes('task-card-comments')).length, 0)
})

/* 默认工厂必须把字符串子节点包成文本节点：侧边栏用 document 默认工厂，
   之前直接 appendChild('feishu') 会让整页 TypeError。 */
class StrictNode extends StubNode {
  constructor(tag) { super(tag); this.nodeType = 1 }
  appendChild(node) {
    if (!node || typeof node !== 'object' || node.nodeType == null) throw new TypeError('appendChild: not a Node')
    return super.appendChild(node)
  }
}
const collectText = (node) => {
  if (!node) return ''
  if (node.nodeType === 3) return String(node.textContent || '')
  return (node.children || []).map(collectText).join('')
}

check('默认元素工厂：字符串子节点转成文本节点', () => {
  const doc = {
    createElement: (tag) => new StrictNode(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
  }
  const task = { ...minimalTask, sessionId: 'sess-1', sessionAlive: true, sessionPhase: 'idle' }
  const model = buildTaskCardModel(task, { now: NOW })
  const node = renderTaskCard(model, { document: doc, task })
  assert.ok(collectText(node).includes('Session'), '会话标签应成为文本节点')
})

console.log('\ntaskCardView.mjs: ' + passed + ' passed, ' + failures.length + ' failed')
if (failures.length) process.exit(1)
