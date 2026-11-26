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
import { ensureTaskCardStyles } from '../card/taskCardStyles.js'
import { buildTaskCardModel } from '../card/taskCardModel.js'
import { renderTaskCard } from '../card/taskCardView.js'
import { openPriorityMenu, buildWorkspaceMenu, buildTextPopover, mountCardMenu } from '../card/taskCardMenus.js'
import { relayoutGraph } from '../graph/relayout.js'
import { DEFAULT_FILTER, FILTER_RANGES, FILTER_STATUSES, inDateRange } from './GraphView.js'
import { sideCardCount } from './cardParts.js'
import { decoVar } from './styles.js'
import { injectReactFlowStyles } from './reactflowStyles.js'
import { buildOpp, buildPlanRows, mergeEmptyOkr, mergeOppStats, mergeOppStructure, parseOppDate } from './oppModel.js'

/* 筛选条件存在浏览器本地：刷新/重开页面不丢，也不写回服务端。 */
const FILTER_STORAGE_KEY = 'dsh-cove-task:filters:v1'
function readSavedFilters() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {}
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!key || !value || typeof value !== 'object' || Array.isArray(value)) continue
      out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

if (typeof document !== 'undefined') {
  ensureTaskCardStyles(document)
  injectReactFlowStyles(document)
}

const ZOOM_MIN = 0.3
const ZOOM_MAX = 2
const FLOW_NODE_W = 360
const FLOW_NODE_H = 130

const cssNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const edgeVisual = (kind) => {
  if (kind === 'derived_from') return { stroke: 'var(--dsw-alias-label-secondary)', dash: '6 5', width: 2.5, opacity: 0.72 }
  if (kind === 'temporal') return { stroke: 'var(--dsw-alias-label-secondary)', dash: '2 6', width: 2, opacity: 0.55 }
  return { stroke: 'var(--dsw-alias-label-secondary)', dash: undefined, width: 2.5, opacity: 0.82 }
}


