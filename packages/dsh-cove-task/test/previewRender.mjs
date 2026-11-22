/**
 * 离线渲染产物（`scripts/render-runs-preview.mjs` → `.runs-preview.html`）的结构红线。
 *
 * 为什么值得一个测试：这份产物是我每轮**唯一能自己看**的效果证据（真组件 + 真样式在 Node 里渲染），
 * 但它本身没人守 —— 之前就靠人工截图才发现「计时覆盖」卡渲染出了 `undefined 条`。
 * 现在把「产物里不该出现的东西」和「三页该有的结构」钉住：谁改坏了，不用等截图就能红。
 *
 * 跑法：node test/previewRender.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  FAIL ${name}`)
    console.log(String((error && error.stack) || error).split('\n').slice(0, 4).map((line) => `       ${line}`).join('\n'))
  }
}

const root = new URL('..', import.meta.url)
const out = new URL('../.runs-preview.html', import.meta.url)
/* 路径要解码（仓库路径含中文）：URL.pathname 是百分号编码的，spawn 的 cwd 拿到会 ENOENT。 */
execFileSync('node', ['scripts/render-runs-preview.mjs'], { cwd: fileURLToPath(root), stdio: 'pipe' })
check('产物已生成', () => assert.equal(existsSync(out), true))

const html = readFileSync(out, 'utf8')
const frames = html.split('<h2>')
const frameOf = (label) => {
  const hit = frames.find((part) => part.startsWith(label))
  assert.ok(hit, `产物里缺「${label}」这一段`)
  return hit
}

check('产物里不出现 undefined / NaN（模板里漏字段最容易在这里暴露）', () => {
  /* 允许出现在注释/文案里（比如这张卡的解释文字），但**不允许**出现在可见数值位 */
  const bad = html.match(/>[^<]*\b(undefined|NaN)\b[^<]*</g) || []
  assert.deepEqual(bad, [], `可见文本里出现了 ${JSON.stringify(bad.slice(0, 3))}`)
})

check('运行页：6 张卡（一卡一问）+ 每行 4 列的跨度', () => {
  const runs = frameOf('运行')
  assert.ok(runs.includes('frx-grid'), '缺网格容器')
  for (const label of ['运行状态', '开工顺序', '快到期', '最近动态', '系统健康', '运行历史']) {
    assert.ok(runs.includes(label), `缺卡片：${label}`)
  }
  /* 旧卡必须彻底消失：它们的信息要么被新卡覆盖，要么看完不能动手 */
  /* 「计时覆盖」不算旧卡：它作为一行小字收进了「系统健康」（设计如此） */
  for (const gone of ['项目分布', '阻塞排行', '待处理', '跑得最久', '暂缓', '执行历史', '快捷操作']) {
    assert.equal(runs.includes(gone), false, `旧卡片没删干净：${gone}`)
  }
  assert.ok((runs.match(/frx-card is-span2/g) || []).length >= 2, '两行各有一张跨列卡')
})

check('运行页：四张图表都渲出来了（条形 / 时间轴 / 柱状 / 环形）', () => {
  const runs = frameOf('运行')
  /* 徽标口径：运行中的泡挂三点 dots；阻塞是持续态，右上角挂 alert（用户口径：
     「阻塞状态右上角要有一个和正在运行类似的标识」）；已结束（clock）/完成（check）一律不画。 */
  assert.ok(runs.includes('data-badge="dots"'), '缺运行中的 dots 徽标')
  assert.ok(runs.includes('data-badge="alert"'), '阻塞泡要有 alert 徽标')
  const alertChunks = runs.split('data-badge="alert"')
  for (let i = 1; i < alertChunks.length; i++) {
    const prev = alertChunks[i - 1]
    const anchor = 'data-state="'
    const at = prev.lastIndexOf(anchor)
    const state = at >= 0 ? prev.slice(at + anchor.length, prev.indexOf('"', at + anchor.length)) : '(none)'
    assert.equal(state, 'blocked', `alert 徽标挂在了 ${state} 泡上`)
  }
  for (const badge of ['clock', 'check']) {
    assert.equal(runs.includes(`data-badge="${badge}"`), false, `非运行的泡不该有 ${badge} 徽标`)
  }
  /* 状态卡里 4 个 + 新卡片右上各 1 个（就绪 / 逾期 / 24h 事件 / 同步成功） */
  assert.ok((runs.match(/frx-kpi"/g) || []).length >= 4, '状态卡的 4 个 KPI 胶囊要在')
  assert.ok(runs.includes('frx-quad-pt'), '开工顺序要用四象限（不是纯列表）')
  assert.ok(runs.includes('frx-cal-day'), '快到期要用迷你日历')
  assert.ok(runs.includes('frx-chip'), '快到期 / 开工顺序要有分档计数胶囊')
  assert.equal((runs.match(/class="frx-col"/g) || []).length >= 1, true, '最近动态要有柱状图')
  assert.ok(runs.includes('frx-health-grid'), '系统健康要有状态格')
  assert.ok(runs.includes('frx-health-cover'), '系统健康底部要有计时覆盖细条')
  /* 没有 /api/health 数据时只能写「—」，不许编出「已关闭」这种状态 */
  assert.equal(runs.includes('已关闭'), false, '读不到健康数据时不能假装「自动同步已关闭」')
  assert.ok(runs.includes('frx-hist-row'), '运行历史要有行（表格 + 时长微条形）')
  assert.ok(runs.includes('frx-hist-bar'), '运行历史每行要有时长微条形（不是纯列表）')
  /* 空白处要能动手：没设预期完成的任务是可点的小胶囊，不是一句数字 */
  assert.ok(runs.includes('frx-due-unset-chip'), '快到期卡要把「没设预期完成」列成可点的胶囊')
})

check('洞察页：渲染成功（没有红框错误）', () => {
  const insight = frameOf('洞察')
  assert.equal(insight.includes('渲染失败：'), false, '洞察页渲染失败')
  assert.ok(insight.includes('fd-donut') || insight.includes('fd-kpi'), '洞察页该有 KPI/分布卡')
})

check('看板页：侧栏树（真模型 rows）+ 画布节点都渲出来了', () => {
  const graph = frameOf('看板')
  assert.equal(graph.includes('渲染失败：'), false, '看板页渲染失败')
  assert.ok(graph.includes('aria-level'), '侧栏树要渲染出 treeitem 的 aria-level')
  assert.ok(graph.includes('未分类'), '侧栏缺「未分类」')
  assert.ok((graph.match(/class="fo-node"/g) || []).length >= 3, '画布至少 3 个节点')
  assert.ok(graph.includes('飞书任务集开发'), '节点标题要用 label/fullTitle（不是 id）')
})

check('运行页样式表里没有「没人引用」的规则（如无必要勿增实体）', () => {
  const css = readFileSync(new URL('../src/client/runsExactStyles.js', import.meta.url), 'utf8')
  const source = readFileSync(new URL('../src/client/RunsFeature.js', import.meta.url), 'utf8')
  const classes = new Set([...css.matchAll(/\.((?:frx|fr)-[a-z0-9-]+)/g)].map((m) => m[1]))
  const orphans = [...classes].filter((name) => !source.includes(name))
  assert.deepEqual(orphans, [], `样式表里有没人用的类：${orphans.join(', ')}（删掉，或补回引用）`)
})

console.log(`\npreviewRender.mjs: ${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
