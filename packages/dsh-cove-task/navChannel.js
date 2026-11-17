/**
 * 独立海湾页 → DSH 的「切到这条会话」事件通道（只读 fanout，不改任务/不碰飞书）。
 *
 * 独立页在系统浏览器里，拿不到 DSH 客户端的 uiWorkspace；所以它 POST 一个会话 id，
 * 由**宿主**把事件通过 SSE 推给当前连着的 DSH 客户端，客户端再调 uiWorkspace.openSession。
 * 没有客户端连着时先挂起一小段时间：独立页会顺手把 DSH 桌面端叫到前台，客户端连上后补投。
 */
import { randomUUID } from 'node:crypto'

const PENDING_TTL_MS = 60_000

export function createNavChannel(options = {}) {
  const ttl = Number(options.pendingTtlMs) > 0 ? Number(options.pendingTtlMs) : PENDING_TTL_MS
  const generation = randomUUID()
  const clients = new Set()
  let pending = null
  let disposed = false
  let seq = 0

  function send(client, eventName, payload) {
    if (client.res.destroyed || client.res.writableEnded) { client.close(); return false }
    /* 消费者堵住就断开重连（拿到新连接即可），不要攒帧把内存拖爆。 */
    if (client.res.writableLength > 64 * 1024) { client.close(); client.res.end(); return false }
    try {
      client.res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`)
      return true
    } catch {
      client.close()
      return false
    }
  }

  function takePending() {
    if (!pending) return null
    if (Date.now() - pending.at > ttl) { pending = null; return null }
    const event = pending.event
    pending = null
    return event
  }

  return {
    /** 当前连着的客户端数（测试与诊断用）。 */
    get clientCount() { return clients.size },
    /** 独立页请求切会话：有客户端就立刻推，没客户端就挂起等下一个连接。 */
    request(sessionId, title) {
      if (disposed) return { ok: false, delivered: false, queued: false, reason: '通道已关闭' }
      const event = {
        generation,
        requestId: `${Date.now().toString(36)}-${++seq}`,
        sessionId: String(sessionId || ''),
        title: String(title || ''),
        at: Date.now(),
      }
      if (!event.sessionId) return { ok: false, delivered: false, queued: false, reason: '缺少 sessionId' }
      let delivered = 0
      for (const client of clients) {
        if (send(client, 'open-session', event)) delivered += 1
      }
      if (!delivered) pending = { at: event.at, event }
      return { ok: true, delivered: delivered > 0, queued: delivered === 0, requestId: event.requestId }
    },
    /** SSE：DSH 客户端连上来后保持长连接，收 open-session 事件。 */
    open(req, res) {
      if (disposed) { res.writeHead(503); res.end(); return }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      })
      res.flushHeaders?.()
      const client = {
        res,
        close() { clients.delete(client); clearInterval(client.timer); res.off?.('close', client.close) },
      }
      clients.add(client)
      res.on('close', client.close)
      client.timer = setInterval(() => {
        if (res.destroyed || res.writableEnded) return client.close()
        if (res.writableLength > 64 * 1024) { client.close(); res.end(); return }
        try { res.write(': heartbeat\n\n') } catch { client.close() }
      }, 15_000)
      client.timer.unref?.()
      const event = takePending()
      if (event && !send(client, 'open-session', event)) pending = { at: Date.now(), event }
    },
    dispose() {
      disposed = true
      pending = null
      for (const client of [...clients]) { client.close(); client.res.end() }
    },
  }
}