/** Plan 与 Workflow 共用：把现有 panel 任务卡（taskCardModel/View）挂进 React 壳。 */
function createTaskCardHost(React, h) {
  const { useRef, useEffect } = React
  return function TaskCardHost(props) {
    const hostRef = useRef(null)
    const task = props.task || {}
    const signature = JSON.stringify([
      task.id, task.title, task.no, task.priority, task.done, task.suspended,
      task.start, task.end, task.due, task.listName, task.workspaceTitle, task.project, task.projectSyncError,
      task.commitment && task.commitment.expectedAt, task.commitment && task.commitment.expectedText,
      task.schedule && task.schedule.nextText, task.sessionId, task.sessionAlive, task.sessionUnread,
      (task.docs || []).length, (task.members || []).length,
      task.suspension && task.suspension.active, task.reopenPending, task.boundOnly,
    ].join('|'))
    useEffect(() => {
      if (!hostRef.current) return
      const merged = {
        ...task,
        id: props.id || task.id,
        title: props.title || task.title,
        no: props.no != null ? props.no : task.no,
        priority: props.priority || task.priority,
        sessionId: props.sessionId || task.sessionId,
        done: props.done === true || task.done === true,
      }
      const model = buildTaskCardModel(merged, {
        now: Date.now(),
        canStart: false,
        sharedListName: merged.listName,
        hiddenFieldNames: ['开始时间', '结束时间', '预期完成', '工作区', '优先级'],
        echoFieldNames: ['开始时间', '结束时间', '预期完成', '工作区'],
      })
      const open = typeof props.onOpenTask === 'function' ? () => props.onOpenTask(merged.id) : undefined
      const edit = typeof props.onEditField === 'function' ? (field) => props.onEditField(merged.id, field) : open
      const openSession = typeof props.onOpenSession === 'function'
        ? (taskArg, sessionId) => props.onOpenSession(sessionId || merged.sessionId || '')
        : open
      const api = props.api || {}
      const reload = () => { if (typeof props.onTaskUpdated === 'function') props.onTaskUpdated() }
      const fail = (error) => {
        const message = error instanceof Error ? error.message : String(error || '保存失败')
        if (typeof window !== 'undefined' && window.alert) window.alert(message)
      }
      const localValue = (value) => {
        if (value == null || value === '' || Number(value) <= 0) return ''
        const d = new Date(Number(value))
        if (!Number.isFinite(d.getTime())) return ''
        const pad = (n) => String(n).padStart(2, '0')
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
      }
      const openPriority = (anchor) => {
        if (!anchor) return
        openPriorityMenu(anchor, merged.priority || '', (value) => {
          if (typeof api.taskPriority !== 'function') { fail('当前宿主不支持修改优先级'); return }
          Promise.resolve(api.taskPriority(merged.id, value)).then((result) => {
            if (!result || result.ok === false) throw new Error((result && result.error) || '优先级保存失败')
            reload()
          }).catch(fail)
        }, { document })
      }
      const openWorkspace = (anchor) => {
        if (!anchor || typeof buildWorkspaceMenu !== 'function') return
        const options = (Array.isArray(props.workspaces) ? props.workspaces : []).map((w) => ({ id: w.key || w.id, title: w.title, path: w.path }))
        let closeMenu = null
        const menu = buildWorkspaceMenu(options, merged.workspaceKey || merged.workspaceId || '', (picked) => {
          if (typeof api.workspaceBind !== 'function') { fail('当前宿主不支持切换工作区'); return }
          Promise.resolve(api.workspaceBind(merged.id, picked && (picked.id || picked.key))).then((result) => {
            if (!result || result.ok === false) throw new Error((result && result.error) || '工作区切换失败')
            reload()
          }).catch(fail)
        }, { document, close: (focus) => { if (closeMenu) closeMenu(focus) } })
        closeMenu = mountCardMenu(menu, anchor, { document, menuWidth: 280, menuHeight: 180 })
      }
      const openOkr = (anchor, field) => {
        if (!anchor) return
        const value = field === 'objective' ? (merged.objective || '') : (merged.keyResult || '')
        let closeMenu = null
        const pop = buildTextPopover({
          title: field === 'objective' ? '编辑 Objective' : '编辑 Key Result',
          sub: merged.title,
          value,
          submitLabel: '保存',
          onSubmit: (input) => {
            if (typeof api.okrApply !== 'function') { pop.message.textContent = '当前宿主不支持编辑 O/KR'; return }
            const items = [{
              id: merged.id,
              objective: field === 'objective' ? input : (merged.objective || ''),
              keyResult: field === 'keyResult' ? input : (merged.keyResult || ''),
            }]
            Promise.resolve(api.okrApply(items)).then((result) => {
              if (!result || result.ok === false) throw new Error((result && result.error) || '保存失败')
              if (closeMenu) closeMenu(false)
              reload()
            }).catch((error) => { pop.message.textContent = error instanceof Error ? error.message : String(error) })
          },
        }, { document, close: (focus) => { if (closeMenu) closeMenu(focus) } })
        closeMenu = mountCardMenu(pop.element, anchor, { document, menuWidth: 300, menuHeight: 180 })
      }
      const openTime = (anchor, field) => {
        if (!anchor) return
        const isStart = field === 'start'
        const isEta = field === 'eta'
        const isSchedule = field === 'schedule'
        const initial = isStart
          ? localValue(Number(merged.startTs) || (merged.start ? new Date(String(merged.start).replace(' ', 'T')).getTime() : 0))
          : isEta
            ? localValue(merged.commitment && merged.commitment.expectedAt)
            : localValue(merged.schedule && merged.schedule.nextAt)
        let closeMenu = null
        const pop = buildTextPopover({
          title: isStart ? '编辑开始时间' : isEta ? '编辑预期完成' : '编辑定时',
          sub: merged.title,
          type: 'datetime-local',
          value: initial,
          canClear: !isStart,
          clearLabel: '清除',
          submitLabel: '保存',
          onSubmit: (value) => {
            const apiName = isStart ? 'taskStartTime' : isEta ? 'taskEta' : 'taskSchedule'
            const fn = api[apiName]
            if (typeof fn !== 'function') { pop.message.textContent = '当前宿主不支持这个编辑'; return }
            const payload = isStart ? new Date(value).getTime() : value.replace('T', ' ')
            const promise = isStart ? fn(merged.id, payload) : fn(merged.id, payload, 'set')
            Promise.resolve(promise).then((result) => {
              if (!result || result.ok === false) throw new Error((result && result.error) || '保存失败')
              if (closeMenu) closeMenu(false)
              reload()
            }).catch((error) => { pop.message.textContent = error instanceof Error ? error.message : String(error) })
          },
          onClear: isStart ? undefined : () => {
            const fn = api[isEta ? 'taskEta' : 'taskSchedule']
            if (typeof fn !== 'function') { pop.message.textContent = '当前宿主不支持这个编辑'; return }
            Promise.resolve(fn(merged.id, '', 'clear')).then((result) => {
              if (!result || result.ok === false) throw new Error((result && result.error) || '清除失败')
              if (closeMenu) closeMenu(false)
              reload()
            }).catch((error) => { pop.message.textContent = error instanceof Error ? error.message : String(error) })
          },
        }, { document, close: (focus) => { if (closeMenu) closeMenu(focus) } })
        closeMenu = mountCardMenu(pop.element, anchor, { document, menuWidth: 300, menuHeight: 210 })
      }
      const handlers = props.ghost || !open && !openSession && props.onTaskStatus == null ? {} : {
        openTask: open,
        /* 优先级 / 工作区用原来的卡片菜单；开始/定时/预期用原来的文本浮层。 */
        priority: (taskArg, value, anchor) => openPriority(anchor),
        chip: {
          start: (taskArg, key, anchor) => openTime(anchor, 'start'),
          end: (taskArg, key, anchor) => openTime(anchor, 'start'),
          schedule: (taskArg, key, anchor) => openTime(anchor, 'schedule'),
          eta: (taskArg, key, anchor) => openTime(anchor, 'eta'),
          workspace: (taskArg, key, anchor) => openWorkspace(anchor),
        },
        /* 会话胶囊：有宿主打开会话能力就直接开会话，否则退回详情。 */
        session: openSession,
        action: {
          complete: typeof props.onTaskStatus === 'function' ? () => props.onTaskStatus(merged.id, 'done') : undefined,
          suspend: typeof props.onTaskStatus === 'function' ? () => props.onTaskStatus(merged.id, merged.suspended ? 'todo' : 'suspended') : undefined,
          docs: open,
          sync: open,
          comments: open,
          more: open,
        },
      }
      const node = renderTaskCard(model, { handlers, task: merged })
      hostRef.current.replaceChildren(node)
      const meta = node.querySelector('.task-meta')
      if (meta && meta.scrollHeight > meta.clientHeight + 1 && meta.parentElement) {
        const more = document.createElement('span')
        more.className = 'fo-taskcard-more'
        more.textContent = '...'
        more.setAttribute('aria-hidden', 'true')
        meta.parentElement.appendChild(more)
      }
      if (open) {
        node.querySelectorAll('.task-meta .chip, .task-meta .badge, .task-meta .due').forEach((el) => {
          if (el.tagName === 'BUTTON' || (el.closest && el.closest('button'))) return
          const text = (el.textContent || '').trim()
          const field = text.startsWith('O ') ? 'objective' : text.startsWith('KR ') ? 'keyResult' : ''
          const run = () => { if (field) openOkr(el, field); else open() }
          try {
            el.setAttribute('role', 'button')
            el.setAttribute('tabindex', '0')
            el.addEventListener('click', (event) => { event.stopPropagation(); run() })
            el.addEventListener('keydown', (event) => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); run() }
            })
          } catch (error) { /* ignore */ }
        })
      }
      hostRef.current.querySelectorAll('button,a').forEach((el) => {
        try {
          el.classList.add('nodrag')
          el.setAttribute('draggable', 'false')
          el.addEventListener('click', (event) => { if (event && typeof event.stopPropagation === 'function') event.stopPropagation() })
        } catch (error) { /* ignore */ }
      })
    }, [signature, props.ghost, props.onOpenTask, props.onOpenSession, props.onTaskStatus, props.onEditField, props.onTaskUpdated, props.api, props.workspaces, props.id, props.title, props.no, props.priority, props.sessionId, props.done])
    return h('div', {
      className: 'fo-node-dom fo-taskcard-host tc-scope' + (props.className ? ' ' + props.className : '') + (props.ghost ? ' is-ghost' : ''),
      ref: hostRef,
    })
  }
}

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
    BaseEdge,
    EdgeLabelRenderer,
    getSmoothStepPath,
  } = ReactFlow
  const TaskCardHost = createTaskCardHost(React, h)

  function DeleteEdge(props) {
    const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, selected, data } = props
    const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12 })
    return h(React.Fragment, null,
      h(BaseEdge, { path: edgePath, markerEnd, style, interactionWidth: 20 }),
      selected && data && typeof data.onDelete === 'function'
        ? h(EdgeLabelRenderer, null,
          h('button', {
            type: 'button',
            className: 'fo-edge-delete',
            title: '删除这条关系',
            'aria-label': '删除这条关系',
            style: {
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            },
            onClick: (event) => {
              if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
              data.onDelete()
            },
          }, '×'),
        )
        : null,
    )
  }

  function FlowTaskNode(props) {
    const data = props.data || {}
    const node = data.node || {}
    const title = node.fullTitle || (data.task && data.task.title) || node.title || node.id
    const task = {
      id: node.id,
      title,
      no: node.no || (data.task && data.task.no) || 0,
      priority: node.priority || (data.task && data.task.priority) || '',
      sessionId: (data.task && data.task.sessionId) || node.sessionId || '',
      node,
    }
    return h('div', {
      className: 'fo-node fo-flow-node'
        + (data.ghost ? ' is-ghost' : '')
        + (data.selected ? ' is-selected' : '')
        + (data.dimmed ? ' is-dimmed' : ''),
      'data-id': node.id,
      'data-state': node.state || 'open',
      style: { '--fo-c': decoVar(node.colorRef) },
      tabIndex: data.ghost ? -1 : 0,
      role: data.ghost ? 'img' : 'button',
      title,
      onKeyDown: (event) => {
        if (data.ghost) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (event.key === 'Enter' && typeof data.onOpenTask === 'function') data.onOpenTask(node.id)
          else if (typeof data.onFocusTask === 'function') data.onFocusTask(node.id)
        }
      },
    },
      h(Handle, { type: 'target', position: Position.Left, id: 'in', isConnectable: data.ghost !== true, className: 'fo-flow-handle fo-flow-handle-in', title: '拖到这里建立前置关系', 'aria-label': '前置关系输入点' }),
      h(TaskCardHost, {
        task: data.task || {},
        id: node.id,
        title,
        no: task.no,
        priority: task.priority,
        sessionId: task.sessionId,
        done: data.ghost ? false : (data.task && data.task.done === true),
        ghost: data.ghost === true,
        onOpenTask: data.onOpenTask,
        onOpenSession: data.onOpenSession,
        onTaskStatus: data.onTaskStatus,
        onEditField: data.onEditField,
        onTaskUpdated: data.onTaskUpdated,
        api: data.api,
        workspaces: data.workspaces,
      }),
      h(Handle, { type: 'source', position: Position.Right, id: 'out', isConnectable: data.ghost !== true, className: 'fo-flow-handle fo-flow-handle-out', title: '从这里拖到另一张卡片的左侧', 'aria-label': '前置关系输出点' }),
    )
  }

  const nodeTypes = { coveTask: FlowTaskNode }
  const edgeTypes = { coveDelete: DeleteEdge }

  function CanvasInner(props) {
    const {
      graph, nodes, edges, selectedId, focusedId, taskById, nodePos,
      onFocusTask, onOpenTask, onOpenSession, onTaskStatus, onEditField, onTaskUpdated, api, workspaces, onNodeMove, onBlur, onRelation, onRemoveRelation,
    } = props
    const { fitView, setCenter, getViewport, setViewport } = useReactFlow()
    const fitViewRef = useRef(fitView)
    const setCenterRef = useRef(setCenter)
    const getViewportRef = useRef(getViewport)
    const setViewportRef = useRef(setViewport)
    fitViewRef.current = fitView
    setCenterRef.current = setCenter
    getViewportRef.current = getViewport
    setViewportRef.current = setViewport

    const focusRef = useRef('')
    const focusZoomRef = useRef(null)
    useEffect(() => {
      if (!focusedId) {
        if (focusRef.current) {
          focusRef.current = ''
          focusZoomRef.current = null
          const timer = setTimeout(() => {
            try { fitViewRef.current({ padding: 0.10, duration: 260 }) } catch (error) { /* viewport not ready */ }
          }, 220)
          return () => clearTimeout(timer)
        }
        return undefined
      }
      const wasFocused = Boolean(focusRef.current)
      focusRef.current = focusedId
      /* 第一次进入聚焦「房间」用固定 0.82；已经在房间里就保持房间缩放，只平移。 */
      if (!wasFocused || focusZoomRef.current == null) focusZoomRef.current = 0.82
      const roomZoom = focusZoomRef.current
      interacted.current = true
      let raf = 0
      let canceled = false
      let lastWidth = -1
      let stableFrames = 0
      /* 等右侧详情栏宽度稳定两帧再动：避免「宽→窄」和 setCenter 同时进行，动画就会先甩一下。 */
      const settle = () => {
        if (canceled) return
        const el = wrapRef.current
        const width = el ? Number(el.clientWidth) || 0 : 0
        if (width === lastWidth) stableFrames += 1
        else { lastWidth = width; stableFrames = 0 }
        if (stableFrames < 2) {
          raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(settle) : setTimeout(settle, 16)
          return
        }
        const node = flowNodes.find((item) => item.id === focusedId)
        if (!node) return
        const vp = getViewportRef.current ? getViewportRef.current() : null
        if (!el || !vp || !el.clientWidth || !el.clientHeight) {
          const x = Number(node.position && node.position.x) + (Number(node.width) || nodeWidth) / 2
          const y = Number(node.position && node.position.y) + (Number(node.height) || FLOW_NODE_H) / 2
          try { setCenterRef.current(x, y, { zoom: roomZoom, duration: wasFocused ? 300 : 380 }) } catch (error) { /* viewport not ready */ }
          return
        }
        const startZoom = Number(vp.zoom) || 1
        const startCx = (el.clientWidth / 2 - Number(vp.x || 0)) / startZoom
        const startCy = (el.clientHeight / 2 - Number(vp.y || 0)) / startZoom
        const targetCx = Number(node.position && node.position.x) + (Number(node.width) || nodeWidth) / 2
        const targetCy = Number(node.position && node.position.y) + (Number(node.height) || FLOW_NODE_H) / 2
        const targetZoom = roomZoom
        const duration = wasFocused ? 340 : 460
        const started = (typeof performance !== 'undefined' ? performance.now() : Date.now())
        const ease = (t) => 1 - Math.pow(1 - t, 3)
        const frame = (now) => {
          if (canceled) return
          const t = Math.min(1, Math.max(0, (now - started) / duration))
          const k = ease(t)
          const zoom = startZoom + (targetZoom - startZoom) * k
          const cx = startCx + (targetCx - startCx) * k
          const cy = startCy + (targetCy - startCy) * k
          try {
            setViewportRef.current({
              x: el.clientWidth / 2 - cx * zoom,
              y: el.clientHeight / 2 - cy * zoom,
              zoom,
            }, { duration: 0 })
          } catch (error) { /* viewport not ready */ }
          if (t < 1) raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(frame) : setTimeout(() => frame(Date.now()), 16)
        }
        raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(frame) : setTimeout(() => frame(Date.now()), 16)

      }
      raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(settle) : setTimeout(settle, 16)
      return () => {
        canceled = true
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
        else clearTimeout(raf)
      }
    }, [focusedId])



    /* 节点宽度由外层按画布宽度算好传进来：宽画布里卡片太窄，左右会空出两大块。 */
    const nodeWidth = cssNumber(props.nodeWidth, FLOW_NODE_W)
    /* 画布尺寸会变（从叠放的小画布变成整页单图），fitView 只在挂载时跑一次的话，
       缩放到小画布的倍率会被一直沿用 —— 卡片只有 160px，左右两坨空白就是这么来的。 */
    const wrapRef = useRef(null)
    const interacted = useRef(false)
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
    /* fitView 只看节点集合，不看选中/聚焦：否则点一下节点就会重置 interacted 并 fit 全图。 */
    const nodeIdKey = nodes.map((node) => node.id).join(',')
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
        width: nodeWidth,
        height: FLOW_NODE_H,
        style: { width: nodeWidth + 'px', height: FLOW_NODE_H + 'px' },
        data: {
          node,
          task: taskById && taskById[node.id] ? taskById[node.id] : null,
          ghost,
          selected,
          focused,
          dimmed,
          onFocusTask,
          onOpenTask,
          onOpenSession,
          onTaskStatus,
          onEditField,
          onTaskUpdated,
          api,
          workspaces,
        },
      }
    }), [nodeSig, nodes, graph.top, taskById, selectedId, focusedId, onFocusTask, onOpenTask, nodeWidth])

    const initialEdges = useMemo(() => edges.map((edge, index) => {
      const v = edgeVisual(edge.kind)
      return {
        id: 'e' + index,
        source: edge.from,
        target: edge.to,
        type: 'coveDelete',
        animated: false,
        className: 'fo-flow-edge',
        style: { stroke: v.stroke, strokeWidth: v.width, strokeDasharray: v.dash, opacity: v.opacity },
        markerEnd: { type: MarkerType.ArrowClosed, color: v.stroke, width: 14, height: 14 },
        data: {
          kind: edge.kind || 'depends_on',
          onDelete: typeof onRemoveRelation === 'function'
            ? () => onRemoveRelation(edge.from, edge.to, edge.kind || 'depends_on')
            : null,
        },
      }
    }), [edgeSig, edges, onRemoveRelation])

    const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(initialNodes)
    const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(initialEdges)

    useEffect(() => { setFlowNodes(initialNodes) }, [initialNodes, setFlowNodes])
    useEffect(() => { setFlowEdges(initialEdges) }, [initialEdges, setFlowEdges])

    useEffect(() => {
      interacted.current = false
      const timer = setTimeout(() => {
        try { fitViewRef.current({ padding: 0.10, duration: 0 }) } catch (error) { /* viewport not ready */ }
      }, 40)
      return () => clearTimeout(timer)
    }, [graph.key, nodeIdKey])

    /* 画布变大/变小时重新 fit（用户手动拖过就尊重他的视角） */
    useEffect(() => {
      const el = wrapRef.current
      if (!el || typeof ResizeObserver !== 'function') return undefined
      let timer = 0
      const ro = new ResizeObserver(() => {
        if (interacted.current) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          if (interacted.current) return
          try { fitViewRef.current({ padding: 0.10, duration: 0 }) } catch (error) { /* viewport not ready */ }
        }, 80)
      })
      ro.observe(el)
      return () => { if (timer) clearTimeout(timer); ro.disconnect() }
    }, [])

    const onNodeDragStop = useCallback((event, node) => {
      if (typeof onNodeMove === 'function') onNodeMove(graph.key, node.id, { x: node.position.x, y: node.position.y })
    }, [graph.key, onNodeMove])
    const onConnect = useCallback((connection) => {
      const from = connection && connection.source
      const to = connection && connection.target
      if (!from || !to || from === to) return
      if (typeof onRelation === 'function') onRelation(from, to)
    }, [onRelation])

    return h('div', { className: 'fo-flow-canvas', ref: wrapRef }, h(Flow, {
      nodes: flowNodes,
      edges: flowEdges,
      nodeTypes,
      edgeTypes,
      onNodesChange,
      onEdgesChange,
      onConnect,
      connectionLineStyle: { stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 2, strokeDasharray: '5 4' },
      fitView: true,
      fitViewOptions: { padding: 0.10 },
      onMoveStart: () => { interacted.current = true },
      minZoom: ZOOM_MIN,
      maxZoom: ZOOM_MAX,
      nodesConnectable: true,
      nodesDraggable: true,
      nodesFocusable: true,
      edgesFocusable: true,
      elementsSelectable: true,
      zoomOnScroll: false,
      panOnScroll: false,
      preventScrolling: false,
      zoomOnDoubleClick: false,
      selectNodesOnDrag: false,
      proOptions: { hideAttribution: true },
      onNodeClick: (event, node) => {
        interacted.current = true
        if (typeof onFocusTask === 'function') onFocusTask(node.id)
        /* 各种视图统一：点任务卡 = 选中并打开右侧详情（不再需要双击）。 */
        if (typeof onOpenTask === 'function') onOpenTask(node.id)
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
    ), props.toolbar || null)
  }

  return function FlowCanvas(props) {
    return h(ReactFlowProvider, null, h(CanvasInner, props))
  }
}

