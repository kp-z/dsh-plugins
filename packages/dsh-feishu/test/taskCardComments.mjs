/**
 * 评论区测试：摘要口径、可提交性判断、渲染结构。
 *
 * 评论的读取/投递留在宿主侧，这里只钉两件事：
 *  1. 不同状态下摘要与提示不能编（加载中 / 未读 / 读失败 / 不支持历史）；
 *  2. 不能处理时按钮必须禁用并给出原因（已完成 / 挂起 / 没绑会话 / 已处理过）。
 */
import assert from 'node:assert/strict'
import { buildCommentsModel, renderCardComments, COMMENT_STATUS } from '../src/card/taskCardComments.js'

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
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.textContent = ''; this.disabled = false }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'disabled') this.disabled = true }
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
    if (key === 'class') { node.setAttribute('class', String(value)); continue }
    node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of [].concat(children == null ? [] : children)) if (child != null) node.appendChild(child)
  return node
}

const baseTask = { done: false, suspended: false, hasSession: true, supported: true, enabled: true }
const comment = (id, text, extra) => Object.assign({ id, text, createdAt: Date.now() - 60000, authorName: '张三' }, extra || {})

check('摘要：没读过时提示「展开后读取评论」', () => {
  const m = buildCommentsModel({ open: false }, baseTask)
  assert.equal(m.summary, '展开后读取评论')
  assert.equal(m.open, false)
})
check('摘要：加载中 / 已读为空 / 已读有数量', () => {
  assert.equal(buildCommentsModel({ loading: true }, baseTask).summary, '读取中…')
  assert.equal(buildCommentsModel({ loaded: true, items: [] }, baseTask).summary, '暂无评论')
  assert.equal(buildCommentsModel({ loaded: true, items: [comment('c1', 'hi')] }, baseTask).summary, '1 条评论')
})
check('摘要带扫描读数（不编，只来自 diagnostic）', () => {
  const m = buildCommentsModel({ loaded: true, items: [], diagnostic: { readCount: 2, newCount: 1, lastScanAt: Date.now() - 3600000 } }, baseTask)
  assert.ok(m.summary.includes('读 2'))
  assert.ok(m.summary.includes('新 1'))
  assert.ok(m.summary.includes('扫描'))
})
check('提示：不支持历史 / 读取失败 / 不完整', () => {
  assert.ok(buildCommentsModel({}, Object.assign({}, baseTask, { supported: false })).notice.includes('尚不支持任务评论历史'))
  assert.ok(buildCommentsModel({ error: 'boom' }, baseTask).notice.includes('读取失败：boom'))
  assert.ok(buildCommentsModel({ complete: false }, baseTask).notice.includes('不完整'))
})
check('状态文案表与面板一致', () => {
  assert.equal(COMMENT_STATUS.pending, '待处理')
  assert.equal(COMMENT_STATUS.replied, '已回复')
  assert.equal(COMMENT_STATUS.unknown, '待核对')
})
check('可提交性：没绑会话 → 禁用且给原因', () => {
  const m = buildCommentsModel({ loaded: true, items: [comment('c1', 'hi')] }, Object.assign({}, baseTask, { hasSession: false }))
  assert.equal(m.items[0].canSubmit, false)
  assert.ok(m.items[0].disabledReason.includes('绑定会话'))
})
check('可提交性：已完成 / 挂起 都不行', () => {
  const done = buildCommentsModel({ loaded: true, items: [comment('c1', 'hi')] }, Object.assign({}, baseTask, { done: true }))
  assert.ok(done.items[0].disabledReason.includes('已完成'))
  const susp = buildCommentsModel({ loaded: true, items: [comment('c1', 'hi')] }, Object.assign({}, baseTask, { suspended: true }))
  assert.ok(susp.items[0].disabledReason.includes('挂起'))
})
check('已处理过的评论不能再处理', () => {
  const m = buildCommentsModel({ loaded: true, items: [comment('c1', 'hi')], entries: [{ commentId: 'c1', status: 'delivered', turn: 3 }] }, baseTask)
  assert.equal(m.items[0].canSubmit, false)
  assert.equal(m.items[0].statusLabel, '已投递')
})
check('自己的 AI 回复标记 own', () => {
  const m = buildCommentsModel({ loaded: true, items: [comment('c1', 'hi', { authorType: 'app' })] }, baseTask)
  assert.equal(m.items[0].own, true)
})
check('渲染：未展开时 section 带 hidden，摘要照样在', () => {
  const m = buildCommentsModel({ open: false, loaded: true, items: [] }, baseTask)
  const node = renderCardComments(m, { el })
  assert.equal(node.attrs.hidden, '')
  assert.ok(node.text.includes('暂无评论'))
})
check('渲染：展开后刷新/对话按钮只在能给能力时出现', () => {
  const m = buildCommentsModel({ open: true, loaded: true, items: [] }, baseTask)
  const node = renderCardComments(m, { el, handlers: { refresh() {}, openSession() {} } })
  const labels = node.findAll((n) => n.tag === 'button').map((b) => b.textContent)
  assert.deepEqual(labels, ['刷新', '对话'])
})
check('渲染：一条评论的元信息与动作', () => {
  const m = buildCommentsModel({ open: true, loaded: true, items: [comment('c1', '需要你看一下')] }, baseTask)
  const calls = []
  const node = renderCardComments(m, { el, handlers: { submit: (item) => calls.push(item.id), ignore: () => {} } })
  assert.ok(node.text.includes('张三'))
  assert.ok(node.text.includes('需要你看一下'))
  assert.ok(node.text.includes('历史'))
  const submit = node.findAll((n) => n.tag === 'button' && n.textContent === '处理')[0]
  submit.listeners.click()
  assert.deepEqual(calls, ['c1'])
})
check('渲染：不可提交时按钮 disabled', () => {
  const m = buildCommentsModel({ open: true, loaded: true, items: [comment('c1', 'x')] }, Object.assign({}, baseTask, { done: true }))
  const node = renderCardComments(m, { el, handlers: { submit() {} } })
  const submit = node.findAll((n) => n.tag === 'button' && n.textContent === '处理')[0]
  assert.equal(submit.attrs.disabled, 'disabled')
})

console.log('\ntaskCardComments.mjs: ' + passed + ' passed, ' + failures.length + ' failed')
if (failures.length) process.exit(1)
