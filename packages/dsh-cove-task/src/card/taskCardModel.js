/**
 * 任务卡模型（纯函数）—— 卡片「画什么」的唯一来源。
 *
 * 这一层从 panel.html 的 taskNode() 搬出来，但**不碰 DOM、不读 app、不发请求**：
 * 输入是任务对象 + 上下文，输出是一份可断言的卡片模型。渲染层（taskCardView.js）
 * 只负责把模型拼成 DOM，不再做任何业务判断 —— 这样侧边栏和关系画布共用同一份
 * 显隐规则，不会再各自长一套。
 *
 * 模型形状（稳定契约，改要先改文档）：
 *   {
 *     version, id, no, title, isCurrent, suspended,
 *     priority: { value, empty, running, unread },
 *     session: { id, lamp, label } | null,
 *     badges:  [{ key, label, cls }],              // 「新 / 已绑定 / 已开工 / 已完成 / 当前对话」
 *     people:  [{ role, label, items: [{ name, initial, avatar, anon }], more }],
 *     chips:   [{ key, label, cls, title, action, disabled, parts? }],
 *     docs:    [{ url, title, label }],
 *     relations: { predecessors, successors, sourceTasks, derivedTasks },  // 都是 { id, title, count } 摘要
 *     actions: [{ key, label, cls, title, disabled, primary }],
 *     comments: null | { supported, count, open },
 *   }
 *
 * 所有「空就不画」的判断都在这里；渲染层拿到空数组就不渲染那一行。
 */

import { buildCommentsModel } from './taskCardComments.js'

export const CARD_MODEL_VERSION = 1

export const PRIORITY_OPTIONS = ['P0', 'P1', 'P2', 'P3']

export const PRIORITY_LABEL = { P0: 'P0 最紧急', P1: 'P1 高', P2: 'P2 中', P3: 'P3 低' }

export const TRIGGER_TEXT = { manual: '人工触发', auto: '自动执行', scheduled: '按时执行' }

const str = (value) => (value == null ? '' : String(value))

const arr = (value) => (Array.isArray(value) ? value : [])

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 优先级只认 P0-P3，其它一律当没设（面板同口径）。 */
export function normPriority(value) {
  const v = str(value).trim().toUpperCase()
  return PRIORITY_OPTIONS.indexOf(v) >= 0 ? v : ''
}

/** 同年省年份：'2026-11-05' → '11-05'。 */
export function shortDayText(text, now) {
  const s = str(text).trim()
  if (!s) return ''
  const year = String(new Date(num(now) || Date.now()).getFullYear())
  return s.indexOf(year + '-') === 0 ? s.slice(year.length + 1) : s
}

/** 排期「下次」的统一口径：一次性已跑过/无效时返回空串（不把破折号拼进 chip）。 */
export function scheduleNextText(schedule, now) {
  const next = schedule ? str(schedule.nextText).trim() : ''
  if (!next || next === '—' || next === '-') return ''
  return shortDayText(next, now)
}

/** 排期有没有效：形状不对或没摘要都当「没排期」。 */
export function taskSchedule(task) {
  const s = task && task.schedule
  if (!s || typeof s !== 'object') return null
  if (!str(s.summary).trim() && !str(s.nextText).trim()) return null
  return s
}

/** 预期完成的短文案：'11-18 18:00'。 */
export function etaShortText(text) {
  return shortDayText(text).replace(/^\d{4}-/, '')
}

/** 主题色：编号按黄金角散开（画布节点用；面板侧用同一算法）。 */
export function toneForTask(task) {
  const no = num(task && task.no)
  if (!no) {
    const text = str(task && task.id)
    let hash = 0
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360
    return 'hsl(' + hash + ' 55% 55%)'
  }
  return 'hsl(' + Math.round((no * 137.508) % 360) + ' 60% 55%)'
}

/** 头像只认真名/真照片：没名字时给中性人形，不许拿 ou_ 首字母冒充。 */
function personView(member, roleLabel) {
  const m = member && typeof member === 'object' ? member : {}
  const name = str(m.name).trim()
  const avatar = /^https?:\/\//i.test(str(m.avatar)) ? str(m.avatar) : ''
  return {
    id: str(m.id),
    name,
    avatar,
    initial: name ? name.slice(0, 1).toUpperCase() : '',
    anon: !name && !avatar,
    ariaLabel: roleLabel + '：' + (name || '未知成员'),
    tip: name || roleLabel,
  }
}

