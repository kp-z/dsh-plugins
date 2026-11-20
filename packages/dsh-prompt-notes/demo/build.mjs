// 用法：node demo/build.mjs  → 生成 demo/demo.html（单文件，双击即可在浏览器打开）
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')

/** 在工作区的 pnpm 仓库里找 esbuild / react；找不到就明确报错，而不是悄悄装东西。 */
function findPnpm(prefix, sub) {
  for (let dir = pkgDir, i = 0; i < 6; dir = dirname(dir), i++) {
    const store = join(dir, 'node_modules', '.pnpm')
    if (!existsSync(store)) continue
    const hit = readdirSync(store).filter((d) => d.startsWith(prefix)).sort().pop()
    if (hit) return join(store, hit, 'node_modules', sub)
  }
  throw new Error(`cannot find ${sub} in a pnpm store above ${pkgDir}`)
}
const esbuild = createRequire(import.meta.url)(findPnpm('esbuild@', 'esbuild'))
const react = findPnpm('react@', 'react')
const reactDom = findPnpm('react-dom@', 'react-dom')

const result = await esbuild.build({
  entryPoints: [join(here, 'entry.js')], bundle: true, write: false, format: 'iife', platform: 'browser',
  minify: true, legalComments: 'none', logLevel: 'warning',
  alias: { 'node:path': join(here, 'path-shim.js'), react, 'react-dom': reactDom },
  define: { 'process.env.NODE_ENV': '"production"' },
})
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const html = readFileSync(join(here, 'template.html'), 'utf8').replace('/*__BUNDLE__*/', () => js)
writeFileSync(join(here, 'demo.html'), html)
console.log(`demo/demo.html  ${(html.length / 1024).toFixed(0)} KB`)
