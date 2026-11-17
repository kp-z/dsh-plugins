/**
 * DSH 客户端侧的「独立页要切会话」接收器。
 *
 * 独立页在系统浏览器里，只能 POST 给宿主；宿主用 SSE 把 { sessionId, title } 推给
 * 正在运行的 DSH 客户端。这里连上 /api/nav/events，收到事件就调 uiWorkspace.openSession。
 *
 * 只在 DSH 客户端里安装（client.js）；独立页不会执行本文件。
 */
export const NAV_EVENT_ENDPOINT = '/dsh-cove-task/api/nav/events'

export function installSessionBridge(options = {}) {
  const openSession = options.openSession
  const enabled = options.enabled !== false
  const ES = options.EventSourceImpl || (typeof EventSource === 'function' ? EventSource : null)
  const url = options.endpoint || NAV_EVENT_ENDPOINT
  if (!enabled || typeof openSession !== 'function' || !ES || !url) return () => {}
  let source = null
  try {
    source = new ES(url)
  } catch (error) {
    return () => {}
  }
  source.addEventListener('open-session', (event) => {
    let payload = null
    try { payload = JSON.parse(event && event.data ? event.data : '{}') } catch { payload = null }
    const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : String(payload && payload.sessionId || '')
    if (!sessionId) return
    /* 尽力而为：切失败不能把独立页的请求变成宿主异常；SSE 连接保持，等下一次。 */
    try { void Promise.resolve(openSession(sessionId, payload.title)).catch(() => {}) } catch { /* ignore */ }
  })
  source.addEventListener('error', () => {
    /* EventSource 自带重连；这里只需要别让 error 冒到控制台。 */
  })
  return () => {
    try { source.close() } catch { /* 已关闭 */ }
  }
}