function peopleGroups(task) {
  const members = arr(task && task.members)
  if (!members.length) return []
  const assignees = members.filter((m) => m && m.role === 'assignee')
  const assigneeIds = new Set(assignees.map((m) => str(m && m.id)))
  const followers = members.filter((m) => m && m.role !== 'assignee' && !assigneeIds.has(str(m.id)))
  const groups = []
  for (const [role, label, list] of [['assignee', '负责人', assignees], ['follower', '关注人', followers]]) {
    if (!list.length) continue
    const items = list.slice(0, 4).map((m) => personView(m, label))
    groups.push({
      role,
      label,
      items,
      more: list.length > items.length ? list.length - items.length : 0,
      moreTip: list.slice(items.length).map((m) => str(m && m.name) || '未知成员').join('、'),
      tip: label + '：' + list.map((m) => str(m && m.name) || '未知成员').join('、'),
    })
  }
  return groups
}

function relationSummary(task) {
  const rel = (task && task.relations) || {}
  const build = (key) => {
    const list = arr(rel[key]).map((item) => ({
      id: str(item && item.id),
      title: str(item && item.title) || str(item && item.id),
    }))
    return list
  }
  const predecessors = build('predecessors')
  const successors = build('successors')
  const sourceTasks = build('sourceTasks')
  const derivedTasks = build('derivedTasks')
  if (!predecessors.length && !successors.length && !sourceTasks.length && !derivedTasks.length) return null
  return { predecessors, successors, sourceTasks, derivedTasks }
}

/**
 * 模型消费的任务字段（显式契约）。
 *
 * 与 panel.html 的 `taskNode()` 做对照测试用：那边引用到的 `t.*` 必须都在这个表里，
 * 否则说明「面板画了、卡片模型没读」，漂移会立刻红。
 */
export const CARD_CONSUMED_FIELDS = [
  'id', 'no', 'title', 'priority', 'done', 'started', 'isNew', 'boundOnly',
  'start', 'end', 'due', 'listName', 'meta', 'customFields',
  'schedule', 'commitment', 'delayAttribution',
  'members', 'docs', 'relations',
  'sessionId', 'sessionAlive', 'sessionPhase', 'sessionUnread',
  'reopenPending', 'reopenError',
  'suspension',
  'workspaceTitle', 'workspaceName', 'workspacePath', 'workspaceWrite', 'workspaceError', 'workspaceCanRegister',
  'error',
]

/**
 * 构建卡片模型。
 * @param {object} task 任务对象（/api/tasks 或 overviewView 的项）
 * @param {object} context
 *   - now: 毫秒时间戳（测试注入）
 *   - currentSessionId: 当前对话的会话 id
 *   - busy: 该任务是否在请求中（动作禁用）
 *   - sharedListName: 共享清单名（不显示清单 chip）
 *   - echoFieldNames: 写回列名（这些自定义字段不重复展示）
 *   - hiddenFieldNames: 设置里隐藏的字段名
 *   - canStart: 是否允许「开工/绑定」（宿主能力、当前有没有会话等）
 */
