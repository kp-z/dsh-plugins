/**
 * 范围树：三层（全部任务 / 自定义目录 / 项目）—— 工厂组件，模块顶层不 import react。
 *
 * task-17 起它是 **rail 里「关系」这个一级菜单的二级菜单**（`.fo-subnav`），页面里不再有第二列；
 * `compact` = 二级菜单形态（挂在 rail 里）：层级由嵌套容器表达，不再重复一个分组标题。
 *
 * 能力（照 task-8 规格）：
 * - ARIA tree：role=tree/treeitem、aria-level / aria-expanded / aria-selected + roving tabindex；
 *   ←→ 折叠展开、↑↓ 移动、Home/End 到两端、Enter/Space 选中、F2 就地重命名、
 *   Shift+F10 / 菜单键在行上开右键菜单。
 * - 目录的新建 / 就地重命名 / 删除：输入框与按钮都在**组件内**，写操作通过 props 回调交给
 *   OverviewPanel（组件自己不 fetch、不碰 localStorage、不碰 document.body）。
 * - 拖拽：项目行可拖，目录行 / 未分组行 / 全部任务行是放置目标；拖到「未分组」= 移出目录。
 *
 * props（由 OverviewPanel 传）：
 *   tree                     model.buildTree(...) 的结果 {rows, byKey, lanes, scope, selected}
 *   renamingId, creating     '' / 目录 id；creating=true 时显示新建输入行
 *   creatingFor              '' | 项目 key（新建后自动移入该项目）
 *   dragKey, dropKey         拖拽中的行 key / 悬停的放置目标 key
 *   busy                     写操作进行中（禁用按钮）
 *   onSelect(row) onToggle(row) onMenu(row, {x,y})
 *   onDragKey(key) onDropKey(key) onDrop(projectKey, targetRow)
 *   onRenameStart(row) onRenameCommit(id, name) onRenameCancel()
 *   onCreateCommit(name) onCreateCancel()  —— creating 由宿主置真（右键菜单的「新建目录」）
 *   compact                  二级菜单形态（rail 里用），默认 false
 */

import { renderIcon, normalizeIcon, autoIconFor } from './projectIcons.js'
import { sideCardIcon, sideCardLabel, sideCardCount } from './cardParts.js'
import { brandVar, decoVar } from './styles.js'

const KIND_LABEL = { all: '全部任务', group: '目录', project: '项目' }

