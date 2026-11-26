/**
 * 洞察页纯函数的离线单测（node test/insightView.mjs）。
 *
 * 覆盖：空数据 / 单任务 / 大量任务 / 坏数据不崩 / 百分比和恰好 100 /
 * Top N 截断（项目 Top8 + 其他、阻塞榜 Top5、最近动态 Top5）/ 互斥状态桶 /
 * 依赖链深度（含环）/ 百分比最大余数法。
 */

import assert from 'node:assert/strict'
import {
  buildInsight,
  bucketOf,
  sharePct,
  longestDepChain,
  formatAgo,
  startOfDay,
  buildTrend,
  buildFulfillment,
  buildDelayReasons,
  buildQuality,
  buildHistory,
  buildCalendar,
  calendarFromTasks,
  calendarHints,
  formatDays,
  formatSlack,
  TREND_BOX,
  TONES,
} from '../src/client/insightView.js'

let passed = 0
const failed = []

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failed.push({ name, error })
    console.log(`  FAIL ${name}`)
    console.log(`       ${error && error.message}`)
  }
}

const task = (id, extra) => Object.assign({
  id,
  no: 1,
  title: `任务 ${id}`,
  done: false,
  project: '项目A',
  workspaceKey: 'wA',
  workspaceTitle: '项目A',
  blocked: false,
  ready: true,
  started: false,
  suspended: false,
  sessionId: `s-${id}`,
  running: false,
  sessionTurn: 0,
  predecessors: [],
  successors: [],
  sourceTasks: [],
  derivedTasks: [],
  blockedBy: [],
}, extra || {})

/* ---------------- 纯工具 ---------------- */

check('sharePct：三份相等时和恰好 100（最大余数法，不是 33+33+33）', () => {
  const pcts = sharePct([1, 1, 1])
  assert.equal(pcts.reduce((a, b) => a + b, 0), 100)
  assert.deepEqual([...pcts].sort(), [33, 33, 34])
})

check('sharePct：全 0 时返回全 0（不制造 NaN / 不硬凑 100）', () => {
  assert.deepEqual(sharePct([0, 0, 0, 0]), [0, 0, 0, 0])
  assert.deepEqual(sharePct([]), [])
})

check('sharePct：0 值桶不会被余数法「抬高」（避免 0% 变成 1%）', () => {
  const pcts = sharePct([9, 1, 0, 0])
  assert.equal(pcts[2], 0)
  assert.equal(pcts[3], 0)
  assert.equal(pcts.reduce((a, b) => a + b, 0), 100)
})

check('bucketOf：完成优先于阻塞；挂起在阻塞之后判断', () => {
  assert.equal(bucketOf({ done: true, blocked: true, blockedBy: [{}] }), 'done')
  assert.equal(bucketOf({ done: false, blocked: true, blockedBy: [{}], suspended: true }), 'blocked')
  assert.equal(bucketOf({ done: false, blocked: false, suspended: true }), 'suspended')
  assert.equal(bucketOf({ done: false }), 'ready')
  assert.equal(bucketOf(null), 'ready', '坏输入不崩')
})

check('longestDepChain：链式依赖算出真实深度', () => {
  const relations = [
    { from: 'a', to: 'b', kind: 'depends_on' },
    { from: 'b', to: 'c', kind: 'depends_on' },
    { from: 'c', to: 'd', kind: 'depends_on' },
    { from: 'a', to: 'd', kind: 'derived_from' },
  ]
  assert.equal(longestDepChain(relations), 4)
})

check('longestDepChain：有环不栈溢出，退回一个有限值', () => {
  const relations = [
    { from: 'a', to: 'b', kind: 'depends_on' },
    { from: 'b', to: 'a', kind: 'depends_on' },
  ]
  const depth = longestDepChain(relations)
  assert.ok(Number.isFinite(depth) && depth >= 2, `环上深度 ${depth}`)
})

check('longestDepChain：没有依赖边 → 0', () => {
  assert.equal(longestDepChain([]), 0)
  assert.equal(longestDepChain([{ from: 'a', to: 'b', kind: 'derived_from' }]), 0)
})

/* ---------------- 空 / 坏数据 ---------------- */

check('空数据：empty=true，四个互斥桶全是 0，百分比全 0，不抛', () => {
  const view = buildInsight({ tasks: [], relations: [], workspaces: [] })
  assert.equal(view.empty, true)
  assert.equal(view.totals.tasks, 0)
  assert.equal(view.statusMix.length, 4)
  assert.deepEqual(view.statusMix.map((row) => row.count), [0, 0, 0, 0])
  assert.deepEqual(view.statusMix.map((row) => row.pct), [0, 0, 0, 0])
  assert.deepEqual(view.blockers, [])
  assert.deepEqual(view.workspaces, [])
  assert.equal(view.relations.maxChain, 0)
})

