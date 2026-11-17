/**
 * 独立海湾页 → DSH 的「切到这条会话」请求。
 *
 * 独立页拿不到 DSH 客户端的 uiWorkspace，只能请**宿主**转一手：POST 一个会话 id，
 * 宿主通过 SSE 推给正在运行的 DSH 客户端（client.js 的 sessionBridge），
 * 由客户端调 uiWorkspace.openSession；同时宿主把 DSH 桌面端叫到前台。
 *
 * 返回 { ok, delivered?, reason? }：ok=true 只表示「请求已交给宿主」；
 * delivered=false 表示当时没有 DSH 客户端连着，宿主会短暂挂起并等客户端连上。
 */
export const OPEN_SESSION_ENDPOINT = '/dsh-cove-task/api/open-session'

export async function openSessionInDsh(sessionId, title, options = {}) {
  const id = String(sessionId || '')
  if (!id) return { ok: false, reason: '这个任务没有绑定会话' }
  const fetcher = options.fetcher || (typeof fetch === 'function' ? fetch : null)
  if (!fetcher) return { ok: false, reason: '当前环境没有 fetch' }
  try {
    const response = await fetcher(OPEN_SESSION_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sessionId: id, title: String(title || '') }),
    })
    let payload = null
    try { payload = await response.json() } catch { payload = null }
    if (response && response.ok && payload && payload.ok) {
      return { ok: true, delivered: payload.delivered === true }
    }
    return { ok: false, reason: (payload && payload.error) || `请求失败：${response && response.status ? response.status : '未知状态'}` }
  } catch (error) {
    return { ok: false, reason: error && error.message ? error.message : String(error) }
  }
}