export function createGraphFlowFeature(deps) {
  const { h, React, model, ReactFlow, store, api } = deps || {}
  if (!React || !ReactFlow) return null
  const FlowCanvas = createFlowCanvas(deps)
  const { useCallback, useEffect, useMemo, useRef, useState } = React
  const TaskCardHost = createTaskCardHost(React, h)

  const readView = () => {
    try {
      const saved = store && typeof store.get === 'function' ? store.get('graphView', 'workflow') : 'workflow'
      if (saved === 'opp') {
        const tab = store && typeof store.get === 'function' ? store.get('oppTab', 'okr') : 'okr'
        return tab === 'plan' || tab === 'progress' ? tab : 'okr'
      }
      if (saved === 'canvas') return 'workflow'
      if (saved === 'list') return 'plan'
      return saved === 'okr' || saved === 'plan' || saved === 'progress' ? saved : 'workflow'
    } catch (error) {
      return 'workflow'
    }
  }

  const OPP_STATUS_LABEL = {
    todo: '待办',
    blocked: '阻塞',
    'in-progress': '进行中',
    suspended: '已挂起',
    done: '已完成',
    cancelled: '废弃',
  }

  const fmtOppDate = (time) => {
    if (!Number.isFinite(Number(time)) || Number(time) <= 0) return ''
    const d = new Date(Number(time))
    return (d.getMonth() + 1) + '/' + d.getDate()
  }

  const oppGroupStatus = (status) => {
    if (status === 'completed') return '已完成'
    if (status === 'at-risk') return '有风险'
    if (status === 'in-progress') return '进行中'
    return '未开始'
  }

  function OppTaskCard(props) {
    const task = props.task
    const open = () => {
      if (typeof props.onOpenTask === 'function') props.onOpenTask(task.id)
      else if (typeof props.onFocusTask === 'function') props.onFocusTask(task.id)
    }
    return h('article', {
      className: 'fo-plan-task' + (props.dragging ? ' is-dragging' : ''),
      'data-id': task.id,
      'data-status': task.status,
      tabIndex: 0,
      role: 'button',
      title: task.title,
      draggable: typeof props.onStatusMove === 'function',
      style: { '--fo-c': decoVar(task.node && task.node.colorRef) },
      onDragStart: typeof props.onStatusMove === 'function' ? (event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', task.id)
        props.onStatusMove(task.id, '')
      } : undefined,
      onDragEnd: typeof props.onStatusMove === 'function' ? () => props.onStatusMove('', '') : undefined,
      onClick: () => { if (!props.dragging) open() },
      onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() }
      },
    },
      h(TaskCardHost, {
        task: task.task || {},
        id: task.id,
        title: task.title,
        no: task.no,
        priority: task.priority,
        sessionId: task.sessionId,
        done: task.status === 'done' || (task.task && task.task.done === true),
        onOpenTask: props.onOpenTask,
        onOpenSession: props.onOpenSession,
        onTaskStatus: props.onTaskStatus,
        onEditField: props.onEditField,
        onTaskUpdated: props.onTaskUpdated,
        api: props.api,
        workspaces: props.workspaces,
      }),
    )
  }


  function OppOkr(props) {
    const model = props.model
    const [expanded, setExpanded] = useState({})
    const [collapsedObjectives, setCollapsedObjectives] = useState({})
    const [editing, setEditing] = useState(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [creating, setCreating] = useState(null)
    const [createSaving, setCreateSaving] = useState(false)
    const [createError, setCreateError] = useState('')
    const STATUS_TEXT = { 'not-started': 'Not Started', 'in-progress': 'In Progress', 'at-risk': 'At Risk', completed: 'Completed' }
    const shownStatus = (node) => (node.status === 'not-started' && node.progress > 0 ? 'in-progress' : node.status)
    const deadlineOf = (due) => {
      if (!due) return '—'
      const d = new Date(Number(due))
      if (!Number.isFinite(d.getTime())) return '—'
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
    const apply = async () => {
      if (!editing) return
      const value = String(editing.value || '').trim()
      if (!value) { setError('O / KR 不能为空'); return }
      if (!props.api || typeof props.api.okrApply !== 'function') { setError('当前宿主不支持编辑 O/KR'); return }
      const source = editing.type === 'objective' ? editing.obj.tasks : editing.kr.tasks
      const items = source.map((task) => ({
        id: task.id,
        objective: editing.type === 'objective' ? value : (task.objective || editing.obj.title),
        keyResult: editing.type === 'kr' ? value : (task.keyResult || editing.kr.title),
      }))
      setSaving(true)
      setError('')
      try {
        let result
        if (source.length) {
          result = await props.api.okrApply(items)
        } else if (typeof props.api.okrUpdate === 'function') {
          result = editing.type === 'objective'
            ? await props.api.okrUpdate({ type: 'objective', current: editing.obj.title, title: value })
            : await props.api.okrUpdate({ type: 'keyResult', objective: editing.obj.title, current: editing.kr.title, title: value })
        } else {
          throw new Error('当前宿主不支持编辑空 O/KR')
        }
        if (!result || result.ok === false) throw new Error((result && result.error) || '保存失败')
        setEditing(null)
        if (typeof props.onTaskUpdated === 'function') props.onTaskUpdated()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSaving(false)
      }
    }
    const editRow = () => editing ? h('div', { className: 'fo-okr-edit' },
      h('input', {
        className: 'fo-okr-edit-input',
        value: editing.value,
        autoFocus: true,
        'aria-label': editing.type === 'objective' ? '编辑 Objective' : '编辑 Key Result',
        onChange: (event) => setEditing({ ...editing, value: event.currentTarget.value }),
        onKeyDown: (event) => {
          if (event.key === 'Enter') { event.preventDefault(); apply() }
          if (event.key === 'Escape') { event.preventDefault(); setEditing(null); setError('') }
        },
      }),
      h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'primary', disabled: saving, onClick: apply }, saving ? 'Save…' : 'Save'),
      h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', disabled: saving, onClick: () => { setEditing(null); setError('') } }, 'Cancel'),
      error ? h('span', { className: 'fo-okr-edit-error' }, error) : null,
    ) : null
    const createNode = async () => {
      if (!creating) return
      const isObjective = creating.mode === 'objective'
      const title = String(isObjective ? creating.objective : creating.keyResult || '').trim()
      if (!title) { setCreateError(isObjective ? 'Objective 不能为空' : 'Key Result 不能为空'); return }
      if (!props.api || typeof props.api.okrCreate !== 'function') { setCreateError('当前宿主不支持新建 O/KR'); return }
      setCreateSaving(true)
      setCreateError('')
      try {
        const result = await props.api.okrCreate({
          type: isObjective ? 'objective' : 'keyResult',
          title,
          ...(isObjective ? { keyResult: String(creating.keyResult || '').trim() } : { objective: String(creating.objective || '').trim() }),
        })
        if (!result || result.ok === false) throw new Error((result && result.error) || '新建失败')
        setCreating(null)
        if (typeof props.onTaskUpdated === 'function') props.onTaskUpdated()
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : String(err))
      } finally {
        setCreateSaving(false)
      }
    }
    const createModal = () => creating ? h('div', { className: 'fo-okr-create-backdrop', onClick: () => { setCreating(null); setCreateError('') } },
      h('div', { className: 'fo-okr-create', onClick: (event) => event.stopPropagation() },
        h('h3', null, creating.mode === 'objective' ? 'New Objective' : 'New Key Result'),
        creating.mode === 'kr' ? h('div', { className: 'fo-okr-create-owner' }, creating.objective) : null,
        h('label', null, creating.mode === 'objective' ? 'Objective' : 'Key Result',
          h('input', {
            autoFocus: true,
            value: creating.mode === 'objective' ? creating.objective : creating.keyResult,
            onChange: (event) => setCreating({ ...creating, [creating.mode === 'objective' ? 'objective' : 'keyResult']: event.currentTarget.value }),
            onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); createNode() } if (event.key === 'Escape') setCreating(null) },
          }),
        ),
        creating.mode === 'objective' ? h('label', null, 'First Key Result（可选）',
          h('input', {
            value: creating.keyResult,
            placeholder: '先留空也可以',
            onChange: (event) => setCreating({ ...creating, keyResult: event.currentTarget.value }),
            onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); createNode() } if (event.key === 'Escape') setCreating(null) },
          }),
        ) : null,
        createError ? h('div', { className: 'fo-okr-create-error' }, createError) : null,
        h('div', { className: 'fo-okr-create-actions' },
          h('button', { type: 'button', className: 'fo-btn', 'data-variant': 'ghost', onClick: () => { setCreating(null); setCreateError('') } }, 'Cancel'),
          h('button', { type: 'button', className: 'fo-btn', 'data-variant': 'primary', disabled: createSaving, onClick: createNode }, createSaving ? 'Creating…' : 'Create'),
        ),
      ),
    ) : null
    return h(React.Fragment, null, h('div', { className: 'fo-okr-list' },
      model.objectives.length
        ? [
          h('div', { key: 'head', className: 'fo-okr-overview-head' },
            h('div', { className: 'fo-okr-overview-title' },
              h('h2', null, 'OKR Overview'),
            ),
            h('div', { className: 'fo-okr-overview-actions' },
              typeof props.onTaskUpdated === 'function'
                ? h('button', { type: 'button', className: 'fo-okr-refresh', onClick: props.onTaskUpdated }, 'Refresh')
                : null,
              h('button', {
                type: 'button', className: 'fo-okr-new',
                onClick: () => { setCreating({ mode: 'objective', objective: '', keyResult: '' }); setCreateError('') },
              }, '+ New Objective'),
            ),
          ),
          ...model.objectives.map((obj, objIndex) => {
            const collapsed = collapsedObjectives[obj.id] === true
            const objStatus = shownStatus(obj)
            return h('article', { key: obj.id, className: 'fo-okr-objective' + (collapsed ? ' is-collapsed' : ''), 'data-status': objStatus },
              h('button', {
                type: 'button',
                className: 'fo-okr-o-badge',
                'aria-expanded': collapsed ? 'false' : 'true',
                title: collapsed ? 'Expand Objective' : 'Collapse Objective',
                onClick: () => setCollapsedObjectives((prev) => ({ ...prev, [obj.id]: !collapsed })),
              }, h('span', { className: 'fo-okr-o-index' }, 'O' + (objIndex + 1)), h('span', { className: 'fo-okr-o-chevron', 'aria-hidden': 'true' }, collapsed ? '›' : '⌄')),
              h('div', { className: 'fo-okr-objective-body' },
                h('header', { className: 'fo-okr-objective-head' },
                  h('div', { className: 'fo-okr-objective-title' },
                    h('h4', {
                      title: 'Double-click to edit Objective',
                      onDoubleClick: () => { setEditing({ type: 'objective', id: obj.id, obj, value: obj.title }); setError('') },
                    }, obj.title),
                  ),
                  h('div', { className: 'fo-okr-labels' },
                    h('span', { className: 'fo-okr-status', 'data-status': objStatus }, STATUS_TEXT[objStatus] || objStatus),
                    h('span', { className: 'fo-okr-label' }, '最晚 ' + deadlineOf(obj.due)),
                  ),
                ),
                editing && editing.type === 'objective' && editing.id === obj.id ? editRow() : null,
                h('div', { className: 'fo-okr-progress' }, h('i', { style: { width: obj.progress + '%' } })),
                h('div', { className: 'fo-okr-meta' },
                  h('span', null, obj.total + ' 个任务'),
                  h('span', null, obj.krs.length + ' 个 Key Result'),
                ),
                collapsed ? null : h('div', { className: 'fo-okr-kr-list' },
                  obj.krs.map((kr, krIndex) => {
                    const open = expanded[kr.id] === true
                    const krStatus = shownStatus(kr)
                    const isLastKr = krIndex === obj.krs.length - 1
                    return h('div', { key: kr.id, className: 'fo-okr-kr' + (open ? ' is-expanded' : '') + (isLastKr ? ' is-last' : ''), 'data-status': krStatus },
                      h('div', { className: 'fo-okr-kr-head' },
                        h('button', {
                          type: 'button', className: 'fo-okr-kr-dot',
                          'aria-expanded': open ? 'true' : 'false',
                          title: open ? 'Collapse tasks' : 'Expand tasks',
                          onClick: () => setExpanded((prev) => ({ ...prev, [kr.id]: !open })),
                        }),
                        h('span', {
                          className: 'fo-okr-kr-title',
                          title: 'Double-click to edit Key Result',
                          onDoubleClick: () => { setEditing({ type: 'kr', id: kr.id, obj, kr, value: kr.title }); setError('') },
                        }, kr.title),
                        h('span', { className: 'fo-okr-kr-nums' }, kr.done + ' / ' + kr.total + ' 任务'),
                        h('span', { className: 'fo-okr-kr-status', 'data-status': krStatus }, STATUS_TEXT[krStatus] || krStatus),
                      ),
                      editing && editing.type === 'kr' && editing.id === kr.id ? editRow() : null,
                      h('div', { className: 'fo-okr-kr-progress' }, h('i', { style: { width: kr.progress + '%' } })),
                      h('div', { className: 'fo-okr-kr-foot' },
                        h('span', { className: 'fo-okr-kr-percent' }, kr.progress + '%'),
                        h('div', { className: 'fo-okr-kr-actions' },
                          h('button', {
                            type: 'button', className: 'fo-okr-kr-tasks-btn',
                            title: '在 Plan 视图中只看这个 KR',
                            onClick: () => { if (typeof props.onJumpToView === 'function') props.onJumpToView(kr, 'plan') },
                          }, 'Plan'),
                          h('button', {
                            type: 'button', className: 'fo-okr-kr-tasks-btn',
                            title: '在 Progress 视图中只看这个 KR',
                            onClick: () => { if (typeof props.onJumpToView === 'function') props.onJumpToView(kr, 'progress') },
                          }, 'Progress'),
                        ),
                      ),
                      open
                        ? h('div', { className: 'fo-okr-tasks' },
                          kr.tasks.map((task) => h('button', {
                            key: task.id,
                            type: 'button',
                            className: 'fo-okr-task',
                            title: task.title,
                            onClick: () => { if (typeof props.onOpenTask === 'function') props.onOpenTask(task.id) },
                          },
                            task.priority ? h('span', { className: 'fo-board-prio', 'data-priority': task.priority }, task.priority) : null,
                            h('span', { className: 'fo-okr-task-no' }, task.no ? 'T' + task.no : '任务'),
                            h('span', { className: 'fo-okr-task-title' }, task.title),
                            h('span', { className: 'fo-okr-task-status', 'data-status': task.status }, OPP_STATUS_LABEL[task.status] || task.status),
                          )))
                        : null,
                    )
                  }),
                  h('button', {
                    key: 'add-kr', type: 'button', className: 'fo-okr-add-kr',
                    onClick: () => { setCreating({ mode: 'kr', objective: obj.title, keyResult: '' }); setCreateError('') },
                  }, '+ Key Result'),
                ),
              ),
            )
          }),
        ]
        : h('div', { className: 'fo-opp-empty' }, '这个项目还没有任务，暂无法投影 OPP。'),
    ), createModal())
  }

  const OPP_PLAN_COLUMNS = [
    ['todo', '待办'],
    ['in-progress', '进行中'],
    ['done', '已完成'],
    ['blocked', '阻塞'],
    ['suspended', '已挂起'],
    ['cancelled', '废弃'],
  ]

  const OPP_DRAG_TARGETS = new Set(['done', 'suspended', 'todo', 'in-progress'])

  function OppPlan(props) {
    const [draggingId, setDraggingId] = useState('')
    const [dropStatus, setDropStatus] = useState('')
    /* 只按真实 KR 分组：没填 KR 的任务全部并进同一组，不拿清单名/工作区名冒充（见 buildPlanRows）。 */
    const allTasks = props.model.tasks
    const rows = buildPlanRows(allTasks)
    const canMove = typeof props.onTaskStatus === 'function'
    const move = (id, status) => {
      if (!id || !status || !OPP_DRAG_TARGETS.has(status) || !canMove) { setDraggingId(''); setDropStatus(''); return }
      setDraggingId('')
      setDropStatus('')
      props.onTaskStatus(id, status)
    }
    return h('div', { className: 'fo-opp-plan-wrap' },
      canMove ? h('div', { className: 'fo-opp-plan-hint' }, '拖动任务卡可改状态：待办 / 进行中（仅挂起恢复）、已完成、已挂起；阻塞由依赖决定，废弃暂无数据源。') : null,
      h('div', { className: 'fo-opp-plan-scroll' },
      h('div', { className: 'fo-opp-plan-grid', style: { gridTemplateColumns: '170px repeat(6, minmax(300px, 1fr))' } },
        h('div', { className: 'fo-opp-plan-corner' }, 'Key Results'),
        ...OPP_PLAN_COLUMNS.map(([key, label]) => {
          const count = allTasks.filter((task) => task.status === key).length
          return h('div', { key, className: 'fo-opp-plan-colhead', 'data-status': key },
            h('span', { className: 'fo-board-dot', 'aria-hidden': 'true' }),
            h('span', null, label),
            h('span', { className: 'fo-opp-plan-count' }, String(count)),
          )
        }),
        ...rows.flatMap((row) => [
          h('div', { key: 'head-' + row.id, className: 'fo-opp-plan-rowhead' },
            /* Objective / KR 都只在**有真实值**时才渲染：没有 KR 的组不显示 KR 文案，
               也不拿工作区名顶替 Objective（用户口径：不要填硬编码）。 */
            row.objective ? h('div', { className: 'fo-opp-plan-obj' }, row.objective) : null,
            row.title ? h('div', { className: 'fo-opp-plan-kr', title: row.title }, row.title) : null,
            h('div', { className: 'fo-opp-plan-meta' }, row.done + '/' + row.total + ' · ' + row.progress + '%'),
          ),
          ...OPP_PLAN_COLUMNS.map(([status]) => {
            const items = row.tasks.filter((task) => task.status === status)
            const drop = canMove && OPP_DRAG_TARGETS.has(status)
            return h('div', {
              key: 'cell-' + row.id + '-' + status,
              className: 'fo-opp-plan-cell' + (dropStatus === status ? ' is-drop' : ''),
              'data-status': status,
              onDragOver: drop ? (event) => { event.preventDefault(); setDropStatus(status) } : undefined,
              onDragLeave: drop ? (event) => {
                if (event.currentTarget && event.currentTarget.contains(event.relatedTarget)) return
                if (dropStatus === status) setDropStatus('')
              } : undefined,
              onDrop: drop ? (event) => {
                event.preventDefault()
                const id = event.dataTransfer.getData('text/plain') || draggingId
                move(id, status)
              } : undefined,
            },
              items.length
                ? items.map((task) => h(OppTaskCard, {
                  key: task.id, task,
                  dragging: draggingId === task.id,
                  onStatusMove: (id) => { setDraggingId(id || ''); if (!id) setDropStatus('') },
                  onOpenTask: props.onOpenTask,
                  onFocusTask: props.onFocusTask,
                  onOpenSession: props.onOpenSession,
                  onTaskStatus: props.onTaskStatus,
                  onEditField: props.onEditField,
                  onTaskUpdated: props.onTaskUpdated,
                  api: props.api,
                  workspaces: props.workspaces,
                }))
                : h('span', { className: 'fo-opp-plan-empty' }, '—'),
            )
          }),
        ]),
      ),
    ))
  }

  function OppProgress(props) {
    const openTask = (id) => { if (typeof props.onOpenTask === 'function') props.onOpenTask(id) }
    const tasks = props.model.tasks.filter((task) => task.start && task.end && task.end > task.start)
    if (!tasks.length) return h('div', { className: 'fo-opp-empty' }, '任务还没有开始/结束时间，暂时画不出进度。')
    const rows = props.model.objectives.flatMap((obj) => obj.krs.map((kr) => ({ obj, kr, tasks: kr.tasks.filter((task) => task.start && task.end && task.end > task.start) })))
      .filter((row) => row.tasks.length)
    const min = Math.min(...tasks.map((task) => task.start))
    const max = Math.max(...tasks.map((task) => task.end))
    const range = Math.max(max - min, 24 * 60 * 60 * 1000)
    const pct = (time) => Math.max(0, Math.min(100, ((time - min) / range) * 100))
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => fmtOppDate(min + range * p))
    const today = Date.now()
    const todayPct = today >= min && today <= max ? pct(today) : null
    return h('div', { className: 'fo-gantt' },
      h('div', { className: 'fo-gantt-axis' },
        h('div', { className: 'fo-gantt-axis-label' }, 'Key Results'),
        h('div', { className: 'fo-gantt-axis-track' }, ticks.map((label) => h('span', { key: label }, label))),
      ),
      h('div', { className: 'fo-gantt-body' },
        rows.map(({ obj, kr, tasks: rowTasks }) => h('div', { key: kr.id, className: 'fo-gantt-row' },
          h('div', { className: 'fo-gantt-label' },
            h('div', { className: 'fo-gantt-obj' }, obj.title),
            h('div', { className: 'fo-gantt-kr', title: kr.title }, kr.title),
            h('div', { className: 'fo-gantt-meta' }, kr.done + '/' + kr.total + ' · ' + kr.progress + '%'),
          ),
          h('div', { className: 'fo-gantt-track', style: { height: Math.max(38, rowTasks.length * 26 + 12) + 'px' } },
            todayPct != null ? h('i', { className: 'fo-gantt-today', style: { left: todayPct + '%' }, 'aria-hidden': 'true' }) : null,
            rowTasks.map((task, index) => h('div', {
              key: task.id,
              className: 'fo-gantt-bar',
              'data-status': task.status,
              title: task.title,
              role: 'button',
              tabIndex: 0,
              style: { left: pct(task.start) + '%', width: Math.max(4, pct(task.end) - pct(task.start)) + '%', top: (index * 26 + 6) + 'px' },
              onClick: () => openTask(task.id),
              onKeyDown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTask(task.id) }
              },
            },
              h('span', { className: 'fo-gantt-bar-no' }, task.no ? 'T' + task.no : ''),
              h('span', { className: 'fo-gantt-bar-title' }, task.title),
            )),
          ),
        )),
        h('div', { className: 'fo-gantt-axis-bottom' },
          h('span', null, fmtOppDate(min)),
          h('span', null, fmtOppDate(max)),
        ),
      ),
    )
  }


  return function GraphFlowFeature(props) {
    const ctx = props || {}
    const {
      graphs, selectedId = '', focusedId = '', nodePos, taskById,
      onOpenTask, onFocusTask, onOpenSession, onTaskStatus, onTaskUpdated, onNodeMove, onResetLayout, onBlur,
      workspaces, revealIds,
    } = ctx
    const list = Array.isArray(graphs) ? graphs : []
    const graphsRef = useRef(null)
    const [stageWidth, setStageWidth] = useState(0)
    const layoutWidth = stageWidth > 0 ? Math.max(400, stageWidth - 96) : 1360
    /* 卡片宽度跟着画布走：宽画布里 360 太窄，左右两坨空白；窄画布里维持 360 不再压。 */
    /* 卡片宽度跟着画布走：宽画布里 360 太窄，左右两坨空白；窄画布里维持 360 不再压。 */
    const flowNodeW = stageWidth > 0 ? Math.max(FLOW_NODE_W, Math.min(560, Math.round(stageWidth * 0.34))) : FLOW_NODE_W
    const [filters, setFilters] = useState(readSavedFilters)
    const [filterOpen, setFilterOpen] = useState({})
    const [viewMode, setViewMode] = useState(readView)
    const [krScope, setKrScope] = useState(null)
    const [cardEdit, setCardEdit] = useState(null)
    const openCardEditor = useCallback((id, field) => setCardEdit({ id, field }), [])
    useEffect(() => {
      try { if (store && typeof store.set === 'function') store.set('graphView', viewMode) } catch (error) { /* 视图偏好不值得报错 */ }
    }, [viewMode])

    const patchFilter = (key, patch) => setFilters((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), ...patch },
    }))
    useEffect(() => {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters || {}))
        }
      } catch {
        /* 隐私模式/配额满：筛选仍在本页生效，不阻断页面 */
      }
    }, [filters])
    const jumpToKr = (graphKey, kr, mode) => {
      if (!kr) return
      setKrScope({ graphKey, objectiveId: kr.objectiveId || '', krTitle: kr.title || '' })
      setViewMode(mode === 'progress' ? 'progress' : 'plan')
    }
    const addRelation = (from, to) => {
      if (!from || !to || from === to) return
      const write = props.api && props.api.relationWrite
      if (typeof write !== 'function') { if (typeof window !== 'undefined' && window.alert) window.alert('当前宿主不支持修改关系'); return }
      write({ taskId: to, otherId: from, kind: 'depends_on', action: 'add' }).then((result) => {
        if (!result || result.ok === false) throw new Error((result && result.error) || '关系保存失败')
        if (typeof props.onTaskUpdated === 'function') props.onTaskUpdated()
      }).catch((error) => {
        if (typeof window !== 'undefined' && window.alert) window.alert(error instanceof Error ? error.message : String(error || '关系保存失败'))
      })
    }
    const removeRelation = (from, to, kind) => {
      if (!from || !to || from === to) return
      const write = props.api && props.api.relationWrite
      if (typeof write !== 'function') { if (typeof window !== 'undefined' && window.alert) window.alert('当前宿主不支持修改关系'); return }
      write({ taskId: to, otherId: from, kind: kind || 'depends_on', action: 'remove' }).then((result) => {
        if (!result || result.ok === false) throw new Error((result && result.error) || '关系删除失败')
        if (typeof props.onTaskUpdated === 'function') props.onTaskUpdated()
      }).catch((error) => {
        if (typeof window !== 'undefined' && window.alert) window.alert(error instanceof Error ? error.message : String(error || '关系删除失败'))
      })
    }
    const filterFor = (key) => {
      const raw = filters[key] || {}
      const filter = { ...DEFAULT_FILTER, ...raw }
      /* 聚合视图默认要包含已完成，否则 OKR/Plan/Progress 的进度只剩未完成任务；
         只有用户显式点过“已完成”开关时，才按开关过滤。 */
      if (viewMode !== 'workflow' && !Object.prototype.hasOwnProperty.call(raw, 'done')) filter.done = true
      return filter
    }

    const viewGraphs = useMemo(() => list.map((graph) => {
      const filter = filterFor(graph.key)
      const keepNode = (node) => {
        if (!node || node.ghost === true) return true
        const state = node.state || 'open'
        if (state === 'done' && Array.isArray(revealIds) && revealIds.indexOf(node.id) >= 0) return true
        const scopedTask = taskById && taskById[node.id]
        if (krScope && krScope.graphKey === graph.key && scopedTask && (scopedTask.objective !== krScope.objectiveId || scopedTask.keyResult !== krScope.krTitle)) return false
        if (!inDateRange(scopedTask, filter.days)) return false
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
      const compactNodes = nodes.map((node) => ({ ...node, w: flowNodeW, h: FLOW_NODE_H }))
      const laid = nodes.length
        ? relayoutGraph({ ...graph, top: 0, nodes: compactNodes, edges }, { maxWidth: Math.max(layoutWidth, 1400), rankdir: 'LR', ranksep: 96, nodesep: 28 })
        : { ...graph, top: 0, nodes: [], edges: [], width: Math.max(1, graph.width), height: Math.max(1, graph.height) }
      return { graph: { ...laid, top: 0 }, raw: graph, allNodes, nodes: laid.nodes || [], edges: laid.edges || [] }
    }), [list, filters, revealIds, taskById, layoutWidth, flowNodeW, viewMode, krScope])

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


    const renderFilter = (graph, filter) => {
      const configured = Boolean(filters[graph.key] && Object.keys(filters[graph.key]).length)
      return h('div', { className: 'fo-filter-wrap is-title-filter' },
      h('button', {
        type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
        'data-action': 'open-filter',
        'data-active': configured ? '1' : '0',
        'aria-expanded': filterOpen[graph.key] === true ? 'true' : 'false',
        onClick: () => setFilterOpen((prev) => (prev[graph.key] === true ? {} : { [graph.key]: true })),
      }, '筛选'),
      filterOpen[graph.key] === true ? h('div', { className: 'fo-filter-pop', role: 'group', 'aria-label': '筛选条件' },
        h('div', { className: 'fo-filter-row' },
          h('span', { className: 'fo-filter-label' }, '状态'),
          ...FILTER_STATUSES.map(([key, label]) => h('button', {
            key, type: 'button', className: 'fo-filter-chip',
            'data-action': 'filter-status-' + key,
            'data-active': filter[key] !== false ? '1' : '0',
            onClick: () => patchFilter(graph.key, { [key]: filter[key] === false }),
          }, label))),
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
            onClick: () => { setFilters((prev) => ({ ...prev, [graph.key]: {} })); setFilterOpen((prev) => ({ ...prev, [graph.key]: false })) },
          }, '恢复默认'),
          h('span', { className: 'fo-filter-hint' }, '按开始时间；与是否完成无关'),
        ),
      ) : null,
      )
    }


  function CardFieldEditor(props) {
    const { edit, task, workspaces: wsList, onClose } = props
    const { useState } = React
    const field = edit && edit.field
    const blank = field === 'objective' || field === 'keyResult'
    const [priority, setPriority] = useState(task && task.priority || '')
    const [value, setValue] = useState(() => {
      if (field === 'start') {
        const ts = Number(task && task.startTs) || parseOppDate(task && task.start)
        return ts ? toLocalInput(ts) : ''
      }
      if (field === 'eta') {
        const ts = Number(task && task.commitment && task.commitment.expectedAt)
        return ts ? toLocalInput(ts) : ''
      }
      if (field === 'schedule') {
        const ts = Number(task && task.schedule && task.schedule.nextAt)
        return ts ? toLocalInput(ts) : ''
      }
      if (field === 'workspace') return (task && (task.workspaceKey || task.workspaceId)) || ''
      if (field === 'objective') return (task && task.objective) || ''
      if (field === 'keyResult') return (task && task.keyResult) || ''
      return ''
    })
    const [kr, setKr] = useState((task && task.keyResult) || '')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const title = field === 'priority' ? '设置优先级'
      : field === 'start' ? '编辑开始时间'
      : field === 'schedule' ? '编辑定时'
      : field === 'eta' ? '编辑预期完成'
      : field === 'workspace' ? '切换工作区'
      : field === 'objective' ? '编辑 O / KR'
      : field === 'keyResult' ? '编辑 KR / O'
      : '编辑任务'
    const run = async (clear) => {
      const apiName = field === 'priority' ? 'taskPriority'
        : field === 'start' ? 'taskStartTime'
        : field === 'eta' ? 'taskEta'
        : field === 'schedule' ? 'taskSchedule'
        : field === 'workspace' ? 'workspaceBind'
        : 'okrApply'
      const fn = api && typeof api[apiName] === 'function' ? api[apiName] : null
      if (!fn) { setError('当前宿主不支持这个编辑接口'); return }
      setBusy(true)
      setError('')
      try {
        let result
        if (field === 'priority') result = await fn(task.id, clear ? '' : priority)
        else if (field === 'start') result = await fn(task.id, value ? new Date(value).getTime() : 0)
        else if (field === 'eta') result = await fn(task.id, clear ? '' : value.replace('T', ' '), clear ? 'clear' : 'set')
        else if (field === 'schedule') result = await fn(task.id, clear ? '' : value.replace('T', ' '), clear ? 'clear' : 'set')
        else if (field === 'workspace') result = await fn(task.id, value)
        else {
          const objective = field === 'objective' ? value : (task.objective || '')
          const keyResult = field === 'keyResult' ? value : kr
          result = await fn([{ id: task.id, objective, keyResult }])
        }
        if (!result || result.ok === false) throw new Error((result && result.error) || '保存失败')
        if (typeof props.onSaved === 'function') props.onSaved()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    }
    const rows = []
    if (field === 'priority') {
      rows.push(h('div', { key: 'prio', className: 'fo-fieldedit-choices' },
        ['P0', 'P1', 'P2', 'P3'].map((p) => h('button', {
          key: p, type: 'button', className: 'fo-fieldedit-choice',
          'data-active': priority === p ? '1' : '0',
          onClick: () => setPriority(p),
        }, p)),
        h('button', { type: 'button', className: 'fo-fieldedit-choice', 'data-active': !priority ? '1' : '0', onClick: () => setPriority('') }, '清除'),
      ))
    } else if (field === 'workspace') {
      rows.push(h('select', {
        key: 'ws', className: 'fo-fieldedit-input', value,
        onChange: (event) => setValue(event.currentTarget.value),
      },
        h('option', { value: '' }, '选择工作区…'),
        (Array.isArray(wsList) ? wsList : []).map((w) => h('option', { key: w.key || w.id, value: w.key || w.id }, w.title || w.key || w.id)),
      ))
    } else if (field === 'objective' || field === 'keyResult') {
      rows.push(h('label', { key: 'o', className: 'fo-fieldedit-label' }, 'Objective',
        h('input', { className: 'fo-fieldedit-input', value: field === 'objective' ? value : (task.objective || ''), onChange: (event) => { if (field === 'objective') setValue(event.currentTarget.value) } })
      ))
      rows.push(h('label', { key: 'kr', className: 'fo-fieldedit-label' }, 'Key Result',
        h('input', { className: 'fo-fieldedit-input', value: field === 'keyResult' ? value : kr, onChange: (event) => { if (field === 'keyResult') setValue(event.currentTarget.value); else setKr(event.currentTarget.value) } })
      ))
    } else {
      rows.push(h('input', {
        key: 'time', className: 'fo-fieldedit-input', type: 'datetime-local', value,
        onChange: (event) => setValue(event.currentTarget.value),
      }))
    }
    return h('div', { className: 'fo-fieldedit-backdrop', onClick: onClose },
      h('div', { className: 'fo-fieldedit', onClick: (event) => event.stopPropagation() },
        h('div', { className: 'fo-fieldedit-head' },
          h('b', null, title),
          h('button', { type: 'button', className: 'fo-fieldedit-close', onClick: onClose, 'aria-label': '关闭' }, '×'),
        ),
        h('div', { className: 'fo-fieldedit-task' }, task && task.title || ''),
        ...rows,
        error ? h('div', { className: 'fo-fieldedit-error' }, error) : null,
        h('div', { className: 'fo-fieldedit-actions' },
          (field === 'eta' || field === 'schedule' || field === 'priority')
            ? h('button', { type: 'button', className: 'fo-btn', disabled: busy, onClick: () => run(true) }, '清除')
            : null,
          h('button', { type: 'button', className: 'fo-btn', 'data-variant': 'primary', disabled: busy, onClick: () => run(false) }, busy ? '保存中…' : '保存'),
        ),
      ),
    )
  }

  function toLocalInput(ms) {
    const d = new Date(Number(ms))
    if (!Number.isFinite(d.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  }

    const editTask = cardEdit ? (taskById && taskById[cardEdit.id]) : null
    return h(React.Fragment, null, h('div', { className: 'fo-graphs fo-flow-graphs', ref: graphsRef },
      list.length
        ? viewGraphs.map(({ graph, allNodes, nodes, edges }, index) => {
          const filter = filterFor(graph.key)
          const taskCount = nodes.filter((node) => node.ghost !== true).length
          const boardNodes = nodes.filter((node) => node.ghost !== true)
          const fullOpp = mergeEmptyOkr(buildOpp(allNodes, taskById), props.okr)
          const opp = mergeOppStats(mergeEmptyOkr(buildOpp(nodes, taskById), props.okr), fullOpp)
          /* OKR 页只显示显式配置了 O + KR 的任务；没有 OKR 的任务不落进默认分组。 */
          const okrAssigned = (node) => {
            if (!node || node.ghost === true) return true
            const task = taskById && taskById[node.id]
            return !!(task && String(task.objective || '').trim() && String(task.keyResult || '').trim())
          }
          const okrFullOpp = mergeEmptyOkr(buildOpp(allNodes.filter(okrAssigned), taskById), props.okr)
          const okrShownOpp = mergeEmptyOkr(buildOpp(nodes.filter(okrAssigned), taskById), props.okr)
          const okrOpp = mergeOppStructure(okrShownOpp, okrFullOpp)
          const displayCount = taskCount
          const legend = Array.isArray(graph.legend) ? graph.legend : []
          const titleLabel = graph.kind === 'ungrouped' ? '未分类' : graph.label
          const hasLocal = !!(nodePos && typeof nodePos === 'object' && Object.keys(nodePos[graph.key] || {}).length)
          const empty = !nodes.some((node) => node.ghost !== true)
          const viewEmpty = empty && (viewMode !== 'okr' || !okrOpp.objectives.length)
          const onlyDone = allNodes.length > 0 && allNodes.every((node) => node.ghost === true || node.done === true)
          const workflowToolbar = viewMode === 'workflow' ? h('div', { className: 'fo-flow-float-actions', role: 'toolbar', 'aria-label': 'Workflow 工具' },
            h('button', {
              type: 'button', className: 'fo-flow-float-btn',
              'data-action': 'graph-reset', disabled: !hasLocal,
              title: hasLocal ? '清掉手动拖动位置，按依赖重新布局' : '还没有拖动过节点',
              onClick: () => { if (typeof onResetLayout === 'function') onResetLayout(graph.key) },
            }, '重置布局'),
            focusedId ? h('button', {
              type: 'button', className: 'fo-flow-float-btn',
              'data-action': 'blur', title: '取消聚焦（Esc）',
              onClick: () => { if (typeof onBlur === 'function') onBlur() },
            }, '取消聚焦') : null,
          ) : null
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
                  sideCardCount(h, { count: displayCount, kind: 'group', title: graph.label || '' }),
                ),
                renderFilter(graph, filter),
                krScope && krScope.graphKey === graph.key
                  ? h('button', { type: 'button', className: 'fo-scope-chip', title: '清除 KR 范围', onClick: () => setKrScope(null) }, 'KR: ' + krScope.krTitle + ' ×')
                  : null,
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
                h('div', { className: 'fo-view-switch', role: 'tablist', 'aria-label': '项目视图' },
                  [['workflow', 'Workflow'], ['okr', 'OKR'], ['plan', 'Plan'], ['progress', 'Progress']].map(([key, label]) =>
                    h('button', {
                      key, type: 'button', className: 'fo-view-btn', role: 'tab',
                      'data-action': 'view-' + key,
                      'data-active': viewMode === key ? '1' : '0',
                      'aria-selected': viewMode === key ? 'true' : 'false',
                      title: key === 'workflow' ? '依赖关系工作流' : key === 'okr' ? '目标与关键结果' : key === 'plan' ? 'Key Result × 任务状态' : '任务时间轴与进度',
                      onClick: () => { setViewMode(key); setKrScope(null) },
                    }, label)),
                ),
              ),
            ),
            viewMode === 'workflow'
              ? (empty
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
                  onOpenSession,
                  onTaskStatus,
                  onEditField: openCardEditor,
                  onTaskUpdated,
                  api,
                  workspaces,
                  onRelation: addRelation,
                  onRemoveRelation: removeRelation,
                  onNodeMove,
                  onBlur,
                  nodeWidth: flowNodeW,
                  toolbar: workflowToolbar,
                }))
              : viewEmpty
                ? h('div', { className: 'fo-flow-empty' },
                  h('div', { className: 'fo-placeholder-title' }, onlyDone ? '这里的任务都已完成' : (allNodes.length ? '当前筛选没有任务' : '这个目录里还没有在场的工作区')),
                  h('div', { className: 'fo-placeholder-body' }, onlyDone ? '已完成默认不画。打开筛选勾上「已完成」就能看到它们。' : (allNodes.length ? '放宽状态或时间范围，或者点筛选面板里的「恢复默认」。' : '把左栏的项目拖进这个目录即可。')),
                )
                : h('div', { className: 'fo-opp-content' + (viewMode === 'okr' ? ' fo-opp-content-okr' : '') },
                  viewMode === 'okr'
                    ? h(OppOkr, { model: okrOpp, onOpenTask, onTaskUpdated, api, onJumpToView: (kr, view) => jumpToKr(graph.key, kr, view) })
                    : viewMode === 'plan'
                      ? h(OppPlan, { model: opp, onOpenTask, onFocusTask, onOpenSession, onTaskStatus, onEditField: openCardEditor, onTaskUpdated, api, workspaces })
                      : h(OppProgress, { model: opp, onOpenTask }),
                ),
          )
        })
        : h('div', { className: 'fo-placeholder' },
          h('div', { className: 'fo-placeholder-title' }, '这个范围里没有可画的图'),
          h('div', { className: 'fo-placeholder-body' }, '把项目拖进自定义目录，或者换一个目录页。'),
        )),
      cardEdit && editTask ? h(CardFieldEditor, {
        key: cardEdit.id + ':' + cardEdit.field,
        edit: cardEdit,
        task: editTask,
        workspaces,
        onClose: () => setCardEdit(null),
        onSaved: onTaskUpdated,
      }) : null)
  }
}

export default createGraphFlowFeature
