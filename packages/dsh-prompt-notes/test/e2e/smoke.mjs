#!/usr/bin/env node
/**
 * 真实环境冒烟测试：对隔离的 DSH 测试实例（scripts/e2e.sh start）跑完整的三通道链路。
 *
 *   node test/e2e/smoke.mjs            # 自动用 scripts/e2e.sh url 取地址
 *   PN_TEST_URL='http://127.0.0.1:48990/?token=…' node test/e2e/smoke.mjs
 *
 * 断言（都是对真实系统的读取，不是假 ctx）：
 *   1. 路由可达（说明 webServer 前缀注册正确）
 *   2. prompt 便签的文本出现在 systemPrompt.assemble() 的真实结果里
 *   3. skill 便签出现在真实 skills.list()，来源是 prompt-notes
 *   4. MCP 便签经 mcpManager 连上测试桩，工具进入真实工具列表
 *   5. 暂停总开关后三条通道都撤回；删除便签后都消失
 * 结束时清理自己创建的便签；任何断言失败都以非零码退出并说明哪一条。
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..', '..')
const MARK = `e2e-marker-${Date.now().toString(36)}`

const rawUrl = process.env.PN_TEST_URL
  || execFileSync(join(pkg, 'scripts', 'e2e.sh'), ['url'], { encoding: 'utf8' }).trim()
if (!rawUrl) { console.error('no test instance URL: run scripts/e2e.sh start first'); process.exit(2) }
const base = new URL(rawUrl).origin

// 带令牌的 URL 会种下认证 cookie；之后的请求带上它
let cookie = ''
{
  const res = await fetch(rawUrl, { redirect: 'manual' })
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
}
const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, {
    method, headers: { cookie, 'content-type': 'application/json', ...(method === 'GET' ? {} : { 'x-dsh-prompt-notes': '1' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const until = async (what, fn, ms = 20000) => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for: ${what}`)
    await new Promise((r) => setTimeout(r, 400))
  }
}

let failures = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`); if (!ok) failures++ }
const sys = async () => (await call('/dsh-prompt-notes/system')).json
const mineText = (s) => (s?.sections ?? []).find((x) => x.mine)?.text ?? ''
const ids = []

try {
  const st = await call('/dsh-prompt-notes/state')
  check('route reachable (200)', st.status === 200, `status ${st.status}`)
  if (st.status !== 200) throw new Error('route unreachable; is the plugin mounted and the host restarted?')

  const mk = async (body) => { const r = await call('/dsh-prompt-notes/notes', 'POST', body); if (r.status !== 201) throw new Error(`create failed: ${JSON.stringify(r)}`); return r.json.notes.at(-1).id }
  ids.push(await mk({ kind: 'prompt', title: MARK, body: `Marker ${MARK}`, scope: 'global' }))
  ids.push(await mk({ kind: 'skill', body: `# body ${MARK}`, scope: 'global',
    skill: { name: `skill-${MARK}`, description: `e2e skill ${MARK}`, whenToUse: `when ${MARK}`, invocation: { modelInvocable: false, userInvocable: true } } }))
  ids.push(await mk({ kind: 'mcp', body: 'fixture', enabled: true, scope: 'global',
    mcp: { name: 'pnecho', transport: 'stdio', command: 'node', args: [join(here, '..', 'fixtures', 'echo-mcp.mjs')] } }))

  const s1 = await until('prompt marker in the real assembled prompt', async () => { const s = await sys(); return mineText(s).includes(MARK) ? s : null })
  check('prompt note is in the real assembled system prompt', mineText(s1).includes(MARK))

  const s2 = await until('skill in the real skill list', async () => { const s = await sys(); return s.skills.some((k) => k.name === `skill-${MARK}`) ? s : null })
  const listed = s2.skills.find((k) => k.name === `skill-${MARK}`)
  check('skill note is in the real skills.list (provider prompt-notes)', listed?.provider === 'prompt-notes')
  check('the real skill list carries whenToUse and the invocation policy',
    listed?.whenToUse === `when ${MARK}` && listed?.modelInvocable === false && listed?.userInvocable === true,
    JSON.stringify({ whenToUse: listed?.whenToUse, model: listed?.modelInvocable, user: listed?.userInvocable }))

  const s3 = await until('MCP connected', async () => { const s = await sys(); return s.mcp.find((m) => m.name === 'pnecho' && m.state === 'connected' && m.tools >= 1) ? s : null })
  check('MCP note connected through the real mcpManager with its tool', Boolean(s3.mcp.find((m) => m.name === 'pnecho')), JSON.stringify(s3.mcp))
  check('MCP tool is in the real tool list', s3.tools.mcpCount >= 1, JSON.stringify(s3.tools))

  // 总开关：三条通道都撤回
  await call('/dsh-prompt-notes/paused', 'PUT', { paused: true })
  const s4 = await until('everything withdrawn while paused', async () => {
    const s = await sys()
    return !mineText(s).includes(MARK) && !s.skills.some((k) => k.name === `skill-${MARK}`) && !s.mcp.some((m) => m.name === 'pnecho') ? s : null
  })
  check('master switch withdraws prompt, skill and MCP', Boolean(s4))
  await call('/dsh-prompt-notes/paused', 'PUT', { paused: false })
} catch (error) {
  failures++
  console.log(`FAIL  ${error.message}`)
} finally {
  await call('/dsh-prompt-notes/paused', 'PUT', { paused: false }).catch(() => {})
  for (const id of ids) await call(`/dsh-prompt-notes/notes/${id}`, 'DELETE').catch(() => {})
  try {
    const s = await until('cleanup withdrawn', async () => { const x = await sys(); return !mineText(x).includes(MARK) && !x.mcp.some((m) => m.name === 'pnecho') ? x : null }, 12000)
    check('deleting the notes removes them everywhere', Boolean(s))
  } catch (e) { failures++; console.log(`FAIL  cleanup: ${e.message}`) }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall e2e checks passed')
process.exit(failures ? 1 : 0)
