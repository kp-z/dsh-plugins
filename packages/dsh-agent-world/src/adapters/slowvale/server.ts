/**
 * Slow Vale 适配层的 HTTP 入口（P0）。
 *
 * ## 为什么是独立端口，而不是挂在宿主 webServer 上
 *
 * Slow Vale 的构建产物用**根路径绝对地址**：/api/... 与 /assets/...。
 * 宿主 webServer 上挂插件要走前缀（/agent-world），而 /api/ 与 /assets/
 * 都是别人的座号——**改前缀就要重写 88 个 chunk 与 67 个 CSS 里的路径**，
 * 那是把一个可验证的适配层换成一次不可验证的字符串手术。
 *
 * 所以 P0 让适配层自己监听一个本地端口：同一个 origin，路径不用改，
 * 与宿主零耦合。等 P1 前端能自己改构建时再合并回 webServer。
 *
 * ## 推送策略：P0 用 resync 而不是 envelope
 *
 * 前端协议里有 update 信封（kind/route/cursor/prev/tick_marker/payload_gz），
 * 但那条路要求严格接续，写错一个字段就会触发无限 resync。P0 先用最笨但正确的方式：
 * 每个推送周期发一次 resync 全量快照。世界只有几十个角色时，这几十 KB 完全不算事。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { handleApi, type RouteContext } from './routes.js'
import { serveStatic } from './static.js'
import { autoEnterScript } from './auto-enter.js'
import { renderViewerHtml } from './viewer.js'
import { debugScript } from './debug.js'
import type { StageFrame } from './stage.js'
import { projectScene, projectSnapshot, type ProjectOptions } from './project.js'
import { SLOWVALE_PROTOCOL_VERSION } from './types.js'
import type { WorldLike } from './types.js'

/** 适配层启动参数。 */
export interface BridgeOptions {
  port: number
  host: string
  /** Slow Vale 构建产物目录（含 index.html 与 assets/）。 */
  assetsDir: string
  opts: ProjectOptions
  account: { email: string; password: string }
  getWorld: () => WorldLike | null
  /** 推送周期（ms）。0 = 不推，只发 connected。 */
  pushMs: number
  /**
   * 自动进入（跳过登录/授权/引导）。默认关。
   *
   * 打开后适配层会在 index.html 里注入一段脚本，沿着真实流程点一遍。
   * 这样做的原因见 auto-enter.ts 的注释：静态产物是逐字节固化的，不能改。
   */
  autoEnter?: boolean
  /** 注入调试采集脚本（不碰前端产物），排查用。 */
  debug?: boolean
  /** 极简可视化（/show）的状态来源；没给就没有这个页面。 */
  getStageFrame?: () => StageFrame | null
  log?: (line: string) => void
}

/** 启动后的句柄。 */
export interface Bridge {
  port: number
  close: () => Promise<void>
}

/** 调试脚本：必须最先执行，否则早期日志抓不到。 */
function injectDebug(html: string, enabled: boolean): string {
  if (!enabled || html.includes('/__slowvale/debug.js')) return html
  const tag = '<script src="/__slowvale/debug.js"></script>'
  const anchor = html.indexOf('<script')
  if (anchor < 0) return html.replace('</head>', tag + '</head>')
  return html.slice(0, anchor) + tag + '\n    ' + html.slice(anchor)
}

/** 把自动进入脚本插到第一个 module script 之前（必须在应用挂载前跑）。 */
function injectAutoEnter(html: string): string {
  const tag = '<script src="/__slowvale/auto-enter.js"></script>'
  if (html.includes('/__slowvale/auto-enter.js')) return html
  const anchor = html.indexOf('<script type="module"')
  if (anchor < 0) return html.replace('</body>', tag + '</body>')
  return html.slice(0, anchor) + tag + '\n    ' + html.slice(anchor)
}

