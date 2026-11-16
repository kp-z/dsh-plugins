/**
 * 把 layoutScope 已经准备好的「图结构」交给 dagre 重新摆位。
 *
 * layoutScope 仍负责：范围/过滤、节点与边、ghost、图例、卡片高度；
 * 这里只替换 **坐标**（P1），旧的自写深度分列在 P5 再删。
 *
 * 约定：
 *  - 每张图独立布局，坐标从 (margin, margin) 起；
 *  - 多张图纵向堆叠：graph.top = 前面所有图高度之和，节点 y 加上 top；
 *  - bands 恒为 []，与 layoutScope 一致。
 */
import { layoutGraph, DEFAULT_LAYOUT_OPTIONS } from './engine.js'

const marginOf = (options) => {
  const value = Number(options && options.margin)
  return Number.isFinite(value) ? value : DEFAULT_LAYOUT_OPTIONS.margin
}

export function relayoutGraph(graph, options) {
  const source = graph && typeof graph === 'object' ? graph : {}
  const nodes = (Array.isArray(source.nodes) ? source.nodes : [])
    .filter((node) => node && node.id != null && node.ghost !== 'skip')
    .map((node) => ({ id: String(node.id), w: Math.max(1, Number(node.w) || 1), h: Math.max(1, Number(node.h) || 1) }))
  const edges = (Array.isArray(source.edges) ? source.edges : [])
    .filter((edge) => edge && edge.from != null && edge.to != null)
    .map((edge) => ({ from: String(edge.from), to: String(edge.to), kind: edge.kind }))
  if (!nodes.length) return { ...source, nodes: [], width: marginOf(options) * 2, height: marginOf(options) * 2, bands: [] }

  const laid = layoutGraph({ nodes, edges }, options)
  const nextNodes = (source.nodes || []).map((node) => {
    const pos = laid.positions[String(node.id)]
    return pos ? { ...node, x: pos.x, y: pos.y } : node
  })
  return { ...source, nodes: nextNodes, bands: [], width: laid.bounds.width, height: laid.bounds.height }
}

/** 整份 scope：逐图布局 + 重新纵向堆叠 + 汇总宽高。 */
export function relayoutScope(scope, options) {
  const source = scope && typeof scope === 'object' ? scope : {}
  const graphs = Array.isArray(source.graphs) ? source.graphs : []
  let top = 0
  let width = 0
  const nextGraphs = graphs.map((graph) => {
    const laid = relayoutGraph(graph, options)
    laid.top = top
    laid.height = Math.max(1, laid.height)
    laid.nodes = (laid.nodes || []).map((node) => ({ ...node, y: (Number(node.y) || 0) + top }))
    laid.edges = (laid.edges || []).map((edge) => ({ ...edge }))
    top += laid.height
    width = Math.max(width, laid.width)
    return laid
  })
  const nodes = []
  const edges = []
  for (const graph of nextGraphs) {
    nodes.push(...(graph.nodes || []))
    edges.push(...(graph.edges || []))
  }
  return { ...source, graphs: nextGraphs, nodes, edges, bands: [], width: Math.max(width, marginOf(options) * 2), height: top }
}

export default relayoutScope
