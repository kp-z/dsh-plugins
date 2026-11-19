/**
 * OPP 视图模型 —— **不新增持久化数据模型**，只把现有任务/项目投影成
 * OpenAdventure OPP 的三层：Objective（工作区）→ Key Result（飞书任务清单）→ Task。
 *
 * 这是纯函数：不碰 DOM、不 fetch、不写 store；GraphFlow 只负责渲染。
 * 语义映射（当前数据源的边界）：
 *   workspaceTitle → Objective
 *   listName       → Key Result
 *   任务状态/日期/进度 → Plan / Progress
 */

const DAY = 24 * 60 * 60 * 1000

const asText = (value) => (value == null ? '' : String(value).trim())

export function parseOppDate(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null
    return value < 1e12 ? value * 1000 : value
  }
  const text = String(value).trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return parseOppDate(Number(text))
  const normalized = text.includes('T') ? text : text.replace(' ', 'T')
  const withSeconds = /T\d{2}:\d{2}$/.test(normalized) ? normalized + ':00' : normalized
  const time = new Date(withSeconds).getTime()
  return Number.isFinite(time) ? time : null
}

export function oppStatus(node, task) {
  if ((node && node.cancelled === true) || (task && task.cancelled === true)) return 'cancelled'
  if (node && node.done === true) return 'done'
  if (task && task.done === true) return 'done'
  if ((node && node.state === 'suspended') || (task && task.suspended === true)) return 'suspended'
  if ((node && node.state === 'blocked') || (task && task.blocked === true)) return 'blocked'
  if (task && task.running === true) return 'in-progress'
  return 'todo'
}

const statusRank = { blocked: 0, 'in-progress': 1, todo: 2, suspended: 3, done: 4 }
const priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3 }

const progressOf = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 0)

const statusOfGroup = (tasks) => {
  if (!tasks.length) return 'not-started'
  if (tasks.every((task) => task.status === 'done')) return 'completed'
  if (tasks.some((task) => task.status === 'blocked')) return 'at-risk'
  if (tasks.some((task) => task.status === 'in-progress')) return 'in-progress'
  return 'not-started'
}

const dueOf = (tasks) => {
  const times = tasks.map((task) => task.end).filter((time) => Number.isFinite(time) && time > 0)
  return times.length ? Math.max(...times) : null
}

/**
 * @param {Array} nodes graph.nodes（可含 ghost，会自动跳过）
 * @param {Object} taskById 任务 id → 完整飞书任务
 * @returns {{objectives: Array, tasks: Array, stats: Object}}
 */
