/**
 * 样式红线：styles.js 里不允许「没人引用」的类，也不允许定义了没人用的 --fo-* 变量。
 *
 * 判定口径：
 *  - 类：CSS 选择器里的类名必须出现在 src/client（除 styles.js）/ src/overview / src/card 的源码里；
 *    动态拼接的类（比如 'lamp-' + state）要在这个白名单里显式登记，知道自己在做什么。
 *  - 变量：--fo-* 必须被 var(--fo-*) 或 JS 字符串引用；只在定义处出现的算死变量。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TICK = String.fromCharCode(96)
const root = fileURLToPath(new URL('..', import.meta.url))
const stylesPath = join(root, 'src/client/styles.js')
const stylesSource = readFileSync(stylesPath, 'utf8')
const pre = 'export const CSS = ' + TICK
const css = stylesSource.slice(stylesSource.indexOf(pre) + pre.length, stylesSource.lastIndexOf(TICK))

/* 动态类名白名单：源码里是拼接出来的，静态扫描看不见。 */
const DYNAMIC_CLASSES = new Set([])

const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const classes = new Set()
let depth = 0
let buffer = ''
let inKeyframes = false
for (const ch of css) {
  if (ch === '{') {
    const prelude = strip(buffer).trim()
    if (/^@keyframes/.test(prelude)) inKeyframes = true
    else if (!inKeyframes && prelude && !prelude.startsWith('@')) {
      for (const selector of prelude.split(',')) {
        for (const match of selector.matchAll(/\.([A-Za-z][\w-]*)/g)) classes.add(match[1])
      }
    }
    depth += 1
    buffer = ''
    continue
  }
  if (ch === '}') { depth -= 1; if (depth === 0) inKeyframes = false; buffer = ''; continue }
  if (depth === 0) buffer += ch
}

const files = []
for (const dir of ['src/client', 'src/overview', 'src/card']) {
  for (const name of readdirSync(join(root, dir))) {
    if (name.endsWith('.js') && !(dir === 'src/client' && name === 'styles.js')) files.push(join(root, dir, name))
  }
}
const sources = files.map((file) => readFileSync(file, 'utf8')).join('\n')
const dead = [...classes].filter((name) => !DYNAMIC_CLASSES.has(name) && !sources.includes(name)).sort()
assert.deepEqual(dead, [], 'styles.js 里有没人引用的类：' + dead.join(', '))

/* 变量：定义必须被用到（CSS 里的 var() 或 JS 字符串）。 */
const definitions = [...new Set([...css.matchAll(/(--fo-[a-z0-9-]+)\s*:/g)].map((m) => m[1]))]
const usedInCss = new Set([...css.matchAll(/var\((--fo-[a-z0-9-]+)/g)].map((m) => m[1]))
/* 动态拼出来的变量（--fo-deco-${N}）按前缀认：源码里出现前缀就算用到了。 */
const usedByPrefix = (name) => {
  const prefix = name.replace(/[-_]?[0-9a-z]+$/, '')
  return prefix && prefix !== name && sources.includes(prefix)
}
const unusedVars = definitions.filter((name) => !usedInCss.has(name) && !sources.includes(name) && !usedByPrefix(name))
assert.deepEqual(unusedVars, [], '定义了但没人用的变量：' + unusedVars.join(', '))

console.log('DEAD_STYLES_OK: ' + classes.size + ' classes, ' + definitions.length + ' vars, no orphans')
