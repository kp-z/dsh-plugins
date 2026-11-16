/**
 * 发布清单红线：src/ 下的目录只要被相对 import 引用到，就必须出现在 package.json 的 files 里。
 *
 * 事故背景：加 `src/card` 时忘了更新 files 白名单，装进 profile 后独立海湾页的模块全部 404
 * （页面打不开）。这个测试扫一遍所有相对 import，把「漏目录」挡在提交前。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const files = new Set(pkg.files || [])
const srcDirs = readdirSync(join(root, 'src')).filter((name) => statSync(join(root, 'src', name)).isDirectory())
const sourceFiles = []
for (const dir of srcDirs) {
  for (const name of readdirSync(join(root, 'src', dir))) {
    if (name.endsWith('.js')) sourceFiles.push({ dir, file: join(root, 'src', dir, name) })
  }
}
/* 从 src/<a>/<file>.js 里的相对 import 推断需要的 src/<b>：'../b/...' 或 '../../src/b/...' */
const needed = new Set()
for (const entry of sourceFiles) {
  const text = readFileSync(entry.file, 'utf8')
  for (const match of text.matchAll(/from\s+['"](\.\.\/)+([^'"]+)['"]/g)) {
    const rest = match[2].split('/')[0]
    if (rest === 'src') continue
    if (srcDirs.includes(rest)) needed.add(rest)
  }
}
const missing = [...needed].filter((dir) => !files.has('src/' + dir) && !files.has('src'))
assert.deepEqual(missing.sort(), [], '这些 src 目录被 import 了但没进 package.json files：' + missing.join(', '))
/* 显式钉住当前用到的四个目录（新增目录时这条会提醒你一起改） */
for (const dir of ['client', 'overview', 'card', 'graph', 'vendor']) {
  assert.ok(files.has('src/' + dir) || files.has('src'), 'files 缺 src/' + dir)
}
console.log('PACKAGE_FILES_OK: ' + [...needed].sort().join(', '))
