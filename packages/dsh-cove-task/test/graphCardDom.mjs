/**
 * 画布 DOM 卡（阶段 2 spike）：节点投影、签名、渲染装配。
 *
 * 这一层不做视觉断言（那要在实机 foreignObject 里看），只钉结构：
 *  - 节点 → 任务投影：标题/优先级/会话/工作区/状态徽标/关系计数；
 *  - 签名只在「看得见的内容」变化时变（拖动位置不算）；
 *  - 动作只留打开会话 / 聚焦，没有 handler 就不渲染。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { estimateCardHeight } from '../src/overview/layout.js'
import { buildGraphCardDom, graphCardHandlers, graphCardSignature, projectGraphNode, GRAPH_CARD_ACTIONS } from '../src/card/graphCardDom.js'

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

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.textContent = ''; this.className = '' }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'class') this.className = String(value) }
  appendChild(node) { this.children.push(node); return node }
  addEventListener(type, fn) { this.listeners[type] = fn }
  get text() { return (this.textContent || '') + this.children.map((c) => (typeof c === 'string' ? c : c.text)).join('') }
  findAll(predicate, out = []) { if (predicate(this)) out.push(this); for (const c of this.children) if (c instanceof Node) c.findAll(predicate, out); return out }
}
const el = (tag, attrs, children) => {
  const node = new Node(tag)
  for (const key of Object.keys(attrs || {})) {
    const value = attrs[key]
    if (value == null || value === false) continue
    if (key === 'text') { node.textContent = String(value); continue }
    if (key === 'className' || key === 'class') { node.setAttribute('class', String(value)); continue }
    node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of [].concat(children == null ? [] : children)) if (child != null) node.appendChild(child)
  return node
}

const node = {
  id: 't1', no: 25, label: '排查访客地图无数据…', fullTitle: '排查访客地图无数据', state: 'open',
  priority: 'P2', workspaceLabel: 'blog_dev', sessionId: 'sess-1',
  refs: { predecessors: [{}, {}], successors: [], earlierTasks: [{}], laterTasks: [] },
}

check('节点投影：标题/优先级/会话/工作区/完成态', () => {
  const { task } = projectGraphNode(node)
  assert.equal(task.title, '排查访客地图无数据')
  assert.equal(task.priority, 'P2')
  assert.equal(task.sessionId, 'sess-1')
  assert.equal(task.workspaceTitle, 'blog_dev')
  assert.equal(task.done, false)
})
check('节点投影：状态 + 关系计数进徽标', () => {
  const { badges } = projectGraphNode(node)
  assert.deepEqual(badges.map((b) => b.label), ['就绪', '前置 2', '时间 1'])
})
check('节点投影：已完成/挂起的状态文案', () => {
  assert.equal(projectGraphNode(Object.assign({}, node, { state: 'done' })).badges[0].label, '完成')
  assert.equal(projectGraphNode(Object.assign({}, node, { state: 'suspended', done: true })).badges[0].label, '挂起')
})
check('签名：看得见的内容变了才变', () => {
  const base = graphCardSignature(node)
  assert.equal(graphCardSignature(Object.assign({}, node, { x: 999, y: 999 })), base, '位置不该影响签名')
  assert.notEqual(graphCardSignature(Object.assign({}, node, { priority: 'P0' })), base)
  assert.notEqual(graphCardSignature(Object.assign({}, node, { sessionId: 'sess-2' })), base)
  assert.notEqual(graphCardSignature(Object.assign({}, node, { refs: { predecessors: [{}], successors: [] } })), base)
  /* 同一张卡的 foreignObject 高度会变；几何变了必须重建 DOM，不能沿用旧布局。 */
  assert.notEqual(graphCardSignature(Object.assign({}, node, { w: 420, h: 120 })), graphCardSignature(Object.assign({}, node, { w: 420, h: 156 })), '高度变化要进签名')
})
check('渲染：就是面板那张卡（.task + 标题 + 工作区）', () => {
  const { element } = buildGraphCardDom(node, { el })
  assert.equal(element.className, 'task')
  assert.ok(element.text.includes('排查访客地图无数据'))
  assert.ok(element.text.includes('blog_dev'))
  assert.ok(element.text.includes('就绪'))
})
check('没有动作行：画布卡片只做展示，打开/聚焦交给点击与键盘', () => {
  assert.deepEqual(GRAPH_CARD_ACTIONS, [])
  const bare = buildGraphCardDom(node, { el })
  assert.equal(bare.element.findAll((n) => n.className.includes('task-actions')).length, 0)
  const wired = buildGraphCardDom(node, { el, handlers: { action: { open() {}, focus() {} } } })
  assert.equal(wired.element.findAll((n) => n.className.includes('task-actions')).length, 0, '即使给 handler 也不画动作行')
  assert.deepEqual(graphCardHandlers(node, {}), { action: {} })
})
check('ghost 节点：只读，没有动作行', () => {
  const ghost = Object.assign({}, node, { ghost: true, state: 'ghost', sessionId: '' })
  const built = buildGraphCardDom(ghost, { el })
  assert.ok(built.element.text.includes('组外'))
  assert.equal(built.element.findAll((n) => n.className.includes('task-actions')).length, 0)
})

