/**
 * 新会话 composer 上方的「创建 Cove Task」勾选条。
 *
 * 勾选后不立即建任务：把勾选和可选任务名存到宿主，等这条会话发出第一条消息
 * （user/message / turn/start）时由宿主自动创建。没填任务名就按会话内容/项目名自动命名。
 *
 * 放在 conversation.input.dock，只在新会话（session.blank）且还没绑定任务时出现。
 * 编号由飞书任务号决定，界面不提供编号输入。
 */

/** 输入框里允许的最长任务名。 */
export const TITLE_MAX = 60

/** 任务图标可选项；空串表示使用默认图标。 */
export const EMOJI_OPTIONS = ['🎯', '🐛', '✨', '🚀', '🛠️', '📎', '🔍', '📊', '💡', '✅', '🧩', '🌊']

/** 折叠空白、去掉首尾空格、截到 TITLE_MAX。 */
export function normalizeTitleInput(value, max = TITLE_MAX) {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value)
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

export function createTaskCreateDock({ React, h, api, host }) {
  const { useCallback, useEffect, useRef, useState } = React

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
    const mounted = useRef(true)
    const saveTimer = useRef(null)
    const wasBlank = useRef(false)

    /* 勾选过的人，会话真正开始时（blank → 非 blank）自动把右侧Cove Task 页签打开。
       放在拉取 intent 的 effect 前面：blank 变 false 时先按当前 checked 判断。 */
    useEffect(() => {
      if (blank) { wasBlank.current = true; return }
      if (!wasBlank.current) return
      wasBlank.current = false
      if (!checked) return
      if (host && typeof host.openFeishuTab === 'function') host.openFeishuTab(sessionId)
    }, [blank, checked, sessionId, host])

    useEffect(() => {
      mounted.current = true
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      setChecked(false)
      setTitle('')
      setEmoji('')
      setPriority('P2')
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
          if (Array.isArray(data && data.priorityOptions) && data.priorityOptions.length) setPriorityOptions(data.priorityOptions)
          setChecked(Boolean(data && data.intent && data.intent.enabled))
          setTitle(String((data && data.intent && data.intent.title) || ''))
          setEmoji(String((data && data.intent && data.intent.emoji) || ''))
          setPriority(data && data.intent ? String(data.intent.priority || '') : 'P2')
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

    const save = useCallback((enabled, nextTitle, nextPriority, nextEmoji) => {
      if (!sessionId || typeof api.setTaskCreateIntent !== 'function') return
      Promise.resolve()
        .then(() => api.setTaskCreateIntent(sessionId, enabled, normalizeTitleInput(nextTitle), nextPriority || '', nextEmoji || ''))
        .catch(() => {
          /* 失败就按宿主真值回读，别让界面显示一个没生效的勾选。 */
          Promise.resolve().then(() => api.sessionTask(sessionId)).then((data) => {
            if (!mounted.current) return
            setChecked(Boolean(data && data.intent && data.intent.enabled))
            setTitle(String((data && data.intent && data.intent.title) || ''))
            setEmoji(String((data && data.intent && data.intent.emoji) || ''))
            setPriority(data && data.intent ? String(data.intent.priority || '') : 'P2')
          }).catch(() => {})
        })
    }, [sessionId])

    const toggle = useCallback(() => {
      const next = !checked
      setChecked(next)
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      save(next, title, priority, emoji)
    }, [checked, title, priority, emoji, save])

    const changeTitle = useCallback((value) => {
      setTitle(value)
      if (!checked) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => { saveTimer.current = null; save(true, value, priority, emoji) }, 300)
    }, [checked, priority, emoji, save])

    const changeEmoji = useCallback((value) => {
      setEmoji(value)
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      if (checked) save(true, title, priority, value)
    }, [checked, title, priority, save])

    /* 空白新会话之外不占位；放在 hooks 之后，保证 hook 顺序稳定。 */
    if (!blank || !sessionId || phase === 'loading' || phase === 'hidden') return null

    return h('section', { className: 'ftc-dock', 'aria-label': 'CoveTask' },
      h('div', { className: 'ftc-bar' },
        h('label', { className: 'ftc-toggle' + (checked ? ' is-on' : '') },
          h('input', {
            className: 'ftc-checkbox',
            type: 'checkbox',
            checked,
            onChange: toggle,
            'aria-label': 'CoveTask',
          }),
          h('span', { className: 'ftc-label' }, 'CoveTask')),
        h('div', { className: 'ftc-field' },
          h('label', { className: 'ftc-emoji', title: '任务图标（可选）' },
            emoji
              ? h('span', { className: 'ftc-emoji-current' }, emoji)
              : h('span', { className: 'ftc-emoji-default', 'aria-hidden': 'true' },
                h('svg', {
                  width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none',
                  stroke: 'currentColor', strokeWidth: 1.4,
                  strokeLinecap: 'round', strokeLinejoin: 'round',
                },
                  h('path', { d: 'M2.2 10.4c1.8-2.8 3.6-2.8 5.4 0s3.6 2.8 5.4 0' }),
                  h('path', { d: 'M2.2 6.2c1.8-2.8 3.6-2.8 5.4 0s3.6 2.8 5.4 0' }))),
            h('select', {
              className: 'ftc-emoji-select',
              value: emoji,
              'aria-label': '任务图标（可选）',
              onChange: (event) => changeEmoji(event.currentTarget.value),
            },
              h('option', { value: '' }, '默认'),
              EMOJI_OPTIONS.map((option) => h('option', { key: option, value: option }, option)))),
          h('input', {
            className: 'ftc-input',
            type: 'text',
            value: title,
            maxLength: TITLE_MAX,
            placeholder: '任务名（可选）',
            'aria-label': '任务名，可留空',
            onChange: (event) => changeTitle(event.currentTarget.value),
            onBlur: () => {
              if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
              if (checked) save(true, title, priority, emoji)
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            },
          })),
        h('label', { className: 'ftc-prio tc-scope', title: '优先级（可选）' },
          h('span', {
            className: 'prio' + (priority ? '' : ' prio-empty'),
            'data-value': priority || undefined,
            'aria-hidden': 'true',
          }, priority || '--'),
          h('select', {
            className: 'ftc-prio-select',
            value: priority,
            'aria-label': '优先级（可选）',
            onChange: (event) => {
              const next = event.currentTarget.value
              setPriority(next)
              if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
              if (checked) save(true, title, next, emoji)
            },
          },
            h('option', { value: '' }, '无'),
            priorityOptions.map((option) => h('option', { key: option, value: option }, option))))));
  }

  return Dock
}
