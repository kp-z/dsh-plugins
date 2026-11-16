/**
 * 面板卡片桥（阶段 5 后）：panel.html 的 taskNode 只剩一条路——
 * 调共享模块 buildTaskCardModel + renderTaskCard，面板行为通过 handlers / 扩展位注入。
 *
 * 这里不渲染真实 DOM：把 sharedCard 换成桩，验证「传进去的 model 上下文」和
 * 「handler 接回了哪些面板函数」；卡片本身的渲染在 test/taskCardView.mjs。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')

function extract(name) {
  const start = script.indexOf('  function ' + name + '(')
  assert.ok(start >= 0, '缺函数 ' + name)
  const end = script.indexOf('\n  function ', start + 3)
  return script.slice(start, end > 0 ? end : start + 4000)
}

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.textContent = ''; this.className = '' }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'class') this.className = String(value) }
  appendChild(node) { this.children.push(node); return node }
}
const el = (tag, attrs, kids) => {
  const node = new Node(tag)
  for (const key of Object.keys(attrs || {})) {
    const value = attrs[key]
    if (value == null) continue
    if (key === 'class') node.className = String(value)
    else if (key === 'text') node.textContent = String(value)
    else node.setAttribute(key, value)
  }
  for (const child of [].concat(kids || [])) if (child != null) node.appendChild(child)
  return node
}

const calls = []
const context = {
  el,
  app: {
    currentSessionId: 'sess-1',
    busyTask: { 't-1': true },
    sessions: {},
    sharedList: '共享清单',
    settings: { taskFields: { priority: '优先级', doc: '文档' } },
  },
  nowMs: () => 1763000000000,
  toast: (text) => calls.push(['toast', text]),
  normPriority: (value) => String(value || '').toUpperCase(),
  cardCommentsControl: () => ({ button: new Node('comment-button'), section: new Node('comments-section') }),
  suspensionControlNode: () => new Node('suspend-control'),
  openPriorityMenu: (anchor, current, pick) => { calls.push(['priority', current]); context.menu = anchor },
  setPriority: (id, value) => calls.push(['setPriority', id, value]),
  startTitleEdit: (task, title, head) => calls.push(['rename', task.id]),
  showSessionTip: (chip, sid, state) => calls.push(['tip', sid, state]),
  scheduleSessionTipHide: () => calls.push(['tipHide']),
  sessionActivityLabel: () => '空闲',
  currentActivityTask: (task) => task,
  openSchedulePopover: (anchor, task) => calls.push(['schedule', task.id]),
  openEtaPopover: (anchor, task) => calls.push(['eta', task.id]),
  openWorkspaceMenu: (anchor, task) => calls.push(['workspace', task.id]),
  onStart: (task) => calls.push(['start', task.id]),
  onBind: (task) => calls.push(['bind', task.id]),
  onComplete: (task) => calls.push(['complete', task.id]),
  openTaskDocumentMenu: (anchor, task) => calls.push(['docMenu', task.id]),
  onSyncTask: (task) => calls.push(['sync', task.id]),
  openTaskMoreMenu: (anchor, task) => calls.push(['more', task.id]),
  openDoc: (url) => calls.push(['openDoc', url]),
  startDocLinkEdit: (task, doc) => calls.push(['docEdit', doc.url]),
  onUnbindDoc: (task, doc) => calls.push(['docUnbind', doc.url]),
  onOpenSession: (sid, title) => calls.push(['openSession', sid, title]),
  onCopySession: (sid) => calls.push(['copySession', sid]),
  sharedCard: null,
}
vm.createContext(context)
for (const name of ['panelScopedCard', 'panelCardPlaceholder', 'panelCardFieldHiddenNames', 'panelCardSessionClick', 'taskNode']) {
  vm.runInContext(extract(name), context)
}

const task = { id: 't-1', title: '测试任务', sessionId: 'sess-1', sessionAlive: true, sessionPhase: 'running', docs: [{ url: 'https://feishu.cn/docx/a', title: 'A' }], members: [], customFields: [], meta: {} }

/* ---- 模块未就绪 ---- */
const placeholder = context.taskNode(task)
assert.equal(placeholder.className, 'tc-scope', '卡片外面套一层 .tc-scope（与画布同一份样式作用域）')
assert.equal(placeholder.children[0].className, 'task')
assert.ok(JSON.stringify(placeholder.children).includes('测试任务'))