check('坏数据：null / undefined / 字符串 / 数组里混垃圾都不崩', () => {
  for (const bad of [null, undefined, 'x', 42, [], { tasks: 'no' }, { tasks: [null, 1, {}, []] }]) {
    const view = buildInsight(bad)
    assert.equal(typeof view.empty, 'boolean')
    assert.equal(Array.isArray(view.kpis), true)
    assert.equal(view.kpis.length, 6)
  }
})

check('坏任务行：缺 id 的被丢掉，其余照算', () => {
  const view = buildInsight({ tasks: [{ title: '没有 id' }, task('a1')] })
  assert.equal(view.totals.tasks, 1)
})

/* ---------------- 单任务 ---------------- */

check('单任务（未完成）：就绪 1、完成率 0%、KPI 五张', () => {
  const view = buildInsight({ tasks: [task('a1')] })
  assert.equal(view.empty, false)
  assert.equal(view.totals.tasks, 1)
  assert.equal(view.statusMix.find((row) => row.key === 'ready').count, 1)
  assert.equal(view.statusMix.find((row) => row.key === 'done').pct, 0)
  assert.equal(view.kpis.length, 6)
  assert.equal(view.kpis[0].text, '1')
  assert.equal(view.kpis[1].text, '0%')
})

check('单任务（已完成）：完成率 100%，状态分布 100/0/0/0', () => {
  const view = buildInsight({ tasks: [task('a1', { done: true })] })
  assert.equal(view.kpis[1].pct, 100)
  assert.deepEqual(view.statusMix.map((row) => row.pct), [100, 0, 0, 0])
  assert.deepEqual(view.recent.done.map((row) => row.id), ['a1'])
})

/* ---------------- 状态分布 / KPI ---------------- */

const MIX = [
  task('d1', { done: true, no: 1 }),
  task('d2', { done: true, no: 2 }),
  task('r1', { no: 3 }),
  task('b1', { no: 4, blocked: true, ready: false, blockedBy: [{ id: 'x', title: '等 X' }] }),
  task('s1', { no: 5, suspended: true }),
  task('run1', { no: 6, running: true, sessionTurn: 3 }),
]

check('状态分布：四桶互斥且百分比和恰好 100', () => {
  const view = buildInsight({ tasks: MIX })
  const sum = view.statusMix.reduce((acc, row) => acc + row.count, 0)
  assert.equal(sum, view.totals.tasks, '四桶覆盖全部任务（互斥）')
  assert.equal(view.statusMix.reduce((acc, row) => acc + row.pct, 0), 100)
  assert.equal(view.statusMix.find((row) => row.key === 'done').count, 2)
  assert.equal(view.statusMix.find((row) => row.key === 'blocked').count, 1)
  assert.equal(view.statusMix.find((row) => row.key === 'suspended').count, 1)
  assert.equal(view.statusMix.find((row) => row.key === 'ready').count, 2)
  assert.deepEqual(view.statusMix.map((row) => row.key), TONES)
})

check('状态分布：显式 blocked=true 但没有 blockedBy 也算阻塞（宿主口径）', () => {
  const view = buildInsight({ tasks: [task('x1', { blocked: true, blockedBy: [] })] })
  assert.equal(view.statusMix.find((row) => row.key === 'blocked').count, 1)
})

check('KPI：六张卡（含今日完成），完成率是百分比、其余是条数，ratio 落在 [0,1]', () => {
  const view = buildInsight({ tasks: MIX })
  assert.equal(view.kpis.length, 6)
  assert.deepEqual(view.kpis.map((row) => row.id), ['total', 'done', 'blocked', 'ready', 'suspended', 'todayDone'])
  assert.equal(view.kpis[0].text, '6')
  assert.equal(view.kpis[1].text, '33%')
  assert.equal(view.kpis[2].text, '1')
  view.kpis.forEach((row) => {
    assert.ok(row.ratio >= 0 && row.ratio <= 1, `${row.id} ratio=${row.ratio}`)
    assert.ok(['brand', 'ok', 'danger', 'idle', 'warn'].includes(row.tone))
  })
})

check('running 计数走宿主字段，不靠猜', () => {
  const view = buildInsight({ tasks: MIX })
  assert.equal(view.totals.running, 1)
  assert.equal(view.runningTasks.length, 1)
  assert.equal(view.runningTasks[0].id, 'run1')
  assert.equal(view.runningTasks[0].turn, 3)
})

/* ---------------- 项目分布 Top N ---------------- */

check('项目分布：按任务数倒序', () => {
  const tasks = [
    ...Array.from({ length: 3 }, (_, i) => task(`a${i}`, { project: 'A', workspaceKey: 'wA', workspaceTitle: 'A' })),
    ...Array.from({ length: 5 }, (_, i) => task(`b${i}`, { project: 'B', workspaceKey: 'wB', workspaceTitle: 'B' })),
    task('c0', { project: 'C', workspaceKey: 'wC', workspaceTitle: 'C' }),
  ]
  const view = buildInsight({ tasks })
  assert.deepEqual(view.workspaces.map((row) => row.label), ['B', 'A', 'C'])
  assert.equal(view.workspaces[0].total, 5)
})

