/**
 * 「洞察」功能页 —— dashboard 风格，工厂组件，模块顶层不 import react。
 *
 * 六个面板（CSS grid `repeat(auto-fit, minmax(240px, 1fr))` + `grid-auto-rows: 1fr` 填满）：
 *   1. KPI 气泡行（全宽跨列）  2. 状态分布 donut（手绘 SVG，不引图表库）
 *   3. 项目分布横条            4. 关系概览
 *   5. 阻塞榜 Top5             6. 最近动态三列
 *
 * 数据全部来自 ctx（与关系图功能同一份快照）：{ tasks, relations, groups, workspaces, stats,
 * onOpenTask, selectedId }；纯计算在 `insightView.js` 的 `buildInsight`，这里只做渲染。
 * 样式在 `dashboardStyles.js`（`fd-` 前缀），组件首次渲染时幂等注入一次。
 */

import { buildInsight, buildHistory, calendarFromTasks, calendarHints } from './insightView.js'
import { injectStyles } from './dashboardStyles.js'
import { aiMascot } from './AiMascot.js'

const R = 52
const TAU = Math.PI * 2
const BOX = 132
const CENTER = BOX / 2
const CIRC = TAU * R

const toNum = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

let styleReady = false

function ensureStyles() {
  if (styleReady) return
  styleReady = true
  try {
    injectStyles()
  } catch (error) {
    /* 没有 document（node 单测环境）时静默跳过，样式交给宿主注入 */
  }
}

/**
 * 5 个尾部面板在 cols 列里怎么跨列，才能让**最后一行也铺满**（不留空洞）。
 * count=5, cols=4 → [4]（最后一格整行）；cols=3 → [2,1]；cols=6 → [2,1,1,1,1]。
 */
export function spansForTail(count, cols) {
  const n = Math.max(1, Math.floor(Number(count) || 1))
  const c = Math.max(1, Math.floor(Number(cols) || 1))
  const spans = new Array(n).fill(1)
  const rem = n % c
  if (!rem) return spans
  const base = Math.floor(c / rem)
  let extra = c - base * rem
  for (let i = n - rem; i < n; i += 1) {
    spans[i] = base + (extra > 0 ? 1 : 0)
    if (extra > 0) extra -= 1
  }
  return spans
}

