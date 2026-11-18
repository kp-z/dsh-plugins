/**
 * 关系画布 —— React Flow 版（成熟方案）。
 *
 * 只保留 Cove Task 的业务数据/卡片 DOM/筛选，节点布局仍交给已有 dagre
 * （graph 已在 OverviewPanel 里算好）。画布、视口、拖拽、缩放、边路由、Controls
 * 全部由 React Flow 负责；卡片通过自定义 node 挂载现有 .task 卡片，不再手写 SVG。
 *
 * React / ReactFlow 由宿主注入（client.js 或 tasksBoot.js）；本文件不 import 任何
 * bare specifier，保证独立页也能直接作为 ES module 运行。
 */
import { buildGraphCardDom, graphCardHandlers, graphCardSignature } from '../card/graphCardDom.js'
import { ensureTaskCardStyles } from '../card/taskCardStyles.js'
import { relayoutGraph } from '../graph/relayout.js'
import { DEFAULT_FILTER, FILTER_RANGES, FILTER_STATUSES, inDateRange } from './GraphView.js'
import { sideCardCount } from './cardParts.js'
import { decoVar } from './styles.js'
import { injectReactFlowStyles } from './reactflowStyles.js'

if (typeof document !== 'undefined') {
  ensureTaskCardStyles(document)
  injectReactFlowStyles(document)
}

const ZOOM_MIN = 0.3
const ZOOM_MAX = 2
const FLOW_NODE_W = 420
const FLOW_NODE_H = 156

const cssNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const edgeVisual = (kind) => {
  if (kind === 'derived_from') return { stroke: 'var(--dsw-alias-label-secondary)', dash: '6 5', width: 2.5, opacity: 0.72 }
  if (kind === 'temporal') return { stroke: 'var(--dsw-alias-label-tertiary)', dash: '2 6', width: 2, opacity: 0.55 }
  return { stroke: 'var(--dsw-alias-label-secondary)', dash: undefined, width: 2.5, opacity: 0.82 }
}