export function buildOpp(nodes, taskById) {
  const map = taskById && typeof taskById === 'object' ? taskById : {}
  const tasks = (Array.isArray(nodes) ? nodes : [])
    .filter((node) => node && node.ghost !== true)
    .map((node) => {
      const task = map[node.id] || {}
      const status = oppStatus(node, task)
      const start = parseOppDate(task.start)
        || parseOppDate(task.startedAt)
        || parseOppDate(task.createdAt)
        || null
      const end = parseOppDate(task.due)
        || parseOppDate(task.expectedAt)
        || parseOppDate(task.completedAt)
        || (start ? start + DAY : null)
      return {
        id: String(node.id),
        title: node.fullTitle || task.title || node.title || node.id,
        no: node.no || task.no || 0,
        priority: node.priority || task.priority || '',
        status,
        workspace: task.workspaceTitle || node.workspaceTitle || '未分组',
        list: task.listName || '默认清单',
        objective: asText(task.objective || node.objective) || asText(task.workspaceTitle || node.workspaceTitle) || '未归入 Objective',
        keyResult: asText(task.keyResult || node.keyResult) || asText(task.listName) || '未归入 KR',
        /* 真实字段（不做任何兜底）：Plan 只认这两个，不拿工作区/清单名冒充 O/KR。 */
        objectiveRaw: asText(task.objective || node.objective),
        keyResultRaw: asText(task.keyResult || node.keyResult),
        start,
        end,
        due: parseOppDate(task.due) || parseOppDate(task.expectedAt),
        sessionId: task.sessionId || '',
        node,
        task,
      }
    })
    .sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) || (a.no || 0) - (b.no || 0))

  const objectivesMap = new Map()
  for (const task of tasks) {
    let obj = objectivesMap.get(task.objective)
    if (!obj) {
      obj = { id: task.objective, title: task.objective, tasks: [], krsMap: new Map() }
      objectivesMap.set(task.objective, obj)
    }
    obj.tasks.push(task)
    let kr = obj.krsMap.get(task.keyResult)
    if (!kr) {
      kr = { id: task.objective + '\u0000' + task.keyResult, title: task.keyResult, objectiveId: task.objective, tasks: [] }
      obj.krsMap.set(task.keyResult, kr)
    }
    kr.tasks.push(task)
  }

  const objectives = Array.from(objectivesMap.values()).map((obj) => {
    const krs = Array.from(obj.krsMap.values()).map((kr) => {
      const done = kr.tasks.filter((task) => task.status === 'done').length
      return {
        ...kr,
        done,
        total: kr.tasks.length,
        progress: progressOf(done, kr.tasks.length),
        status: statusOfGroup(kr.tasks),
        due: dueOf(kr.tasks),
      }
    })
    const done = obj.tasks.filter((task) => task.status === 'done').length
    return {
      ...obj,
      krs,
      done,
      total: obj.tasks.length,
      progress: progressOf(done, obj.tasks.length),
      status: statusOfGroup(obj.tasks),
      due: dueOf(obj.tasks),
    }
  }).sort((a, b) => a.title.localeCompare(b.title))

  const allDone = tasks.filter((task) => task.status === 'done').length
  return {
    objectives,
    tasks,
    stats: {
      objectives: objectives.length,
      keyResults: objectives.reduce((sum, obj) => sum + obj.krs.length, 0),
      total: tasks.length,
      done: allDone,
      running: tasks.filter((task) => task.status === 'in-progress').length,
      blocked: tasks.filter((task) => task.status === 'blocked').length,
      progress: progressOf(allDone, tasks.length),
      minStart: tasks.reduce((min, task) => (task.start && (!min || task.start < min) ? task.start : min), null),
      maxEnd: tasks.reduce((max, task) => (task.end && (!max || task.end > max) ? task.end : max), null),
    },
  }
}

/**
 * Plan 视图的行：只按**真实的** Key Result 分组。
 *
 * 为什么不复用 objectives[].krs：那套投影为了让 OKR 视图有内容，会给没填字段的任务
 * 兜底（objective ← workspaceTitle，keyResult ← listName），于是 Plan 里每个
 * 「工作区 × 清单」的组合都变成一行假 KR —— 用户看到的「key value 被填了硬编码」。
 *
 * 这里只认真实字段 keyResultRaw：
 *   - 有值 → 该 KR 一行；
 *   - 没值 → 全部并进**同一个**组（不再按清单名拆开），行头也不显示 KR 文案。
 * 行头里的 Objective 同理：只有该组所有任务共享同一个真实 Objective 时才显示，
 * 否则留空，绝不拿工作区名顶替。
 *
 * @param {Array} tasks buildOpp 产出的 tasks（或任意带 keyResultRaw/objectiveRaw 的数组）
 */
export function buildPlanRows(tasks) {
  const list = Array.isArray(tasks) ? tasks : []
  const buckets = new Map()
  for (const task of list) {
    if (!task) continue
    const title = asText(task.keyResultRaw)
    const key = title || ''
    let row = buckets.get(key)
    if (!row) {
      row = { key, title, tasks: [], objectives: new Set() }
      buckets.set(key, row)
    }
    row.tasks.push(task)
    const objective = asText(task.objectiveRaw)
    if (objective) row.objectives.add(objective)
  }
  return Array.from(buckets.values()).map((row) => {
    const done = row.tasks.filter((task) => task.status === 'done').length
    const total = row.tasks.length
    return {
      id: 'plan:' + row.key,
      title: row.title,
      /* 只有全组共享同一个真实 O 才显示它；混合/缺失都留空，不编造 */
      objective: row.objectives.size === 1 ? Array.from(row.objectives)[0] : '',
      tasks: row.tasks,
      done,
      total,
      progress: progressOf(done, total),
    }
  }).sort((a, b) => (a.title || '\uffff').localeCompare(b.title || '\uffff'))
}

/**
 * 把「空的 O / KR」合并进任务投影出来的 OPP。
 * 空 O/KR 是用户显式创建的定义，不来自任务，因此任务过滤不应把它们隐藏；
 * 后续把任务归到同名 O/KR 后，buildOpp 会自然接上。
 */
