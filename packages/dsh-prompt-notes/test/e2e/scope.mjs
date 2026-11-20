#!/usr/bin/env node
/**
 * 真实会话里的作用域验证（M1）。
 *
 *   node test/e2e/scope.mjs            # 自动用 scripts/e2e.sh url 取地址
 *   PN_TEST_URL='http://127.0.0.1:48990/?token=…' node test/e2e/scope.mjs
 *
 * 前置：scripts/e2e.sh start 已经跑起来（Host 半体最新）。
 *
 * 这里用的是**真的会话**：通过 DSH 自己的 `session/create` RPC 建两个会话（各自指定 cwd），
 * 于是每个会话都有真的 Agent、真的 fiber 树、真的 cwd。然后只做「读真实系统」的断言：
 *   1. 会话级 prompt 只出现在该会话的 assemble 结果里
 *   2. 工作区级 prompt 按会话 cwd 出现 / 不出现
 *   3. 会话级 skill 只出现在该会话的 skills.list（验证 agent.ctx.inject(['skills']) 真的挂上了）
 *   4. 工作区级 skill 同上，按 cwd
 *   5. 面板状态（/state）相对观察者正确：自己的 → injected，别人的 → elsewhere
 *   6. 会话级 MCP：进程全局登记（设计如此），但面板对该会话 injected、对另一个会话 elsewhere
 *   7. 实例日志里没有 Cordis 的 "without inject" / 会话提供方挂载失败
 *
 * 8. 冷启动：重启实例 → 会话变冷 → 恢复同一会话后，会话级 skill 提供方重新挂上
 *
 * 不做的事（诚实记录）：真正「调一次 MCP 工具」需要模型发出 tool call，本测试不调模型，
 * 所以 tools.guard 的拒绝路径不在这里跑——它由单测「apply: MCP 作用域 guard」覆盖，
 * 这里只验证它依赖的真实观察者解析（上面的 1–2 与 5 就是同一个 appliesTo + 同一个 cwd 来源）。
 *
 * 需要重启的检查可以用 PN_SCOPE_RESTART=0 关掉（约省 8 秒）。
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..', '..')
const RUN = Date.now().toString(36)
const MARK = `scope-${RUN}`

const rawUrl = process.env.PN_TEST_URL
  || execFileSync(join(pkg, 'scripts', 'e2e.sh'), ['url'], { encoding: 'utf8' }).trim()
if (!rawUrl) { console.error('no test instance URL: run scripts/e2e.sh start first'); process.exit(2) }
const base = new URL(rawUrl).origin

let cookie = ''
{
  const res = await fetch(rawUrl, { redirect: 'manual' })
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
}

const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'content-type': 'application/json', ...(method === 'GET' ? {} : { 'x-dsh-prompt-notes': '1' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

/** DSH 自己的会话创建 RPC：这样建出来的会话有真 Agent，和浏览器里点「新对话」是同一条路。 */
const createSession = async (sessionId, cwd) => {
  const res = await fetch(base + '/api/session/create', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: crypto.randomUUID(),
      method: 'session/create',
      payload: { args: { request: { sessionId, cwd } } },
    }),
  })
  const json = await res.json().catch(() => null)
  const value = json?.result?.value ?? json?.result
  if (res.status !== 200 || !value?.sessionId) throw new Error(`session/create failed: ${res.status} ${JSON.stringify(json).slice(0, 300)}`)
  return value.sessionId
}

/** 恢复一个持久化会话：同一个 RPC，带上它创建时的 cwd（DSH 拒绝跨目录恢复）。 */
const resumeSession = (sessionId, cwd) => createSession(sessionId, cwd)

/**
 * 重启隔离实例（改了 Host 半体、或想验证「冷会话 → 恢复」时才需要）。
 * stop 之后 start 会换一次性令牌，所以重启后必须重新用 url 换 cookie。
 */
const restartInstance = async () => {
  execFileSync(join(pkg, 'scripts', 'e2e.sh'), ['stop'], { encoding: 'utf8' })
  const child = spawn(join(pkg, 'scripts', 'e2e.sh'), ['start'], { stdio: 'ignore', detached: true })
  child.unref()
  const deadline = Date.now() + 120000
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000))
    let url = ''
    try { url = execFileSync(join(pkg, 'scripts', 'e2e.sh'), ['url'], { encoding: 'utf8' }).trim() } catch { url = '' }
    if (url) {
      const res = await fetch(url, { redirect: 'manual' })
      cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
      if (cookie) return
    }
    if (Date.now() > deadline) throw new Error('the isolated instance did not come back after restart')
  }
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
const note = (text) => console.log(`SKIP  ${text}`)

