/**
 * behavior.js 行为档案测试（仅测公开契约，不 mock 内部实现）。
 *
 * 用例编号与 PLAN-insight-lenses §9.6 对齐：
 *   ① 空数据门槛：text 为空、四个信号全部进 gaps
 *   ② 单任务：每个信号 n <= 1，全部进 gaps
 *   ③ 固定 fixture：周节奏 / 进出台账 / WIP 分位 / lead 分位 + 四行顺序
 *   ④ 时区边界：本地 23:59 算当天，00:01 算次日
 *   ⑤ 脏数据：null / NaN / 缺 title / 重复 id 不抛错
 *   ⑥ 确定性：同一输入两次 JSON 相等，且不依赖 Date.now
 */

import assert from 'node:assert/strict'

const DAY_MS = 86_400_000
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

let buildBehaviorProfile
try {
  const mod = await import('../behavior.js')
  buildBehaviorProfile = mod.buildBehaviorProfile ?? mod.default
} catch (error) {
  console.error('模块未就绪：behavior.js 无法加载 — ' + error.message)
  process.exit(1)
}
if (typeof buildBehaviorProfile !== 'function') {
  console.error('模块未就绪：behavior.js 没有导出 buildBehaviorProfile')
  process.exit(1)
}

const stamp = (date) => date.getTime()
const dayKey = (date) => {
  const pad = (n) => String(n).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/* 固定 fixture：2025-05-25（周日）12:00 为 now，4 个自然周内 20 条完成。 */
const NOW = stamp(new Date(2025, 5, 1, 12, 0))
/* 4 个周一：4/28、5/5、5/12、5/19 */
const WEEKS = [
  new Date(2025, 3, 28),
  new Date(2025, 4, 5),
  new Date(2025, 4, 12),
  new Date(2025, 4, 19),
]
const DOW_OFFSET = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 }
const COMPLETION_SPEC = [
  [4, 8], // 周四 8
  [5, 5], // 周五 5
  [2, 3], // 周二 3
  [3, 2], // 周三 2
  [0, 1], // 周日 1
  [1, 1], // 周一 1
]

function buildFixture() {
  const tasks = []
  let seq = 0
  for (const [dow, count] of COMPLETION_SPEC) {
    for (let i = 0; i < count; i += 1) {
      const week = WEEKS[i % WEEKS.length]
      const completedAt = stamp(new Date(
        week.getFullYear(),
        week.getMonth(),
        week.getDate() + DOW_OFFSET[dow],
        9 + Math.floor(i / WEEKS.length),
        0,
      ))
      seq += 1
      tasks.push({ id: 'f' + seq, title: 'fixture-' + seq, completedAt })
    }
  }
  /* lead：前 10 条 2 天，接着 5 条 4 天（其余 5 条无 firstSeenAt，不计入 lead）。 */
  tasks.forEach((task, index) => {
    if (index < 10) task.firstSeenAt = task.completedAt - 2 * DAY_MS
    else if (index < 15) task.firstSeenAt = task.completedAt - 4 * DAY_MS
  })
  /* 10 天 WIP 快照，wip 依次 0..9（含今天）。 */
  const metricsByDay = {}
  for (let value = 0; value < 10; value += 1) {
    const day = new Date(2025, 4, 25 - (9 - value))
    metricsByDay[dayKey(day)] = { wip: value }
  }
  return { tasks, metricsByDay }
}

const results = []
function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error })
  }
}

const makeProfile = (extra = {}) => buildBehaviorProfile({
  tasks: [],
  metricsByDay: {},
  now: NOW,
  ...extra,
})

