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

  return function OrganizeDrawer(props) {
    const p = props || {}
    if (p.open !== true) return null
    const status = model.str(p.status) || 'idle'
    const failed = p.failed
    const running = status === 'running'
    const docked = p.docked === true
    const visible = Math.max(1, Number(p.visible) || 1)
    const groups = Array.isArray(p.groups) && p.groups.length
      ? p.groups
      : (p.batch ? [p.batch] : [])
    const latest = groups[0] || null
    const latestItems = Array.isArray(latest && latest.items) ? latest.items : []
    const latestPending = latestItems.filter((item) => item.status === 'pending')

    const [expanded, setExpanded] = useState({})
    const listRef = useRef ? useRef(null) : null

    /* 打开 / 有新组 / 加载更多：滚到最底（最新一组在底部）。 */
    useEffect(() => {
      const node = listRef && listRef.current
      if (!node) return
      node.scrollTop = node.scrollHeight
    }, [p.open, groups.length, visible, status])

    const toggleGroup = (batchId) => {
      setExpanded((prev) => ({ ...prev, [batchId]: !(prev[batchId] === true) }))
    }
    const isOpen = (batch) => {
      const id = model.str(batch && batch.batchId)
      if (Object.prototype.hasOwnProperty.call(expanded, id)) return expanded[id] === true
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
            h('button', {
              type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-action': 'retry-sync', disabled: running,
              title: '把这条关系重新写回飞书',
              onClick: () => p.onRetrySync(item),
            }, '同步到飞书'),
          ))
        }
      }
      if (isPending) {
        const batchId = model.str(batch && batch.batchId)
        children.push(h('div', { key: 'actions', className: 'fo-org-item-actions' },
          h('button', {
            type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-action': 'accept', disabled: running,
            onClick: () => { if (typeof p.onAcceptGroup === 'function') p.onAcceptGroup(batchId, [item.id]) },
          }, '接受'),
          h('button', {
            type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', 'data-action': 'reject', disabled: running,
            onClick: () => { if (typeof p.onRejectGroup === 'function') p.onRejectGroup(batchId, [item.id]) },
          }, '拒绝'),
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
      const archived = !current && pending.length === 0 && (accepted.length + rejected.length) > 0
      const scopeText = typeof p.scopeLabel === 'function' ? p.scopeLabel(batch) : ''
      return h('section', {
        key: batchId,
        className: 'fo-org-group' + (current ? ' is-current' : '') + (archived ? ' is-archived' : ''),
        'data-group': batchId,
        'data-current': current ? '1' : '0',
      },
        h('button', {
          type: 'button', className: 'fo-org-group-head', 'data-action': 'toggle-group',
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => toggleGroup(batchId),
        },
          h('span', { className: 'fo-org-group-time' }, etaText(batch.at)),
          h('span', { className: 'fo-org-group-scope' }, scopeText),
          h('span', { className: 'fo-org-group-counts' },
            `待处理 ${pending.length}` + (accepted.length ? ` · 已接受 ${accepted.length}` : '')
            + (rejected.length ? ` · 已拒绝 ${rejected.length}` : '')
            + (archived ? ' · 已归档' : '')),
        ),
        open
          ? h('div', { className: 'fo-org-group-body' },
            items.length
              ? items.map((item) => itemNode(item, batch, current))
              : h('p', { className: 'fo-org-empty' }, running
                ? '正在生成…'
                : (current && batch === latest && !pending.length && !items.some((item) => item.status === 'accepted' || item.status === 'rejected')
                  ? '没有找到新的关系——这常常是正确答案，宁可少而准'
                  : '这一组没有建议')))
          : null,
      )
    }

    const shown = groups.slice(0, visible).reverse()
    const more = groups.length - visible
    const latestBatch = latest || {}
    const latestDropped = latestItems.filter((item) => item.status === 'dropped')
    const droppedOpen = p.droppedOpen === true
    const latestScope = typeof p.scopeLabel === 'function' && latest ? p.scopeLabel(latest) : ''

    return h('aside', { className: 'fo-organize', 'aria-label': '整理建议', 'aria-busy': running ? 'true' : 'false' },
      h('div', { className: 'fo-org-head' },
        h('div', { className: 'fo-org-head-main' },
          h('span', { className: 'fo-org-title' }, '建议'),
          h('span', { className: 'fo-org-counts' }, latestScope ? `当前：${latestScope}` : ''),
        ),
        h('div', { className: 'fo-org-head-actions' },
          h('button', {
            type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
            'data-action': 'dock', 'aria-pressed': docked ? 'true' : 'false',
            title: docked ? '现在固定在右侧（占一列），点击改成浮层' : '现在是浮层（盖在画布上），点击固定到右侧',
            'aria-label': docked ? '切换为浮层' : '切换为固定',
            onClick: () => { if (typeof p.onToggleDock === 'function') p.onToggleDock() },
          }, docked ? '改浮层' : '改固定'),
          h('button', {
            type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
            'data-action': 'rerun', disabled: running,
            title: '按当前范围重新跑一遍分析（会新加一组）',
            onClick: () => { if (typeof p.onRerun === 'function') p.onRerun() },
          }, running ? '分析中…' : '重新分析'),
          h('button', {
            type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
            'data-action': 'close', 'aria-label': '关闭建议栏', title: '关闭',
            onClick: () => { if (typeof p.onClose === 'function') p.onClose() },
          }, '关闭'),
        ),
      ),
      h('div', { className: 'fo-org-list', ref: listRef },
        more > 0
          ? h('button', {
            type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', 'data-action': 'load-more',
            onClick: () => { if (typeof p.onLoadMore === 'function') p.onLoadMore() },
          }, `加载更多（还有 ${more} 组）`)
          : null,
        model.str(latestBatch.notes)
          ? h('p', { className: 'fo-org-notes' }, model.str(latestBatch.notes))
          : null,
        model.str(latestBatch?.model?.error) && latestPending.length
          ? h('p', { className: 'fo-org-notes', 'data-tone': 'muted' },
            `AI 这次没有给出建议（${model.str(latestBatch.model.error)}）；下面是按完成时间排序的兜底建议。`)
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
          : h('p', { className: 'fo-org-empty', 'aria-live': 'polite' }, running
            ? '正在读任务、找前置 / 后置 / 来源关系…（可能十几秒）'
            : '还没有建议：点画布卡片上的「整理」，让 AI 先出一组。'),
      ),
      h('div', { className: 'fo-org-foot' },
        h('button', {
          type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-action': 'accept-all',
          disabled: running || !latestPending.length,
          title: '只接受当前这一组的待处理建议',
          onClick: () => { if (typeof p.onAcceptGroup === 'function' && latest) p.onAcceptGroup(model.str(latest.batchId), []) },
        }, `接受以上（${latestPending.length}）`),
        h('button', {
          type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', 'data-action': 'reject-all',
          disabled: running || !latestPending.length,
          onClick: () => { if (typeof p.onRejectGroup === 'function' && latest) p.onRejectGroup(model.str(latest.batchId), []) },
        }, '拒绝以上'),
        typeof p.onUndoGroup === 'function' && latest && countOf(latest, latestItems, 'accepted', 'accepted')
          ? h('button', {
            type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', 'data-action': 'undo-accepted',
            disabled: running,
            title: '把这一组已接受的关系撤掉（依赖会同时写回飞书，时间先后只在本机）',
            onClick: () => p.onUndoGroup(model.str(latest.batchId), []),
          }, `撤销已接受 ${countOf(latest, latestItems, 'accepted', 'accepted')}`)
          : null,
      ),
    )
  }
}

export default createOrganizeDrawer
