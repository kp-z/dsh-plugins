/**
 * 关系图布局引擎：把「节点尺寸 + 边」交给 dagre 分层排版，输出每个节点的左上角坐标与画布边界。
 *
 * 纯函数：不碰 DOM、不读全局；同样输入永远同样输出（节点/边先按 id 排序）。
 *
 * task-18（关系页重构）：dagre 只负责**一个连通分量内部**的分层。整张图由若干块拼成：
 *  - 有依赖/来源边的任务按 dagre 从左到右排（T 头 → 后继）；
 *  - 没有关系的孤立任务收进一个网格块（不再被 dagre 当成一列 40 行竖条）；
 *  - 所有块按「高度优先」的 shelf 算法紧凑打包到 maxWidth 以内。
 * 这样「1 条链 + 11 个孤立任务」不再摊成对角散点，而是一块链 + 一块整齐的卡片网格。
 * 边同时返回 dagre 的路由点（routes），画布上可以直接画折线，不必自己猜拐点。
 */
/* 浏览器 ESM 只能解析相对路径：dagre + graphlib + lodash 已打成 src/vendor/dagre.js。 */
import { Graph, layout as dagreLayout } from '../vendor/dagre.js'

export const DEFAULT_LAYOUT_OPTIONS = {
  rankdir: 'LR',
  nodesep: 24,
  ranksep: 80,
  edgesep: 12,
  /* 画布内边距：3 列卡片 + 2 个 16px 间距 + 两侧 24px = 1340，正好放进 1388 宽的关系卡。 */
  margin: 24,
  grid: 1,
  /* 一列最多放几个节点：超过就折成多根物理列（dagre 自己不折行）。0 = 不折。
     6 是「一屏能看全」的经验值：卡片约 105px 时一列 ~750px。 */
  maxRankRows: 5,
  /* 折列之间的横向间距 */
  columnGap: 40,
  /* 整张图的目标最大宽度：块在这里面换行，太宽的图会横向滚动而不是缩到看不清。 */
  maxWidth: 1360,
  /* 两个块之间的间距 */
  componentGap: 32,
  /* 孤立卡片网格：列数上限与间距 */
  isolateCols: 3,
  isolateGapX: 16,
  isolateGapY: 16,
}

/** 参与「连通分量」与「分层方向」的边：时间先后不阻塞、也不该决定左右顺序。 */
const STRUCTURAL_KINDS = new Set(['depends_on', 'derived_from'])

const asInt = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

const edgeKeyOf = (from, to) => String(from) + '\u0000' + String(to)
const pairKeyOf = (edge) => edgeKeyOf(edge.from, edge.to)
const structural = (edge) => STRUCTURAL_KINDS.has(String(edge.kind || ''))

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

/** 一个 rank 里的节点数超过 maxRankRows 时才需要折行（折行会重排 y，边的路由点随之失效）。 */
function needsWrap(positions, options) {
  const maxRows = Math.max(0, asInt(options.maxRankRows, DEFAULT_LAYOUT_OPTIONS.maxRankRows))
  if (!maxRows) return false
  const counts = new Map()
  for (const id of Object.keys(positions)) {
    const key = Math.round(positions[id].x)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  for (const count of counts.values()) if (count > maxRows) return true
  return false
}

/** 归一化：去重（同 id 先到先得）、边只保留两端都存在且不是自环的。 */
function normalizeInput(input) {
  const rawNodes = Array.isArray(input && input.nodes) ? input.nodes : []
  const rawEdges = Array.isArray(input && input.edges) ? input.edges : []
  const byId = new Map()
  for (const node of rawNodes) {
    const id = String(node && node.id != null ? node.id : '')
    if (!id || byId.has(id)) continue
    byId.set(id, {
      id,
      w: Math.max(1, asInt(node.w, 300)),
      h: Math.max(1, asInt(node.h, 84)),
      /* 网格里的阅读顺序（项目 → 优先级 → 编号）；没给就按 id 兜底。 */
      order: String(node.order == null ? '' : node.order),
    })
  }
  const ids = [...byId.keys()].sort()
  const seen = new Set()
  const edges = []
  for (const edge of rawEdges) {
    const from = String(edge && edge.from != null ? edge.from : '')
    const to = String(edge && edge.to != null ? edge.to : '')
    const kind = String(edge && edge.kind != null ? edge.kind : '')
    if (!from || !to || from === to || !byId.has(from) || !byId.has(to)) continue
    const key = pairKeyOf({ from, to })
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ from, to, kind })
  }
  edges.sort((a, b) => (a.from + '\u0000' + a.to + '\u0000' + a.kind).localeCompare(b.from + '\u0000' + b.to + '\u0000' + b.kind))
  return { byId, ids, edges }
}

