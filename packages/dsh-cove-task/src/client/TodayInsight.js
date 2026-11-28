/**
 * 今日洞察 —— 一份数据、两种形态。
 *
 * variant='sidebar'   侧栏窄卡：头行（头像 + 标题/折叠）→ tab 行 → 天气 → 可编辑摘要 → 一张图；
 *                     折叠后只剩头行。
 * variant='dashboard' 总览宽卡：左栏（天气 + 数据 + 小人）+ 右栏（headline → tab 行 → 可编辑摘要
 *                     → 一张图 → 下一步 → 要处理/做得对 → 脚注）。
 *
 * 两种形态共用同一份 state / 数据 / tabs / 生成 / 设置 / 草稿 / 评论 / 天气，只有渲染不同。
 * 流程号：① 读 /api/insight ② 读 /api/insight/stats ③ 生成 + 轮询 ④ 侧栏渲染 ⑤ 总览渲染。
 */
import { injectStyles } from './dashboardStyles.js'
import { createTodayInsightCharts } from './TodayInsightCharts.js'
import { createTodayInsightSettings } from './TodayInsightSettings.js'
import { weatherOf } from './insightWeather.js'
import { createEChartBox } from './echartsRuntime.js'
import { aiMascot } from './AiMascot.js'
import { renderMarkdown } from './markdown.js'
import { buildThemeRiver, RIVER_COLORS } from './themeRiver.js'

/* 诊断是默认页：它回答「长期哪里在拖后腿 + 今天先动哪件」，早会同步退到第二 */
const DEFAULT_BUTTONS = [
  { id: 'diagnose', label: '诊断', kind: 'ai' },
  { id: 'morning', label: '早会同步', kind: 'morning' },
  { id: 'export', label: '写入评论', kind: 'export' },
]
/* 视角 → 卡片上的短名（长名来自理论库，卡片不写书名人名） */
const LENS_LABELS = {
  contradiction: '主要矛盾',
  inversion: '逆向',
  values: '价值',
  structure: '结构',
  second_order: '二阶',
}
const DRAFT_PREFIX = 'dsh-cove-task:insight-summary:'
const SYNC_CHANNEL = 'dsh-cove-task:insight'
const COLLAPSE_KEY = 'dsh-cove-task:insight-collapsed'
const AVATAR = '/dsh-cove-task/tasks/assets/kp-avatar.webp'
const POLL_MS = 1200
const POLL_LIMIT_MS = 240_000
const modeOf = (button) => button?.kind === 'morning' ? 'morning' : 'diagnose'
const items = (value) => Array.isArray(value) ? value.filter(Boolean) : []

function readDraft(id) {
  try { return globalThis.localStorage?.getItem(DRAFT_PREFIX + id) ?? null } catch { return null }
}

function readCollapsed() {
  try { return globalThis.localStorage?.getItem(COLLAPSE_KEY) === '1' } catch { return false }
}

function writeCollapsed(next) {
  try { globalThis.localStorage?.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* 存不了就只在本次生效 */ }
}

