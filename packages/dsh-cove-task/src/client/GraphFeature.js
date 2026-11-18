/**
 * 「看板」功能页 —— React Flow 版。
 *
 * React Flow 负责画布、视口、拖拽、缩放、边路由和 Controls；本组件只负责
 * 把 OverviewPanel 的树/筛选/卡片 DOM 接进去。宿主没注入 ReactFlow 时
 * （旧宿主 / 单测桩）退回原来的自研 GraphView，保证向后兼容。
 */
import { createGraphFlowFeature } from './GraphFlow.js'
import { createGraphView } from './GraphView.js'

export function createGraphFeature(deps) {
  const { React, h } = deps || {}
  const FlowView = createGraphFlowFeature(deps)
  const LegacyView = createGraphView(deps)

  return function GraphFeature(props) {
    const ctx = props || {}
    const content = FlowView
      ? h(FlowView, ctx)
      : h(LegacyView, {
        graphs: ctx.graphs,
        selectedId: ctx.selectedId,
        focusedId: ctx.focusedId,
        nodePos: ctx.nodePos,
        taskById: ctx.taskById,
        revealIds: ctx.revealIds,
        onOpenTask: ctx.onOpenTask,
        onOrganize: ctx.onOrganizeGraph,
        onFocusTask: ctx.onFocusTask,
        onNodeMove: ctx.onNodeMove,
        onResetLayout: ctx.onResetLayout,
        onBlur: ctx.onBlur,
        hostReady: ctx.hostReady,
        hostReason: ctx.hostReason,
        onOpenSession: ctx.onOpenSession,
      })
    return h('div', { className: 'fo-feature' },
      h('div', { className: 'fo-feature-body' },
        h('div', { className: 'fo-canvas-area' }, content),
      ),
    )
  }
}

export default createGraphFeature
