/**
 * 宿主侧「打开独立任务页」（node test/openBrowser.mjs）。
 *
 * 钉住三件事：
 *   1. origin 解析 —— Host 头必须白名单校验（CRLF/空格拒绝，dsh-app 伪主机拒绝）；
 *   2. 落点地址 —— /dsh-cove-task/tasks，**不带 token**（插件公开路由，没有鉴权页）；
 *   3. 拉起浏览器的命令在三大平台都对，并且失败时如实报错。
 * 真去 open 浏览器会污染测试环境，所以 launchUrl 的 spawn 是注入的。
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  originFromRequest, originFromEnvironment, panelOrigin, openTaskPageFor,
  browserOpenCommand, launchUrl, probeUrl,
} from '../openBrowser.js'

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

/* ---------------- origin 解析 ---------------- */
await check('originFromRequest：Host 头 + 协议（默认 http）', () => {
  assert.equal(originFromRequest({ headers: { host: '127.0.0.1:54980' } }), 'http://127.0.0.1:54980')
  assert.equal(originFromRequest({ headers: { host: 'example.com', 'x-forwarded-proto': 'https' } }), 'https://example.com')
  assert.equal(originFromRequest({ headers: { 'x-forwarded-host': 'a.test, b.test', host: 'x' } }), 'http://a.test')
})

await check('originFromRequest：dsh-app:// 伪主机一律拒绝（那是错误地址的来源）', () => {
  assert.equal(originFromRequest({ headers: { host: 'dsh-app' } }), '')
  assert.equal(originFromRequest({ headers: { host: 'app:1234' } }), '')
  assert.equal(originFromRequest({ headers: { host: 'DSH-APP' } }), '')
})

await check('originFromRequest：CRLF / 空格 / 空 Host 一律拒绝（命令注入面）', () => {
  assert.equal(originFromRequest({ headers: {} }), '')
  assert.equal(originFromRequest({ headers: { host: 'evil.test\r\nX: y' } }), '')
  assert.equal(originFromRequest({ headers: { host: 'has space' } }), '')
  assert.equal(originFromRequest(null), '')
})

await check('originFromEnvironment：只取 DSH_WEB_URL 的 origin（丢掉 path/query）', () => {
  assert.equal(originFromEnvironment({ DSH_WEB_URL: 'http://127.0.0.1:54980/?token=x#/y' }), 'http://127.0.0.1:54980')
  assert.equal(originFromEnvironment({ DSH_WEB_URL: 'garbage' }), '')
  assert.equal(originFromEnvironment({}), '')
})

await check('panelOrigin：环境变量优先于请求头（桌面端 Host 是 dsh-app）', () => {
  const req = { headers: { host: 'dsh-app' } }
  assert.equal(panelOrigin(req, { DSH_WEB_URL: 'http://127.0.0.1:54980' }), 'http://127.0.0.1:54980')
  assert.equal(panelOrigin({ headers: { host: '127.0.0.1:1' } }, {}), 'http://127.0.0.1:1')
})

/* ---------------- 落点地址 ---------------- */
await check('openTaskPageFor：落到 /dsh-cove-task/tasks，且不带 token', () => {
  const target = openTaskPageFor({ req: { headers: { host: '127.0.0.1:54980' } }, env: {} })
  assert.equal(target.ok, true)
  assert.equal(target.url, 'http://127.0.0.1:54980/dsh-cove-task/tasks')
  assert.equal(target.url.includes('token='), false, '独立任务页是公开路由，不该带 token')
  assert.equal(target.url.includes('dsh-app'), false, '绝不返回桌面端伪地址')
})

await check('openTaskPageFor：拿不到 origin → 明确报错，不打开', () => {
  const target = openTaskPageFor({ req: { headers: {} }, env: {} })
  assert.equal(target.ok, false)
  assert.match(target.error, /无法确定插件地址/)
})

/* ---------------- 平台命令 ---------------- */
await check('browserOpenCommand：三大平台的命令与参数', () => {
  assert.deepEqual(browserOpenCommand('darwin', 'http://a.test/x'), { command: 'open', args: ['http://a.test/x'] })
  assert.deepEqual(browserOpenCommand('win32', 'http://a.test/x'), { command: 'cmd.exe', args: ['/d', '/c', 'start', '', 'http://a.test/x'] })
  assert.deepEqual(browserOpenCommand('linux', 'http://a.test/x'), { command: 'xdg-open', args: ['http://a.test/x'] })
  /* URL 永远是一个 argv 元素，不拼进 shell 字符串 */
  const withQuery = browserOpenCommand('linux', 'http://a.test/x?a=1&b=2')
  assert.equal(withQuery.args.length, 1)
})

/* ---------------- 启动 ---------------- */
const fakeChild = () => {
  const child = new EventEmitter()
  child.unref = () => {}
  return child
}

await check('launchUrl：spawn 成功 → ok，参数原样传给命令', async () => {
  const calls = []
  const pending = launchUrl('http://a.test/x', {
    platform: 'linux',
    spawn: (command, args) => {
      calls.push({ command, args })
      const child = fakeChild()
      setImmediate(() => child.emit('spawn'))
      return child
    },
  })
  const result = await pending
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(calls, [{ command: 'xdg-open', args: ['http://a.test/x'] }])
})

await check('launchUrl：spawn 立刻抛错 → 如实报错', async () => {
  const result = await launchUrl('http://a.test/x', {
    platform: 'linux',
    spawn: () => { throw new Error('EACCES') },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /EACCES/)
})

await check('launchUrl：子进程 error 事件 → 报错（不假装打开成功）', async () => {
  const result = await launchUrl('http://a.test/x', {
    platform: 'darwin',
    spawn: () => {
      const child = fakeChild()
      setImmediate(() => child.emit('error', new Error('ENOENT')))
      return child
    },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /ENOENT/)
})

await check('launchUrl：一直不触发 spawn → 超时报错，不会永远挂着', async () => {
  const result = await launchUrl('http://a.test/x', {
    platform: 'linux',
    timeoutMs: 30,
    spawn: () => fakeChild(),
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /超时/)
})

/* ---------------- 探测 ---------------- */
await check('probeUrl：2xx/3xx = ok，401/403 = unauthorized，其它 = unreachable', async () => {
  const status = (code) => ({ status: code })
  assert.equal(await probeUrl('http://a.test/x', { fetch: async () => status(200) }), 'ok')
  assert.equal(await probeUrl('http://a.test/x', { fetch: async () => status(302) }), 'ok')
  assert.equal(await probeUrl('http://a.test/x', { fetch: async () => status(401) }), 'unauthorized')
  assert.equal(await probeUrl('http://a.test/x', { fetch: async () => status(403) }), 'unauthorized')
  assert.equal(await probeUrl('http://a.test/x', { fetch: async () => status(404) }), 'unreachable')
})

await check('probeUrl：fetch 抛错 = unreachable（不会把异常漏出去）', async () => {
  assert.equal(await probeUrl('http://a.test/x', { fetch: async () => { throw new Error('ECONNREFUSED') } }), 'unreachable')
})

await check('probeUrl：探测用 redirect:manual（302 也是「能打开」）', async () => {
  let seen = null
  await probeUrl('http://a.test/x', {
    fetch: async (url, init) => {
      seen = init
      return { status: 302 }
    },
  })
  assert.equal(seen.redirect, 'manual')
  assert.equal(seen.method, 'GET')
})

console.log(`\nopenBrowser.mjs: ${passed} passed, ${failed.length} failed`)
if (failed.length) {
  console.log(`\n失败项：\n${failed.map((name) => ` - ${name}`).join('\n')}`)
  process.exitCode = 1
}
