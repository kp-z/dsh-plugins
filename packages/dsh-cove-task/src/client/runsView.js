/**
 * 运行页的纯函数层：`buildRuns(snapshot)`。
 *
 * 零依赖、零副作用，可离线单测。输入是宿主快照的 tasks（字段见 index.js 的 overview 组装）：
 *   { id, no, title, done, workspaceKey, workspaceTitle, sessionId, running, sessionTurn,
 *     blocked, ready, started, suspended, createdAt, startedAt, completedAt, suspendedAt, runningSince,
 *     predecessors[], blockedBy[] }
 *
 * **状态判定优先级（写死在这张表里，顺序即优先级）**：
 *   suspended → 挂起        (warn)
 *   blocked   → 阻塞        (error)
 *   running   → 运行中      (success + 呼吸)
 *   started   → 等待中      (idle)
 *   done      → 已完成      (success 静态)
 *   否则      → 未开始      (idle 虚线)
 * 想改口径只动这张表，组件与测试都从这里派生。
 */

/** 顺序即优先级：前面的赢。 */
export const STATE_ORDER = ['suspended', 'blocked', 'running', 'started', 'done']

export const STATE_META = {
  suspended: { key: 'suspended', label: '挂起', tone: 'warn', breathing: false, dashed: false },
  blocked: { key: 'blocked', label: '阻塞', tone: 'error', breathing: false, dashed: false },
  running: { key: 'running', label: '运行中', tone: 'success', breathing: true, dashed: false },
  started: { key: 'started', label: '等待中', tone: 'idle', breathing: false, dashed: false },
  done: { key: 'done', label: '已完成', tone: 'success', breathing: false, dashed: false },
  idle: { key: 'idle', label: '未开始', tone: 'idle', breathing: false, dashed: true },
}

/** 气泡墙的分组顺序（运行中的排最前，未开始垫底）。
 *  **已完成的任务不上运pages**：done 在 buildRuns 入口就被过滤掉，所以这里没有 done 组。 */
export const GROUP_ORDER = ['running', 'started', 'blocked', 'idle']

/** KPI 行的五张卡（adventure 首页那种：圆球 + eyebrow + 大数值 + 迷你水位条）。 */
export const KPI_KEYS = ['running', 'started', 'blocked', 'sessions']

/** 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 2 天前（没有时间戳就回空串，不猜）。 */
export function formatAgo(ms) {
  const value = num(ms, 0)
  if (value < 0) return ''
  const sec = Math.floor(value / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return `${Math.floor(day / 30)} 个月前`
}

const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const arr = (value) => (Array.isArray(value) ? value : [])
const str = (value) => (typeof value === 'string' ? value : (value == null ? '' : String(value)))
const num = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback)
}

/** 一个任务的运行态（优先级见 STATE_ORDER）。 */
export function stateOfTask(task) {
  const t = isObj(task) ? task : {}
  /* 已完成的任务不再算阻塞（done 优先于 blocked）：否则「已经处理掉的任务」
     会因为还有一条没完成的前置，气泡一直红着 —— 用户实测报的就是这个。 */
  const isDone = t.done === true
  const flags = {
    suspended: t.suspended === true,
    blocked: !isDone && (t.blocked === true || arr(t.blockedBy).length > 0),
    running: t.running === true,
    started: t.started === true,
    done: isDone,
  }
  for (const key of STATE_ORDER) {
    if (flags[key]) return key
  }
  return 'idle'
}