/** 一张图的 React Flow 画布。 */
function createFlowCanvas(deps) {
  const { React, h, ReactFlow } = deps
  const { useCallback, useEffect, useMemo, useRef } = React
  const {
    ReactFlow: Flow,
    ReactFlowProvider,
    Background,
    Controls,
    MarkerType,
    useNodesState,
    useEdgesState,
    useReactFlow,
    Handle,
    Position,
  } = ReactFlow


  function FlowTaskNode(props) {
    const data = props.data || {}
    const hostRef = useRef(null)
    const signature = graphCardSignature(data.node, data.task)
    useEffect(() => {
      if (!hostRef.current) return
      const built = buildGraphCardDom(data.node, {
        task: data.task,
        handlers: data.ghost ? {} : graphCardHandlers(),
      })
      built.element.style.height = '100%'
      built.element.style.boxSizing = 'border-box'
      built.element.style.overflow = 'hidden'
      built.element.style.boxShadow = 'none'
      hostRef.current.replaceChildren(built.element)
      /* 卡片里的按钮/链接不参与节点拖拽；其余区域交给 React Flow 拖。 */
      hostRef.current.querySelectorAll('button,a,input,select,textarea').forEach((el) => {
        try { el.classList.add('nodrag') } catch (error) { /* ignore */ }
      })
    }, [signature, data.ghost])

    return h('div', {
      className: 'fo-node fo-flow-node'
        + (data.ghost ? ' is-ghost' : '')
        + (data.selected ? ' is-selected' : '')
        + (data.dimmed ? ' is-dimmed' : ''),
      'data-id': data.node.id,
      'data-state': data.node.state || 'open',
      style: { '--fo-c': decoVar(data.node.colorRef) },
      tabIndex: data.ghost ? -1 : 0,
      role: data.ghost ? 'img' : 'button',
      title: data.node.fullTitle || data.node.id,
      onKeyDown: (event) => {
        if (data.ghost) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (event.key === 'Enter' && typeof data.onOpenTask === 'function') data.onOpenTask(data.node.id)
          else if (typeof data.onFocusTask === 'function') data.onFocusTask(data.node.id)
        }
      },
    }, h(Handle, { type: 'target', position: Position.Left, id: 'in', className: 'fo-flow-handle', style: { opacity: 0, width: 1, height: 1, border: 0, background: 'transparent', pointerEvents: 'none' } }),
    h('div', { className: 'fo-node-dom tc-scope', ref: hostRef }),
    h(Handle, { type: 'source', position: Position.Right, id: 'out', className: 'fo-flow-handle', style: { opacity: 0, width: 1, height: 1, border: 0, background: 'transparent', pointerEvents: 'none' } }))
  }

  const nodeTypes = { coveTask: FlowTaskNode }

  function CanvasInner(props) {
    const {
      graph, nodes, edges, selectedId, focusedId, taskById, nodePos,
      onFocusTask, onOpenTask, onNodeMove, onBlur,
    } = props
    const { fitView } = useReactFlow()
    const at = (node) => {
      const bag = nodePos && typeof nodePos === 'object' ? nodePos[graph.key] : null
      const hit = bag && typeof bag === 'object' ? bag[node.id] : null
      return hit && Number.isFinite(Number(hit.x)) && Number.isFinite(Number(hit.y))
        ? { x: Number(hit.x), y: Number(hit.y) }
        : { x: node.x, y: node.y }
    }
    const nodeSig = nodes.map((node) => {
      const p = at(node)
      return [node.id, p.x, p.y, node.w, node.h, node.state].join(':')
    }).join('|') + '|' + String(selectedId || '') + '|' + String(focusedId || '')
    const edgeSig = edges.map((edge) => [edge.from, edge.to, edge.kind].join(':')).join('|')

    const initialNodes = useMemo(() => nodes.map((node) => {
      const p = at(node)
      const ghost = node.ghost === true
      const selected = !ghost && selectedId === node.id
      const focused = !ghost && focusedId === node.id
      const dimmed = !!focusedId && !ghost && node.id !== focusedId
      return {
        id: node.id,
        type: 'coveTask',
        position: { x: p.x, y: p.y - cssNumber(graph.top) },
        draggable: !ghost,
        selectable: false,
        width: node.w || FLOW_NODE_W,
        height: node.h || FLOW_NODE_H,
        style: { width: (node.w || FLOW_NODE_W) + 'px', height: (node.h || FLOW_NODE_H) + 'px' },
        data: {
          node,
          task: taskById && taskById[node.id] ? taskById[node.id] : null,
          ghost,
          selected,
          focused,
          dimmed,
          onFocusTask,
          onOpenTask,
        },
      }
    }), [nodeSig, nodes, graph.top, taskById, selectedId, focusedId, onFocusTask, onOpenTask])

    const initialEdges = useMemo(() => edges.map((edge, index) => {
      const v = edgeVisual(edge.kind)
      return {
        id: 'e' + index,
        source: edge.from,
        target: edge.to,
        type: 'smoothstep',
        animated: false,
        className: 'fo-flow-edge',
        style: { stroke: v.stroke, strokeWidth: v.width, strokeDasharray: v.dash, opacity: v.opacity },
        markerEnd: { type: MarkerType.ArrowClosed, color: v.stroke, width: 14, height: 14 },
        data: { kind: edge.kind || 'depends_on' },
      }
    }), [edgeSig, edges])

    const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(initialNodes)
    const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(initialEdges)

    useEffect(() => { setFlowNodes(initialNodes) }, [initialNodes, setFlowNodes])
    useEffect(() => { setFlowEdges(initialEdges) }, [initialEdges, setFlowEdges])

    useEffect(() => {
      const timer = setTimeout(() => {
        try { fitView({ padding: 0.16, duration: 0 }) } catch (error) { /* viewport not ready */ }
      }, 40)
      return () => clearTimeout(timer)
    }, [graph.key, nodeSig.split('|').map((row) => row.split(':')[0]).join(','), fitView])

    const onNodeDragStop = useCallback((event, node) => {
      if (typeof onNodeMove === 'function') onNodeMove(graph.key, node.id, { x: node.position.x, y: node.position.y })
    }, [graph.key, onNodeMove])

    return h('div', { className: 'fo-flow-canvas' }, h(Flow, {
      nodes: flowNodes,
      edges: flowEdges,
      nodeTypes,
      onNodesChange,
      onEdgesChange,
      fitView: true,
      fitViewOptions: { padding: 0.16 },
      minZoom: ZOOM_MIN,
      maxZoom: ZOOM_MAX,
      nodesConnectable: false,
      nodesDraggable: true,
      nodesFocusable: true,
      edgesFocusable: false,
      elementsSelectable: true,
      zoomOnScroll: false,
      panOnScroll: false,
      preventScrolling: false,
      zoomOnDoubleClick: false,
      selectNodesOnDrag: false,
      proOptions: { hideAttribution: true },
      onNodeClick: (event, node) => {
        if (typeof onFocusTask === 'function') onFocusTask(node.id)
      },
      onNodeDoubleClick: (event, node) => {
        if (typeof onOpenTask === 'function') onOpenTask(node.id)
      },
      onNodeDragStop,
      onPaneClick: () => { if (typeof onBlur === 'function') onBlur() },
      'aria-label': graph.label || '关系画布',
    },
      h(Background, { color: 'var(--dsw-alias-border-l1)', gap: 40, size: 1 }),
      h(Controls, { showInteractive: false }),
    ))
  }

  return function FlowCanvas(props) {
    return h(ReactFlowProvider, null, h(CanvasInner, props))
  }
}

