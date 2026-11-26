/**
 * 关系画布上的「真实卡片」：把 taskCardView 渲染出来的 DOM 塞进 foreignObject 用。
 *
 * 和 TaskNodeCard.js（SVG 重画）的区别：这一份**就是面板那张卡**，字段、类名、样式都同一套。
 * 画布上不放动作行：卡片只做展示，点击聚焦 / Enter 打开会话；写操作留给侧边栏。
 *
 * 画布节点不是 /api/tasks 的任务快照：它只有 label / state / refs / workspaceLabel 这些布局字段，
 * 所以这里先做一次「节点 → 任务投影」，再交给 buildTaskCardModel。
 */
import { buildTaskCardModel } from './taskCardModel.js'
import { renderTaskCard } from './taskCardView.js'
import { statusLabel } from '../overview/layout.js'

/* 画布卡片不再放动作行（用户口径：不需要「打开会话 / 聚焦」那一排）。
   卡片只做展示；点击 = 聚焦，Enter/Space = 打开会话。 */
export const GRAPH_CARD_ACTIONS = []

/** 节点投影：布局节点 → 卡片模型认识的字段（只读，不改原对象）。 */
export function projectGraphNode(node, baseTask) {
  const n = node && typeof node === 'object' ? node : {}
  const t = baseTask && typeof baseTask === 'object' ? baseTask : {}
  const refs = n.refs && typeof n.refs === 'object' ? n.refs : {}
  const count = (value) => (Array.isArray(value) ? value.length : 0)
  const badges = []
  badges.push({ key: 'state', label: statusLabel(n), cls: 'badge' })
  const pre = count(refs.predecessors)
  const post = count(refs.successors)
  const time = count(refs.earlierTasks) + count(refs.laterTasks)
  if (pre) badges.push({ key: 'pre', label: '前置 ' + pre, cls: 'badge' })
  if (post) badges.push({ key: 'post', label: '后置 ' + post, cls: 'badge' })
  if (time) badges.push({ key: 'time', label: '时间 ' + time, cls: 'badge' })
  return {
    /* 画布节点只有布局字段；如果宿主给了完整任务（阶段 3 的瘦快照已经带齐卡片字段），
       就以完整任务为底，节点只覆盖「布局/状态」相关的几项。 */
    task: Object.assign({}, t, {
      id: n.id || t.id,
      no: n.no != null ? n.no : t.no,
      title: n.fullTitle || t.title || n.label || n.id,
      priority: n.priority || t.priority,
      sessionId: n.sessionId || t.sessionId,
      done: n.state === 'done' || t.done === true,
      workspaceTitle: n.workspaceLabel || t.workspaceTitle || '',
    }),
    badges,
  }
}

/** 变化指纹：只有它变了才重建卡片 DOM（拖动位置不算，位置在 foreignObject 上）。 */
export function graphCardSignature(node, baseTask) {
  const n = node && typeof node === 'object' ? node : {}
  const t = baseTask && typeof baseTask === 'object' ? baseTask : {}
  const refs = n.refs && typeof n.refs === 'object' ? n.refs : {}
  return JSON.stringify([
    /* 几何变了要重建：同一张卡的 foreignObject 高度会随图布局变化，旧 DOM 不能沿用。 */
    n.id, n.w, n.h, n.fullTitle || n.label || '', n.no, n.priority, n.state, n.ghost === true,
    n.sessionId, n.workspaceLabel || '',
    (refs.predecessors || []).length, (refs.successors || []).length,
    (refs.earlierTasks || []).length, (refs.laterTasks || []).length,
    /* 完整任务带上之后，这些变了也要重建卡片 */
    t.start || '', t.end || '', t.schedule?.nextText || '', t.commitment?.expectedAt || 0,
    t.commitment?.syncState || '', t.sessionAlive === true, t.sessionUnread === true,
    t.project || '', t.projectSyncError || '',
    t.listName || '', (t.docs || []).length, (t.members || []).length, (t.customFields || []).length,
  ])
}

/**
 * 画布卡片不再有动作行；保留这个函数是为了 GraphView 的接线形状稳定。
 * （点击 / Enter 的行为仍由 <g> 上的指针与键盘事件处理。）
 */
export function graphCardHandlers() {
  return { action: {} }
}

/**
 * 构建画布卡片 DOM。
 * deps: { el?, document?, handlers?: { action: { open?, focus? } }, now? }
 * @returns {{ element, signature, model }}
 */
export function buildGraphCardDom(node, deps) {
  const options = deps && typeof deps === 'object' ? deps : {}
  const fullTask = options.task
  const { task, badges } = projectGraphNode(node, fullTask)
  const model = buildTaskCardModel(task, {
    now: options.now,
    canStart: false,
    badges,
    actions: GRAPH_CARD_ACTIONS,
    hiddenFieldNames: ['工作区'],
  })
  const element = renderTaskCard(model, {
    el: options.el,
    document: options.document,
    task: node,
    handlers: { action: (options.handlers && options.handlers.action) || {} },
  })
  return { element, signature: graphCardSignature(node, fullTask), model }
}

export default buildGraphCardDom
