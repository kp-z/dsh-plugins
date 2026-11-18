/**
 * 主视图：关系图（一个自定义目录 = 恰好一张图、一套坐标系）—— 工厂组件，模块顶层不 import react。
 *
 * 一张画布（task-13 起；task-18 重构紧凑布局）：
 * - 一个目录 = 一张画布：该目录里**筛选后可见**的任务一次性布局；
 * - 布局 = 连通分量（有关系的任务按 dagre 从左到右分层）+ 孤立任务网格 + 按 maxWidth 紧凑打包；
 *   不再把孤立任务交给 dagre 排成一根竖条，也不会因为筛掉某些任务而在网格里留洞；
 * - 项目身份靠**节点分色**（--fo-deco-N）+ **图头图例**；跨项目的边在同一坐标系里天然直连；
 * - 实线箭头 = depends_on，虚线 = derived_from，点线 = temporal（时间先后，不阻塞）；端点在图外的补 ghost 节点（虚线框，不可点选）；
 * - 边优先走 dagre 给的路由点（绕开卡片、从 rank 间隙穿过），同一对任务的多条边互相错开 6px；
 * - 节点可点、可 Tab、可 Enter/Space，选中项与它相连的边一起高亮；
 * - 多图默认全部展开、画布高度随内容；普通滚轮滚页面，Ctrl/⌘ + 滚轮才是缩放。
 *
 * task-15：
 * - 节点换成参考项目 WorkflowEditor 的 **workflow 式三段卡片**（左动作列 | 中信息 | 右状态）；
 * - **拖动**：pointerdown 跟手、松手吸附 40px 网格，位置按「图 key + 任务 id」交给宿主的 nodePos；
 * - **聚焦**：聚焦的节点是主角，同图其余节点降透明度；点空白 / Esc 取消；
 * - **跳会话**：动作列第一个按钮 = host.openSession（不可用时 disabled + title 说明原因）。
 *
 * props：
 *   graphs        layoutScope(...).graphs（每张图自带 nodes/edges/legend/width/height/top）
 *   selectedId    当前选中的任务 id（高亮相连边、给卡片描边）
 *   focusedId     当前聚焦的任务 id（同图其余节点降透明度）
 *   nodePos       { 图 key: { 任务 id: {x,y} } } 本地拖动位置（宿主从 store 读写）
 *   onOpenTask(id) onFocusTask(id) onNodeMove(graphKey,id,pos) onResetLayout(graphKey) onBlur()
 *   hostReady / hostReason / onOpenSession(sessionId, title)
 */

import { cardGeometry, describeNode, edgePath, snapToGrid } from '../overview/layout.js'
/* 过滤后**再**布局：隐藏的已完成任务不能在画布上留下空位（否则网格里全是洞）。 */
import { relayoutGraph } from '../graph/relayout.js'
import { ensureTaskCardStyles } from '../card/taskCardStyles.js'
import { sideCardIcon, sideCardLabel, sideCardCount } from './cardParts.js'
import { buildGraphCardDom, graphCardHandlers, graphCardSignature } from '../card/graphCardDom.js'
import { decoVar } from './styles.js'

/* 关系画布把共享卡片直接挂进 foreignObject：卡片样式只注入一次（宿主页 / 独立页共用）。 */
if (typeof document !== 'undefined') ensureTaskCardStyles(document)

/* ============ 画布视口（缩放 / 平移）============
   纯函数放在模块顶层：组件只管把指针事件换算成「用户坐标」再丢进来，
   这样几何（尤其是「以光标为锚点缩放」）可以离线单测，不依赖 DOM。 */

export const IDENTITY_VIEW = Object.freeze({ k: 1, x: 0, y: 0 })
export const VIEW_ZOOM_MIN = 0.35
export const VIEW_ZOOM_MAX = 2.6

/** 缩放钳制：太小看不清线、太大只剩一个节点，都没有意义。 */
export function clampZoom(value) {
  const k = Number(value)
  if (!isFinite(k) || k <= 0) return 1
  return Math.min(VIEW_ZOOM_MAX, Math.max(VIEW_ZOOM_MIN, k))
}

/** 视口值归一：坏值一律退回恒等视口（不做半截缩放）。 */
export function normalizeView(raw) {
  if (!raw || typeof raw !== 'object') return IDENTITY_VIEW
  const k = Number(raw.k)
  const x = Number(raw.x)
  const y = Number(raw.y)
  if (!isFinite(k) || !isFinite(x) || !isFinite(y) || k <= 0) return IDENTITY_VIEW
  return { k: clampZoom(k), x, y }
}

/** 某个图的当前视口。 */
export function viewOf(views, key) {
  return normalizeView(views && typeof views === 'object' ? views[key] : null)
}

/**
 * 以 anchor（**视口坐标**，即 viewBox 里的位置）为锚点缩放。
 * 推导：user = content * k + t；要让 anchor 在缩放前后落在同一处，
 * 就得 t' = anchor - (anchor - t) * k'/k。
 */
export function zoomView(view, factor, anchor) {
  const cur = normalizeView(view)
  const nextK = clampZoom(cur.k * (Number(factor) || 1))
  const a = anchor && isFinite(Number(anchor.x)) && isFinite(Number(anchor.y)) ? anchor : { x: 0, y: 0 }
  const ratio = nextK / cur.k
  return { k: nextK, x: a.x - (a.x - cur.x) * ratio, y: a.y - (a.y - cur.y) * ratio }
}

/** 平移：dx/dy 是**视口坐标**下的位移（调用方负责把屏幕像素除以缩放比）。 */
export function panView(view, dx, dy) {
  const cur = normalizeView(view)
  const nx = Number(dx)
  const ny = Number(dy)
  if (!isFinite(nx) || !isFinite(ny)) return cur
  return { k: cur.k, x: cur.x + nx, y: cur.y + ny }
}

/** 让某个内容坐标点落在视口中心（聚焦时用）。 */
export function centerOn(view, point, box) {
  const cur = normalizeView(view)
  const b = box && typeof box === 'object' ? box : {}
  const width = Number(b.width) || 0
  const height = Number(b.height) || 0
  const top = Number(b.top) || 0
  const cx = Number(point && point.x)
  const cy = Number(point && point.y)
  if (!isFinite(cx) || !isFinite(cy) || !width || !height) return cur
  return { k: cur.k, x: width / 2 - cx * cur.k, y: top + height / 2 - cy * cur.k }
}

/** SVG 上的 transform：先缩放再平移（与上面所有公式同一口径）。 */
export function viewportTransform(view) {
  const v = normalizeView(view)
  if (v.k === 1 && v.x === 0 && v.y === 0) return undefined
  return `translate(${round(v.x)} ${round(v.y)}) scale(${round(v.k, 4)})`
}

