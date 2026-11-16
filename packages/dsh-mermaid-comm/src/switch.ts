import type http from 'node:http'
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/**
 * 「勾选后才注入」的开关。
 *
 * 为什么状态住在 host 侧：注入点是 `ctx.systemPrompt.section()`——system prompt 在 host 侧
 * 组装，对话输入框里的勾选按钮只是这台开关的遥控器。若把状态只放在客户端组件里，
 * 它既进不了 prompt 组装，也会在切换会话时随组件重挂载而丢（官方 renderer 明确要求
 * 组件局部状态不得跨会话泄漏）。因此：**host 持有真值，client 读写**。
 *
 * 持久化有两条路，按能力探测选择，都不改变对外的同步读接口 {@link InjectSwitch.isOn}
 * （prompt section 的 text provider 必须在组装那一刻同步拿到答案）：
 *
 * 1. **老 DSH（0.1.x）**：`ctx.settings.register(ns, schema, {applies:'live'})` 的 namespace。
 * 2. **DSH 0.2.x 起（当前）**：该 API 已被移除——`ctx.settings` 变成按 profile entry id
 *    编辑插件 Config 表单的服务。故改成 **profile 目录下的状态文件**：
 *    `$DSH_PROFILE_DIR/mermaid-comm/state.json`（无该变量时退回 `$DSH_HOME/mermaid-comm/`，
 *    再退回 `~/.dsh/mermaid-comm/`）。文件小、同步读、原子写，重启后仍在；
 *    不用 config 表单持久化，是因为写入 profile patch 会触发 HMR 重载，
 *    每点一次按钮就重挂一次插件，请求会被打断。
 * 3. 两条路都不可用时退化为进程内状态——功能照常，只是重启回到配置的默认值。
 */

/** 开关状态的对外接口。 */
export interface InjectSwitch {
  /** 当前是否注入（同步——供 prompt section 的 text provider 在组装时调用）。 */
  isOn(): boolean
  /** 写入开关状态，并尽力持久化（持久化失败不影响本次进程内生效）。 */
  set(on: boolean): Promise<void>
}

/** 持久化用的 settings namespace（小写连字符标识符）。 */
const NAMESPACE = 'mermaid-comm-inject'

/** 客户端读写开关的路由。 */
export const SWITCH_ROUTE = '/dsh-mermaid-comm/state'

/** 请求体上限：这个路由只收一个布尔值，8KB 已是极宽。 */
const MAX_BODY_BYTES = 8 * 1024

const SWITCH_SCHEMA = z.object({
  /** 是否向 system prompt 注入 Mermaid 引导段。 */
  inject: z.boolean().default(false),
})

/** settings 服务的窄视图（只声明本插件用到的能力，避免依赖其完整类型）。 */
interface SettingsScopeLike {
  get(): { inject: boolean }
  update(patch: object): Promise<void>
  watch(callback: (next: { inject: boolean }) => void): () => void
}

interface SettingsLike {
  register(namespace: string, schema: unknown, options?: unknown): SettingsScopeLike
}

/** webServer 服务的窄视图。 */
interface WebServerLike {
  register(spec: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
  }): () => void
}

function warn(...args: unknown[]): void {
  try { console.warn('[mermaid-comm]', ...args) } catch {}
}

/** 状态文件名：目录里的唯一内容，便于人工排查。 */
const STATE_FILE = 'state.json'

/** 状态文件大小上限：只有一个布尔值，超过就是坏文件。 */
const MAX_STATE_BYTES = 8 * 1024

/** 解析持久化目录：profile 优先（状态按部署隔离），最后退回用户级 ~/.dsh。 */
export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const profileDir = env['DSH_PROFILE_DIR']?.trim()
  if (profileDir) return join(profileDir, 'mermaid-comm')
  const home = env['DSH_HOME']?.trim()
  if (home) return join(home, 'mermaid-comm')
  const userHome = env['HOME']?.trim()
  if (userHome) return join(userHome, '.dsh', 'mermaid-comm')
  return undefined
}

/** 状态文件的绝对路径；解析不出目录时为 undefined（= 放弃持久化）。 */
export function stateFilePath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = resolveStateDir(env)
  return dir === undefined ? undefined : join(dir, STATE_FILE)
}

/** 同步读已存状态：解析失败/文件缺失/内容非法一律当作「没存过」。 */
export function readPersistedState(file: string | undefined): boolean | undefined {
  if (file === undefined) return undefined
  try {
    const text = readFileSync(file, 'utf8')
    if (text.length > MAX_STATE_BYTES) return undefined
    const parsed = JSON.parse(text) as unknown
    if (parsed === null || typeof parsed !== 'object') return undefined
    const inject = (parsed as { inject?: unknown }).inject
    return typeof inject === 'boolean' ? inject : undefined
  } catch {
    return undefined
  }
}