export function buildTaskCardModel(task, context) {
  const ctx = context && typeof context === 'object' ? context : {}
  const t = task && typeof task === 'object' ? task : {}
  const now = num(ctx.now) || Date.now()
  const id = str(t.id)
  const no = num(t.no)
  const title = str(t.title) || '(无标题任务)'
  const priority = normPriority(t.priority)
  const busy = ctx.busy === true
  const suspended = !!(t.suspension && t.suspension.active)
  const sessionId = str(t.sessionId)
  const sessionAlive = t.sessionAlive === true
  const running = sessionAlive && str(t.sessionPhase) === 'running'
  const unread = sessionAlive && !running && t.sessionUnread === true
  const isCurrent = !!(sessionId && str(ctx.currentSessionId) && sessionId === str(ctx.currentSessionId))

  const model = {
    version: CARD_MODEL_VERSION,
    id,
    no,
    title,
    isCurrent,
    suspended,
    priority: { value: priority, empty: !priority, running, unread },
    session: sessionId
      ? {
        id: sessionId,
        running,
        unread,
        alive: sessionAlive,
        lamp: running ? 'running' : unread ? 'unread' : sessionAlive ? 'idle' : 'dead',
        label: 'Session',
      }
      : null,
    badges: [],
    people: peopleGroups(t),
    chips: [],
    docs: [],
    relations: relationSummary(t),
    actions: [],
    comments: null,
  }

  /* ---- 徽标：与面板 task-meta 的 badge 顺序一致 ---- */
  const badges = model.badges
  /* 截止（飞书原生结束时间的旧字段口径）：面板在徽标行前先放一个 .due。 */
  if (str(t.due)) model.due = '截止 ' + str(t.due)
  if (t.isNew === true) badges.push({ key: 'new', label: '新', cls: 'badge badge-new' })
  if (t.boundOnly === true && t.started !== true) badges.push({ key: 'bound', label: '已绑定', cls: 'badge' })
  if (t.started === true) badges.push({ key: 'started', label: '已开工', cls: 'badge badge-ok' })
  if (t.done === true) badges.push({ key: 'done', label: '已完成', cls: 'badge badge-done' })
  if (t.reopenPending === true) {
    badges.push({
      key: 'reopen',
      label: '已重开 · 飞书待同步',
      cls: 'hint',
      title: str(t.reopenError) || '正在将原任务重开状态写回飞书',
    })
  }
  if (isCurrent) badges.push({ key: 'current', label: '当前对话', cls: 'badge badge-current' })
  /* 画布节点不是「任务快照」：状态与关系计数由调用方按 layout 口径算好传进来。 */
  if (Array.isArray(ctx.badges)) {
    model.badges = ctx.badges.map((item) => Object.assign({ cls: 'badge' }, item))
  }

  /* ---- chips：顺序与面板 task-meta 一致 = 清单/触发 → 时间 → 排期 → 预期 → 归因 → 自定义字段 → 工作区 ---- */
  const chips = model.chips
  {
    const listName = str(t.listName)
    if (listName && listName !== str(ctx.sharedListName)) {
      chips.push({ key: 'list', label: listName, cls: 'chip chip-list' })
    }
    const trigger = (t.meta || {}).trigger
    if (trigger && TRIGGER_TEXT[trigger]) {
      chips.push({ key: 'trigger', label: TRIGGER_TEXT[trigger], cls: 'chip chip-trigger chip-' + trigger })
    }
  }
  const sched = taskSchedule(t)
  const nextText = scheduleNextText(sched, now)
  const startText = str(t.start)
  const endText = str(t.end)
  if (startText && !nextText) {
    chips.push({ key: 'start', label: '开始 ' + shortDayText(startText, now), cls: 'chip chip-time', title: '任务开始时间：' + startText, action: 'start' })
  }
  if (endText) {
    chips.push({ key: 'end', label: '截止 ' + shortDayText(endText, now), cls: 'chip chip-time', title: '任务截止时间：' + endText, action: 'end' })
  }
  {
    const paused = !!(sched && sched.state === 'paused')
    const short = sched ? str(sched.short).trim() : ''
    const rule = sched ? (short || str(sched.summary).trim() || '已排期') : ''
    const label = sched ? ('⏰ ' + rule + (paused ? ' · ⏸️' : '')) : '⏰ 定时'
    chips.push({
      key: 'schedule',
      label,
      cls: 'chip chip-sched' + (sched ? '' : ' chip-sched-empty') + (paused ? ' is-paused' : ''),
      title: sched ? '下次 ' + (str(sched.nextText).trim() || rule) + ' · 点击修改排期' : '给这条任务排期（到点会自动开一条会话）',
      action: 'schedule',
      disabled: !sched && !sessionId,
    })
  }
  {
    const c = t.commitment && typeof t.commitment === 'object' ? t.commitment : null
    if (!c) {
      chips.push({ key: 'eta', label: '📅 预期', cls: 'chip chip-eta chip-eta-empty', title: '设置预期完成时间（承诺什么时候交，用于算履约）', action: 'eta' })
    } else {
      const text = etaShortText(c.expectedText) || (num(c.expectedAt) ? shortDayText(new Date(num(c.expectedAt)).toISOString().slice(0, 10), now) : '')
      const label = str(c.label).trim()
      const tone = c.state === 'late' ? ' is-late' : c.state === 'soon' ? ' is-soon' : ''
      const unsynced = c.syncState === 'failed' || c.syncState === 'pending'
      const titleParts = ['预期 ' + (str(c.expectedText).trim() || text)]
      if (label) titleParts.push(label)
      if (c.firstPromiseText) titleParts.push('首次承诺 ' + c.firstPromiseText)
      if (num(c.delayCount) > 0) titleParts.push('重承诺 ' + num(c.delayCount) + ' 次')
      if (c.syncState === 'failed') titleParts.push('写回飞书失败')
      else if (c.syncState === 'pending') titleParts.push('写回飞书未完成')
      titleParts.push('点击修改预期')
      chips.push({
        key: 'eta',
        label: '📅 预期 · ' + text + (label ? ' · ' + label : ''),
        cls: 'chip chip-eta' + tone,
        title: titleParts.join(' · '),
        action: 'eta',
        parts: unsynced ? [{ text: '未同步', cls: 'chip-eta-sync' }] : [],
      })
    }
  }
  {
    const attrib = t.delayAttribution
    if (attrib && attrib.reason) {
      chips.push({
        key: 'attribution',
        label: '🤖 ' + (attrib.label || '归因'),
        cls: 'chip chip-attrib',
        title: 'AI 归因：' + attrib.reason + (attrib.evidence ? '\n依据：' + attrib.evidence : ''),
      })
    }
  }
  {
    /* 自定义字段：跳过设置里隐藏的、写回列（它们已经是 chip 了）、优先级，最多 4 个。 */
    const hidden = new Set(arr(ctx.hiddenFieldNames).concat(arr(ctx.echoFieldNames)))
    const fields = arr(t.customFields)
    let shown = 0
    for (const field of fields) {
      if (shown >= 4) break
      const name = str(field && field.name)
      const value = field && field.value != null ? str(field.value) : ''
      if (!value || hidden.has(name)) continue
      /* 优先级在卡片左上角已经是实心徽标了，自定义字段里再来一枚就是重复（面板同口径）。 */
      if (name === '优先级') continue
      if (field.type === 'datetime' && /开始|结束/.test(name)) continue
      chips.push({ key: 'field:' + (name || shown), label: (name ? name + ' ' : '') + value, cls: 'chip chip-field', title: str(field.type) })
      shown += 1
    }
  }
  {
    const resolved = str(t.workspaceTitle) || str(t.workspaceName)
    if (resolved) {
      const write = t.workspaceWrite && typeof t.workspaceWrite === 'object' ? t.workspaceWrite : null
      const pending = !!(write && write.pending)
      const writeError = str(write && write.error)
      chips.push({
        key: 'workspace',
        label: resolved + (pending || writeError ? ' ·' : ''),
        cls: 'chip chip-field chip-workspace',
        title: (t.workspacePath ? t.workspacePath + ' · ' : '')
          + '点击切换工作区'
          + (pending ? ' · 飞书同步中' : writeError ? ' · 飞书待同步：' + writeError : ''),
        action: 'workspace',
      })
    }
  }
  if (t.workspaceError) {
    model.workspaceError = { text: str(t.workspaceError), canRegister: t.workspaceCanRegister === true }
  }
  if (str(t.error)) model.error = str(t.error)

  /* ---- 文档：去重、保序 ---- */
  const seenDoc = new Set()
  for (const doc of arr(t.docs)) {
    const url = str(doc && doc.url)
    if (!url || seenDoc.has(url)) continue
    seenDoc.add(url)
    const docTitle = str(doc && doc.title)
    const tail = url.split('/').pop().slice(-6)
    model.docs.push({ url, title: docTitle, label: docTitle || '文档 · ' + tail })
  }

  /* ---- 动作：默认是面板的动作行；画布传 ctx.actions 覆盖（只留打开会话 / 聚焦）。
     缺 handler 的动作由渲染层跳过，所以画布只要不给 handler 就不会出现写操作。 ---- */
  if (Array.isArray(ctx.actions)) {
    model.actions = ctx.actions.map((action) => Object.assign({ cls: 'task-text-action' }, action))
  } else {
  const canStart = ctx.canStart !== false
  if (!sessionId && !suspended && canStart) {
    model.actions.push({ key: 'start', label: '开工', cls: 'btn btn-primary btn-sm', title: '在当前会话开工（任务绑定到这条对话）', disabled: busy })
    model.actions.push({ key: 'bind', label: '绑定', cls: 'btn btn-ghost btn-sm', title: '把当前会话绑定到这条任务并同步名称，但不开始工作', disabled: busy || ctx.currentSessionId === '' })
  }
  model.actions.push({ key: 'complete', label: '完成', cls: 'task-text-action', disabled: busy || t.done === true })
  model.actions.push({ key: 'docs', label: '文档', cls: 'task-text-action', disabled: busy })
  model.actions.push({ key: 'sync', label: '同步', cls: 'task-text-action', disabled: busy })
  model.actions.push({ key: 'comments', label: '评论', cls: 'task-text-action', disabled: busy })
  /* 已完成的任务不给「挂起/恢复」（面板 suspensionControlNode 的同口径：done 且没挂起就不出）。 */
  /* 面板的顺序是「评论 → 弹性空白 → 挂起/恢复 → ···」，所以挂起也放在 end 槽。 */
  if (!t.done || suspended) model.actions.push({ key: 'suspend', label: suspended ? '恢复' : '挂起', cls: 'task-text-action', disabled: busy, slot: 'end' })
  model.actions.push({ key: 'more', label: '···', cls: 'task-text-action', title: '更多任务操作', disabled: busy, slot: 'end' })
  }

  /* ---- 评论区：宿主给了状态才建模型（画布上不传就是 null，渲染层自然不画） ---- */
  if (ctx.comments && typeof ctx.comments === 'object') {
    model.comments = buildCommentsModel(ctx.comments, {
      done: t.done === true,
      suspended,
      hasSession: !!sessionId,
      supported: ctx.commentsSupported !== false,
      enabled: ctx.commentsEnabled !== false,
    })
  }

  return model
}

export default buildTaskCardModel
