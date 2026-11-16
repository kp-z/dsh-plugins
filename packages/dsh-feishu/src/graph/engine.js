/**
 * 关系图布局引擎：把「节点尺寸 + 边」交给 dagre 分层排版，输出每个节点的左上角坐标与画布边界。
 *
 * 纯函数：不碰 DOM、不读全局；同样输入永远同样输出（节点/边先按 id 排序）。
 * 旧的自写「深度分列」还在 overview/layout.js 里，P1 再把 GraphView 切过来，P5 删旧实现。
 */
/* 浏览器 ESM 只能解析相对路径：dagre + graphlib + lodash 已打成 src/vendor/dagre.js。 */
import { Graph, layout as dagreLayout } from '../vendor/dagre.js'

export const DEFAULT_LAYOUT_OPTIONS = {
  rankdir: 'LR',
  nodesep: 24,
  ranksep: 80,
  edgesep: 12,
  margin: 32,
  grid: 1,
  /* 一列最多放几个节点：超过就折成多根物理列（dagre 自己不折行）。0 = 不折。
     6 是「一屏能看全」的经验值：卡片约 105px 时一列 ~750px。 */
  maxRankRows: 5,
  /* 折列之间的横向间距 */
  columnGap: 40,
}

const asInt = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

/**
 * @param {object} input
 *   - nodes: [{ id, w, h }]
 *   - edges: [{ from, to, kind }]
 * @param {object} options DEFAULT_LAYOUT_OPTIONS 的子集
 * @returns {{ positions: Record<string,{x:number,y:number,w:number,h:number}>, bounds:{width:number,height:number}, order:string[] }}
 */
/**
 * 长列折行：dagre 会把同一 rank 的节点竖着排成一根很高的列，超过 maxRankRows 时
 * 把它拆成多根物理列（横向排开），后面的 rank 整体右移，避免画布被一根长条撑爆。
 *
 * 纯后处理：不动边的数据，只挪位置；节点矩形不重叠（列内按顺序、列间留 columnGap）。
 */
export function wrapRanks(positions, options) {
  const opts = Object.assign({}, DEFAULT_LAYOUT_OPTIONS, options || {})
  const maxRows = Math.max(0, asInt(opts.maxRankRows, 8))
  const columnGap = Math.max(0, asInt(opts.columnGap, 40))
  const grid = Math.max(1, asInt(opts.grid, 1))
  const ids = Object.keys(positions || {})
  if (!ids.length || !maxRows) return positions

  /* 按 x 聚成 rank（dagre 同一 rank 的 x 是同一个值）。 */
  const ranks = new Map()
  for (const id of ids) {
    const key = Math.round(positions[id].x)
    if (!ranks.has(key)) ranks.set(key, [])
    ranks.get(key).push(id)
  }
  const rankKeys = [...ranks.keys()].sort((a, b) => a - b)

  let shift = 0
  for (const key of rankKeys) {
    const members = ranks.get(key).slice().sort((a, b) => (positions[a].y - positions[b].y) || a.localeCompare(b))
    const chunks = []
    for (let i = 0; i < members.length; i += maxRows) chunks.push(members.slice(i, i + maxRows))
    const extraColumns = chunks.length - 1
    /* 折出来的每一列都从这一 rank 原来的顶边开始排，整张图才不会被撑高。 */
    const top = Math.min(...members.map((id) => positions[id].y))
    chunks.forEach((chunk, chunkIndex) => {
      let y = top
      chunk.forEach((id) => {
        positions[id] = {
          ...positions[id],
          x: Math.max(0, Math.round((key + shift + chunkIndex * (positions[id].w + columnGap)) / grid) * grid),
          y: Math.max(0, Math.round(y / grid) * grid),
        }
        y += positions[id].h + opts.nodesep
      })
    })
    shift += extraColumns * (positions[members[0]].w + columnGap)
  }
  return positions
}

/** 把每个 rank 的垂直中心对齐到所有 rank 的平均中心（折行后单节点 rank 会飘）。 */
export function centerRanks(positions) {
  const ranks = new Map()
  for (const id of Object.keys(positions || {})) {
    const key = Math.round(positions[id].x)
    if (!ranks.has(key)) ranks.set(key, [])
    ranks.get(key).push(id)
  }
  if (!ranks.size) return positions
  const rankCenter = (ids) => {
    const top = Math.min(...ids.map((id) => positions[id].y))
    const bottom = Math.max(...ids.map((id) => positions[id].y + positions[id].h))
    return (top + bottom) / 2
  }
  const centers = []
  for (const ids of ranks.values()) centers.push(rankCenter(ids))
  const target = centers.reduce((a, b) => a + b, 0) / centers.length
  for (const ids of ranks.values()) {
    const delta = target - rankCenter(ids)
    if (!delta) continue
    for (const id of ids) positions[id].y = Math.round(positions[id].y + delta)
  }
  return positions
}