/* ① 空数据 */
check('① 空数据：text 为空、八信号全部进 gaps、sampleDays=0', () => {
  const profile = makeProfile()
  assert.equal(profile.text, '')
  assert.equal(profile.windowDays, 84)
  assert.equal(profile.sampleDays, 0)
  assert.deepEqual([...profile.gaps].sort(), ['baseline', 'deadline', 'flow', 'lead', 'promise', 'switching', 'weekday', 'wip'])
  for (const id of ['weekday', 'flow', 'wip', 'lead', 'promise', 'deadline', 'switching']) {
    assert.equal(profile.signals[id].n, 0, 'signals.' + id + '.n')
  }
  assert.deepEqual(profile.baseline.items, [])
  assert.equal(profile.signals.weekday.counts.length, 0)
  /* flow 固定 8 个自然周：空数据也返回 8 个全零桶，但 n=0 所以进 gaps。 */
  assert.equal(profile.signals.flow.weeks.length, 8)
  assert.ok(profile.signals.flow.weeks.every((week) => week.created === 0 && week.done === 0 && week.net === 0))
})

/* ② 单任务 */
check('② 单任务：各信号 n <= 1 且全部进 gaps', () => {
  const profile = buildBehaviorProfile({
    tasks: [{ id: 'only', title: 'only', completedAt: stamp(new Date(2025, 4, 22, 10, 0)) }],
    metricsByDay: {},
    now: NOW,
  })
  assert.equal(profile.text, '')
  assert.deepEqual([...profile.gaps].sort(), ['baseline', 'deadline', 'flow', 'lead', 'promise', 'switching', 'weekday', 'wip'])
  for (const id of ['weekday', 'flow', 'wip', 'lead', 'promise', 'deadline', 'switching']) {
    assert.ok(profile.signals[id].n <= 1, 'signals.' + id + '.n = ' + profile.signals[id].n)
  }
})

/* ③ 固定 fixture */
const fixture = buildFixture()

check('③a 周节奏：dow 计数与降序（同次数按 dow 升序）', () => {
  const { weekday } = makeProfile({ ...fixture }).signals
  assert.equal(weekday.n, 20)
  assert.deepEqual(
    weekday.counts.map((row) => [row.dow, row.label, row.count]),
    [[4, '四', 8], [5, '五', 5], [2, '二', 3], [3, '三', 2], [0, '日', 1], [1, '一', 1]],
  )
})

check('③b 进出台账：8 个周一起点的桶、net=created-done、合计正确', () => {
  const { flow } = makeProfile({ ...fixture }).signals
  assert.equal(flow.weeks.length, 8)
  assert.equal(flow.n, 20) // 去重后的任务数：15 条有 firstSeen + 20 条完成，reunion 为 20
  for (const week of flow.weeks) {
    const start = new Date(week.weekStart)
    assert.equal(start.getDay(), 1, 'weekStart 必须是周一')
    assert.equal(start.getHours(), 0)
    assert.equal(start.getMinutes(), 0)
    assert.equal(week.net, week.created - week.done)
  }
  assert.equal(flow.weeks.reduce((sum, w) => sum + w.created, 0), 15)
  assert.equal(flow.weeks.reduce((sum, w) => sum + w.done, 0), 20)
})

check('③c WIP：nearest-rank p50/p85（10 天 0..9）', () => {
  const { wip } = makeProfile({ ...fixture }).signals
  assert.equal(wip.n, 10)
  assert.equal(wip.p50, 4) // nearest-rank：rank=ceil(10*0.5)=5 → sorted[4]
  assert.equal(wip.p85, 8) // rank=ceil(10*0.85)=9 → sorted[8]
})

check('③d lead：nearest-rank 且保留 1 位小数（10×2 天 + 5×4 天）', () => {
  const { lead } = makeProfile({ ...fixture }).signals
  assert.equal(lead.n, 15)
  assert.equal(lead.p50, 2) // sorted[Math.floor(15*0.5)] = sorted[7]
  assert.equal(lead.p85, 4) // sorted[Math.floor(15*0.85)] = sorted[12]
})