export function createTodayInsight({ React, h = React.createElement }) {
  const { useEffect, useRef, useState } = React
  const { TodayInsightChart } = createTodayInsightCharts({ React, h })
  const Settings = createTodayInsightSettings({ React, h })
  const unsavedDrafts = new Map()
  const button = (label, onClick, props) => h('button', { className: 'fd-ai-jump', type: 'button', onClick, ...props }, label)

  /* 小图标：16×16 描边，currentColor；分区标题、小图标题共用 */
  const ICONS = {
    note: 'M4 2h6l3 3v9H4z M10 2v3h3',
    spark: 'M8 1v3 M8 12v3 M1 8h3 M12 8h3 M3.5 3.5l2 2 M12.5 12.5l-2-2',
    task: 'M3 4h10 M3 8h10 M3 12h6',
    tag: 'M3 3h5l5 5-5 5-5-5z',
    arrow: 'M3 8h9 M9 4l4 4-4 4',
    check: 'M3 8l3 3 7-7',
    alert: 'M8 2l6 12H2z M8 6v3 M8 11h.01',
    target: 'M8 2a6 6 0 1 0 0 12a6 6 0 0 0 0-12 M8 5a3 3 0 1 0 0 6',
  }
  const Icon = ({ name }) => h('svg', { className: 'fd-ico', viewBox: '0 0 16 16', width: '14', height: '14', 'aria-hidden': 'true' },
    h('path', { d: ICONS[name] || ICONS.spark }))

  /* 左栏「今日结构」：只画今天，完成/在推/卡住三块；右侧 14 天趋势不重复这一信息 */
  const RailChart = createEChartBox({
    React,
    h,
    optionOf: (spec, data, ctx) => {
      const colors = (ctx && ctx.colors && ctx.colors.length ? ctx.colors : null) || (ctx && ctx.fallback) || ['currentColor']
      const values = Array.isArray(data && data.values) ? data.values : []
      const previous = Array.isArray(data && data.previous) ? data.previous : []
      const labels = Array.isArray(data && data.labels) ? data.labels : []
      /* 本周用状态色（成功绿），上周用中性灰虚线；网格/轴名用 canvas 认的实色，不再用 currentColor */
      const accent = colors[1] || colors[0] || '#1f9d55'
      const max = Math.max(1, ...values, ...previous)
      const series = [{
        type: 'radar', symbol: 'circle', symbolSize: 3.5,
        lineStyle: { color: accent, width: 1.8 },
        itemStyle: { color: accent, borderColor: '#fff', borderWidth: 1 },
        areaStyle: { color: accent, opacity: 0.18 },
        data: [{ value: values }],
      }]
      if (previous.some((value) => value > 0)) {
        series.push({
          type: 'radar', symbol: 'none',
          lineStyle: { color: '#9aa0a6', width: 1, type: 'dashed', opacity: 0.85 },
          data: [{ value: previous }],
        })
      }
      return {
        animationDuration: 320,
        tooltip: { trigger: 'item' },
        radar: {
          indicator: labels.map((name) => ({ name, max })),
          center: ['50%', '52%'], radius: '64%', splitNumber: 3, shape: 'circle',
          axisName: { color: '#8a8f96', fontSize: 9 },
          axisLine: { lineStyle: { color: 'rgba(138,143,150,.28)' } },
          splitLine: { lineStyle: { color: 'rgba(138,143,150,.22)' } },
          splitArea: { show: true, areaStyle: { color: ['rgba(31,157,85,.05)', 'rgba(31,157,85,0)'] } },
        },
        series,
      }
    },
    fallback: ['#0f1115', '#1f9d55', '#b45309', '#c0392b'],
  })

  /* 主题河流：近 14 天按项目的新增任务，看类别强弱的消长 */
  const FlowChart = createEChartBox({
    React,
    h,
    optionOf: (spec, data) => {
      const rows = Array.isArray(data && data.rows) ? data.rows : []
      return {
        animation: false,
        color: RIVER_COLORS,
        tooltip: { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: 'rgba(0,0,0,.15)' } } },
        singleAxis: {
          type: 'time', top: 6, bottom: 16,
          axisTick: { show: false }, axisLine: { show: false }, splitLine: { show: false },
          axisLabel: {
            show: true, fontSize: 7, color: '#8a8f96', hideOverlap: true,
            formatter: (value) => {
              const date = new Date(value)
              return (date.getMonth() + 1) + '/' + date.getDate()
            },
          },
        },
        series: [{ type: 'themeRiver', data: rows, label: { show: false }, itemStyle: { opacity: 0.9 }, emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,.2)' } } }],
      }
    },
    fallback: ['#1f9d55', '#6fc394', '#bfe3ca', '#a8adb3'],
  })

  /* 摘要编辑器：草稿按 tab id 落 localStorage，两种形态/两个入口读同一个键。
     摘要下方不放「未保存 / 恢复原文」——草稿静默保存，正文只留一个输入框。 */
  function Summary({ id, original }) {
    const [draft, setDraft] = useState(() => unsavedDrafts.get(id) ?? readDraft(id))
    const [focusedText, setFocusedText] = useState(null)
    const [editing, setEditing] = useState(false)
    const box = useRef(null)
    const text = focusedText ?? draft ?? original
    useEffect(() => {
      if (editing && box.current && typeof box.current.focus === 'function') box.current.focus()
    }, [editing])
    useEffect(() => {
      if (typeof window === 'undefined') return undefined
      const onStorage = (event) => {
        if (event.key !== null && event.key !== DRAFT_PREFIX + id) return
        if (unsavedDrafts.has(id)) return
        setDraft(readDraft(id))
      }
      window.addEventListener('storage', onStorage)
      return () => window.removeEventListener('storage', onStorage)
    }, [id])
    const save = (value) => {
      setFocusedText(value)
      setDraft(value)
      try {
        globalThis.localStorage.setItem(DRAFT_PREFIX + id, value)
        unsavedDrafts.delete(id)
      } catch { unsavedDrafts.set(id, value) }
    }
    /* 读的时候渲染 Markdown（预览层），点一下进入编辑：textarea 铺在上面、原生聚焦，不需要 ref */
    return h('div', { className: 'fd-today-editor-wrap' },
      h('div', {
        className: 'fd-today-md' + (editing ? ' is-hidden' : ''),
        role: 'button',
        tabIndex: 0,
        'aria-label': '编辑摘要（支持 Markdown）',
        onClick: () => setEditing(true),
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setEditing(true)
          }
        },
      },
      String(text || '').trim() ? renderMarkdown(h, text) : h('span', { className: 'fd-today-md-empty' }, '编辑摘要…')),
      h('textarea', {
        ref: box,
        className: 'fd-today-editor' + (editing ? ' is-editing' : ''),
        'aria-label': '洞察摘要', placeholder: '编辑摘要…', value: text,
        onFocus: () => { setEditing(true); setFocusedText(text) },
        onBlur: () => { setEditing(false); setFocusedText(null) },
        onChange: (event) => save(event.target.value),
      }))
  }


  /* 推进流场：周几 × 时段 的完成密度梯度，箭头指向「更容易出活」的相邻格子。
     样本 < 3 只给空态，不画假箭头。 */
  function ThemeRiver({ river }) {
    if (!river || river.samples < 3) {
      return h('p', { className: 'fd-rail-flow-empty' }, '新增样本还不够')
    }
    return h('figure', { className: 'fd-rail-flow', title: '近 14 天各类别新增占比，看强弱消长' },
      h('div', { className: 'fd-flow-box' }, h(FlowChart, { spec: 'theme-river', data: river })),
      h('figcaption', { className: 'fd-river-legend' }, river.categories.map((name, index) => h('span', { key: name, title: name },
        h('i', { style: { background: RIVER_COLORS[index % RIVER_COLORS.length] } }), name))),
      h('figcaption', { className: 'fd-rail-flow-note' }, '项目消长 · 近 14 天'))
  }

  /* 总览左栏的小人：动图加载成功就盖住 SVG；图挂了直接摘掉，SVG 继续当着（不留空白框）。 */
  function Face({ mood }) {
    return h('div', { className: 'fd-ins-face' },
      h('div', { className: 'fd-figure', 'data-mood': mood, 'aria-hidden': 'true' },
        aiMascot(h, mood),
        h('img', {
          className: 'fd-figure-img', src: AVATAR, alt: '', decoding: 'async',
          /* 缓存命中时 load 可能在挂载前就结束，React 的 onLoad 会漏；ref 里补一次 complete 判断。 */
          ref: (node) => {
            if (!node) return
            const mark = () => {
              const host = node.parentElement
              if (host) host.setAttribute('data-ready', '1')
            }
            if (node.complete && node.naturalWidth > 0) mark()
            else node.addEventListener('load', mark, { once: true })
            node.addEventListener('error', () => node.remove(), { once: true })
          },
        })))
  }

  return function TodayInsight({ api, tasks = [], currentSessionId, onOpenTask, onSettingsSaved,
    settings: fallbackSettings, promptDefaults, stats: providedStats, statsRevision = 0,
    visible = true, variant = 'sidebar' }) {
    const dashboard = variant === 'dashboard'
    const [payload, setPayload] = useState(null)
    const [loadedStats, setLoadedStats] = useState(null)
    const [activeId, setActiveId] = useState('')
    const [chartIndex, setChartIndex] = useState(0)
    const [job, setJob] = useState(null)
    const [notice, setNotice] = useState('')
    const [editingSettings, setEditingSettings] = useState(false)
    const [comment, setComment] = useState(null)
    const [collapsed, setCollapsed] = useState(readCollapsed)
    const channel = useRef(null)
    const request = useRef(0)
    const jobPending = useRef(false)
    try { injectStyles() } catch { /* 非浏览器预览由宿主注入。 */ }

    /* ① 读上次的诊断结果（只读本地缓存，零模型成本）+ 跨入口同步。 */
    const refresh = async () => {
      if (!api?.insight) return
      const generation = ++request.current
      try {
        const result = await api.insight()
        if (request.current === generation) setPayload(result)
      } catch (error) {
        if (request.current === generation) setNotice(error?.message || '读取洞察失败')
      }
    }
    useEffect(() => {
      if (!visible) return undefined
      void refresh()
      if (typeof window === 'undefined') return undefined
      const onFocus = () => { if (!document.hidden) void refresh() }
      const bus = typeof BroadcastChannel === 'function' ? new BroadcastChannel(SYNC_CHANNEL) : null
      channel.current = bus
      if (bus) bus.onmessage = onFocus
      window.addEventListener('focus', onFocus)
      document.addEventListener('visibilitychange', onFocus)
      return () => {
        request.current += 1
        channel.current = null
        bus?.close()
        window.removeEventListener('focus', onFocus)
        document.removeEventListener('visibilitychange', onFocus)
      }
    }, [api, visible])

    /* ② 图表要用的 datasets（宿主没这条路由就只靠 ai.charts）。 */
    useEffect(() => {
      if (!visible || providedStats !== undefined || !api?.insightStats) return undefined
      let cancelled = false
      api.insightStats(14).then((data) => {
        if (!cancelled) setLoadedStats(data.stats || null)
      }).catch(() => { /* 指标服务暂不可用，摘要仍可编辑。 */ })
      return () => { cancelled = true }
    }, [api, visible, providedStats, statsRevision])

    /* ③ 生成 → 轮询 /api/insight/ai：只认本次 jobId，别人的任务不被当成本次结果。 */
    useEffect(() => {
      if (!visible || !job?.id) return undefined
      let cancelled = false
      let timer
      const finish = () => { jobPending.current = false; setJob(null) }
      const poll = async () => {
        try {
          const result = await api.insightAi()
          if (cancelled) return
          if (result.jobId !== job.id) {
            finish()
            void refresh()
            return
          }
          if (!result.running) {
            finish()
            if (result.data) {
              // 服务端先持久化，再标记任务完成；两个入口刷新同一份权威结果。
              channel.current?.postMessage('refresh')
              void refresh()
            } else setNotice(result.error || '未生成摘要')
            return
          }
          if (Date.now() - job.startedAt >= POLL_LIMIT_MS) {
            finish()
            setNotice('仍在后台生成')
            return
          }
          timer = setTimeout(poll, POLL_MS)
        } catch (error) {
          if (!cancelled) { finish(); setNotice(error?.message || '读取生成状态失败') }
        }
      }
      timer = setTimeout(poll, POLL_MS)
      return () => { cancelled = true; clearTimeout(timer) }
    }, [api, visible, job])

    const stats = providedStats === undefined ? loadedStats : providedStats
    const settings = payload?.settings || fallbackSettings || {}
    const buttons = items(settings.insightButtons).length ? items(settings.insightButtons) : DEFAULT_BUTTONS
    const tabs = buttons.filter((item) => item.kind !== 'export')
    const exportButton = buttons.find((item) => item.kind === 'export')
    const latest = payload?.ai
    const latestTab = latest && (tabs.find((tab) => tab.id === latest.buttonId)
      || (!latest.buttonId && tabs.find((tab) => modeOf(tab) === (latest.mode || 'diagnose'))))
    /* 默认落在诊断：老配置里按钮顺序可能还是「早会同步」在前，不能只靠 tabs[0] */
    const selected = tabs.find((tab) => tab.id === activeId)
      || tabs.find((tab) => modeOf(tab) === 'diagnose')
      || tabs[0]
    const id = selected?.id || 'default'
    const mode = modeOf(selected)
    const results = payload?.results || {}
    const ai = (Object.hasOwn(results, id) ? results[id] : null) || (latestTab?.id === id ? latest : null)
    const original = String(ai?.summary || '').trim() || [ai?.today, ai?.advice].filter(Boolean).join('\n')
    const byNo = new Map(tasks.filter((task) => task?.no).map((task) => [Number(task.no), task]))
    const local = payload?.local
    const exportTarget = (currentSessionId && tasks.find((task) => task.sessionId === currentSessionId))
      || tasks.find((task) => task.id === local?.recommend?.[0]?.id)
    const chartProps = { mode, ai, datasets: stats?.datasets, chartIndex, onChangeIndex: setChartIndex }
    /* 旧宿主（payload 没有 results）不提供生成入口：那是新接口的产物。 */
    const oldHost = Boolean(payload && !Object.hasOwn(payload, 'results'))
    const canGenerate = Boolean(payload && !oldHost && api?.insightDiagnose && api?.insightAi)
    const canWrite = Boolean(api?.insightExport)
    const running = Boolean(job) && job.buttonId === id

    const pick = (tab) => { setActiveId(tab.id); setChartIndex(0); setNotice(''); setComment(null) }
    const generate = async (tab) => {
      if (!canGenerate || jobPending.current) return
      jobPending.current = true
      pick(tab)
      setJob({ buttonId: tab.id })
      try {
        const response = await api.insightDiagnose({ force: true, mode: modeOf(tab), prompt: tab.prompt, buttonId: tab.id })
        if (!response.started || !response.jobId) {
          throw new Error(response.reason || '未能开始生成')
        }
        setJob({ id: response.jobId, buttonId: tab.id, startedAt: Date.now() })
      } catch (error) {
        jobPending.current = false
        setJob(null)
        setNotice(error?.message || '未能开始生成')
      }
    }
    const open = (task) => task?.id && typeof onOpenTask === 'function' ? button('打开', () => onOpenTask(task.id)) : null
    const confirmWrite = (task, text = '') => {
      if (task?.id) setComment({ task, text })
      else setNotice('没有可写入的任务')
    }
    const sendComment = async () => {
      if (!comment || comment.sending) return
      setComment({ ...comment, sending: true })
      try {
        await api.insightExport(comment.task.id, comment.text)
        setNotice('已写入「' + (comment.task.title || '任务') + '」的飞书评论')
        setComment(null)
      } catch (error) {
        setComment({ ...comment, sending: false })
        setNotice(error?.message || '写入失败')
      }
    }
    const toggleCollapsed = () => {
      writeCollapsed(!collapsed)
      setCollapsed((old) => !old)
    }

    const generateControl = (className) => canGenerate ? button(
      running ? '生成中…' : ai ? '更新' : '生成',
      () => generate(selected),
      {
        className,
        'aria-label': (ai ? '更新：' : '生成：') + (selected?.label || '洞察'),
        disabled: Boolean(job),
      },
    ) : null

    /* 共用：tabs 只在卡片右上角（与「今日洞察」同一行），不占正文；写入评论/设置也在这一行。
       生成按钮不在这里 —— 它在摘要下方那一行。 */
    const tabsNode = h('div', { className: 'fd-today-tabs', role: 'group', 'aria-label': '洞察操作' },
      tabs.map((tab) => button(tab.label, () => pick(tab), { key: tab.id, 'aria-pressed': tab.id === id })))
    const extrasNode = (exportButton && canWrite) || (api?.saveInsightSettings && (payload?.settings || fallbackSettings))
      ? h('div', { className: 'fd-today-head-actions' },
        exportButton && canWrite ? button(exportButton.label, () => confirmWrite(exportTarget)) : null,
        api?.saveInsightSettings && (payload?.settings || fallbackSettings) ? button('设置', () => setEditingSettings(true)) : null)
      : null
    /* 头行：头像 + 标题在左，tabs/写入评论/设置在右；折叠时只剩头像 + 标题。 */
    const headNode = ({ collapsible, actions, avatar = true, extra = null, title = true }) => h('div', { className: 'fd-today-head' },
      avatar ? h('span', { className: 'fd-today-avatar', 'aria-hidden': true },
        h('img', { className: 'fd-today-avatar-img', src: AVATAR, alt: '', decoding: 'async' })) : null,
      collapsible
        ? button('今日洞察', toggleCollapsed, { className: 'fd-today-title', 'aria-expanded': !collapsed })
        : (title ? h('span', { className: 'fd-today-title is-static' }, '今日洞察') : null),
      extra,
      !actions && !extra ? null : null,
      actions ? tabsNode : null,
      actions ? extrasNode : null)

    const noticeNode = notice ? h('p', { className: 'fd-today-note', role: 'status' }, notice) : null
    const commentNode = comment ? h('div', { className: 'fd-today-actions' },
      h('span', { className: 'fd-today-note' }, '写入「' + (comment.task.title || '任务') + '」的飞书评论？'),
      button(comment.sending ? '写入中…' : '确认写入', sendComment, { disabled: Boolean(comment.sending) }),
      button('取消', () => setComment(null), { disabled: Boolean(comment.sending) })) : null

    /* 生成/更新固定在卡片右下角：整个卡片只有一个主动作。 */
    const actionFoot = canGenerate
      ? h('div', { className: 'fd-today-foot' }, generateControl('fd-ai-btn'))
      : null
    const summaryBlock = h('div', { className: 'fd-today-summary' },
      h(Summary, { key: id, id, original, running }))

    const chartNode = h('div', { className: 'fd-today-chart' }, h(TodayInsightChart, chartProps))
    const weather = weatherOf(local)
    const weatherNode = (className, iconClass, compact = false) => h('div', { className },
      WeatherScene({ kind: weather.key, className: iconClass + ' fd-weather-scene' }),
      compact ? weather.word : weather.word + ' · ' + weather.note)

    if (editingSettings) return h('section', { className: 'fd-panel fd-today', 'data-variant': variant, 'aria-label': '洞察设置' },
      h(Settings, {
        buttons, ignore: items(settings.insightIgnore), promptDefaults: payload?.promptDefaults || promptDefaults,
        onClose: () => setEditingSettings(false),
        onSave: async (patch) => {
          const result = await api.saveInsightSettings(patch)
          request.current += 1
          setPayload((old) => ({ ...old, settings: result.settings || patch }))
          onSettingsSaved?.(result.settings || patch)
          channel.current?.postMessage('refresh')
        },
      }))

    /* ④ 侧栏：头行（含 tabs）/ 天气 / 可编辑摘要 + 一张图；折叠后只剩头像 + 标题。 */
    if (!dashboard) {
      if (collapsed) {
        /* 折叠成一行：头像 + 标题 + 天气 + 结论标题，标题超出省略。 */
        return h('section', { className: 'fd-panel fd-today is-collapsed', 'data-variant': 'sidebar', 'aria-label': '今日洞察' },
          headNode({
            collapsible: true, actions: false,
            extra: [
              weatherNode('fd-today-weather', 'fd-today-weather-icon'),
              h('span', { className: 'fd-today-fold-text' }, String(ai?.headline || original || '').trim() || '还没有结论'),
            ],
          }))
      }
      return h('section', { className: 'fd-panel fd-today', 'data-variant': 'sidebar', 'aria-label': '今日洞察' },
        headNode({
          collapsible: true,
          actions: true,
          extra: weatherNode('fd-today-weather fd-today-weather-inline', 'fd-today-weather-icon', true),
        }),
        noticeNode,
        commentNode,
        /* 摘要左、图表右；卡片窄于 480px 时上下堆（样式见 .fd-today-body）。 */
        h('div', { className: 'fd-today-body' }, summaryBlock, chartNode),
        actionFoot)
    }

    /* ⑤ 总览：左栏（天气 + 数据 + 小人）+ 右栏（结论与清单），沿用原 fd-ins 骨架。 */
    const issues = items(ai?.issues).filter((entry) => entry.text)
    const strengths = items(ai?.strengths).filter((entry) => entry.text)
    const improve = items(ai?.improve).filter((entry) => entry.title || entry.detail)
    const mood = job ? 'thinking' : issues.some((entry) => entry.level === 'bad') ? 'alert' : strengths.length ? 'happy' : 'calm'
    const todayStat = local?.today || null
    const updatedAt = Number(ai?.at) || 0
    const updatedText = updatedAt
      ? new Date(updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' 更新'
      : '当前状态'
    const advice = String(ai?.advice || '').trim()
    const adviceHit = advice.match(/T(\d{2,})/)
    const adviceTask = adviceHit ? byNo.get(Number(adviceHit[1])) : null

    /* 一条结论 = 一行：序号/对勾 + 判断 + 依据 + 打开（写评论只在卡片顶部一次）。 */
    const insRow = (kind, entry, index) => {
      const tone = kind === 'issue'
        ? (entry.level === 'bad' ? 'danger' : (entry.level === 'warn' ? 'warn' : 'brand'))
        : 'ok'
      const task = byNo.get(Number(entry.taskNo))
      return h('li', {
        key: kind + ':' + (entry.taskNo || 0) + ':' + String(entry.text || '').slice(0, 24),
        className: 'fd-ins-row fd-tone-' + tone,
      },
        h('span', { className: 'fd-ins-mark', 'aria-hidden': 'true' }, kind === 'issue' ? String(index + 1) : '✓'),
        h('span', { className: 'fd-ins-row-main' },
          h('span', { className: 'fd-ins-row-text', title: entry.text }, entry.text),
          entry.evidence ? h('span', { className: 'fd-ins-row-ev' }, '依据 · ' + entry.evidence) : null),
        task ? h('span', { className: 'fd-ins-acts' }, open(task)) : null)
    }
    const insBlock = (key, label, rows, tone) => rows.length ? h('section', { key, className: 'fd-ins-block' },
      h('div', { className: 'fd-ins-block-head' },
        h('span', { className: 'fd-ins-block-dot fd-tone-' + tone }),
        h('span', null, label),
        h('b', null, String(rows.length))),
      h('ul', { className: 'fd-ins-list' }, rows)) : null

    /* 长期结论：宿主跨天带出（/api/insight.longTerm）；旧宿主与样本不足时为 null，整块不渲染 */
    const longTerm = payload?.longTerm?.data && payload.longTerm.data.lens ? payload.longTerm.data : null
    const longTermAge = longTerm ? Math.floor((Date.now() - (Number(longTerm.at) || 0)) / 86_400_000) : 0
    const longTermStale = Boolean(longTerm) && longTermAge >= 7
    const diagnoseTab = tabs.find((tab) => modeOf(tab) === 'diagnose')
    /* 「要处理」= 关联任务；「做得对」留在深度卡里，作为正向证据 */
    const strengthsNode = strengths.length
      ? insBlock('strengths', '做得对', strengths.map((entry, index) => insRow('strength', entry, index)), 'ok')
      : null
    const issueRows = issues.map((entry, index) => insRow('issue', entry, index))

    /* 分区④：最底一行——左侧标签，右侧更新。不解释、不列履约/延期明细。 */
    const footNode = (ai || canGenerate)
      ? h('div', { className: 'fd-ins-foot fd-zone fd-zone-foot' },
        h('div', { className: 'fd-ins-chips' }, improve.map((entry) => h('span', {
          key: 'improve:' + (entry.title || '') + (entry.detail || ''),
          className: 'fd-ins-chip', title: entry.detail || '',
        }, entry.title || entry.detail))),
        canGenerate ? h('span', { className: 'fd-today-foot' }, generateControl('fd-ai-btn')) : null)
      : null

    const nextNode = advice ? h('div', { className: 'fd-ins-next' },
      h('span', { className: 'fd-ins-next-tag' }, '下一步'),
      h('p', { className: 'fd-ins-next-text' }, advice),
      adviceTask ? button('打开 T' + adviceTask.no, () => onOpenTask?.(adviceTask.id)) : null) : null

    /* 长期块：事实 → 假设 → 反证 → 动作 → 验收，排成一条推理链；>7 天给一次「重新判断」 */
    const longTermNode = longTerm ? h('section', {
      className: 'fd-ins-longterm',
      'data-lens': longTerm.lens,
      'aria-label': '长期结论',
    },
      h('div', { className: 'fd-ins-longterm-head' },
        h('span', { className: 'fd-ins-block-dot fd-tone-brand', 'aria-hidden': 'true' }),
        h('span', null, '长期 · ' + (LENS_LABELS[longTerm.lens] || longTerm.lens)),
        longTerm.until ? h('b', null, longTerm.until + ' 到期') : null),
      h('div', { className: 'fd-ins-chain' },
        h('div', { className: 'fd-ins-chain-row' },
          h('span', { className: 'fd-ins-chain-label' }, '事实'),
          h('p', { className: 'fd-ins-longterm-fact', title: longTerm.fact }, longTerm.fact)),
        longTerm.hypothesis ? h('div', { className: 'fd-ins-chain-row' },
          h('span', { className: 'fd-ins-chain-label' }, '假设'),
          h('p', { className: 'fd-ins-longterm-hyp' }, longTerm.hypothesis)) : null,
        longTerm.falsifier ? h('div', { className: 'fd-ins-chain-row' },
          h('span', { className: 'fd-ins-chain-label' }, '反证'),
          h('p', { className: 'fd-ins-longterm-falsifier' }, longTerm.falsifier)) : null,
        h('div', { className: 'fd-ins-chain-row is-action' },
          h('span', { className: 'fd-ins-chain-label' }, '动作'),
          h('p', { className: 'fd-ins-longterm-action' }, longTerm.action)),
        longTerm.metric || longTerm.metricNote ? h('div', { className: 'fd-ins-chain-row' },
          h('span', { className: 'fd-ins-chain-label' }, '验收'),
          h('p', { className: 'fd-ins-longterm-metric' }, longTerm.metricNote || longTerm.metric)) : null),
      longTermStale && diagnoseTab && canGenerate
        ? h('div', { className: 'fd-ins-longterm-review' },
          h('span', null, longTermAge + ' 天前的判断，还成立吗'),
          button('重新判断', () => generate(diagnoseTab)))
        : null) : null


    /* ---------- 天气动效：图标换成一小段 SVG 动画，hover/focus 出判定口径 ---------- */
    function WeatherScene({ kind, className }) {
      const cloud = h('g', { className: 'fd-w-cloud' },
        h('circle', { cx: '14', cy: '23', r: '6' }),
        h('circle', { cx: '22', cy: '19', r: '8' }),
        h('circle', { cx: '29', cy: '24', r: '5' }),
        h('rect', { x: '11', y: '23', width: '20', height: '6', rx: '3' }))
      const sun = h('g', { className: 'fd-w-sun' },
        h('circle', { cx: '20', cy: '20', r: '7' }),
        h('g', { className: 'fd-w-rays' },
          h('path', { d: 'M20 7v-3 M20 36v-3 M7 20H4 M36 20h-3 M11 11L9 9 M31 31l-2-2 M29 11l2-2 M9 31l2-2' })))
      if (kind === 'sunny') return h('svg', { className: 'fd-weather-scene ' + (className || ''), viewBox: '0 0 40 40', 'aria-hidden': 'true' }, sun)
      if (kind === 'fair') return h('svg', { className: 'fd-weather-scene ' + (className || ''), viewBox: '0 0 40 40', 'aria-hidden': 'true' }, sun, cloud)
      if (kind === 'cloud') return h('svg', { className: 'fd-weather-scene ' + (className || ''), viewBox: '0 0 40 40', 'aria-hidden': 'true' }, cloud)
      if (kind === 'rain') return h('svg', { className: 'fd-weather-scene ' + (className || ''), viewBox: '0 0 40 40', 'aria-hidden': 'true' }, cloud,
        [15, 20, 25].map((x, i) => h('line', { key: 'd' + i, className: 'fd-w-drop', x1: x, y1: '31', x2: x, y2: '36' })))
      return h('svg', { className: 'fd-weather-scene ' + (className || ''), viewBox: '0 0 40 40', 'aria-hidden': 'true' }, cloud,
        h('path', { className: 'fd-w-bolt', d: 'M21 25l-4 7h5l-2 6 7-9h-5z' }))
    }

    const weatherCard = () => h('div', {
      className: 'fd-weather-card',
      tabIndex: 0,
      'aria-label': '任务天气：' + weather.word + ' · ' + weather.note,
    },
      h('div', { className: 'fd-weather-row' },
        WeatherScene({ kind: weather.key, className: 'fd-weather-scene' }),
        h('div', { className: 'fd-weather-copy' },
          h('b', null, weather.word),
          h('span', null, weather.note)),
        h('span', { className: 'fd-weather-updated' }, updatedText)),
      h('span', { className: 'fd-weather-tip', role: 'tooltip' },
        h('b', null, '天气怎么判定'),
        h('span', null, weather.criteria),
        h('i', null, '每天按本地「完成 / 在推 / 卡住 / 停滞」算，不调模型')))

    /* 左栏统计 = 本周 7 天完成柱（ECharts）：窄栏适合竖柱；右侧是 14 天趋势，不重复 */
    const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']
    const weekRows = (() => {
      const rows = items(stats?.series).slice(-7)
      if (rows.length === 7) return rows
      const out = []
      const end = new Date()
      end.setHours(0, 0, 0, 0)
      for (let i = 6; i >= 0; i -= 1) {
        const from = end.getTime() - i * 86_400_000
        out.push({ done: tasks.filter((task) => {
          const at = Number(task.completedAt)
          return at >= from && at < from + 86_400_000
        }).length })
      }
      return out
    })()
    const weekValues = weekRows.map((row) => Number(row?.done) || 0)
    const weekLabels = weekRows.map((row) => {
      const day = row?.day ? new Date(row.day + 'T00:00:00') : new Date()
      return Number.isNaN(day.getTime()) ? '' : WEEK_LABELS[day.getDay()]
    })
    const river = buildThemeRiver(Array.isArray(tasks) ? tasks : [])
    const prevRows = items(stats?.series).slice(-14, -7)
    const prevValues = weekValues.map((value, index) => Number(prevRows[index]?.done) || 0)
    const prevTotal = prevValues.reduce((sum, value) => sum + value, 0)
    const weekTotal = weekValues.reduce((sum, value) => sum + value, 0)
    const railChartNode = weekValues.length
      ? h('figure', { className: 'fd-rail-chart' },
        h('div', { className: 'fd-rail-chart-box' }, h(RailChart, {
          spec: 'week-done',
          data: { values: weekValues, previous: prevValues, labels: weekLabels, today: weekValues.length - 1 },
        })),
        h('figcaption', { className: 'fd-rail-chart-legend' },
          h('span', null, h('i', { className: 'fd-tone-brand', 'aria-hidden': 'true' }), '本周 ' + weekTotal),
          prevTotal > 0 ? h('span', null, h('i', { className: 'fd-tone-idle', 'aria-hidden': 'true' }), '上周 ' + prevTotal) : null))
      : h('p', { className: 'fd-rail-empty' }, weather.note)

    /* ---------- 深度区的小图：8 周进出台账 + 今日完成度 ---------- */
    const DAY = 86_400_000
    const weeklyFlow = (() => {
      const buckets = []
      const end = new Date()
      end.setHours(0, 0, 0, 0)
      const start = end.getTime() - 7 * DAY * 8 + DAY
      for (let i = 0; i < 8; i += 1) buckets.push({ from: start + i * 7 * DAY, created: 0, done: 0 })
      const add = (ts, key) => {
        const at = Number(ts)
        if (!at) return
        for (const bucket of buckets) {
          if (at >= bucket.from && at < bucket.from + 7 * DAY) { bucket[key] += 1; return }
        }
      }
      for (const task of tasks) {
        add(task.createdAt || task.firstSeenAt, 'created')
        if (task.done) add(task.completedAt, 'done')
      }
      return buckets
    })()
    const flowMax = Math.max(1, ...weeklyFlow.map((bucket) => Math.max(bucket.created, bucket.done)))
    const flowCreated = weeklyFlow.reduce((sum, bucket) => sum + bucket.created, 0)
    const flowDone = weeklyFlow.reduce((sum, bucket) => sum + bucket.done, 0)
    const flowNode = h('figure', { className: 'fd-mini' },
      h('figcaption', null, Icon({ name: 'task' }), h('span', null, '进出台账 · 8 周')),
      h('div', { className: 'fd-mini-bars' }, weeklyFlow.map((bucket, index) => h('div', { key: 'w' + index, className: 'fd-mini-col' },
        h('i', { className: 'is-created', style: { height: Math.round((bucket.created / flowMax) * 100) + '%' } }),
        h('i', { className: 'is-done', style: { height: Math.round((bucket.done / flowMax) * 100) + '%' } })))),
      h('p', { className: 'fd-mini-note' },
        '新增 ' + flowCreated + ' · 完成 ' + flowDone + ' · 净 ' + (flowCreated - flowDone > 0 ? '+' : '') + (flowCreated - flowDone)))

    const completionRate = Number(todayStat?.completion)
    const ringNode = typeof completionRate === 'number' && !Number.isNaN(completionRate)
      ? h('figure', { className: 'fd-mini fd-mini-ring' },
        h('div', { className: 'fd-ring', style: { '--p': Math.max(0, Math.min(100, Math.round(completionRate))) + '%' } },
          h('b', null, Math.round(completionRate) + '%')),
        h('figcaption', null, Icon({ name: 'target' }), h('span', null, '今日完成度')))
      : null

    /* ---------- 关联任务：「要处理」就是关联任务清单，每行可快速打开 ---------- */

    const recordNode = h('section', { className: 'fd-zone fd-zone-record' },
      h('div', { className: 'fd-zone-head' },
        Icon({ name: 'note' }),
        h('b', null, '记录与统计')),
      h('div', { className: 'fd-today-split' }, summaryBlock, chartNode))

    /* 深度 = 一张卡：下一动作 / 判断链 / 做得对 / 两张小图，段与段之间只用细线 */
    const deepNode = (nextNode || longTermNode || strengthsNode) ? h('section', { className: 'fd-zone fd-zone-deep' },
      h('div', { className: 'fd-zone-head' },
        Icon({ name: 'spark' }),
        h('b', null, '深度')),
      h('div', { className: 'fd-deep-body' },
        h('div', { className: 'fd-deep-main' },
          nextNode,
          longTermNode),
        h('div', { className: 'fd-deep-side' },
          strengthsNode,
          (flowNode || ringNode) ? h('div', { className: 'fd-deep-minis' }, flowNode, ringNode) : null))) : null

    /* 关联任务 = 原「要处理」：每条就是一张 task，行内直接打开 */
    const tasksZoneNode = h('section', { className: 'fd-zone fd-zone-tasks' },
      h('div', { className: 'fd-zone-head' },
        Icon({ name: 'task' }),
        h('b', null, '关联任务')),
      issueRows.length
        ? h('ul', { className: 'fd-ins-list' }, issueRows)
        : h('p', { className: 'fd-zone-empty' }, '这期判断没有点名要处理的任务。'))

    return h('section', {
      className: 'fd-panel fd-today fd-today-dash',
      'data-variant': 'dashboard',
      'data-mod': 'ai',
      'aria-label': '今日洞察',
    },
      h('div', { className: 'fd-ins' },
        h('aside', { className: 'fd-ins-rail' },
          h('div', { className: 'fd-ins-status' },
            weatherCard(),
            railChartNode,
            ThemeRiver({ river })),
          h('div', { className: 'fd-ins-figure' }, h(Face, { mood }))),
        h('div', { className: 'fd-ins-main' },
          /* 结论与操作同一行：没有「今日洞察」标题，就不该再为它单开一行。 */
          h('div', { className: 'fd-today-head fd-today-head-inline' },
            ai?.headline ? h('span', { className: 'fd-ins-headline' }, String(ai.headline).trim()) : null,
            tabsNode,
            extrasNode),
          noticeNode,
          commentNode,
          /* 分区①：记录（可编辑摘要）+ 统计图表 */
          recordNode,
          ai ? null : h('div', { className: 'fd-ins-summary' },
            canGenerate ? '当前 tab 还没有结论，点右上角生成。' : '当前宿主没有可读的诊断结果。'),
          /* 分区②：深度（下一动作 + 本期判断 + 小图） */
          deepNode,
          /* 分区③：关联任务（快速打开） */
          tasksZoneNode,
          /* 分区④：标签与操作 */
          footNode)))
  }
}
