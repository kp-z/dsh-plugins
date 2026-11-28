/**
 * 卡片预览图：把每条咒语的图版截成一张静图。
 *
 * 为什么要有这一份：目录里 822 张卡，如果每张都挂一个 iframe 真跑图版，
 * 一屏就要起十几个文档（官方 ECharts 那些还要各解析一份 1MB 的引擎），
 * 侧边栏里滚动会一直卡。静图让列表回到「只加载图片」的量级，
 * 真跑留给打开条目 / 放大预览 —— 那里一次只跑一个。
 *
 * 流程 1：起一个只读静态服务（dist/），图版自己用相对路径取引擎与样式。
 * 流程 2：起一个 headless Chrome，走 CDP 逐条打开 demo.html。
 * 流程 3：等图版自己说「画好了」（官方图版是两层 iframe，外层 load 时还是空的），
 *         再等一小会儿让图表动画落定，然后截图。
 * 流程 4：写 preview/<slug>.webp 与 preview/index.json；内容没变的条目默认跳过。
 * 流程 5（可选）：跑完自动 build 一次，把图与 <img> 挂进 dist。
 *
 * 用法：
 *   node scripts/previews.mjs                 # 增量：只补新的/变了的
 *   node scripts/previews.mjs --force         # 全部重截
 *   node scripts/previews.mjs --only a,b      # 只截这几条（调试用）
 *   node scripts/previews.mjs --no-build      # 不自动 build
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const OUT = path.join(ROOT, 'preview')
const MANIFEST = path.join(OUT, 'index.json')

/** 换了尺寸 / 格式，旧图就不算数了 —— 哈希里带上它。等待策略不进哈希：见 --force。 */
const SHOT_VERSION = 'v1'
const WIDTH = 400
const HEIGHT = 250
const DPR = 2
const SETTLE_MS = 700   // 官方图版报告 ready 之后，图表动画还要跑一会儿

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

function arg(name) {
  const i = process.argv.indexOf('--' + name)
  return i === -1 ? undefined : (process.argv[i + 1] ?? '')
}
const flag = (name) => process.argv.includes('--' + name)

/** 流程 1：静态服务。图版里全是相对路径，所以根就是 dist/。 */
function startServer(root) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://x')
        let file = path.join(root, decodeURIComponent(url.pathname))
        if (!file.startsWith(root)) { res.writeHead(403); res.end(); return }
        if ((await stat(file).catch(() => null))?.isDirectory()) file = path.join(file, 'index.html')
        const body = await readFile(file)
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
        res.end(body)
      } catch {
        res.writeHead(404); res.end('not found')
      }
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({
      url: 'http://127.0.0.1:' + server.address().port,
      close: () => new Promise((done) => server.close(done)),
    }))
  })
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error('找不到 Chrome。装一个，或用 CHROME_PATH 指定路径。')
  return found
}

/** 流程 2：起 Chrome 并连上它。--remote-debugging-port=0 会从 stderr 报出端口。 */
async function launchChrome() {
  const profile = await mkdtemp(path.join(tmpdir(), 'spellbook-shot-'))
  const child = spawn(chromePath(), [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    // 构建常在受限沙箱里跑（文件系统策略会挡 Chromium 自己的沙箱），关掉它才起得来
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--enable-unsafe-swiftshader', // 3D / GL 图版在无头里也能画
    '--window-size=' + WIDTH + ',' + HEIGHT,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  const endpoint = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('Chrome 没有在 20s 内报出调试端口')), 20000)
    child.stderr.on('data', (chunk) => {
      buffer += String(chunk)
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(buffer)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
    child.on('exit', () => reject(new Error('Chrome 提前退出了')))
  })

  const port = new URL(endpoint).port
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('Chrome 里没有页面目标')

  return { child, pageWs: page.webSocketDebuggerUrl, close: async () => { child.kill('SIGKILL'); await rm(profile, { recursive: true, force: true }) } }
}

/** 最小 CDP 客户端：只需要 navigate / evaluate / screenshot。 */
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data))
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(msg.error.message))
      else entry.resolve(msg.result)
    })
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () => reject(new Error('CDP 连接失败')))
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(method + ' 超时'))
      }, 30000)
    })
  }
  close() { try { this.ws.close() } catch {} }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 流程 3：等这一页真的画完。返回 'ready' | 'error'。 */