check('③e text 四行齐全且顺序固定', () => {
  const profile = makeProfile({ ...fixture })
  const lines = profile.text.split('\n')
  assert.equal(lines.length, 4)
  assert.equal(lines[0], '周节奏（8 周，n=20）：四 8 / 五 5 / 二 3 / 三 2 / 日 1 / 一 1')
  const flowMatch = /^进出台账（8 周）：新增 (.+)；完成 (.+)；净积压 (.+)$/.exec(lines[1])
  assert.ok(flowMatch, 'flow 行格式：' + lines[1])
  assert.deepEqual(flowMatch[1].split('/').map(Number), profile.signals.flow.weeks.map((w) => w.created))
  assert.deepEqual(flowMatch[2].split('/').map(Number), profile.signals.flow.weeks.map((w) => w.done))
  assert.deepEqual(flowMatch[3].split('/').map(Number), profile.signals.flow.weeks.map((w) => w.net))
  assert.equal(lines[2], '在跑（n=10 天）：中位 4，85 分位 8')
  assert.equal(lines[3], '进列表→收口（n=15）：中位 2 天，85 分位 4 天')
  /* 这份 fixture 没有 ETA / 项目 / 足够周数：新信号全部进 gaps，不占行 */
  assert.deepEqual(profile.gaps, ['promise', 'deadline', 'switching', 'baseline'])
  const order = ['周节奏', '进出台账', '在跑', '进列表→收口'].map((label) => profile.text.indexOf(label))
  assert.ok(order.every((index) => index >= 0), '四行都要出现')
  assert.deepEqual([...order].sort((a, b) => a - b), order, '顺序必须是 周节奏 → 进出台账 → 在跑 → 进列表→收口')
})

/* ④ 时区边界（本地时间构造） */
check('④ 时区：本地 23:59 算当天、00:01 算次日', () => {
  const late = stamp(new Date(2025, 4, 22, 23, 59)) // 周四 23:59
  const early = stamp(new Date(2025, 4, 23, 0, 1)) // 周五 00:01
  const { weekday } = buildBehaviorProfile({
    tasks: [
      { id: 'late', title: 'late', completedAt: late },
      { id: 'early', title: 'early', completedAt: early },
    ],
    metricsByDay: {},
    now: NOW,
  }).signals
  assert.equal(weekday.n, 2)
  const byDow = Object.fromEntries(weekday.counts.map((row) => [row.dow, row.count]))
  assert.equal(byDow[4], 1, '23:59 应计入周四')
  assert.equal(byDow[5], 1, '00:01 应计入周五')
  assert.equal(Object.keys(byDow).length, 2)
  /* 同时验证本地日切：两个时刻在本地时间上必须分属两天。 */
  assert.equal(new Date(late).getDay(), 4)
  assert.equal(new Date(early).getDay(), 5)
})

/* ⑤ 脏数据 */
check('⑤ 脏数据：null / NaN / 缺 title / 重复 id 不抛错', () => {
  const profile = buildBehaviorProfile({
    tasks: [
      null,
      'not-a-task',
      {},
      { id: 'dup', title: '第一次', completedAt: stamp(new Date(2025, 4, 20, 10, 0)), startedAt: null },
      { id: 'dup', title: '重复 id', completedAt: stamp(new Date(2025, 4, 21, 10, 0)) },
      { id: 'nan', completedAt: Number.NaN, firstSeenAt: 'oops' },
      { id: 'missing-title', completedAt: stamp(new Date(2025, 4, 22, 10, 0)) },
      { id: 'nulls', title: null, completedAt: null, firstSeenAt: Number.NaN, startedAt: null },
      { id: 'neg', completedAt: -1, firstSeenAt: -2 },
    ],
    metricsByDay: { 'bad-key': { wip: 'x' }, '2025-05-01': null },
    now: NOW,
    ignoreWords: undefined,
  })
  assert.equal(typeof profile, 'object')
  for (const id of ['weekday', 'flow', 'wip', 'lead', 'promise', 'deadline', 'switching']) {
    assert.ok(Number.isFinite(profile.signals[id].n), 'signals.' + id + '.n 应有限')
  }
  /* 无法解析的 metricsByDay key 不参与统计（'bad-key' 必须被丢弃）。 */
  assert.equal(profile.signals.wip.n, 0, 'null / 坏 key 的快照不参与 WIP 统计')
})

