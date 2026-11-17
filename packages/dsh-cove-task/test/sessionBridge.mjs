import assert from 'node:assert/strict'
import { installSessionBridge, NAV_EVENT_ENDPOINT } from '../src/client/sessionBridge.js'

class FakeEventSource {
  static last = null
  constructor(url) { this.url = url; this.handlers = new Map(); this.closed = false; FakeEventSource.last = this }
  addEventListener(name, fn) { this.handlers.set(name, fn) }
  close() { this.closed = true }
  emit(name, data) { const fn = this.handlers.get(name); if (fn) fn({ data: JSON.stringify(data) }) }
}

assert.equal(NAV_EVENT_ENDPOINT, '/dsh-cove-task/api/nav/events')
let opened = []
let off = installSessionBridge({
  EventSourceImpl: FakeEventSource,
  openSession: (id, title) => { opened.push({ id, title }); return Promise.resolve({ ok: true }) },
})
assert.equal(FakeEventSource.last.url, NAV_EVENT_ENDPOINT)
const firstSource = FakeEventSource.last
FakeEventSource.last.emit('open-session', { sessionId: 's-1', title: '任务一' })
await Promise.resolve()
assert.deepEqual(opened, [{ id: 's-1', title: '任务一' }])
/* 坏 JSON / 空 id 都不能抛，也不能误开 */
FakeEventSource.last.handlers.get('open-session')({ data: '{bad' })
FakeEventSource.last.emit('open-session', { title: '没有 id' })
assert.equal(opened.length, 1)
/* 明确禁用时不连 */
FakeEventSource.last = null
const disposeDisabled = installSessionBridge({ EventSourceImpl: FakeEventSource, enabled: false, openSession: () => {} })
assert.equal(FakeEventSource.last, null)
disposeDisabled()
/* 没有 EventSource（单测 / 老宿主）时安静退化 */
const disposeMissing = installSessionBridge({ openSession: () => {} })
disposeMissing()
off()
assert.equal(firstSource.closed, true)
off = installSessionBridge({
  EventSourceImpl: FakeEventSource,
  openSession: () => { throw new Error('open failed') },
})
assert.doesNotThrow(() => FakeEventSource.last.emit('open-session', { sessionId: 's-2' }))
off()
console.log('SESSION_BRIDGE_OK: endpoint, event dispatch, malformed payloads, disabled, dispose, error isolation')