const round = (value, digits = 2) => {
  const n = Number(value)
  if (!isFinite(n)) return 0
  const p = 10 ** digits
  return Math.round(n * p) / p
}

function safeId(value) {
  return String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, '_')
}

/** band / node 的分色：色槽来自 styles.js 的 --fo-deco-N（宿主令牌派生），组件不写死颜色。 */
function decoStyle(colorRef) {
  if (colorRef == null || !(Number(colorRef) >= 0)) return undefined
  return { '--fo-c': decoVar(colorRef) }
}

const ZOOM_STEP = 1.25
const DAY_MS = 86_400_000
/** 每张图的默认筛选：进行中/阻塞/挂起显示，已完成默认不显示；**时间范围默认全部**。
 *  时间和完成状态是两个独立条件：时间按任务开始时间过滤，不区分是否完成。 */
export const DEFAULT_FILTER = { open: true, blocked: true, suspended: true, done: false, days: 0 }
export const FILTER_RANGES = [
  { days: 7, label: '最近一周' },
  { days: 30, label: '最近一月' },
  { days: 0, label: '全部' },
]
export const FILTER_STATUSES = [
  ['open', '进行中'],
  ['blocked', '阻塞'],
  ['suspended', '挂起'],
  ['done', '已完成'],
]

/** 边类型 / 来源的中文说法（悬停提示与图例共用一套词）。 */
export const EDGE_KIND_LABEL = { depends_on: '前置（必须等它完成）', derived_from: '来源（由它派生）', temporal: '时间先后（不阻塞）' }
export const EDGE_SOURCE_LABEL = { manual: '手动', ai: 'AI 整理', creation: '创建时记录', time: '按时间排序', feishu: '飞书原生依赖' }