check('项目分布：12 个项目 → Top 8 + 「其他 4 个项目」，总数守恒', () => {
  const tasks = []
  for (let i = 0; i < 12; i += 1) {
    for (let k = 0; k <= i; k += 1) tasks.push(task(`t${i}-${k}`, { project: `P${i}`, workspaceKey: `w${i}`, workspaceTitle: `P${i}` }))
  }
  const view = buildInsight({ tasks })
  assert.equal(view.workspaces.length, 9, 'Top8 + 其他')
  const other = view.workspaces[8]
  assert.equal(other.other, true)
  assert.ok(other.label.includes('4'), other.label)
  const sum = view.workspaces.reduce((acc, row) => acc + row.total, 0)
  assert.equal(sum, tasks.length, '裁剪后总数仍然守恒')
})

check('项目分布：8 个项目整时不出现「其他」', () => {
  const tasks = Array.from({ length: 8 }, (_, i) => task(`t${i}`, { project: `P${i}`, workspaceKey: `w${i}`, workspaceTitle: `P${i}` }))
  const view = buildInsight({ tasks })
  assert.equal(view.workspaces.length, 8)
  assert.equal(view.workspaces.some((row) => row.other === true), false)
})

check('项目分布：条上叠加完成率（done/total）', () => {
  const tasks = [task('a1', { done: true }), task('a2'), task('a3'), task('a4')]
  const view = buildInsight({ tasks })
  assert.equal(view.workspaces[0].pct, 25)
  assert.equal(view.workspaces[0].ratio, 0.25)
})

check('项目归属：跨工作区合并，换工作区仍保留项目数量和完成率', () => {
  const project = 'Demo'
  const tasks = [task('x', { project, workspaceKey: 'old', done: true }), task('y', { project, workspaceKey: 'other' })]
  const before = buildInsight({ tasks })
  const after = buildInsight({ tasks: tasks.map((row) => ({ ...row, workspaceKey: 'new', workspaceTitle: '新代码副本' })) })
  assert.deepEqual(after.workspaces, before.workspaces)
  assert.equal(after.projectCount, 1)
  assert.equal(after.totals.projects, 1)
  assert.ok(after.kpis[0].note.startsWith('1 个项目'))
  assert.equal(after.workspaces[0].key, project)
  assert.equal(after.workspaces[0].label, project)
  assert.equal(after.workspaces[0].pct, 50)
})

check('项目归属：同工作区同名项目合并，明确未归属不推断', () => {
  const view = buildInsight({ tasks: [
    task('x', { project: '同名' }),
    task('y', { project: '同名' }),
    task('z', { project: '' }),
  ] })
  assert.equal(view.projectCount, 1)
  assert.deepEqual(view.workspaces.map((row) => row.key).sort(), ['', '同名'])
  assert.equal(view.workspaces.find((row) => row.key === '').label, '未归属项目')
})

check('项目归属：完成最多提示按项目名称合并不同工作区', () => {
  const now = Date.UTC(2026, 10, 25, 12)
  const tasks = ['a', 'b'].map((id) => task(id, { project: 'Demo', workspaceKey: id, workspaceTitle: id, completedAt: now - 1000 }))
  const hints = calendarHints(tasks, now, null)
  assert.ok(hints.some((row) => row.text === '完成最多：Demo（2 件）'))
})

check('缺项目不推断，未归属不计项目数；名称不与展示桶冲突', () => {
  const view = buildInsight({ tasks: [
    task('x', { project: ' __none__ ' }), task('y', { project: '__none__' }),
    task('z', { project: undefined, workspaceTitle: '不能推断' }), task('empty', { project: '' }),
  ] })
  assert.equal(view.projectCount, 1)
  assert.equal(view.totals.projects, 1)
  assert.equal(view.kpis[0].note.startsWith('1 个项目'), true)
  assert.deepEqual(view.workspaces.map((row) => row.key).sort(), ['', '__none__'])
  assert.equal(view.workspaces.find((row) => row.key === '__none__').total, 2)
  const now = new Date('2026-11-11T10:00:00+08:00').getTime()
  assert.equal(calendarHints([{ id: 'old', completedAt: now - 1000, workspaceTitle: '不能推断' }], now, null).some((row) => row.key === 'workspace'), false)
  const many = buildInsight({ tasks: Array.from({ length: 18 }, (_, i) => task(`p${i}`, { project: `P${i % 9}` })).concat(task('none', { project: '' })) })
  assert.equal(many.projectCount, 9)
  assert.equal(many.workspaces.at(-1).label, '其他项目及未归属任务')
})

/* ---------------- 关系概览 ---------------- */

