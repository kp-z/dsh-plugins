/**
 * 卡片菜单测试：优先级菜单的结构、点选、关闭（Escape / 外部点击）、位置夹取。
 *
 * 不引浏览器：document / body / anchor 都是桩，只验证纯 DOM 行为。
 */
import assert from 'node:assert/strict'
import { buildPriorityMenu, mountCardMenu, openPriorityMenu } from '../src/card/taskCardMenus.js'

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
  constructor(tag) {
    this.tag = tag
    this.children = []
    this.attrs = {}
    this.listeners = {}
    this.textContent = ''
    this.style = {}
    this.parentNode = null
    this.focused = 0
  }
  setAttribute(key, value) { this.attrs[key] = String(value) }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node }
  addEventListener(type, fn) { this.listeners[type] = fn }
  removeEventListener(type) { delete this.listeners[type] }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null } }
  focus() { this.focused += 1 }
  click() { if (this.listeners.click) this.listeners.click() }
  get text() { return (this.textContent || '') + this.children.map((c) => (typeof c === 'string' ? c : c.text)).join('') }
}

function makeDoc() {
  const doc = {
    body: new Node('body'),
    listeners: {},
    createElement: (tag) => new Node(tag),
    addEventListener(type, fn) { doc.listeners[type] = fn },
    removeEventListener(type) { delete doc.listeners[type] },
    fire(type, event) { if (doc.listeners[type]) doc.listeners[type](event || {}) },
  }
  return doc
}

const el = (tag, attrs, children) => {
  const node = new Node(tag)
  for (const key of Object.keys(attrs || {})) {
    const value = attrs[key]
    if (value == null || value === false) continue
    if (key === 'text') { node.textContent = String(value); continue }
    if (key === 'class' || key === 'className') { node.setAttribute('class', String(value)); continue }
    node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of [].concat(children == null ? [] : children)) {
    if (child == null) continue
    if (typeof child === 'string') { node.textContent += child; continue }
    node.appendChild(child)
  }
  return node
}

function makeAnchor() {
  const anchor = new Node('button')
  anchor.getBoundingClientRect = () => ({ left: 100, top: 50, bottom: 80, width: 30, height: 30 })
  return anchor
}
const anchor = makeAnchor()

check('菜单结构：P0-P3 + 清除，共 5 项', () => {
  const doc = makeDoc()
  const menu = buildPriorityMenu('P2', () => {}, { document: doc, el })
  assert.equal(menu.children.length, 5)
  assert.deepEqual(menu.children.map((item) => item.text.replace(/^\s+/, '')), ['P0 最紧急', 'P1 高', 'P2 中', 'P3 低', '清除优先级'])
})
check('当前值有 aria-current，条目带 data-value', () => {
  const doc = makeDoc()
  const menu = buildPriorityMenu('P2', () => {}, { document: doc, el })
  assert.equal(menu.children[2].attrs['data-value'], 'P2')
  assert.equal(menu.children[2].attrs['aria-current'], 'true')
  assert.equal(menu.children[0].attrs['aria-current'], undefined)
})
check('点一项：回调拿到值并关闭菜单', () => {
  const doc = makeDoc()
  const picked = []
  const { menu } = openPriorityMenu(anchor, 'P2', (value) => picked.push(value), { document: doc, el })
  assert.equal(doc.body.children.length, 1)
  menu.children[1].click()
  assert.deepEqual(picked, ['P1'])
  assert.equal(doc.body.children.length, 0, '菜单应已移除')
})
check('清除项回传空串', () => {
  const doc = makeDoc()
  const picked = []
  const { menu } = openPriorityMenu(anchor, 'P2', (value) => picked.push(value), { document: doc, el })
  menu.children[4].click()
  assert.deepEqual(picked, [''])
})
check('定位：放在 anchor 下方，并按视口夹取', () => {
  const doc = makeDoc()
  const menu = buildPriorityMenu('', () => {}, { document: doc, el })
  mountCardMenu(menu, anchor, { document: doc, viewport: { width: 400, height: 300 } })
  assert.equal(menu.style.left, '100px')
  assert.equal(menu.style.top, '84px')
  const close = mountCardMenu(buildPriorityMenu('', () => {}, { document: doc, el }), anchor, { document: doc, viewport: { width: 60, height: 20 } })
  close(true)
})
check('Escape 关闭并归还焦点', () => {
  const doc = makeDoc()
  const localAnchor = makeAnchor()
  const { menu } = openPriorityMenu(localAnchor, 'P0', () => {}, { document: doc, el })
  doc.fire('keydown', { key: 'Escape' })
  assert.equal(doc.body.children.length, 0)
  assert.equal(localAnchor.focused, 1)
  assert.equal(menu.parentNode, null)
})
check('外部点击关闭', () => {
  const doc = makeDoc()
  openPriorityMenu(anchor, 'P0', () => {}, { document: doc, el })
  doc.fire('mousedown', { target: new Node('div') })
  assert.equal(doc.body.children.length, 0)
})
check('重复关闭安全（幂等）', () => {
  const doc = makeDoc()
  const localAnchor = makeAnchor()
  const { close } = openPriorityMenu(localAnchor, 'P0', () => {}, { document: doc, el })
  close(true)
  close(true)
  assert.equal(localAnchor.focused, 1)
})