export function createInsightFeature(deps) {
  const { React, h } = deps || {}
  const useEffect = React && typeof React.useEffect === 'function' ? React.useEffect : null
  const useRef = React && typeof React.useRef === 'function' ? React.useRef : null
  const useState = React && typeof React.useState === 'function' ? React.useState : null

  function Donut(view) {
    const total = view.totals.tasks
    let offset = 0
    const arcs = view.statusMix.filter((row) => row.count > 0).map((row) => {
      const len = total > 0 ? (row.count / total) * CIRC : 0
      const arc = { key: row.key, len, offset, tone: row.tone }
      offset += len
      return arc
    })
    return h('div', { className: 'fd-donut' },
      h('svg', { className: 'fd-donut-svg', viewBox: `0 0 ${BOX} ${BOX}`, role: 'img', 'aria-label': `状态分布：共 ${total} 个任务` },
        h('circle', { className: 'fd-donut-track', cx: CENTER, cy: CENTER, r: R }),
        h('g', { transform: `rotate(-90 ${CENTER} ${CENTER})` }, arcs.map((arc) => h('circle', {
          key: arc.key,
          className: `fd-donut-arc fd-tone-${arc.tone}`,
          cx: CENTER,
          cy: CENTER,
          r: R,
          strokeDasharray: `${Math.max(0, arc.len)} ${Math.max(0, CIRC - arc.len)}`,
          strokeDashoffset: -arc.offset,
        }))),
        h('text', { className: 'fd-donut-center', x: CENTER, y: CENTER + 2, textAnchor: 'middle' }, String(total)),
        h('text', { className: 'fd-donut-caption', x: CENTER, y: CENTER + 18, textAnchor: 'middle' }, '任务'),
      ),
      h('div', { className: 'fd-legend' }, view.statusMix.map((row) => h('div', { key: row.key, className: `fd-legend-row fd-tone-${row.tone}` },
        h('span', { className: 'fd-legend-dot', 'aria-hidden': 'true' }),
        h('span', { className: 'fd-legend-label' }, row.label),
        h('span', { className: 'fd-legend-value' }, String(row.count)),
        h('span', { className: 'fd-legend-pct' }, `${row.pct}%`),
      ))),
    )
  }

  function openTask(ctx, id) {
    if (typeof ctx.onOpenTask === 'function' && id) ctx.onOpenTask(id)
  }

  return function InsightFeature(props) {
    const ctx = props || {}
    ensureStyles()
    if (useEffect) {
      useEffect(() => { ensureStyles() }, [])
    }
    /* 实测列数：和 CSS 的断点一一对应（1100/820/540 → 4/3/2/1 列，见 dashboardStyles 的 @container fdpage）。
       ctx.columns 可显式给（静态自测页/测试用），否则用 ResizeObserver 量。
       注意：这里只影响 spansForTail 算出来的跨列数，必须和 CSS 的列数一致，否则卡片会跨出错位。 */
    const hostRef = useRef ? useRef(null) : null
    const [cols, setColsState] = useState ? useState(toNum(ctx.columns) || 0) : [toNum(ctx.columns) || 0, () => {}]
    const setCols = typeof setColsState === 'function' ? setColsState : (setColsState && setColsState[1]) || (() => {})
    if (useEffect) {
      useEffect(() => {
        if (toNum(ctx.columns)) return undefined
        const el = hostRef && hostRef.current
        if (!el || typeof ResizeObserver !== 'function') return undefined
        const compute = (width) => {
          const next = width >= 1100 ? 4 : (width >= 820 ? 3 : (width >= 540 ? 2 : 1))
          setCols((prev) => (prev === next ? prev : next))
        }
        compute(el.getBoundingClientRect().width)
        const ro = new ResizeObserver((entries) => {
          for (const entry of entries) compute(entry.contentRect ? entry.contentRect.width : 0)
        })
        ro.observe(el)
        return () => ro.disconnect()
      }, [])
    }
    const view = buildInsight(ctx.snapshot || ctx)

    /* ---- 历史指标（/api/insight/stats）：拿不到就降级，只保留快照口径的六个面板 ---- */
    const api = deps.api || ctx.api
    const fetchStats = api && typeof api.insightStats === 'function' ? (days) => api.insightStats(days) : null
    const [hist, setHist] = useState ? useState(() => ({
      phase: fetchStats ? 'loading' : 'unsupported',
      view: null,
      message: '',
    })) : [{ phase: fetchStats ? 'loading' : 'unsupported', view: null, message: '' }, () => {}]
    const histState = Array.isArray(hist) ? hist[0] : hist
    const setHistState = Array.isArray(hist) ? hist[1] : setHist
    const [retry, setRetry] = useState ? useState(0) : [0, () => {}]
    const retryCount = Array.isArray(retry) ? retry[0] : retry
    const bumpRetry = Array.isArray(retry) ? retry[1] : (() => {})

    /* ---- AI 诊断：先读现成结果（零模型成本），重新诊断走后台 job 再轮询 ---- */
    const fetchInsight = api && typeof api.insight === 'function' ? () => api.insight() : null
    const startDiagnose = api && typeof api.insightDiagnose === 'function' ? (options) => api.insightDiagnose(options) : null
    const pollInsight = api && typeof api.insightAi === 'function' ? () => api.insightAi() : null
    const canDiagnose = Boolean(fetchInsight && startDiagnose && pollInsight)
    const aiAlive = useRef ? useRef(true) : null
    const [ai, setAi] = useState
      ? useState(() => ({ phase: fetchInsight ? 'loading' : 'unsupported', data: null, message: '' }))
      : [{ phase: fetchInsight ? 'loading' : 'unsupported', data: null, message: '' }, () => {}]
    const aiState = Array.isArray(ai) ? ai[0] : ai
    /* 有 hooks 时 ai 是状态值本身，setter 是 setAi；只有无 hooks 的降级分支才是数组。 */
    const setAiState = Array.isArray(ai) ? ai[1] : setAi

    if (useEffect) {
      useEffect(() => {
        if (aiAlive) aiAlive.current = true
        if (!fetchInsight) return () => { if (aiAlive) aiAlive.current = false }
        let cancelled = false
        Promise.resolve()
          .then(() => fetchInsight())
          .then((payload) => {
            if (cancelled) return
            const data = payload && payload.ai && typeof payload.ai === 'object' ? payload.ai : null
            /* local 是引擎本地算的今日/看板数据：左栏的「数据」只用它，不用模型自评分。 */
            const local = payload && payload.local && typeof payload.local === 'object' ? payload.local : null
            setAiState({ phase: data ? 'ok' : 'idle', data, local, message: '' })
          })
          .catch((error) => {
            if (!cancelled) setAiState({ phase: 'failed', data: null, message: (error && error.message) || '读取诊断失败' })
          })
        return () => { cancelled = true; if (aiAlive) aiAlive.current = false }
      }, [])
    }

    /* 点一次按钮 = 触发后台任务 + 轮询到出结果；轮询有上限，不无限转圈。 */
    const runDiagnose = () => {
      if (!canDiagnose || aiState.phase === 'running') return
      setAiState((prev) => ({ phase: 'running', data: prev && prev.data ? prev.data : null, message: '' }))
      Promise.resolve()
        .then(() => startDiagnose({ force: true, mode: 'diagnose' }))
        .then(async () => {
          for (let attempt = 0; attempt < 24; attempt += 1) {
            if (aiAlive && aiAlive.current === false) return
            await new Promise((resolve) => setTimeout(resolve, 2500))
            const state = await pollInsight()
            if (!state || state.running) continue
            if (state.data) {
              /* 诊断后本地统计也变了（比如今天完成数），顺手刷新一次；失败不影响结论。 */
              let local = null
              try { local = ((await fetchInsight()) || {}).local || null } catch (error) { local = null }
              setAiState({ phase: 'ok', data: state.data, local, message: '' })
            } else {
              setAiState({ phase: 'failed', data: null, message: state.error || '模型没有返回可用结果' })
            }
            return
          }
          setAiState((prev) => ({ phase: 'failed', data: prev && prev.data ? prev.data : null, message: '仍在后台跑，稍后刷新再看' }))
        })
        .catch((error) => {
          setAiState({ phase: 'failed', data: null, message: (error && error.message) || '诊断没跑成' })
        })
    }

    if (useEffect) {
      useEffect(() => {
        if (!fetchStats) {
          setHistState({ phase: 'unsupported', view: null, message: '' })
          return undefined
        }
        let cancelled = false
        let settled = false
        const finish = (next) => {
          if (cancelled || settled) return
          settled = true
          clearTimeout(timer)
          setHistState(next)
        }
        setHistState((prev) => ({ phase: 'loading', view: prev && prev.phase === 'ok' ? prev.view : null, message: '' }))
        /* 7s 没回来就按失败处理（不阻塞页面，也不无限转圈） */
        const timer = setTimeout(() => finish({ phase: 'failed', view: null, message: '请求超时' }), 7000)
        Promise.resolve()
          .then(() => fetchStats(14))
          .then((payload) => {
            const built = buildHistory(payload, toNum(ctx.now) || Date.now())
            if (built.ok) finish({ phase: 'ok', view: built, message: '' })
            else if (built.reason === 'empty') finish({ phase: 'empty', view: null, message: '还没有历史记录' })
            else if (built.reason === 'failed') finish({ phase: 'failed', view: null, message: '接口返回失败' })
            else finish({ phase: 'failed', view: null, message: '返回结构不完整' })
          })
          .catch((error) => finish({ phase: 'failed', view: null, message: (error && error.message) || '请求失败' }))
        return () => { cancelled = true; clearTimeout(timer) }
      }, [retryCount])
    }

    /* ---- 活跃日历：直接从快照任务的时间戳算，不依赖新接口（老宿主也能立刻有数据） ---- */
    const calView = view.empty ? null : calendarFromTasks((ctx.snapshot || ctx).tasks, toNum(ctx.now) || Date.now(), 182)

    const history = histState.phase === 'ok' ? histState.view : null

    /* ---- AI 诊断面板 ---- */
    const aiData = aiState.data && typeof aiState.data === 'object' ? aiState.data : null
    const aiIdByNo = new Map()
    for (const task of (ctx.snapshot || ctx).tasks || []) {
      if (task && Number(task.no)) aiIdByNo.set(Number(task.no), task.id)
    }
    /* 脸：用户 profile 上那张动图（animated WebP）在上，SVG 小助手在下；
       图一加载成功就藏掉 SVG；图挂了就把 img 摘掉，SVG 继续当着——不留空白框。 */
    const aiFace = (mood) => h('div', { className: 'fd-ins-face' },
      h('div', { className: 'fd-figure', 'data-mood': mood, 'aria-hidden': 'true' },
      /* 动图自带透明通道，直接按原始比例摆；不要圆角、不要底色、不要裁切。 */
      aiMascot(h, mood),
      h('img', {
        className: 'fd-figure-img',
        src: '/dsh-cove-task/tasks/assets/kp-avatar.webp',
        alt: '',
        decoding: 'async',
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
      }))
    )

    /* 一条结论 = 列表里的一行：序号/对勾 + 判断 + 依据 + 动作。
       不用「一条一个框」，是因为十几个同质边框会把重点切碎；
       两栏（要处理 / 做得对）+ 左侧色条，扫一眼就能分出轻重。 */
    const insRow = (kind, item, index) => {
      const tone = kind === 'issue'
        ? (item.level === 'bad' ? 'danger' : (item.level === 'warn' ? 'warn' : 'brand'))
        : 'ok'
      const taskId = aiIdByNo.get(Number(item.taskNo))
      return h('li', {
        key: kind + ':' + (item.taskNo || 0) + ':' + String(item.text || '').slice(0, 24),
        className: 'fd-ins-row fd-tone-' + tone,
      },
        h('span', { className: 'fd-ins-mark', 'aria-hidden': 'true' }, kind === 'issue' ? String(index + 1) : '✓'),
        h('span', { className: 'fd-ins-row-main' },
          h('span', { className: 'fd-ins-row-text', title: item.text }, item.text),
          item.evidence ? h('span', { className: 'fd-ins-row-ev' }, '依据 · ' + item.evidence) : null),
        taskId
          ? h('span', { className: 'fd-ins-acts' },
            h('button', { type: 'button', className: 'fd-ai-jump', title: '打开这条任务', onClick: () => openTask(ctx, taskId) }, '打开'),
            canWrite ? writeControl(taskId, item) : null)
          : null,
      )
    }
    const insBlock = (key, label, rows, tone) => h('section', { key, className: 'fd-ins-block' },
      h('div', { className: 'fd-ins-block-head' },
        h('span', { className: 'fd-ins-block-dot fd-tone-' + (tone || 'brand') }),
        h('span', null, label),
        rows.length ? h('b', null, String(rows.length)) : null),
      h('ul', { className: 'fd-ins-list' }, rows))
    const aiAction = (label, onClick, disabled) => h('button', {
      type: 'button', className: 'fd-ai-btn', disabled: disabled === true, onClick,
    }, label)
    /* 写评论是外部副作用（发到飞书），所以做成两段：先点亮「写评论」，再点「确认写入」。 */
    const canWrite = Boolean(api && typeof api.insightExport === 'function')
    const [writeState, setWriteState] = useState ? useState(null) : [null, () => {}]
    const ws = Array.isArray(writeState) ? writeState[0] : writeState
    /* 有 hooks 时 writeState 是状态值本身，setter 是解构出来的 setWriteState；
       只有无 hooks 的降级分支才是数组。写错成空函数会让按钮静默失效。 */
    const setWs = Array.isArray(writeState) ? writeState[1] : setWriteState
    const writeComment = (taskId, text) => {
      if (!canWrite) return
      setWs({ key: taskId, phase: 'running', message: '' })
      Promise.resolve()
        .then(() => api.insightExport(taskId, text))
        .then((result) => setWs({
          key: taskId,
          phase: result && result.ok === false ? 'failed' : 'ok',
          message: (result && result.error) || '已写入评论',
        }))
        .catch((error) => setWs({ key: taskId, phase: 'failed', message: (error && error.message) || '写入失败' }))
    }

    /* 每条结论旁的动作：确认后才把这段写进任务评论（外部副作用，不自动发）。 */
    const writeControl = (taskId, item) => {
      const current = ws && ws.key === taskId ? ws : null
      if (current && current.phase === 'running') return h('span', { className: 'fd-ai-write' }, '写入中…')
      if (current && current.phase === 'ok') return h('span', { className: 'fd-ai-write fd-tone-ok' }, current.message || '已写入')
      if (current && current.phase === 'failed') return h('span', { className: 'fd-ai-write fd-tone-danger' }, current.message || '写入失败')
      if (current && current.phase === 'confirm') {
        const text = '[洞察] ' + item.text + (item.evidence ? '（依据：' + item.evidence + '）' : '')
        return h('span', { className: 'fd-ai-write' },
          h('button', { type: 'button', className: 'fd-ai-jump', onClick: () => writeComment(taskId, text) }, '确认写入'),
          h('button', { type: 'button', className: 'fd-ai-jump', onClick: () => setWs(null) }, '取消'))
      }
      return h('button', {
        type: 'button', className: 'fd-ai-jump', title: '把这条结论写进任务的飞书评论',
        onClick: () => setWs({ key: taskId, phase: 'confirm', message: '' }),
      }, '写评论')
    }

    const aiAt = toNum(aiData && aiData.at)
    const aiAtText = aiAt ? new Date(aiAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

    const aiBody = (() => {
      /* 没结论时也保持同一套骨架：小人 + 一句话 + 一个动作，页面不会突然变成一行灰字。 */
      /* 同一套骨架：左栏上=状态、下=人物；右栏=文字与动作。 */
      const stateHero = (mood, eyebrow, title, text, actions) => h('div', { className: 'fd-ins is-state' },
        h('aside', { className: 'fd-ins-rail' },
          h('div', { className: 'fd-ins-status' },
            h('div', { className: 'fd-ins-status-head' }, eyebrow)),
          h('div', { className: 'fd-ins-figure' }, aiFace(mood)),
        ),
        h('div', { className: 'fd-ins-main' },
          h('div', { className: 'fd-ins-headline' }, title),
          h('div', { className: 'fd-ins-summary' }, text),
          actions ? h('div', { className: 'fd-ins-actions' }, actions) : null,
        ),
      )
      /* eyebrow 不重复卡片标题里的「AI 诊断」，只说这一刻的状态。 */
      if (!fetchInsight) {
        return stateHero('calm', '暂不可用', '这台宿主还没有诊断接口', '其余看板不受影响；升级宿主或重载插件后再来。')
      }
      if (aiState.phase === 'loading') {
        return stateHero('calm', '读取中', '正在读取上次的结论…', '只读本地缓存，不会调用模型。')
      }
      if (aiState.phase === 'running') {
        return stateHero('thinking', '分析中', '正在读任务与对话…', '通常十几秒；可以切到别的页面，回来结论还在。')
      }
      if (aiState.phase === 'failed') {
        return stateHero('alert', '没有结论', '这次没跑成', aiState.message || '模型没有返回可用结果。',
          canDiagnose ? aiAction(aiData ? '再试一次' : '重试', runDiagnose) : null)
      }
      if (!aiData) {
        return stateHero('calm', '待命', '还没诊断过', '它只读任务与对话、只给判断和建议，不会改任何任务。',
          canDiagnose ? aiAction('跑一次诊断', runDiagnose) : null)
      }
      const issues = Array.isArray(aiData.issues) ? aiData.issues.filter((item) => item && item.text) : []
      const strengths = Array.isArray(aiData.strengths) ? aiData.strengths.filter((item) => item && item.text) : []
      const improve = Array.isArray(aiData.improve) ? aiData.improve.filter((item) => item && (item.title || item.detail)) : []
      const patterns = Array.isArray(aiData.delayPatterns) ? aiData.delayPatterns : []
      /* 有结论：小人的表情跟着结论走——有严重问题就皱眉，只有好事就笑。 */
      const mood = issues.some((item) => item.level === 'bad') ? 'alert' : (strengths.length ? 'happy' : 'calm')
      /* 左栏只放「可核对的数据」：全部来自本地引擎（/api/insight 的 local），
         不再用模型自评的 focus/throughput/hygiene——那是模型的印象分，不能当数据看。 */
      const local = aiState.local && typeof aiState.local === 'object' ? aiState.local : null
      const todayStat = local && local.today ? local.today : null
      const boardStat = local && local.board ? local.board : null
      const clamped = (v) => Math.max(0, Math.min(100, toNum(v)))
      const facts = []
      if (todayStat) {
        facts.push({ key: 'done', label: '今日完成', value: todayStat.doneCount + ' 条' })
        if (todayStat.completion !== null && todayStat.completion !== undefined && todayStat.completion !== '') {
          facts.push({ key: 'rate', label: '完成度', value: todayStat.completion + '%', bar: clamped(todayStat.completion) })
        }
        facts.push({ key: 'active', label: '今日活跃', value: todayStat.activeCount + ' 条' })
        facts.push({ key: 'drift', label: '停滞占比', value: todayStat.deviation + '% · ' + todayStat.deviationLevel })
      } else if (boardStat) {
        facts.push({ key: 'started', label: '在跑', value: boardStat.started + ' 条' })
        facts.push({ key: 'idle', label: '未开始', value: boardStat.idle + ' 条' })
      }

      /* 版面：左栏 上=状态、下=人物；右栏 判断 → 下一步 → 两栏结论 → 轻脚注。 */
      return h('div', { className: 'fd-ins' },
        /* 重新判断放右上角：它是这张卡的「刷新」，不是读内容的最后一步。 */
        canDiagnose
          ? h('div', { className: 'fd-ins-corner' }, aiAction('重新判断', runDiagnose, aiState.phase === 'running'))
          : null,
        h('aside', { className: 'fd-ins-rail' },
          h('div', { className: 'fd-ins-status' },
            h('div', { className: 'fd-ins-status-head' },
              h('span', { className: 'fd-ins-status-dot', 'aria-hidden': 'true' }),
              h('span', null, aiAtText ? aiAtText + ' 更新' : '当前状态'),
            ),
            facts.length
              ? h('div', { className: 'fd-ins-facts' }, facts.map((fact) => h('div', { key: fact.key, className: 'fd-ins-fact' },
                h('span', { className: 'fd-ins-fact-label' }, fact.label),
                h('b', { className: 'fd-ins-fact-value' }, fact.value),
                fact.bar !== undefined
                  ? h('span', { className: 'fd-ins-fact-bar' }, h('i', { style: { width: fact.bar + '%' } }))
                  : null)))
              : null,
            boardStat
              ? h('div', { className: 'fd-ins-status-meta' },
                h('span', null, '共 ' + boardStat.total + ' 条'),
                h('span', null, '在跑 ' + boardStat.started),
                h('span', null, '未开始 ' + boardStat.idle))
              : null,
          ),
          h('div', { className: 'fd-ins-figure' }, aiFace(mood)),
        ),
        h('div', { className: 'fd-ins-main' },
          aiData.headline ? h('div', { className: 'fd-ins-headline' }, aiData.headline) : null,
          aiData.summary ? h('div', { className: 'fd-ins-summary' }, aiData.summary) : null,
          aiData.advice
          ? (() => {
            /* 建议里点名了哪条任务，就在这里给一个直达入口——比让人回列表里找要快。 */
            const hit = String(aiData.advice).match(/T(\d{2,})/)
            const targetId = hit ? aiIdByNo.get(Number(hit[1])) : null
            return h('div', { className: 'fd-ins-next' },
              h('span', { className: 'fd-ins-next-tag' }, '下一步'),
              h('p', { className: 'fd-ins-next-text' }, aiData.advice),
              targetId
                ? h('button', { type: 'button', className: 'fd-ai-jump', onClick: () => openTask(ctx, targetId) }, '打开 T' + hit[1])
                : null)
          })()
          : null,
        (issues.length || strengths.length)
          ? h('div', { className: 'fd-ins-cols' },
            issues.length ? insBlock('issues', '要处理', issues.map((item, index) => insRow('issue', item, index)), 'danger') : null,
            strengths.length ? insBlock('strengths', '做得对', strengths.map((item, index) => insRow('strength', item, index)), 'ok') : null)
          : null,
        (improve.length || aiData.fulfillmentComment || patterns.length || canDiagnose)
          ? h('div', { className: 'fd-ins-foot' },
            improve.length
              ? h('div', { className: 'fd-ins-chips' }, improve.map((item) => h('span', {
                key: 'improve:' + (item.title || '') + (item.detail || ''),
                className: 'fd-ins-chip', title: item.detail || '',
              }, item.title || item.detail)))
              : null,
            (aiData.fulfillmentComment || patterns.length)
              ? h('div', { className: 'fd-ins-meta' },
                aiData.fulfillmentComment ? h('span', null, '履约 · ' + aiData.fulfillmentComment) : null,
                patterns.map((item) => h('span', {
                  key: 'delay:' + (item.bucket || item.label),
                  className: 'fd-ins-meta-item',
                  title: [item.comment, item.advice].filter(Boolean).join(' → '),
                }, '延期 · ' + (item.label || item.bucket || '未分类') + ' ' + (toNum(item.count) || 0) + ' 次')))
              : null)
          : null,
        ),
      )
    })()

    if (view.empty) {
      return h('div', { className: 'fd-page', 'data-empty': '1' },
        h('div', { className: 'fd-empty', role: 'status' },
          h('div', { className: 'fd-empty-title' }, '还没有任务可以洞察'),
          h('div', { className: 'fd-empty-body' }, '等飞书任务同步进来，这里会自动长出指标、分布与榜单。'),
        ),
      )
    }

    /* 尾部面板数 = 5（快照口径）+ 4（历史指标，拿不到就不渲染） */
    const tailCount = 5 + (history ? 4 : 0)
    const tailSpans = spansForTail(tailCount, cols || 1)
    const panel = (index, key, title, hint, extra, body, span, mod) => h('section', {
      key,
      className: 'fd-panel',
      'data-span': span === 'all' ? 'all' : String(span || 1),
      /* mod 是给样式用的变体标记（目前只有 AI 诊断卡），不参与逻辑。 */
      ...(mod ? { 'data-mod': mod } : {}),
      /* 没标题的卡片（洞察）不渲染头部：别的卡片照旧。无障碍名字仍然给一个，别让读屏读到空 section。 */
      'aria-label': title || (mod === 'ai' ? '洞察结论' : '面板'),
      style: span === 'all' ? { '--fd-i': index } : { '--fd-i': index, gridColumn: `span ${span || 1}` },
    },
      title || hint || extra
        ? h('div', { className: 'fd-panel-head' },
          title ? h('span', { className: 'fd-panel-title' }, title) : null,
          hint ? h('span', { className: 'fd-panel-hint' }, hint) : null,
          extra ? h('span', { className: 'fd-panel-extra' }, extra) : null,
        )
        : null,
      h('div', { className: 'fd-panel-body' }, body),
    )

    /* 1) KPI 气泡行 */
    const kpis = panel(0, 'kpi', '关键指标', `共 ${view.totals.tasks} 个任务`, view.totals.running ? `${view.totals.running} 个会话在跑` : '',
      h('div', { className: 'fd-kpis' }, view.kpis.map((kpi) => h('div', { key: kpi.id, className: `fd-kpi fd-tone-${kpi.tone}` },
        h('span', { className: 'fd-kpi-bubble' }, kpi.text),
        h('span', { className: 'fd-kpi-main' },
          h('span', { className: 'fd-kpi-label' }, kpi.label),
          h('span', { className: 'fd-bar', role: 'presentation' }, h('i', { style: { width: `${Math.round(kpi.ratio * 100)}%` } })),
          h('span', { className: 'fd-kpi-note' }, kpi.note || ''),
        ),
      ))), 1)

    /* 1b) 活跃日历（GitHub 贡献图）：左上角这张卡回答「这半年哪天在动」+ 三句 AI 结论。
       右半边放提示语：热力图不需要占满整卡宽度，空出来的地方比再拉宽格子有用。 */
    const CAL_DOWS = ['一', '', '三', '', '五', '', '日']
    const calHints = calView ? calendarHints((ctx.snapshot || ctx).tasks, toNum(ctx.now) || Date.now(), calView) : []
    const calPanel = calView ? panel(1, 'calendar', '活跃日历', '每天的任务动静（新建 + 开工 + 完成）', `${calView.total} 个事件 · ${calView.activeDays} 天有动静`,
      h('div', { className: 'fd-cal' },
        h('div', { className: 'fd-cal-main' },
          h('div', { className: 'fd-cal-calendar' },
            h('div', { className: 'fd-cal-scroll' },
              /* 列数交给 CSS：--fd-cal-weeks 决定周列数，格子 1fr + aspect-ratio 跟着这一栏的宽度走 */
              h('div', { className: 'fd-cal-inner', style: { '--fd-cal-weeks': String(calView.weeks.length) } },
                h('div', { className: 'fd-cal-months', 'aria-hidden': 'true' },
                  calView.months.map((month) => h('span', {
                    key: month.key,
                    className: 'fd-cal-month',
                    style: { gridColumn: String(month.column + 1) },
                  }, month.label))),
                h('div', { className: 'fd-cal-dows', 'aria-hidden': 'true' },
                  CAL_DOWS.map((label, index) => h('span', { key: index }, label))),
                h('div', {
                  className: 'fd-cal-grid',
                  role: 'img',
                  'aria-label': `活跃日历：近 ${calView.weeks.length} 周，共 ${calView.total} 个事件`,
                },
                  calView.weeks.map((week) => h('div', { key: week.key, className: 'fd-cal-week' },
                    week.cells.map((cell, index) => (cell
                      ? h('i', {
                        key: cell.day,
                        className: 'fd-cal-cell',
                        'data-level': String(cell.level),
                        title: `${cell.day} · ${cell.total} 件（新建 ${cell.created} · 开工 ${cell.started} · 完成 ${cell.done}）`,
                      })
                      : h('i', { key: 'empty-' + index, className: 'fd-cal-cell is-empty', 'aria-hidden': 'true' })))))))),
            h('div', { className: 'fd-cal-legend' },
              h('span', null, '少'),
              [0, 1, 2, 3, 4].map((level) => h('i', { key: level, className: 'fd-cal-cell', 'data-level': String(level), 'aria-hidden': 'true' })),
              h('span', null, '多'))),
          calHints.length
            ? h('div', { className: 'fd-cal-hints' },
              h('div', { className: 'fd-cal-hints-head' },
                h('span', { className: 'fd-cal-ai' }, 'AI'),
                h('span', null, '提示')),
              h('ul', { className: 'fd-cal-hints-list' },
                calHints.map((hint) => h('li', { key: hint.key }, hint.text))))
            : null)),
      1) : null

    /* 2) 状态分布 donut */
    const donut = panel(1, 'status', '状态分布', '互斥四桶，和恰好 100%', '', Donut(view), tailSpans[0])

    /* 3) 项目分布 */
    const workspaces = panel(2, 'projects', '项目分布', `Top 8${view.workspaces.length > 8 ? ' + 其他' : ''}`, `${view.projectCount} 个项目`,
      h('div', { className: 'fd-list fd-scroll' }, view.workspaces.map((row) => h('div', {
        key: row.key,
        className: 'fd-list-row',
        /* 项目分色：insightView 算好的 deco 指到 --fo-deco-N（与画布上同一个色板），
           不要用 fd-tone-*（那是状态色调，项目行没有 tone，会拿到 fd-tone-undefined → 全部回退品牌色）。 */
        style: { '--fd-tone': `var(--fo-deco-${row.deco}, var(--dsw-alias-brand-primary))` },
      },
        h('span', { className: 'fd-list-label', title: row.label }, row.label),
        h('span', { className: 'fd-list-bar' },
          h('span', { className: 'fd-bar-split' },
            h('i', { style: { width: `${Math.max(2, Math.round(row.share * 100))}%` } }),
            h('b', { style: { width: `${Math.max(0, Math.round(row.share * row.ratio * 100))}%` } }),
          ),
        ),
        h('span', { className: 'fd-list-value' }, `${row.done}/${row.total}`),
        h('span', { className: 'fd-list-meta' }, `${row.pct}%`),
      ))), tailSpans[1])

    /* 4) 关系概览 */
    const relations = panel(3, 'relations', '关系概览', '', `${view.relations.total} 条关系`,
      h('div', { className: 'fd-kv' }, view.relations.rows.map((row) => h('div', { key: row.key, className: `fd-kv-item fd-tone-${row.tone}` },
        h('span', { className: 'fd-kv-label' }, row.label),
        h('span', { className: 'fd-kv-value' }, String(row.value)),
        h('span', { className: 'fd-kv-hint', title: row.hint }, row.hint),
      ))), tailSpans[2])

    /* 5) 阻塞榜 Top5 */
    const blockers = panel(4, 'blockers', '阻塞榜', '按「等几个」排序', view.blockers.length ? `Top ${view.blockers.length}` : '',
      view.blockers.length
        ? h('div', { className: 'fd-list fd-scroll' }, view.blockers.map((row) => h('button', {
          key: row.id,
          type: 'button',
          className: 'fd-item fd-tone-danger',
          title: `打开 ${row.title}`,
          onClick: () => openTask(ctx, row.id),
        },
          h('span', { className: 'fd-item-rank' }, String(row.rank)),
          h('span', { className: 'fd-item-main' },
            h('span', { className: 'fd-item-title' }, row.title),
            h('span', { className: 'fd-item-sub' }, `等 ${row.waitingText}`),
          ),
          h('span', { className: 'fd-item-badge' }, `${row.count} 个`),
        )))
        : h('div', { className: 'fd-empty-line' }, '没有被阻塞的任务 🎉'), tailSpans[3])

    /* 6) 最近动态 */
    const recentCol = (key, label, rows) => h('div', { key, className: 'fd-recent-col' },
      h('div', { className: 'fd-recent-title' }, label),
      rows.length
        ? rows.map((row) => h('button', {
          key: row.id,
          type: 'button',
          className: 'fd-item',
          title: `打开 ${row.title}`,
          onClick: () => openTask(ctx, row.id),
        },
          row.running ? h('span', { className: 'fd-live-dot', 'aria-label': '运行中' }) : null,
          h('span', { className: 'fd-item-main' },
            h('span', { className: 'fd-item-title' }, row.title),
            h('span', { className: 'fd-item-sub' }, [row.atText, row.workspaceTitle].filter(Boolean).join(' · ') || (row.no ? `#${row.no}` : '')),
          ),
        ))
        : h('div', { className: 'fd-empty-line' }, '暂无'),
    )
    const recent = panel(5, 'recent', '最近动态', `按${view.recent.orderBy}`, '',
      /* fd-scroll：组一多就滚动，而不是把行压扁（压扁会让两行文字叠在一起） */
      h('div', { className: 'fd-recent fd-scroll' },
        recentCol('done', '最近完成', view.recent.done),
        recentCol('started', '最近开始', view.recent.started),
        recentCol('suspended', '最近挂起', view.recent.suspended),
      ), tailSpans[4])

    /* 面板只用现有的 fd- 类（样式文件不在我的写范围），SVG 里的颜色走宿主令牌 -->
       下面都复用 .fd-legend-row / .fd-list / .fd-kv / .fd-bar / .fd-donut-* 这些已有形制。 */

    /* 7) 吞吐趋势：双色柱 + 活跃折线（手绘 SVG，几何在纯函数里算好） */
    const trendSvg = history ? h('svg', {
      className: 'fd-donut-svg',
      style: { width: '100%', height: '100%', minHeight: 0, display: 'block' },
      viewBox: `0 0 ${history.trend.width} ${history.trend.height}`,
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': `近 ${history.trend.days} 天吞吐趋势`,
    },
      h('line', {
        x1: 0,
        y1: history.trend.baseline,
        x2: history.trend.width,
        y2: history.trend.baseline,
        style: { stroke: 'var(--dsw-alias-border-l1)', strokeWidth: 1 },
      }),
      history.trend.bars.done.map((bar) => h('rect', {
        key: bar.key,
        x: bar.x,
        y: bar.y,
        width: bar.w,
        height: bar.h,
        style: { fill: 'var(--dsw-alias-state-success-primary)' },
      })),
      history.trend.bars.created.map((bar) => h('rect', {
        key: bar.key,
        x: bar.x,
        y: bar.y,
        width: bar.w,
        height: bar.h,
        style: { fill: 'var(--dsw-alias-brand-primary)', opacity: 0.75 },
      })),
      history.trend.line.path
        ? h('path', {
          d: history.trend.line.path,
          style: { fill: 'none', stroke: 'var(--dsw-alias-label-primary)', strokeWidth: 1.6, strokeLinejoin: 'round', strokeLinecap: 'round', opacity: 0.55 },
        })
        : null,
    ) : null
    const trendPanel = history ? panel(6, 'trend', '吞吐趋势', `近 ${history.trend.days} 天`, `${history.trend.totals.done} 完成 / ${history.trend.totals.created} 新增`,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0, flex: '1 1 auto' } },
        h('div', { className: 'fd-legend', style: { flexDirection: 'row', flexWrap: 'wrap', gap: '10px' } },
          h('span', { className: 'fd-legend-row fd-tone-ok' }, h('span', { className: 'fd-legend-dot' }), h('span', { className: 'fd-legend-label' }, '完成')),
          h('span', { className: 'fd-legend-row fd-tone-brand' }, h('span', { className: 'fd-legend-dot' }), h('span', { className: 'fd-legend-label' }, '新增')),
          h('span', { className: 'fd-legend-row fd-tone-idle' }, h('span', { className: 'fd-legend-dot' }), h('span', { className: 'fd-legend-label' }, '活跃（折线）')),
        ),
        /* 卡片现在按内容定高：图表给一个实打实的最小高度，否则 height:100% 会塌成 0 */
        h('div', { style: { flex: '1 1 auto', minHeight: '120px', display: 'flex' } }, trendSvg),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '6px' } },
          history.trend.ticks.map((tick) => h('span', { key: tick.key, className: 'fd-panel-hint' }, tick.label)),
        ),
      ), tailSpans[5]) : null

    /* 8) 履约：准时率环 + 大数字 + 追踪中 / 逾期 / 平均富余 */
    const fulfillmentPanel = history ? panel(7, 'fulfillment', '履约', '近 28 天有承诺时间的任务', history.fulfillment.hasData ? `追踪 ${history.fulfillment.tracked}` : '',
      history.fulfillment.hasData
        ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', minHeight: 0, flex: '1 1 auto' } },
          h('div', { className: `fd-tone-${history.fulfillment.onTimePct === null ? 'idle' : (history.fulfillment.onTimePct >= 70 ? 'ok' : (history.fulfillment.onTimePct >= 40 ? 'brand' : 'danger'))}`, style: { flex: '0 0 auto', position: 'relative', width: '72px', height: '72px' } },
            h('svg', { className: 'fd-donut-svg', viewBox: '0 0 64 64', style: { width: '72px', height: '72px' }, role: 'img', 'aria-label': `准时率 ${history.fulfillment.onTimeText}` },
              h('circle', { className: 'fd-donut-track', cx: 32, cy: 32, r: 26 }),
              h('circle', { className: 'fd-donut-arc', cx: 32, cy: 32, r: 26, strokeDasharray: `${history.fulfillment.ring.dash} ${history.fulfillment.ring.circ}`, transform: 'rotate(-90 32 32)' }),
            ),
            h('span', { className: 'fd-kv-value', style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px' } }, history.fulfillment.onTimeText),
          ),
          h('div', { className: 'fd-list', style: { flex: '1 1 auto', minWidth: 0 } },
            h('div', { className: 'fd-panel-hint' }, history.fulfillment.slackText),
            history.fulfillment.rows.map((row) => h('div', { key: row.key, className: `fd-list-row fd-tone-${row.tone}` },
              h('span', { className: 'fd-list-label' }, row.label),
              h('span', { className: 'fd-list-value' }, row.text),
              h('span', { className: 'fd-list-meta' }, row.hint),
            )),
          ),
        )
        : h('div', { className: 'fd-empty-line' }, history.fulfillment.emptyText), tailSpans[6]) : null

    /* 9) 延期原因：横向条（次数 + 平均天数） */
    const delayPanel = history ? panel(8, 'delay', '延期原因', '按记录条数排序', history.delay.hasData ? `${history.delay.total} 条记录` : '',
      history.delay.hasData
        ? h('div', { className: 'fd-list fd-scroll' }, history.delay.rows.map((row) => h('div', {
          key: row.key,
          className: 'fd-list-row fd-tone-warn',
          title: row.tasks.length ? `涉及：${row.tasks.map((task) => task.title).join('、')}` : row.label,
        },
          h('span', { className: 'fd-list-label', title: row.label }, row.label),
          h('span', { className: 'fd-list-bar' }, h('span', { className: 'fd-bar', style: { display: 'block', height: '8px' } }, h('i', { style: { width: `${Math.max(4, Math.round(row.ratio * 100))}%` } }))),
          h('span', { className: 'fd-list-value' }, `${row.count} 次`),
          h('span', { className: 'fd-list-meta' }, `平均 ${row.avgDaysText}`),
        )))
        : h('div', { className: 'fd-empty-line' }, history.delay.emptyText), tailSpans[7]) : null

    /* 10) 质量 / 周期：提前 / 准时 / 延迟 + 中位数 / P85 */
    const qualityPanel = history ? panel(9, 'quality', '质量 / 周期', '完成质量与周期分位', history.quality.samplesText,
      history.quality.hasData
        /* 这张卡是全宽的：横向排（左：三档图例；右：两个周期分位），
           否则 3 行字撑在 320px 高的卡顶上、下面一大片空。 */
        ? h('div', { className: 'fd-panel-body fd-quality' },
          h('div', { className: 'fd-legend' }, history.quality.segments.map((seg) => h('div', { key: seg.key, className: `fd-legend-row fd-tone-${seg.tone}` },
            h('span', { className: 'fd-legend-dot' }),
            h('span', { className: 'fd-legend-label' }, seg.label),
            h('span', { className: 'fd-legend-value' }, String(seg.count)),
            h('span', { className: 'fd-legend-pct' }, `${seg.pct}%`),
          ))),
          h('div', { className: 'fd-kv' },
            h('div', { className: 'fd-kv-item fd-tone-brand' },
              h('span', { className: 'fd-kv-label' }, '周期中位数'),
              h('span', { className: 'fd-kv-value' }, history.quality.cycleMedianText),
            ),
            h('div', { className: 'fd-kv-item fd-tone-idle' },
              h('span', { className: 'fd-kv-label' }, 'P85 周期'),
              h('span', { className: 'fd-kv-value' }, history.quality.cycleP85Text),
            ),
          ),
        )
        : h('div', { className: 'fd-empty-line' }, history.quality.emptyText), tailSpans[8]) : null

    /* 降级提示：一行 role="status"，永远不挡住快照口径的六个面板 */
    const historyNote = history ? null : h('section', {
      key: 'history-note',
      className: 'fd-panel',
      'data-span': 'all',
      role: 'status',
      'data-phase': histState.phase,
      'aria-live': 'polite',
    },
      h('div', { className: 'fd-panel-head' },
        h('span', { className: 'fd-panel-title' }, histState.phase === 'loading' ? '历史指标加载中…' : '历史指标不可用'),
        h('span', { className: 'fd-panel-hint' }, histState.phase === 'loading'
          ? '趋势 / 履约 / 延期原因 / 周期质量 正在取数'
          : (histState.phase === 'unsupported'
            ? '当前宿主没有 /api/insight/stats，以下只显示当前快照口径'
            : `以下只显示当前快照口径${histState.message ? `（${histState.message}）` : ''}`)),
      ),
      histState.phase === 'loading'
        ? null
        : h('div', { className: 'fd-panel-body' },
          h('button', {
            type: 'button',
            className: 'fd-item',
            style: { width: 'auto', flex: '0 0 auto' },
            onClick: () => bumpRetry((prev) => (toNum(prev) || 0) + 1),
          }, h('span', { className: 'fd-item-title' }, '重试')),
        ),
    )

    /* 诊断面板要排在 panel() 定义之后（它用 panel 渲染），所以在这里组装，不要提前。 */
    /* 卡片叫「洞察」而不是「AI 诊断」：它是这一页的结论，不是一个工具入口。 */
    /* 这张卡不挂标题：它自己就是这页的结论，再写一行「洞察」是重复。样式与其它卡片一致。 */
    const aiPanel = panel(0, 'ai', '', '', '', aiBody, 'all', 'ai')

    /* 顶部一行：有日历时「日历 + KPI」并排（日历在左上角）；旧宿主没有日历时 KPI 仍占满整行 */
    const topRow = calPanel
      ? h('div', { key: 'top', className: 'fd-top' }, calPanel, kpis)
      : kpis

    return h('div', {
      className: 'fd-page',
      'data-empty': '0',
      'data-history': history ? '1' : '0',
      'data-cols': String(cols || ''),
      ref: hostRef || undefined,
    /* AI 诊断占整页第一行：它是这一页的结论，不该排在日历/指标后面。
       放在 .fd-page 这一层即可（纵向 flex + 统一 gap），不需要额外间距规则。 */
    }, aiPanel, historyNote, topRow,
      /* KPI 带之后的面板进子网格：这一段才需要「平分剩余高度」（见 dashboardStyles 里 .fd-grid 的说明）。
         KPI 卡自己按内容定高，不再被拉到和图表卡一样高。 */
      h('div', { key: 'grid', className: 'fd-grid' },
        donut, workspaces, relations, blockers, recent, trendPanel, fulfillmentPanel, delayPanel, qualityPanel))
  }
}

export default createInsightFeature
