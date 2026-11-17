/**
 * 离线渲染「任务卡画廊」：给开发日志/截图用的独立 HTML。
 *
 * 用共享的 taskCardModel + taskCardView 渲染，不依赖浏览器/宿主：
 * 一个极小的 DOM 桩 + TASK_CARD_STYLES，输出 .card-gallery.html，再用 Chrome 截图。
 *
 * 跑法：node scripts/render-card-gallery.mjs
 */
import { writeFileSync } from 'node:fs'
import { buildTaskCardModel } from '../src/card/taskCardModel.js'
import { renderTaskCard } from '../src/card/taskCardView.js'
import { TASK_CARD_STYLES } from '../src/card/taskCardStyles.js'
import { estimateCardHeight } from '../src/overview/layout.js'
import { buildGraphCardDom } from '../src/card/graphCardDom.js'

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.textContent = ''; this.style = { setProperty() {} } }
  setAttribute(key, value) { this.attrs[key] = String(value) }
  appendChild(node) { this.children.push(node); return node }
  addEventListener(type, fn) { this.listeners[type] = fn }
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
const esc = (value) => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function serialize(node) {
  if (typeof node === 'string') return esc(node)
  if (!(node instanceof Node)) return ''
  const attrs = Object.keys(node.attrs).map((key) => ' ' + key + '="' + esc(node.attrs[key]) + '"').join('')
  const inner = esc(node.textContent) + node.children.map(serialize).join('')
  return '<' + node.tag + attrs + '>' + inner + '</' + node.tag + '>'
}

const NOW = Date.parse('2026-11-15T15:00:00+08:00')
const handlers = {
  priority() {}, session() {},
  chip: { start() {}, end() {}, schedule() {}, eta() {}, workspace() {} },
  action: { complete() {}, docs() {}, sync() {}, comments() {}, suspend() {}, more() {}, start() {}, bind() {} },
  doc() {}, docEdit() {}, docUnbind() {},
}
const render = (task) => serialize(renderTaskCard(buildTaskCardModel(task, { now: NOW, currentSessionId: 'sess-1' }), { el, task, handlers }))

const full = {
  id: 't-full', no: 32, title: '更新本地 feishu 插件到最新版本', priority: 'P2', started: true, boundOnly: true,
  start: '2026-11-14 18:19', end: '2026-11-20', listName: '日常', meta: { trigger: 'manual' },
  schedule: { summary: '每周一 09:00', short: '每周一 09:00', nextText: '2026-11-17 09:00', state: 'active' },
  commitment: { expectedText: '2026-11-18 18:00', expectedAt: Date.parse('2026-11-18T18:00:00+08:00'), state: 'soon', label: '剩 3.3 天', syncState: 'pending' },
  delayAttribution: { label: '等接口', reason: '飞书接口限流' },
  customFields: [{ name: '模块', value: '插件' }, { name: '环境', value: 'dev' }],
  members: [{ id: 'u1', name: '张三', role: 'assignee' }, { id: 'u2', name: '李四', role: 'follower' }],
  docs: [{ url: 'https://feishu.cn/docx/abc123', title: '卡片统一设计稿' }],
  workspaceTitle: 'dsh-plugin', workspacePath: '/Users/demo/项目/Proj/dsh-plugin',
  sessionId: 'sess-1', sessionAlive: true, sessionPhase: 'running',
}
const minimal = { id: 't-min', no: 25, title: '排查访客地图无数据', priority: 'P3', workspaceTitle: 'blog_dev' }
const suspended = { id: 't-susp', no: 40, title: '被挂起的任务（等对方回复）', suspension: { active: true, reason: '等对方回复' }, sessionId: 'sess-2', sessionAlive: true, sessionPhase: 'running' }
const doneTask = { id: 't-done', no: 11, title: '已完成：整理关系页图例', done: true, endedAt: 0, workspaceTitle: 'dsh-plugin' }

const cards = [
  ['全字段任务（文档 / 负责人 / 预期 / 排期 / 会话运行中）', full],
  ['最简卡（没有会话、没有文档）', minimal],
  ['挂起中（同一个卡，状态换一种）', suspended],
  ['已完成', doneTask],
]

const canvas = [full, minimal, suspended].map((task) => {
  const height = estimateCardHeight(task)
  return `<div class="node tc-scope" style="height:${height}px">${render(task)}</div>`
}).join('')

