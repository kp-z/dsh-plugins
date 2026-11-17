/**
 * 运行页气泡的**静态不变量**（node test/runsOrbInvariants.mjs）。
 *
 * 为什么用「读源码做断言」而不是渲染：这几条都踩过一次真实事故，而且事故形态都是
 * 「DOM 里结构看着对、渲染出来却看不见」，普通渲染断言抓不到：
 *
 * 1. **SVG 的 fill/stroke 不接受 `color-mix()`** —— 水面矩形、水面波浪线、两层外发光全是这个写法，
 *    结果整块不可见（用户：「气泡里的水面动画和效果都失效了」）。这里禁止 orbSvg 区域出现 color-mix。
 * 2. **完成率水面只在 running 时画** —— 真实数据里常年 0 条在跑，于是整片气泡都没有水面。
 *    这里禁止「水面外面套 running 三元」这种写法。
 * 3. **图标太大** —— 曾经占圆内 54/100，圆里显得糊；口径是约 1/3（32/100）。
 * 4. **放大档位** —— 用户明确说不要档位（「我要的是图标变小其他的都不变」），不该再回来。
 * 5. **页头统计行 / 卡片刷新按钮 / 头部 revision** —— 用户逐条要求删掉，不该复活。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/client/RunsFeature.js', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../src/client/OverviewPanel.js', import.meta.url), 'utf8')

let passed = 0
const failed = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failed.push([name, error])
    console.log(`  FAIL ${name}`)
    console.log(`       ${error.message.split('\n')[0]}`)
  }
}

/** 去掉注释：注释里会提到 color-mix()（解释为什么不能用），那不是代码 */
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/^\s*\/\/.*$/, ''))
  .join('\n')

/** 气泡绘制区：orbInner（圆内内容）+ orbSvg（圆本身、水、发光） */
const orbBody = (() => {
  const start = src.indexOf('const orbInner = (o) => {')
  assert.ok(start > 0, '找不到 orbInner')
  const end = src.indexOf('/** 圆内完成率水面', start)
  return stripComments(src.slice(start, end > 0 ? end : src.length))
})()

check('气泡 SVG 里不出现 color-mix()（表现属性不认，会整块不可见）', () => {
  assert.equal(orbBody.includes('color-mix('), false, 'orbSvg 里出现了 color-mix(')
})

check('水面画在每个泡上（不是只在运行中才画）', () => {
  /* orbBody 已去注释，所以按矩形定位水面段 */
  const water = orbBody.indexOf("h('rect'")
  assert.ok(water > 0, '找不到完成率水面矩形')
  const tail = orbBody.slice(water, water + 700)
  assert.equal(/\brunning\s*\n?\s*\?/.test(tail.split('h(\'g\'')[0] || ''), false,
    '水面不该再套 running ? … : null —— 真实数据里常年 0 条在跑，那样整片气泡都没水面')
  assert.ok(tail.includes('h(\'rect\''), '完成率水面必须有一个填充矩形')
  assert.ok(tail.includes('animate'), '波浪线必须带 SMIL 动画')
})

check('发光是两层外圈 + 一层内发光，并且不再画「顶部高光弧」', () => {
  assert.ok(orbBody.includes('glowOuter'), '缺第一层外发光')
  assert.ok(orbBody.includes('glowOuter2'), '缺第二层外发光')
  assert.ok(orbBody.includes('-innerglow'), '缺内发光渐变')
  /* 参考项目那条 `inset 0 1px 0 white/40` 只有 1px、几乎看不见；
     用 1.8 单位宽的 SVG 弧去模仿，会变成气泡顶上一条明显的灰线（用户点名过）。 */
  assert.equal(orbBody.includes('50 - R * 0.98'), false, '不要顶部高光弧线')
  assert.ok(orbBody.includes('blur1') && orbBody.includes('blur2'), '两层外发光都要带高斯模糊（柔光）')
})