/** 原子写状态文件：先写同目录临时文件再 rename，避免读到半截 JSON。 */
export async function writePersistedState(file: string | undefined, on: boolean): Promise<void> {
  if (file === undefined) return
  const body = JSON.stringify({ inject: on, updatedAt: new Date().toISOString() }) + '\n'
  const tmp = file + '.' + String(process.pid) + '.' + String(Date.now()) + '.tmp'
  await mkdir(dirname(file), { recursive: true })
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, file)
}

/**
 * 建立开关：初值按 profile 状态文件 → 老 settings namespace → `defaultInject` 依次取，
 * 之后所有 set 都先改进程内真值（保证同步读立刻正确）再异步落盘。
 */
export function registerInjectSwitch(ctx: Context, opts: { defaultInject: boolean }): InjectSwitch {
  const file = stateFilePath()
  const persisted = readPersistedState(file)
  let on = persisted ?? opts.defaultInject
  let scope: SettingsScopeLike | undefined

  // 可选依赖：有 settings（仅 0.1.x 有 register）就沿用老路径，没有就走状态文件。
  // 用 ctx.inject 而非硬 inject，是为了让「勾选注入」这件事不依赖宿主恰好挂了某个包。
  // 外面再包一层 try：若沙箱拒绝注入这个服务，也只能退化成进程内状态，
  // 绝不能让「持久化」把整个插件（校验工具/图库/输出闸）拖垮。
  try {
    ctx.inject(['settings'], (host) => {
      const settings = (host as unknown as { settings?: SettingsLike }).settings
      if (!settings || typeof settings.register !== 'function') return
      try {
        const registered = settings.register(
          NAMESPACE,
          SWITCH_SCHEMA.default({ inject: on }),
          { applies: 'live' },
        )
        scope = registered
        // 老部署以 settings 文档为准（它可能比状态文件新）。
        on = registered.get().inject
        const stopWatching = registered.watch((next) => { on = next.inject })
        ctx.effect(() => stopWatching)
      } catch (error) {
        // 注册失败（例如 namespace 被占）不该让整个插件挂掉：退化为状态文件/进程内状态。
        warn('settings namespace registration failed, falling back to state file:', String(error))
        scope = undefined
      }
    })
  } catch (error) {
    warn('settings service unavailable, using state file:', String(error))
  }

  return {
    isOn: () => on,
    async set(next: boolean) {
      on = next
      const writes: Promise<void>[] = []
      if (file !== undefined) {
        writes.push(writePersistedState(file, next).catch((error: unknown) => {
          warn('failed to persist inject switch to state file:', String(error))
        }))
      }
      if (scope !== undefined) {
        writes.push(scope.update({ inject: next }).catch((error: unknown) => {
          warn('failed to persist inject switch to settings:', String(error))
        }))
      }
      await Promise.all(writes)
    },
  }
}

/** 读取请求体并解析为 JSON（空体返回 undefined）。 */
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
      if (text === '') { resolve(undefined); return }
      try { resolve(JSON.parse(text)) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
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

/**
 * 注册开关的 HTTP 路由，供客户端读写。
 *
 *   GET  {SWITCH_ROUTE} → { toggle: true, inject: boolean }
 *   POST {SWITCH_ROUTE} { inject: boolean } → 同上（回读后的真值）
 *
 * `toggle` 表示本插件当前是否处于「由按钮控制」模式：promptLevel 为 global/off 时
 * 客户端据此隐藏按钮，避免给出一个点了没用的控件。
 */
export function registerSwitchRoutes(ctx: Context, sw: InjectSwitch, opts: { toggle: boolean }): void {
  const state = () => ({ toggle: opts.toggle, inject: sw.isOn() })

  try {
    ctx.inject(['webServer'], (host) => {
      const webServer = (host as unknown as { webServer?: WebServerLike }).webServer
      if (!webServer || typeof webServer.register !== 'function') return

      const dispose = webServer.register({
        kind: 'exact',
        path: SWITCH_ROUTE,
        handler: (req, res) => {
          const method = (req.method ?? 'GET').toUpperCase()
          if (method === 'GET' || method === 'HEAD') {
            sendJson(res, 200, state())
            return
          }
          if (method !== 'POST') {
            res.writeHead(405, { allow: 'GET, HEAD, POST' })
            res.end()
            return
          }
          // 非 toggle 模式下不接写入：避免客户端与配置的 promptLevel 打架。
          if (!opts.toggle) {
            sendJson(res, 200, state())
            return
          }
          readJsonBody(req).then(async (body) => {
            const inject = (body as { inject?: unknown } | undefined)?.inject
            if (typeof inject !== 'boolean') {
              sendJson(res, 400, { error: 'body must be {"inject": boolean}' })
              return
            }
            await sw.set(inject)
            sendJson(res, 200, state())
          }).catch((error: unknown) => {
            if (!res.headersSent) sendJson(res, 400, { error: String(error) })
          })
        },
      })
      ctx.effect(() => dispose)
    })
  } catch (error) {
    warn('webServer service unavailable, toggle route not registered:', String(error))
  }
}
