/**
 * 独立页的 React UMD 必须在构建后真的存在。
 *
 * 事故背景（2026-11-18）：用户报「跳到浏览器的 cove-task 页面是黑的」。
 * tasks.html 先用两个 <script> 加载 /tasks/vendor/react.js 与 react-dom.js，
 * 宿主把它们映射到 lib/vendor/*.production.min.js。但 lib/ 在 .gitignore 里，
 * build:client 当时只产出 client.iife.js，**没有任何步骤生成 lib/vendor/**
 * （那份文件一直靠本机手工放着）。换台机器 clone 构建完，两个 URL 直接 500：
 *
 *   ENOENT: lib/vendor/react.production.min.js
 *
 * boot.js 第一行 `const React = window.React` 拿到 undefined，模块抛错，
 * createRoot 不执行，#ts-app 停在空 div —— 看到的就是整页黑屏。
 *
 * 这里钉住三件事，任何一件缺失都让构建不合格：
 *   1. package.json 的 build:client 真的调用了 build-vendor-react.mjs；
 *   2. 脚本跑完后 lib/vendor 下两个文件都在，且大小像完整 UMD；
 *   3. 文件内容确实是 UMD（挂 window），不是 ESM/CJS 版本。
 *
 * 跑法：node test/vendorReact.mjs（依赖 build:client 先跑过一次）
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
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
    for (const line of String((error && error.message) || error).split('\n').slice(0, 6)) console.log('       ' + line)
  }
}

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const vendorDir = join(root, 'lib', 'vendor')

/** index.js 的 TASK_FILES 用这两个文件给独立页供 React。 */
const FILES = ['react.production.min.js', 'react-dom.production.min.js']

check('build:client 调用了 build-vendor-react.mjs', () => {
  const build = String(pkg.scripts && pkg.scripts['build:client'] || '')
  assert.ok(build.includes('build-vendor-react.mjs'),
    'build:client 没有调用 scripts/build-vendor-react.mjs —— lib/vendor 不会被生成，独立页会黑屏')
})

check('react / react-dom 固定在 devDependencies', () => {
  const dev = pkg.devDependencies || {}
  assert.ok(dev.react, 'devDependencies 缺 react：脚本无法定位 UMD')
  assert.ok(dev['react-dom'], 'devDependencies 缺 react-dom：脚本无法定位 UMD')
  /* 版本必须一致：宿主注入的 React、reactflow 的 peer、这份 UMD 要是同一份。 */
  assert.equal(dev.react, dev['react-dom'], 'react 与 react-dom 版本不一致')
})

for (const name of FILES) {
  check('lib/vendor/' + name + ' 存在且是完整 UMD', () => {
    const file = join(vendorDir, name)
    assert.ok(existsSync(file), '缺 ' + file + ' —— 独立页会 500，页面黑屏。先跑 pnpm run build:client')
    const size = statSync(file).size
    assert.ok(size > 5000, name + ' 只有 ' + size + ' 字节，不像是完整的 UMD 产物')
    const text = readFileSync(file, 'utf8')
    /* UMD 会挂到 globalThis/self/window；ESM 版本是 export 语句。 */
    assert.ok(/React/.test(text.slice(0, 400)), name + ' 头部没有 React 版权头')
    assert.ok(/exports|globalThis|self|window/.test(text), name + ' 不像是 UMD（没有导出/全局挂载）')
    assert.ok(!/^export\s/m.test(text.slice(0, 2000)), name + ' 是 ESM 版本，独立页用 <script> 加载不了')
  })
}

if (failures.length > 0) {
  console.log('\nVENDOR_REACT_FAIL: ' + failures.join('; '))
  process.exitCode = 1
} else {
  console.log('VENDOR_REACT_OK: ' + passed + ' 项通过（build 步骤、devDependencies、' + FILES.length + ' 个 UMD 产物）')
}