/** 无向连通分量（按所有边连起来：时间先后也让两条任务待在同一个块里）。 */
function componentsOf(ids, edges) {
  const parent = new Map(ids.map((id) => [id, id]))
  const find = (value) => {
    let cur = value
    while (parent.get(cur) !== cur) {
      parent.set(cur, parent.get(parent.get(cur)))
      cur = parent.get(cur)
    }
    return cur
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const edge of edges) union(edge.from, edge.to)
  const groups = new Map()
  for (const id of ids) {
    const root = find(id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(id)
  }
  return [...groups.values()].map((members) => members.sort()).sort((a, b) => a[0].localeCompare(b[0]))
}

/** 跑一次 dagre（LR 或 TB 二选一），返回归一化后的坐标与边走线。 */
function runDagre(ordered, layoutEdges, byId, rankdir, opts) {
  const g = new Graph({ directed: true, multigraph: false, compound: false })
  g.setGraph({
    rankdir,
    nodesep: asInt(opts.nodesep, 24),
    ranksep: asInt(opts.ranksep, 80),
    edgesep: asInt(opts.edgesep, 12),
    marginx: 0,
    marginy: 0,
    acyclicer: 'greedy',
    ranker: 'network-simplex',
  })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of ordered) {
    const node = byId.get(id)
    g.setNode(id, { width: node.w, height: node.h })
  }
  for (const edge of layoutEdges) {
    if (g.hasEdge(edge.from, edge.to)) continue
    g.setEdge(edge.from, edge.to, {})
  }

  dagreLayout(g)

  const positions = {}
  let minX = Infinity
  let minY = Infinity
  for (const id of ordered) {
    const node = byId.get(id)
    const laid = g.node(id) || { x: 0, y: 0 }
    const x = Number(laid.x) - node.w / 2
    const y = Number(laid.y) - node.h / 2
    positions[id] = { x, y, w: node.w, h: node.h }
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
  }

  /* 折列只对 LR 有意义（TB 的「同一 rank」是横向一排，不能按 x 分列）。 */
  const wrapped = rankdir === 'LR' && needsWrap(positions, opts)
  if (wrapped) {
    wrapRanks(positions, opts)
    centerRanks(positions)
  }

  /* 折行后所有 y 都重排过：dagre 给的路由点已经不可信，宁可不给，让画布用几何兜底。 */
  const routes = {}
  if (!wrapped) {
    for (const edge of layoutEdges) {
      if (routes[pairKeyOf(edge)]) continue
      const label = g.edge(edge.from, edge.to)
      if (!label || !Array.isArray(label.points) || !label.points.length) continue
      /* dagre 的 points 与节点矩形同一坐标系（左上角 = 中心 - 尺寸/2），减去归一化偏移即可。 */
      routes[pairKeyOf(edge)] = label.points.map((p) => ({ x: Number(p.x) - minX, y: Number(p.y) - minY }))
    }
  }

  let maxX = 0
  let maxY = 0
  for (const id of ordered) {
    const p = positions[id]
    p.x -= minX
    p.y -= minY
    maxX = Math.max(maxX, p.x + p.w)
    maxY = Math.max(maxY, p.y + p.h)
  }
  return { positions, routes, width: maxX, height: maxY }
}

/** 一个多节点分量：dagre 分层 + 必要时折行；窄面板里把横链改成竖排，避免整体缩到看不清。 */
function layoutComponent(members, edges, byId, options) {
  const opts = Object.assign({}, DEFAULT_LAYOUT_OPTIONS, options || {})
  const memberSet = new Set(members)
  /* 同一个 rank 里的初始顺序也按「项目 → 优先级 → 编号」给 dagre，扇出时 P0 会排在左边。 */
  const orderKey = (id) => { const node = byId.get(id); return node && node.order ? node.order : '' }
  const ordered = members.slice().sort((a, b) => orderKey(a).localeCompare(orderKey(b)) || a.localeCompare(b))
  const inside = edges.filter((edge) => memberSet.has(edge.from) && memberSet.has(edge.to))
  const structuralEdges = inside.filter(structural)
  /* 只有时间边的分量也按时间链排（否则它们会被摊成一个网格，9 条时间线全变成乱麻）。 */
  const layoutEdges = structuralEdges.length ? structuralEdges : inside
  if (!layoutEdges.length) return gridBlock(members, byId, opts)

  const primaryDir = String(opts.rankdir || 'LR').toUpperCase() === 'TB' ? 'TB' : 'LR'
  let laid = runDagre(ordered, layoutEdges, byId, primaryDir, opts)
  /* 窄面板兜底：横向依赖链放不下时改竖排。宽面板不再切换——卡片已经移出 foreignObject，
     由 stage 整体缩放也不会改变卡片排版，横向排不下可以安全缩到容器宽度。 */
  if (primaryDir === 'LR' && asInt(opts.maxWidth, 1400) < 760 && laid.width > asInt(opts.maxWidth, 1400)) {
    const vertical = runDagre(ordered, layoutEdges, byId, 'TB', opts)
    if (vertical.width <= asInt(opts.maxWidth, 1400) && vertical.width < laid.width) laid = vertical
  }
  return { ...laid, firstId: ordered[0] || members[0], kind: 'component' }
}