/* ⑥ 确定性 */
check('⑥ 确定性：同输入两次 JSON 相等，且不调用 Date.now', () => {
  const input = { ...fixture, now: NOW }
  const first = JSON.stringify(buildBehaviorProfile(input))
  const second = JSON.stringify(buildBehaviorProfile(input))
  assert.equal(first, second)

  const originalNow = Date.now
  Date.now = () => {
    throw new Error('behavior.js 不允许调用 Date.now')
  }
  try {
    assert.equal(JSON.stringify(buildBehaviorProfile(input)), first)
  } finally {
    Date.now = originalNow
  }
})

/* ⑦ 打包白名单：根目录模块不会被 packageFiles.mjs 扫到，必须自己钉住 */
check('⑦ package.json files 含 behavior.js（否则装进 profile 后 import 失败）', async () => {
  const { readFile } = await import('node:fs/promises')
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('behavior.js'), 'package.json files 缺 behavior.js')
})

/* ⑧ 承诺兑现 / deadline 挤压（自带 ETA 的 fixture） */
const NOW2 = stamp(new Date(2025, 5, 1, 12, 0))
const doneAt = (m, d, h = 10) => stamp(new Date(2025, m, d, h, 0))
function promiseFixture() {
  const tasks = []
  for (let i = 0; i < 6; i += 1) {
    tasks.push({ id: 'early' + i, title: 'e', workspaceTitle: 'P', firstSeenAt: doneAt(4, 18), completedAt: doneAt(4, 20) + i * 60_000, expectedAt: doneAt(4, 22) })
  }
  for (let i = 0; i < 3; i += 1) {
    tasks.push({ id: 'on' + i, title: 'o', workspaceTitle: 'P', firstSeenAt: doneAt(4, 19), completedAt: doneAt(4, 21), expectedAt: doneAt(4, 21) })
  }
  for (let i = 0; i < 3; i += 1) {
    tasks.push({ id: 'late' + i, title: 'l', workspaceTitle: 'P', firstSeenAt: doneAt(4, 21), completedAt: doneAt(4, 23), expectedAt: doneAt(4, 22) })
  }
  for (let i = 0; i < 2; i += 1) {
    tasks.push({ id: 'noeta' + i, title: 'n', workspaceTitle: 'P', firstSeenAt: doneAt(4, 19), completedAt: doneAt(4, 20) })
  }
  return tasks
}

check('⑧ 承诺兑现/deadline 挤压：提前 6 / 准时 3 / 延期 3，24h 内 25%', () => {
  const profile = buildBehaviorProfile({ tasks: promiseFixture(), metricsByDay: {}, now: NOW2 })
  const { promise, deadline } = profile.signals
  assert.equal(promise.n, 12)
  assert.equal(promise.early, 6)
  assert.equal(promise.onTime, 3)
  assert.equal(promise.late, 3)
  assert.equal(promise.doneWithoutEta, 2)
  assert.equal(promise.doneTotal, 14)
  assert.equal(deadline.n, 12)
  assert.equal(deadline.p50, 0) // nearest-rank：12 个样本里第 6 名（恰好 0 = 准时）
  assert.equal(deadline.p85, 2)
  assert.equal(deadline.withinDay, 3)
  assert.equal(deadline.share, 25)
  assert.match(profile.text, /预期兑现（n=12）：提前 6 \/ 准时 3 \/ 延期 3；完成但没设预期 2\/14/)
  assert.match(profile.text, /deadline 挤压（n=12）：中位提前 0 天，85 分位提前 2 天；截止前 24h 内完成 25%/)
})