const sysFor = async (sessionId) => (await call(`/dsh-prompt-notes/system?session=${encodeURIComponent(sessionId)}`)).json
const stateFor = async (sessionId) => (await call(`/dsh-prompt-notes/state?session=${encodeURIComponent(sessionId)}`)).json
const mineText = (s) => (s?.sections ?? []).find((x) => x.mine)?.text ?? ''
const hasSkill = (s, name) => (s?.skills ?? []).some((k) => k.name === name && k.provider === 'prompt-notes')

const mk = async (body) => {
  const r = await call('/dsh-prompt-notes/notes', 'POST', body)
  if (r.status !== 201) throw new Error(`create failed (${r.status}): ${JSON.stringify(r.json)}`)
  return r.json.notes.at(-1).id
}

const ids = []
const tempDirs = [] // 自己建的临时目录，结束时删掉
let a = null // 会话 A：cwd = dirA，作用域便签都钉在它身上
let b = null // 会话 B：cwd = dirB，所有东西都「不适用」
let c = null // 会话 C：用来验证「重启 → 冷 → 恢复」，以及挂在它身上的 MCP 的生死
let dirC = ''

try {
  // 三个目录：真实存在，路径各不相同
  const dirA = join('/tmp', `pn-scope-a-${RUN}`)
  const dirB = join('/tmp', `pn-scope-b-${RUN}`)
  dirC = join('/tmp', `pn-scope-c-${RUN}`)
  tempDirs.push(dirA, dirB, dirC)
  mkdirSync(dirA, { recursive: true })
  mkdirSync(dirB, { recursive: true })
  mkdirSync(dirC, { recursive: true })

  // ① 真会话
  a = await createSession(`session-scope-a-${RUN}`, dirA)
  b = await createSession(`session-scope-b-${RUN}`, dirB)
  c = await createSession(`session-scope-c-${RUN}`, dirC)
  const sa0 = await until('session A visible in the real agent registry', async () => { const s = await sysFor(a); return s?.session?.found ? s : null })
  const sb0 = await until('session B visible in the real agent registry', async () => { const s = await sysFor(b); return s?.session?.found ? s : null })
  await until('session C visible in the real agent registry', async () => { const s = await sysFor(c); return s?.session?.found ? s : null })
  check('two real sessions exist (real agents, real cwd)', sa0.session.found && sb0.session.found && sa0.session.cwd !== sb0.session.cwd,
    `A=${sa0.session.cwd} B=${sb0.session.cwd}`)

  const cwdA = sa0.session.cwd // 用服务端报告的物理路径当工作区目标（macOS 的 /tmp → /private/tmp）
  const cwdB = sb0.session.cwd

  // ② 会话级 prompt
  ids.push(await mk({ kind: 'prompt', title: `${MARK}-session`, body: `SESSION ${MARK}`, scope: 'session', target: a }))
  const sA = await until('session-scoped prompt in A', async () => { const s = await sysFor(a); return mineText(s).includes(`SESSION ${MARK}`) ? s : null })
  check('session-scoped prompt is injected into its own session', mineText(sA).includes(`SESSION ${MARK}`))
  const sB = await sysFor(b)
  check('session-scoped prompt is NOT injected into another session', !mineText(sB).includes(`SESSION ${MARK}`))

  // ③ 工作区级 prompt（目标 = A 的 cwd）
  ids.push(await mk({ kind: 'prompt', title: `${MARK}-ws`, body: `WORKSPACE ${MARK}`, scope: 'workspace', target: cwdA }))
  const sA2 = await until('workspace-scoped prompt in A', async () => { const s = await sysFor(a); return mineText(s).includes(`WORKSPACE ${MARK}`) ? s : null })
  check('workspace-scoped prompt is injected where cwd matches', mineText(sA2).includes(`WORKSPACE ${MARK}`))
  const sB2 = await until('workspace prompt absent in B', async () => { const s = await sysFor(b); return !mineText(s).includes(`WORKSPACE ${MARK}`) ? s : null })
  check('workspace-scoped prompt is NOT injected in another cwd', !mineText(sB2).includes(`WORKSPACE ${MARK}`), `B cwd=${cwdB}`)

  // ④ 会话级 skill（走 agent.ctx 上注册的提供方）
  const skillSession = `skill-session-${RUN}`
  ids.push(await mk({ kind: 'skill', body: `# ${MARK}\nsession skill body`, scope: 'session', target: a,
    skill: { name: skillSession, description: `session skill ${MARK}` } }))
  const skA = await until('session-scoped skill in A', async () => { const s = await sysFor(a); return hasSkill(s, skillSession) ? s : null })
  check('session-scoped skill appears in its own session (agent.ctx provider attached)', hasSkill(skA, skillSession))
  const skB = await until('session skill absent in B', async () => { const s = await sysFor(b); return !hasSkill(s, skillSession) ? s : null })
  check('session-scoped skill is NOT listed in another session', !hasSkill(skB, skillSession))

  // ⑤ 工作区级 skill
  const skillWs = `skill-ws-${RUN}`
  ids.push(await mk({ kind: 'skill', body: `# ${MARK}\nworkspace skill body`, scope: 'workspace', target: cwdA,
    skill: { name: skillWs, description: `workspace skill ${MARK}` } }))
  const swA = await until('workspace-scoped skill in A', async () => { const s = await sysFor(a); return hasSkill(s, skillWs) ? s : null })
  check('workspace-scoped skill appears where cwd matches', hasSkill(swA, skillWs))
  const swB = await until('workspace skill absent in B', async () => { const s = await sysFor(b); return !hasSkill(s, skillWs) ? s : null })
  check('workspace-scoped skill is NOT listed in another cwd', !hasSkill(swB, skillWs))

  // ⑥ 面板状态相对观察者（同一份数据，两个会话看到不同状态）
  const stA = await stateFor(a)
  const stB = await stateFor(b)
  const statusOf = (st, title) => (st?.notes ?? []).find((n) => n.title === `${MARK}-${title}`)?.status
  check('panel: own session note is injected for A, elsewhere for B',
    statusOf(stA, 'session') === 'injected' && statusOf(stB, 'session') === 'elsewhere',
    `A=${statusOf(stA, 'session')} B=${statusOf(stB, 'session')}`)
  check('panel: workspace note follows the real cwd',
    statusOf(stA, 'ws') === 'injected' && statusOf(stB, 'ws') === 'elsewhere',
    `A=${statusOf(stA, 'ws')} B=${statusOf(stB, 'ws')}`)

  // ⑦ 会话级 MCP：进程全局登记（现状设计），面板按会话判定
  const mcpName = `pns${RUN.replace(/[^a-z0-9]/g, '')}`.slice(0, 30)
  ids.push(await mk({ kind: 'mcp', body: 'fixture', enabled: true, scope: 'session', target: c,
    mcp: { name: mcpName, transport: 'stdio', command: 'node', args: [join(here, '..', 'fixtures', 'echo-mcp.mjs')] } }))
  const stC = await until('session MCP registered and connected', async () => {
    const s = await stateFor(c)
    const n = (s?.notes ?? []).find((x) => x.mcp?.name === mcpName)
    return n?.runtime?.state === 'connected' ? s : null
  })
  const stB3 = await stateFor(b)
  const mcpStatus = (st) => (st?.notes ?? []).find((n) => n.mcp?.name === mcpName)?.status
  check('session MCP is registered and connected while its session lives', mcpStatus(stC) === 'injected', `C=${mcpStatus(stC)}`)
  check('panel: same MCP is elsewhere for the other session', mcpStatus(stB3) === 'elsewhere', `B=${mcpStatus(stB3)}`)
  // 进程是全局的一个，但「它连上之后工具挂到谁的列表里」是 per-agent 的：
  // 不适用的会话由 tools.restrict 把 mcp__* 藏起来（M2 第二半），调用那一刻还有 guard 兜底。
  // /system 每个观察者有 3 秒缓存，所以轮询到「主人的工具数 ≥ 1」再断言另一侧是 0。
  const ownerView = await until('the owner session sees the MCP tool', async () => {
    const s = await sysFor(c)
    return s.mcp.find((m) => m.name === mcpName)?.tools >= 1 ? s : null
  })
  check('the owning session sees the MCP tool', ownerView.mcp.find((m) => m.name === mcpName).tools >= 1)
  const otherView = await until('the other session does not see the MCP tool', async () => {
    const s = await sysFor(b)
    return s.mcp.find((m) => m.name === mcpName)?.tools === 0 ? s : null
  })
  check('an inapplicable session does not see the MCP tool (tools.restrict)',
    otherView.mcp.find((m) => m.name === mcpName).tools === 0,
    `B sees ${otherView.mcp.find((m) => m.name === mcpName).tools} tool(s) of it, mcpCount=${otherView.tools.mcpCount}`)
  note('tools.guard deny path needs a real model tool call; its logic is covered by the unit test "apply: MCP 作用域 guard"')

  // ⑧ 冷启动：重启实例后，会话变成「冷」的（没有 Agent）；再恢复时 session 级提供方必须重新挂上。
  //    这条容易被忽略：provider 注册在 agent.ctx 上，重启后得靠 agent/created 再挂一次。
  if (process.env.PN_SCOPE_RESTART !== '0') {
    const skillCold = `skill-cold-${RUN}`
    ids.push(await mk({ kind: 'skill', body: `# ${MARK}\ncold skill body`, scope: 'session', target: c,
      skill: { name: skillCold, description: `cold skill ${MARK}` } }))
    await until('session C has its skill before restart', async () => {
      const s = await sysFor(c)
      return hasSkill(s, skillCold) ? s : null
    })
    await restartInstance()
    const cold0 = await until('restarted instance answers again', async () => {
      const r = await call('/dsh-prompt-notes/state')
      return r.status === 200 ? r.json : null
    })
    check('restart kept the notes data', (cold0.notes ?? []).some((n) => n.skill?.name === skillCold))
    const coldCold = await sysFor(c)
    check('after restart the session is cold (no live agent)', coldCold.session.found === false, JSON.stringify(coldCold.session))
    // 没有活动会话 → 钉在会话上的 MCP 不该有进程在跑
    check('session MCP is not registered while its session is cold',
      !(await call('/dsh-prompt-notes/system')).json.mcp.some((m) => m.name === mcpName))
    // 用创建时的同一个字符串做恢复的 cwd：DSH 拒绝对「换了目录」的会话做原地恢复。
    const resumed = await resumeSession(c, dirC)
    check('the persisted session resumes', resumed === c)
    const coldLive = await until('session provider re-attached after resume', async () => {
      const s = await sysFor(c)
      return s.session.found && hasSkill(s, skillCold) ? s : null
    })
    check('session-scoped skill re-attaches after restart + resume', hasSkill(coldLive, skillCold))
    const liveAgain = await until('session MCP re-registered after resume', async () => {
      const s = await stateFor(c)
      const n = (s?.notes ?? []).find((x) => x.mcp?.name === mcpName)
      return n?.runtime?.state === 'connected' ? s : null
    })
    check('session MCP is registered again once its session comes back', Boolean(liveAgain))
    const toolsBack = await until('the tool is visible to the resumed session again', async () => {
      const s = await sysFor(c)
      return s.mcp.find((m) => m.name === mcpName)?.tools >= 1 ? s : null
    })
    check('and its tool is visible to that session again', toolsBack.mcp.find((m) => m.name === mcpName).tools >= 1)
  } else {
    note('restart/resume check skipped (PN_SCOPE_RESTART=0)')
  }

  // ⑨ 实例日志：Cordis 注入类错误不能有
  const log = execFileSync('tail', ['-n', '600', join(process.env.PN_TEST_HOME || '/tmp/pn-test-home', 'web.log')], { encoding: 'utf8' })
  const badLines = log.split('\n').filter((l) => /without inject|could not attach session skill provider|tools service unavailable/.test(l))
  check('no cordis injection errors in the instance log', badLines.length === 0, badLines.slice(0, 2).join(' | '))
} catch (error) {
  failures++
  console.log(`FAIL  ${error.message}`)
} finally {
  for (const id of ids) await call(`/dsh-prompt-notes/notes/${id}`, 'DELETE').catch(() => {})
  try {
    await until('markers withdrawn', async () => {
      for (const s of [a, b]) {
        if (!s) continue
        const st = await sysFor(s)
        if (mineText(st).includes(MARK) || (st.skills ?? []).some((k) => k.name.includes(RUN))) return null
      }
      return true
    }, 12000)
    check('deleting the notes withdraws prompt and skill markers everywhere', true)
  } catch (e) { failures++; console.log(`FAIL  cleanup: ${e.message}`) }
  for (const dir of tempDirs) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* 删不掉就留着 */ } }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall scope checks passed')
process.exit(failures ? 1 : 0)