/**
 * 长期行为档案（诊断洞察 v2 的「事实层」）。
 *
 * 流程号：
 *   ① 采样：窗口 84 天、本地日切界、样本天数与快照覆盖度；n 不足的信号进 gaps
 *   ② 信号 1 · 周节奏：近 8 周完成落在周几
 *   ③ 信号 2 · 进出台账：近 8 周新增（firstSeenAt）vs 完成（completedAt）
 *   ④ 信号 3 · 在跑 WIP：metricsByDay 的每日 wip 分位
 *   ⑤ 信号 4 · 进列表→收口：completedAt - firstSeenAt 分位（startedAt 不可靠，见 PLAN §12.5）
 *
 * 约束（别破坏）：
 *   - 纯函数、零 import、不读 Date.now / process.env / 文件；
 *   - 同一输入两次调用输出完全一致；
 *   - 只用传入的 now；时间按本机时区切日、周一为一周起点；
 *   - n < 5 的信号不写进 text（模型看不到就不会编），只进 gaps。
 */

const DAY_MS = 86_400_000
const MIN_N = 5
export const DEFAULT_WINDOW_DAYS = 84
const FLOW_WEEKS = 8
const DOW_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/* 只认有限数字且晚于 2000-01-01：挡掉 true / '123' / 1970 这类伪时间戳 */
const MIN_TS = Date.UTC(2000, 0, 1)
const asTs = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return value >= MIN_TS ? value : 0
}

/* nearest-rank：rank = ceil(p*n)，取第 rank 名（index=rank-1） */
const pick = (list, p) => {
  if (!list.length) return null
  const rank = Math.ceil(p * list.length)
  return list[Math.min(list.length - 1, Math.max(0, rank - 1))]
}
const round1 = (value) => Math.round(value * 10) / 10

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/* 按日历加天：不用毫秒加减，避免夏令时地区周界漂 1 小时 */
function addDays(ts, days) {
  const d = new Date(ts)
  d.setDate(d.getDate() + days)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/* 周一为一周起点（getDay: 0=周日） */
function startOfWeek(ts) {
  const d = new Date(startOfDay(ts))
  const offset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - offset)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/* 一条任务的全部活动时刻：切换信号按事件归周，不按「最后一次」单点归周 */
function activityStamps(task) {
  return [task.firstSeenAt, task.startedAt, task.lastPushAt, task.localUpdatedAt, task.completedAt]
    .map(asTs)
    .filter(Boolean)
}

/* 项目名：只认已归属的项目；未归属返回空串，不参与「碰了几个项目」的计数 */
function projectOf(task) {
  const name = task.workspaceTitle == null ? task.workspaceName : task.workspaceTitle
  return String(name == null ? '' : name).trim()
}

/* "YYYY-MM-DD"（本地日）→ 本地 0 点 */
function dayKeyStart(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  if (!match) return 0
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
}

function keepTasks(tasks, ignoreWords) {
  const words = (Array.isArray(ignoreWords) ? ignoreWords : [])
    .map((word) => String(word == null ? '' : word).toLowerCase())
    .filter(Boolean)
  const seen = new Set()
  const kept = []
  let discarded = 0
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || typeof task !== 'object') continue
    const id = String(task.id || '')
    if (id) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    if (words.length) {
      const hay = (String(task.title == null ? '' : task.title) + ' '
        + String(task.workspaceTitle == null ? (task.workspaceName == null ? '' : task.workspaceName) : task.workspaceTitle)).toLowerCase()
      if (words.some((word) => hay.includes(word))) continue
    }
    /* 完成早于首次观察 = 远端完成回声（或时钟错乱）：所有信号一致丢弃 */
    const done = asTs(task.completedAt)
    const first = asTs(task.firstSeenAt)
    if (done && first && done < first) {
      discarded += 1
      continue
    }
    kept.push(task)
  }
  return { tasks: kept, discarded }
}