/* ⑨ 跨项目切换：6 个有活动的周，项目数 [1,2,3,2,4,2] */
check('⑨ 跨项目切换：每周中位 2 个、最多 4 个', () => {
  const tasks = []
  const mondays = [new Date(2025, 3, 14), new Date(2025, 3, 21), new Date(2025, 3, 28), new Date(2025, 4, 5), new Date(2025, 4, 12), new Date(2025, 4, 19)]
  const counts = [1, 2, 3, 2, 4, 2]
  mondays.forEach((monday, wi) => {
    for (let i = 0; i < counts[wi]; i += 1) {
      tasks.push({ id: 's' + wi + '-' + i, title: 'x', workspaceTitle: 'P' + i, firstSeenAt: monday.getTime() + 3_600_000 })
    }
  })
  const { switching } = buildBehaviorProfile({ tasks, metricsByDay: {}, now: NOW2 }).signals
  assert.equal(switching.n, 6)
  assert.equal(switching.p50, 2)
  assert.equal(switching.max, 4)
})

/* ⑩ 基线：近 4 周 vs 前 4 周 */
check('⑩ 基线：完成 6→6、不延期率 33%→83%', () => {
  const tasks = []
  const add = (id, done, late) => tasks.push({
    id, title: id, workspaceTitle: 'P',
    firstSeenAt: done - 2 * DAY_MS,
    completedAt: done,
    expectedAt: done + (late ? -1 : 1) * DAY_MS,
  })
  /* 月份是 0 基：2=3 月、3=4 月、4=5 月；前 4 周 = 3/31–4/27，近 4 周 = 4/28–5/25 */
  const prior = [[2, 31], [3, 2], [3, 8], [3, 9], [3, 15], [3, 22]]
  const recent = [[3, 28], [3, 29], [4, 6], [4, 13], [4, 20], [4, 21]]
  /* 前 4 周：6 条里 4 条延期、2 条不延期（33%）；近 4 周：6 条里 1 条延期（83%） */
  prior.forEach(([m, d], i) => add('p' + i, doneAt(m, d), i >= 2))
  recent.forEach(([m, d], i) => add('r' + i, doneAt(m, d), i >= 5))
  const profile = buildBehaviorProfile({ tasks, metricsByDay: {}, now: NOW2 })
  assert.equal(profile.baseline.recent.done, 6)
  assert.equal(profile.baseline.prior.done, 6)
  assert.equal(profile.baseline.prior.notLate.pct, 33)
  assert.equal(profile.baseline.recent.notLate.pct, 83)
  assert.ok(profile.baseline.items.includes('完成 6→6'), profile.baseline.items.join(' | '))
  assert.ok(profile.baseline.items.includes('不延期率 33%→83%'), profile.baseline.items.join(' | '))
  assert.match(profile.text, /基线（近 4 周 vs 前 4 周）：/)
})

/* ⑪ 薄样本：承诺样本 4 条 → 不出行、进 gaps */
check('⑪ 薄样本：承诺样本 4 条不进 text', () => {
  const tasks = promiseFixture().slice(0, 4)
  const profile = buildBehaviorProfile({ tasks, metricsByDay: {}, now: NOW2 })
  assert.equal(profile.signals.promise.n, 4)
  assert.ok(profile.gaps.includes('promise'))
  assert.equal(profile.text.includes('预期兑现'), false)
})