check('关系概览：依赖边 / 来源边 / ghost 端点 / 最长链', () => {
  const tasks = [task('a1'), task('b1'), task('c1')]
  const relations = [
    { from: 'b1', to: 'a1', kind: 'depends_on' },
    { from: 'a1', to: 'c1', kind: 'derived_from' },
    { from: 'zz-missing', to: 'a1', kind: 'depends_on' },
  ]
  const view = buildInsight({ tasks, relations })
  assert.equal(view.relations.dependencyEdges, 2)
  assert.equal(view.relations.provenanceEdges, 1)
  assert.equal(view.relations.ghosts, 1)
  assert.equal(view.relations.maxChain, 2)
  assert.equal(view.relations.rows.length, 4)
  assert.deepEqual(view.relations.rows.map((row) => row.key), ['dep', 'prov', 'ghost', 'chain'])
})

check('关系概览：没有 ghost 时 tone 是 ok（不留红色噪音）', () => {
  const view = buildInsight({ tasks: [task('a1'), task('b1')], relations: [{ from: 'b1', to: 'a1', kind: 'depends_on' }] })
  assert.equal(view.relations.rows.find((row) => row.key === 'ghost').tone, 'ok')
})

/* ---------------- 阻塞榜 ---------------- */

check('阻塞榜：按「等几个」倒序，最多 5 条，带「等谁」', () => {
  const tasks = [
    task('one', { no: 1, blocked: true, blockedBy: [{ id: 'x', title: '等 X' }] }),
    task('three', { no: 2, blocked: true, blockedBy: [{ id: 'x', title: '等 X' }, { id: 'y', title: '等 Y' }, { id: 'z', title: '等 Z' }] }),
    ...Array.from({ length: 5 }, (_, i) => task(`b${i}`, { no: 10 + i, blocked: true, blockedBy: [{ id: `q${i}`, title: `等 Q${i}` }] })),
  ]
  const view = buildInsight({ tasks })
  assert.equal(view.blockers.length, 5, 'Top 5 截断')
  assert.equal(view.blockers[0].id, 'three', '等 3 个的排第一')
  assert.equal(view.blockers[0].count, 3)
  assert.ok(view.blockers[0].waitingText.includes('等 X'))
  assert.deepEqual(view.blockers.map((row) => row.rank), [1, 2, 3, 4, 5])
})

check('阻塞榜：「等谁」缺标题时退回任务表里的标题或 id', () => {
  const view = buildInsight({
    tasks: [task('x1', { blocked: true, blockedBy: [{ id: 'a1' }] }), task('a1', { title: '真正的标题' })],
  })
  assert.equal(view.blockers[0].waiting[0].title, '真正的标题')
})

check('阻塞榜：真正删掉的前置退回 id，不显示「undefined」', () => {
  const view = buildInsight({ tasks: [task('x1', { blocked: true, blockedBy: [{ id: 'zz-missing' }] })] })
  assert.equal(view.blockers[0].waiting[0].title, 'zz-missing')
})

/* ---------------- 最近动态 ---------------- */

const NOW = new Date('2026-11-11T10:00:00+08:00').getTime()
const MIN = 60 * 1000

check('最近动态：三列各 Top 5，按真实时间戳倒序（completedAt / startedAt / suspendedAt）', () => {
  const tasks = [
    task('d-old', { no: 1, done: true, completedAt: NOW - 3 * 60 * MIN }),
    task('d-new', { no: 2, done: true, completedAt: NOW - 5 * MIN }),
    task('d-mid', { no: 3, done: true, completedAt: NOW - 40 * MIN }),
    task('s-new', { no: 9, started: true, suspended: true, suspendedAt: NOW - 2 * MIN, startedAt: NOW - 90 * MIN }),
    task('s-old', { no: 8, started: true, suspended: true, suspendedAt: NOW - 300 * MIN, startedAt: NOW - 600 * MIN }),
  ]
  const view = buildInsight({ tasks, now: NOW })
  assert.equal(view.recent.orderBy, '完成 / 开始 / 挂起时间倒序')
  assert.deepEqual(view.recent.done.map((row) => row.id), ['d-new', 'd-mid', 'd-old'], '完成时间新的在前')
  assert.deepEqual(view.recent.suspended.map((row) => row.id), ['s-new', 's-old'], '挂起时间新的在前')
  assert.ok(view.recent.done[0].atText.includes('分钟前'), view.recent.done[0].atText)
  assert.equal(view.recent.done[0].at, NOW - 5 * MIN)
})

check('最近动态：时间戳为 0 的排最后，并标「时间未记录」（atText 为空）', () => {
  const tasks = [
    task('no-time', { no: 99, done: true }),
    task('timed', { no: 1, done: true, completedAt: NOW - MIN }),
  ]
  const view = buildInsight({ tasks, now: NOW })
  assert.deepEqual(view.recent.done.map((row) => row.id), ['timed', 'no-time'])
  assert.equal(view.recent.done[1].atText, '')
})

