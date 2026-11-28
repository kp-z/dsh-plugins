import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createTodayInsight } from '../src/client/TodayInsight.js'
import { renderMarkdown } from '../src/client/markdown.js'
import { buildThemeRiver } from '../src/client/themeRiver.js'

const styles = await readFile(new URL('../src/client/dashboardStyles.js', import.meta.url), 'utf8')
const panel = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const feature = await readFile(new URL('../src/client/InsightFeature.js', import.meta.url), 'utf8')
assert.match(panel, /import\('\/dsh-cove-task\/tasks\/src\/TodayInsight\.js'\)/)
/* 总览顶部的结论卡 = 同一个组件，只是宽形态；诊断/轮询不再由 InsightFeature 自己维护一份。 */
assert.match(feature, /createTodayInsight/, '总览顶部用同一个洞察组件')
assert.match(feature, /variant: 'dashboard'/, '总览用宽形态')
assert.doesNotMatch(feature, /insightDiagnose|insightAi/, '生成与轮询只活在 TodayInsight 里')
assert.doesNotMatch(panel, /function (renderInsightCharts|wireInsight|pollInsightAI)\(/)

let current
const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState(initial) {
    const slot = current.slot(() => ({ value: typeof initial === 'function' ? initial() : initial }))
    return [slot.value, (value) => { slot.value = typeof value === 'function' ? value(slot.value) : value }]
  },
  useRef: (value) => current.slot(() => ({ current: value })),
  useEffect(effect, deps) {
    const slot = current.slot(() => ({}))
    if (slot.deps?.every((item, index) => Object.is(item, deps[index])) && deps.length === slot.deps.length) return
    slot.cleanup?.()
    slot.deps = deps
    slot.cleanup = effect()
  },
}
function mount(Component) {
  const slots = []
  return (props) => {
    let index = 0
    current = { slot: (init) => (slots[index] ||= init(), slots[index++]) }
    return Component(props)
  }
}
function walk(tree, visit) {
  if (Array.isArray(tree)) { for (const item of tree) walk(item, visit); return }
  if (!tree || typeof tree !== 'object') return
  visit(tree)
  for (const child of tree.children || []) walk(child, visit)
}
function find(tree, predicate) {
  let hit = null
  walk(tree, (node) => { if (!hit && predicate(node)) hit = node })
  return hit
}
function count(tree, predicate) {
  let total = 0
  walk(tree, (node) => { if (predicate(node)) total += 1 })
  return total
}
const classOf = (node) => String(node.props.className || '')
const labeled = (label) => (node) => node.props['aria-label'] === label
const byText = (text) => (node) => node.type === 'button' && node.children[0] === text
const summaryNode = (node) => node.type?.name === 'Summary'
const summaryOf = (tree) => find(tree, summaryNode)
/* 生成/更新按钮固定在卡片右下角的 .fd-today-foot 里 */
const generateOf = (tree) => {
  const foot = find(tree, (node) => classOf(node) === 'fd-today-foot')
  return foot ? find(foot, isGenerateButton) : null
}
const isGenerateButton = (node) => node.type === 'button' && /^(生成|更新|重新生成|生成中)/.test(String(node.children[0] || ''))
const wait = () => new Promise((resolve) => setImmediate(resolve))
const stored = new Map()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, text) => stored.set(key, text),
  removeItem: (key) => stored.delete(key),
} })

const TodayInsight = createTodayInsight({ React })
const renderCard = mount(TodayInsight)
const api = {
  insight: async () => ({ results: { morning: { summary: '原始早会摘要' }, diagnose: { summary: '原始诊断摘要' } } }),
  insightDiagnose: async () => ({ started: false, jobId: 42, reason: '已经在跑了' }),
  insightAi: () => { throw new Error('another entry’s job must not be polled') },
}
const props = { api, tasks: [] }

/* ---- 侧栏形态：头行（含 tabs）/ 天气 / 摘要 + 图表两栏，没有展开详情 ---- */
renderCard(props)
await wait()
let tree = renderCard(props)
const firstTab = summaryOf(tree)
assert.equal(firstTab.props.id, 'diagnose', '默认落在诊断')
assert.equal(firstTab.props.original, '原始诊断摘要')
assert.equal(find(tree, (node) => node.type === 'button' && node.props['aria-pressed'] === true).children[0], '诊断', '诊断 tab 是选中态')

