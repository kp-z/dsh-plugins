import assert from 'node:assert/strict'
import { openSessionInDsh, OPEN_SESSION_ENDPOINT } from '../src/client/openSession.js'

assert.equal(OPEN_SESSION_ENDPOINT, '/dsh-cove-task/api/open-session')
const calls = []
const okFetch = async (url, init) => {
  calls.push({ url, init })
  return { ok: true, status: 200, json: async () => ({ ok: true, delivered: true }) }
}
let result = await openSessionInDsh('s-1', '任务一', { fetcher: okFetch })
assert.deepEqual(result, { ok: true, delivered: true })
assert.equal(calls[0].url, OPEN_SESSION_ENDPOINT)
assert.equal(calls[0].init.method, 'POST')
assert.deepEqual(JSON.parse(calls[0].init.body), { sessionId: 's-1', title: '任务一' })

/* 宿主暂时没有客户端：仍算请求成功，只是 delivered=false */
result = await openSessionInDsh('s-2', '', { fetcher: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, delivered: false }) }) })
assert.deepEqual(result, { ok: true, delivered: false })

/* 宿主返回失败 / 非 JSON / 网络异常：都折成可读原因，不抛 */
result = await openSessionInDsh('s-3', 'x', { fetcher: async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: '宿主忙' }) }) })
assert.equal(result.ok, false)
assert.equal(result.reason, '宿主忙')
result = await openSessionInDsh('s-4', 'x', { fetcher: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } }) })
assert.equal(result.ok, false)
assert.match(result.reason, /请求失败：200/)
result = await openSessionInDsh('s-5', 'x', { fetcher: async () => { throw new Error('ECONNREFUSED') } })
assert.equal(result.ok, false)
assert.match(result.reason, /ECONNREFUSED/)
result = await openSessionInDsh('', 'x', { fetcher: okFetch })
assert.equal(result.ok, false)
assert.match(result.reason, /没有绑定会话/)
console.log('OPEN_SESSION_OK: endpoint, payload, delivered flag, failure folding')