check('今日完成 KPI：按 completedAt 落在今天 0 点之后统计', () => {
  const tasks = [
    task('t1', { done: true, completedAt: NOW - 30 * MIN }),
    task('t2', { done: true, completedAt: NOW - 2 * 24 * 60 * MIN }),
  ]
  const view = buildInsight({ tasks, now: NOW })
  assert.equal(view.hasCompletionTime, true)
  const kpi = view.kpis.find((row) => row.id === 'todayDone')
  assert.equal(kpi.label, '今日完成')
  assert.equal(kpi.value, 1)
  assert.equal(view.todayDone, 1)
})

check('今日完成 KPI：一个完成时间都没有时退化为「已完成」并标注', () => {
  const view = buildInsight({ tasks: [task('t1', { done: true }), task('t2', { done: true })], now: NOW })
  assert.equal(view.hasCompletionTime, false)
  const kpi = view.kpis.find((row) => row.id === 'todayDone')
  assert.equal(kpi.label, '已完成')
  assert.equal(kpi.value, 2)
  assert.ok(kpi.note.includes('累计'))
})

check('formatAgo / startOfDay：相对时间与今日边界', () => {
  assert.equal(formatAgo(0), '刚刚')
  assert.equal(formatAgo(30 * 1000), '刚刚')
  assert.equal(formatAgo(5 * MIN), '5 分钟前')
  assert.equal(formatAgo(3 * 60 * MIN), '3 小时前')
  assert.equal(formatAgo(3 * 24 * 60 * MIN), '3 天前')
  const d = new Date(startOfDay(NOW))
  assert.equal(d.getHours(), 0)
})

check('最近动态：已完成的不进「最近开始」（避免同一任务两处出现）', () => {
  const view = buildInsight({ tasks: [task('a1', { done: true, started: true, completedAt: NOW - MIN, startedAt: NOW - 90 * MIN })], now: NOW })
  assert.equal(view.recent.done.length, 1)
  assert.equal(view.recent.started.length, 0)
})

/* ---------------- 规模 ---------------- */

check('大量任务（500 条 / 200 条关系）也能算，且状态和守恒', () => {
  const tasks = Array.from({ length: 500 }, (_, i) => task(`t${i}`, {
    no: i + 1,
    done: i % 3 === 0,
    blocked: i % 7 === 0 && i % 3 !== 0,
    suspended: i % 11 === 0,
    project: `P${i % 9}`,
    workspaceKey: `w${i % 9}`,
    workspaceTitle: `P${i % 9}`,
    running: i % 37 === 0,
  }))
  const relations = Array.from({ length: 200 }, (_, i) => ({ from: `t${i}`, to: `t${i + 1}`, kind: 'depends_on' }))
  const view = buildInsight({ tasks, relations })
  assert.equal(view.totals.tasks, 500)
  assert.equal(view.statusMix.reduce((acc, row) => acc + row.count, 0), 500)
  assert.equal(view.statusMix.reduce((acc, row) => acc + row.pct, 0), 100)
  assert.equal(view.workspaces.length, 9)
  assert.equal(view.relations.maxChain, 201)
})

/* ==================================================================
 * 历史指标（task-21）：吞吐趋势 / 履约 / 延期原因 / 质量周期
 * ================================================================== */

const DAYS14 = Array.from({ length: 14 }, (_, i) => ({
  day: `2026-10-${String(29 + i).padStart(2, '0')}`,
  done: i,
  created: 14 - i,
  started: i % 3,
  active: i * 2,
  wip: 1,
  docs: 0,
  cycleMedianDays: i % 2 ? 5.63 : null,
}))
const STATS = {
  series: DAYS14,
  fulfillment: {
    tracked: 12, completed: 8, pending: 2, overdue: 2, onTime: 6, finalOnTime: 7,
    onTimeRate: 0.75, finalOnTimeRate: 0.875, avgSlackMs: 2.3 * 86400000, lateCount: 5,
  },
  quality: { completed: 10, early: 3, onTime: 5, late: 2, cycleSamples: 9, cycleMedianDays: 5.63, cycleP85Days: 12.4 },
  delayBuckets: [
    { bucket: 'dependency', label: '等上游', count: 4, days: 12, tasks: [{ id: 'a1', no: 1, title: '任务 a1' }] },
    { bucket: 'other', label: '其他/未写', count: 7, days: 15.7, tasks: [] },
  ],
  lastRecordAt: NOW - 60 * MIN,
  file: '/x/metrics.jsonl',
}