/** 画布工具条的三个线性图标（20px viewBox，14px 呈现），文字退到 title/aria-label。 */
export function fitIcon(h) {
  return h('svg', { className: 'fo-btn-icon', width: 14, height: 14, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('path', { d: 'M3 7V3h4M17 13v4h-4M3 3l5 5M17 17l-5-5' }))
}
export function resetIcon(h) {
  return h('svg', { className: 'fo-btn-icon', width: 14, height: 14, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('path', { d: 'M4 10a6 6 0 1 0 2-4.5' }),
    h('path', { d: 'M4.4 3v3.2h3.2' }))
}
export function closeIcon(h) {
  return h('svg', { className: 'fo-btn-icon', width: 14, height: 14, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('path', { d: 'M5 5l10 10M15 5L5 15' }))
}

const num = (value, fallback) => {
  const n = Number(value)
  return isFinite(n) ? n : fallback
}

/** 时间筛选用的「任务时间」：开始时间 → 创建时间；都没有就返回 0（不参与过滤）。 */
export function taskTimeOf(task) {
  const t = task && typeof task === 'object' ? task : {}
  return Number(t.startedAt) || Number(t.createdAt) || Number(t.startAt) || 0
}

/**
 * 时间范围是否命中**任意状态**的任务。
 * days <= 0 = 全部；任务没有时间戳时保留（宁可多显示，不误藏）；未来时间也保留。
 */
export function inDateRange(task, days, now) {
  const span = Number(days)
  if (!(span > 0)) return true
  const at = taskTimeOf(task)
  if (!(at > 0)) return true
  const end = Number(now) || Date.now()
  return at >= end - span * DAY_MS
}

/**
 * dagre 的路由点 → 圆角折线。
 * 引擎给的是「沿 rank 间隙走」的折点，直接连会全是 90° 硬角；这里每个内点切一个小圆角，
 * 既保留「绕开卡片」的走位，又不会有毛刺感。纯函数，方便单测。
 */
export function routePath(points, radius = 12) {
  const list = (Array.isArray(points) ? points : [])
    .filter((point) => point && isFinite(Number(point.x)) && isFinite(Number(point.y)))
    .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
  if (list.length < 2) return ''
  const at = (point) => `${round(point.x)} ${round(point.y)}`
  if (list.length === 2) return `M${at(list[0])} L${at(list[1])}`
  let d = `M${at(list[0])}`
  for (let i = 1; i < list.length - 1; i += 1) {
    const prev = list[i - 1]
    const cur = list[i]
    const next = list[i + 1]
    const v1 = { x: cur.x - prev.x, y: cur.y - prev.y }
    const v2 = { x: next.x - cur.x, y: next.y - cur.y }
    const l1 = Math.hypot(v1.x, v1.y)
    const l2 = Math.hypot(v2.x, v2.y)
    if (!l1 || !l2) { d += ` L${at(cur)}`; continue }
    const r1 = Math.min(radius, l1 / 2)
    const r2 = Math.min(radius, l2 / 2)
    const before = { x: cur.x - (v1.x / l1) * r1, y: cur.y - (v1.y / l1) * r1 }
    const after = { x: cur.x + (v2.x / l2) * r2, y: cur.y + (v2.y / l2) * r2 }
    d += ` L${at(before)} Q${at(cur)} ${at(after)}`
  }
  d += ` L${at(list[list.length - 1])}`
  return d
}

/**
 * 平行边错开：同一对任务之间可能同时有 depends_on 与 temporal。
 * 以整体方向的法线为偏移轴，两条线不再完全重合（偏移量 6px，箭头也一起移）。
 */
export function offsetRoute(points, shift = 0) {
  const list = Array.isArray(points) ? points : []
  const amount = Number(shift) || 0
  if (!amount || list.length < 2) return list
  const first = list[0]
  const last = list[list.length - 1]
  const dx = Number(last.x) - Number(first.x)
  const dy = Number(last.y) - Number(first.y)
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  return list.map((point) => ({ x: Number(point.x) + nx * amount, y: Number(point.y) + ny * amount }))
}

/** 动作按钮的图标（14px 口径：12×12 线稿，stroke 走 currentColor 之外的 CSS 变量）。 */
const ACTION_ICONS = {
  open: 'M3 7 L7.4 2.6 M4 2.6 H7.4 V6',
  focus: 'M6 2.4 v1.6 M6 8 v1.6 M2.4 6 h1.6 M8 6 h1.6 M6 4.4 a1.6 1.6 0 1 0 0 3.2 a1.6 1.6 0 1 0 0 -3.2',
}

export function createGraphView(deps) {
  const { h, React } = deps || {}
  const { useCallback, useEffect, useMemo, useRef, useState } = React

  return function GraphView(props) {
    const {
      graphs, selectedId = '', focusedId = '', nodePos, onOpenTask, onFocusTask, onOrganize,
      onNodeMove, onResetLayout, onBlur, hostReady, hostReason, onOpenSession,
      /* 接受建议命中已完成任务时，面板会临时（3 秒）亮出这批 id —— 优先于本地筛选 */
      revealIds,
      taskById,
    } = props || {}
    const [views, setViews] = useState({})
    const list = Array.isArray(graphs) ? graphs : []
    const graphsRef = useRef(null)
    /* 画布实宽：窄面板里要减少网格列数并把超宽的依赖链整体缩小，不能让人横向滚着找节点。 */
    const [stageWidth, setStageWidth] = useState(0)
    const layoutWidth = stageWidth > 0 ? Math.max(400, stageWidth - 96) : 1360
    const [drag, setDrag] = useState(null)
    /* 每张图各自的筛选条件 + 筛选面板开合（键都是 graph.key） */
    const [filters, setFilters] = useState({})
    const [filterOpen, setFilterOpen] = useState({})
    const patchFilter = (key, patch) => setFilters((prev) => ({ ...prev, [key]: { ...DEFAULT_FILTER, ...(prev[key] || {}), ...patch } }))

    /* 先筛可见节点，再布局：隐藏的已完成任务不能在画布上留下空洞。
       每张图的筛选是本地状态，所以这一步必须在 GraphView 内完成（relayoutGraph 只重算坐标与路由）。 */
    const viewGraphs = useMemo(() => list.map((graph) => {
      const filter = { ...DEFAULT_FILTER, ...(filters[graph.key] || {}) }
      const keepNode = (node) => {
        if (!node || node.ghost === true) return true
        const state = node.state || 'open'
        /* 临时展开的已完成节点优先级最高：即使它的开始时间很早，也必须亮出来。 */
        if (state === 'done' && Array.isArray(revealIds) && revealIds.indexOf(node.id) >= 0) return true
        /* 时间范围作用于**全部状态**：按任务开始时间（没有则创建时间）过滤，和是否完成无关。 */
        if (!inDateRange(taskById && taskById[node.id], filter.days)) return false
        if (state === 'suspended') return filter.suspended !== false
        if (state === 'blocked') return filter.blocked !== false
        /* 是否完成只认「已完成」这个状态筛选项，不再被全局偏好偷偷覆盖。 */
        if (state === 'done') return filter.done === true
        return filter.open !== false
      }
      const allNodes = Array.isArray(graph.nodes) ? graph.nodes : []
      const nodes = allNodes.filter(keepNode)
      const visibleIds = new Set(nodes.map((node) => node.id))
      /* 边两端都必须在画面上，否则隐藏了卡片却把线头留在原地 */
      const edges = (Array.isArray(graph.edges) ? graph.edges : [])
        .filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
      const laid = nodes.length
        ? relayoutGraph({ ...graph, top: 0, nodes, edges }, { maxWidth: layoutWidth })
        : { ...graph, top: 0, nodes: [], edges: [], width: Math.max(1, graph.width), height: Math.max(1, graph.height) }
      return { graph: { ...laid, top: 0 }, raw: graph, allNodes, nodes: laid.nodes || [], edges: laid.edges || [] }
    }), [list, filters, revealIds, taskById, layoutWidth])

    /* 切范围时回到列表顶部：从「全部」滚到很下面再点某个目录，如果沿用旧的 scrollTop，
       新画布会停在不可见的位置（用户看到一片空白）。筛选变化不重置滚动，避免刚看完的图被弹回顶部。 */
    const graphKeys = list.map((graph) => graph.key).join('|')
    useEffect(() => {
      const el = graphsRef.current
      if (el && Number(el.scrollTop) !== 0) el.scrollTop = 0
    }, [graphKeys])

    /* 筛选浮层：点画布/别处或按 Esc 关闭，避免它一直盖住刚筛出来的节点。 */
    useEffect(() => {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
      const anyOpen = Object.keys(filterOpen).some((key) => filterOpen[key] === true)
      if (!anyOpen) return undefined
      const onPointerDown = (event) => {
        const target = event && event.target
        if (target && typeof target.closest === 'function' && target.closest('.fo-filter-wrap')) return
        setFilterOpen({})
      }
      const onKeyDown = (event) => { if (event && event.key === 'Escape') setFilterOpen({}) }
      document.addEventListener('pointerdown', onPointerDown)
      document.addEventListener('keydown', onKeyDown)
      return () => {
        document.removeEventListener('pointerdown', onPointerDown)
        document.removeEventListener('keydown', onKeyDown)
      }
    }, [filterOpen])

    /* 监听画布列表宽度：窄面板自动减少网格列数，超宽的依赖链再按容器宽度整体缩放。 */
    useEffect(() => {
      const el = graphsRef.current
      if (!el) return undefined
      const apply = () => {
        const width = Math.round(Number(el.clientWidth) || 0)
        setStageWidth((prev) => (prev === width ? prev : width))
      }
      apply()
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(apply)
        observer.observe(el)
        return () => observer.disconnect()
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('resize', apply)
        return () => window.removeEventListener('resize', apply)
      }
      return undefined
    }, [])
    /* 拖动过就不算点击：pointerup 之后浏览器还会补一个 click，用它把选中/详情挡掉。 */
    const dragMoved = useRef(false)
    const svgRefs = useRef({})
    const nodeRefs = useRef({})
    const canvasRefs = useRef({})
    /* 平移：空画布上按下左键拖动；超过 3px 才算拖动，避免和「点空白取消聚焦」打架。 */
    const [pan, setPan] = useState(null)
    const panMoved = useRef(false)
    /* 事件处理器里要读最新视口/回调，但不能每次 setState 都重新绑事件。 */
    const viewsRef = useRef(views)
    viewsRef.current = views

    const posOf = useCallback((graphKey, node) => {
      const bag = nodePos && typeof nodePos === 'object' ? nodePos[graphKey] : null
      const hit = bag && typeof bag === 'object' ? bag[node.id] : null
      if (!hit || !isFinite(Number(hit.x)) || !isFinite(Number(hit.y))) return { x: node.x, y: node.y }
      return { x: Number(hit.x), y: Number(hit.y) }
    }, [nodePos])

    /* 视图缩放：viewBox 是 layout 坐标系，元素是 CSS 尺寸，跟随指针要除以这个比例。
       画布自身的放大（视口 k）也要算进去：放大 2 倍时同样 10px 只该走一半的内容距离。 */
    const scaleOf = useCallback((graph) => {
      const k = viewOf(viewsRef.current, graph.key).k
      const el = svgRefs.current[graph.key]
      if (!el || typeof el.getBoundingClientRect !== 'function') return k
      let rect = null
      try { rect = el.getBoundingClientRect() } catch (error) { rect = null }
      if (!rect || !rect.width || !rect.height || !graph.width || !graph.height) return k
      const scale = Math.min(rect.width / graph.width, rect.height / graph.height)
      return isFinite(scale) && scale > 0 ? scale * k : k
    }, [])

    /* 屏幕坐标 → viewBox 坐标。preserveAspectRatio="xMidYMid meet" 会留边，
       所以要把「居中留边」也扣掉，否则滚轮缩放的锚点会偏。 */
    const userPointOf = useCallback((graph, el, clientX, clientY) => {
      const left = num(clientX, 0)
      const top = num(clientY, 0)
      if (!el || typeof el.getBoundingClientRect !== 'function') return null
      let rect = null
      try { rect = el.getBoundingClientRect() } catch (error) { return null }
      if (!rect || !rect.width || !rect.height || !graph.width || !graph.height) return null
      const scale = Math.min(rect.width / graph.width, rect.height / graph.height)
      if (!(scale > 0)) return null
      const offsetX = (rect.width - graph.width * scale) / 2
      const offsetY = (rect.height - graph.height * scale) / 2
      return {
        x: (left - rect.left - offsetX) / scale,
        y: (top - rect.top - offsetY) / scale + (Number(graph.top) || 0),
      }
    }, [])

    /* 视口状态就放在这里：缩放/平移/聚焦都在本组件内闭环，卡片也由它渲染
       （GraphFeature 只负责把 ctx 透传进来）。 */
    const setView = useCallback((graphKey, next) => {
      const key = String(graphKey || '')
      if (!key) return
      setViews((prev) => ({ ...(prev && typeof prev === 'object' ? prev : {}), [key]: next }))
    }, [])

    /* 滚轮缩放：必须用原生监听（React 的 onWheel 是 passive，preventDefault 无效，
       否则画布会跟着整页滚）。以光标为锚点，手感与常见画布一致。 */
    useEffect(() => {
      const cleanups = []
      list.forEach((graph) => {
        const el = canvasRefs.current[graph.key]
        if (!el || typeof el.addEventListener !== 'function') return
        const onWheel = (event) => {
          /* 只有 Ctrl/⌘ + 滚轮才是「缩放画布」；普通滚轮留给页面滚动。
             多张完整高度的图纵向排开时，如果滚轮一律被画布吃掉，用户根本滚不到下一张图。
             Mac 触控板双指捏合会带 ctrlKey，所以捏合缩放仍然可用。 */
          if (!event.ctrlKey && !event.metaKey) return
          if (typeof event.preventDefault === 'function') event.preventDefault()
          const delta = num(event.deltaY, 0)
          if (!delta) return
          const factor = Math.exp(-delta * 0.01)
          const anchor = userPointOf(graph, el, event.clientX, event.clientY)
          const v = viewOf(viewsRef.current, graph.key)
          setView(graph.key, zoomView(v, factor, anchor || { x: graph.width / 2, y: (Number(graph.top) || 0) + graph.height / 2 }))
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        cleanups.push(() => { try { el.removeEventListener('wheel', onWheel) } catch (error) { /* 元素没了就算了 */ } })
      })
      return () => cleanups.forEach((fn) => fn())
    })

    /* 不因聚焦自动平移画布：GraphView 收到的 graphs 是响应式重排前的坐标，
       直接拿它 centerOn 会把画布推到错误位置（用户点节点后整块卡片被推出可视区）。
       聚焦只负责高亮/压暗，画布位置保持不变。 */

    const beginPan = (event, graph) => {
      if (event.button != null && Number(event.button) !== 0) return
      panMoved.current = false
      setPan({
        graphKey: graph.key,
        clientX: num(event.clientX, 0),
        clientY: num(event.clientY, 0),
        base: viewOf(viewsRef.current, graph.key),
      })
    }

    const movePan = (event, graph) => {
      if (!pan || pan.graphKey !== graph.key) return
      const dx = num(event.clientX, 0) - pan.clientX
      const dy = num(event.clientY, 0) - pan.clientY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        panMoved.current = true
        if (typeof event.preventDefault === 'function') event.preventDefault()
      }
      if (!panMoved.current) return
      const scale = scaleOf(graph)
      if (!(scale > 0)) return
      setView(graph.key, panView(pan.base, dx / scale, dy / scale))
    }

    const endPan = () => {
      if (pan) setPan(null)
    }

    const beginDrag = (event, graph, node) => {
      if (typeof event.stopPropagation === 'function') event.stopPropagation()
      if (event.button != null && Number(event.button) !== 0) return
      dragMoved.current = false
      const target = event.currentTarget
      if (target && typeof target.setPointerCapture === 'function' && event.pointerId != null) {
        try { target.setPointerCapture(event.pointerId) } catch (error) { /* 指针已经没了就算了 */ }
      }
      setDrag({
        key: node.key,
        graphKey: graph.key,
        id: node.id,
        clientX: num(event.clientX, 0),
        clientY: num(event.clientY, 0),
        dx: 0,
        dy: 0,
      })
    }

    const moveDrag = (event, graph, node) => {
      if (!drag || drag.key !== node.key) return
      const scale = scaleOf(graph)
      const dx = (num(event.clientX, 0) - drag.clientX) / scale
      const dy = (num(event.clientY, 0) - drag.clientY) / scale
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        dragMoved.current = true
        if (typeof event.preventDefault === 'function') event.preventDefault()
      }
      setDrag({ ...drag, dx, dy })
    }

    const endDrag = (event, graph, node) => {
      if (!drag || drag.key !== node.key) return
      if (dragMoved.current) {
        const base = posOf(graph.key, node)
        if (typeof onNodeMove === 'function') {
          /* 松手吸附 40px 网格（与参考站 GRID_SIZE 一致），并且不许拖到画布左上角之外。 */
          onNodeMove(graph.key, node.id, {
            x: Math.max(0, snapToGrid(base.x + drag.dx)),
            y: Math.max(0, snapToGrid(base.y + drag.dy)),
          })
        }
      }
      setDrag(null)
    }

    /** 方向键走位：在同图节点里挑「朝那个方向、且横向偏移最小」的一个。 */
    const neighborOf = (graph, node, direction, at) => {
      const here = at(node)
      let best = null
      let bestScore = Infinity
      graph.nodes.forEach((other) => {
        if (other === node || other.ghost === true) return
        const there = at(other)
        const dx = there.x - here.x
        const dy = there.y - here.y
        const forward = direction === 'ArrowRight' ? dx : direction === 'ArrowLeft' ? -dx : direction === 'ArrowDown' ? dy : -dy
        if (forward <= 1) return
        const cross = (direction === 'ArrowRight' || direction === 'ArrowLeft') ? Math.abs(dy) : Math.abs(dx)
        const score = forward + cross * 2
        if (score < bestScore) { bestScore = score; best = other }
      })
      return best
    }

    const onNodeKeyDown = (event, graph, node, at) => {
      const key = String((event && event.key) || '')
      const stop = () => { if (typeof event.preventDefault === 'function') event.preventDefault() }
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        stop()
        if (typeof onOpenTask === 'function') onOpenTask(node.id, node)
        return
      }
      if (key === 'f' || key === 'F') {
        stop()
        if (typeof onFocusTask === 'function') onFocusTask(node.id)
        return
      }
      if (key === 'Escape') {
        stop()
        if (typeof onBlur === 'function') onBlur()
        return
      }
      if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return
      stop()
      const next = neighborOf(graph, node, key, at)
      if (!next) return
      if (typeof onFocusTask === 'function') onFocusTask(next.id)
      const el = nodeRefs.current[next.key]
      if (el && typeof el.focus === 'function') {
        try { el.focus() } catch (error) { /* 元素换了/没了就算了 */ }
      }
    }

    if (!list.length) {
      return h('div', { className: 'fo-placeholder' },
        h('div', { className: 'fo-placeholder-title' }, '这个范围里没有可画的图'),
        h('div', { className: 'fo-placeholder-body' }, '把项目拖进自定义目录，或者换一个目录页。'),
      )
    }

    /* ---------------- 卡片头部工具 ----------------
       用户口径：按钮放进**卡片自己的 header**（.fo-graph-head），不再悬浮在画布上。
       这些控制是逐张图的（缩放 / 复位），所以每张卡片各有一套。 */
    const hasLocal = !!(nodePos && typeof nodePos === 'object' && Object.keys(nodePos).length > 0)
    const graphHas = (graph, id) => !!id && (graph.nodes || []).some((node) => node.id === id && node.ghost !== true)

    /** 单张图的缩放：以这张图 viewBox 的中心为锚点。 */
    const zoomGraph = (graph, factor) => {
      const anchor = {
        x: (Number(graph.width) || 0) / 2,
        y: (Number(graph.top) || 0) + (Number(graph.height) || 0) / 2,
      }
      setView(graph.key, zoomView(viewOf(viewsRef.current, graph.key), factor, anchor))
    }
    const resetGraphView = (graph) => setView(graph.key, { k: 1, x: 0, y: 0 })
    /** 「适应画布」：基础缩放已按容器宽度把整张图放好，这里清掉工具条缩放/平移回到基准视图。 */
    const fitGraphView = (graph) => {
      resetGraphView(graph)
    }
    const resetLayoutGraph = (graph) => {
      if (typeof onResetLayout !== 'function') return
      onResetLayout(list.length > 1 ? '' : graph.key)
    }

    return h('div', { className: 'fo-canvas-stage' },
      h('div', { className: 'fo-graphs', ref: graphsRef }, viewGraphs.map(({ graph, allNodes, nodes, edges }, index) => {
      const markerBase = `fo-arrow-${index}-${safeId(graph.key)}`
      /* 每张图自己的筛选条件（状态 + 已完成的时间窗）只用来渲染筛选面板；
         真正的「画哪些节点」已经在 viewGraphs 里筛完并重新布局过。 */
      const filter = { ...DEFAULT_FILTER, ...(filters[graph.key] || {}) }
      const doneCount = allNodes.filter((node) => node.done === true && node.ghost !== true).length
      const ghosts = nodes.filter((node) => node.ghost === true)
      const taskCount = nodes.length - ghosts.length
      const legend = Array.isArray(graph.legend) ? graph.legend : []
      const titleLabel = graph.kind === 'ungrouped' ? '未分类' : graph.label
      const viewBox = `0 ${graph.top || 0} ${Math.max(1, graph.width)} ${Math.max(1, graph.height)}`
      /* 窄面板里把整张图缩到容器宽度（只缩呈现，不改布局坐标）；宽面板保持 1:1，不放大。 */
      /* 画布只做一次 CSS 缩放：stage 内的 SVG 与 HTML 卡片都按 layout 1:1 排版，
         再由 stage 整体缩放。卡片不再进 foreignObject，所以缩放不会改变它的排版尺寸。 */
      const fitScale = stageWidth > 0
        ? Math.min(1, Math.max(1, stageWidth - 48) / Math.max(1, graph.width))
        : 1
      const bodyW = Math.max(1, Math.round(graph.width * fitScale * 100) / 100)
      const bodyH = Math.max(1, Math.round(graph.height * fitScale * 100) / 100)
      const label = graph.kind === 'ungrouped'
        ? `未分组：${taskCount} 个任务`
        : `${graph.label}：${(graph.projects || []).length} 个项目、${taskCount} 个任务${graph.kind === 'group' ? '画在同一张图里' : ''}`
      const view = viewOf(views, graph.key)
      const graphPercent = Math.round(view.k * 100)
      const anyFocused = !!focusedId && nodes.some((node) => node.ghost !== true && node.id === focusedId)

      /* 拖动中的那个节点跟手（不吸附），其余用本地位置或布局位置。 */
      const at = (node) => {
        if (drag && drag.key === node.key) {
          const base = posOf(graph.key, node)
          return { x: base.x + drag.dx, y: base.y + drag.dy }
        }
        return posOf(graph.key, node)
      }
      const placed = nodes.map((node) => ({ node, pos: at(node) }))
      const byId = new Map()
      placed.forEach((row) => { byId.set(row.node.id, row) })

      /* 箭头：6×6 实心三角，fill 跟边同色（与参考站 WorkflowEditor 的 marker 一寸不差） */
      const defs = h('defs', null, ['depends_on', 'derived_from', 'temporal'].map((kind) => h('marker', {
        key: kind,
        id: `${markerBase}-${kind}`,
        viewBox: '0 0 6 6',
        refX: '5',
        refY: '3',
        markerWidth: '6',
        markerHeight: '6',
        /* 与 adventure 的 workflow 边一致：6×6 实心三角，几何按 marker 自己的箱算 */
        markerUnits: 'userSpaceOnUse',
        orient: 'auto',
      }, h('path', { className: 'fo-arrow', 'data-kind': kind, d: 'M 0 0 L 6 3 L 0 6 z' }))))

      /* 边的端点跟着节点位置走：拖动时实时重算折线，别让线头留在原地。
         没被拖过的边优先用布局引擎给的 dagre 路由点 —— 它绕开卡片、从 rank 间隙穿过；
         只有端点被手动拖走（或引擎没给路由）时才退回几何折线。 */
      const isMoved = (id) => {
        const bag = nodePos && nodePos[graph.key]
        const hit = bag && typeof bag === 'object' ? bag[id] : null
        return !!(hit && isFinite(Number(hit.x)) && isFinite(Number(hit.y)))
      }
      const draggingId = drag ? drag.id : ''
      const pairKeyOf = (edge) => `${edge.from}>${edge.to}`
      const pairCount = new Map()
      edges.forEach((edge) => { const key = pairKeyOf(edge); pairCount.set(key, (pairCount.get(key) || 0) + 1) })
      const pairSeen = new Map()
      const edgeLayer = h('g', { 'aria-hidden': 'true' }, edges.map((edge) => {
        const from = byId.get(edge.from)
        const to = byId.get(edge.to)
        const key = pairKeyOf(edge)
        const total = pairCount.get(key) || 1
        const nth = pairSeen.get(key) || 0
        pairSeen.set(key, nth + 1)
        /* 同一对任务间的多条边（如 depends_on + temporal）错开 6px，避免完全盖住。 */
        const shift = total > 1 ? (nth - (total - 1) / 2) * 6 : 0
        const route = Array.isArray(edge.route) && edge.route.length >= 2
        const canRoute = route && from && to && !isMoved(edge.from) && !isMoved(edge.to) &&
          draggingId !== edge.from && draggingId !== edge.to
        let geo
        if (canRoute) {
          geo = { path: routePath(offsetRoute(edge.route, shift)), transform: undefined }
        } else if (from && to) {
          const base = edgePath(
            { x: from.pos.x, y: from.pos.y, w: from.node.w, h: from.node.h },
            { x: to.pos.x, y: to.pos.y, w: to.node.w, h: to.node.h },
          )
          let transform
          if (shift) {
            const dx = (to.pos.x + to.node.w / 2) - (from.pos.x + from.node.w / 2)
            const dy = (to.pos.y + to.node.h / 2) - (from.pos.y + from.node.h / 2)
            const len = Math.hypot(dx, dy) || 1
            transform = `translate(${round((-dy / len) * shift)} ${round((dx / len) * shift)})`
          }
          geo = { path: base.path, transform }
        } else {
          /* 端点缺了就退回 layout 给的 path（理论上不会发生，纯防御）。 */
          geo = { path: edge.path, transform: undefined }
        }
        const kindLabel = EDGE_KIND_LABEL[edge.kind] || edge.kind
        /* 悬停能读到「这条线是什么、为什么存在」，不用点开详情去猜。 */
        const tip = [kindLabel, edge.source ? `来源：${EDGE_SOURCE_LABEL[edge.source] || edge.source}` : '', edge.reason ? edge.reason : '']
          .filter(Boolean).join(' · ')
        return h('path', {
          key: edge.key,
          className: `fo-edge${(selectedId && (edge.from === selectedId || edge.to === selectedId)) ? ' is-active' : ''}`,
          'data-kind': edge.kind,
          'data-from': edge.from,
          'data-to': edge.to,
          d: geo.path,
          transform: geo.transform,
          'marker-end': `url(#${markerBase}-${edge.kind})`,
        }, h('title', { key: 'tip' }, tip))
      }))

      /* 卡片不再进 SVG foreignObject：HTML 卡片按 layout 1:1 排版，和边共用同一个 viewport 平移/缩放，
         最后由 stage 做一次 CSS 缩放。缩放不会改变卡片内部的排版尺寸，任何宽度/zoom 都不会再被裁成一条。 */
      const nodeLayer = h('div', {
        className: 'fo-cards-layer',
        style: {
          width: `${graph.width}px`,
          height: `${graph.height}px`,
          transform: viewportTransform(view),
        },
      }, placed.map(({ node, pos }) => {
        const interactive = node.ghost !== true
        const selected = !!selectedId && interactive && node.id === selectedId
        const focused = !!focusedId && interactive && node.id === focusedId
        const dimmed = anyFocused && node.id !== focusedId
        const card = cardGeometry({ ...node, x: pos.x, y: pos.y })
        /* 点击卡片 = 聚焦（高亮节点 + 相关边 + 其余降透明度），不再弹详情侧栏，避免与建议侧栏打架。 */
        /* 与 ReactFlow 视图统一：单击任务卡 = 选中 + 打开右侧详情。 */
        const activate = () => {
          if (!interactive) return
          if (typeof onFocusTask === 'function') onFocusTask(node.id)
          if (typeof onOpenTask === 'function') onOpenTask(node.id, node)
        }
        const state = String(node.state || 'ghost')
        const tip = `${node.fullTitle || node.id}${node.ghost ? (node.missing ? '（任务不存在，仅剩关系）' : '（属于其它分组）') : ''}`
        /* 所有节点（含 ghost）都是同一张面板卡：内容变了才重建（签名不变就复用）。 */
        const mountDomCard = (el) => {
          if (!el) return
          /* 卡片容器仍是 overflow:hidden；聚焦有时会把隐藏滚动区推出一截，监听并归零。 */
          const resetScroll = () => {
            if (el.scrollTop) el.scrollTop = 0
            if (el.scrollLeft) el.scrollLeft = 0
          }
          resetScroll()
          if (!el.__foScrollGuard) {
            el.__foScrollGuard = true
            el.addEventListener('scroll', resetScroll, { passive: true })
            el.addEventListener('focusin', resetScroll)
          }
          const fullTask = taskById && node.id ? taskById[node.id] : null
          const signature = graphCardSignature(node, fullTask)
          if (el.__foCardSignature === signature) return
          const built = buildGraphCardDom(node, {
            task: fullTask,
            /* ghost 不是真任务：不给任何动作，避免「聚焦/打开会话」对它生效。 */
            handlers: interactive ? graphCardHandlers(node, { hostReady, onOpenSession, onFocusTask }) : {},
          })
          built.element.style.height = '100%'
          built.element.style.boxSizing = 'border-box'
          built.element.style.overflow = 'hidden'
          built.element.style.boxShadow = 'none'
          while (el.firstChild) el.removeChild(el.firstChild)
          el.appendChild(built.element)
          el.__foCardSignature = signature
        }

        return h('div', {
          key: node.key,
          ref: (el) => { nodeRefs.current[node.key] = el },
          className: `fo-node${node.ghost ? ' is-ghost' : ''}${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}${drag && drag.key === node.key ? ' is-dragging' : ''}`,
          'data-id': node.id,
          'data-x': String(pos.x),
          'data-y': String(pos.y),
          'data-state': state,
          'data-focused': focused ? '1' : '0',
          'data-dimmed': dimmed ? '1' : '0',
          'aria-current': focused ? 'true' : undefined,
          tabIndex: interactive ? 0 : -1,
          role: interactive ? 'button' : 'img',
          'aria-label': describeNode(node),
          title: tip,
          style: Object.assign({
            left: `${pos.x}px`,
            top: `${pos.y - (Number(graph.top) || 0)}px`,
            width: `${card.w}px`,
            height: `${card.h}px`,
          }, decoStyle(node.colorRef)),
          onPointerDown: interactive ? (event) => beginDrag(event, graph, node) : undefined,
          onPointerMove: interactive ? (event) => moveDrag(event, graph, node) : undefined,
          onPointerUp: interactive ? (event) => endDrag(event, graph, node) : undefined,
          onClick: interactive ? () => {
            if (dragMoved.current) { dragMoved.current = false; return }
            activate()
          } : undefined,
          onKeyDown: interactive ? (event) => onNodeKeyDown(event, graph, node, at) : undefined,
        }, h('div', { className: 'fo-node-dom tc-scope', ref: mountDomCard }))
      }))

      return h('section', {
        key: graph.key || index,
        className: `fo-graph${list.length === 1 ? ' is-solo' : ''}`,
        'aria-label': label,
        style: { '--fo-i': Math.min(index, 7) },
      },
        /* 页面一次只展示一张图：标题卡就是这一页的 header，始终展开、不做折叠。
           单项目时把项目名收进标题卡，避免再单起一份重复的项目图例。 */
        h('div', { className: 'fo-graph-head' },
          h('div', { className: 'fo-row fo-row-card fo-graph-title', 'data-kind': 'project' },
            sideCardIcon(h, {
              icon: graph.kind === 'ungrouped' ? 'lucide:inbox' : 'lucide:folder',
              color: undefined,
            }),
            sideCardLabel(h, {
              label: titleLabel,
              title: label,
            }),
            /* 单项目且标题不是项目名（目录 scope）时才补项目名；项目 scope 不重复。 */
            legend.length === 1 && legend[0].label !== titleLabel
              ? h('span', { className: 'fo-graph-project', title: legend[0].label }, legend[0].label)
              : null,
            sideCardCount(h, { count: taskCount, kind: 'group', title: label }),
          ),
          /* 边的图例：接受建议后画布变了，这里要能立刻看出「多了几条什么线」
             （时间先后是点线、颜色更淡，只靠眼睛扫画布很容易以为没变化）。 */
          h('div', { className: 'fo-edge-legend', 'aria-label': '关系图例' },
            [['depends_on', '前置'], ['derived_from', '来源'], ['temporal', '时间']].map(([kind, label]) => {
              const total = edges.filter((edge) => edge.kind === kind).length
              if (!total) return null
              return h('span', { key: kind, className: 'fo-edge-item', 'data-kind': kind },
                h('i', { className: 'fo-edge-swatch', 'data-kind': kind, 'aria-hidden': 'true' }),
                h('span', { className: 'fo-edge-label' }, label),
                h('span', { className: 'fo-edge-count' }, String(total)))
            }),
            /* 没有可见边时解释一下为什么是一格格卡片：读序是 项目 → 优先级 → 编号。 */
            !edges.length && nodes.length
              ? h('span', { className: 'fo-edge-empty' }, '暂无关系')
              : null,
          ),
          /* 多个项目才需要颜色图例；单项目已经在标题卡里写了名字，不再重复。 */
          legend.length > 1 ? h('div', { className: 'fo-graph-legend', 'aria-label': '项目图例' },
            legend.map((item) => h('span', { key: item.key, className: 'fo-legend-item', title: item.label },
              h('i', { className: 'fo-legend-dot', style: { '--fo-c': decoVar(item.colorRef) }, 'aria-hidden': 'true' }),
              h('span', { className: 'fo-legend-label' }, item.label),
            )),
          ) : null,
          /* 动作就在卡片自己的 header 右侧：不悬浮、不占额外一行。 */
          h('div', { className: 'fo-graph-actions', role: 'toolbar', 'aria-label': '画布工具' },
            /* 建议入口不在这里：统一由页面右缘的「建议」标签负责（唯一入口）。 */
            /* 筛选：状态（进行中/阻塞/挂起/已完成）+ 已完成的时间窗（默认最近一周） */
            h('div', { className: 'fo-filter-wrap' },
              h('button', {
                type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                'data-action': 'open-filter',
                'data-active': filter.done === true || Number(filter.days) > 0 ? '1' : '0',
                'aria-expanded': filterOpen[graph.key] === true ? 'true' : 'false',
                'aria-pressed': filter.done === true ? 'true' : 'false',
                title: '筛选这张图显示哪些状态、以及什么时间范围内开始的任务',
                onClick: () => setFilterOpen((prev) => (prev[graph.key] === true ? {} : { [graph.key]: true })),
              }, `筛选${filter.done === true ? ` · 已完成 ${doneCount}` : ''}${Number(filter.days) > 0 ? ` · ${(FILTER_RANGES.find((range) => range.days === Number(filter.days)) || {}).label || '时间'}` : ''}`),
              filterOpen[graph.key] === true
                ? h('div', { className: 'fo-filter-pop', role: 'group', 'aria-label': '筛选条件' },
                  h('div', { className: 'fo-filter-row' },
                    h('span', { className: 'fo-filter-label' }, '状态'),
                    ...FILTER_STATUSES.map(([key, label]) => h('button', {
                      key,
                      type: 'button', className: 'fo-filter-chip',
                      'data-action': `filter-status-${key}`,
                      'data-active': filter[key] !== false ? '1' : '0',
                      onClick: () => patchFilter(graph.key, { [key]: filter[key] === false }),
                    }, key === 'done' && doneCount ? `${label} ${doneCount}` : label))),
                  h('div', { className: 'fo-filter-row' },
                    h('span', { className: 'fo-filter-label', title: '按任务开始时间过滤；没有开始时间时用创建时间。与是否完成无关。' }, '时间范围'),
                    ...FILTER_RANGES.map((range) => h('button', {
                      key: range.days,
                      type: 'button', className: 'fo-filter-chip',
                      'data-action': 'filter-range',
                      'data-days': String(range.days),
                      'data-active': Number(filter.days) === range.days ? '1' : '0',
                      onClick: () => patchFilter(graph.key, { days: range.days }),
                    }, range.label))),
                  h('div', { className: 'fo-filter-row' },
                    h('button', {
                      type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                      'data-action': 'filter-reset',
                      onClick: () => { setFilters((prev) => ({ ...prev, [graph.key]: { ...DEFAULT_FILTER } })); setFilterOpen((prev) => ({ ...prev, [graph.key]: false })) },
                    }, '恢复默认'),
                    h('span', { className: 'fo-filter-hint' }, '按开始时间；与是否完成无关'),
                  ),
                )
                : null,
            ),
            /* 「重新布局」= 只重排这一张图（清掉这个项目里手动拖过的位置） */
            h('button', {
              type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
              'data-action': 'graph-reset',
              title: '按依赖重新排布这张图（清掉手动拖过的位置）',
              onClick: () => { if (typeof onResetLayout === 'function') onResetLayout(graph.key) },
            }, '重新布局'),
            h('div', { className: 'fo-zoom-group' },
              h('button', {
                type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                'data-action': 'zoom-out', 'aria-label': '缩小画布', title: '缩小画布（Ctrl / ⌘ + 滚轮也行）',
                disabled: graphPercent <= Math.round(VIEW_ZOOM_MIN * 100),
                onClick: () => zoomGraph(graph, 1 / ZOOM_STEP),
              }, '−'),
              h('button', {
                type: 'button', className: 'fo-zoom-value', 'data-action': 'zoom-reset',
                'aria-label': `当前缩放 ${graphPercent}%，点击回到 100%`, title: '当前缩放；点击回到 100%',
                onClick: () => resetGraphView(graph),
              }, `${graphPercent}%`),
              h('button', {
                type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                'data-action': 'zoom-in', 'aria-label': '放大画布', title: '放大画布（Ctrl / ⌘ + 滚轮也行）',
                disabled: graphPercent >= Math.round(VIEW_ZOOM_MAX * 100),
                onClick: () => zoomGraph(graph, ZOOM_STEP),
              }, '+'),
              h('button', {
                type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                'data-action': 'fit', 'data-icon': '1', 'aria-label': '适应画布', title: '缩放到能看全这张图（不放大）',
                onClick: () => fitGraphView(graph),
              }, fitIcon(h)),
            ),
            h('button', {
              type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
              'data-action': 'reset-layout', 'data-icon': '1', disabled: !hasLocal,
              'aria-label': '复位布局',
              title: hasLocal ? '清掉本地拖动位置，回到自动布局（不影响缩放）' : '还没有拖动过节点',
              onClick: () => resetLayoutGraph(graph),
            }, resetIcon(h)),
            focusedId && graphHas(graph, focusedId)
              ? h('button', {
                type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                'data-action': 'blur', 'data-icon': '1', 'aria-label': '取消聚焦', title: '取消聚焦（Esc）',
                onClick: () => { if (typeof onBlur === 'function') onBlur() },
              }, closeIcon(h))
              : null,
          ),
        ),
        /* 画布：网格层在最底、不拦点击；SVG 在上层。空图也显示网格（参考站画布一直在）。
           点空白（画布底/网格/SVG 空白处，不在任何节点里）= 取消聚焦；
           拖动空白 = 平移；滚轮 = 以光标为锚点缩放（见上面 useEffect）。 */
        h('div', {
          ref: (el) => { canvasRefs.current[graph.key] = el },
          className: `fo-canvas${pan && pan.graphKey === graph.key ? ' is-panning' : ''}`,
          'data-zoom': String(round(view.k, 3)),
          onPointerDown: (event) => beginPan(event, graph),
          onPointerMove: (event) => movePan(event, graph),
          onPointerUp: endPan,
          onPointerLeave: endPan,
          onClick: (event) => {
            if (panMoved.current) { panMoved.current = false; return }
            if (typeof onBlur !== 'function') return
            if (insideNode(event && event.target, event && event.currentTarget)) return
            onBlur()
          },
        },
          h('div', { className: 'fo-grid', 'aria-hidden': 'true' }),
          nodes.length
            ? h('div', {
              className: 'fo-graph-body',
              style: { width: `${bodyW}px`, height: `${bodyH}px` },
            },
              h('div', {
                className: 'fo-stage',
                style: {
                  width: `${Math.max(1, graph.width)}px`,
                  height: `${Math.max(1, graph.height)}px`,
                  transform: `scale(${fitScale})`,
                },
              },
                h('svg', {
                  ref: (el) => { svgRefs.current[graph.key] = el },
                  className: 'fo-svg',
                  viewBox,
                  width: Math.max(1, graph.width),
                  height: Math.max(1, graph.height),
                  style: { width: `${Math.max(1, graph.width)}px`, height: `${Math.max(1, graph.height)}px` },
                  preserveAspectRatio: 'xMinYMin meet',
                  /* role=group 而不是 img：图里的节点本身是可聚焦的 button，img 会把它们从无障碍树里挡掉。 */
                  role: 'group',
                  'aria-label': label,
                  'data-graph': graph.key,
                  'data-zoom': String(round(view.k, 3)),
                }, defs,
                  /* 视口层：缩放/平移只作用在边；HTML 卡片层用同一个 transform 跟手。 */
                  h('g', { className: 'fo-viewport', transform: viewportTransform(view) }, edgeLayer)),
                nodeLayer))
            : (() => {
              const hasTasks = allNodes.length > 0
              const onlyDone = hasTasks && allNodes.every((node) => node.ghost === true || node.done === true)
              const title = onlyDone
                ? '这里的任务都已完成'
                : (hasTasks
                  ? '当前筛选没有任务'
                  : (graph.kind === 'ungrouped' ? '没有未分组的项目' : '这个目录里还没有在场的工作区'))
              const body = onlyDone
                ? '已完成默认不画。打开卡片头部的「筛选」勾上「已完成」就能看到它们。'
                : (hasTasks
                  ? '放宽状态或时间范围，或者点筛选面板里的「恢复默认」。'
                  : (graph.kind === 'ungrouped'
                    ? '所有项目都已经归入某个自定义目录。'
                    : '它的成员当前都不在任务集里（可能被删或改名）。把左栏的项目拖进这个目录即可。'))
              return h('div', { className: 'fo-placeholder fo-placeholder-compact' },
                h('div', { className: 'fo-placeholder-title' }, title),
                h('div', { className: 'fo-placeholder-body' }, body),
              )
            })(),
        ),
      )
    })))
  }
}

/** 事件目标是不是落在某个节点卡片里（点空白才算「取消聚焦」）。 */
function insideNode(target, root) {
  let cur = target
  while (cur && cur !== root) {
    const cls = typeof cur.getAttribute === 'function' ? cur.getAttribute('class') : (typeof cur.className === 'string' ? cur.className : '')
    if (cls && String(cls).split(/\s+/).indexOf('fo-node') >= 0) return true
    cur = cur.parentNode
  }
  return false
}

export default createGraphView