export function buildBehaviorProfile(options = {}) {
  const now = asTs(options.now)
  const requestedWindow = Number(options.windowDays)
  const windowDays = Number.isFinite(requestedWindow) && requestedWindow > 0
    ? Math.min(365, Math.round(requestedWindow))
    : DEFAULT_WINDOW_DAYS
  const kept = keepTasks(options.tasks, options.ignoreWords)
  const tasks = kept.tasks
  const discarded = { completedBeforeFirstSeen: kept.discarded }
  const metricsByDay = options.metricsByDay && typeof options.metricsByDay === 'object' ? options.metricsByDay : {}
  const empty = {
    windowDays,
    windowStart: now ? startOfDay(now) - (windowDays - 1) * DAY_MS : 0,
    sampleDays: 0,
    coverage: 0,
    discarded: { completedBeforeFirstSeen: 0 },
    signals: {
      weekday: { n: 0, counts: [] },
      flow: { n: 0, weeks: [] },
      wip: { n: 0, p50: null, p85: null },
      lead: { n: 0, p50: null, p85: null },
      promise: { n: 0, early: 0, onTime: 0, late: 0, doneWithoutEta: 0, doneTotal: 0 },
      deadline: { n: 0, p50: null, p85: null, withinDay: 0, share: null },
      switching: { n: 0, p50: null, max: null },
    },
    baseline: { items: [], recent: {}, prior: {} },
    text: '',
    gaps: ['weekday', 'flow', 'wip', 'lead', 'promise', 'deadline', 'switching', 'baseline'],
  }
  if (!now) return empty

  /* ① 采样：窗口、样本天数、快照覆盖度 */
  const windowStart = addDays(startOfDay(now), -(windowDays - 1))
  const metricsStamps = []
  for (const key of Object.keys(metricsByDay)) {
    const ts = dayKeyStart(key)
    if (ts >= windowStart && ts <= now) metricsStamps.push(ts)
  }
  let earliest = 0
  const noteEarliest = (ts) => {
    if (ts && (!earliest || ts < earliest)) earliest = ts
  }
  for (const task of tasks) {
    noteEarliest(asTs(task.firstSeenAt))
    noteEarliest(asTs(task.completedAt))
  }
  for (const ts of metricsStamps) noteEarliest(ts)
  /* 未来时间戳（时钟错乱/数据穿越）不算样本 */
  const sampleDays = earliest && earliest <= now
    ? Math.max(1, Math.min(windowDays, Math.floor((startOfDay(now) - startOfDay(earliest)) / DAY_MS) + 1))
    : 0
  const coverage = sampleDays ? Math.max(0, Math.min(1, Math.round((metricsStamps.length / sampleDays) * 100) / 100)) : 0

  /* ③ 进出台账：最近 8 个**完整**自然周（不含本周，避免「周初必掉」），周一起 */
  const thisWeek = startOfWeek(now)
  const weeks = []
  for (let i = FLOW_WEEKS - 1; i >= 0; i -= 1) {
    const weekStart = addDays(thisWeek, -7 * (i + 1))
    const weekEnd = addDays(weekStart, 7)
    const created = tasks.filter((task) => {
      const ts = asTs(task.firstSeenAt)
      return ts >= weekStart && ts < weekEnd
    }).length
    const done = tasks.filter((task) => {
      const ts = asTs(task.completedAt)
      return ts >= weekStart && ts < weekEnd
    }).length
    weeks.push({ weekStart, created, done, net: created - done })
  }
  const flowStart = weeks[0].weekStart
  /* n 用去重后的「有事件的任务数」，不用 created+done 事件数（3 条任务不该算 6 个样本） */
  const flowTasks = new Set()
  for (const task of tasks) {
    const created = asTs(task.firstSeenAt)
    const done = asTs(task.completedAt)
    if (created && created >= flowStart && created < thisWeek) flowTasks.add(task)
    if (done && done >= flowStart && done < thisWeek) flowTasks.add(task)
  }
  const flow = { n: flowTasks.size, weeks }

  /* ② 周节奏：与进出台账同一个窗（8 个完整周），两个信号不再各说各的时间段 */
  const doneInFlow = tasks
    .map((task) => asTs(task.completedAt))
    .filter((ts) => ts >= flowStart && ts < thisWeek)
  const counts = [0, 0, 0, 0, 0, 0, 0]
  for (const ts of doneInFlow) counts[new Date(ts).getDay()] += 1
  const weekdayRows = counts
    .map((count, dow) => ({ dow, label: DOW_LABELS[dow], count }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.dow - b.dow)
  const weekday = { n: doneInFlow.length, counts: weekdayRows }

  /* ④ 在跑 WIP：只认有快照的天 */
  const wipValues = []
  for (const key of Object.keys(metricsByDay)) {
    const ts = dayKeyStart(key)
    if (!ts || ts < windowStart || ts > now) continue
    const record = metricsByDay[key]
    if (!record || typeof record !== 'object') continue
    const wip = Number(record.wip)
    if (Number.isFinite(wip) && wip >= 0) wipValues.push(wip)
  }
  wipValues.sort((a, b) => a - b)
  const wip = { n: wipValues.length, p50: pick(wipValues, 0.5), p85: pick(wipValues, 0.85) }

  /* ⑤ 进列表→收口：只统计窗口内完成、且两端时间都可信的样本 */
  const leadSamples = []
  for (const task of tasks) {
    const done = asTs(task.completedAt)
    const first = asTs(task.firstSeenAt)
    if (!done || !first) continue
    if (done < windowStart || done > now) continue
    leadSamples.push({ done, days: (done - first) / DAY_MS })
  }
  const leadValues = leadSamples.map((row) => row.days).sort((a, b) => a - b)
  const lead = {
    n: leadValues.length,
    p50: leadValues.length ? round1(pick(leadValues, 0.5)) : null,
    p85: leadValues.length ? round1(pick(leadValues, 0.85)) : null,
  }

  /* ⑥ 承诺兑现：窗口内完成、且同时有预期与完成时间的样本（1 小时内算准时） */
  const ON_TIME_MS = 3_600_000
  const doneInWindowTasks = tasks.filter((task) => {
    const ts = asTs(task.completedAt)
    return ts >= windowStart && ts <= now
  })
  const promiseSamples = []
  for (const task of doneInWindowTasks) {
    const done = asTs(task.completedAt)
    const eta = asTs(task.expectedAt)
    if (!done || !eta) continue
    promiseSamples.push({ done, eta, aheadDays: (eta - done) / DAY_MS })
  }
  const early = promiseSamples.filter((row) => row.eta - row.done > ON_TIME_MS).length
  const late = promiseSamples.filter((row) => row.done - row.eta > ON_TIME_MS).length
  const promise = {
    n: promiseSamples.length,
    early,
    onTime: promiseSamples.length - early - late,
    late,
    doneWithoutEta: doneInWindowTasks.length - promiseSamples.length,
    doneTotal: doneInWindowTasks.length,
  }

  /* ⑦ deadline 挤压：相对截止提前/逾期多少天 + 截止前 24h 内完成占比 */
  const aheadValues = promiseSamples.map((row) => row.aheadDays).sort((a, b) => a - b)
  const withinDay = promiseSamples.filter((row) => row.aheadDays >= 0 && row.aheadDays < 1).length
  const deadline = {
    n: promiseSamples.length,
    p50: aheadValues.length ? round1(pick(aheadValues, 0.5)) : null,
    p85: aheadValues.length ? round1(pick(aheadValues, 0.85)) : null,
    withinDay,
    share: promiseSamples.length ? Math.round((withinDay / promiseSamples.length) * 100) : null,
  }

  /* ⑧ 跨项目切换：每个自然周碰过几个项目（只算有活动的周） */
  const weekRows = weeks.map((week) => {
    const projects = new Set()
    const weekEnd = addDays(week.weekStart, 7)
    for (const task of tasks) {
      const project = projectOf(task)
      if (!project) continue
      /* 按事件归周：一条任务跨两周各记一次「碰过」，不是只算最后一次（复审 #4） */
      for (const ts of activityStamps(task)) {
        if (ts >= week.weekStart && ts < weekEnd) {
          projects.add(project)
          break
        }
      }
    }
    return { weekStart: week.weekStart, projects: projects.size }
  })
  const activeWeeks = weekRows.filter((row) => row.projects > 0)
  const switchValues = activeWeeks.map((row) => row.projects).sort((a, b) => a - b)
  const switching = {
    n: activeWeeks.length,
    p50: switchValues.length ? pick(switchValues, 0.5) : null,
    max: switchValues.length ? switchValues[switchValues.length - 1] : null,
  }

  /* ⑨ 基线：近 4 周 vs 前 4 周；两侧样本都够才比（缺的项不编） */
  const rangeOf = (list) => (list.length
    ? { from: list[0].weekStart, to: addDays(list[list.length - 1].weekStart, 7) }
    : null)
  const recentRange = rangeOf(weeks.slice(-4))
  const priorRange = rangeOf(weeks.slice(-8, -4))
  const notLateRate = (range) => {
    if (!range) return null
    const rows = promiseSamples.filter((row) => row.done >= range.from && row.done < range.to)
    if (rows.length < MIN_N) return null
    const notLate = rows.filter((row) => row.done - row.eta <= ON_TIME_MS).length
    return { n: rows.length, pct: Math.round((notLate / rows.length) * 100) }
  }
  const leadMedian = (range) => {
    if (!range) return null
    const values = leadSamples
      .filter((row) => row.done >= range.from && row.done < range.to)
      .map((row) => row.days)
      .sort((a, b) => a - b)
    return values.length >= MIN_N ? round1(pick(values, 0.5)) : null
  }
  const doneOf = (list) => list.reduce((sum, week) => sum + week.done, 0)
  const recentDone = doneOf(weeks.slice(-4))
  const priorDone = doneOf(weeks.slice(-8, -4))
  const recentRate = notLateRate(recentRange)
  const priorRate = notLateRate(priorRange)
  const recentLead = leadMedian(recentRange)
  const priorLead = leadMedian(priorRange)
  const trendItems = []
  /* 两侧都要有像样的完成量才比：0→72 这种「装上之前没数据」不是趋势 */
  if (recentDone >= MIN_N && priorDone >= MIN_N) trendItems.push('完成 ' + priorDone + '→' + recentDone)
  if (recentRate && priorRate) trendItems.push('不延期率 ' + priorRate.pct + '%→' + recentRate.pct + '%')
  if (recentLead !== null && priorLead !== null) trendItems.push('收口中位 ' + priorLead + '→' + recentLead + ' 天')
  /* 切换不做 4 周对 4 周的基线：两侧各 4 个周点，样本不足，且会被迫绕过 MIN_N（复审 #9） */
  const baseline = {
    items: trendItems,
    recent: { done: recentDone, notLate: recentRate, leadP50: recentLead },
    prior: { done: priorDone, notLate: priorRate, leadP50: priorLead },
  }

  /* 文本：只写过了样本门槛的信号，order 固定 */
  const aheadText = (days) => {
    if (days === null) return '—'
    return days >= 0 ? '提前 ' + round1(days) + ' 天' : '逾期 ' + round1(-days) + ' 天'
  }
  const lines = []
  const gaps = []
  if (weekday.n >= MIN_N) {
    lines.push('周节奏（8 周，n=' + weekday.n + '）：' + weekday.counts.map((row) => row.label + ' ' + row.count).join(' / '))
  } else gaps.push('weekday')
  if (flow.n >= MIN_N) {
    lines.push('进出台账（8 周）：新增 ' + weeks.map((week) => week.created).join('/')
      + '；完成 ' + weeks.map((week) => week.done).join('/')
      + '；净积压 ' + weeks.map((week) => (week.net > 0 ? '+' + week.net : String(week.net))).join('/'))
  } else gaps.push('flow')
  if (wip.n >= MIN_N) {
    lines.push('在跑（n=' + wip.n + ' 天）：中位 ' + wip.p50 + '，85 分位 ' + wip.p85)
  } else gaps.push('wip')
  if (lead.n >= MIN_N) {
    lines.push('进列表→收口（n=' + lead.n + '）：中位 ' + lead.p50 + ' 天，85 分位 ' + lead.p85 + ' 天')
  } else gaps.push('lead')
  if (promise.n >= MIN_N) {
    lines.push('预期兑现（n=' + promise.n + '）：提前 ' + promise.early + ' / 准时 ' + promise.onTime
      + ' / 延期 ' + promise.late
      + '；完成但没设预期 ' + promise.doneWithoutEta + '/' + promise.doneTotal)
  } else gaps.push('promise')
  if (deadline.n >= MIN_N) {
    lines.push('deadline 挤压（n=' + deadline.n + '）：中位' + aheadText(deadline.p50)
      + '，85 分位' + aheadText(deadline.p85)
      + '；截止前 24h 内完成 ' + deadline.share + '%')
  } else gaps.push('deadline')
  if (switching.n >= MIN_N) {
    lines.push('切换（n=' + switching.n + ' 周）：每周中位 ' + switching.p50
      + ' 个项目，最多 ' + switching.max + ' 个')
  } else gaps.push('switching')
  if (baseline.items.length >= 2) {
    lines.push('基线（近 4 周 vs 前 4 周）：' + baseline.items.join('；'))
  } else gaps.push('baseline')

  return {
    windowDays,
    windowStart,
    sampleDays,
    coverage,
    discarded,
    signals: { weekday, flow, wip, lead, promise, deadline, switching },
    baseline,
    text: lines.join('\n'),
    gaps,
  }
}

export default buildBehaviorProfile
