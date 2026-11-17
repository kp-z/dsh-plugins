/**
 * 「整理」建议抽屉 —— 工厂组件，模块顶层不 import react。
 *
 * 现在是**时间轴 + 分组**：每次「整理」= 一组（一批建议），默认只展开/显示最新一组，
 * 「加载更多」往上翻旧组；一组处理完（没有 pending）自动归档成只读（可撤销）。
 * 「接受以上」只作用于**当前（最新）这一组**，按钮上直接写条数。
 *
 * props：
 *   open, groups（新→旧）, visible, status, failed
 *   scopeLabel(batch)    组标题里的范围文案
 *   onLoadMore() onAcceptGroup(batchId, ids) onRejectGroup(batchId, ids) onUndoGroup(batchId, ids)
 *   onRetrySync(item) onRerun() onClose() onToggleDock() docked
 */
import * as modelModule from '../overview/model.js'

const KIND_LABEL = { depends_on: '前置', derived_from: '来源', temporal: '时间', eta: '预期完成' }

/* 面板里的按钮全部用图标；文案只放在 title / aria-label 里。 */
const ICON_PATHS = {
  dock: ['M4 4h16v16H4z', 'M15 4v16'],
  sparkles: ['M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z', 'M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  check: ['M5 13l4 4L19 7'],
  reject: ['M6 6l12 12', 'M18 6L6 18'],
  undo: ['M9 7H5v4', 'M5 11a7 7 0 1 0 2.5-5.4'],
  more: ['M6 14l6-6 6 6'],
  sync: ['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v5h-5'],
}

/** 时间戳 → 「10-30 18:00」。 */
export function etaText(value) {
  const n = Number(value)
  if (!isFinite(n) || n <= 0) return ''
  const d = new Date(n)
  if (Number.isNaN(d.getTime())) return ''
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function confidenceText(value) {
  const n = Number(value)
  if (!isFinite(n) || n <= 0) return ''
  const pct = Math.max(1, Math.min(100, Math.round(n > 1 ? n : n * 100)))
  return `${pct}%`
}

function countOf(batch, items, key, status) {
  const raw = batch ? batch[key] : undefined
  const n = Number(raw)
  if (raw !== null && raw !== undefined && raw !== '' && isFinite(n) && n >= 0) return n
  return items.filter((item) => item.status === status).length
}

export function createOrganizeDrawer(deps) {
  const { h, React } = deps || {}
  const model = (deps && deps.model) || modelModule
  const { useState, useEffect, useRef } = React || {}

  const icon = (name) => h('svg', {
    className: 'fo-org-icon', width: 14, height: 14, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }, (ICON_PATHS[name] || []).map((d, i) => h('path', { key: i, d })))

  /* 默认只放图标；options.text 给组级主动作补一句可见文字（title / aria-label 仍保留完整说明）。 */
  const iconBtn = (action, name, title, onClick, options = {}) => {
    const label = model.str(options.text)
    return h('button', {
      type: 'button', className: 'fo-icon-btn' + (label ? ' has-label' : ''), 'data-action': action,
      title, 'aria-label': title,
      disabled: options.disabled === true,
      'aria-pressed': options.pressed === undefined ? undefined : (options.pressed ? 'true' : 'false'),
      onClick,
    },
      icon(name),
      label ? h('span', { className: 'fo-icon-btn-label' }, label) : null,
    )
  }

  return function OrganizeDrawer(props) {
    const p = props || {}
    if (p.open !== true) return null
    const status = model.str(p.status) || 'idle'
    const failed = p.failed
    const running = status === 'running'
    /* 只有「生成建议」才显示分析动画；接受/拒绝/撤销的 running 不算。 */
    const generating = running && model.str(p.phase) === 'organize'
    const docked = p.docked === true
    const visible = Math.max(1, Number(p.visible) || 1)
    const groups = Array.isArray(p.groups) && p.groups.length
      ? p.groups
      : (p.batch ? [p.batch] : [])
    const latest = groups[0] || null
    const latestItems = Array.isArray(latest && latest.items) ? latest.items : []


    const [expanded, setExpanded] = useState({})
    /* 「当前组」= 用户正在看/展开的那一组（默认最新）。接受以上只作用于它。 */
    const latestId = model.str(latest && latest.batchId)
    const [activeId, setActiveId] = useState(latestId)
    const listRef = useRef ? useRef(null) : null
    useEffect(() => { if (latestId) setActiveId(latestId) }, [latestId])

    /* 打开 / 出新组时滚到最底（最新一组在底部）；「加载更多」不动滚动位置，
       否则用户点完加载却被拽回底部，看不到刚展开的旧归档组。 */
    useEffect(() => {
      const node = listRef && listRef.current
      if (!node) return
      node.scrollTop = node.scrollHeight
    }, [p.open, latestId, status])

    const toggleGroup = (batchId) => {
      const opening = !isOpen({ batchId })
      if (opening) setActiveId(batchId)
      setExpanded((prev) => ({ ...prev, [batchId]: !(prev[batchId] === true) }))
    }
    const isOpen = (batch) => {
      const id = model.str(batch && batch.batchId)
      if (Object.prototype.hasOwnProperty.call(expanded, id)) return expanded[id] === true
      /* 处理完（无 pending 且有已接受/已拒绝）的组默认收起成「已归档」，点组头可再展开回看。 */
      const items = Array.isArray(batch && batch.items) ? batch.items : []
      const pending = items.filter((item) => item.status === 'pending').length
      const processed = items.filter((item) => item.status === 'accepted' || item.status === 'rejected').length
      if (pending === 0 && processed > 0) return false
      return batch === latest
    }

    const itemNode = (item, batch, current) => {
      const kindLabel = KIND_LABEL[item.kind] || model.str(item.kind)
      const conf = confidenceText(item.confidence)
      const impact = model.isObj(item.impact) ? item.impact : {}
      const blocked = Array.isArray(impact.blocked) ? impact.blocked.filter((row) => model.str(row)) : []
      const failure = failed && typeof failed === 'object' ? failed[item.id] : ''
      const isPending = current && item.status === 'pending'
      const children = [
        h('div', { key: 'top', className: 'fo-org-top' },
          h('span', { className: 'fo-org-kind', 'data-kind': item.kind }, kindLabel),
          conf ? h('span', { className: 'fo-org-conf', title: '模型自评的把握' }, conf) : null,
        ),
        item.kind === 'eta'
          ? h('div', { key: 'route', className: 'fo-org-route' },
            h('span', { className: 'fo-org-from', title: item.from || '' }, model.str(item.fromTitle) || model.str(item.from)),
            h('span', { className: 'fo-org-arrow', 'aria-hidden': 'true' }, '→'),
            h('span', { className: 'fo-org-to', title: '预期完成' }, etaText(item.value)),
          )
          : h('div', { key: 'route', className: 'fo-org-route' },
            h('span', { className: 'fo-org-from', title: item.from || '' }, model.str(item.fromTitle) || model.str(item.from)),
            h('span', { className: 'fo-org-arrow', 'aria-hidden': 'true' }, '→'),
            h('span', { className: 'fo-org-to', title: item.to || '' }, model.str(item.toTitle) || model.str(item.to)),
          ),
      ]
      if (model.str(item.evidence)) {
        children.push(h('blockquote', { key: 'evidence', className: 'fo-org-evidence' }, model.str(item.evidence)))
      }
      if (blocked.length) {
        children.push(h('p', { key: 'impact', className: 'fo-org-impact', 'data-tone': 'warn' },
          `会让《${blocked[0]}》变成阻塞：前置没完成它就开不了工`))
      } else if (model.str(impact.note)) {
        children.push(h('p', { key: 'impact', className: 'fo-org-impact', 'data-tone': 'idle' }, model.str(impact.note)))
      }
      if (failure) {
        children.push(h('p', { key: 'fail', className: 'fo-org-fail', role: 'alert' }, `没落库：${failure}`))
      } else if (model.str(item.warning)) {
        children.push(h('p', { key: 'warn', className: 'fo-org-impact', 'data-tone': 'idle' }, model.str(item.warning)))
        if (typeof p.onRetrySync === 'function' && item.kind !== 'eta') {
          children.push(h('div', { key: 'sync', className: 'fo-org-item-actions' },
            iconBtn('retry-sync', 'sync', '同步到飞书', () => p.onRetrySync(item), { disabled: running }),
          ))
        }
      }
      if (isPending) {
        const batchId = model.str(batch && batch.batchId)
        children.push(h('div', { key: 'actions', className: 'fo-org-item-actions' },
          iconBtn('accept', 'check', '接受这条', () => { if (typeof p.onAcceptGroup === 'function') p.onAcceptGroup(batchId, [item.id]) }, { disabled: running }),
          iconBtn('reject', 'reject', '拒绝这条', () => { if (typeof p.onRejectGroup === 'function') p.onRejectGroup(batchId, [item.id]) }, { disabled: running }),
        ))
      } else {
        children.push(h('span', { key: 'done', className: 'fo-org-done' },
          item.status === 'accepted' ? '已接受'
            : (item.status === 'undone' ? '已撤销'
              : (item.status === 'rejected' ? '已拒绝' : (item.status === 'dropped' ? '已丢弃' : '')))))
      }
      return h('article', {
        key: item.id,
        className: 'fo-org-item',
        'data-id': item.id,
        'data-kind': item.kind,
        'data-status': item.status,
      }, children)
    }

    const groupNode = (batch) => {
      const allItems = Array.isArray(batch && batch.items) ? batch.items : []
      /* dropped 是「校验阶段被丢弃」的条目，不混进正常卡片列表（只在顶部折叠区展示原因）。 */
      const items = allItems.filter((item) => item.status !== 'dropped')
      const pending = items.filter((item) => item.status === 'pending')
      const accepted = items.filter((item) => item.status === 'accepted')
      const rejected = items.filter((item) => item.status === 'rejected')
      const current = batch === latest
      const open = isOpen(batch)
      const batchId = model.str(batch && batch.batchId)
      const isActive = !!batchId && batchId === (activeId || latestId)
      /* 不再要求「不是最新」：最新一组处理完也自动归档（否则永远停在当前态、没法收起来）。 */
      const archived = pending.length === 0 && (accepted.length + rejected.length) > 0
      return h('section', {
        key: batchId,
        className: 'fo-org-group' + (current ? ' is-current' : '') + (archived ? ' is-archived' : '') + (isActive ? ' is-active' : ''),
        'data-group': batchId,
        'data-current': current ? '1' : '0',
        'data-active': isActive ? '1' : '0',
      },
        h('div', { className: 'fo-org-group-head' },
          h('button', {
            type: 'button', className: 'fo-org-group-toggle', 'data-action': 'toggle-group',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => toggleGroup(batchId),
          },
            h('span', { className: 'fo-org-group-time' }, etaText(batch.at)),
            h('span', { className: 'fo-org-group-counts' },
              (pending.length ? `待处理 ${pending.length}` : '')
              + (accepted.length ? `${pending.length ? ' · ' : ''}已接受 ${accepted.length}` : '')
              + (rejected.length ? `${(pending.length || accepted.length) ? ' · ' : ''}已拒绝 ${rejected.length}` : '')
              + (archived ? ' · 已归档' : '')),
          ),
          /* 归档后收起时，撤销仍留在组头，避免必须先展开才能回退。 */
          !open && accepted.length && typeof p.onUndoGroup === 'function'
            ? h('div', { className: 'fo-org-group-actions' },
              iconBtn('undo-accepted', 'undo', `撤销本组已接受（${accepted.length} 条）`, () => p.onUndoGroup(batchId, []), { disabled: running, text: '撤销' }))
            : null,
        ),
        open
          ? h('div', { className: 'fo-org-group-body' },
            items.length
              ? items.map((item) => itemNode(item, batch, isActive))
              : h('p', { className: 'fo-org-empty' }, generating ? '正在生成…' : '没有找到关系'),
            /* 只有存在可操作/可撤销的条目时才显示组操作行；空组不再放两个灰按钮。 */
            (pending.length || accepted.length)
              ? h('div', { className: 'fo-org-group-actions' },
              iconBtn('accept-all', 'check', `接受本组全部（${pending.length} 条）`, () => {
                if (typeof p.onAcceptGroup === 'function') p.onAcceptGroup(batchId, [])
              }, { disabled: running || !pending.length, text: '接受全部' }),
              iconBtn('reject-all', 'reject', `拒绝本组全部（${pending.length} 条）`, () => {
                if (typeof p.onRejectGroup === 'function') p.onRejectGroup(batchId, [])
              }, { disabled: running || !pending.length, text: '拒绝全部' }),
              accepted.length && typeof p.onUndoGroup === 'function'
                ? iconBtn('undo-accepted', 'undo', `撤销本组已接受（${accepted.length} 条）`, () => p.onUndoGroup(batchId, []), { disabled: running, text: '撤销' })
                : null,
            )
              : null,
          )
          : null,
      )
    }

    /* 拖左边缘改宽度：往左拖变宽。挂 window 监听，指针移出面板也不断。 */
    const resizeCleanup = useRef(null)
    useEffect(() => () => { if (resizeCleanup.current) resizeCleanup.current() }, [])
    const beginResize = (event) => {
      if (event.button != null && Number(event.button) !== 0) return
      if (typeof event.preventDefault === 'function') event.preventDefault()
      /* 指针捕获：与侧栏把手同一口径，拖出 6px 把手也不断 pointermove。 */
      const handle = event.currentTarget
      if (handle && typeof handle.setPointerCapture === 'function' && event.pointerId != null) {
        try { handle.setPointerCapture(event.pointerId) } catch (error) { /* 指针已释放就算了 */ }
      }
      const startX = Number(event.clientX) || 0
      const startWidth = Number(p.width) || 340
      const move = (moveEvent) => {
        const next = startWidth - ((Number(moveEvent.clientX) || 0) - startX)
        if (typeof p.onResize === 'function') p.onResize(next)
      }
      const stop = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
        if (typeof document !== 'undefined') document.body.style.cursor = ''
        resizeCleanup.current = null
      }
      if (resizeCleanup.current) resizeCleanup.current()
      resizeCleanup.current = stop
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop)
      if (typeof document !== 'undefined') document.body.style.cursor = 'col-resize'
    }

    const shown = groups.slice(0, visible).reverse()
    const more = groups.length - visible
    const latestBatch = latest || {}
    const latestDropped = latestItems.filter((item) => item.status === 'dropped')
    const droppedOpen = p.droppedOpen === true
    /** 底栏永远跟着「当前组」：用户展开哪一组，接受以上就作用于哪一组。 */
    const activeBatch = groups.find((batch) => model.str(batch && batch.batchId) === (activeId || latestId)) || latest
    const latestScope = typeof p.scopeLabel === 'function' && activeBatch ? p.scopeLabel(activeBatch) : ''

    return h('aside', { className: 'fo-organize', 'aria-label': '整理建议', 'aria-busy': running ? 'true' : 'false' },
      h('div', {
        className: 'fo-org-resize', 'data-action': 'resize-organize',
        role: 'separator', 'aria-orientation': 'vertical',
        'aria-label': '拖动调整建议栏宽度', title: '拖动调整建议栏宽度',
        onPointerDown: beginResize,
      }),
      h('div', { className: 'fo-org-head' },
        h('div', { className: 'fo-org-head-main' },
          h('span', { className: 'fo-org-title' }, '建议'),
          h('span', { className: 'fo-org-counts' }, latestScope),
        ),
        h('div', { className: 'fo-org-head-actions' },
          iconBtn('dock', 'dock',
            docked ? '现在固定在右侧，点击改成浮层' : '现在是浮层，点击固定到右侧',
            () => { if (typeof p.onToggleDock === 'function') p.onToggleDock() },
            { pressed: docked }),
          /* 不是「重新分析覆盖」，而是再生成一组新的建议（追加到时间轴）。 */
          iconBtn('rerun', 'sparkles',
            generating ? '正在提供新的建议…' : '提供新的建议（按当前范围新加一组）',
            () => { if (typeof p.onRerun === 'function') p.onRerun() },
            { disabled: running }),
          iconBtn('close', 'close', '关闭建议栏', () => { if (typeof p.onClose === 'function') p.onClose() }),
        ),
      ),
      h('div', { className: 'fo-org-list', ref: listRef },
        more > 0
          ? h('div', { className: 'fo-org-load-more' },
            h('button', {
              type: 'button', className: 'fo-btn fo-org-load-more-btn', 'data-size': 'sm', 'data-variant': 'ghost',
              'data-action': 'load-more',
              title: `加载更多（还有 ${more} 组已归档，可回看）`,
              onClick: () => { if (typeof p.onLoadMore === 'function') p.onLoadMore() },
            },
              icon('more'),
              h('span', null, '加载'),
            ))
          : null,
        model.str(p.error)
          ? h('div', { className: 'fo-org-notes', 'data-tone': 'error', role: 'alert' },
            h('span', null, model.str(p.error)),
            typeof p.onRerun === 'function'
              ? h('button', {
                type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                'data-action': 'retry-error', onClick: () => p.onRerun(),
              }, '重试')
              : null)
          : null,

        latestDropped.length
          ? h('div', { className: 'fo-org-dropped' },
            h('button', {
              type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
              'aria-expanded': droppedOpen ? 'true' : 'false',
              onClick: () => { if (typeof p.onToggleDropped === 'function') p.onToggleDropped() },
            }, `已丢弃 ${latestDropped.length} 条（含原因）`),
            droppedOpen
              ? h('div', { className: 'fo-org-dropped-list' }, latestDropped.map((item) => h('div', {
                key: item.id, className: 'fo-org-dropped-item', 'data-id': item.id,
              },
                h('span', { className: 'fo-org-dropped-route' }, `${model.str(item.from) || '?'} → ${model.str(item.to) || '?'}`),
                h('span', { className: 'fo-org-dropped-reason' }, model.str(item.reason) || '未通过校验'),
              )))
              : null,
          )
          : null,
        shown.length
          ? shown.map(groupNode)
          : (generating ? null : h('p', { className: 'fo-org-empty' }, '暂无建议')),
        /* 生成中：spinner 放在列表底部（最新组的位置），不占顶部。 */
        generating
          ? h('div', { className: 'fo-org-loading', role: 'status', 'aria-label': '正在生成建议' }, h('span', { className: 'fo-spinner' }))
          : null,
      ),
    )
  }
}

export default createOrganizeDrawer