const section = (title, body) => `<section><h2>${esc(title)}</h2>${body}</section>`

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>任务卡画廊</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #f6f7f9; color: #1f2329;
    font: 14px/1.6 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #6b7280; margin-bottom: 28px; }
  h2 { font-size: 15px; margin: 0 0 12px; color: #374151; }
  section { margin-bottom: 32px; max-width: 1080px; }
  .row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .slot { background: #fff; border: 1px dashed #d1d5db; border-radius: 12px; padding: 14px; }
  .slot .tag { font-size: 11px; color: #6b7280; margin-bottom: 8px; }
  .canvas { display: flex; gap: 16px; align-items: flex-start; background:
    linear-gradient(135deg, rgba(59,91,219,.05), rgba(255,255,255,0)), #eef1f6; padding: 20px; border-radius: 14px; }
  .node { width: 300px; box-sizing: border-box; }
  .node .task { height: 100%; box-sizing: border-box; overflow: hidden; }
  .tc-scope {
    --tc-line: #e3e6ec; --tc-line-hover: #c9ced8; --tc-card: #ffffff; --tc-sub: #f3f4f7;
    --tc-shadow: 0 1px 2px rgba(17,24,39,.06); --tc-text: #1f2329; --tc-text-1: #1f2329;
    --tc-text-2: #4b5563; --tc-text-3: #6b7280;
    --tc-accent: #3b5bdb; --tc-accent-text: #2f4bc8; --tc-accent-weak: rgba(59,91,219,.10); --tc-accent-line: rgba(59,91,219,.24);
    --tc-select: #3b5bdb; --tc-ok: #16a34a; --tc-ok-weak: rgba(22,163,74,.12); --tc-ok-line: rgba(22,163,74,.30);
    --tc-warn: #b45309; --tc-warn-weak: rgba(180,83,9,.12); --tc-warn-line: rgba(180,83,9,.30);
    --tc-danger: #d33; --tc-danger-weak: rgba(211,51,51,.12); --tc-danger-line: rgba(211,51,51,.30);
    --tc-card: #ffffff;
  }
  ${TASK_CARD_STYLES}
</style></head><body>
  <h1>dsh-cove-task · 任务卡统一组件</h1>
  <div class="sub">同一份 taskCardModel + taskCardView + taskCardStyles：侧边栏与关系画布共用；下面是离线渲染的真实产物。</div>
  ${section('卡片（侧边栏宽度下的形态）', '<div class="row">' + cards.map(([tag, task], index) => `<div class="slot"><div class="tag">${esc(tag)}</div><div class="tc-scope">${render(task)}</div></div>`).join('') + '</div>')}
  ${section('关系画布节点（foreignObject 300px 宽，高度按内容估算）', '<div class="canvas">' + canvas + '</div>')}
</body></html>`

const out = new URL('../.card-gallery.html', import.meta.url)
writeFileSync(out, html)
console.log('wrote', out.pathname, html.length)

/* 画布卡：动作只有「打开会话 / 聚焦」，和实机一致。 */
const canvasHandlers = { action: { open() {}, focus() {} } }
const canvasNodeOf = (task) => {
  const built = buildGraphCardDom({
    id: task.id, no: task.no, label: task.title, fullTitle: task.title, state: task.done ? 'done' : (task.suspension && task.suspension.active ? 'suspended' : 'open'),
    priority: task.priority, sessionId: task.sessionId, workspaceLabel: task.workspaceTitle,
    refs: { predecessors: task.id === 't-full' ? [{}] : [], successors: [], earlierTasks: [], laterTasks: [] },
  }, { el, task, handlers: canvasHandlers })
  const height = estimateCardHeight(task)
  return `<div class="node tc-scope" style="height:${height}px">${serialize(built.element)}</div>`
}
const canvasHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>关系画布节点</title>
<style>
  body { margin: 0; padding: 28px; background: #eef1f6; font: 14px/1.6 -apple-system, "PingFang SC", sans-serif; color: #1f2329; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #6b7280; margin-bottom: 18px; font-size: 12px; }
  .canvas { display: flex; gap: 18px; align-items: flex-start; padding: 20px; border-radius: 14px;
    background: linear-gradient(135deg, rgba(59,91,219,.05), rgba(255,255,255,0)), #f7f8fb; }
  .node { width: 300px; box-sizing: border-box; }
  .node .task { height: 100%; box-sizing: border-box; overflow: hidden; }
  .tc-scope {
    --tc-line: #e3e6ec; --tc-line-hover: #c9ced8; --tc-card: #ffffff; --tc-sub: #f3f4f7;
    --tc-shadow: 0 1px 2px rgba(17,24,39,.06); --tc-text: #1f2329; --tc-text-1: #1f2329;
    --tc-text-2: #4b5563; --tc-text-3: #6b7280;
    --tc-accent: #3b5bdb; --tc-accent-text: #2f4bc8; --tc-accent-weak: rgba(59,91,219,.10); --tc-accent-line: rgba(59,91,219,.24);
    --tc-select: #3b5bdb; --tc-ok: #16a34a; --tc-ok-weak: rgba(22,163,74,.12); --tc-ok-line: rgba(22,163,74,.30);
    --tc-warn: #b45309; --tc-warn-weak: rgba(180,83,9,.12); --tc-warn-line: rgba(180,83,9,.30);
    --tc-danger: #d33; --tc-danger-weak: rgba(211,51,51,.12); --tc-danger-line: rgba(211,51,51,.30);
        --tc-card: #ffffff;
  }
  ${TASK_CARD_STYLES}
</style></head><body>
  <h1>关系画布：任务节点 = 面板同一张卡</h1>
  <div class="sub">foreignObject 承载 · 300px 宽 · 高度按内容估算（同一张图等高）· 动作只留「打开会话 / 聚焦」</div>
  <div class="canvas">${[full, minimal, suspended, doneTask].map(canvasNodeOf).join('')}</div>
</body></html>`
writeFileSync(new URL('../.card-canvas.html', import.meta.url), canvasHtml)
console.log('wrote canvas html', canvasHtml.length)