/** 时长文本：1 分 20 秒 / 3 小时 12 分 / 2 天 4 小时 / — */
export function formatDuration(ms) {
  const value = num(ms, 0)
  if (value <= 0) return '—'
  const sec = Math.floor(value / 1000)
  if (sec < 60) return `${sec} 秒`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分`
  const hour = Math.floor(min / 60)
  if (hour < 24) return min % 60 ? `${hour} 小时 ${min % 60} 分` : `${hour} 小时`
  const day = Math.floor(hour / 24)
  return hour % 24 ? `${day} 天 ${hour % 24} 小时` : `${day} 天`
}

/** 本地日历日的 0 点（用 now 的时区，避免「今日」边界算错）。 */
export function startOfDay(nowMs) {
  const d = new Date(num(nowMs, Date.now()))
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 会话轮次分档：未开始 / 1-2 轮 / 3-9 轮 / 10+ 轮。 */
export function turnBucket(turn) {
  const t = Math.max(0, num(turn, 0))
  if (t <= 0) return 'none'
  if (t <= 2) return 'low'
  if (t <= 9) return 'mid'
  return 'high'
}

export const TURN_BUCKETS = [
  { key: 'none', label: '未开始', hint: '0 轮' },
  { key: 'low', label: '1-2 轮', hint: '刚起步' },
  { key: 'mid', label: '3-9 轮', hint: '在推进' },
  { key: 'high', label: '10+ 轮', hint: '长会话' },
]

/** 优先级顺序：P0 最前；没填的排最后（不猜成 P2）。 */
export const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3']

export function priorityRank(value) {
  const hit = PRIORITY_ORDER.indexOf(str(value).toUpperCase())
  return hit < 0 ? PRIORITY_ORDER.length : hit
}

/**
 * 「开工顺序」：现在能动手的任务。
 * 口径（只回答「该动哪条」）：未完成、未挂起、前置全完成、**没在跑**。
 * 排序：优先级 → 等得最久（createdAt 越早越靠前）→ 编号。
 * 不在这里看逾期（那是「快到期」卡的职责），也不看时长。
 */
export function readyQueue(tasks, now, limit = 6) {
  const at = num(now, Date.now())
  return arr(tasks)
    .filter((task) => isObj(task) && task.done !== true && task.suspended !== true)
    .filter((task) => task.ready === true && arr(task.blockedBy).length === 0)
    .filter((task) => task.running !== true)
    .map((task) => {
      const createdAt = Number(task.createdAt) || 0
      const startedAt = Number(task.startedAt) || 0
      const since = createdAt > 0 ? createdAt : startedAt
      const waitMs = since > 0 ? Math.max(0, at - since) : 0
      return {
        id: str(task.id),
        no: num(task.no, 0),
        title: str(task.title) || str(task.id),
        workspaceTitle: str(task.workspaceTitle) || '未归属项目',
        priority: str(task.priority).toUpperCase(),
        priorityRank: priorityRank(task.priority),
        sessionId: str(task.sessionId),
        waitMs,
        waitDays: Math.floor(waitMs / 86_400_000),
        waitText: waitMs > 0 ? formatDuration(waitMs) : '',
      }
    })
    .sort((a, b) => (a.priorityRank - b.priorityRank) || (b.waitMs - a.waitMs) || (a.no - b.no))
    .slice(0, Math.max(1, limit))
}

/**
 * 「快到期」：按**预期完成**分桶（只回答「什么时候必须交」）。
 * 不看依赖、不排优先级；没设预期完成的不进任何桶（单独计数，提示去飞书里填）。
 * 返回 { buckets: { overdue, today, week, later }, items, overdueCount, todayCount, weekCount, unset }
 */
export function dueBuckets(tasks, now, limit = 8) {
  const at = num(now, Date.now())
  const dayStart = startOfDay(at)
  const dayEnd = dayStart + 86_400_000
  const weekEnd = dayStart + 7 * 86_400_000
  const rows = arr(tasks)
    .filter((task) => isObj(task) && task.done !== true && task.suspended !== true)
    .map((task) => ({
      id: str(task.id),
      no: num(task.no, 0),
      title: str(task.title) || str(task.id),
      workspaceTitle: str(task.workspaceTitle) || '未归属项目',
      expectedAt: Number(task.expectedAt) || 0,
    }))
  const unsetRows = rows.filter((row) => row.expectedAt <= 0)
  const unset = unsetRows.length
  const items = rows
    .filter((row) => row.expectedAt > 0)
    .map((row) => {
      /* 逾期的判据是**已经过了那个点**，不是「不在今天之内」。
         踩过的坑：20:00 到期、现在 21:30，旧口径按 dayStart 分桶 → 落进「今天」，
         文案成了「剩 2 小时」，逾期计数始终是 0 —— 用户看到的就是「延期不生效」。 */
      const bucket = row.expectedAt <= at ? 'overdue'
        : (row.expectedAt < dayEnd ? 'today'
          : (row.expectedAt < weekEnd ? 'week' : 'later'))
      const deltaMs = row.expectedAt - at
      const lateMs = bucket === 'overdue' ? at - row.expectedAt : 0
      return {
        ...row,
        bucket,
        lateMs,
        lateDays: bucket === 'overdue' ? Math.max(1, Math.ceil(lateMs / 86_400_000)) : 0,
        dueText: formatDueText(deltaMs, bucket),
      }
    })
    .sort((a, b) => a.expectedAt - b.expectedAt)
  const buckets = { overdue: 0, today: 0, week: 0, later: 0 }
  items.forEach((row) => { buckets[row.bucket] += 1 })
  return {
    buckets,
    items: items.slice(0, Math.max(1, limit)),
    total: items.length,
    unset,
    /** 没设预期完成的任务（最多 3 条）：卡片空白处列出来，点一下就能去补，而不是只报一个数字 */
    unsetItems: unsetRows.slice(0, 3),
    /** 图表用的窗口（天）：左 -14，右 +7 */
    windowStart: dayStart - 14 * 86_400_000,
    windowEnd: weekEnd,
  }
}

/** 到期文案：逾期 3 天 / 逾期 2 小时 / 剩 3 小时 / 3 天后。 */
function formatDueText(deltaMs, bucket) {
  const abs = Math.abs(deltaMs)
  if (bucket === 'overdue') {
    /* 当天就逾期时用小时（「逾期 1 天」会显得比实际严重）。 */
    if (abs < 3_600_000) return '刚过期'
    if (abs < 86_400_000) return `逾期 ${Math.max(1, Math.round(abs / 3_600_000))} 小时`
    return `逾期 ${Math.max(1, Math.ceil(abs / 86_400_000))} 天`
  }
  if (abs < 3_600_000) return '不到 1 小时'
  if (abs < 86_400_000) return `剩 ${Math.max(1, Math.round(abs / 3_600_000))} 小时`
  return `${Math.round(abs / 86_400_000)} 天后`
}

/**
 * 「最近动态」：任务的生命周期事件（创建/开工/完成/挂起），按时间倒序。
 * 只回答「刚才发生了什么」——不是任务列表，也不按状态分组。
 *
 * 两条实机口径（2026-11-17 用真实数据量出来的）：
 *   1. **同一任务只出一行**：24 小时里 22 个有事件的任务中 8 个会「创建 + 完成」各占一行，
 *      卡片只有 5 行时一条任务吃掉两格；把更早的「创建」折叠成「建单到完成 49 分钟」。
 *   2. **开工时间认 runningSince**：宿主快照里 37 条任务的 startedAt 全是 0，
 *      只认 startedAt 的话「开工」这一类永远不会出现；runningSince 是「观察到在跑」的起点。
 *
 * 柱状图给 8 根（3 小时一桶）：原来 24 根一小时的柱子里实机 18 根是空的，整张图像数据断了。
 */
export function activityTimeline(tasks, now, limit = 12) {
  const at = num(now, Date.now())
  const raw = []
  const push = (task, kind, when) => {
    const value = Number(when) || 0
    if (value <= 0 || value > at + 60_000) return
    raw.push({ task, kind, at: value })
  }
  arr(tasks).forEach((task) => {
    if (!isObj(task)) return
    push(task, 'done', task.completedAt)
    /* runningSince 优先：它是宿主**观察到会话在跑**的时刻；startedAt 是任务自己的开工时间，
       真实数据里大量为 0（历史任务没填），只认它就会永远缺「开工」事件。 */
    push(task, 'start', num(task.runningSince, 0) || task.startedAt)
    push(task, 'suspended', task.suspendedAt)
    push(task, 'created', task.createdAt)
  })

  /* 按任务归并：取最新的一条当行，更早的「创建」只作为上下文（不单独占一行）。 */
  const byTask = new Map()
  raw.forEach((row) => {
    const id = str(row.task.id)
    const list = byTask.get(id) || []
    list.push(row)
    byTask.set(id, list)
  })
  const events = []
  byTask.forEach((rows, id) => {
    rows.sort((a, b) => b.at - a.at)
    const head = rows[0]
    const task = head.task
    const created = rows.find((row) => row.kind === 'created' && row.at < head.at) || null
    const turn = num(task.sessionTurn, 0)
    let detail = ''
    if (head.kind === 'done') {
      /* 「建单到完成」比「完成」多回答一个问题：这件事花了多久。
         没有创建时间就退到开工时间；都没有就不编（不显示时长比显示假时长诚实）。 */
      const from = created ? created.at : (num(task.startedAt, 0) || 0)
      if (from > 0 && head.at > from) detail = `${created ? '建单到完成' : '跑了'} ${formatDuration(head.at - from)}`
    } else if (head.kind === 'start') {
      detail = `已跑 ${formatDuration(Math.max(0, at - head.at))}`
    } else if (head.kind === 'suspended') {
      detail = str(task.suspensionReason)
    }
    /* 「第 N 轮」只对开工/完成有意义；挂在「创建」上会读成「创建了 2 轮」（实机见过）。 */
    if (!detail && turn > 0 && head.kind !== 'created') detail = `第 ${turn} 轮`
    events.push({
      id: `${id}:${head.kind}`,
      taskId: id,
      no: num(task.no, 0),
      title: str(task.title) || id,
      workspace: str(task.workspaceTitle),
      kind: head.kind,
      at: head.at,
      agoText: formatAgo(at - head.at),
      detail,
      spanMs: created ? head.at - created.at : 0,
    })
  })
  events.sort((a, b) => b.at - a.at)

  /* 24 小时窗口 → 8 桶 × 3 小时。桶边界与 last24h 必须完全一致（age ∈ [0, 24h)），
     否则「柱子和 ≠ 总数」，测试当场抓到过一次。 */
  const WINDOW = 24 * 3_600_000
  const BUCKET = 3 * 3_600_000
  const ageOf = (event) => at - event.at
  const inWindow = (event) => ageOf(event) >= 0 && ageOf(event) < WINDOW
  const buckets = []
  for (let i = 7; i >= 0; i -= 1) {
    buckets.push({ start: at - (i + 1) * BUCKET, count: 0, byKind: { done: 0, created: 0, start: 0, suspended: 0 } })
  }
  const counts = { done: 0, created: 0, start: 0, suspended: 0 }
  raw.forEach((event) => {
    if (!inWindow(event)) return
    counts[event.kind] = (counts[event.kind] || 0) + 1
    const bucket = buckets[7 - Math.floor(ageOf(event) / BUCKET)]
    if (!bucket) return
    bucket.count += 1
    bucket.byKind[event.kind] = (bucket.byKind[event.kind] || 0) + 1
  })
  return {
    events: events.slice(0, Math.max(1, limit)),
    buckets,
    counts,
    last24h: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
  }
}
/**
 * 主入口。返回：
 *   empty      没有任何任务
 *   totals     各状态计数 + 已绑会话数
 *   groups     气泡墙分组（GROUP_ORDER，空组不返回）
 *   bubbles    扁平气泡列表（带 state/group/时长/可用动作）
 *   overview   四张气泡式计数卡：运行中 / 等待 / 挂起 / 今日完成
 *   activity   会话活跃度四档（横向条）
 *   longest    运行时长 Top5（按 startedAt 倒序取最长）
 *   alerts     「需要人看一眼」：挂起中 / 被阻塞但前置其实都完成了
 */
export function buildRuns(snapshot) {
  const snap = isObj(snapshot) ? snapshot : {}
  /* 硬口径（用户明确要求）：已完成的任务在运行页**完全不出现** —— 入口就丢掉，
     所以气泡墙 / KPI 分母 / 执行历史 / 时长 Top / 告警里都不可能有 done。
     下面所有 counts/分母都基于这份 unfinished。 */
  const allTasks = arr(snap.tasks).filter((task) => isObj(task) && str(task.id))
  /* 运行页只呈现「还在推进」的任务：
       - done      = 做完了；
       - suspended = 暂时不做（挂起）。
     两者都不上面（用户口径：先是「完成的不要显示」，再是「挂起的也不显示」），只保留计数用于自证。 */
  const tasks = allTasks.filter((task) => task.done !== true && task.suspended !== true)
  const now = num(snap.now, Date.now())
  const nowMs = now
  const titleOf = new Map(tasks.map((task) => [str(task.id), str(task.title) || str(task.id)]))

  /* 「刚做完」的任务：**只给气泡墙用**，不参与 KPI 分母 / 分组 / 历史 / 时长。
     为什么需要它：用户口径是「运行中和运行完都可以显示（状态）」，但已完成的任务按另一个口径
     不上运行页 —— 两者只有靠「短暂停留」才能同时成立：完成后的 RECENT_DONE_MS 内留一个绿泡
     （带「已完成」状态对话气泡），然后自己消失。默认 0 = 完全不上墙（保持旧行为）。 */
  const recentDoneMs = Math.max(0, num(snap.recentDoneMs, 0))
  const recentDone = recentDoneMs > 0
    ? allTasks.filter((task) => task.done === true && num(task.completedAt, 0) > 0
      && nowMs - num(task.completedAt, 0) <= recentDoneMs)
    : []

  /**
   * 任务 → 气泡行（未完成任务与「刚做完」的任务共用同一套字段）。
   *
   * `stateOverride` 是给「刚做完」用的：`stateOfTask` 的口径是
   * suspended → blocked → running → started → done，也就是**运行中优先于已完成** ——
   * 这在「完成的任务本来就不上页」时无所谓，但刚做完的任务常常还带着 running 标记
   * （会话还没收到停止事件），于是会出现「蓝泡（运行中）+ 状态泡写『已完成』」的自相矛盾。
   * 刚做完的行显式钉成 done。
   */
  const toBubble = (task, stateOverride) => {
    const state = stateOverride || stateOfTask(task)
    const meta = STATE_META[state] || STATE_META.idle
    const sessionId = str(task.sessionId)
    const startedAt = num(task.startedAt, 0)
    /* 运行起点只有一个，但来源分两种（都在数据面里，不猜）：
       - runningSince：宿主**观察到会话在跑**的最早时刻（本次连续运行的起点，重启后重算）
       - startedAt：任务自己的「开工」时间（历史任务大多没有）
       画面上要让人看出用的是哪一个，所以带上 source 与文案。 */
    const runningSince = num(task.runningSince, 0)
    const hasStart = state !== 'done' && (runningSince > 0 || startedAt > 0)
    const startFrom = runningSince > 0 ? runningSince : startedAt
    const startSource = runningSince > 0 ? 'observed' : (startedAt > 0 ? 'task' : 'none')
    const elapsed = hasStart ? Math.max(0, now - startFrom) : 0
    return {
      id: str(task.id),
      no: num(task.no, 0),
      title: str(task.title) || str(task.id),
      workspaceKey: str(task.workspaceKey),
      workspaceTitle: str(task.workspaceTitle) || '未归属项目',
      state,
      label: meta.label,
      tone: meta.tone,
      breathing: meta.breathing === true,
      dashed: meta.dashed === true,
      sessionId,
      canOpenSession: Boolean(sessionId),
      sessionTurn: num(task.sessionTurn, 0),
      /* 运行结束但还没看过：只用来画右上角小绿点；运行中的泡不显示（用户要看的是结束后）。 */
      unread: state !== 'running' && task.sessionUnread === true,
      startedAt,
      runningSince,
      startFrom,
      startSource,
      startedText: startSource === 'observed' ? '观察到运行' : (startSource === 'task' ? '开工时间' : '未记录开始时间'),
      completedAt: num(task.completedAt, 0),
      suspendedAt: num(task.suspendedAt, 0),
      elapsed,
      elapsedText: formatDuration(elapsed),
      blockedBy: arr(task.blockedBy).map((item) => {
        const ref = isObj(item) ? item : {}
        const id = str(ref.id)
        return { id, title: str(ref.title) || titleOf.get(id) || id, done: ref.done === true }
      }),
    }
  }
  /* 注意：必须包一层箭头函数 —— 直接把 toBubble 传给 map，**index 会被当成 stateOverride**
     （map 的第二个参数是下标），于是除第一条外所有气泡的 state 都变成 1 → 退化成 idle。
     这个坑当场被 runsView 的分组/KPI 断言抓住。 */
  const bubbles = tasks.map((task) => toBubble(task))
  /* 只给气泡墙用：完成不久的绿泡（KPI/分组/历史/时长都用不到它们） */
  const justDone = recentDone.map((task) => toBubble(task, 'done'))

  /**
   * 项目维度（旭日图的数据）：**按自定义目录合并项目** —— 与总览页/关系图同一套规则
   * （`overview/model.js` 的 `groupByCustom`）：用户拖出来的一个目录（比如「QV」）算**一个项目**，
   * 它下面可以有多个 workspace；没进任何目录的各自按 workspace 算，并落在「未分组」桶里。
   * 每个项目再按状态拆一层（在跑 / 等待 / 阻塞），供旭日图的外圈用。
   */
  const projectOf = (() => {
    const custom = arr(snap.groups)
      .filter((group) => isObj(group) && str(group.id) && str(group.name))
      .map((group) => ({ id: str(group.id), name: str(group.name), members: arr(group.members).map((key) => str(key)) }))
    const byMember = new Map()
    custom.forEach((group) => group.members.forEach((key) => { if (key && !byMember.has(key)) byMember.set(key, group) }))
    const titleByKey = new Map()
    arr(snap.workspaces).forEach((ws) => {
      if (!isObj(ws)) return
      const key = str(ws.key)
      if (key) titleByKey.set(key, str(ws.label) || str(ws.title) || key)
    })
    return (row) => {
      const workspaceKey = str(row.workspaceKey)
      const group = workspaceKey ? byMember.get(workspaceKey) : null
      if (group) return { key: `group:${group.id}`, label: group.name, merged: group.members.length }
      const label = str(row.workspaceTitle) || titleByKey.get(workspaceKey) || '未归属项目'
      return { key: workspaceKey || `name:${label}`, label, merged: 1 }
    }
  })()

  const projectMap = new Map()
  bubbles.forEach((row) => {
    const project = projectOf(row)
    const cur = projectMap.get(project.key) || { key: project.key, label: project.label, merged: project.merged, count: 0, states: { running: 0, started: 0, blocked: 0, suspended: 0, idle: 0 } }
    cur.count += 1
    cur.states[row.state] = (cur.states[row.state] || 0) + 1
    cur.merged = Math.max(cur.merged, project.merged)
    projectMap.set(project.key, cur)
  })
  /* 计时覆盖（「计时覆盖」卡要用）：有没有开工时间的条数。
     用户口径里的这张卡是**数据质量监控** —— 没记开始时间的任务，时长类指标对它们不成立。
     口径与气泡行一致：startSource === 'none' 就是没记录。 */
  const timedCount = bubbles.filter((bubble) => bubble.startFrom > 0).length
  const untimedCount = bubbles.length - timedCount

  /** 旭日图的项目环：条数降序，最多的排在上面 */
  const projects = [...projectMap.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  const counts = { running: 0, started: 0, blocked: 0, suspended: 0, idle: 0 }
  bubbles.forEach((bubble) => { counts[bubble.state] = (counts[bubble.state] || 0) + 1 })
  const boundSessions = bubbles.filter((bubble) => bubble.sessionId).length

  /* 分组：空组不出现（避免一排空标题） */
  const groups = GROUP_ORDER
    .map((key) => {
      const meta = STATE_META[key]
      const items = bubbles.filter((bubble) => bubble.state === key)
      return {
        key,
        label: meta.label,
        tone: meta.tone,
        breathing: meta.breathing === true,
        count: items.length,
        bubbles: items,
      }
    })
    .filter((group) => group.count > 0)

  /* KPI 行：五张卡，分母一律是「未完成任务数」（done 已在入口被过滤） */
  const unfinished = tasks.length
  const kpiDefs = [
    { key: 'running', label: '运行中', eyebrow: 'RUNNING', value: counts.running, tone: 'success', hint: '会话正在跑', breathing: true },
    { key: 'started', label: '等待中', eyebrow: 'WAITING', value: counts.started, tone: 'idle', hint: '已开始、没在跑' },
    { key: 'blocked', label: '阻塞', eyebrow: 'BLOCKED', value: counts.blocked, tone: 'error', hint: '在等前置任务' },
    { key: 'sessions', label: '已绑会话', eyebrow: 'SESSIONS', value: 0, tone: 'brand', hint: '能一句话跳过去' },
  ]
  const overview = kpiDefs.map((def) => {
    const value = def.key === 'sessions' ? bubbles.filter((bubble) => bubble.sessionId).length : def.value
    const ratio = unfinished > 0 ? Math.max(0, Math.min(1, value / unfinished)) : 0
    return { ...def, value, total: unfinished, ratio, pct: Math.round(ratio * 100) }
  })

  /* 会话活跃度：按 sessionTurn 分档，只统计已绑会话的任务 */
  const bound = bubbles.filter((bubble) => bubble.sessionId)
  const activity = TURN_BUCKETS.map((bucket) => {
    const items = bound.filter((bubble) => turnBucket(bubble.sessionTurn) === bucket.key)
    return {
      key: bucket.key,
      label: bucket.label,
      hint: bucket.hint,
      count: items.length,
      ratio: bound.length > 0 ? items.length / bound.length : 0,
      running: items.filter((item) => item.state === 'running').length,
    }
  })

  /* 运行时长 Top5：now - 起点，越早开始越靠前。
     起点优先取**观察到运行**的时刻（runningSince），没有才退回任务开工时间（startedAt）；
     两者都没有的排最后并标「未记录开始时间」——不猜、不拿轮次冒充时长。 */
  const live = bubbles.filter((bubble) => bubble.state !== 'done')
  const timed = live
    .filter((bubble) => bubble.startFrom > 0)
    .map((bubble) => ({ ...bubble, elapsed: Math.max(0, now - bubble.startFrom), elapsedText: formatDuration(Math.max(0, now - bubble.startFrom)), untimed: false }))
    .sort((a, b) => (b.elapsed - a.elapsed) || (a.no - b.no))
  const untimedRows = live
    .filter((bubble) => bubble.startFrom <= 0)
    .sort((a, b) => (a.no - b.no))
    .map((bubble) => ({ ...bubble, elapsed: 0, elapsedText: '未记录开始时间', untimed: true }))
  const longest = timed.concat(untimedRows).slice(0, 5)
  const untimed = untimedRows.length

  /* 需要人看一眼：被阻塞但前置其实都完成了（说明关系数据可能过期）。
     挂起任务已经不在这页，所以告警里不再列「挂起中」那一类。 */
  const staleBlocked = bubbles
    .filter((bubble) => bubble.state === 'blocked' && bubble.blockedBy.length > 0 && bubble.blockedBy.every((ref) => ref.done === true))
    .map((bubble) => ({
      id: bubble.id,
      no: bubble.no,
      title: bubble.title,
      workspaceTitle: bubble.workspaceTitle,
      reason: 'stale-block',
      reasonText: '前置都已完成',
      detail: `等 ${bubble.blockedBy.map((ref) => ref.title).join('、')}`,
    }))
  const alerts = staleBlocked.slice(0, 8)

  /* 执行历史风格列表：未完成任务，按「最近活跃 → 编号」倒序，最近的在上面 */
  const lastActiveOf = (bubble) => Math.max(bubble.startedAt, bubble.runningSince || 0, bubble.suspendedAt, bubble.completedAt)
  const history = bubbles
    .map((bubble) => {
      const lastActiveAt = lastActiveOf(bubble)
      return {
        id: bubble.id,
        no: bubble.no,
        noText: bubble.no > 0 ? `#${bubble.no}` : '未编号',
        title: bubble.title,
        state: bubble.state,
        label: bubble.label,
        tone: bubble.tone,
        breathing: bubble.breathing,
        dashed: bubble.dashed,
        workspaceTitle: bubble.workspaceTitle,
        sessionId: bubble.sessionId,
        canOpenSession: bubble.canOpenSession,
        lastActiveAt,
        agoText: lastActiveAt > 0 ? formatAgo(now - lastActiveAt) : '时间未记录',
        /* 「运行历史」要的列：这一轮跑了多久、跑到第几轮、起点是什么口径 */
        sessionTurn: bubble.sessionTurn,
        elapsed: bubble.elapsed,
        elapsedText: bubble.elapsedText,
        startFrom: bubble.startFrom,
        startedText: bubble.startedText,
        /* 时长条的比例（0..1）：卡里用它画一条微条形，避免整页又变成纯列表 */
        elapsedRatio: 0,
      }
    })
    .sort((a, b) => (b.lastActiveAt - a.lastActiveAt) || (b.no - a.no) || a.id.localeCompare(b.id))
  const maxHistoryElapsed = history.reduce((max, row) => Math.max(max, row.elapsed), 0)
  history.forEach((row) => {
    row.elapsedRatio = maxHistoryElapsed > 0 ? Math.max(0, Math.min(1, row.elapsed / maxHistoryElapsed)) : 0
  })

  return {
    empty: tasks.length === 0,
    now,
    total: tasks.length,
    /** 入口被过滤掉的已完成任务数（自证「done 不上页面」，也方便测试断言） */
    skippedDone: allTasks.filter((task) => task.done === true).length,
    /** 入口被过滤掉的挂起任务数（挂起 = 暂时不做，同样不上运行页） */
    skippedSuspended: allTasks.filter((task) => task.done !== true && task.suspended === true).length,
    /** 完成不久、仍留在气泡墙上的任务（只影响气泡墙；KPI/分组/历史/时长都不含它们） */
    justDone,
    /** 旭日图用：按自定义目录合并后的项目（含状态拆分） */
    projects,
    /** 计时覆盖：有开始时间 / 未记录的条数（「计时覆盖」卡用） */
    timedCount,
    untimedCount,
    history,
    counts,
    boundSessions,
    groups,
    bubbles,
    overview,
    activity,
    longest,
    longestUntimed: untimed,
    alerts,
    /** 「开工顺序」：能动手的任务（依赖就绪 + 优先级排序） */
    ready: readyQueue(tasks, now),
    /** 「快到期」：按预期完成分桶（含图表窗口） */
    due: dueBuckets(tasks, now, 60), /* 日历要看到窗口内每一条，不再只取列表的 8 行 */
    /** 「最近动态」：生命周期事件时间线 + 24h · 8 桶（3h）计数（含已完成/挂起，它们也是事件） */
    timeline: activityTimeline(allTasks, now),
  }
}

export default buildRuns