const head = find(tree, (node) => classOf(node) === 'fd-today-head')
const tabsBox = find(tree, (node) => classOf(node) === 'fd-today-tabs')
assert.ok(head, '头行在')
assert.ok(tabsBox && find(head, (node) => classOf(node) === 'fd-today-tabs'), 'tabs 在头行内（与标题同一行、靠右）')
assert.equal(count(tabsBox, isGenerateButton), 0, 'tabs 容器里没有生成按钮')
assert.ok(generateOf(tree), '生成按钮在摘要操作行')
assert.equal(generateOf(tree).children[0], '更新', '当前 tab 有结论 → 更新')
assert.match(generateOf(tree).props['aria-label'], /^更新：诊断$/)

assert.equal(count(tree, (node) => classOf(node).includes('fd-today-chart')), 1, '侧栏只有一张图')
assert.equal(find(tree, byText('展开详情 ↓')), null, '不再有展开详情')
assert.equal(find(tree, (node) => classOf(node).includes('fd-ins')), null, '侧栏不渲染宽形态骨架')
const sideHead = find(tree, (node) => classOf(node) === 'fd-today-head')
assert.ok(find(sideHead, (node) => classOf(node) === 'fd-today-avatar-img'), '头像仍是原来那张')
const weatherInline = find(sideHead, (node) => classOf(node).includes('fd-today-weather-inline'))
assert.ok(weatherInline, '展开时天气在 title 行')
assert.ok(find(weatherInline, (node) => classOf(node).includes('fd-weather-scene')), '天气图标用和宽卡一致的动画）')