export function mergeEmptyOkr(opp, emptyOkr) {
  const base = opp && typeof opp === 'object' ? opp : { objectives: [], tasks: [], stats: {} }
  const meta = emptyOkr && typeof emptyOkr === 'object' ? emptyOkr : {}
  const objectives = (Array.isArray(base.objectives) ? base.objectives : []).map((obj) => ({ ...obj, krs: Array.isArray(obj.krs) ? obj.krs.slice() : [] }))
  const byTitle = new Map(objectives.map((obj) => [obj.title, obj]))
  const ensureObjective = (title) => {
    const name = asText(title)
    if (!name) return null
    if (!byTitle.has(name)) {
      const obj = { id: name, title: name, tasks: [], krs: [], done: 0, total: 0, progress: 0, status: 'not-started', due: null, empty: true }
      byTitle.set(name, obj)
      objectives.push(obj)
    }
    return byTitle.get(name)
  }
  for (const item of Array.isArray(meta.objectives) ? meta.objectives : []) {
    const name = asText(typeof item === 'string' ? item : item && item.title)
    if (name) ensureObjective(name)
  }
  for (const item of Array.isArray(meta.keyResults) ? meta.keyResults : []) {
    const objective = asText(item && item.objective)
    const title = asText(item && (item.title || item.keyResult))
    if (!objective || !title) continue
    const obj = ensureObjective(objective)
    if (!obj) continue
    if (obj.krs.some((kr) => kr.title === title)) continue
    obj.krs.push({ id: objective + '\u0000' + title, title, objectiveId: objective, tasks: [], done: 0, total: 0, progress: 0, status: 'not-started', due: null, empty: true })
  }
  const allKrs = objectives.reduce((sum, obj) => sum + obj.krs.length, 0)
  return {
    ...base,
    objectives,
    stats: { ...(base.stats || {}), objectives: objectives.length, keyResults: allKrs },
  }
}


/** 以全量结构为准，把筛选后仍然可见的任务挂回去：O/KR 始终存在，任务行受筛选。 */
export function mergeOppStructure(display, full) {
  const shown = display && typeof display === 'object' ? display : { objectives: [] }
  const whole = full && typeof full === 'object' ? full : { objectives: [] }
  const shownByTitle = new Map((Array.isArray(shown.objectives) ? shown.objectives : []).map((obj) => [obj.title, obj]))
  const objectives = (Array.isArray(whole.objectives) ? whole.objectives : []).map((obj) => {
    const visible = shownByTitle.get(obj.title)
    const visibleKrs = new Map((Array.isArray(visible && visible.krs) ? visible.krs : []).map((kr) => [kr.title, kr]))
    return {
      ...obj,
      tasks: visible ? visible.tasks : [],
      krs: (Array.isArray(obj.krs) ? obj.krs : []).map((kr) => ({ ...kr, tasks: visibleKrs.get(kr.title)?.tasks || [] })),
    }
  })
  return { ...whole, objectives, tasks: shown.tasks || [] }
}

/**
 * 显示层用过滤后的任务，但 O/KR 的完成数、进度、状态、截止必须按**全量任务**算。
 * 这里只覆盖聚合字段，不改 display 里的 tasks（任务行仍受筛选影响）。
 */
export function mergeOppStats(display, full) {
  const base = display && typeof display === 'object' ? display : { objectives: [], tasks: [], stats: {} }
  const source = full && typeof full === 'object' ? full : { objectives: [] }
  const fullByTitle = new Map((Array.isArray(source.objectives) ? source.objectives : []).map((obj) => [obj.title, obj]))
  const objectives = (Array.isArray(base.objectives) ? base.objectives : []).map((obj) => {
    const whole = fullByTitle.get(obj.title)
    if (!whole) return obj
    const fullKrs = new Map((Array.isArray(whole.krs) ? whole.krs : []).map((kr) => [kr.title, kr]))
    return {
      ...obj,
      done: whole.done,
      total: whole.total,
      progress: whole.progress,
      status: whole.status,
      due: whole.due,
      krs: (Array.isArray(obj.krs) ? obj.krs : []).map((kr) => {
        const entire = fullKrs.get(kr.title)
        return entire ? { ...kr, done: entire.done, total: entire.total, progress: entire.progress, status: entire.status, due: entire.due } : kr
      }),
    }
  })
  return { ...base, objectives }
}

export default buildOpp
