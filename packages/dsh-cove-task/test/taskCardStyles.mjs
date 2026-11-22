/**
 * 任务卡样式测试：作用域、令牌前缀、关键类都在。
 *
 * 这份样式是从 panel.html 抽出来的，最容易犯的两个错：
 *  1. 选择器漏了 .tc-scope → 污染面板其它区域；
 *  2. 颜色写死 / 用了没有 fallback 的 --p-* → 画布（没有 --p-*）里透明或发黑。
 * 这两条钉死，剩下的交给阶段 2 的实机截图。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TASK_CARD_STYLES, TASK_CARD_SCOPE, TASK_MENU_STYLES, TASK_CARD_STYLE_ID, taskCardStyles, taskMenuStyles, ensureTaskCardStyles } from '../src/card/taskCardStyles.js'

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log('  ok  ' + name)
  } catch (error) {
    failures.push(name)
    console.log('  FAIL ' + name)
    console.log(String((error && error.stack) || error).split('\n').slice(0, 5).map((line) => '       ' + line).join('\n'))
  }
}

const css = TASK_CARD_STYLES
const cssNoKeyframes = css.replace(/@keyframes[\s\S]*?\n\s*}\s*(?=\n|$)/g, '')

check('scope 名固定为 tc-scope', () => {
  assert.equal(TASK_CARD_SCOPE, 'tc-scope')
  assert.equal(taskCardStyles(), TASK_CARD_STYLES)
})
check('每条规则都挂在 .tc-scope 下（没有裸 .task / .chip）', () => {
  /* 按大括号深度扫，跳过 @keyframes 里面的 0%/50% 块。
     先剥掉 CSS 注释：注释不是选择器（映射块的说明文字会被误当成一条裸规则）。 */
  const scannable = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = []
  let depth = 0
  let buffer = ''
  let skipping = false
  for (let i = 0; i < scannable.length; i += 1) {
    const ch = scannable[i]
    if (ch === '{') {
      const prelude = buffer.trim()
      if (/^@keyframes/.test(prelude)) skipping = true
      else if (!skipping && prelude) for (const sel of prelude.split(',')) selectors.push(sel.trim())
      depth += 1
      buffer = ''
      continue
    }
    if (ch === '}') { depth -= 1; if (depth === 0) skipping = false; buffer = ''; continue }
    if (depth === 0) buffer += ch
  }
  const unscoped = selectors.filter((sel) => sel && !/^\.tc-(scope|menu)\b/.test(sel))
  assert.deepEqual(unscoped, [])
})
check('关键类都在', () => {
  for (const cls of ['task', 'task-head', 'task-meta', 'task-actions', 'chip', 'badge', 'prio', 'sess-inline', 'avatar', 'doc-chip-group']) {
    assert.ok(css.includes('.' + cls), cls)
  }
})
check('颜色只走 --tc-*：映射集中在 .tc-scope 一处，且没有 --p-* 死引用', () => {
  /* 旧写法是 var(--tc-x, var(--p-x))：但 --p-* 是 panel.html 那套调色板，React 面板里从来没定义过，
     兜底永远解析不到 —— 那 150+ 处是死代码，已删。现在映射只写在 .tc-scope 块里。 */
  /* 判定只看代码，不看注释（映射块的注释里会提到旧的 --p-* 写法）。 */
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.equal(code.includes('--p-'), false, '不许再出现 --p-*（旧面板调色板）')
  const mapStart = code.indexOf('.tc-scope {')
  assert.ok(mapStart >= 0, '.tc-scope 里要有令牌映射块')
  const map = code.slice(mapStart, code.indexOf('}', mapStart))
  const used = [...new Set([...code.matchAll(/var\((--tc-[a-z0-9-]+)\)/g)].map((m) => m[1]))]
  const defined = new Set([...map.matchAll(/(--tc-[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
  const missing = used.filter((token) => !defined.has(token))
  /* 这条才是真正防回退的：卡片用到的每个 --tc-* 都必须在映射里定义，否则就是透明/继承色。 */
  assert.deepEqual(missing, [], '这些 --tc-* 没有在 .tc-scope 映射里定义：' + missing.join(', '))
  assert.ok(used.length >= 12, '用到的令牌太少（' + used.length + '），映射是不是被删了？')
})
check('动画 keyframes 保留（当前对话 / 呼吸灯 / 优先级）', () => {
  assert.ok(css.includes('@keyframes task-current-pulse'))
  assert.ok(css.includes('@keyframes priority-breathe'))
  assert.ok(css.includes('@keyframes lamp-pulse'))
})
check('菜单样式独立作用域（.tc-menu）+ 同套令牌', () => {
  assert.equal(taskMenuStyles(), TASK_MENU_STYLES)
  assert.ok(TASK_MENU_STYLES.includes('.tc-menu'))
  assert.ok(TASK_MENU_STYLES.includes('var(--tc-line)'))
  assert.ok(TASK_MENU_STYLES.includes('.prio-item'))
})
check('没有把面板的菜单/筛选样式带进来', () => {
  for (const forbidden of ['.prio-menu', '.chip-pop', '.task-filter', '.relation-editor', '.task-local-pop']) {
    assert.equal(css.includes(forbidden), false, forbidden)
  }
})

check('ensureTaskCardStyles：只插一次、带 .tc-scope 规则，画布能直接引用', () => {
  const styles = []
  const doc = {
    getElementById: (id) => styles.find((node) => node.id === id) || null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: (node) => styles.push(node) },
  }
  assert.equal(ensureTaskCardStyles(doc), true)
  assert.equal(ensureTaskCardStyles(doc), true)
  assert.equal(styles.length, 1, '重复调用不能插第二份')
  assert.ok(styles[0].textContent.includes('.tc-scope .task'))
  assert.equal(styles[0].id, TASK_CARD_STYLE_ID)
})
const graphViewSource = await readFile(new URL('../src/client/GraphView.js', import.meta.url), 'utf8')
check('GraphView 在挂载时注入卡片样式（否则画布上是一堆无样式的节点）', () => {
  assert.match(graphViewSource, /ensureTaskCardStyles\(document\)/)
})

console.log('\ntaskCardStyles.mjs: ' + passed + ' passed, ' + failures.length + ' failed')
if (failures.length) process.exit(1)