check('发光/水面颜色用 rgba 原值（与参考项目一致），不依赖令牌表达式', () => {
  assert.ok(/rgba\(\$\{c\[0\]\}/.test(orbBody) || orbBody.includes('const rgba = (c, a)'), '颜色应走 rgba 助手')
  /* 口径（用户）：运行中=蓝、完成=绿、报错（阻塞）=黄；等待/未开工沿用绿。
     注意不要再回到「未开始=灰」——那会让整片泡看着没颜色。 */
  assert.ok(orbBody.includes('state === \'running\' ? [59, 130, 246]'), '运行中必须是蓝色')
  assert.ok(orbBody.includes('state === \'blocked\' ? [251, 191, 36]'), '阻塞（报错）必须是黄色')
  assert.ok(orbBody.includes(': [34, 197, 94]'), '完成/等待用绿色')
  assert.equal(orbBody.includes('156, 163, 175'), false, '不该再按「未开始=灰」分色')
})

check('圆内图标占约 1/3（32/100），不是曾经的 54/100', () => {
  assert.equal(orbBody.includes('32 / 24'), true, '图标缩放应基于 32/100')
  assert.equal(orbBody.includes('54 / 24'), false, '不该回到 54/100')
})

check('没有放大档位（用户明确不要）', () => {
  assert.equal(src.includes('frx-zoom'), false, 'RunsFeature 里不该再有放大档位')
  assert.equal(src.includes('orbZoom'), false, '不该再有 orbZoom 状态')
})

check('没有页头统计行（用户要求不显示）', () => {
  assert.equal(src.includes('frx-header'), false, '不该再有页头')
  assert.equal(src.includes('条已完成（不上页）'), false, '不该再有统计副标题')
})

check('运行状态卡片右上没有刷新按钮', () => {
  const start = src.indexOf('const statusCard = card(')
  const end = src.indexOf('/* AVAILABLE MODELS', start)
  const card = src.slice(start, end)
  assert.equal(card.includes('frx-icon-btn'), false, '卡片头部不该再有图标按钮')
  assert.equal(card.includes('onRefresh'), false, '卡片头部不该再挂刷新回调')
})

check('页面头部不再显示 revision / 快照时钟', () => {
  assert.equal(panel.includes('revision ${model.str'), false, '不该再拼 revision 文案')
  assert.equal(panel.includes('clockOf(data && data.now)'), false, '不该再拼快照时钟')
})

check('历史行的状态色口径：运行=蓝 / 阻塞=黄 / 完成=绿（样式表里三色都在）', () => {
  const css = readFileSync(new URL('../src/client/runsExactStyles.js', import.meta.url), 'utf8')
  assert.ok(css.includes('.frx-avatar-dot.is-running { background: #3b82f6; }'), '运行中小圆点应为蓝')
  assert.ok(css.includes('.frx-avatar-dot.is-blocked { background: #f59e0b; }'), '阻塞小圆点应为黄')
  assert.ok(css.includes('.frx-avatar-dot.is-done { background: #22c55e; }'), '完成小圆点应为绿')
  /* 历史列表卡已经删掉：状态文字的配色口径随 .frx-row-status 一起消失，
     现在只有事件流里的小圆点表达状态（上面三条就是全部）。 */
  assert.equal(css.includes('.frx-row-status'), false, '历史列表卡删掉后不该再有 .frx-row-status')
  assert.ok(src.includes("state === 'blocked' ? '阻塞'"), '气泡状态文案要能表达阻塞')
})

check('运行页自己是滚动容器（宿主 .fo-feature-host 不滚，页面比一屏高）', () => {
  const css = readFileSync(new URL('../src/client/runsExactStyles.js', import.meta.url), 'utf8')
  const start = css.indexOf('.frx-page {')
  const block = css.slice(start, css.indexOf('}', start))
  assert.ok(block.includes('overflow-y: auto'), '.frx-page 必须能纵向滚动（曾经被父层裁掉，用户说「页面无法滚动」）')
  assert.ok(block.includes('min-height: 0'), '.frx-page 要有 min-height:0，否则 flex 子项撑高、滚动条不出现')
  assert.ok(block.includes('overscroll-behavior: contain'), '滚到底不要带着宿主页面一起滚')
})

check('状态徽标只挂在运行中的泡上（用户口径：没在跑的气泡右上角不要状态泡）', () => {
  assert.ok(src.includes('if (!isRunning) return null'), '非运行中的泡应直接不渲染徽标')
  const tooltip = src.slice(src.indexOf("className: 'frx-orb-tip-meta'"), src.indexOf("className: 'frx-orb-tip-hint'"))
  assert.ok(tooltip.includes('已完成'), '已完成气泡的 hover 浮层要写「已完成」，不能落成「未开始」')
})

check('这个指标叫「完成率」，不再叫「水位」（用户口径）', () => {
  assert.equal(src.includes('水位'), false, '运行页里不该再出现「水位」')
  assert.ok(src.includes('完成率'), 'hover 浮层 / 标签说明要写「完成率」')
})

check('水色跟着剩余量（绿→黄→红），且不动状态色', () => {
  assert.ok(src.includes('const waterLevel = pct >= 66 ? [34, 197, 94]'), '完成率要达到 2/3 才是绿')
  assert.ok(src.includes('pct >= 33 ? [245, 158, 11] : [239, 68, 68]'), '中间黄、过低红')
  assert.ok(src.includes('rgba(waterLevel, 0.3)') && src.includes('rgba(waterLevel, 0.82)'), '水与波浪线都用水色')
  /* 描边/发光仍然是状态色：search 一下 accent 有没有被 waterLevel 顶掉 */
  assert.ok(src.includes('const stroke = rgba(accent,'), '描边还得是状态色')
  assert.ok(src.includes('const glowOuter = rgba(accent,'), '外发光还得是状态色')
})

check('气泡 hover 放大 1.1（对齐参考项目），reduced-motion 下关掉', () => {
  const styles = readFileSync(new URL('../src/client/runsExactStyles.js', import.meta.url), 'utf8')
  assert.ok(/\.frx-orb-slot:hover\s*\{[^}]*transform:\s*scale\(1\.1\)/.test(styles), 'hover 要放大 1.1')
  assert.ok(/prefers-reduced-motion[\s\S]{0,220}\.frx-orb-slot:hover\s*\{[^}]*transform:\s*none/.test(styles),
    'reduced-motion 下不许动')
})

check('状态徽标：旧的对话气泡形态已换掉，五态各有徽标', () => {
  assert.equal(src.includes('frx-speech'), false, '旧的「对话气泡 + 尾巴」形态不该再出现')
  assert.ok(src.includes('frx-badge'), '应渲染右下角咬边的状态徽标')
  const pulse = readFileSync(new URL('../src/client/sessionPulse.js', import.meta.url), 'utf8')
  for (const badge of ["badge: 'dots'", "badge: 'check'", "badge: 'alert'", "badge: 'pause'", "badge: 'clock'"]) {
    assert.ok(pulse.includes(badge), `状态徽标缺 ${badge}`)
  }
})

check('不出现 undefined / NaN：卡片只消费 runsView 给出的数字', () => {
  /* 注释里会解释「为什么不再用它」，所以先去注释再找引用 */
  assert.equal(stripComments(src).includes('longestUntimed'), false,
    'longestUntimed 是个数字，按数组取 .length 会渲染出「undefined 条」（截图复核抓到过）')
  assert.ok(src.includes('Number(view.timedCount) || 0'), '计时覆盖要用 runsView 的口径并兜底')
  assert.ok(src.includes('Number(view.untimedCount) || 0'))
  const view = readFileSync(new URL('../src/client/runsView.js', import.meta.url), 'utf8')
  assert.ok(view.includes('const timedCount = bubbles.filter'), '口径要在 runsView 里算（可单测）')
  assert.ok(view.includes('const untimedCount = bubbles.length - timedCount'), '两者相加必须守恒')
})

check('三行等高：固定行高 + 窄面板回 auto（用户口径：第一/二/三行应该一样高）', () => {
  const styles = readFileSync(new URL('../src/client/runsExactStyles.js', import.meta.url), 'utf8')
  assert.ok(/--frx-row-h:\s*\d+px/.test(styles), '行高要固定成 px（内容决定行高时跨行不可能相等）')
  assert.ok(/grid-auto-rows:\s*var\(--frx-row-h\)/.test(styles), '网格要按变量固定行高')
  assert.equal(/--frx-row-h:\s*clamp\(/.test(styles), false, '不能再留 clamp：那会让行高随视口变')
  assert.ok(/@container frxpage \(max-width: 980px\)[\s\S]{0,200}grid-auto-rows:\s*auto/.test(styles),
    '窄面板要落回 auto，否则重排后的卡片会被裁')
})

check('气泡墙高度 104（用户口径：太高了）', () => {
  assert.ok(src.includes("height: '104px'"), '气泡墙应是 104px')
  assert.equal(src.includes("height: '132px'"), false, '旧的 132px 高度应已去掉')
})

check('状态卡：KPI 胶囊在**右上**、底部不再有项目名列表', () => {
  const card = stripComments(src.slice(src.indexOf("const statusCard = card('status'"), src.indexOf('/* 卡片 2')))
  assert.ok(card.includes('frx-kpi'), '状态卡要有 KPI 胶囊')
  assert.ok(card.includes("'lucide:"), 'KPI 图标要复用内置 Lucide 图标集')
  assert.equal(card.includes('frx-dist'), false, '底部项目名列表已删（用户口径：下方的项目名删掉）')
  assert.equal(card.includes('frx-legend'), false, '四色图例与 KPI 胶囊语义重复，应已删除')
  /* 胶囊必须在 head 里（右上），不能再挂在标题下方 */
  const head = card.slice(card.indexOf("className: 'frx-card-head'"))
  assert.ok(head.indexOf('frx-kpis') < head.indexOf('frx-bubbles'), 'KPI 胶囊要在卡片头部（右上）')
})

check('一卡一问：运行页只有 6 张卡，旧卡一张都不剩', () => {
  const keys = [...src.matchAll(/const \w+Card = card\('([a-z]+)'/g)].map((m) => m[1])
  assert.deepEqual(keys, ['status', 'ready', 'due', 'timeline', 'health', 'history'], `卡片集合不对：${keys.join(',')}`)
  /* 注意：`card('history'` 现在指的是**运行历史**（保留的），不在删除名单里 */
  for (const gone of ["card('projects'", "card('blockers'", "card('todo'", "card('longest'", "card('suspended'", "card('timing'", "card('actions'"]) {
    assert.equal(src.includes(gone), false, `旧卡没删干净：${gone}`)
  }
  /* 每张卡只回答一个问题：副标题里就能读出来（口径：越短越好，别重复卡名和下面的行名） */
  for (const sub of ["'依赖就绪'", "'按预期完成排序'", "'过去 24 小时'", "'按最近活动排序'"]) {
    assert.ok(src.includes(sub), `缺卡片职责说明：${sub}`)
  }
  /* 用户口径「文字描述有的比较啰嗦」：这几句长文案不许再回来（只看代码，注释里提一下没问题） */
  const code = stripComments(src)
  for (const verbose of ['会话正在跑 · 实时同步', '空闲 · 等待任务开工', "'同步 / 授权 / CLI'", '每条任务跑了多久 · 按最近活动排序', '越靠上越紧迫']) {
    assert.equal(code.includes(verbose), false, `啰嗦文案又回来了：${verbose}`)
  }
})

check('布局：2 行 × 4 列（在跑 2 + 开工 1 + 到期 1 ／ 动态 2 + 健康 2）', () => {
  assert.ok(src.includes("className: 'frx-grid'"), '整页应是一个 4 列网格容器')
  assert.ok(src.includes('statusCard, readyCard, dueCard,'), '第 1 行：在跑(2) + 开工顺序(1) + 快到期(1)')
  assert.ok(src.includes('timelineCard, healthCard,'), '第 2 行：最近动态(2) + 系统健康(2)')
  assert.ok(src.includes('historyCard'), '第 3 行：运行历史(4)')
  for (const span of ["card('status', {\n      span: 2", "card('timeline', {\n      span: 2", "card('health', {\n      span: 2"]) {
    assert.ok(src.includes(span), `跨度不对：${span}`)
  }
  /* 只有「运行历史」占满一行（它是表格，跨 4 列才读得下去） */
  assert.equal((src.match(/span: 4/g) || []).length, 1, 'span:4 只该出现在运行历史卡上')
  assert.ok(src.includes('is-span${span}'), 'card() 要把跨度落成 class，容器查询才压得住')
})

check('图表不是列表：开工用条形、到期用时间轴、动态用柱状、健康用环形', () => {
  assert.ok(src.includes("className: 'frx-rank-track'"), '开工顺序要有条形')
  assert.ok(src.includes("className: 'frx-due-bands'"), '快到期要有逾期/未来背景带')
  assert.ok(src.includes("className: 'frx-due-track'") && src.includes('frx-due-dot'), '快到期要有时间轴点')
  assert.ok(src.includes("className: 'frx-cols'"), '最近动态要有 24 根柱子')
  assert.ok(src.includes('RING_C') && src.includes('strokeDasharray'), '系统健康要有环形进度')
})

check('只有「正在运行」常驻；其余状态到点自动消失（并留墓碑不会闪回）', () => {
  const pulse = readFileSync(new URL('../src/client/sessionPulse.js', import.meta.url), 'utf8')
  assert.ok(/pulse:brand[^\n]*sticky: true|sticky: true, dots: true/.test(pulse) || pulse.includes('sticky: true, dots: true'),
    '运行中要常驻（sticky: true）')
  assert.equal((pulse.match(/sticky: false/g) || []).length >= 4, true, '其余状态都应是 sticky: false')
  assert.ok(pulse.includes('hidden: true'), '过期要留墓碑，否则每 8 秒闪一次')
})

check('信息不重复：状态卡里不再有「未完成 N 条」和两个 KPI 盒子', () => {
  const card = stripComments(src.slice(src.indexOf("const statusCard = card('status'"), src.indexOf("/* ---------- 卡片 2")))
  assert.equal(card.includes('frx-version'), false, '状态卡头部不该再放「未完成 N 条」（与下方卡片重复）')
  assert.equal(card.includes('frx-boxes'), false, '状态卡底部不该再放「运行中 / 已绑会话」两个盒子（与下方卡片重复）')
  /* 每个数字只出现一次：绑会话只能出现在「运行中」卡里 */
  const total = stripComments(src.slice(src.indexOf("const totalCard = card('total'"), src.indexOf("/* ---------- 卡片 3")))
  assert.equal(total.includes('绑会话'), false, '「未完成任务」卡不该重复会话绑定数')
  assert.equal(total.includes('在跑'), false, '「未完成任务」卡不该重复在跑数（那是「运行中」卡的口径）')
})

console.log(`\nrunsOrbInvariants.mjs: ${passed} passed, ${failed.length} failed`)
if (failed.length) process.exitCode = 1
