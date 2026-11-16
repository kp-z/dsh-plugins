/**
 * 把 dagre（+ graphlib，含 lodash 依赖）打成**单文件 ESM**，放进 src/vendor/dagre.js。
 *
 * 为什么要 vendor 单文件：独立海湾页（/dsh-feishu/tasks）直接用浏览器 ESM 加载 src/*.js，
 * 裸模块名（dagre-d3-es / lodash-es）在浏览器里解析不了；打成相对路径的单文件后，
 * 面板、独立页、宿主 bundle 三处走同一份实现。
 *
 * 重新生成：node scripts/build-vendor-dagre.mjs
 */
import { rolldown } from 'rolldown'
import { rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
/* 入口必须放在插件目录里：rolldown 按入口所在目录解析 node_modules。 */
const entry = root + '.dagre-vendor-entry.js'
await writeFile(entry, [
  "export { Graph } from 'dagre-d3-es/src/graphlib/index.js'",
  "export { layout } from 'dagre-d3-es/src/dagre/layout.js'",
  '',
].join('\n'))
const bundle = await rolldown({ input: entry, cwd: root })
const { output } = await bundle.generate({ format: 'esm', minify: false })
await bundle.close()
const code = output[0].code
const banner = '/* dagre-d3-es 7.0.14 (MIT) + graphlib —— 由 scripts/build-vendor-dagre.mjs 生成，勿手改。 */\n'
const out = root + 'src/vendor/dagre.js'
await writeFile(out, banner + code)
await rm(entry, { force: true })
console.log('wrote', out, code.length, 'bytes')