export function layoutGraph(input, options) {
  const opts = Object.assign({}, DEFAULT_LAYOUT_OPTIONS, options || {})
  const grid = Math.max(1, asInt(opts.grid, 1))
  const margin = Math.max(0, asInt(opts.margin, 32))
  const rawNodes = Array.isArray(input && input.nodes) ? input.nodes : []
  const rawEdges = Array.isArray(input && input.edges) ? input.edges : []

  /* 去重 + 排序：dagre 的输入顺序会影响连线交叉，固定顺序才能保证「同样的数据排出来一样」。 */
  const byId = new Map()
  for (const node of rawNodes) {
    const id = String(node && node.id != null ? node.id : '')
    if (!id || byId.has(id)) continue
    byId.set(id, { id, w: Math.max(1, asInt(node.w, 300)), h: Math.max(1, asInt(node.h, 84)) })
  }
  const ids = [...byId.keys()].sort()
  if (!ids.length) return { positions: {}, bounds: { width: margin * 2, height: margin * 2 }, order: [] }

  const g = new Graph({ directed: true, multigraph: false, compound: false })
  g.setGraph({
    rankdir: String(opts.rankdir || 'LR').toUpperCase(),
    nodesep: asInt(opts.nodesep, 24),
    ranksep: asInt(opts.ranksep, 80),
    edgesep: asInt(opts.edgesep, 12),
    marginx: 0,
    marginy: 0,
    acyclicer: 'greedy',
    ranker: 'network-simplex',
  })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of ids) {
    const node = byId.get(id)
    g.setNode(id, { width: node.w, height: node.h })
  }

  const seenEdges = new Set()
  const edges = rawEdges
    .map((edge) => ({
      from: String(edge && edge.from != null ? edge.from : ''),
      to: String(edge && edge.to != null ? edge.to : ''),
      kind: String(edge && edge.kind != null ? edge.kind : ''),
    }))
    .filter((edge) => edge.from && edge.to && edge.from !== edge.to && byId.has(edge.from) && byId.has(edge.to))
    .sort((a, b) => (a.from + '\u0000' + a.to).localeCompare(b.from + '\u0000' + b.to))
  for (const edge of edges) {
    const key = edge.from + '\u0000' + edge.to
    if (seenEdges.has(key)) continue
    seenEdges.add(key)
    g.setEdge(edge.from, edge.to, { kind: edge.kind })
  }

  dagreLayout(g)

  const positions = {}
  for (const id of ids) {
    const node = byId.get(id)
    const laid = g.node(id) || { x: 0, y: 0 }
    const x = Math.max(0, Math.round((Number(laid.x) - node.w / 2 + margin) / grid) * grid)
    const y = Math.max(0, Math.round((Number(laid.y) - node.h / 2 + margin) / grid) * grid)
    positions[id] = { x, y, w: node.w, h: node.h }
  }
  wrapRanks(positions, opts)
  /* 折行后各 rank 的中心对齐：单节点 rank 不能还停在原来「长列中心」的高度，
     否则「1 个父 + 20 个子」的图里父节点会被放到整张图的最下面。 */
  centerRanks(positions)
  /* 折行后整体回正：最小 x/y 拉到 margin，避免整块图偏到画布外面。 */
  let minX = Infinity
  let minY = Infinity
  for (const id of ids) {
    minX = Math.min(minX, positions[id].x)
    minY = Math.min(minY, positions[id].y)
  }
  const offsetX = margin - minX
  const offsetY = margin - minY
  let maxX = 0
  let maxY = 0
  for (const id of ids) {
    positions[id].x += offsetX
    positions[id].y += offsetY
    maxX = Math.max(maxX, positions[id].x + positions[id].w)
    maxY = Math.max(maxY, positions[id].y + positions[id].h)
  }

  return {
    positions,
    bounds: { width: maxX + margin, height: maxY + margin },
    order: ids,
  }
}

export default layoutGraph
