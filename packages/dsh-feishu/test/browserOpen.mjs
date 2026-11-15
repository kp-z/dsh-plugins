/**
 * 「打开独立任务页」的客户端契约（node test/browserOpen.mjs）。
 *
 * 客户端不再自己拼地址（dsh-app:// 拼出来浏览器打不开），也不 window.open（桌面端会拦）。
 * 它只做一件事：POST /api/open-panel，请宿主用 DSH_WEB_URL 拼出插件自己的
 * /dsh-feishu/tasks 地址并拉起系统浏览器 —— 那是**独立任务页**，不是 DSH 本身，
 * 所以既不带 token，也不需要落点标记。
 */
import assert from 'node:assert/strict'
import { openPanelInBrowser, OPEN_PANEL_ENDPOINT } from '../src/client/browserOpen.js'

let passed = 0
const failed = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failed.push(name)
    console.log(`  FAIL ${name}`)
    console.log(String((error && error.stack) || error).split('\n').slice(0, 4).map((line) => `       ${line}`).join('\n'))
  }
}

const response = (status, payload) => ({ ok: status >= 200 && status < 300, status, json: async () => payload })

await check('宿主接口路径固定', () => {
  assert.equal(OPEN_PANEL_ENDPOINT, '/dsh-feishu/api/open-panel')
})

await check('打开：POST 宿主接口，成功带回宿主解析的地址', async () => {
  const calls = []
  const result = await openPanelInBrowser({
    fetcher: async (url, init) => {
      calls.push([url, (init && init.method) || 'GET'])
      return response(200, { ok: true, url: 'http://127.0.0.1:54980/dsh-feishu/tasks' })
    },
  })
  assert.deepEqual(result, { ok: true, via: 'host', url: 'http://127.0.0.1:54980/dsh-feishu/tasks' })
  assert.deepEqual(calls, [[OPEN_PANEL_ENDPOINT, 'POST']])
})

await check('打开：宿主 400 → ok:false 且带回原因（按钮据此显示失败）', async () => {
  const result = await openPanelInBrowser({
    fetcher: async () => response(400, { ok: false, error: '无法确定插件地址' }),
  })
  assert.equal(result.ok, false)
  assert.match(result.reason, /插件地址/)
})

await check('打开：网络抛错 → ok:false，不抛给调用方', async () => {
  const result = await openPanelInBrowser({ fetcher: async () => { throw new Error('ECONNREFUSED') } })
  assert.equal(result.ok, false)
  assert.match(result.reason, /ECONNREFUSED/)
})

await check('打开：没有 fetch → ok:false', async () => {
  const result = await openPanelInBrowser({ fetcher: null })
  assert.equal(result.ok, false)
})

await check('打开：宿主回 200 但 ok:false（探测失败）→ 仍然算失败', async () => {
  const result = await openPanelInBrowser({
    fetcher: async () => response(200, { ok: false, error: '任务页暂时不可用（宿主没响应）' }),
  })
  assert.equal(result.ok, false)
  assert.match(result.reason, /任务页暂时不可用/)
})

await check('打开：响应体不是 JSON → 不抛错，回落到状态码说明', async () => {
  const result = await openPanelInBrowser({
    fetcher: async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json') } }),
  })
  assert.equal(result.ok, false)
  assert.match(result.reason, /502/)
})

console.log(`\nbrowserOpen.mjs: ${passed} passed, ${failed.length} failed`)
if (failed.length) {
  console.log(`\n失败项：\n${failed.map((name) => ` - ${name}`).join('\n')}`)
  process.exitCode = 1
}