/* ---- 桥：model 上下文 + handler 接线 ---- */
const renders = []
context.sharedCard = {
  buildTaskCardModel: (input, ctx) => ({ input, ctx }),
  renderTaskCard: (model, deps) => { renders.push({ model, deps }); return new Node('card') },
}
const card = context.taskNode(task)
assert.equal(renders.length, 1, '应该调一次共享渲染')
const { model, deps } = renders[0]
assert.equal(model.input, task, '任务原样交给模型')
assert.equal(model.ctx.currentSessionId, 'sess-1')
assert.equal(model.ctx.busy, true, 'busyTask 透传')
assert.equal(model.ctx.sharedListName, '共享清单')
assert.ok(model.ctx.hiddenFieldNames.includes('优先级'), '隐藏字段包含优先级')
assert.ok(model.ctx.hiddenFieldNames.includes('文档'), '写回列（文档）不重复展示')

assert.equal(deps.handlers.priority(task, 'P0'), undefined)
assert.deepEqual(calls.pop(), ['priority', 'P0'])
deps.handlers.chip.eta(task)
assert.deepEqual(calls.pop(), ['eta', 't-1'])
deps.handlers.chip.schedule(task)
assert.deepEqual(calls.pop(), ['schedule', 't-1'])
deps.handlers.chip.workspace(task)
assert.deepEqual(calls.pop(), ['workspace', 't-1'])
deps.handlers.action.docs(task)
assert.deepEqual(calls.pop(), ['docMenu', 't-1'])
deps.handlers.action.sync(task)
assert.deepEqual(calls.pop(), ['sync', 't-1'])
deps.handlers.action.more(task)
assert.deepEqual(calls.pop(), ['more', 't-1'])
deps.handlers.action.complete(task)
assert.deepEqual(calls.pop(), ['complete', 't-1'])
deps.handlers.renameTitle(task, new Node('title'), new Node('head'))
assert.deepEqual(calls.pop(), ['rename', 't-1'])
deps.handlers.doc(task, { url: 'https://feishu.cn/docx/a' })
assert.deepEqual(calls.pop(), ['openDoc', 'https://feishu.cn/docx/a'])
deps.handlers.docUnbind(task, { url: 'https://feishu.cn/docx/a' })
assert.deepEqual(calls.pop(), ['docUnbind', 'https://feishu.cn/docx/a'])

/* 会话胶囊：当前对话只提示；活会话打开；死会话复制 id。 */
deps.handlers.session(task, 'sess-1')
assert.deepEqual(calls.pop(), ['toast', '这就是当前对话'])
deps.handlers.session(task, 'sess-2')
assert.deepEqual(calls.pop(), ['openSession', 'sess-2', '测试任务'])
deps.handlers.session({ id: 'x', title: 'x', sessionAlive: false }, 'sess-dead')
assert.equal(calls.pop()[0], 'copySession')

/* ---- 评论 / 挂起：通过扩展位挂回卡片 ---- */
const extraNodes = deps.extraActions.map((item) => item.node)
assert.ok(extraNodes.includes(card._cardComments.button), '评论按钮挂进动作行')
assert.ok(extraNodes.some((node) => node.tag === 'suspend-control'), '挂起控件挂进动作行')
assert.equal(deps.extraBody.length, 1)
assert.equal(card._cardComments.section, deps.extraBody[0])
assert.ok(deps.extraActions.every((item) => item.slot === 'before-spacer' || item.slot === 'after-spacer'))

console.log('TASK_CARD_BRIDGE_OK: placeholder, model context, handlers wiring, comments/suspend slots')
