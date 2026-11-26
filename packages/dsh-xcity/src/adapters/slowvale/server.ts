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
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { handleApi, type RouteContext } from './routes.js'
import { serveStatic } from './static.js'
import { debugScript } from './debug.js'
import { epochOf, feedHeadOf, projectPhone, projectScene, projectSnapshot, publicStatusOf, type ProjectOptions } from './project.js'
import { SmsStore } from './sms.js'
import { loadAgentMap, loadXcityBindings } from './xcity.js'
import { independentDialogue, independentTimeline, pickWalkStarts, walkBeat } from './visual.js'
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
  /** 注入调试采集脚本（不碰前端产物），排查用。 */
  debug?: boolean
  /**
   * 「谁来回这条短信」。返回 null = 这次不回。
   *
   * 适配层**不自己编回复**：没有绑定会话就没有回复，这是诚实的默认值。
   * 接上 DSH 会话后由插件注入这个端口（src/index.ts）。
   */
  respondSms?: (input: {
    threadId: string
    peerRoleId: string
    peerName: string
    content: string
    tick: number
  }) => Promise<string | null>
  /** 玩家给角色发短信时，把这句话直接翻成世界动作（不依赖模型回话）。 */
  applyDirective?: ((roleId: string, text: string) => boolean) | null
  /**
   * 给角色开一条属于 xcity 工作区的会话（照 cove-task 的做法）。
   *
   * 没接这个端口 = 不会自己建会话（默认），此时只能绑用户已经有的会话。
   */
  spawnSession?: (input: { characterId: string; characterName: string }) => Promise<{ ok: boolean; sessionId?: string; reason?: string }>
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
  /** 会话侧说的话写回游戏短信线程（回复方向）。 */
  appendIncoming: (peerRoleId: string, peerName: string, content: string) => boolean
  /** 当前 SSE 连接数（有几个观众）。 */
  clientCount: () => number
}

/** 调试脚本：必须最先执行，否则早期日志抓不到。 */
function injectDebug(html: string, enabled: boolean): string {
  if (!enabled || html.includes('/__slowvale/debug.js')) return html
  const tag = '<script src="/__slowvale/debug.js"></script>'
  const anchor = html.indexOf('<script')
  if (anchor < 0) return html.replace('</head>', tag + '</head>')
  return html.slice(0, anchor) + tag + '\n    ' + html.slice(anchor)
}

/** 从 Cookie 里取上次停留的路径（只认 /world/...，别的一律当没有）。 */
function resumePathOf(req: import('node:http').IncomingMessage): string | null {
  const raw = req.headers.cookie
  if (typeof raw !== 'string') return null
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key !== 'xcity_resume') continue
    const value = decodeURIComponent(rest.join('='))
    return /^\/world\/[^/]+/.test(value) ? value : null
  }
  return null
}

