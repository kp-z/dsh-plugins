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
import { handleApi, type RouteContext } from './routes.js'
import { serveStatic } from './static.js'
import { projectSnapshot, type ProjectOptions } from './project.js'
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
  log?: (line: string) => void
}

/** 启动后的句柄。 */
export interface Bridge {
  port: number
  close: () => Promise<void>
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

  const pushSnapshot = (event: string): void => {
    const world = options.getWorld()
    if (world === null || clients.size === 0) return
    const payload = projectSnapshot(world, options.opts)
    for (const res of clients) writeEvent(res, event, payload)
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
        if (world !== null) writeEvent(res, 'connected', projectSnapshot(world, options.opts))
        req.on('close', () => {
          clients.delete(res)
        })
        return
      }

      if (url.pathname.startsWith('/api/')) {
        await handleApi(ctx, req, res, url)
        return
      }

      serveStatic(options.assetsDir, req, res, url.pathname)
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
