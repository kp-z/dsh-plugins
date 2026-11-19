/**
 * 客户端用来读写开关的 HTTP 路由。
 *
 *   GET  /dsh-broadcast/state             → { toggle, enabled, speaking }
 *   POST /dsh-broadcast/state {enabled }   → 写入总开关，返回回读后的真值
 *   POST /dsh-broadcast/state {stop:true}  → 停掉正在播的那条
 *
 * 只做值传递，不含业务判断：开关住在 state.ts，播放住在 index.ts。
 * 这样路由可以脱离宿主单测（见 test/routes.test.ts）。
 */
import type http from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

/** 路由路径（客户端硬编码同一个常量）。 */
export const STATE_ROUTE = '/dsh-broadcast/state'

/** 请求体上限：只收一两个布尔值，8KB 已经极宽。 */
const MAX_BODY_BYTES = 8 * 1024

export interface BroadcastRouteDeps {
  isEnabled(): boolean
  setEnabled(next: boolean): Promise<void>
  isSpeaking(): boolean
  /** 停掉正在播的那条（没有在播就是空操作）。 */
  stop(): void
}

export interface StatePayload {
  /** 客户端据此判断这个部署有没有开关（恒 true，留字段是为将来可能的只读部署）。 */
  readonly toggle: true
  readonly enabled: boolean
  readonly speaking: boolean
}

export function statePayload(deps: BroadcastRouteDeps): StatePayload {
  return { toggle: true, enabled: deps.isEnabled(), speaking: deps.isSpeaking() }
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 读请求体并解析 JSON（空体返回 undefined）。超限直接掐掉连接。 */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** 造一个路由处理器（纯逻辑，不需要宿主）。 */
export function createStateHandler(deps: BroadcastRouteDeps): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase()
    if (method === 'GET' || method === 'HEAD') {
      sendJson(res, 200, statePayload(deps))
      return
    }
    if (method !== 'POST') {
      res.writeHead(405, { allow: 'GET, HEAD, POST' })
      res.end()
      return
    }
    readJsonBody(req)
      .then(async (body) => {
        const payload = body as { enabled?: unknown; stop?: unknown } | undefined
        if (payload?.stop === true) {
          deps.stop()
          sendJson(res, 200, statePayload(deps))
          return
        }
        if (typeof payload?.enabled !== 'boolean') {
          sendJson(res, 400, { error: 'body must be {"enabled": boolean} or {"stop": true}' })
          return
        }
        await deps.setEnabled(payload.enabled)
        sendJson(res, 200, statePayload(deps))
      })
      .catch((error: unknown) => {
        if (!res.headersSent) sendJson(res, 400, { error: String(error) })
      })
  }
}

/** webServer 服务的窄视图（只声明用到的那一个方法）。 */
interface WebServerLike {
  register(spec: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
  }): () => void
}

/**
 * 把路由挂到宿主的 webServer 上。
 *
 * 用 `ctx.inject` 而不是硬 inject：没有 webServer（比如 headless 部署）时插件其余部分照常工作，
 * 只是没有按钮可点——不能因为「开关的遥控器」把播报本身拖垮。
 */
export function registerStateRoute(ctx: Context, deps: BroadcastRouteDeps): void {
  try {
    ctx.inject(['webServer'], (host) => {
      const webServer = (host as unknown as { webServer?: WebServerLike }).webServer
      if (webServer === undefined || typeof webServer.register !== 'function') return
      const dispose = webServer.register({ kind: 'exact', path: STATE_ROUTE, handler: createStateHandler(deps) })
      ctx.effect(() => dispose)
    })
  } catch {
    // 沙箱拒绝注入 webServer：退化为「只能用配置文件开」，不报错也不影响播报
  }
}