/* 摘要与图表同一行（grid 两列），窄容器下堆叠：结构 + 样式两头钉住 */
const body = find(tree, (node) => classOf(node) === 'fd-today-body')
assert.ok(body, '侧栏正文容器在')
const bodyChildren = body.children.map((child) => String((child && child.props && child.props.className) || ''))
assert.ok(bodyChildren.includes('fd-today-summary') && bodyChildren.includes('fd-today-chart'), `正文两栏是摘要 + 图表，实际 ${bodyChildren}`)
assert.match(styles, /\.fd-today-body \{[^}]*display: grid[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/, '侧栏正文是两列栅格')
assert.match(styles, /@container fdtoday \(max-width: 560px\) \{[^}]*\.fd-today-body[^{]*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/, '窄于 560px 时堆叠成一列')
assert.match(styles, /\.fd-today-split \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/, '宽屏形态也走同一套两栏规则')
assert.match(styles, /\.fd-today-split \{[^}]*align-items: stretch/, '摘要与图表等高')
assert.match(styles, /\.fd-today-editor \{[^}]*flex: 1 1 auto/, '输入框撑满摘要列')

/* 折叠：只剩头一行（tabs 一起收起） */
find(tree, byText('今日洞察')).props.onClick()
tree = renderCard(props)
assert.ok(find(tree, (node) => classOf(node) === 'fd-panel fd-today is-collapsed'), '折叠态在')
assert.equal(summaryOf(tree), null, '折叠后只剩头行')
assert.equal(find(tree, (node) => classOf(node) === 'fd-today-tabs'), null, '折叠时不渲染 tabs')
find(tree, byText('今日洞察')).props.onClick()
tree = renderCard(props)
assert.equal(find(tree, (node) => classOf(node).includes('is-collapsed')), null, '再点一次展开')

find(tree, byText('早会同步')).props.onClick()
tree = renderCard(props)
const morning = summaryOf(tree)
assert.equal(morning.props.original, '原始早会摘要')
assert.equal(generateOf(tree).props['aria-label'], '更新：早会同步', '生成只作用于当前 tab')
find(tree, byText('诊断')).props.onClick()
tree = renderCard(props)
assert.equal(summaryOf(tree).props.original, '原始诊断摘要')
await generateOf(tree).props.onClick()
assert.ok(find(renderCard(props), (node) => node.props.role === 'status' && node.children[0] === '已经在跑了'))

/* ---- 宽形态：沿用 fd-ins 骨架，tabs 同样在头行、生成按钮同样在摘要下方 ---- */
const renderDash = mount(TodayInsight)
renderDash({ api, tasks: [], variant: 'dashboard' })
await wait()
const dash = renderDash({ api, tasks: [], variant: 'dashboard' })
assert.ok(find(dash, (node) => classOf(node) === 'fd-ins'), '宽形态用 fd-ins 骨架')
const mdSummary = mount(summaryOf(dash).type)({ id: 'markdown-demo', original: '# 标题\n\n- 列表' })
/* 主题河流：近 14 天按项目的新增，样本不足只给空态 */
const riverNow = Date.parse('2026-11-28T12:00:00+08:00')
const river = buildThemeRiver([
  { createdAt: riverNow - 60_000, project: 'Qvi' },
  { createdAt: riverNow - 60_000, project: 'Qvi' },
  { createdAt: riverNow - 3 * 86_400_000, project: 'Pay' },
  { createdAt: riverNow - 5 * 86_400_000, listName: 'Inbox' },
], riverNow)
assert.equal(river.samples, 4, '河流图取近 14 天新增样本')
assert.equal(river.dates.length, 14, '时间轴 14 天')
assert.ok(river.categories.includes('Qvi'), '按项目分带')
assert.equal(river.rows.length, river.dates.length * river.categories.length, '每天每类一个点')
assert.equal(buildThemeRiver([], riverNow).samples, 0, '没有新增就是空样本')
/* 真实项目名叫「其他」时，合并带不能用同名（ECharts 会并成一类） */
const riverOther = buildThemeRiver([
  { createdAt: riverNow, project: '其他' },
  { createdAt: riverNow, project: '其他' },
  { createdAt: riverNow, project: '其他' },
  { createdAt: riverNow, project: 'A' },
  { createdAt: riverNow, project: 'B' },
  { createdAt: riverNow, project: 'C' },
], riverNow)
assert.equal(new Set(riverOther.categories).size, riverOther.categories.length, '河流图类别名唯一')
assert.ok(riverOther.categories.some((name) => name.startsWith('其他') && name !== '其他'), '合并带改名避免撞车')
/* 回归：东八区 00:30 不能因为 toISOString 把日期算成前一天 */
const tzNow = Date.parse('2026-11-28T00:30:00+08:00')
const tzRiver = buildThemeRiver([{ createdAt: tzNow, project: 'TZ' }], tzNow)
const tzDate = new Date(tzNow)
const tzLabel = tzDate.getFullYear() + '-' + String(tzDate.getMonth() + 1).padStart(2, '0') + '-' + String(tzDate.getDate()).padStart(2, '0')
assert.equal(tzRiver.dates[tzRiver.dates.length - 1], tzLabel, '时间轴用本地日期，不被 UTC 截断')
assert.ok(find(dash, (node) => classOf(node) === 'fd-rail-flow-empty'), '样本不足时河流给空态')
assert.ok(find(mdSummary, (node) => classOf(node) === 'fd-today-md'), '摘要带 Markdown 预览层')
assert.ok(find(mdSummary, (node) => node.type === 'h3'), '预览层把标题渲染成 h3')
assert.ok(find(mdSummary, (node) => classOf(node) === 'fd-today-editor'), '预览层下面是同一个编辑器')

/* Markdown 只认纪要会用到的语法；链接只放行 http(s)/mailto */
const fakeH = (type, props, ...children) => ({ type, props, children: children.flat() })
const mdFlat = []
const walkMd = (node) => {
  if (Array.isArray(node)) { node.forEach(walkMd); return }
  if (!node || typeof node !== 'object') return
  mdFlat.push(node)
  ;(node.children || []).forEach(walkMd)
}
renderMarkdown(fakeH, '# 标题\n\n- **重点** 和 `code`\n\n[链接](https://example.com)\n\n> 引用').forEach(walkMd)
assert.ok(mdFlat.some((node) => node.type === 'h3' && node.children.includes('标题')), '标题渲染')
assert.ok(mdFlat.some((node) => node.type === 'strong' && node.children.includes('重点')), '粗体渲染')
assert.ok(mdFlat.some((node) => node.type === 'code' && node.children.includes('code')), '行内 code 渲染')
assert.ok(mdFlat.some((node) => node.type === 'li'), '列表渲染')
assert.ok(mdFlat.some((node) => node.type === 'blockquote'), '引用渲染')
assert.ok(mdFlat.some((node) => node.type === 'a' && node.props.href === 'https://example.com'), '链接放行 http(s)')
/* 乘号不是斜体 */
const mdTimes = []
const walkTimes = (node) => { if (Array.isArray(node)) { node.forEach(walkTimes); return } if (!node || typeof node !== 'object') return; mdTimes.push(node); (node.children || []).forEach(walkTimes) }
renderMarkdown(fakeH, 'a * b * c').forEach(walkTimes)
assert.equal(mdTimes.some((node) => node.type === 'em'), false, 'a * b * c 不当斜体')
const mdItalic = []
const walkItalic = (node) => { if (Array.isArray(node)) { node.forEach(walkItalic); return } if (!node || typeof node !== 'object') return; mdItalic.push(node); (node.children || []).forEach(walkItalic) }
renderMarkdown(fakeH, '*斜体*').forEach(walkItalic)
assert.ok(mdItalic.some((node) => node.type === 'em'), '正常斜体仍然渲染')
assert.ok(find(dash, (node) => classOf(node) === 'fd-ins-rail'), '左栏在')
assert.ok(find(dash, (node) => classOf(node) === 'fd-ins-main'), '右栏在')
const dashHead = find(dash, (node) => classOf(node).includes('fd-today-head-inline'))
const dashTabs = find(dash, (node) => classOf(node) === 'fd-today-tabs')
assert.ok(dashTabs && find(dashHead, (node) => classOf(node) === 'fd-today-tabs'), '宽形态 tabs 与结论同一行')
assert.equal(count(dash, (node) => classOf(node) === 'fd-ins-headline'), 0, '没有结论时不额外占一行')
assert.equal(find(dash, (node) => classOf(node) === 'fd-today-title'), null, '宽形态没有「今日洞察」标题')
assert.equal(count(dashTabs, isGenerateButton), 0, 'wide tabs 容器里没有生成按钮')
const dashGenerate = generateOf(dash)
assert.ok(dashGenerate, '宽形态的生成按钮在摘要操作行')
assert.equal(dashGenerate.children[0], '更新')
assert.equal(count(dash, (node) => node.type === 'button' && node.children[0] === '↻'), 0, '不给每个 tab 配 ↻')
/* 精简：整份摘要只有一个写评论入口，结论行不再各挂一个 */
assert.equal(count(dash, (node) => node.type === 'button' && node.children[0] === '写评论'), 0, '结论行不再逐条挂写评论')
assert.equal(count(dash, (node) => classOf(node).includes('fd-today-chart')), 1, '宽形态也只有一个图表')
assert.equal(find(dash, (node) => classOf(node) === 'fd-ins-longterm'), null, '旧宿主没有 longTerm 时不渲染')

/* ---- 分区：记录 → 深度 → 关联任务 → 标签与操作；天气动画 + hover 判定 ---- */
const zoneTasks = [
  { id: 't13', no: 13, title: 'Qvi 收口', started: true },
  { id: 't20', no: 20, title: '写文档', done: true },
]
const apiZones = {
  ...api,
  insight: async () => ({
    results: {
      diagnose: {
        headline: '开得比关得快',
        advice: '先把 T13 推到可验收',
        issues: [{ text: 'T13 逾期 2 天', taskNo: 13, level: 'bad' }],
        strengths: [],
      },
    },
    local: {
      today: { doneCount: 3, completion: 75, activeCount: 5, deviation: 12 },
      board: { total: 118, started: 6, idle: 2 },
      stalled: [],
    },
  }),
}
const renderZones = mount(TodayInsight)
renderZones({ api: apiZones, tasks: zoneTasks, onOpenTask: () => {}, variant: 'dashboard' })
await wait()
const zt = renderZones({ api: apiZones, tasks: zoneTasks, onOpenTask: () => {}, variant: 'dashboard' })
const zoneOrder = []
const zoneNames = ['fd-zone-record', 'fd-zone-deep', 'fd-zone-tasks', 'fd-zone-foot']
walk(zt, (node) => {
  const classes = classOf(node).split(/\s+/)
  for (const name of zoneNames) if (classes.includes(name)) zoneOrder.push(name)
})
assert.deepEqual(zoneOrder, zoneNames, '四个分区按 记录 → 深度 → 关联任务 → 标签 排')
const deepZone = find(zt, (node) => classOf(node) === 'fd-zone fd-zone-deep')
assert.ok(deepZone, '深度区在')
assert.ok(find(deepZone, (node) => classOf(node) === 'fd-ins-next'), '下一步并进深度区，不再单独成卡')
assert.ok(find(deepZone, (node) => classOf(node) === 'fd-deep-main'), '下一动作与推理链在深度卡主栏')
assert.ok(find(deepZone, (node) => classOf(node) === 'fd-deep-side'), '做得对与小图在深度卡侧栏')
assert.match(styles, /\.fd-deep-body \{[^}]*grid-template-areas/, '深度内部用区域网格排，不靠分割线')
assert.equal(/ \.fd-deep-section \+ \.fd-deep-section/.test(styles), false, '深度内部不再画分段线')
assert.ok(find(deepZone, (node) => classOf(node) === 'fd-deep-minis'), '两张小图在深度卡内部，不再各自成卡')
assert.equal(count(deepZone, (node) => classOf(node).split(/\s+/).includes('fd-mini')), 2, '深度卡里两张小图：进出账 + 完成度')
assert.equal(count(zt, (node) => classOf(node).split(/\s+/).includes('fd-ins-row')), 1, '关联任务=要处理，一条 issue 一行')
assert.ok(find(zt, (node) => node.type === 'button' && node.children[0] === '打开'), '任务行可快速打开')
assert.match(styles, /\.fd-zone \{[^}]*border: 1px solid/, '每个分区是一张卡')
const footZone = find(zt, (node) => classOf(node).split(/\s+/).includes('fd-zone-foot'))
assert.ok(footZone, '底栏在')
assert.equal(find(footZone, (node) => classOf(node) === 'fd-zone-head'), null, '底栏不再有「标签与操作」标题')
assert.equal(find(footZone, (node) => classOf(node) === 'fd-ins-meta'), null, '底栏不再列履约/延期明细')
assert.ok(find(footZone, (node) => classOf(node) === 'fd-ins-chips'), '底栏左侧是标签')
assert.ok(find(footZone, (node) => classOf(node) === 'fd-today-foot'), '底栏右侧是更新')
assert.match(styles, /\.fd-zone-foot \{[^}]*justify-content: space-between/, '底栏两端对齐')
const weather = find(zt, (node) => classOf(node) === 'fd-weather-card')
assert.ok(weather, '天气卡在')
assert.ok(find(weather, (node) => node.type === 'svg'), '天气是动画 SVG，不是静态 emoji')
const tip = find(weather, (node) => classOf(node) === 'fd-weather-tip')
assert.match(String(tip.children[1].children[0]), /阈值|完成度/, 'tooltip 说清判定口径')
assert.match(styles, /\.fd-weather-card:hover \.fd-weather-tip/, 'hover/focus 出 tooltip')
assert.match(styles, /\.fd-w-rays \{[^}]*animation/, '晴天光线在转')
const railChart = find(zt, (node) => classOf(node) === 'fd-rail-chart')
assert.ok(railChart, '左栏统计换成图')
assert.ok(find(railChart, (node) => classOf(node) === 'fd-rail-chart-box'), '环图容器在')
assert.ok(find(railChart, (node) => node.children && String(node.children[1] || '').startsWith('本周 ')), '图例给出本周合计')
assert.equal(find(railChart, byText('周内节奏')), null, '雷达下面不再写「周内节奏」')
assert.equal(find(railChart, byText('在推 5')), null, '雷达下面不再塞在推数量')
assert.match(styles, /\.fd-weather-card \{[^}]*padding: 0/, '天气与下方文字左对齐')
assert.match(styles, /\.fd-rail-chart-box \{[^}]*height: 190px/, '左栏雷达放大，用掉更多纵向空间')
assert.ok(find(zt, (node) => classOf(node) === 'fd-weather-row'), '天气是横排：图标 + 文字，不套框')
assert.match(styles, /@keyframes fd-fall/, '雨滴有下落动画')

/* ---- 长期结论：只在宽形态、只在有数据时出现；>7 天给「重新判断」 ---- */
const DAY = 86_400_000
const longTermData = {
  lens: 'inversion', fact: '在跑（n=20 天）：中位 3，85 分位 3', hypothesis: '承诺偏乐观',
  falsifier: '下周估时占比 <30%', secondOrder: '缓冲太多会松',
  action: '当写预期时，就先乘 1.5', metric: '在跑', until: '2026-12-05',
  at: Date.now() - 8 * DAY, sampleDays: 20,
}
const ltCalls = []
const apiLt = {
  insight: async () => ({ results: { diagnose: { summary: '诊断摘要' } }, longTerm: { at: longTermData.at, data: longTermData } }),
  insightDiagnose: async (options) => { ltCalls.push(options); return { started: true, jobId: 'job-lt' } },
  insightAi: async () => ({ running: false }),
}
const renderLt = mount(TodayInsight)
renderLt({ api: apiLt, tasks: [], variant: 'dashboard' })
await wait()
const ltTree = renderLt({ api: apiLt, tasks: [], variant: 'dashboard' })
const ltDeep = find(ltTree, (node) => classOf(node) === 'fd-zone fd-zone-deep')
assert.ok(ltDeep, '深度卡在')
const block = find(ltDeep, (node) => classOf(node) === 'fd-ins-longterm')
assert.ok(block, '长期判断在深度卡里')
assert.equal(block.props['aria-label'], '长期结论')
assert.equal(find(block, (node) => classOf(node) === 'fd-ins-longterm-fact').children[0], longTermData.fact)
assert.equal(find(block, (node) => classOf(node) === 'fd-ins-longterm-hyp').children[0], longTermData.hypothesis)
assert.equal(find(block, (node) => classOf(node) === 'fd-ins-longterm-action').children[0], longTermData.action)
const reviewBtn = find(block, (node) => node.type === 'button' && node.children[0] === '重新判断')
assert.ok(reviewBtn, '8 天前 → 给重新判断')
await reviewBtn.props.onClick()
assert.equal(ltCalls.at(-1)?.mode, 'diagnose', '重新判断跑诊断')
assert.equal(ltCalls.at(-1)?.buttonId, 'diagnose')
assert.match(styles, /\.fd-ins-longterm \{[^}]*border[^}]*/, '长期块有自己的样式')
assert.equal(count(block, (node) => classOf(node).split(/\s+/).includes('fd-ins-chain-row')), 5, '推理链五步：事实/假设/反证/动作/验收')
assert.match(styles, /\.fd-ins-chain-row\.is-action::before \{[^}]*background: var\(--fd-brand\)/, '动作节点实心')
assert.match(styles, /\.fd-today \.fd-ai-btn \{[^}]*background: var\(--fd-brand\)/, '主按钮实心')
assert.match(styles, /\.fd-today-tabs \.fd-ai-jump\[aria-pressed="true"\]/, 'tabs 选中态')
/* 侧栏窄卡不塞长期块 */
const sideTree = renderCard({ api: apiLt, tasks: [] })
await wait()
assert.equal(find(renderCard({ api: apiLt, tasks: [] }), (node) => classOf(node) === 'fd-ins-longterm'), null, '侧栏不渲染长期块')
/* 刚生成的结论（<7 天）不给「重新判断」 */
const freshApi = {
  ...apiLt,
  insight: async () => ({ results: { diagnose: { summary: '诊断摘要' } }, longTerm: { at: Date.now(), data: { ...longTermData, at: Date.now() } } }),
}
const renderFresh = mount(TodayInsight)
renderFresh({ api: freshApi, tasks: [], variant: 'dashboard' })
await wait()
const freshTree = renderFresh({ api: freshApi, tasks: [], variant: 'dashboard' })
const freshBlock = find(freshTree, (node) => classOf(node) === 'fd-ins-longterm')
assert.ok(freshBlock, '长期块仍在')
assert.equal(find(freshBlock, (node) => node.type === 'button' && node.children[0] === '重新判断'), null, '新鲜结论不提醒重看')

/* ---- 生成：只认当前 jobId，别人的结果不显示；job 期间禁用并显示「生成中…」 ---- */
const calls = { diagnose: [], ai: 0 }
const api2 = {
  insight: async () => ({ results: {} }),
  insightDiagnose: async (options) => { calls.diagnose.push(options); return { started: true, jobId: 'job-7' } },
  insightAi: async () => { calls.ai += 1; return { jobId: 'job-other', running: false, data: { summary: '别人的结果' } } },
}
const renderOwn = mount(TodayInsight)
renderOwn({ api: api2, tasks: [] })
await wait()
let own = renderOwn({ api: api2, tasks: [] })
assert.equal(calls.diagnose.length, 0, '没点生成前不触发接口')
assert.equal(generateOf(own).children[0], '生成')
await generateOf(own).props.onClick()
own = renderOwn({ api: api2, tasks: [] })
assert.equal(generateOf(own).children[0], '生成中…', 'job 进行中按钮变成生成中…')
assert.equal(generateOf(own).props.disabled, true, 'job 进行中禁用')
assert.equal(summaryOf(own).props.running, true, '摘要行的状态是生成中')
await new Promise((resolve) => setTimeout(resolve, 1400))
own = renderOwn({ api: api2, tasks: [] })
assert.equal(calls.diagnose[0].mode, 'diagnose')
assert.equal(calls.diagnose[0].buttonId, 'diagnose')
assert.equal(calls.diagnose[0].force, true)
assert.ok(calls.ai >= 1, '轮询过 insightAi')
assert.equal(find(own, (node) => node.props.role === 'status' && String(node.children[0]).includes('别人的结果')), null, '别人的 job 结果不当成本次结果')
assert.equal(generateOf(own).children[0], '生成', 'job 结束后回到「生成」')

/* ---- 草稿：同一个键、同一份恢复逻辑 ---- */
const renderMorning = mount(morning.type)
const editor = (node) => find(node, labeled('洞察摘要'))
let editorTree = renderMorning(morning.props)
assert.equal(editor(editorTree).props.value, '原始早会摘要')
editor(editorTree).props.onFocus()
const refreshed = { ...morning.props, original: '刚生成的早会摘要' }
assert.equal(editor(renderMorning(refreshed)).props.value, '原始早会摘要', 'regeneration must not disturb focus')
const draft = '自定义摘要\n  多行，且不渲染 <b>HTML</b>'
editor(editorTree).props.onChange({ target: { value: draft } })
assert.equal(stored.get('dsh-cove-task:insight-summary:morning'), draft, 'summary draft key stays stable')
assert.equal(editor(mount(morning.type)(refreshed)).props.value, draft, 'another entry reads the same draft')
assert.equal(editor(mount(morning.type)({ id: 'diagnose', original: '诊断' })).props.value, '诊断')
editorTree = renderMorning(refreshed)
editor(editorTree).props.onChange({ target: { value: '' } })
assert.equal(editor(renderMorning(refreshed)).props.value, '')
/* 用户口径：摘要下方不再有「未保存 / 恢复原文」——草稿静默保存，正文只留输入框 */
assert.equal(find(renderMorning(refreshed), byText('恢复原文')), null, '不再渲染恢复原文')
assert.equal(find(renderMorning(refreshed), byText('未保存')), null, '不再渲染未保存')
assert.equal(stored.get('dsh-cove-task:insight-summary:morning'), '', '草稿仍然静默保存')

console.log('TODAY_INSIGHT_OK: 共用一份 state；tabs 在头行、生成按钮右下对齐；摘要无未保存/恢复原文；侧栏双栏/折叠、总览 fd-ins，jobId 只认自己')
