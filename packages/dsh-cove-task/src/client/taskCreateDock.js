/**
 * 新会话 composer 上方的「CoveTask」条 —— E1 徽章条。
 *
 * 设计口径（2026-11-24 用户选定）：
 *   - **来源标记在前**：logo 图块 + 「CoveTask」+ 1px 竖线，然后才是任务信息，
 *     任何人一眼知道这条是哪个插件加的。
 *   - **一行恒定 36px**：勾选、名字、优先级胶囊、状态胶囊、选已有，都在一行里。
 *   - **靠颜色读状态**：优先级色沿用任务卡那套（P0 红 / P1 橙 / P2 蓝 / P3 灰），
 *     图块底、优先级胶囊、左缘 3px 色带同色；绑定态加一枚「待绑定」胶囊。
 *   - **图标来自内置 Lucide**（1461 个），不是字符画。
 *   - **绑定态诚实**：显示 T<号> · 标题 的只读胶囊，状态写「待绑定」——
 *     真正的绑定发生在发出第一条消息时，不提前假装已开始。
 *
 * 勾选后不立即建任务：把勾选、名字、优先级、图标、要绑定的 taskId 存到宿主，
 * 等这条会话发出第一条消息（user/message / turn/start）时由宿主创建或绑定。
 */
import { renderIcon } from './projectIcons.js'

/** 输入框里允许的最长任务名。 */
export const TITLE_MAX = 60

/** 任务图标可选项；空串表示使用默认图标。 */
export const EMOJI_OPTIONS = ['🎯', '🐛', '✨', '🚀', '🛠️', '📎', '🔍', '📊', '💡', '✅', '🧩', '🌊']

/** 优先级：与任务卡同一套语义色（卡和条必须读到同一个颜色）。 */
export const PRIORITY_KEYS = ['P0', 'P1', 'P2', 'P3']

/** 折叠空白、去掉首尾空格、截到 TITLE_MAX。 */
export function normalizeTitleInput(value, max = TITLE_MAX) {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value)
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** 候选行标题：T<号> + 标题（长标题截断，全名放 title 属性）。 */
export function candidateLabel(row) {
  const no = Number(row && row.no) || 0
  const text = String((row && row.title) || '').replace(/\s+/g, ' ').trim().slice(0, 30)
  return (no ? 'T' + no + ' ' : '') + text
}

