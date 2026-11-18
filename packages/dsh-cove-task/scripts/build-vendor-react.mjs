/**
 * 把官方 React UMD 拷进 lib/vendor，供独立海湾页（/dsh-cove-task/tasks）加载。
 *
 * 为什么需要它：独立页先加载两个 `<script>` 再跑 boot.js ——
 *   /dsh-cove-task/tasks/vendor/react.js      → lib/vendor/react.production.min.js
 *   /dsh-cove-task/tasks/vendor/react-dom.js  → lib/vendor/react-dom.production.min.js
 * boot.js 第一行就是 `const React = window.React`，文件缺失时模块直接抛错，
 * createRoot 不会执行，#ts-app 停在空 div，背景色露出来就是整页黑屏。
 *
 * 这两个文件以前是**手工放在本地**的：lib/ 在 .gitignore 里、脚本里也没有拷贝步骤，
 * 于是换台机器 clone 下来构建完，独立页必然 500。现在由本脚本在 build:client 里生成。
 *
 * 版本必须是面板跑的那一份（18.3.1）：宿主注入的 React、reactflow 的 peer、这里拷的 UMD
 * 三者要是同一版本，否则 hooks 报错。react/react-dom 因此写进 devDependencies 固定住。
 *
 * 重新生成：node scripts/build-vendor-react.mjs
 */
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const outDir = join(root, 'lib', 'vendor')

/** 期望版本：和 README 里对独立页的承诺、宿主注入的 React 保持一致。 */
const EXPECTED = '18.3.1'

/**
 * 定位 UMD 文件。
 *
 * 不能写 `require.resolve('react/umd/react.production.min.js')`：react 的 exports 字段
 * 只导出了 "." / "./package.json" / "./jsx-runtime" 等，未导出 ./umd/*，
 * 会直接 MODULE_NOT_FOUND。所以先解析到 package.json，再按包目录拼 umd 路径。
 */
function umdPath(pkg, file) {
  const pkgJson = require.resolve(pkg + '/package.json')
  return { from: join(dirname(pkgJson), 'umd', file), version: require(pkgJson).version }
}

const targets = [
  ['react', 'react.production.min.js'],
  ['react-dom', 'react-dom.production.min.js'],
]

await mkdir(outDir, { recursive: true })
for (const [pkg, file] of targets) {
  const { from, version } = umdPath(pkg, file)
  if (version !== EXPECTED) {
    throw new Error(pkg + ' 解析到 ' + version + '，期望 ' + EXPECTED + '：UMD 版本必须和面板/宿主一致')
  }
  const to = join(outDir, file)
  await copyFile(from, to)
  const { size } = await stat(to)
  /* 生产版 UMD 只有几十 KB；太小说明拷错了（例如拿到 source map 或占位文件）。 */
  if (size < 5_000) throw new Error(file + ' 只有 ' + size + ' 字节，不像是完整的 UMD 产物')
  /* 内容护栏：确认真的是 UMD（IIFE + 挂到 global），不是 ESM 或 CJS 版本。 */
  const head = (await readFile(to, 'utf8')).slice(0, 400)
  if (!/React/.test(head)) throw new Error(file + ' 头部没有 React 版权头，可能拷错了文件')
  console.log('wrote', to, size, 'bytes (' + pkg + '@' + version + ')')
}