/* ---- 通用菜单 / 浮层 ---- */
import { buildActionMenu, buildWorkspaceMenu, buildTextPopover } from '../src/card/taskCardMenus.js'

check('动作菜单：分隔线 / 禁用项 / 危险项', () => {
  const doc = makeDoc()
  const calls = []
  const menu = buildActionMenu([
    { id: 'a', label: '添加文档', run: () => calls.push('add') },
    { separator: true },
    { id: 'b', label: 'AI 生成文档', run: () => calls.push('ai') },
    { id: 'c', label: '删除', danger: true, disabled: true, run: () => calls.push('del') },
  ], { document: doc, el, close: () => {} })
  assert.equal(menu.children.length, 4)
  assert.equal(menu.children[1].attrs['class'], 'tc-menu-sep')
  menu.children[2].click()
  assert.deepEqual(calls, ['ai'])
  assert.equal(menu.children[3].attrs['class'].includes('is-danger'), true)
})
check('工作区菜单：空列表给人话；有列表时当前项 aria-current', () => {
  const doc = makeDoc()
  const empty = buildWorkspaceMenu([], '', () => {}, { document: doc, el })
  assert.ok(empty.text.includes('还没有登记过工作区'))
  const picked = []
  const menu = buildWorkspaceMenu([
    { id: 'w1', title: 'dsh-plugin', path: '/Users/demo/dsh-plugin' },
    { id: 'w2', title: 'blog_dev' },
  ], 'w1', (ws) => picked.push(ws.id), { document: doc, el, close: () => {} })
  assert.equal(menu.children.length, 2)
  assert.equal(menu.children[0].attrs['aria-current'], 'true')
  assert.ok(menu.children[0].text.includes('/Users/demo/dsh-plugin'))
  menu.children[1].click()
  assert.deepEqual(picked, ['w2'])
})
check('文本浮层：标题 / 输入 / 提交回调', () => {
  const doc = makeDoc()
  const seen = []
  const pop = buildTextPopover({
    title: '📅 预期完成时间',
    sub: '首次承诺 11-10',
    placeholder: '这周五下班前',
    onSubmit: (value) => seen.push(value),
  }, { document: doc, el, close: () => {} })
  assert.ok(pop.element.text.includes('📅 预期完成时间'))
  pop.input.value = ' 明天下午三点 '
  pop.submit.click()
  assert.deepEqual(seen, ['明天下午三点'])
})
check('文本浮层：空输入不提交，给一句提示', () => {
  const doc = makeDoc()
  const seen = []
  const pop = buildTextPopover({ title: '排期', onSubmit: (v) => seen.push(v), emptyHint: '先说说什么时候做' }, { document: doc, el, close: () => {} })
  pop.submit.click()
  assert.deepEqual(seen, [])
  assert.equal(pop.message.textContent, '先说说什么时候做')
})
check('文本浮层：清除 / 取消 / Esc 都走对应回调', () => {
  const doc = makeDoc()
  const calls = []
  const pop = buildTextPopover({ title: 'x', canClear: true, onClear: () => calls.push('clear') }, { document: doc, el, close: (restore) => calls.push('close:' + restore) })
  pop.clear.click()
  pop.cancel.click()
  pop.input.listeners.keydown({ key: 'Escape' })
  assert.deepEqual(calls, ['clear', 'close:true', 'close:true'])
})

console.log('\ntaskCardMenus.mjs: ' + passed + ' passed, ' + failures.length + ' failed')
if (failures.length) process.exit(1)
