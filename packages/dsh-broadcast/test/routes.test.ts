import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import type http from 'node:http'
import { test } from 'node:test'
import { STATE_ROUTE, createStateHandler, statePayload } from '../lib/routes.js'

/** 假的 IncomingMessage：只要能被 `for on('data')` 读就行。 */
function fakeReq(method: string, body?: string): http.IncomingMessage {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(body, 'utf8')])
  return Object.assign(stream, { method }) as unknown as http.IncomingMessage
}

/** 假的 ServerResponse：记录状态码、头与正文。 */
function fakeRes() {
  const out = { status: 0, headers: {} as Record<string, string>, body: '', ended: false }
  let headersSent = false
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      out.status = status
      out.headers = headers ?? {}
      headersSent = true
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) out.body += String(chunk)
      out.ended = true
    },
    get headersSent() {
      return headersSent
    },
  } as unknown as http.ServerResponse
  return { res, out }
}

function deps(overrides: Partial<Parameters<typeof createStateHandler>[0]> = {}) {
  const calls: string[] = []
  let enabled = false
  let speaking = false
  const base = {
    isEnabled: () => enabled,
    setEnabled: async (next: boolean) => {
      calls.push(`set:${next}`)
      enabled = next
    },
    isSpeaking: () => speaking,
    stop: () => {
      calls.push('stop')
      speaking = false
    },
    ...overrides,
  }
  return {
    deps: base,
    calls,
    setSpeaking: (next: boolean) => { speaking = next },
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test('路由路径是客户端硬编码的那个', () => {
  assert.equal(STATE_ROUTE, '/dsh-broadcast/state')
})

test('GET 返回开关与「正在播报」状态', async () => {
  const d = deps()
  d.setSpeaking(true)
  const { res, out } = fakeRes()
  createStateHandler(d.deps)(fakeReq('GET'), res)
  assert.equal(out.status, 200)
  assert.match(out.headers['content-type'] ?? '', /application\/json/)
  assert.deepEqual(JSON.parse(out.body), { toggle: true, enabled: false, speaking: true })
})

test('POST {enabled:true} 写入并回读真值', async () => {
  const d = deps()
  const { res, out } = fakeRes()
  createStateHandler(d.deps)(fakeReq('POST', JSON.stringify({ enabled: true })), res)
  await settle()
  assert.deepEqual(d.calls, ['set:true'])
  assert.deepEqual(JSON.parse(out.body), { toggle: true, enabled: true, speaking: false })
})

test('POST {stop:true} 停掉正在播的那条', async () => {
  const d = deps()
  d.setSpeaking(true)
  const { res, out } = fakeRes()
  createStateHandler(d.deps)(fakeReq('POST', JSON.stringify({ stop: true })), res)
  await settle()
  assert.deepEqual(d.calls, ['stop'])
  assert.equal(JSON.parse(out.body).speaking, false)
})

test('POST 体不合法 → 400，且不动开关', async () => {
  const d = deps()
  for (const body of ['', '{}', '{"enabled":"yes"}', 'not json']) {
    const { res, out } = fakeRes()
    createStateHandler(d.deps)(fakeReq('POST', body), res)
    await settle()
    assert.equal(out.status, 400, `body=${body} 应当 400`)
  }
  assert.deepEqual(d.calls, [])
})

test('其它方法 → 405 且带 Allow', () => {
  const d = deps()
  const { res, out } = fakeRes()
  createStateHandler(d.deps)(fakeReq('PUT'), res)
  assert.equal(out.status, 405)
  assert.equal(out.headers['allow'], 'GET, HEAD, POST')
})

test('statePayload 与处理器用的是同一份结构', () => {
  const d = deps()
  assert.deepEqual(statePayload(d.deps), { toggle: true, enabled: false, speaking: false })
})

test('客户端硬编码的路径与字段跟宿主对得上（两边不会各说各话）', () => {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.match(source, new RegExp(`STATE_URL = "${STATE_ROUTE}"`))
  assert.match(source, /post\(\{ enabled: next \}\)/)
  assert.match(source, /post\(\{ stop: true \}\)/)
  assert.match(source, /state\.toggle !== true/)
  assert.match(source, /state\.speaking === true/)
  assert.match(source, /conversation\.input\.left/)
})