check('formatDays / formatSlack：0 与 null 不显示 NaN', () => {
  assert.equal(formatDays(5.63), '5.6 天')
  assert.equal(formatDays(12.4), '12 天')
  assert.equal(formatDays(null), '—')
  assert.equal(formatDays('bogus'), '—')
  assert.equal(formatSlack(null), '')
  assert.equal(formatSlack(0), '正好卡在承诺时间')
  assert.equal(formatSlack(2.3 * 86400000), '平均比承诺晚 2.3 天')
  assert.equal(formatSlack(-1.1 * 86400000), '平均比承诺早 1.1 天')
})

check('buildTrend：14 天 → 每天一根 done/created 柱 + 一条 active 折线，几何不越界', () => {
  const trend = buildTrend(STATS)
  assert.equal(trend.hasData, true)
  assert.equal(trend.days, 14)
  assert.equal(trend.bars.done.length, 14)
  assert.equal(trend.bars.created.length, 14)
  assert.equal(trend.line.points.length, 14)
  assert.ok(trend.line.path.startsWith('M'))
  assert.equal(trend.width, TREND_BOX.width)
  assert.equal(trend.height, TREND_BOX.height)
  assert.deepEqual(trend.totals, { done: 91, created: 105, active: 182 })
  assert.equal(trend.ticks.length, 3)
  assert.equal(trend.ticks[0].label, '10-29')
  // 所有柱子都在画布内，且 y + h 落在基线
  const baseline = trend.baseline
  for (const bar of [...trend.bars.done, ...trend.bars.created]) {
    assert.ok(bar.x >= 0 && bar.x + bar.w <= trend.width + 0.01, `柱越界 ${bar.key}`)
    assert.ok(Math.abs(bar.y + bar.h - baseline) < 0.01, `柱底不在基线 ${bar.key}`)
    assert.ok(bar.h >= 0 && bar.h <= baseline)
  }
  for (const point of trend.line.points) {
    assert.ok(point.x >= 0 && point.x <= trend.width, '折线越界')
    assert.ok(point.y >= TREND_BOX.top - 0.01 && point.y <= baseline + 0.01)
  }
})

check('buildTrend：空 / 坏 / 只有 series 的 stats 都给稳定结构', () => {
  for (const bad of [null, undefined, 'x', 42, [], {}, { series: 'nope' }, { series: [null, 1] }]) {
    const trend = buildTrend(bad)
    assert.equal(trend.days, 0)
    assert.deepEqual(trend.bars.done, [])
    assert.equal(trend.line.path, '')
    assert.equal(trend.hasData, false)
    assert.ok(trend.emptyText.includes('历史'))
  }
})

check('buildTrend：全是 0 时不平地起高，max 兜底为 1', () => {
  const trend = buildTrend({ series: [{ day: '2026-11-01', done: 0, created: 0, active: 0 }] })
  assert.equal(trend.max, 1)
  assert.equal(trend.bars.done[0].h, 0)
  assert.equal(trend.bars.created[0].h, 0)
})

check('buildFulfillment：准时率/逾期/追踪中 + 平均富余人话', () => {
  const f = buildFulfillment(STATS, NOW)
  assert.equal(f.hasData, true)
  assert.equal(f.onTimePct, 75)
  assert.equal(f.onTimeText, '75%')
  assert.equal(f.rows.length, 4)
  assert.deepEqual(f.rows.map((row) => row.key), ['tracked', 'completed', 'overdue', 'late'])
  assert.equal(f.overdue, 2)
  assert.equal(f.tracked, 12)
  assert.equal(f.slackText, '平均比承诺晚 2.3 天')
  assert.equal(f.slackDays, 2.3)
  assert.ok(f.ring.dash > 0 && f.ring.dash <= f.ring.circ)
})

check('buildFulfillment：0 样本 → 准时率是 null（不显示 0% 假装有数据）', () => {
  const f = buildFulfillment({ fulfillment: { tracked: 0, completed: 0, onTimeRate: null, avgSlackMs: null } }, NOW)
  assert.equal(f.hasData, false)
  assert.equal(f.onTimeRate, null)
  assert.equal(f.onTimeText, '—')
  assert.equal(f.slackText, '还没有已完成的承诺')
  assert.equal(f.ring.dash, 0)
  assert.ok(f.emptyText.includes('预期完成时间'))
})

check('buildFulfillment：坏形状不崩，字段缺省为 0', () => {
  for (const bad of [null, {}, { fulfillment: 'x' }, { fulfillment: { tracked: 'abc', overdue: -3 } }]) {
    const f = buildFulfillment(bad, NOW)
    assert.equal(typeof f.tracked, 'number')
    assert.equal(f.overdue, 0)
    assert.equal(f.onTimeRate, null)
  }
})

check('buildDelayReasons：按次数倒序 + 平均天数 + 涉及任务截断', () => {
  const d = buildDelayReasons(STATS)
  assert.equal(d.hasData, true)
  assert.deepEqual(d.rows.map((row) => row.label), ['其他/未写', '等上游'])
  assert.equal(d.total, 11)
  assert.equal(d.rows[0].count, 7)
  assert.equal(d.rows[0].avgDays, 2.2, '15.7 / 7 = 2.24 → 2.2')
  assert.equal(d.rows[0].avgDaysText, '2.2 天')
  assert.equal(d.rows[1].tasks.length, 1)
  assert.equal(d.rows[0].pct, 64)
  assert.equal(d.rows[0].ratio, 1)
})

