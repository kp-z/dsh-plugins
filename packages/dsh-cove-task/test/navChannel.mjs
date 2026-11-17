import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createNavChannel } from '../navChannel.js'

class Response extends EventEmitter {
  frames = []; writableLength = 0; destroyed = false; writableEnded = false
  writeHead(code, headers) { this.code = code; this.headers = headers }
  write(frame) { this.frames.push(frame) }
  end() { this.writableEnded = true; this.emit('close') }
}
const payload = (frame) => JSON.parse(frame.split('data: ')[1])

const channel = createNavChannel({ pendingTtlMs: 50 })
/* 没客户端：挂起，等 DSH 连上来补投 */
const queued = channel.request('sess-1', '任务一')
assert.equal(queued.ok, true)
assert.equal(queued.delivered, false)
assert.equal(queued.queued, true)
assert.equal(channel.clientCount, 0)

const first = new Response()
channel.open({}, first)
assert.equal(first.code, 200)
assert.match(first.headers['content-type'], /event-stream/)
assert.equal(channel.clientCount, 1)
assert.equal(first.frames.length, 1)
assert.match(first.frames[0], /^event: open-session/)
assert.equal(payload(first.frames[0]).sessionId, 'sess-1')
assert.equal(payload(first.frames[0]).title, '任务一')
/* 挂起只补投一次 */
assert.equal(channel.request('sess-0', '不会发生').delivered, true)
assert.equal(payload(first.frames[1]).sessionId, 'sess-0')

/* 有客户端：立即推给所有连接 */
const second = new Response()
channel.open({}, second)
assert.equal(second.frames.length, 0, '没有新请求就不发帧')
const live = channel.request('sess-2', '任务二')
assert.equal(live.delivered, true)
assert.equal(live.queued, false)
assert.equal(payload(first.frames.at(-1)).sessionId, 'sess-2')
assert.equal(payload(second.frames.at(-1)).sessionId, 'sess-2')

/* 断开后不再推；挂起请求只给下一个连接 */
first.end()
assert.equal(channel.clientCount, 1)
const late = new Response()
const pending = channel.request('sess-3', '迟到的任务')
assert.equal(pending.delivered, true, 'second 还连着')
second.end()
const reconnected = new Response()
channel.open({}, reconnected)
assert.equal(reconnected.frames.length, 0, '没有挂起请求时连上不发帧')
channel.request('sess-4', '新连接')
assert.equal(payload(reconnected.frames.at(-1)).sessionId, 'sess-4')

/* 挂起过期不再补投 */
const expired = new Response()
channel.dispose()
const orphan = new Response()
const offline = createNavChannel({ pendingTtlMs: 5 })
offline.request('sess-5', '过期')
await new Promise((resolve) => setTimeout(resolve, 20))
offline.open({}, expired)
assert.equal(expired.frames.length, 0, '过期请求不补投')
offline.dispose()
assert.equal(expired.writableEnded, true)

/* 无效请求不挂起 */
const empty = createNavChannel()
const noId = empty.request('', '')
assert.equal(noId.ok, false)
empty.dispose()
assert.equal(orphan.frames.length, 0)
console.log('NAV_CHANNEL_OK: pending replay, broadcast, disconnect, expiry, validation, dispose')
