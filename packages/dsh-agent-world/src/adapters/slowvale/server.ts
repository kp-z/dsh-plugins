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
import { debugScript } from './debug.js'
import { projectScene, projectSnapshot, type ProjectOptions } from './project.js'
import { SmsStore } from './sms.js'
import { loadXcityBindings } from './xcity.js'
import { independentDialogue } from './visual.js'
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
  /** xcity/bindings.json 的绝对路径（谁代表谁）；不配就没有这个投影。 */
  bindingsFile?: string
  /** 只在场景变化时推 scene_state（默认每秒重发，会让前端反复转场）。 */
  sceneStateOnChangeOnly?: boolean
  /** 本机调试用：把后台/无头窗口当成可见（前端不可见时不建 Phaser 游戏）。 */
  forceVisible?: boolean
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

  // 短信线程挂在世界这一侧：会话可以归档换人，聊天记录不能丢。
  const sms = new SmsStore()

  const ctx: RouteContext = {
    opts: options.opts,
    account: options.account,
    getWorld: options.getWorld,
    sms,
    token: () => 'local-' + randomUUID(),
    log,
    streamClients: () => clients.size,
  }

  const writeEvent = (res: ServerResponse, event: string, data: unknown): void => {
    res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n')
  }

  /**
   * 推送策略：连上时给一次 resync（整份快照建立基线），之后**只发 scene_state 信封**。
   *
   * 两条都是踩出来的：
   * 1. 一直发 resync 会把基线反复重建，场景永远不挂；
   * 2. 信封的 cursor 必须**逐条递增并带 prev**，否则前端判「cursor 链断裂」并要求整体重同步。
   */
  let envelopeSeq = 0
  let lastCursor: { epoch: string; seq: number } | null = null

  const pushSnapshot = (event: string): void => {
    const world = options.getWorld()
    if (world === null || clients.size === 0) return
    const payload = projectSnapshot(world, options.opts)
    envelopeSeq += 1
    const cursor = { epoch: 'epoch-' + world.id, seq: envelopeSeq }
    const withCursor = { ...payload, cursor }
    lastCursor = cursor
    for (const res of clients) writeEvent(res, event, withCursor)
  }

  /**
   * 发一个 scene_state 信号（信封形状由前端逐字段硬校验）：
   * - 顶层：protocol_version / cursor / prev / tick_marker / kind / route / payload_gz
   * - route：broadcast=false 时 scenes 必须非空，且 scene_state 要求恰好一个场景
   * - payload：只允许 { world_id, scene } 两个键
   */
  let lastPushedScene: string | null = null

  const pushSceneState = (): void => {
    const world = options.getWorld()
    if (world === null || clients.size === 0) return
    const scene = projectSnapshot(world, options.opts).scene
    if (typeof scene !== 'string' || scene === '') return
    // 只在场景**变化**时推：每秒重发同一场景会让前端反复转场，
    // 每次转场都会打断上一个场景的 loader.start() → 报「资源加载无进展」。
    if (options.sceneStateOnChangeOnly === true && scene === lastPushedScene) return
    lastPushedScene = scene
    envelopeSeq += 1
    const cursor = { epoch: 'epoch-' + world.id, seq: envelopeSeq }
    const payloadGz = gzipSync(Buffer.from(JSON.stringify({ world_id: world.id, scene }))).toString('base64')
    const envelope = {
      protocol_version: SLOWVALE_PROTOCOL_VERSION,
      cursor,
      prev: lastCursor,
      tick_marker: 'tick-' + String(world.tick),
      kind: 'scene_state',
      route: { world_id: world.id, broadcast: false, role_ids: [], scenes: [scene] },
      payload_gz: payloadGz,
    }
    lastCursor = cursor
    for (const res of clients) writeEvent(res, 'update', envelope)
  }


  /**
   * 推一个 state 分片（信封 kind='state'）。
   *
   * 这是**真正喂数据**的那条路：scene_state 只广播"我在哪个场景"，
   * 场景内容（家具、安装物件、拓扑）靠 state 分片持续推。
   *
   * 形状（前端 Ix() 校验）：{ part, operation: 'replace' | 'remove', key, payload }
   * - keyed part（place_runtime / place_topology / role_core …）key 必须非空；
   * - place_runtime 的 payload.place_id 必须等于 key；
   * - place_topology 的 payload.id 必须等于 key。
   */
  const pushStatePart = (part: string, key: string, payload: Record<string, unknown>, scene: string): void => {
    const world = options.getWorld()
    if (world === null || clients.size === 0) return
    envelopeSeq += 1
    const cursor = { epoch: 'epoch-' + world.id, seq: envelopeSeq }
    const body = gzipSync(Buffer.from(JSON.stringify({ part, operation: 'replace', key, payload }))).toString('base64')
    const envelope = {
      protocol_version: SLOWVALE_PROTOCOL_VERSION,
      cursor,
      prev: lastCursor,
      tick_marker: 'tick-' + String(world.tick),
      kind: 'state',
      route: { world_id: world.id, broadcast: false, role_ids: [], scenes: [scene] },
      payload_gz: body,
    }
    lastCursor = cursor
    for (const res of clients) writeEvent(res, 'update', envelope)
  }

  /**
   * 让某个角色在场景里说一句话（visual 包，一拍 dialogue）。
   *
   * 对话在这套前端里不是接口，是视觉时间轴上的一拍；这条是唯一的出口。
   */
  const pushSay = (actorId: string, text: string): boolean => {
    const world = options.getWorld()
    if (world === null || clients.size === 0) return false
    const scene = projectSnapshot(world, options.opts).scene
    if (typeof scene !== 'string' || scene === '') return false
    envelopeSeq += 1
    const tickMarker = 'tick-' + String(world.tick)
    const cursor = { epoch: 'epoch-' + world.id, seq: envelopeSeq }
    const packet = independentDialogue({
      epoch: cursor.epoch,
      seq: envelopeSeq,
      tickMarker,
      actorId,
      beat: { text },
    })
    const body = gzipSync(Buffer.from(JSON.stringify(packet))).toString('base64')
    const envelope = {
      protocol_version: SLOWVALE_PROTOCOL_VERSION,
      cursor,
      prev: lastCursor,
      tick_marker: tickMarker,
      kind: 'visual',
      route: { world_id: world.id, broadcast: false, role_ids: [actorId], scenes: [scene] },
      payload_gz: body,
    }
    lastCursor = cursor
    for (const res of clients) writeEvent(res, 'update', envelope)
    return true
  }

  /** 推一次 furniture 信封（kind=furniture）。 */
  const pushFurniture = (): void => {
    const world = options.getWorld()
    if (world === null || clients.size === 0) return
    const snapshot = projectSnapshot(world, options.opts)
    const scene = snapshot.scene
    if (typeof scene !== 'string' || scene === '') return
    envelopeSeq += 1
    const cursor = { epoch: 'epoch-' + world.id, seq: envelopeSeq }
    const payload = { place_id: options.opts.place, furniture: [] }
    const body = gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64')
    const envelope = {
      protocol_version: SLOWVALE_PROTOCOL_VERSION,
      cursor,
      prev: lastCursor,
      tick_marker: 'tick-' + String(world.tick),
      kind: 'furniture',
      route: { world_id: world.id, broadcast: false, role_ids: [], scenes: [scene] },
      payload_gz: body,
    }
    lastCursor = cursor
    for (const res of clients) writeEvent(res, 'update', envelope)
  }

  /** 把当前场景的内容（runtime + 拓扑）推给前端。 */
  const pushSceneContent = (): void => {
    const world = options.getWorld()
    if (world === null || clients.size === 0) return
    const snapshot = projectSnapshot(world, options.opts)
    const scene = snapshot.scene
    if (typeof scene !== 'string' || scene === '') return
    const place = options.opts.place
    pushStatePart('place_runtime', place, { place_id: place, furniture: [], installed_appliances: [] }, scene)
    // furniture 信封：场景家具（这里先空）。前端把它当作场景可交互层的屏障事件。
    pushFurniture()
    pushStatePart(
      'place_topology',
      place,
      { id: place, place_id: place, scene, name: String(place), place_type: 'building', parent_id: null },
      scene,
    )
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
          // connected 会重置基线；紧跟着发一次 resync 建立 cursor 链的起点
          writeEvent(res, 'connected', projectSnapshot(world, options.opts))
          pushSnapshot('resync')
        }
        req.on('close', () => {
          clients.delete(res)
        })
        return
      }

      // 谁代表谁：只读投影工作区里的 xcity/bindings.json（写入走 dsh-slowvale 的绑定表）。
      // 让某个角色开口：调试用入口，验证「对话 = 视觉时间轴上的一拍」。
      if (url.pathname === '/api/xcity/say' && req.method === 'POST') {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        let payload: { roleId?: unknown; text?: unknown } = {}
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { roleId?: unknown; text?: unknown }
        } catch {
          payload = {}
        }
        const roleId = typeof payload.roleId === 'string' ? payload.roleId : ''
        const text = typeof payload.text === 'string' ? payload.text : ''
        const ok = roleId !== '' && text !== '' && pushSay(roleId, text)
        const body = Buffer.from(JSON.stringify({ ok }), 'utf8')
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.byteLength })
        res.end(body)
        return
      }
      if (url.pathname === '/api/xcity/bindings' && req.method === 'GET') {
        const bindings = loadXcityBindings(options.bindingsFile ?? null)
        const body = Buffer.from(JSON.stringify({ bindings }), 'utf8')
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.byteLength, 'cache-control': 'no-store' })
        res.end(body)
        return
      }
      if (url.pathname.startsWith('/api/')) {
        await handleApi(ctx, req, res, url)
        return
      }

      if (options.debug === true && url.pathname === '/__slowvale/debug.js') {
        const body = Buffer.from(debugScript(options.forceVisible === true), 'utf8')
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

      // 地图目录下的 furniture.json 官方产物里没有（是按家具动态生成的）。
      // 场景 preload 里会去 load.json 它，404 就中断后续贴图加载；这里给一个合法空对象。
      if (/^\/assets\/maps\/[^/]+\/furniture\.json$/.test(url.pathname)) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end('{"faces":[]}')
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
        pushSceneState()
        pushSceneContent()
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