check('buildDelayReasons：空 / 坏输入 → hasData=false + 人话空文案', () => {
  for (const bad of [null, {}, { delayBuckets: 'x' }, { delayBuckets: [{ count: 0 }] }]) {
    const d = buildDelayReasons(bad)
    assert.equal(d.hasData, false)
    assert.deepEqual(d.rows, [])
    assert.ok(d.emptyText.includes('延期'))
  }
})

check('buildQuality：三档百分比和恰好 100 + 中位数/P85 人话', () => {
  const q = buildQuality(STATS)
  assert.equal(q.hasData, true)
  assert.deepEqual(q.segments.map((row) => row.count), [3, 5, 2])
  assert.equal(q.segments.reduce((sum, row) => sum + row.pct, 0), 100)
  assert.equal(q.cycleMedianText, '5.6 天')
  assert.equal(q.cycleP85Text, '12 天')
  assert.equal(q.samplesText, '9 个样本')
})

check('buildQuality：0 样本 → 三档 0%、周期 —、样本不足', () => {
  const q = buildQuality({ quality: { completed: 0, early: 0, onTime: 0, late: 0, cycleSamples: 0, cycleMedianDays: null, cycleP85Days: null } })
  assert.equal(q.hasData, false)
  assert.deepEqual(q.segments.map((row) => row.pct), [0, 0, 0])
  assert.equal(q.cycleMedianText, '—')
  assert.equal(q.cycleP85Text, '—')
  assert.equal(q.samplesText, '样本不足')
})

check('buildQuality：坏形状不崩', () => {
  for (const bad of [null, {}, { quality: 7 }, { quality: { early: 'x', late: -1 } }]) {
    const q = buildQuality(bad)
    assert.equal(Array.isArray(q.segments), true)
    assert.equal(q.segments.length, 3)
  }
})

check('buildHistory：正常回包 → ok:true 且四段都在', () => {
  const h = buildHistory({ ok: true, stats: STATS }, NOW)
  assert.equal(h.ok, true)
  assert.equal(h.hasAnything, true)
  assert.equal(h.trend.days, 14)
  assert.equal(h.fulfillment.onTimePct, 75)
  assert.equal(h.delay.total, 11)
  assert.equal(h.quality.samples, 9)
  assert.equal(h.file, '/x/metrics.jsonl')
})

check('buildHistory：降级判定（缺接口 / 非 200 / 形状怪 / 全空）', () => {
  assert.deepEqual(buildHistory(null), { ok: false, reason: 'bad-shape' })
  assert.deepEqual(buildHistory({ ok: false, error: '404' }), { ok: false, reason: 'failed' })
  assert.deepEqual(buildHistory({ ok: true }), { ok: false, reason: 'bad-shape' })
  assert.deepEqual(buildHistory({ ok: true, stats: { series: [], fulfillment: {}, quality: {}, delayBuckets: [] } }), { ok: false, reason: 'empty' })
  // 只给 series 也算能用（其余面板显示自己的空文案）
  const onlySeries = buildHistory({ ok: true, stats: { series: DAYS14 } }, NOW)
  assert.equal(onlySeries.ok, true)
  assert.equal(onlySeries.trend.days, 14)
  assert.equal(onlySeries.fulfillment.hasData, false)
})

check('buildHistory：裸 stats（没包一层）也认，超大 days 不炸', () => {
  const h = buildHistory(STATS, NOW)
  assert.equal(h.ok, true)
  const big = buildTrend({ series: Array.from({ length: 400 }, (_, i) => ({ day: `d${i}`, done: i % 7, created: i % 5, active: i % 3 })) })
  assert.equal(big.days, 400)
  assert.ok(big.bars.done.every((bar) => bar.w >= 2), '柱宽有下限')
})

/* ---------------- 活跃日历（GitHub 贡献图） ---------------- */

check('buildCalendar：按周分列（周一在上），首列按星期几补空', () => {
  // 2026-11-02 是周一：14 天正好两整周
  const days = Array.from({ length: 14 }, (_, i) => ({ day: new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10), created: 1, started: 0, done: 0, total: i === 13 ? 13 : 1 }))
  const cal = buildCalendar({ days, max: 13 }, NOW)
  assert.equal(cal.weeks.length, 2)
  assert.equal(cal.weeks[0].cells.length, 7)
  assert.equal(cal.weeks[0].cells[0].day, '2026-11-02')
  assert.equal(cal.weeks[1].cells[6].day, '2026-11-15')
  assert.equal(cal.months[0].label, '11 月')
  assert.equal(cal.months.length, 1, '同一个月只标一次')
  assert.equal(cal.total, 14 + 12, '总事件 = 各天相加')
  assert.equal(cal.weeks[1].cells[6].level, 4, '最大那天是最高档')
  assert.equal(cal.activeDays, 14)
})

