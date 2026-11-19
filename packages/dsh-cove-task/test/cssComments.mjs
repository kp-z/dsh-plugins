/**
 * 样式表的注释必须闭合，关键布局规则必须真的存在。
 *
 * 事故背景（2026-11-18，v0.25.0 引入）：styles.js 里有一行残缺注释，
 * 只有注释结束符、没有注释开始符（本文件不写出这两个符号，免得文档注释自己被提前闭合）。
 * 结果 CSS 解析器把下一行那条规则当成同一个选择器的一部分，
 * 于是 .fo-root[data-rightdock="1"] .fo-body 的 grid-template-columns 连同 !important
 * 被整条丢弃（浏览器静默丢弃无效规则，控制台不报错）。
 *
 * 后果：同时打开「任务详情」和「建议」时，[data-detail="1"][data-organize="1"]
 * 仍然给出三列栅格，但 DOM 里只有两个子元素（正文 + 右侧单 dock，两个面板共用一列），
 * 第三列约 314px 永远空着 —— 就是用户看到的「右侧多了一块空白」。
 *
 * 所以这里钉住两件事：
 *   1. 导出的 CSS 里注释严格闭合，不能有多余的结束符；
 *   2. 那条右侧单 dock 的布局规则真的在 CSS 里，且只给两列。
 *
 * 跑法：node test/cssComments.mjs
 */
import assert from 'node:assert/strict'

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
    for (const line of String((error && error.message) || error).split('\n').slice(0, 6)) console.log('       ' + line)
  }
}

const OPEN = '/' + '*'
const CLOSE = '*' + '/'

/** 返回出现在任何注释开始符之前的孤立结束符位置（行号 + 上下文）。 */
function strayClosers(css) {
  const stray = []
  let i = 0
  for (;;) {
    const open = css.indexOf(OPEN, i)
    const close = css.indexOf(CLOSE, i)
    if (close === -1) break
    if (open === -1 || close < open) {
      const line = css.slice(0, close).split('\n').length
      const context = css.slice(Math.max(0, close - 40), close + 2).replace(/\n/g, '\\n')
      stray.push({ line, context })
      i = close + 2
      continue
    }
    const end = css.indexOf(CLOSE, open + 2)
    if (end === -1) break
    i = end + 2
  }
  return stray
}

/**
 * 按注释规则把注释剥掉；遇到孤立结束符返回 null。
 * 浏览器拿到这种 CSS 时会把「含孤立结束符的那段 + 下一条规则」整条丢弃，
 * 所以后续的规则检查必须在剥完注释的文本上做 —— 否则会出现「规则字面还在、
 * 实际已被丢弃」的假通过。
 */
function stripComments(css) {
  let out = ''
  let i = 0
  for (;;) {
    const open = css.indexOf(OPEN, i)
    if (open === -1) {
      out += css.slice(i)
      /* 剩下部分不允许出现结束符 */
      return css.indexOf(CLOSE, i) === -1 ? out : null
    }
    /* 开头到注释开始符之间不能有孤立的结束符 */
    if (css.indexOf(CLOSE, i) !== -1 && css.indexOf(CLOSE, i) < open) return null
    out += css.slice(i, open)
    const end = css.indexOf(CLOSE, open + 2)
    if (end === -1) return null
    i = end + 2
  }
}

const { CSS } = await import('../src/client/styles.js')

check('导出的 CSS 非空', () => {
  assert.ok(typeof CSS === 'string' && CSS.length > 10_000, 'CSS 太短，导出可能坏了')
})

check('注释严格配对，没有孤立的结束符', () => {
  const stray = strayClosers(CSS)
  assert.deepEqual(
    stray,
    [],
    '发现孤立的注释结束符（多半是残缺注释，会把下一条规则整段吃掉）：\n' +
      stray.map((item) => '  行 ' + item.line + ' …' + item.context).join('\n'),
  )
})

check('右侧单 dock 的栅格规则存在（详情+建议同开时只占一列）', () => {
  /* 用剥掉注释的文本判断：注释坏掉时这条规则在真实浏览器里是不存在的 */
  const css = stripComments(CSS)
  assert.ok(css !== null, '注释不合法，浏览器会丢弃含孤立的结束符的那段规则')
  const rule = css.match(/\.fo-root\[data-rightdock="1"\]\s+\.fo-body\s*\{([^}]*)\}/)
  assert.ok(rule, '.fo-root[data-rightdock="1"] .fo-body 整条规则不见了（被残缺注释吃掉了？）')
  const cols = rule[1].match(/grid-template-columns\s*:([^;]+);/)
  assert.ok(cols, '没解析出 grid-template-columns')
  assert.ok(/!important/.test(rule[1]), '这条规则必须带 !important，否则压不住三列的历史模板')
  /* 去掉 !important 与首尾空白，再按顶层空格数列数（clamp()/minmax() 里的逗号不算） */
  const value = cols[1].replace(/!important/i, '').trim()
  let depth = 0
  let columns = 1
  for (const ch of value) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ' ' && depth === 0) columns += 1
  }
  assert.ok(columns <= 2, '这条规则给出了 ' + columns + ' 列，同开的详情/建议会多出一列空白')
})

check('历史三列模板若还在，必须被 data-rightdock 规则压住', () => {
  const css = stripComments(CSS) || CSS
  const three = /\.fo-root\[data-detail="1"\]\[data-organize="1"\][^{]*\{[^}]*grid-template-columns[^;]*clamp[^;]*clamp/
  if (!three.test(css)) return
  assert.ok(
    /\.fo-root\[data-rightdock="1"\][^{]*\{[^}]*!important/.test(css),
    '三列模板还在，但没有 !important 的 data-rightdock 规则压住它',
  )
})

if (failures.length > 0) {
  console.log('\nCSS_COMMENTS_FAIL: ' + failures.join('; '))
  process.exitCode = 1
} else {
  console.log('CSS_COMMENTS_OK: ' + passed + ' 项通过（注释配对、右侧单 dock 栅格）')
}
