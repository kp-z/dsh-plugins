#!/usr/bin/env node
/** Offline: node scripts/import-echarts.mjs /path/to/echarts-examples > draft.json */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const revision = '88ca004030e999073a15303e5fe32462b8fefae2'
const repository = 'https://github.com/apache/echarts-examples'
const exampleBase = 'https://echarts.apache.org/examples/zh/editor.html'
const sourceRoot = process.argv[2]
if (!sourceRoot || execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== revision) {
  throw new Error('请指定已检出 ' + revision + ' 的 apache/echarts-examples 工作树')
}

function readIndex(gl) {
  const name = 'src/data/chart-list-data' + (gl ? '-gl' : '') + '.js'
  const text = readFileSync(path.join(sourceRoot, name), 'utf8')
  return JSON.parse(text.split('export default ')[1].trim().replace(/;$/, ''))
    .map((entry) => ({ ...entry, gl }))
}

const gradient = /^echarts\.graphic\.(?:LinearGradient|RadialGradient)$/

// Only literal configuration and ECharts gradient constructors run locally.
function isConfig(node, variables) {
  if (ts.isArrayLiteralExpression(node)) return node.elements.every((item) => isConfig(item, variables))
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((prop) => ts.isPropertyAssignment(prop) &&
      (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)) &&
      !['__proto__', 'constructor', 'prototype'].includes(prop.name.text) && isConfig(prop.initializer, variables))
  }
  if (ts.isStringLiteralLike(node)) return !/https?:|image:\/\/|^\/|^\.\.?.*\//i.test(node.text)
  if (ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return true
  if (ts.isIdentifier(node)) return variables.has(node.text)
  if (ts.isPrefixUnaryExpression(node)) {
    return [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operator) && ts.isNumericLiteral(node.operand)
  }
  return ts.isNewExpression(node) && gradient.test(node.expression.getText()) &&
    (node.arguments ?? []).every((arg) => isConfig(arg, variables))
}

function localOption(entry, file, source) {
  if (entry.gl || (entry.theme && entry.theme !== 'dark') || /\bdata:image\//i.test(source)) return null
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  if (ast.parseDiagnostics.length) return null
  const variables = new Set()
  const statements = []
  let option = false
  for (const node of ast.statements) {
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier &&
        node.exportClause && ts.isNamedExports(node.exportClause) && !node.exportClause.elements.length) continue
    if (option) return null
    if (ts.isVariableStatement(node) && (node.declarationList.flags & ts.NodeFlags.Const) && !node.modifiers?.length) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text === 'option' ||
            !decl.initializer || !isConfig(decl.initializer, variables)) return null
        variables.add(decl.name.text)
      }
    } else if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) &&
        node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.expression.left) && node.expression.left.text === 'option' &&
        ts.isObjectLiteralExpression(node.expression.right) && isConfig(node.expression.right, variables)) {
      option = true
    } else {
      return null
    }
    statements.push(node.getFullText(ast))
  }
  if (!option) return null
  return ts.transpileModule(statements.join(''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText.trim()
}

const previewCss = '.demo-stage:has(> .echarts-demo) { width: 100%; height: 100%; padding: 0; }\n'
  + '.echarts-demo { position: relative; width: 100%; height: 100%; background: #fff; overflow: hidden; }\n'
  + '.echarts-demo > div { position: absolute; left: 50%; top: 50%; width: 640px; height: 440px; }'

function localCode(entry, option) {
  return [
    { lang: 'html', body: '<div class="echarts-demo"><div></div></div>' },
    { lang: 'css', body: previewCss },
    { lang: 'js', body: [
      '// Apache-2.0. Spellbook adds the mount and sizing wrapper and removes TypeScript-only syntax.',
      'const frame = document.querySelector(".echarts-demo")',
      'const view = frame.firstElementChild',
      'const chart = echarts.init(view, ' + JSON.stringify(entry.theme ?? null) + ')',
      '// @mechanism 读取官方配置和内联数据，不改图表配置。',
      'const config = (() => {', 'let option', option, 'return option', '})()',
      'chart.setOption(config)',
      'const observer = new ResizeObserver(() => {',
      '  if (!frame.isConnected) { observer.disconnect(); chart.dispose(); return }',
      '  const scale = Math.min(frame.clientWidth / 640, frame.clientHeight / 440)',
      '  view.style.transform = "translate(-50%, -50%) scale(" + scale + ")"',
      '})', 'observer.observe(frame)',
    ].join('\n') },
  ]
}

function upstreamCode(entry, source, permalink) {
  const linkedOnly = /data:image\/[^;\s'"\x60]+;base64,|FlareVis|^\s*\x60{3}/mi.test(source)
  const annotation = '// @mechanism 由站内图版运行原始配置与数据。\n'
  const body = linkedOnly ? '// 原始示例源码：' + permalink : source.trimEnd()
  return [{ lang: entry.ts ? 'ts' : 'javascript', body: annotation + body }]
}
function prepare(entry) {
  if (!/^[\w-]+(?:\/[\w-]+)*$/.test(entry.id)) throw new Error('无效官方编号：' + entry.id)
  const slug = 'echarts-' + entry.id.toLowerCase().replace(/[\W_]+/g, '-')
  const sourcePath = 'public/examples/ts/' + (entry.gl ? 'gl/' : '') + entry.id + (entry.ts ? '.ts' : '.js')
  const source = readFileSync(path.join(sourceRoot, sourcePath), 'utf8')
  const title = (entry.titleCN || entry.title || entry.id).replace(/\s+/g, ' ').trim()
  const kind = entry.category.join(' / ')
  const upstream = repository + '/blob/' + revision + '/' + sourcePath
  const params = new URLSearchParams({ c: entry.id })
  if (entry.gl) params.set('gl', '1')
  if (entry.theme) params.set('theme', entry.theme)
  const option = localOption(entry, sourcePath, source)
  return {
    title, slug, category: '图形', tags: ['echarts', '图表', 'canvas'], since: '2026-11', stage: 'plain', tier: 'candidate',
    source: exampleBase + '?' + params,
    _rawRef: upstream,
    when: '要复用 Apache ECharts 的「' + title + '」官方示例',
    description: (entry.title && entry.title !== title ? entry.title + '。' : '') + '官方分类：' + kind + '。\n\n' +
      (option ? '机制是 ==由 ECharts 读取官方 option 与内联数据==，本地图版可直接运行。' :
        '机制是 ==沿用官方示例的配置、数据和运行环境==，图版在站内加载并运行。'),
    caveats: [option ? '本地引擎为 ECharts 6.1.0；复制到其他项目时需自行加载相应版本。' : '图版可能需要联网加载数据、主题或扩展；地图授权和 WebGL 适用性取决于运行环境。'],
    notes: ['固定提交源码：' + upstream, '示例源码：Apache-2.0；第三方素材以其原出处为准。'],
    code: option ? localCode(entry, option) : upstreamCode(entry, source, upstream),
  }
}

const existing = new Set(readdirSync(path.join(root, 'content/effects'))
  .filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3)))
const entries = [...readIndex(false), ...readIndex(true)].map(prepare)
if (new Set(entries.map((entry) => entry.slug)).size !== entries.length) throw new Error('官方编号归一化后有重复')
process.stdout.write(JSON.stringify(entries.filter((entry) => !existing.has(entry.slug)), null, 2) + '\n')