check('buildCalendar：首日不是周一时，前面留空而不是整体错位', () => {
  // 2026-11-04 是周三
  const days = [{ day: '2026-11-04', total: 2, done: 2 }, { day: '2026-11-05', total: 0 }]
  const cal = buildCalendar({ days, max: 2 }, NOW)
  assert.equal(cal.weeks.length, 1)
  assert.equal(cal.weeks[0].cells[0], null, '周一空着')
  assert.equal(cal.weeks[0].cells[2].day, '2026-11-04', '周三落在第 3 行')
  assert.equal(cal.weeks[0].cells[2].level, 4)
  assert.equal(cal.weeks[0].cells[3].level, 0, '0 件是空格子')
})

check('buildCalendar：没有数据 / 坏数据不崩', () => {
  assert.equal(buildCalendar(null, NOW).empty, true)
  assert.equal(buildCalendar({ days: [] }, NOW).empty, true)
  const bad = buildCalendar({ days: [{ day: '2026-11-04', total: 'x' }, null, { day: '' }] }, NOW)
  assert.equal(bad.weeks.length, 1)
})

check('calendarFromTasks：直接按任务时间戳归日，窗口天数正确', () => {
  const day = 86_400_000
  const base = startOfDay(NOW)
  const tasks = [
    { id: 'a', createdAt: base - 2 * day + 3600_000, completedAt: base - 2 * day + 7200_000 },
    { id: 'b', createdAt: base - 2 * day + 9000_000 },
    { id: 'c', completedAt: base - 5 * day + 1000, startedAt: base - 5 * day + 2000 },
    { id: 'd', createdAt: 0, completedAt: 0 },
  ]
  const cal = calendarFromTasks(tasks, NOW, 7)
  const all = cal.weeks.flatMap((week) => week.cells).filter(Boolean)
  assert.equal(all.length, 7, '7 天就是 7 个格子（跨几列由星期几决定）')
  assert.equal(cal.max, 3, '同一天 3 个事件是最大档')
  const cells = all
  const today = cells[cells.length - 1]
  const twoDaysAgo = cells[cells.length - 3]
  const fiveDaysAgo = cells[cells.length - 6]
  assert.equal(twoDaysAgo.total, 3, '新建 2 + 完成 1')
  assert.equal(fiveDaysAgo.total, 2, '完成 1 + 开工 1')
  assert.equal(today.total, 0)
  assert.equal(cal.total, 5)
})

check('calendarFromTasks：坏任务 / 空列表不崩', () => {
  assert.equal(calendarFromTasks([], NOW, 30).weeks.length > 0, true, '空列表也要有网格')
  assert.equal(calendarFromTasks([null, {}, { createdAt: 'x' }], NOW, 7).total, 0)
})
check('calendarHints：周对比 / 最忙一天 / 最近动静（最多 3 条）', () => {
  const day = 86_400_000
  const base = startOfDay(NOW)
  const tasks = [
    { id: 'a', completedAt: base - 1 * day + 1000, project: '项目A', workspaceTitle: '项目A' },
    { id: 'b', completedAt: base - 2 * day + 1000, project: '项目A', workspaceTitle: '项目A' },
    { id: 'c', completedAt: base - 8 * day + 1000, project: '项目B', workspaceTitle: '项目B' },
  ]
  const cal = calendarFromTasks(tasks, NOW, 30)
  const hints = calendarHints(tasks, NOW, cal)
  const texts = hints.map((hint) => hint.text).join(' | ')
  assert.ok(texts.includes('本周完成 2 件'), texts)
  assert.ok(texts.includes('上周 1 件'), texts)
  assert.ok(texts.includes('最忙'), texts)
  assert.ok(/最近一次动静|连续 \d+ 天/.test(texts), texts)
  assert.ok(hints.length <= 3, '最多 3 条，别把卡片撑爆')
})

check('calendarHints：没有日历数据时也能给出周对比 + 完成最多的项目', () => {
  const base = startOfDay(NOW)
  const hints = calendarHints([{ id: 'x', completedAt: base - 1000, project: '项目C', workspaceTitle: '项目C' }], NOW, null)
  const texts = hints.map((hint) => hint.text).join(' | ')
  assert.ok(texts.includes('本周完成 1 件'), texts)
  assert.ok(texts.includes('完成最多：项目C'), texts)
})

/* ---------------- 收尾 ---------------- */

console.log('')
if (failed.length) {
  console.log(`insightView.mjs: ${passed} passed, ${failed.length} failed`)
  process.exitCode = 1
} else {
  console.log(`insightView.mjs: ${passed} passed, 0 failed`)
}