export function createSlowvaleBridge(options: BridgeOptions): Promise<Bridge> {
  const log = options.log ?? (() => {})
  const clients = new Set<ServerResponse>()
  let timer: NodeJS.Timeout | null = null
  let closed = false

  const ctx: RouteContext = {
    opts: options.opts,
    account: options.account,
    getWorld: options.getWorld,
    token: () => 'local-' + randomUUID(),
    log,
    streamClients: () => clients.size,
  }

  const writeEvent = (res: ServerResponse, event: string, data: unknown): void => {
    res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n')
  }

  /**
   * 推一次增量：先 full（resync），之后只发 scene_state 信封。
   *
   * 为什么不能一直发 resync：resync 会让前端重建整份快照基线，场景层不会因此挂载；
   * 而**场景挂载只由 scene_state 信封驱动**（前端收到后去拉 /game/state/scene）。
   * 这是"画布在、地图资源也在下，但背景图始终没加载"的真正原因。
   */
  /**
   * 发一个 scene_state 信号。
   *
   * 前端只由这个信封驱动场景挂载：收到后它去拉 /game/state/scene 并启动 Phaser。
   * 只发 resync 的话，快照会一直重建，场景却永远不挂——这正是「画布在、背景图不请求」的原因。
   *
   * 形状有硬校验：payload 只能有 world_id 与 scene 两个键；route.scenes 必须恰好等于 [scene]。
   */
  const pushSceneState = (): void => {
    const world = options.getWorld()
    if (world === null || clients.size === 0) return
    const scene = projectSnapshot(world, options.opts).scene
    if (typeof scene !== 'string' || scene === '') return
    const tickMarker = 'tick-' + String(world.tick)
    const cursor = { epoch: 'epoch-' + world.id, seq: world.tick }
    const payloadGz = gzipSync(Buffer.from(JSON.stringify({ world_id: world.id, scene }))).toString('base64')
    // 信封是**单条**的：kind / route / payload_gz 都在顶层（前端 Fx() 逐字段校验）。
    const envelope = {
      protocol_version: SLOWVALE_PROTOCOL_VERSION,
      cursor,
      tick_marker: tickMarker,
      kind: 'scene_state',
      // broadcast=false 表示「定向」：scenes 必须非空；scene_state 要求恰好一个场景。
      route: { world_id: world.id, broadcast: false, role_ids: [], scenes: [scene] },
      payload_gz: payloadGz,
    }
    for (const res of clients) writeEvent(res, 'update', envelope)
  }

  const pushSnapshot = (event: string): void => {
    const world = options.getWorld()
    if (world === null || clients.size === 0) return
    const payload = projectSnapshot(world, options.opts)
    for (const res of clients) writeEvent(res, 'resync', payload)
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://' + options.host + ':' + String(options.port))

      // SSE 必须先于 API：它也是 /api/ 下的路径，但永远不结束响应。
      if (url.pathname === '/api/game/stream') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        res.write(': connected\n\n')
        clients.add(res)
        const world = options.getWorld()
        if (world !== null) {
          writeEvent(res, 'connected', projectSnapshot(world, options.opts))
          pushSceneState()
        }
        req.on('close', () => {
          clients.delete(res)
        })
        return
      }

      if (url.pathname === '/api/show/state') {
        const frame = options.getStageFrame?.() ?? null
        if (frame === null) {
          res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
          res.end('{"detail":"舞台还没起来"}')
          return
        }
        const body = Buffer.from(JSON.stringify(frame), 'utf8')
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.byteLength, 'cache-control': 'no-store' })
        res.end(body)
        return
      }
      if (url.pathname.startsWith('/api/')) {
        await handleApi(ctx, req, res, url)
        return
      }

      if (url.pathname === '/show') {
        const body = Buffer.from(renderViewerHtml(), 'utf8')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.byteLength })
        res.end(body)
        return
      }
      if (options.debug === true && url.pathname === '/__slowvale/debug.js') {
        const body = Buffer.from(debugScript(), 'utf8')
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': body.byteLength, 'cache-control': 'no-store' })
        res.end(body)
        return
      }
      if (options.autoEnter === true && url.pathname === '/__slowvale/auto-enter.js') {
        const body = Buffer.from(autoEnterScript(options.account), 'utf8')
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'content-length': body.byteLength,
          'cache-control': 'no-store',
        })
        res.end(body)
        return
      }

      serveStatic(
        options.assetsDir,
        req,
        res,
        url.pathname,
        options.autoEnter === true
          ? (html) => injectDebug(injectAutoEnter(html), options.debug === true)
          : options.debug === true
            ? (html) => injectDebug(html, true)
            : undefined,
      )
    })().catch((error: unknown) => {
      log('[slowvale] 请求处理失败 ' + String(error))
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end('{"detail":"internal error"}')
    })
  })

  if (options.pushMs > 0) {
    timer = setInterval(() => {
      if (closed) return
      try {
        pushSnapshot('resync')
        pushSceneState()
      } catch (error: unknown) {
        log('[slowvale] 推送失败 ' + String(error))
      }
    }, options.pushMs)
  }

  return new Promise((resolvePromise, reject) => {
    server.once('error', (error) => {
      reject(error instanceof Error ? error : new Error(String(error)))
    })
    server.listen(options.port, options.host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : options.port
      log('[slowvale] http://' + options.host + ':' + String(port) + '/')
      resolvePromise({
        port,
        close: async () => {
          closed = true
          if (timer !== null) clearInterval(timer)
          for (const res of clients) res.end()
          clients.clear()
          await new Promise<void>((done) => server.close(() => done()))
        },
      })
    })
  })
}
