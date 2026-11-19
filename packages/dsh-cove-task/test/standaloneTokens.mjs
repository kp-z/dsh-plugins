/**
 * 独立页（/dsh-cove-task/tasks）的「宿主令牌兜底」完整性。
 *
 * 为什么值得一个测试：面板活在 DSH 里，--dsw-alias-* 由宿主主题提供；独立页没有宿主外壳，
 * 只有 tasks.html 里手写的一份兜底值。兜底漏一个令牌，CSS 里的 stroke: var(--x) 就会
 * 在计算值阶段失效 —— SVG 的 stroke 退回初始值 none，边整条消失。
 *
 * 真实事故（2026-11-17）：用户报「独立页关系图的边看不见」，DSH 里却正常。原因是
 * --dsw-alias-state-idle-primary 漏在 tasks.html 里，而 derived_from / temporal 两类边
 * 正是用它上色的；同一份代码在宿主里令牌齐全，所以只有独立页坏。
 *
 * 所以这里钉住两条：
 *   1. 独立页会渲染的样式模块用到**每一个** DSH 令牌，tasks.html 的亮/暗两套都要定义；
 *   2. 亮暗两套定义的令牌集合必须一致（只补一套 = 另一种主题下又坏）。
 *
 * 跑法：node test/standaloneTokens.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
    const text = String((error && error.message) || error)
    for (const line of text.split('\n').slice(0, 6)) console.log('       ' + line)
  }
}

const root = new URL('..', import.meta.url)
const read = (rel) => readFileSync(new URL(rel, root), 'utf8')

/** 独立页真正会加载的样式模块（tasksBoot -> OverviewPanel -> features）。 */
const MODULES = [
  'src/client/styles.js',
  'src/client/runsExactStyles.js',
  'src/client/dashboardStyles.js',
  'src/client/InsightFeature.js',
  'src/client/RunsFeature.js',
  'src/client/waterBubble.js',
]

/** 注释里会提到 --dsw-alias-* 这种通配写法，不能算「用到了」。 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const TOKEN = /--dsw-[a-z0-9-]+/g
const collect = (text) => [...new Set(text.match(TOKEN) || [])].filter((token) => !token.endsWith('-'))

const html = read('tasks.html')
const darkAt = html.indexOf('@media (prefers-color-scheme: dark)')
assert.ok(darkAt > 0, 'tasks.html 里应有暗色媒体查询')
/* 只取 :root 定义（--dsw-x:），避免把注释/用法里的 var(--dsw-x) 当成定义 */
const definedIn = (text) => new Set([...text.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
const lightDefined = definedIn(html.slice(0, darkAt))
const darkDefined = definedIn(html.slice(darkAt))

const used = new Set()
for (const rel of MODULES) for (const token of collect(stripComments(read(rel)))) used.add(token)

/* 事故：改令牌时多写了一个 }，CSS 解析把紧随其后的 `html, body { margin: 0; height: 100% }`
   整条规则吞掉 —— 页面出现 8px 外边距、内容不满屏（左/右/下都是空白），看起来像整体回退。 */
check('tasks.html 的样式块花括号必须平衡，且 reset 规则要被解析到', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
  let depth = 0
  let brokeAt = -1
  for (const ch of style) {
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth < 0) { brokeAt = 0; break }
    }
  }
  assert.equal(brokeAt, -1, '样式块里出现了多余的 }（会把后面的规则吞掉）')
  assert.equal(depth, 0, '样式块花括号不平衡')
  /* reset 必须在**令牌块之后**、且不能被多余括号隔断 */
  assert.ok(/html, body \{ margin: 0; height: 100%; \}/.test(style), '缺少 html,body reset')
  /* 真正的守卫是上面的深度检查：多一个 } 会让深度变负、少一个不会归零。
     （令牌块与 reset 之间本来就有「关 :root」「关 @media」两个 }，不能按「连续两个」判错。） */
})

check('独立页用到的每个 DSH 令牌，亮色兜底都有定义', () => {
  const missing = [...used].filter((token) => !lightDefined.has(token))
  assert.deepEqual(missing, [], 'tasks.html 亮色缺：' + missing.join(', '))
})

check('独立页用到的每个 DSH 令牌，暗色兜底都有定义', () => {
  const missing = [...used].filter((token) => !darkDefined.has(token))
  assert.deepEqual(missing, [], 'tasks.html 暗色缺：' + missing.join(', '))
})

check('亮/暗两套定义的令牌集合一致（只补一套 = 另一种主题下又坏）', () => {
  const onlyLight = [...lightDefined].filter((token) => !darkDefined.has(token))
  const onlyDark = [...darkDefined].filter((token) => !lightDefined.has(token))
  assert.deepEqual({ onlyLight, onlyDark }, { onlyLight: [], onlyDark: [] })
})

check('关系图的边色有兜底：state-idle 既要在 tasks.html 里，也要能退到次级文字色', () => {
  assert.ok(lightDefined.has('--dsw-alias-state-idle-primary'), '亮色缺 state-idle')
  assert.ok(darkDefined.has('--dsw-alias-state-idle-primary'), '暗色缺 state-idle')
  const styles = read('src/client/styles.js')
  assert.ok(
    /idle:\s*'var\(--dsw-alias-state-idle-primary,\s*var\(--dsw-alias-label-secondary\)\)'/.test(styles),
    'styles.js 的 idle 必须带 fallback，否则令牌缺失时 stroke 变 none、边直接消失',
  )
})

if (failures.length) {
  console.log('\n' + failures.length + ' failed')
  process.exit(1)
}
console.log('\nstandaloneTokens.mjs: ' + passed + ' passed, 0 failed')