export function createSlowvaleBridge(options: BridgeOptions): Promise<Bridge> {
  const log = options.log ?? (() => {})
  const clients = new Set<ServerResponse>()
  let timer: NodeJS.Timeout | null = null
  let closed = false
  /**
   * 上次停在哪个世界（进程内记忆）。
   *
   * 为什么不只靠 Cookie：DSH 把小镇放在 iframe 里，切 tab 会重建 iframe；
   * 某些环境里第三方 Cookie 被丢，于是回到 "/" 只会看到角色选择页。
   * 单机单人场景下，直接记在进程里最稳。
   */
  let lastWorldPath: string | null = null
  /** 文档请求计数（/ 与 /world/*）。切 tab 后这个数不变，就说明 iframe 没被重建。 */
  let documentLoads = 0

  // 短信线程挂在世界这一侧：会话可以归档换人，聊天记录不能丢。
  // 账号固定 + 单机：token 由账号派生，进程生命周期内不变。
  const localToken = 'local-' + createHash('sha1').update(options.account.email).digest('hex').slice(0, 16)
  const sms = new SmsStore()
  sms.useResponder(options.respondSms ?? null)
  log('[slowvale] responder ' + (typeof options.respondSms === 'function' ? '已接' : '为空'))

  const ctx: RouteContext = {
    opts: options.opts,
    account: options.account,
    getWorld: options.getWorld,
    sms,
    // 单机单账号：token 必须是稳定的（之前每次都 randomUUID，登录拿 A、刷新拿 B，
    // 前端一旦比对就当成会话被顶掉，退回登录页）。
    token: () => localToken,
    log,
    streamClients: () => clients.size,
    realtimeSeq: () => envelopeSeq,
    // 这个字段之前漏了：BridgeOptions 收了 applyDirective，却没传给 RouteContext，
    // 于是 ctx.applyDirective 永远是 undefined，短信指令这条路静默失效。
    applyDirective: options.applyDirective ?? null,
  }

  const writeEvent = (res: ServerResponse, event: string, data: unknown): void => {
    res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n')
  }

  // Increment only for updates shared by all subscribers. Joining takes a snapshot at the current cursor.
  let envelopeSeq = 0
  let lastCursor: { epoch: string; seq: number } | null = null

  const connectSnapshot = (res: ServerResponse, world: WorldLike): void => {
    const epoch = epochOf(world)
    const cursor = { epoch, seq: envelopeSeq }
    const snapshot = { ...projectSnapshot(world, { ...options.opts, phone: sms.signal() }), cursor }
    // A different world really does require a new baseline for established clients.
    if (lastCursor !== null && lastCursor.epoch !== epoch) {
      for (const client of clients) if (client !== res) writeEvent(client, 'resync', snapshot)
    }
    lastCursor = cursor
    writeEvent(res, 'connected', snapshot)
  }

  /**
   * 发一个 scene_state 信号（信封形状由前端逐字段硬校验）：
   * - 顶层：protocol_version / cursor / prev / tick_marker / kind / route / payload_gz
   * - route：broadcast=false 时 scenes 必须非空，且 scene_state 要求恰好一个场景
   * - payload：只允许 { world_id, scene } 两个键
   */
  let lastPushedScene: string | null = null
  /** 上一轮每个角色的剩余路径长度：用来判断"这一轮是不是刚开始走"。 */
  const walkLengths = new Map<string, number>()

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
    const cursor = { epoch: epochOf(world), seq: envelopeSeq }
    const payloadGz = gzipSync(Buffer.from(JSON.stringify({ world_id: options.opts.worldId, scene }))).toString('base64')
    const envelope = {
      protocol_version: SLOWVALE_PROTOCOL_VERSION,
      cursor,
      prev: lastCursor,
      tick_marker: 'tick-' + String(world.tick),
      kind: 'scene_state',
      route: { world_id: options.opts.worldId, broadcast: false, role_ids: [], scenes: [scene] },
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
  const pushStatePart = (part: string, key: string, payload: Record<string, unknown>, route: { role_ids: string[]; scenes: string[]; broadcast?: true }): void => {
    const world = options.getWorld()
    if (world === null || clients.size === 0) return
    envelopeSeq += 1
    const cursor = { epoch: epochOf(world), seq: envelopeSeq }
    const body = gzipSync(Buffer.from(JSON.stringify({ part, operation: 'replace', key, payload }))).toString('base64')
    const envelope = {
      protocol_version: SLOWVALE_PROTOCOL_VERSION,
      cursor,
      prev: lastCursor,
      tick_marker: 'tick-' + String(world.tick),
      kind: 'state',
      route: { world_id: options.opts.worldId, broadcast: false, ...route },
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
    const cursor = { epoch: epochOf(world), seq: envelopeSeq }
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
      route: { world_id: options.opts.worldId, broadcast: false, role_ids: [actorId], scenes: [scene] },
      payload_gz: body,
    }
    lastCursor = cursor
    for (const res of clients) writeEvent(res, 'update', envelope)
    return true
  }

  /** 推一个 independent 时间轴（一个角色的若干拍）。 */
  const pushTimeline = (actorId: string, beats: Record<string, unknown>[]): boolean => {
    const world = options.getWorld()
    if (world === null || clients.size === 0 || beats.length === 0) return false
    const scene = projectSnapshot(world, options.opts).scene
    if (typeof scene !== 'string' || scene === '') return false
    envelopeSeq += 1
    const tickMarker = 'tick-' + String(world.tick)
    const cursor = { epoch: epochOf(world), seq: envelopeSeq }
    const packet = independentTimeline({ epoch: cursor.epoch, seq: envelopeSeq, tickMarker, actorId, beats: beats as never })
    const body = gzipSync(Buffer.from(JSON.stringify(packet))).toString('base64')
    const envelope = {
      protocol_version: SLOWVALE_PROTOCOL_VERSION,
      cursor,
      prev: lastCursor,
      tick_marker: tickMarker,
      kind: 'visual',
      route: { world_id: options.opts.worldId, broadcast: false, role_ids: [actorId], scenes: [scene] },
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
    const cursor = { epoch: epochOf(world), seq: envelopeSeq }
    const payload = { place_id: options.opts.place, furniture: [] }
    const body = gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64')
    const envelope = {
      protocol_version: SLOWVALE_PROTOCOL_VERSION,
      cursor,
      prev: lastCursor,
      tick_marker: 'tick-' + String(world.tick),
      kind: 'furniture',
      route: { world_id: options.opts.worldId, broadcast: false, role_ids: [], scenes: [scene] },
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
    pushStatePart('place_runtime', place, { place_id: place, furniture: [], installed_appliances: [] }, { role_ids: [], scenes: [scene] })
    // furniture 信封：场景家具（这里先空）。前端把它当作场景可交互层的屏障事件。
    pushFurniture()
    pushStatePart(
      'place_topology',
      place,
      { id: place, place_id: place, scene, name: String(place), place_type: 'building', parent_id: null },
      { role_ids: [], scenes: [scene] },
    )
  }

  let statusEpoch: string | null = null
  let activeStatuses = new Map<string, string>()
  const pushActivityChanges = (world: WorldLike): void => {
    const epoch = epochOf(world)
    if (statusEpoch !== epoch) activeStatuses.clear()
    statusEpoch = epoch
    const broadcast = { broadcast: true as const, role_ids: [], scenes: [] }
    const next = new Map<string, string>()
    for (const agent of world.agents) {
      const status = publicStatusOf(world, agent, options.opts.startDate)
      if (status['active_activity'] === undefined) continue
      const signature = JSON.stringify(status)
      next.set(agent.id, signature)
      if (activeStatuses.get(agent.id) !== signature) pushStatePart('role_public_status', agent.id, status, broadcast)
    }
    for (const id of activeStatuses.keys()) {
      if (!next.has(id)) pushStatePart('role_public_status', id, { status: 'offline' }, broadcast)
    }
    activeStatuses = next
  }

  let lastPhone = sms.signal()
  const pushPhoneIfChanged = (): void => {
    const signal = sms.signal()
    if (signal.rowId === lastPhone.rowId && signal.unread === lastPhone.unread) return
    lastPhone = signal
    const world = options.getWorld()
    const roleId = world?.agents.find((agent) => agent.id === options.opts.viewerRoleId)?.id ?? world?.agents[0]?.id
    if (!roleId) return
    pushStatePart('role_phone', roleId, projectPhone(signal), { role_ids: [roleId], scenes: [] })
  }

  // The original client recovers logs through catch-up without a world resync.
  let lastLogHead: { epoch: string; roleId: string; head: number } | null = null
  const signalLogHead = (initial = false): void => {
    const world = options.getWorld()
    if (world === null || clients.size === 0) return
    const roleId = world.agents.find((agent) => agent.id === options.opts.viewerRoleId)?.id ?? world.agents[0]?.id
    if (!roleId) return
    const epoch = epochOf(world)
    const head = feedHeadOf(world)
    if (lastLogHead?.head === head && lastLogHead.epoch === epoch && lastLogHead.roleId === roleId) return
    lastLogHead = { epoch, roleId, head }
    if (initial || head === 0) return
    const cursor = { epoch, seq: ++envelopeSeq }
    const envelope = {
      protocol_version: SLOWVALE_PROTOCOL_VERSION,
      cursor,
      prev: lastCursor,
      tick_marker: 'tick-' + String(world.tick),
      kind: 'log_resync',
      route: { world_id: options.opts.worldId, broadcast: false, role_ids: [roleId], scenes: [] },
      payload_gz: null,
    }
    lastCursor = cursor
    for (const res of clients) writeEvent(res, 'update', envelope)
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
          connectSnapshot(res, world)
          if (clients.size === 1) {
            activeStatuses.clear()
            signalLogHead(true)
          }
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
      // 让插件自己开一条会话给某个角色（cwd = xcity 工作区）。
      if (url.pathname === '/api/xcity/spawn' && req.method === 'POST') {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        let payload: { characterId?: unknown; characterName?: unknown } = {}
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { characterId?: unknown; characterName?: unknown }
        } catch {
          payload = {}
        }
        const characterId = typeof payload.characterId === 'string' ? payload.characterId : ''
        const characterName = typeof payload.characterName === 'string' ? payload.characterName : characterId
        const result =
          characterId === '' || options.spawnSession === undefined
            ? { ok: false, reason: '没有接建会话端口，或缺少 characterId' }
            : await options.spawnSession({ characterId, characterName })
        const body = Buffer.from(JSON.stringify(result), 'utf8')
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.byteLength })
        res.end(body)
        return
      }
      if (url.pathname === '/api/xcity/diagnostics' && req.method === 'GET') {
        const payload = Buffer.from(JSON.stringify({ documentLoads, sseClients: clients.size }), 'utf8')
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.byteLength })
        res.end(payload)
        return
      }
      if (url.pathname === '/api/xcity/bindings' && req.method === 'GET') {
        // 默认就去 DSH 的工作区约定位置找（跟 cove 一样放在 ~/.dsh 下）。
        const file = options.bindingsFile ?? join(homedir(), '.dsh', 'xcity', 'bindings.json')
        const bindings = loadXcityBindings(file)
        // 把角色绑定摊到世界里的 agentId 上：谁（agent-N）现在代表哪个人、用哪个会话。
        const agents = loadAgentMap(join(dirname(file), 'agents.json'))
        const resolved = Object.entries(agents).map(([agentId, characterId]) => ({
          agentId,
          characterId,
          sessionId: bindings.find((row) => row.characterId === characterId)?.sessionId ?? null,
        }))
        const body = Buffer.from(JSON.stringify({ bindings, agents: resolved }), 'utf8')
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.byteLength, 'cache-control': 'no-store' })
        res.end(body)
        return
      }
      if (url.pathname.startsWith('/api/')) {
        await handleApi(ctx, req, res, url)
        if (url.pathname === '/api/game/player/message' || url.pathname === '/api/game/phone/sms/thread') pushPhoneIfChanged()
        return
      }

      if (options.debug === true && url.pathname === '/__slowvale/debug.js') {
        const body = Buffer.from(debugScript(options.forceVisible === true), 'utf8')
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': body.byteLength, 'cache-control': 'no-store' })
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

      // ── 「上次停在哪个页面」──
      // iframe 被重建时会从 / 重新加载，前端于是退回世界列表（用户体感：又要点一遍）。
      // 服务端记住最后访问的 /world 路径，下次进 / 时直接重定向回去。
      // Cookie 优先（多浏览器场景），进程内记忆兜底（iframe 里 Cookie 可能被丢）。
      const resumePath = resumePathOf(req) ?? lastWorldPath
      if (url.pathname === '/' && resumePath !== null) {
        res.writeHead(302, { location: resumePath, 'cache-control': 'no-store' })
        res.end()
        return
      }
      if (/^\/world\/[^/]+$/.test(url.pathname) || url.pathname === '/') documentLoads += 1
      if (/^\/world\/[^/]+$/.test(url.pathname)) {
        lastWorldPath = url.pathname + url.search
        res.setHeader('set-cookie', 'xcity_resume=' + encodeURIComponent(url.pathname + url.search) + '; Path=/; Max-Age=2592000; SameSite=Lax')
      }

      serveStatic(
        options.assetsDir,
        req,
        res,
        url.pathname,
        options.debug === true ? (html) => injectDebug(html, true) : undefined,
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
        signalLogHead()
        // 世界侧驱动：谁开始移动，就给谁发一拍 walk（路径点来自内核 sim/pathfind）
        const world = options.getWorld()
        if (world !== null && clients.size > 0) {
          pushActivityChanges(world)
          const picked = pickWalkStarts(walkLengths, world.agents)
          walkLengths.clear()
          for (const [id, len] of picked.next) walkLengths.set(id, len)
          for (const item of picked.started) pushTimeline(item.agentId, [walkBeat(item.path) as never])
        }
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
        clientCount: () => clients.size,
        appendIncoming: (peerRoleId: string, peerName: string, content: string) => {
          const text = content.trim()
          if (text === '' || peerRoleId === '') return false
          const thread = sms.ensureThread(peerRoleId, peerName)
          sms.append({
            threadId: thread.threadId,
            senderRoleId: peerRoleId,
            // 用线程里已有的名字：世界内部可能把 agent 改名，玩家看到的联系人名不该跟着变。
            senderName: thread.peerName !== '' ? thread.peerName : peerName,
            content: text,
            sentAt: new Date().toISOString(),
            isSelf: false,
          })
          pushPhoneIfChanged()
          return true
        },
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
