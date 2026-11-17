/**
 * 把 layoutScope 已经准备好的「图结构」交给 dagre 重新摆位。
 *
 * layoutScope 仍负责：范围/过滤、节点与边、ghost、图例、卡片高度；
 * 这里只替换 **坐标**，并把引擎给的路由点挂到边上（GraphView 直接画折线）。
 *
 * 约定：
 *  - 每张图独立布局，坐标从 (margin, margin) 起；
 *  - 多张图纵向堆叠：graph.top = 前面所有图高度之和，节点 y 加上 top；
 *  - 边的路由点也要加 top（与节点同一坐标系）；
 *  - bands 恒为 []，与 layoutScope 一致。
 */
import { layoutGraph, DEFAULT_LAYOUT_OPTIONS } from './engine.js'

const marginOf = (options) => {
  const value = Number(options && options.margin)
  return Number.isFinite(value) ? value : DEFAULT_LAYOUT_OPTIONS.margin
}

const routeKey = (edge) => String(edge && edge.from) + '\u0000' + String(edge && edge.to)

/** 网格里的阅读顺序：项目分色 → 优先级 → 任务号。传不了就给空串，引擎回退到 id。 */
const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 }
function orderOf(node) {
  const n = node && typeof node === 'object' ? node : {}
  const color = Number(n.colorRef)
  const priority = PRIORITY_RANK[String(n.priority)]
  const no = Number(n.no)
  const colorPart = isFinite(color) && color >= 0 ? String(color).padStart(2, '0') : '99'
  const priorityPart = priority == null ? '9' : String(priority)
  const noPart = isFinite(no) && no > 0 ? String(Math.round(no)).padStart(7, '0') : '9999999'
  return colorPart + '|' + priorityPart + '|' + noPart
}

export function relayoutGraph(graph, options) {
  const source = graph && typeof graph === 'object' ? graph : {}
  const nodes = (Array.isArray(source.nodes) ? source.nodes : [])
    .filter((node) => node && node.id != null && node.ghost !== 'skip')
    .map((node) => ({ id: String(node.id), w: Math.max(1, Number(node.w) || 1), h: Math.max(1, Number(node.h) || 1), order: orderOf(node) }))
  const edges = (Array.isArray(source.edges) ? source.edges : [])
    .filter((edge) => edge && edge.from != null && edge.to != null)
    .map((edge) => ({ from: String(edge.from), to: String(edge.to), kind: edge.kind }))
  if (!nodes.length) return { ...source, nodes: [], edges: [], width: marginOf(options) * 2, height: marginOf(options) * 2, bands: [] }

  const laid = layoutGraph({ nodes, edges }, options)
  const nextNodes = (source.nodes || []).map((node) => {
    const pos = laid.positions[String(node.id)]
    return pos ? { ...node, x: pos.x, y: pos.y } : node
  })
  const nextEdges = (source.edges || []).map((edge) => {
    const route = laid.routes && laid.routes[routeKey(edge)]
    return route ? { ...edge, route } : { ...edge, route: undefined }
  })
  return { ...source, nodes: nextNodes, edges: nextEdges, bands: [], width: laid.bounds.width, height: laid.bounds.height }
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
    laid.edges = (laid.edges || []).map((edge) => ({
      ...edge,
      route: Array.isArray(edge.route) ? edge.route.map((point) => ({ x: point.x, y: point.y + top })) : edge.route,
    }))
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
