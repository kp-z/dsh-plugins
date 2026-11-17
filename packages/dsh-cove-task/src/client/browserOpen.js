/**
 * 打开**独立任务页**（/dsh-cove-task/tasks）—— 不是 DSH 本身。
 *
 * 客户端不自己拼地址，也不 window.open：
 *   - 桌面端页面在 dsh-app:// 下，拼出来的地址浏览器打不开；
 *   - DSH 桌面端会拦窗开弹窗，客户端拿不到回执（用户看到「点了没反应」）。
 * 所以一律 POST /api/open-panel，由宿主用 DSH_WEB_URL 拼出插件自己的 http 地址并拉起默认浏览器。
 */

export const OPEN_PANEL_ENDPOINT = '/dsh-cove-task/api/open-panel'

/**
 * @param {{fetcher?:Function}} [options] 注入点（单测用）
 * @returns {Promise<{ok:boolean, via?:'host', url?:string, reason?:string}>}
 */
export async function openPanelInBrowser(options = {}) {
  const fetcher = options.fetcher || (typeof fetch === 'function' ? fetch : null)
  if (!fetcher) return { ok: false, reason: '当前环境没有 fetch' }
  try {
    const response = await fetcher(OPEN_PANEL_ENDPOINT, { method: 'POST', headers: { accept: 'application/json' } })
    const payload = typeof response?.json === 'function' ? await response.json().catch(() => null) : null
    if (response && response.ok && payload && payload.ok) return { ok: true, via: 'host', url: payload.url }
    return { ok: false, reason: (payload && payload.error) || `宿主接口返回 ${response && response.status ? response.status : '未知状态'}` }
  } catch (error) {
    return { ok: false, reason: error && error.message ? error.message : String(error) }
  }
}