async function waitPainted(cdp, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        if (document.readyState !== 'complete') return 'loading'
        const s = document.body && document.body.dataset.previewState
        if (s === 'ready') return 'ready'
        if (s === 'error') return 'error'
        if (s) return 'loading'
        return 'plain'
      })()`,
      returnByValue: true,
    })
    const value = state.result?.value
    if (value === 'ready') return 'official'
    if (value === 'error') return 'error'
    if (value === 'plain') {
      // 通用图版：脚本在解析时同步挂上，等两帧让首帧落下去
      await cdp.send('Runtime.evaluate', { expression: 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))', awaitPromise: true })
      return 'plain'
    }
    await sleep(120)
  }
  return 'timeout'
}

async function main() {
  const force = flag('force')
  // 调试用：--format png 存 PNG，好让 scripts/ascii.mjs 能在终端里「看」一眼
  const format = arg('format') ?? 'webp'
  const ext = format === 'png' ? '.png' : '.webp'
  const only = (arg('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const entries = JSON.parse(await readFile(path.join(DIST, 'effects.json'), 'utf8')).effects
  const targets = only.length ? entries.filter((e) => only.includes(e.slug)) : entries

  const previous = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')) : { version: SHOT_VERSION, shots: {} }
  const shots = { ...previous.shots }
  await mkdir(OUT, { recursive: true })

  const bootAt = Date.now()
  const server = await startServer(DIST)
  const chrome = await launchChrome()
  const cdp = new Cdp(chrome.pageWs)
  await cdp.open()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR, mobile: false })

  let shot = 0
  let skipped = 0
  const failed = []
  const started = Date.now()

  try {
    for (const entry of targets) {
      const slug = entry.slug
      const demoPath = path.join(DIST, 'spell', slug, 'demo.html')
      const demo = await readFile(demoPath)
      const hash = createHash('sha1').update(SHOT_VERSION).update(format).update(String(WIDTH)).update(String(DPR)).update(demo).digest('hex').slice(0, 16)
      const file = path.join(OUT, slug + ext)
      if (!force && previous.shots[slug]?.hash === hash && existsSync(file)) { skipped++; continue }

      await cdp.send('Page.navigate', { url: server.url + '/spell/' + encodeURIComponent(slug) + '/demo.html' })
      const state = await waitPainted(cdp)
      if (state === 'error' || state === 'timeout') {
        failed.push(slug + ' (图版自己报错：' + state + ')')
        continue
      }
      // 两类等待，各管各的：
      //   · 图表类（官方 + 自带引擎的通用图版）：ready 只是第一帧，ECharts 的动画不归
      //     Web Animations 管，只能定时等一会儿；
      //   · 其余（CSS 动画 / 过渡）：等页面自己的动画真的跑完 —— 固定时长要么截到一半，
      //     要么白等；无限动画（骨架扫光之类）等不到头，2500ms 兜底，截一帧也是对的。
      const chart = demo.includes(Buffer.from('vendor/echarts/echarts.min.js'))
      if (state === 'official' || chart) {
        await sleep(SETTLE_MS)
      } else {
        await cdp.send('Runtime.evaluate', {
          // 只等会结束的动画：无限循环的（骨架扫光、脉冲）永远等不到头，
          // 截它任意一帧都是对的，不该为它白等满兜底时长。
          expression: 'Promise.race([Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 2500))])',
          awaitPromise: true,
        })
      }
      const result = await cdp.send('Page.captureScreenshot', { format, quality: 78 })
      const bytes = Buffer.from(result.data, 'base64')
      if (bytes.length < 1024) { failed.push(slug + ' (截图是空的)'); continue }
      await mkdir(OUT, { recursive: true })
      await writeFile(file, bytes)
      shots[slug] = { hash, ext, bytes: bytes.length, at: new Date().toISOString() }
      shot++
      if (shot % 20 === 0) console.log('  已截 ' + shot + ' 张，失败 ' + failed.length + '，用时 ' + Math.round((Date.now() - started) / 1000) + 's')
    }
  } finally {
    // 条目删掉后，它的旧图与清单条目也要清掉 —— 否则一个不再存在的 slug 会永远占着 dist。
    // --only 是调试用的局部截图，不动全局。
    if (!only.length) {
      const alive = new Set(entries.map((entry) => entry.slug))
      for (const slug of Object.keys(shots)) if (!alive.has(slug)) delete shots[slug]
      for (const name of await readdir(OUT).catch(() => [])) {
        if (!/\.(webp|png)$/.test(name)) continue
        if (!shots[name.replace(/\.(webp|png)$/, '')]) await rm(path.join(OUT, name), { force: true })
      }
    }
    const closeAt = Date.now()
    cdp.close()
    await chrome.close()
    await server.close()
    await writeFile(MANIFEST, JSON.stringify({ version: SHOT_VERSION, width: WIDTH, height: HEIGHT, dpr: DPR, shots }, null, 1) + '\n')
    console.log('  收尾 ' + (Date.now() - closeAt) + 'ms，主循环前耗时 ' + (closeAt - bootAt) + 'ms')
  }

  const seconds = Math.round((Date.now() - started) / 1000)
  console.log('截图完成：新截 ' + shot + '，跳过 ' + skipped + '，失败 ' + failed.length + '，用时 ' + seconds + 's')
  if (failed.length) console.log('失败：\n  ' + failed.join('\n  '))

  if (!flag('no-build') && shot > 0) {
    console.log('重新构建，把图挂进 dist …')
    await new Promise((resolve, reject) => {
      const build = spawn(process.execPath, ['build.mjs'], { cwd: ROOT, stdio: 'inherit' })
      build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('build 失败：' + code))))
    })
  }

  // 关掉 Chrome 之后 undici 的 WebSocket 还要等它自己的关闭超时（实测 20 多秒），
  // 这脚本的钱是截图，不是等收尾 —— 直接退。
  process.exit(0)
}

await main()