/* ⑫ 基线不含「本周」：周一早上不再出现假下降 */
check('⑫ 基线：当前周不计入，近 4 周 vs 前 4 周都是完整周', () => {
  const now = stamp(new Date(2025, 5, 2, 9, 0)) // 周一
  const tasks = []
  const mondays = [new Date(2025, 3, 7), new Date(2025, 3, 14), new Date(2025, 3, 21), new Date(2025, 3, 28), new Date(2025, 4, 5), new Date(2025, 4, 12), new Date(2025, 4, 19), new Date(2025, 4, 26)]
  mondays.forEach((monday, wi) => {
    for (let i = 0; i < 3; i += 1) {
      tasks.push({ id: 'w' + wi + '-' + i, title: 'x', completedAt: monday.getTime() + 2 * DAY_MS + i * 60_000 })
    }
  })
  /* 今天（本周一）再来 1 条：不能把 recent 的完整 4 周稀释成 3 周 */
  tasks.push({ id: 'today', title: 'today', completedAt: now })
  const { baseline, signals } = buildBehaviorProfile({ tasks, metricsByDay: {}, now })
  assert.equal(baseline.recent.done, 12)
  assert.equal(baseline.prior.done, 12)
  assert.ok(baseline.items.includes('完成 12→12'), baseline.items.join(' | '))
  assert.equal(signals.flow.weeks.length, 8)
})

/* ⑬ 切换按事件归周：跨周任务两周都算「碰过」 */
check('⑬ 切换：跨周任务两周都计；未归属项目不计', () => {
  const now = stamp(new Date(2025, 5, 1, 12, 0))
  const tasks = [
    { id: 'span', title: 'span', workspaceTitle: 'P', firstSeenAt: stamp(new Date(2025, 4, 6, 10, 0)), completedAt: stamp(new Date(2025, 4, 20, 10, 0)) },
    { id: 'loose', title: 'loose', firstSeenAt: stamp(new Date(2025, 4, 7, 10, 0)), completedAt: stamp(new Date(2025, 4, 8, 10, 0)) },
  ]
  const { switching } = buildBehaviorProfile({ tasks, metricsByDay: {}, now }).signals
  /* 5/5 周（span 出现 + loose）+ 5/19 周（span 完成）= 2 个活动周，每周 1 个项目 */
  assert.equal(switching.n, 2)
  assert.equal(switching.max, 1)
})

/* ⑭ 进出台账/周节奏不含本周；完成早于首次观察的样本全局丢弃 */
check('⑭ 本周不计入 flow/weekday；远端完成回声进 discarded', () => {
  const now = stamp(new Date(2025, 5, 1, 12, 0))
  const profile = buildBehaviorProfile({
    tasks: [
      { id: 'now', title: 'now', completedAt: now },
      { id: 'next', title: 'next', completedAt: now + DAY_MS },
      { id: 'echo', title: 'echo', firstSeenAt: stamp(new Date(2025, 4, 20, 10, 0)), completedAt: stamp(new Date(2025, 4, 19, 10, 0)) },
    ],
    metricsByDay: {},
    now,
  })
  assert.equal(profile.signals.flow.weeks.reduce((sum, week) => sum + week.done, 0), 0)
  assert.equal(profile.signals.weekday.n, 0)
  assert.equal(profile.discarded.completedBeforeFirstSeen, 1)
  assert.equal(profile.signals.promise.n, 0)
})

/* ⑮ 周节奏与进出台账同窗：超出 8 周的完成不进 weekday */
check('⑮ 周节奏不含 8 周窗口之外的完成', () => {
  const now = stamp(new Date(2025, 5, 1, 12, 0))
  const profile = buildBehaviorProfile({
    tasks: [{ id: 'old', title: 'old', completedAt: stamp(new Date(2025, 2, 20, 10, 0)) }], // 3/20：在 84 天窗口内、但在 8 周桶之前
    metricsByDay: {},
    now,
  })
  assert.equal(profile.signals.weekday.n, 0)
  assert.equal(profile.sampleDays > 0, true)
})

/* 汇总 */
const failed = results.filter((item) => !item.ok)
for (const item of results) {
  if (item.ok) console.log('ok   ' + item.name)
  else console.error('FAIL ' + item.name + '\n     ' + (item.error && item.error.message))
}
console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed, ' + results.length + ' total')
if (failed.length) process.exitCode = 1