/** 孤立卡片：排成网格（最多 isolateCols 列），不再让 dagre 排成一根竖条。 */
function gridBlock(members, byId, options) {
  const opts = Object.assign({}, DEFAULT_LAYOUT_OPTIONS, options || {})
  const keyOf = (id) => byId.get(id).order || ''
  const sorted = members.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b)) || a.localeCompare(b))
  const gapX = Math.max(0, asInt(opts.isolateGapX, 32))
  const gapY = Math.max(0, asInt(opts.isolateGapY, 16))
  const maxWidth = Math.max(1, asInt(opts.maxWidth, 1400))
  let widest = 0
  for (const id of sorted) widest = Math.max(widest, byId.get(id).w)
  const fitCols = Math.max(1, Math.floor((maxWidth + gapX) / (widest + gapX)) || 1)
  const cols = Math.max(1, Math.min(asInt(opts.isolateCols, 3) || 3, sorted.length, fitCols))
  const positions = {}
  let x = 0
  let y = 0
  let rowH = 0
  let maxX = 0
  sorted.forEach((id, index) => {
    const node = byId.get(id)
    if (index > 0 && index % cols === 0) {
      y += rowH + gapY
      x = 0
      rowH = 0
    }
    positions[id] = { x, y, w: node.w, h: node.h }
    maxX = Math.max(maxX, x + node.w)
    rowH = Math.max(rowH, node.h)
    x += node.w + gapX
  })
  return { positions, routes: {}, width: maxX, height: y + rowH, firstId: sorted[0], kind: 'singles' }
}

/** 把块按高度从大到小塞进 maxWidth 的 shelf：先铺高的，再把矮的补到下一行。 */
function packBlocks(blocks, options) {
  const opts = Object.assign({}, DEFAULT_LAYOUT_OPTIONS, options || {})
  const gap = Math.max(0, asInt(opts.componentGap, 40))
  const target = Math.max(1, asInt(opts.maxWidth, 1400))
  /* 有关系的块先放（它们是这张图真正的信息），孤立卡片网格放最后。 */
  const rank = (block) => (block.kind === 'singles' ? 1 : 0)
  const sorted = blocks.slice().sort((a, b) => (rank(a) - rank(b)) || (b.height - a.height) || (b.width - a.width) || String(a.firstId).localeCompare(String(b.firstId)))
  let x = 0
  let y = 0
  let rowH = 0
  let usedW = 0
  for (const block of sorted) {
    if (x > 0 && x + block.width > target) {
      x = 0
      y += rowH + gap
      rowH = 0
    }
    block.x = x
    block.y = y
    x += block.width + gap
    rowH = Math.max(rowH, block.height)
    usedW = Math.max(usedW, x - gap)
  }
  return { blocks: sorted, width: usedW, height: sorted.length ? y + rowH : 0 }
}

export function layoutGraph(input, options) {
  const opts = Object.assign({}, DEFAULT_LAYOUT_OPTIONS, options || {})
  const { byId, ids, edges } = normalizeInput(input)
  const margin = Math.max(0, asInt(opts.margin, 32))
  const grid = Math.max(1, asInt(opts.grid, 1))
  if (!ids.length) return { positions: {}, routes: {}, bounds: { width: margin * 2, height: margin * 2 }, order: [] }

  const components = componentsOf(ids, edges)
  const singles = []
  const blocks = []
  for (const members of components) {
    if (members.length === 1) { singles.push(members[0]); continue }
    blocks.push(layoutComponent(members, edges, byId, opts))
  }
  /* 孤立卡片网格至少可以用到「最宽的那个关系块」的宽度：
     依赖链已经把画布撑到 900+ 时，孤立任务没必要还挤在一列里，
     用两列正好落在同一宽度内，画布不会更宽、高度却减半。 */
  if (singles.length) {
    const widestComponent = blocks.reduce((max, block) => Math.max(max, block.width || 0), 0)
    blocks.push(gridBlock(singles, byId, { ...opts, maxWidth: Math.max(opts.maxWidth || 0, widestComponent) }))
  }

  const packed = packBlocks(blocks, opts)
  const round = (value) => Math.max(0, Math.round(value / grid) * grid)
  const positions = {}
  const routes = {}
  for (const block of packed.blocks) {
    const offsetX = margin + block.x
    const offsetY = margin + block.y
    for (const id of Object.keys(block.positions)) {
      const p = block.positions[id]
      positions[id] = { x: round(offsetX + p.x), y: round(offsetY + p.y), w: p.w, h: p.h }
    }
    for (const key of Object.keys(block.routes || {})) {
      routes[key] = block.routes[key].map((p) => ({ x: round(offsetX + p.x), y: round(offsetY + p.y) }))
    }
  }

  return {
    positions,
    routes,
    bounds: { width: packed.width + margin * 2, height: packed.height + margin * 2 },
    order: ids,
  }
}

export default layoutGraph