export function createGraphFlowFeature(deps) {
  const { h, React, model, ReactFlow } = deps || {}
  if (!React || !ReactFlow) return null
  const FlowCanvas = createFlowCanvas(deps)
  const { useCallback, useEffect, useMemo, useRef, useState } = React

  return function GraphFlowFeature(props) {
    const ctx = props || {}
    const {
      graphs, selectedId = '', focusedId = '', nodePos, taskById,
      onOpenTask, onFocusTask, onNodeMove, onResetLayout, onBlur,
      revealIds,
    } = ctx
    const list = Array.isArray(graphs) ? graphs : []
    const graphsRef = useRef(null)
    const [stageWidth, setStageWidth] = useState(0)
    const layoutWidth = stageWidth > 0 ? Math.max(400, stageWidth - 96) : 1360
    const [filters, setFilters] = useState({})
    const [filterOpen, setFilterOpen] = useState({})

    const patchFilter = (key, patch) => setFilters((prev) => ({
      ...prev,
      [key]: { ...DEFAULT_FILTER, ...(prev[key] || {}), ...patch },
    }))

    const viewGraphs = useMemo(() => list.map((graph) => {
      const filter = { ...DEFAULT_FILTER, ...(filters[graph.key] || {}) }
      const keepNode = (node) => {
        if (!node || node.ghost === true) return true
        const state = node.state || 'open'
        if (state === 'done' && Array.isArray(revealIds) && revealIds.indexOf(node.id) >= 0) return true
        if (!inDateRange(taskById && taskById[node.id], filter.days)) return false
        if (state === 'suspended') return filter.suspended !== false
        if (state === 'blocked') return filter.blocked !== false
        if (state === 'done') return filter.done === true
        return filter.open !== false
      }
      const allNodes = Array.isArray(graph.nodes) ? graph.nodes : []
      const nodes = allNodes.filter(keepNode)
      const visible = new Set(nodes.map((node) => node.id))
      const edges = (Array.isArray(graph.edges) ? graph.edges : [])
        .filter((edge) => visible.has(edge.from) && visible.has(edge.to))
      const laid = nodes.length
        ? relayoutGraph({ ...graph, top: 0, nodes, edges }, { maxWidth: layoutWidth })
        : { ...graph, top: 0, nodes: [], edges: [], width: Math.max(1, graph.width), height: Math.max(1, graph.height) }
      return { graph: { ...laid, top: 0 }, raw: graph, allNodes, nodes: laid.nodes || [], edges: laid.edges || [] }
    }), [list, filters, revealIds, taskById, layoutWidth])

    useEffect(() => {
      if (graphsRef.current && Number(graphsRef.current.scrollTop) !== 0) graphsRef.current.scrollTop = 0
    }, [list.map((graph) => graph.key).join('|')])

    useEffect(() => {
      const el = graphsRef.current
      if (!el) return undefined
      const apply = () => setStageWidth(Math.round(Number(el.clientWidth) || 0))
      apply()
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(apply)
        observer.observe(el)
        return () => observer.disconnect()
      }
      return undefined
    }, [])

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

    return h('div', { className: 'fo-graphs fo-flow-graphs', ref: graphsRef },
      list.length
        ? viewGraphs.map(({ graph, allNodes, nodes, edges }, index) => {
          const filter = { ...DEFAULT_FILTER, ...(filters[graph.key] || {}) }
          const doneCount = allNodes.filter((node) => node.done === true && node.ghost !== true).length
          const taskCount = nodes.filter((node) => node.ghost !== true).length
          const legend = Array.isArray(graph.legend) ? graph.legend : []
          const titleLabel = graph.kind === 'ungrouped' ? '未分类' : graph.label
          const hasLocal = !!(nodePos && typeof nodePos === 'object' && Object.keys(nodePos[graph.key] || {}).length)
          const empty = !nodes.length
          const onlyDone = allNodes.length > 0 && allNodes.every((node) => node.ghost === true || node.done === true)
          return h('section', {
            key: graph.key || index,
            className: 'fo-graph fo-flow-graph' + (list.length === 1 ? ' is-solo' : ''),
            'aria-label': graph.label || '关系图',
            'data-graph': graph.key,
          },
            h('div', { className: 'fo-flow-head' },
              h('div', { className: 'fo-flow-head-main' },
                h('div', { className: 'fo-row-card fo-graph-title', title: graph.label || '' },
                  h('span', { className: 'fo-graph-title-text' }, titleLabel),
                  legend.length === 1 && legend[0].label !== titleLabel
                    ? h('span', { className: 'fo-graph-project', title: legend[0].label }, legend[0].label)
                    : null,
                  sideCardCount(h, { count: taskCount, kind: 'group', title: graph.label || '' }),
                ),
                h('div', { className: 'fo-edge-legend', 'aria-label': '关系图例' },
                  [['depends_on', '前置'], ['derived_from', '来源'], ['temporal', '时间']].map(([kind, label]) => {
                    const total = edges.filter((edge) => edge.kind === kind).length
                    if (!total) return null
                    return h('span', { key: kind, className: 'fo-edge-item', 'data-kind': kind },
                      h('i', { className: 'fo-edge-swatch', 'data-kind': kind, 'aria-hidden': 'true' }),
                      h('span', { className: 'fo-edge-label' }, label),
                      h('span', { className: 'fo-edge-count' }, String(total)))
                  }),
                  !edges.length && nodes.length ? h('span', { className: 'fo-edge-empty' }, '暂无关系') : null,
                ),
                legend.length > 1 ? h('div', { className: 'fo-graph-legend', 'aria-label': '项目图例' },
                  legend.map((item) => h('span', { key: item.key, className: 'fo-legend-item', title: item.label },
                    h('i', { className: 'fo-legend-dot', style: { '--fo-c': decoVar(item.colorRef) }, 'aria-hidden': 'true' }),
                    h('span', { className: 'fo-legend-label' }, item.label),
                  )),
                ) : null,
              ),
              h('div', { className: 'fo-flow-head-actions', role: 'toolbar', 'aria-label': '画布工具' },
                h('div', { className: 'fo-filter-wrap' },
                  h('button', {
                    type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                    'data-action': 'open-filter',
                    'data-active': filter.done === true || Number(filter.days) > 0 ? '1' : '0',
                    'aria-expanded': filterOpen[graph.key] === true ? 'true' : 'false',
                    onClick: () => setFilterOpen((prev) => (prev[graph.key] === true ? {} : { [graph.key]: true })),
                  }, '筛选' + (filter.done === true ? ' · 已完成 ' + doneCount : '') + (Number(filter.days) > 0 ? ' · ' + ((FILTER_RANGES.find((range) => range.days === Number(filter.days)) || {}).label || '时间') : '')),
                  filterOpen[graph.key] === true ? h('div', { className: 'fo-filter-pop', role: 'group', 'aria-label': '筛选条件' },
                    h('div', { className: 'fo-filter-row' },
                      h('span', { className: 'fo-filter-label' }, '状态'),
                      ...FILTER_STATUSES.map(([key, label]) => h('button', {
                        key, type: 'button', className: 'fo-filter-chip',
                        'data-action': 'filter-status-' + key,
                        'data-active': filter[key] !== false ? '1' : '0',
                        onClick: () => patchFilter(graph.key, { [key]: filter[key] === false }),
                      }, key === 'done' && doneCount ? label + ' ' + doneCount : label))),
                    h('div', { className: 'fo-filter-row' },
                      h('span', { className: 'fo-filter-label', title: '按任务开始时间过滤；没有开始时间时用创建时间。与是否完成无关。' }, '时间范围'),
                      ...FILTER_RANGES.map((range) => h('button', {
                        key: range.days, type: 'button', className: 'fo-filter-chip',
                        'data-action': 'filter-range', 'data-days': String(range.days),
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
                  ) : null,
                ),
                h('button', {
                  type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                  'data-action': 'graph-reset', title: '按依赖重新排布这张图（清掉手动拖过的位置）',
                  onClick: () => { if (typeof onResetLayout === 'function') onResetLayout(graph.key) },
                }, '重新布局'),
                h('button', {
                  type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                  'data-action': 'reset-layout', 'data-icon': '1', disabled: !hasLocal,
                  'aria-label': '复位布局',
                  title: hasLocal ? '清掉本地拖动位置，回到自动布局' : '还没有拖动过节点',
                  onClick: () => { if (typeof onResetLayout === 'function') onResetLayout(graph.key) },
                }, '复位'),
                focusedId ? h('button', {
                  type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                  'data-action': 'blur', 'data-icon': '1', 'aria-label': '取消聚焦', title: '取消聚焦（Esc）',
                  onClick: () => { if (typeof onBlur === 'function') onBlur() },
                }, '取消聚焦') : null,
              ),
            ),
            empty
              ? h('div', { className: 'fo-flow-empty' },
                h('div', { className: 'fo-placeholder-title' }, onlyDone ? '这里的任务都已完成' : (allNodes.length ? '当前筛选没有任务' : '这个目录里还没有在场的工作区')),
                h('div', { className: 'fo-placeholder-body' }, onlyDone ? '已完成默认不画。打开筛选勾上「已完成」就能看到它们。' : (allNodes.length ? '放宽状态或时间范围，或者点筛选面板里的「恢复默认」。' : '把左栏的项目拖进这个目录即可。')),
              )
              : h(FlowCanvas, {
                key: graph.key + ':' + nodes.map((node) => node.id).join(','),
                graph,
                nodes,
                edges,
                selectedId,
                focusedId,
                nodePos,
                taskById,
                onFocusTask,
                onOpenTask,
                onNodeMove,
                onBlur,
              }),
          )
        })
        : h('div', { className: 'fo-placeholder' },
          h('div', { className: 'fo-placeholder-title' }, '这个范围里没有可画的图'),
          h('div', { className: 'fo-placeholder-body' }, '把项目拖进自定义目录，或者换一个目录页。'),
        ))
  }
}

export default createGraphFlowFeature
