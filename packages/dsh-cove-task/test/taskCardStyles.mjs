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
  /* 按大括号深度扫，跳过 @keyframes 里面的 0%/50% 块。 */
  const selectors = []
  let depth = 0
  let buffer = ''
  let skipping = false
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]
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
check('颜色走 --tc-* 令牌（有 --p-* 兜底）', () => {
  assert.ok(css.includes('var(--tc-line, var(--p-line))'))
  /* 先剥掉合法的「--tc-X 回退到 --p-X」，剩下的裸 --p-* 就是没兜底的。 */
  const stripped = css.replace(/var\(--tc-([a-z0-9-]+), var\(--p-\1\)\)/g, '')
  /* 只剩「连逗号都没有」的裸 var(--p-x) 才算没兜底；var(--p-x, 兜底) 本身是安全的。 */
  const noFallback = stripped.match(/var\(--p-[a-z0-9-]+\)/g) || []
  assert.deepEqual(noFallback, [], '这些 --p-* 没有 fallback：' + noFallback.join(', '))
})
check('动画 keyframes 保留（当前对话 / 呼吸灯 / 优先级）', () => {
  assert.ok(css.includes('@keyframes task-current-pulse'))
  assert.ok(css.includes('@keyframes priority-breathe'))
  assert.ok(css.includes('@keyframes lamp-pulse'))
})
check('菜单样式独立作用域（.tc-menu）+ 同套令牌', () => {
  assert.equal(taskMenuStyles(), TASK_MENU_STYLES)
  assert.ok(TASK_MENU_STYLES.includes('.tc-menu'))
  assert.ok(TASK_MENU_STYLES.includes('var(--tc-line, var(--p-line'))
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