export function createTreeNav(deps) {
  const { React, h, model } = deps || {}
  const { useCallback, useEffect, useRef, useState } = React

  return function TreeNav(props) {
    /** 行 key → 元素，用于 roving tabindex 的 .focus()（只走 ref，不做 DOM 查询）。 */
    const itemRefs = useRef({})
    const pendingFocus = useRef(false)
    const {
      tree,
      renamingId = '',
      creating = false,
      creatingFor = '',
      dragKey = '',
      dropKey = '',
      busy = false,
      onSelect,
      onToggle,
      onMenu,
      onDragKey,
      onDropKey,
      onDrop,
      onRenameStart,
      onRenameCommit,
      onRenameCancel,
      onCreateCommit,
      onCreateCancel,
      compact = false,
      hideDone = false,
    } = props || {}
    /* 二级菜单在 192px 的 rail 里：首层 12px、每层 12px。
       之前是 16 + 10，三级行的可用宽度只有 ~90px，项目名一律被截成「[Demo] 后端工作区 A⋯」。 */
    /* 不再按 depth 算缩进：cove 的二级菜单里所有项都是同款 px-4，
       层级完全由外层容器（.fo-row-group）一层层包住来表达。 */


    const rows = tree && Array.isArray(tree.rows) ? tree.rows : []
    const [active, setActive] = useState(() => (tree && tree.selected ? tree.selected.key : 'all'))

    const visible = rows
    const focusKey = (key) => { pendingFocus.current = true; setActive(key) }

    useEffect(() => {
      if (!pendingFocus.current) return
      pendingFocus.current = false
      const node = itemRefs.current[active]
      if (node && typeof node.focus === 'function') node.focus()
    })

    /* 选中项变了（含从 store 恢复）→ 光标跟着走，别停在空气上。 */
    useEffect(() => {
      if (tree && tree.selected && tree.selected.key !== active) setActive(tree.selected.key)
    }, [tree && tree.selected ? tree.selected.key : ''])

    const rowElement = (row, index) => {
      if (!row) return null
      /* 入场递延：--fo-i 让 CSS 用 calc(i * 20ms) 逐行错开，上限 8 行（styles.js 里做动画）。 */
      const stagger = Math.min(Math.max(Number(index) || 0, 0), 7)
      const isGroup = row.kind === 'group'
      const isProject = row.kind === 'project'
      const canDrop = row.kind === 'all' || isGroup
      /* 缩进导轨：每层一条 1px 竖线（绝对定位，不占 flex 空间）—— 必须在 children 之前算，
         否则 TDZ（`Cannot access 'guides' before initialization`）。
         为什么要它：缩进只有 10px/层，比一个项目图标还窄，光靠 padding 看不出「谁属于谁」。 */
      /* 层级由嵌套容器表达，不再画缩进导轨（cove 的二级菜单里也没有导轨线）。 */
      /* 色点：项目行 = 该项目在目录里的分色槽；根行 = 品牌色；目录行 = 中性色。 */
      const color = isProject && Number.isFinite(row.colorIndex)
        ? { '--fo-c': decoVar(row.colorIndex) }
        : (row.kind === 'all' ? { '--fo-c': brandVar() } : undefined)
      /* 项目名里常带一个工作区前缀（"[Demo] 后端工作区 A"），而在树里它已经挂在 Demo 目录下面了 ——
         去掉这段前缀，窄栏里能多显示 4~5 个字，这也是「名字全被截断」的另一半原因。
         完整名字仍在 title（row.path）里，鼠标悬停可看全。 */
      const label = isProject
        ? String(row.label || '').replace(/^\s*\[[^\]]+\]\s*/, '') || String(row.label || '')
        : row.label
      /* 计数要和画布说同一件事：隐藏已完成时，行上的数就是画布上会出现的任务数
         （否则侧栏写 12、画布只画 2，用户会以为图丢了东西）。目录行仍是「几个项目」。 */
      /* 计数只放数字：窄栏里「6 项目」四个字会把项目名挤没；单位在 title 里说明。 */
      const count = isGroup
        ? String(row.count)
        : String(hideDone ? row.open : row.count)
      const countTip = isGroup
        ? `${row.count} 个项目 · ${row.open} 条待办`
        : `${row.open} 条待办 · 共 ${row.count} 条${hideDone && row.done ? `（${row.done} 条已完成已隐藏）` : ''}`

      const children = []
      if (!isProject) {
        /* 不再画展开图标：层级已经由嵌套容器表达（cove 的二级菜单也没有 caret）。
           折叠仍然可用 —— 点行本身即可展开/收起，键盘左右方向键也照旧。 */
      }
      /* 每一行都有图标（logo），没有配过的用默认图标 —— 这样行首图标槽宽度一致，
         文字自然全部落在同一条左对齐线上（之前只有项目行有图标、其余是 7px 色点，
         标签的起始位置就差开了）。 */
      const manualLogo = isProject ? normalizeIcon(row.logo) : ''
      const auto = autoIconFor(row.label)
      const fallback = row.kind === 'all' ? 'lucide:layers' : (row.ungrouped === true ? 'lucide:inbox' : 'lucide:folder')
      const logoIcon = manualLogo || (auto && auto.icon) || fallback
      /* 目录行：**只有图标是展开/收起的开关**，点名字只是切换范围（用户口径）。
         图标本身是独立命中区（20×20），点它 stopPropagation，不会顺带改范围。 */
      /* 图标 / 名字 / 计数都由 cardParts 提供 —— 与关系图的「项目卡」是同一份组件 */
      children.push(sideCardIcon(h, {
        icon: logoIcon,
        color: row.ungrouped === true ? undefined : color,
        toggle: isGroup,
        iconTitle: isGroup ? (row.collapsed === true ? '展开' : '收起') : undefined,
        onIconClick: isGroup ? (event) => { event.stopPropagation(); toggleOf(row) } : undefined,
      }))
      children.push(sideCardLabel(h, { label, title: row.path || label }))
      /* 只在目录行给计数：项目行右边就是画布，球数一眼能看出；
         192px 的栏里「名字 + 数字」放不下，实测名字只剩 53px（约 4 个字）。 */
      if (isGroup || row.kind === 'all') {
        children.push(sideCardCount(h, { count, kind: isGroup ? 'group' : 'project', title: countTip }))
      }
      if ((isGroup && !row.ungrouped) || isProject) {
        children.push(h('button', {
          key: 'menu',
          type: 'button',
          className: 'fo-btn fo-row-menu',
          'data-size': 'sm',
          'data-variant': 'ghost',
          'aria-label': isGroup ? `目录 ${row.label} 的操作` : `项目 ${row.label} 的操作`,
          disabled: busy,
          onClick: (event) => {
            event.stopPropagation()
            const box = event.currentTarget.getBoundingClientRect()
            if (typeof onMenu === 'function') onMenu(row, { x: box.left, y: box.bottom + 4 })
          },
        }, '⋯'))
      }

      const rename = renamingId && renamingId === row.id && isGroup
      if (rename) {
        return h('div', { key: row.key, className: 'fo-row', 'data-kind': row.kind, style: { '--fo-i': stagger } },
          h('input', {
            className: 'fo-input',
            defaultValue: row.label,
            autoFocus: true,
            'aria-label': '目录名',
            disabled: busy,
            onFocus: (event) => event.currentTarget.select(),
            onKeyDown: (event) => {
              if (event.key === 'Enter') { event.preventDefault(); const value = String(event.currentTarget.value || '').trim(); if (value) onRenameCommit(row.id, value); else onRenameCancel() }
              else if (event.key === 'Escape') { event.preventDefault(); onRenameCancel() }
            },
            onBlur: (event) => { const value = String(event.currentTarget.value || '').trim(); if (value && value !== row.label) onRenameCommit(row.id, value); else onRenameCancel() },
          }),
        )
      }

      return h('div', {
        key: row.key,
        ref: (node) => { itemRefs.current[row.key] = node },
        className: `fo-row${dropKey === row.key ? ' is-drop' : ''}${dragKey === row.key ? ' is-drag' : ''}`,
        role: 'treeitem',
        tabIndex: (active === row.key || (!visible.some((item) => item.key === active) && visible[0] && visible[0].key === row.key)) ? 0 : -1,
        'aria-level': row.depth + 1,
        'aria-selected': row.selected === true,
        'aria-expanded': (isGroup && !row.ungrouped) || row.kind === 'all' ? (row.collapsed !== true) : undefined,
        'data-kind': row.kind,
        /* 「未分组」是系统桶，不是用户建的目录：单独标记，样式上降一档权重。 */
        'data-bucket': row.ungrouped === true ? '1' : undefined,
        'data-depth': row.depth,
        'data-key': row.key,
        'data-id': row.id,
        style: { '--fo-i': stagger },
        draggable: isProject,
        title: `${KIND_LABEL[row.kind] || ''}：${label}`,
        onClick: () => { focusKey(row.key); if (typeof onSelect === 'function') onSelect(row) },
        onDoubleClick: () => { if (isGroup && !row.ungrouped && typeof onRenameStart === 'function') onRenameStart(row) },
        onContextMenu: (event) => {
          event.preventDefault()
          focusKey(row.key)
          if (typeof onMenu === 'function') onMenu(row, { x: event.clientX, y: event.clientY })
        },
        onDragStart: (event) => {
          if (!isProject) return
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move'
            try { event.dataTransfer.setData('text/plain', row.id) } catch (error) { /* 某些宿主禁止 setData */ }
          }
          if (typeof onDragKey === 'function') onDragKey(row.key)
        },
        onDragEnd: () => { if (typeof onDragKey === 'function') onDragKey('') },
        onDragOver: (event) => {
          if (!canDrop) return
          event.preventDefault()
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
          if (dropKey !== row.key && typeof onDropKey === 'function') onDropKey(row.key)
        },
        onDragLeave: () => { if (dropKey === row.key && typeof onDropKey === 'function') onDropKey('') },
        onDrop: (event) => {
          if (!canDrop) return
          event.preventDefault()
          let key = ''
          try { key = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '' } catch (error) { key = '' }
          if (!key && dragKey) key = String(dragKey).replace(/^project:/, '')
          if (typeof onDropKey === 'function') onDropKey('')
          if (key && typeof onDrop === 'function') onDrop(key, row)
        },
      }, children)
    }

    const toggleOf = (row) => {
      if (!row) return
      if (typeof onToggle === 'function') onToggle(row)
    }

    const onKeyDown = useCallback((event) => {
      if (!visible.length) return
      const at = visible.findIndex((row) => row.key === active)
      const index = at < 0 ? 0 : at
      const current = visible[index]
      const move = (target) => { if (target) { event.preventDefault(); focusKey(target.key) } }

      if (event.key === 'ArrowDown') move(visible[index + 1])
      else if (event.key === 'ArrowUp') move(visible[index - 1])
      else if (event.key === 'Home') move(visible[0])
      else if (event.key === 'End') move(visible[visible.length - 1])
      else if (event.key === 'ArrowRight') {
        if ((current.kind === 'group' || current.kind === 'all') && current.collapsed === true) toggleOf(current)
        else {
          const next = visible[index + 1]
          move(next && next.depth > current.depth ? next : null)
        }
      } else if (event.key === 'ArrowLeft') {
        if ((current.kind === 'group' || current.kind === 'all') && current.collapsed !== true && current.count > 0) toggleOf(current)
        else {
          let parent = null
          for (let i = index - 1; i >= 0; i -= 1) { if (visible[i].depth < current.depth) { parent = visible[i]; break } }
          move(parent)
        }
      } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault()
        if (typeof onSelect === 'function') onSelect(current)
      } else if (event.key === 'F2') {
        if (current.kind === 'group' && !current.ungrouped && typeof onRenameStart === 'function') { event.preventDefault(); onRenameStart(current) }
      } else if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && typeof onMenu === 'function') {
        event.preventDefault()
        const node = itemRefs.current[current.key]
        const box = node && typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null
        if (box) onMenu(current, { x: box.left + 24, y: box.bottom })
      }
    }, [active, visible, onSelect, onToggle, onMenu, onRenameStart])

    const onListDrop = (event) => {
      if (!dragKey) return
      event.preventDefault()
      if (typeof onDropKey === 'function') onDropKey('')
      if (typeof onDrop === 'function') onDrop(String(dragKey).replace(/^project:/, ''), null)
    }

    const items = []
    /* cove 的二级菜单是「一个大容器包住几个小项」：容器 bg 3% + 圆角，里面的项和一级项**完全同款**
       （44 高 / px-4 / gap-3 / 12 圆角 / 14px-500）。所以这里把扁平行按 depth 折成嵌套结构，
       层级靠容器嵌套表达，不再靠缩进/字号/行高这些小动作。 */
    const buildNested = () => {
      const root = []
      const stack = [{ depth: -1, children: root }]
      visible.forEach((row, index) => {
        while (stack.length > 1 && stack[stack.length - 1].depth >= (Number(row.depth) || 0)) stack.pop()
        const node = { row, index, children: [] }
        stack[stack.length - 1].children.push(node)
        stack.push({ depth: Number(row.depth) || 0, children: node.children })
      })
      return root
    }
    const renderNested = (nodes) => nodes.map((node) => {
      const row = rowElement(node.row, node.index)
      if (!node.children.length) return row
      return h('div', { key: 'wrap:' + node.row.key, className: 'fo-row-wrap' },
        row,
        h('div', { key: 'group', className: 'fo-row-group' }, renderNested(node.children)),
      )
    })
    renderNested(buildNested()).forEach((el) => items.push(el))
    visible.forEach((row) => {
      if (row.kind === 'group' && row.missing > 0 && row.collapsed !== true) {
        items.push(h('div', { key: 'note:' + row.key, className: 'fo-scope-note' }, row.missing + ' 个成员已不在当前任务集里'))
      }
    })
    if (creating) {
      items.push(h('div', { key: 'create', className: 'fo-create-row' },
        h('input', {
          className: 'fo-input',
          autoFocus: true,
          placeholder: creatingFor ? '新目录名（创建后自动移入）' : '新目录名',
          'aria-label': '新目录名',
          disabled: busy,
          onKeyDown: (event) => {
            if (event.key === 'Enter') { event.preventDefault(); const value = String(event.currentTarget.value || '').trim(); if (value) onCreateCommit(value); else onCreateCancel() }
            else if (event.key === 'Escape') { event.preventDefault(); onCreateCancel() }
          },
          onBlur: () => onCreateCancel(),
        }),
      ))
    }

    return h('div', { className: 'fo-scope', 'data-compact': compact ? '1' : '0' },
      /* 用户口径：去掉「新建目录」按钮。新建入口保留在目录行 / 未分组行的右键菜单里
         （见 model.rowMenu 的 new-group / move-new），那里才是「对着某个目录操作」的语境。 */
      compact
        ? null
        : h('div', { className: 'fo-scope-head' }, h('span', { className: 'fo-scope-title' }, '任务分组')),
      h('div', { className: 'fo-scope-body', onDragOver: (event) => { if (dragKey) event.preventDefault() }, onDrop: onListDrop },
        h('div', {
          className: 'fo-scope-list',
          role: 'tree',
          'aria-label': '任务分组（全部任务 / 自定义目录 / 项目）',
          'aria-multiselectable': false,
          onKeyDown,
        }, items),
      ),
    )
  }
}

export default createTreeNav