check('GraphView 确实接了 HTML 卡片层（不再用 foreignObject）', () => {
  const source = readFileSync(new URL('../src/client/GraphView.js', import.meta.url), 'utf8')
  assert.equal(source.includes("h('foreignObject'"), false, '不应再有 foreignObject')
  assert.ok(source.includes("className: 'fo-cards-layer'"))
  assert.ok(source.includes('fo-node-dom'))
  assert.ok(source.includes('buildGraphCardDom'))
  assert.ok(source.includes('mountDomCard'))
})

check('给了完整任务：卡片用完整字段（文档/人/预期），签名也跟着字段变', () => {
  const fullTask = {
    id: 't1', no: 25, title: '排查访客地图无数据', start: '2026-11-01 10:00', end: '2026-11-20',
    commitment: { expectedText: '2026-11-18 18:00', expectedAt: 1794304800000, state: 'soon', label: '剩 3.3 天', syncState: 'pending' },
    docs: [{ url: 'https://feishu.cn/docx/a', title: '设计稿' }],
    members: [{ id: 'u1', name: '张三', role: 'assignee' }],
    listName: '日常', meta: { trigger: 'manual' },
  }
  const withTask = buildGraphCardDom(node, { el, task: fullTask })
  const text = withTask.element.text
  assert.ok(text.includes('设计稿'))
  /* 头像只显示首字（真名在 aria-label / 悬停里） */
  assert.ok(text.includes('张'))
  assert.ok(text.includes('📅 预期 · 11-18 18:00'))
  assert.ok(text.includes('截止 11-20'))
  assert.notEqual(withTask.signature, buildGraphCardDom(node, { el }).signature)
})

check('节点高度估算：内容多就更高，且不少于 120（卡片 header 不被压没）', () => {
  const bare = estimateCardHeight({ id: 'x', title: 't' })
  const rich = estimateCardHeight({
    id: 'y', title: 't', listName: '日常', end: '2026-11-20',
    meta: { trigger: 'auto' },
    commitment: { expectedAt: Date.now() },
    customFields: [{ name: '模块', value: '插件' }, { name: '环境', value: 'dev' }],
    docs: [{ url: 'https://feishu.cn/docx/a', title: 'A' }],
    workspaceTitle: 'w',
  })
  assert.ok(bare >= 120, `最简卡也不低于 120：${bare}`)
  assert.ok(rich > bare, `内容多的卡应更高：${rich} vs ${bare}`)
  assert.ok(rich <= 260)
})

console.log('\ngraphCardDom.mjs: ' + passed + ' passed, ' + failures.length + ' failed')
if (failures.length) process.exit(1)