export function createTaskCreateDock({ React, h, api, host }) {
  const { useCallback, useEffect, useRef, useState } = React
  const icon = (name, size) => renderIcon({ h }, 'lucide:' + name, size)

  function Dock(props) {
    const sessionId = String(
      props.sessionId || (props.session && props.session.sessionId) || '',
    ).trim()
    const blank = Boolean(props.session && props.session.blank === true)

    const [phase, setPhase] = useState('loading')
    const [checked, setChecked] = useState(false)
    const [title, setTitle] = useState('')
    const [emoji, setEmoji] = useState('')
    const [priority, setPriority] = useState('P2')
    const [priorityOptions, setPriorityOptions] = useState(['P0', 'P1', 'P2', 'P3'])
    /* 选了已有任务就记它的 id：发第一条消息时走「绑定已有任务」，不再新建。 */
    const [taskId, setTaskId] = useState('')
    const [candidates, setCandidates] = useState([])
    /* 当前打开的浮层：'' | 'pick'（选已有任务）| 'more'（图标 / 优先级） */
    const [pop, setPop] = useState('')
    const [query, setQuery] = useState('')
    const [activeIdx, setActiveIdx] = useState(0)

    const mounted = useRef(true)
    const saveTimer = useRef(null)
    const wasBlank = useRef(false)
    const rootRef = useRef(null)
    const inputRef = useRef(null)
    const searchRef = useRef(null)

    /* 勾选过的人，会话真正开始时（blank → 非 blank）自动把右侧 Cove Task 页签打开。 */
    useEffect(() => {
      if (blank) { wasBlank.current = true; return }
      if (!wasBlank.current) return
      wasBlank.current = false
      if (!checked) return
      if (host && typeof host.openFeishuTab === 'function') host.openFeishuTab(sessionId)
    }, [blank, checked, sessionId, host])

    /* 宿主回读：勾选 / 名字 / 优先级 / 表情 / 已选任务 / 候选，一处赋值避免各分支漂移。 */
    const applyView = useCallback((data) => {
      const it = data && data.intent ? data.intent : null
      setChecked(Boolean(it && it.enabled))
      setTitle(String((it && it.title) || ''))
      setEmoji(String((it && it.emoji) || ''))
      setPriority(it ? String(it.priority || '') : 'P2')
      setTaskId(it ? String(it.taskId || '') : '')
      setCandidates(Array.isArray(data && data.candidates) ? data.candidates : [])
      if (Array.isArray(data && data.priorityOptions) && data.priorityOptions.length) setPriorityOptions(data.priorityOptions)
    }, [])

    const save = useCallback((enabled, nextTitle, nextPriority, nextEmoji, nextTaskId) => {
      if (!sessionId || typeof api.setTaskCreateIntent !== 'function') return
      Promise.resolve()
        .then(() => api.setTaskCreateIntent(sessionId, enabled, normalizeTitleInput(nextTitle), nextPriority || '', nextEmoji || '', nextTaskId || ''))
        .catch(() => {
          /* 失败就按宿主真值回读，别让界面显示一个没生效的勾选（比如选中的任务刚被别人绑走）。 */
          Promise.resolve().then(() => api.sessionTask(sessionId)).then((data) => {
            if (!mounted.current) return
            applyView(data)
          }).catch(() => {})
        })
    }, [sessionId, applyView])

    useEffect(() => {
      mounted.current = true
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      setChecked(false)
      setTitle('')
      setEmoji('')
      setPriority('P2')
      setTaskId('')
      setCandidates([])
      setPop('')
      setQuery('')
      if (!sessionId || !blank || typeof api.sessionTask !== 'function') {
        setPhase('hidden')
        return () => { mounted.current = false }
      }
      let ignore = false
      setPhase('loading')
      Promise.resolve()
        .then(() => api.sessionTask(sessionId))
        .then((data) => {
          if (ignore || !mounted.current) return
          if (data && data.task) { setPhase('hidden'); return }
          applyView(data)
          setPhase('ready')
        })
        .catch(() => {
          /* 旧宿主没有这条路由时不要留一个点了没反应的控件。 */
          if (!ignore && mounted.current) setPhase('hidden')
        })
      return () => {
        ignore = true
        mounted.current = false
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      }
    }, [sessionId, blank])

    /* 浮层：点外面 / Esc 关闭；打开选择器时聚焦搜索框。 */
    useEffect(() => {
      if (!pop || typeof document === 'undefined') return undefined
      const onDown = (event) => {
        const root = rootRef.current
        if (root && event && event.target && typeof root.contains === 'function' && root.contains(event.target)) return
        setPop('')
      }
      const onKey = (event) => { if (event && event.key === 'Escape') setPop('') }
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
      return () => {
        document.removeEventListener('mousedown', onDown)
        document.removeEventListener('keydown', onKey)
      }
    }, [pop])

    useEffect(() => {
      if (pop === 'pick' && searchRef.current && typeof searchRef.current.focus === 'function') searchRef.current.focus()
    }, [pop])

    const toggle = useCallback(() => {
      const next = !checked
      setChecked(next)
      setPop('')
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      save(next, title, priority, emoji, taskId)
    }, [checked, title, priority, emoji, taskId, save])

    /** 未勾选时点占位文字 / 右侧按钮：勾上并把光标放进名字框。 */
    const startNew = useCallback(() => {
      setChecked(true)
      setPop('')
      save(true, title, priority, emoji, taskId)
      const el = inputRef.current
      if (el && typeof el.focus === 'function') el.focus()
    }, [title, priority, emoji, taskId, save])

    const changeTitle = useCallback((value) => {
      setTitle(value)
      if (!checked) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => { saveTimer.current = null; save(true, value, priority, emoji, taskId) }, 300)
    }, [checked, priority, emoji, taskId, save])

    const changeEmoji = useCallback((value) => {
      setEmoji(value)
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      if (checked) save(true, title, priority, value, taskId)
    }, [checked, title, priority, taskId, save])

    const changePriority = useCallback((value) => {
      setPriority(value)
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      if (checked) save(true, title, value, emoji, taskId)
    }, [checked, title, emoji, taskId, save])

    /** 选任务：'' = 新建任务；选中已有任务 = 绑定它（第一条消息时生效）。 */
    const changeTask = useCallback((nextId) => {
      const id = String(nextId || '')
      setTaskId(id)
      setPop('')
      setQuery('')
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      if (!checked) setChecked(true)
      save(true, title, priority, emoji, id)
    }, [checked, title, priority, emoji, save])

    /* 空白新会话之外不占位；放在 hooks 之后，保证 hook 顺序稳定。 */
    if (!blank || !sessionId || phase === 'loading' || phase === 'hidden') return null

    const picked = taskId ? candidates.find((row) => row && row.id === taskId) || null : null
    /* 绑定态以任务自身的优先级为准（它可能和当初填的不一样）。 */
    const prioText = String((picked && picked.priority) || priority || '').toUpperCase()
    const prioKey = PRIORITY_KEYS.includes(prioText) ? prioText : ''
    const needle = normalizeTitleInput(query).toLowerCase()
    const visible = needle
      ? candidates.filter((row) => candidateLabel(row).toLowerCase().includes(needle))
      : candidates
    /* 选择器里的行：第 0 行永远是「新建任务」，后面是候选（↑↓ 在两者之间移动）。 */
    const rows = [{ id: '' }].concat(visible.slice(0, 20))
    const active = Math.max(0, Math.min(activeIdx, rows.length - 1))

    const pickRow = (index) => {
      const row = rows[index]
      if (!row) return
      changeTask(row.id)
    }

    /** 中间段：名字输入框（新建）或只读胶囊（绑定）。 */
    function renderBody() {
      if (picked) {
        return h('div', { className: 'ftc-body' },
          h('span', { className: 'ftc-chip', title: String(picked.title || '') },
            h('span', { className: 'ftc-chip-no' }, Number(picked.no) ? 'T' + Number(picked.no) : '任务'),
            h('span', { className: 'ftc-chip-title' }, String(picked.title || '')),
            h('button', {
              type: 'button',
              className: 'ftc-chip-clear',
              'aria-label': '改成新建任务',
              title: '改成新建任务',
              onClick: () => changeTask(''),
            }, '×')))
      }
      return h('div', { className: 'ftc-body' },
        h('input', {
          ref: inputRef,
          className: 'ftc-input',
          type: 'text',
          value: title,
          maxLength: TITLE_MAX,
          placeholder: '任务名（可选，留空按会话内容起名）',
          'aria-label': '任务名，可留空',
          onChange: (event) => changeTitle(event.currentTarget.value),
          onBlur: () => {
            if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
            /* 必须带上 taskId：漏了会把它当成「新建」，把已选的任务清掉。 */
            if (checked) save(true, title, priority, emoji, taskId)
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          },
        }))
    }

    /** 浮层一：搜索 + 候选（第 0 行是「新建任务」）。 */
    function renderPicker() {
      const rowsView = rows.map((row, index) => {
        const body = row.id
          ? [
            h('span', { key: 'no', className: 'ftc-cand-no' }, Number(row.no) ? 'T' + Number(row.no) : '—'),
            h('span', { key: 'title', className: 'ftc-cand-title' }, String(row.title || '')),
            row.priority ? h('span', { key: 'prio', className: 'ftc-cand-prio' }, String(row.priority)) : null,
          ]
          : h('span', { className: 'ftc-cand-title' }, '＋ 新建任务（用上面的名字）')
        return h('button', {
          key: row.id || 'new',
          type: 'button',
          role: 'option',
          className: 'ftc-cand' + (index === active ? ' is-active' : '') + (row.id ? '' : ' is-new'),
          'aria-selected': index === active ? 'true' : 'false',
          'data-action': row.id ? 'bind-' + row.id : 'new',
          title: row.id ? String(row.title || '') : '新建一条任务',
          onMouseEnter: () => setActiveIdx(index),
          onClick: () => pickRow(index),
        }, body)
      })

      const foot = picked
        ? '已选：' + candidateLabel(picked) + ' · 发出第一条消息后绑定'
        : '发出第一条消息后才会创建任务'

      return h('div', { className: 'ftc-pop', role: 'dialog', 'aria-label': '选择已有任务' },
        h('div', { className: 'ftc-pop-head' },
          h('input', {
            ref: searchRef,
            className: 'ftc-search',
            type: 'text',
            value: query,
            placeholder: '搜索任务号或标题…',
            'aria-label': '搜索任务',
            onChange: (event) => { setQuery(event.currentTarget.value); setActiveIdx(0) },
            onKeyDown: (event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIdx(Math.min(active + 1, rows.length - 1)) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIdx(Math.max(active - 1, 0)) }
              else if (event.key === 'Enter') { event.preventDefault(); pickRow(active) }
              else if (event.key === 'Escape') { setPop('') }
            },
          })),
        h('div', { className: 'ftc-cands', role: 'listbox' },
          rowsView.length
            ? rowsView
            : h('div', { className: 'ftc-pop-empty' }, '没有匹配的任务；改回「＋ 新建任务」即可')),
        h('div', { className: 'ftc-pop-foot' }, foot))
    }

    /** 浮层二：图标 / 优先级（绑定态以任务为准，置灰）。 */
    function renderMore() {
      return h('div', { className: 'ftc-pop ftc-pop-more', role: 'dialog', 'aria-label': '图标与优先级' },
        h('div', { className: 'ftc-row' },
          h('span', { className: 'ftc-row-label' }, '图标'),
          h('select', {
            className: 'ftc-select',
            value: emoji,
            disabled: Boolean(picked),
            'aria-label': '任务图标（可选）',
            onChange: (event) => changeEmoji(event.currentTarget.value),
          },
            h('option', { value: '' }, '默认'),
            EMOJI_OPTIONS.map((option) => h('option', { key: option, value: option }, option)))),
        h('div', { className: 'ftc-row' },
          h('span', { className: 'ftc-row-label' }, '优先级'),
          h('select', {
            className: 'ftc-select',
            value: priority,
            disabled: Boolean(picked),
            'aria-label': '优先级（可选）',
            onChange: (event) => changePriority(event.currentTarget.value),
          },
            h('option', { value: '' }, '无'),
            priorityOptions.map((option) => h('option', { key: option, value: option }, option)))),
        h('div', { className: 'ftc-pop-foot' },
          picked ? '绑定已有任务时，图标和优先级以任务为准' : '这两项都能在发出第一条消息前改'))
    }

    const bar = h('div', { className: 'ftc-bar' },
      h('span', { className: 'ftc-edge', 'aria-hidden': 'true' }),
      /* 图块本身就是开关：未勾选显示插件 logo，勾选后显示颜色图块里的动作图标。 */
      h('button', {
        type: 'button',
        className: 'ftc-tile',
        role: 'checkbox',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': checked ? 'CoveTask：取消建成任务' : 'CoveTask：把这条会话建成飞书任务',
        title: checked ? '取消' : '把这条会话建成飞书任务',
        onClick: toggle,
      },
        checked
          ? icon(picked ? 'bookmark' : 'sparkles', 14)
          : h('img', {
            className: 'ftc-logo',
            src: '/dsh-cove-task/logo.png',
            alt: '',
            'aria-hidden': 'true',
            draggable: false,
          })),
      h('span', { className: 'ftc-brand' }, 'CoveTask'),
      h('span', { className: 'ftc-sep', 'aria-hidden': 'true' }),
      checked
        ? renderBody()
        : h('button', { type: 'button', className: 'ftc-ph', onClick: startNew }, '这条会话要建成任务'),
      checked
        ? (picked
          ? h('span', { className: 'ftc-prio-pill is-static', title: prioKey ? '优先级 ' + prioKey : '任务没有优先级' },
            icon('flag', 10),
            prioKey || '—')
          : h('button', {
            type: 'button',
            className: 'ftc-prio-pill',
            'aria-haspopup': 'dialog',
            'aria-expanded': pop === 'more' ? 'true' : 'false',
            'aria-label': '优先级与图标',
            title: '优先级 / 图标',
            onClick: () => setPop(pop === 'more' ? '' : 'more'),
          },
            icon('flag', 10),
            prioKey || '无'))
        : h('button', { type: 'button', className: 'ftc-start', onClick: startNew }, '＋ 建立任务'),
      checked && picked
        ? h('span', { className: 'ftc-pill-state', title: '发出第一条消息后绑定到这条任务' },
          icon('timer', 10),
          '待绑定')
        : null,
      checked
        ? h('button', {
          type: 'button',
          className: 'ftc-act',
          'aria-haspopup': 'listbox',
          'aria-expanded': pop === 'pick' ? 'true' : 'false',
          'aria-label': '选已有任务',
          title: '选已有任务（未绑定 / 未完成）',
          onClick: () => setPop(pop === 'pick' ? '' : 'pick'),
        }, icon('list-plus', 14))
        : null)

    const overlay = pop === 'pick' ? renderPicker() : pop === 'more' ? renderMore() : null

    return h('section', {
      className: 'ftc-dock',
      'aria-label': 'CoveTask',
      ref: rootRef,
      'data-open': pop ? '1' : '0',
      'data-on': checked ? '1' : '0',
      'data-bound': picked ? '1' : '0',
      'data-prio': prioKey,
    }, bar, overlay)
  }

  return Dock
}
