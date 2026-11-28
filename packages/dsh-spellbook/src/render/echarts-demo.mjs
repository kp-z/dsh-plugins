import ts from 'typescript'
import { escapeHtml, escapeScriptContent } from './text.mjs'

const UPSTREAM = 'https://cdn.jsdelivr.net/gh/apache/echarts-website@566f0e7d964f169b9e5fcd508daaf360fe5c188f/examples'
const RAW_ASSETS = 'https://raw.githubusercontent.com/apache/echarts-website/566f0e7d964f169b9e5fcd508daaf360fe5c188f/examples'
const CDN = 'https://cdn.jsdelivr.net/npm/'
const POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net/npm/ https://cdn.jsdelivr.net/gh/apache/echarts-website@566f0e7d964f169b9e5fcd508daaf360fe5c188f/ https://echarts.apache.org/en/asset/map/js/world.js",
  'connect-src ' + UPSTREAM + '/ ' + CDN + ' ' + RAW_ASSETS + '/data/asset/data/npmdepgraph.min10.json',
  'img-src data: blob: ' + UPSTREAM + '/ ' + CDN + ' ' + RAW_ASSETS + '/data/asset/img/custom-gauge-panel.png',
  "style-src 'unsafe-inline'", "font-src data:", "worker-src blob:",
  "base-uri 'none'", "form-action 'none'",
].join('; ')

/** 官方示例的身份：从 source 链接里取 c / gl / theme。拿不到就不是官方图版。 */
export function officialPreviewLink(entry) {
  if (!entry.meta.tags?.includes('echarts') || entry.code.some((block) => block.lang === 'js')) return null
  const link = entry.meta.source?.match(/https:\/\/echarts\.apache\.org\/examples\/(?:en|zh)\/editor\.html\?[\w%/=&.-]+/)?.[0]
  if (!link) return null
  const url = new URL(link)
  const id = url.searchParams.get('c') ?? ''
  if (!/^[\w-]+(?:\/[\w-]+)*$/.test(id)) return null
  return { id, gl: url.searchParams.get('gl') === '1', theme: url.searchParams.get('theme') }
}

function previewConfig(entry) {
  const link = officialPreviewLink(entry)
  if (!link) return null
  const block = entry.code.find((item) => item.lang === 'ts' || item.lang === 'javascript')
  const original = block?.lines.filter((line) => !line.startsWith('// @mechanism ')).join('\n')
    .trim().replace(/export\s+\{\s*\}\s*;?$/, '')
  const linkedOnly = original?.startsWith('// 原始示例源码：')
  const source = linkedOnly ? undefined : block?.lang === 'ts'
    ? ts.transpileModule(original, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    : original
  return { ...link, source, root: UPSTREAM, rawAssets: RAW_ASSETS, cdn: CDN }
}

const BRIDGE = String.raw`
const frame = document.querySelector('iframe')
const status = document.querySelector('output')
window.addEventListener('message', (event) => {
  if (event.source === parent && event.data?.type === 'spellbook:replay') {
    location.reload()
    return
  }
  if (event.source !== frame.contentWindow || event.data?.type !== 'spellbook:echarts-status') return
  const { state, message } = event.data
  if (state !== 'ready' && state !== 'error') return
  document.body.dataset.previewState = state
  status.textContent = typeof message === 'string' ? message : ''
  status.hidden = state === 'ready'

})
`

export function buildOfficialEchartsDemo(entry, title) {
  const config = previewConfig(entry)
  if (!config) return null
  const label = escapeHtml(title)
  const json = JSON.stringify(config).replace(/</g, '\\u003c')
  const sandbox = '<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="' + escapeHtml(POLICY) + '">'
    + '<style>html,body,#chart-container{width:100%;height:100%;margin:0;overflow:hidden;background:#fff} .dg.main *{box-sizing:content-box}</style>'
    + '<style id="chart-styles"></style><div id="chart-container" aria-label="' + label + '"></div>'
    + '<script id="echarts-example" type="application/json">' + json + '</script>'
    + '<script src="../../vendor/echarts/official-preview.js"></script></html>'
  // The nested frame also stays opaque if someone opens demo.html directly.
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + label + ' · 图版</title>'
    + '<style>body{margin:0}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}'
    + 'output{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:16px;background:#faf9f5;color:#183244;font:14px/1.5 system-ui;pointer-events:none} output[hidden]{display:none}</style>'
    + '<body data-preview-state="loading"><iframe title="' + label + '" sandbox="allow-scripts" srcdoc="' + escapeHtml(sandbox) + '"></iframe>'
    + '<output aria-live="polite">正在加载图版…</output><script>' + escapeScriptContent(BRIDGE) + '</script></body></html>\n'
}
