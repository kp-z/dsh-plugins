/**
 * 宿主侧「在系统浏览器打开 DSH 的任务页」：拼 URL + 选平台命令 + 启动。
 *
 * 为什么不让客户端 window.open：DSH 桌面端（Electron）会拦窗开弹窗，
 * 客户端拿不到任何回执，表现就是「点了没反应」。客户端改为 POST /api/open-panel，
 * 由宿主用平台命令（macOS open / Windows start / Linux xdg-open）拉起默认浏览器。
 *
 * 为什么要 token：Web UI 根页面有浏览器会话鉴权（只认 ?token=…）。
 * 宿主优先用 connection.authenticatedUrl() 拿带 token 的地址；拿不到就退回裸 origin
 * （浏览器里已有 cookie 时照样能进）。
 *
 * 为什么不在 URL 上带「切到任务页」的标记：带 token 的首次访问会在校验后
 * 302 到不带查询串的 ./，标记会被丢掉。所以落点由宿主的 /api/panel-focus 一次性下发
 * （见 index.js 的 open-panel 路由），客户端加载后取走。
 *
 * 安全边界：Host 头先做字符白名单校验（避免 CRLF / 空格）；命令一律 argv 数组，不经过 shell。
 */
import { spawn } from 'node:child_process'

/** Host 头白名单：域名 / IPv4 / [IPv6] / 端口。 */
const HOST_RE = /^[A-Za-z0-9.\-:[\]]+$/

/** 从请求头还原用户正在访问的 origin；拿不到就返回空串。 */
export function originFromRequest(req) {
  const headers = (req && req.headers) || {}
  const rawHost = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim()
  if (!HOST_RE.test(rawHost)) return ''
  /* 桌面外壳的 dsh-app:// 伪主机不能拼成 http（那正是客户端复制出错误地址的原因）。 */
  if (/^(dsh-app|app)(?::|$)/i.test(rawHost)) return ''
  const forwarded = String(headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase()
  return `${forwarded === 'https' ? 'https' : 'http'}://${rawHost}`
}

/** 宿主自己的 web 地址（DSH 会把它放进环境变量）——最可靠的来源。 */
export function originFromEnvironment(env = process.env) {
  const base = env && typeof env.DSH_WEB_URL === 'string' ? env.DSH_WEB_URL : ''
  if (!base) return ''
  try {
    return new URL(base).origin
  } catch (error) {
    return ''
  }
}

/** 打开地址的 origin：优先 DSH_WEB_URL（桌面端页面在 dsh-app:// 下，Host 头不可用），再退回请求头。 */
export function panelOrigin(req, env = process.env) {
  return originFromEnvironment(env) || originFromRequest(req)
}

/**
 * 打开目标：独立任务页（/dsh-cove-task/tasks）。
 * 为什么不带 token：这一页是插件自己的公开路由，不经 Web UI 的浏览器鉴权，
 * 所以既不需要 connection，也不会出现「authentication required」。
 */
export function openTaskPageFor({ req, env = process.env } = {}) {
  const origin = panelOrigin(req, env)
  if (!origin) return { ok: false, error: '无法确定插件地址（缺少 DSH_WEB_URL 与 Host）' }
  return { ok: true, url: origin + '/dsh-cove-task/tasks' }
}

/** 探测目标地址是否可打开：只接受 2xx/3xx（401 = 缺 token，404 = 路由不存在）。 */
export async function probeUrl(url, options = {}) {
  const fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch : null)
  if (!fetchImpl) return 'unknown'
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1500) : null
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: controller ? controller.signal : undefined })
    if (!response || typeof response.status !== 'number') return 'unknown'
    if (response.status === 401 || response.status === 403) return 'unauthorized'
    if (response.status >= 200 && response.status < 400) return 'ok'
    return 'unreachable'
  } catch (error) {
    return 'unreachable'
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 各平台「用默认浏览器打开一个 URL」的命令（argv 数组）。 */
export function browserOpenCommand(platform, url) {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: 'cmd.exe', args: ['/d', '/c', 'start', '', url] }
  return { command: 'xdg-open', args: [url] }
}

/** 各平台「把 DSH 桌面端叫到前台」的命令：dsh://open 是桌面端注册的聚焦协议。 */
export function dshFocusCommand(platform) {
  if (platform === 'win32') return { command: 'cmd.exe', args: ['/d', '/c', 'start', '', 'dsh://open'] }
  if (platform === 'darwin') return { command: 'open', args: ['dsh://open'] }
  return { command: 'xdg-open', args: ['dsh://open'] }
}

/**
 * 把 DSH 桌面端叫到前台。独立页的「切到会话」必须让用户看见 DSH；
 * 协议只负责聚焦，真正的会话切换由客户端 SSE 桥完成。
 * 命令不存在/平台不支持时静默失败（不能因为叫不动窗口就让跳转 500）。
 */
export function focusDshWindow(options = {}) {
  const platform = options.platform || process.platform
  const spawnImpl = options.spawn || spawn
  const { command, args } = dshFocusCommand(platform)
  try {
    const child = spawnImpl(command, args, { stdio: 'ignore', detached: platform !== 'win32' })
    /* spawn 的 ENOENT 是异步 error 事件：不挂监听会变成未处理异常，拖垮宿主进程。 */
    child?.once?.('error', () => {})
    child?.unref?.()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

const messageOf = (error) => (error && typeof error.message === 'string' ? error.message : String(error))

/**
 * 启动打开命令。resolve 的是「命令真的起来了」而不是「浏览器已经加载完」；
 * 超时只兜住 spawn 事件永远不来的异常环境。
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export function launchUrl(url, options = {}) {
  const platform = options.platform || process.platform
  const spawnImpl = options.spawn || spawn
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 2000
  const { command, args } = browserOpenCommand(platform, url)
  return new Promise((resolve) => {
    let child = null
    try {
      child = spawnImpl(command, args, { stdio: 'ignore', detached: platform !== 'win32' })
    } catch (error) {
      resolve({ ok: false, error: messageOf(error) })
      return
    }
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    /* 不 unref：超时是「这次打开失败」的唯一兜底，unref 会让事件循环空转时它永远不触发
       （实测：单测里进程直接退出，promise 悬空）。正常路径 spawn/error 都会 clearTimeout。 */
    const timer = setTimeout(() => finish({ ok: false, error: `启动 ${command} 超时` }), timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      finish({ ok: false, error: messageOf(error) })
    })
    child.once('spawn', () => {
      clearTimeout(timer)
      try { if (typeof child.unref === 'function') child.unref() } catch (error) { /* 已退出 */ }
      finish({ ok: true })
    })
  })
}

