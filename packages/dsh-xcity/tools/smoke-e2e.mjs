#!/usr/bin/env node
/**
 * 一键端到端冒烟（R526）：从零到"三单完成"只有一条命令。
 *
 * 用法：
 *   node tools/smoke-e2e.mjs                  # 默认 600s（≈4 个游戏日）
 *   node tools/smoke-e2e.mjs --timeout 900    # 窗口不够时放宽
 *   node tools/smoke-e2e.mjs --keep           # 保留 .smokehome 与宿主日志（排查用）
 *
 * 隔离（硬约束，脚本自己断言）：
 *   - DSH_HOME 固定 .smokehome（每次先删再建）；配置只从 .testhome 复制进来，绝不反向写；
 *   - 端口固定 web 3290 / bridge 7891；启动前被占用就直接失败退出，**不 kill 任何进程**；
 *   - 永远不碰正式环境的 3190 / 7791 / 7788；
 *   - .smokehome.lock 是互斥锁（O_EXCL）：另一个冒烟在跑时直接退出，不抢同一份 home。
 *
 * 流程与日志里的流程号一一对应：
 *   [1] 参数/端口/锁  [2] build        [3] 备 DSH_HOME（复制 profile / 改路径与桥端口 / 复制凭据 / 建 state）
 *   [4] 起宿主就绪    [5] spawn 三会话 [6] 写 bindings + agents.json（并回读核对）
 *   [7] dispatch 等三单 done           [8] 核对记忆（kind=task 情节）
 *   [9] 核对成本（measure-tokens 口径）[10] 清理
 * 末行固定一行 JSON 汇总；退出码 0 全绿 / 1 任一步失败（含超时）/ 2 参数或环境错。
 *
 * 为什么自己建 home 而不是用 .testhome：冒烟要能从"空世界"开始，任何旧存档、旧绑定
 * 都会把结论污染成"上次还行"。所以 .testhome 只当模板来源，状态一律落在 .smokehome。
 *
 * 时间：--timeout 是**整条链**的预算（build/起宿主/spawn/等单/核账都在里面），
 * 任何阶段都受同一个 deadline 约束，超时报告会写清卡在哪一步。
 */

import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, cpSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 常量：路径与端口都是固定的，不开放成参数（参数一多，隔离就会被"顺手"改坏）──
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(pkgRoot, '..', '..')
const SOURCE_HOME = join(pkgRoot, '.testhome')
const SOURCE_PROFILE = join(SOURCE_HOME, 'profiles', 'xcity-3')
const SMOKE_HOME = join(pkgRoot, '.smokehome')
const LOCK_FILE = join(pkgRoot, '.smokehome.lock')
const PROFILE = 'xcity-3'
const PROFILE_DIR = join(SMOKE_HOME, 'profiles', PROFILE)
const WEB_PORT = 3290
const BRIDGE_PORT = 7891
const FORBIDDEN_PORTS = [3190, 7791, 7788]
const TASK_SET = 'task.town-inspection'
const CLI = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
const DONE_STATUSES = new Set(['done', 'completed'])
const MAX_ROUNDS = 4          // 上一轮工单被判 failed 时重派的次数上限
const HOST_READY_MS = 90_000  // 宿主冷启动实测约 14s，留足 6 倍
const POLL_MS = 2_000
const REQUEST_MS = 15_000

const startedAt = Date.now()
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const seconds = () => ((Date.now() - startedAt) / 1000).toFixed(1)
const round1 = (value) => Math.round(value * 10) / 10

// 参数解析后覆盖：--timeout 是整条链的预算，--keep 决定收尾删不删 home
let timeoutSec = 600
let deadline = startedAt + timeoutSec * 1000
let keepHome = false
const remainingMs = () => deadline - Date.now()
const gatewayTimeout = () => Math.max(1_000, Math.min(REQUEST_MS, remainingMs()))

/** 参数/环境错（退出码 2）：不该重试的那类失败。 */
class EnvError extends Error {}
/** 任一验收步骤失败（退出码 1）。 */
class StepError extends Error {}

// ── 日志：流程号只在阶段开始打印，细节缩进，避免刷屏抢注意力 ──
let step = '1'
function phase(id, text) {
  step = id
  console.log('[' + id + '] ' + text + '  (+' + seconds() + 's)')
}
function note(text) {
  console.log('      ' + text)
}

function describe(error) {
  const message = error instanceof Error ? error.message : String(error)
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : ''
  return cause === '' ? message : message + '（' + cause + '）'
}

// ── [F1] 删除前的路径守卫：这个脚本只许碰它自己的 .smokehome ──
// 一处写错（比如把 SMOKE_HOME 改回 .testhome 或仓库根）就是一条 rm -rf 事故，
// 所以删除动作一律先过这道闸，不满足条件直接抛，不删。
function assertSmokeHome(target) {
  const folded = resolve(target)
  const banned = new Set([resolve('/'), repoRoot, SOURCE_HOME, resolve(pkgRoot, '..')])
  if (folded !== resolve(SMOKE_HOME)) {
    throw new EnvError('拒绝删除：' + folded + ' 不是本脚本的 home（' + resolve(SMOKE_HOME) + '）')
  }
  if (!folded.includes('.smokehome')) throw new EnvError('拒绝删除：' + folded + ' 路径里没有 .smokehome')
  if (banned.has(folded)) throw new EnvError('拒绝删除：' + folded + ' 在禁止名单里')
  return folded
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function removeSmokeHome() {
  assertSmokeHome(SMOKE_HOME)
  // 信号兜底是同步删的，那一刻宿主可能还在写 host.log：删到一半会 ENOTEMPTY，
  // 所以重试几次；实在删不掉就明说，别假装删了（目录已 gitignore，留在盘上不会误提交）。
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      rmSync(SMOKE_HOME, { recursive: true, force: true })
      return true
    } catch (error) {
      if (attempt === 5) {
        console.error('清理 ' + SMOKE_HOME + ' 失败（' + describe(error) + '）：请手动删掉它')
        return false
      }
      sleepSync(300)
    }
  }
  return false
}

// ── [F5] 互斥锁：同一份 .smokehome 只许一个冒烟 ──
// 锁是 home 的兄弟文件（<pkg>/.smokehome.lock），用 O_EXCL 创建。进程被强杀留下的锁
// 要人确认后手动删——宁可挡住，也不让两个冒烟互相拆家。
let lockOwned = false
function acquireLock() {
  try {
    writeFileSync(LOCK_FILE, String(process.pid) + ' ' + new Date().toISOString() + '\n', { flag: 'wx' })
    lockOwned = true
  } catch (error) {
    if (error instanceof Error && error.code === 'EEXIST') {
      let holder = '（读不出持有者）'
      try {
        holder = readFileSync(LOCK_FILE, 'utf8').trim()
      } catch {
        // 读不出就算了，反正要报给用户看
      }
      throw new EnvError('另一个冒烟在跑（锁 ' + LOCK_FILE + '：' + holder + '）。确认没有进程后再手动删这个锁文件')
    }
    throw new EnvError('建不了锁 ' + LOCK_FILE + '：' + describe(error))
  }
}

function releaseLock() {
  // 只删自己的锁：抢锁失败时那把锁是别人的，删掉等于放别人进来
  if (!lockOwned) return
  lockOwned = false
  try {
    unlinkSync(LOCK_FILE)
  } catch {
    // 已经没了
  }
}

// ── 参数：手写解析，不引依赖（与 tools/verify-tasks.mjs 同风格）──
function parseArgs(argv) {
  const options = { keep: false, timeoutSec: 600 }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--keep') options.keep = true
    else if (key === '--timeout') {
      const raw = argv[index + 1]
      const value = Number(raw)
      if (!Number.isFinite(value) || value <= 0) throw new EnvError('--timeout 需要正数（秒），收到 ' + JSON.stringify(raw))
      options.timeoutSec = value
      index += 1
    } else if (key === '--help' || key === '-h') {
      console.log('node tools/smoke-e2e.mjs [--keep] [--timeout 600]')
      process.exit(0)
    } else throw new EnvError('不认识的参数 ' + key + '；--help 看用法')
  }
  return options
}

// ── HTTP 小工具（超时都受总 deadline 约束）──
async function getJson(url) {
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(gatewayTimeout()) })
  } catch (error) {
    throw new StepError('GET ' + url + ' 连不上：' + describe(error))
  }
  if (!response.ok) throw new Error(url + ' → HTTP ' + response.status + ' ' + (await response.text()).slice(0, 120))
  return response.json()
}

async function postJson(url, body, timeoutMs = gatewayTimeout()) {
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // undici 把底层原因塞在 cause 里；不打出来就只剩一句没用的 "fetch failed"
    throw new StepError('POST ' + url + ' 连不上：' + describe(error))
  }
  const text = await response.text()
  if (!response.ok) throw new Error(url + ' → HTTP ' + response.status + ' ' + text.slice(0, 160))
  return JSON.parse(text)
}

// ── 端口占用检查：连得上就是被占用（不启进程、不发信号）──
function isPortFree(port) {
  return new Promise((done) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const settle = (free) => {
      socket.destroy()
      done(free)
    }
    socket.once('connect', () => settle(false))
    socket.once('error', () => settle(true))
    socket.setTimeout(1500, () => settle(true))
  })
}

// ── 宿主进程句柄：只可能是本脚本自己起的那个 ──
const hostState = { child: null, logFile: null, pidFile: null, exitCode: null, exitSignal: null }

function killHost() {
  const child = hostState.child
  if (child === null || child.pid === undefined) return
  if (hostState.exitCode !== null || hostState.exitSignal !== null) return
  try {
    // detached 起的就是进程组组长：杀整组，别把宿主的子进程留下。
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      // 已经没了
    }
  }
}

const hostGone = () => hostState.exitCode !== null || hostState.exitSignal !== null

async function waitHostExit(timeoutMs) {
  if (hostState.child === null || hostGone()) return true
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (hostGone()) return true
    await sleep(200)
  }
  return false
}

// [F4] 判死同时看退出码与信号：被信号打死时 exitCode 是 null，只看它就会以为还活着。
async function stopHost() {
  killHost()
  if (await waitHostExit(10_000)) return
  try {
    if (hostState.child !== null) process.kill(-hostState.child.pid, 'SIGKILL')
  } catch {
    // 已经没了
  }
  await waitHostExit(5_000)
}

function hostLogTail(lines = 12) {
  if (hostState.logFile === null || !existsSync(hostState.logFile)) return '（没有宿主日志）'
  const all = readFileSync(hostState.logFile, 'utf8').trimEnd().split('\n')
  return all.slice(-lines).join('\n')
}

function assertHostAlive() {
  if (hostGone()) {
    throw new StepError(
      '宿主已经退出（code=' + String(hostState.exitCode) + ' signal=' + String(hostState.exitSignal) + '）——日志末尾：\n' + hostLogTail(),
    )
  }
}

// ── 世界快照：唯一出口是 web 端的 /agent-world/api/world（与 tools/verify-tasks.mjs 同源）──
const base = 'http://127.0.0.1:' + WEB_PORT
const bridge = 'http://127.0.0.1:' + BRIDGE_PORT

async function readWorld() {
  const payload = await getJson(base + '/agent-world/api/world')
  if (payload.world === null || payload.world === undefined) throw new StepError('快照里没有 world')
  return payload.world
}

const tasksOf = (world) => (Array.isArray(world.tasks) ? world.tasks : [])
const statusOf = (task) => String(task.status ?? '')

// ── [3] 备好独立 DSH_HOME ──
// 为什么必须复制 profile：全新的 DSH_HOME 里没有 profile 配置，插件根本不会被启用
//（没有 cordis.patch.yml、没有 maxAgents/characterModel）。源固定 .testhome，目标固定 .smokehome。
function prepareHome() {
  // [3a] 先删再建：残留的 state/bindings 会让结论变成"上次还行"
  removeSmokeHome()
  mkdirSync(PROFILE_DIR, { recursive: true })

  const skipped = []
  cpSync(SOURCE_PROFILE, PROFILE_DIR, {
    recursive: true,
    dereference: false, // node_modules/dsh-xcity 是软链，保持软链
    filter: (source) => {
      const rel = relative(SOURCE_PROFILE, source)
      // 状态与旧绑定是"上一局的痕迹"，一律不带；characters 只留空目录，绑定由 [6] 现写
      if (rel === 'state' || rel === 'characters') {
        skipped.push(rel)
        return false
      }
      return true
    },
  })
  note('profile 复制完成（跳过 ' + skipped.join(' / ') + '）')
  mkdirSync(join(PROFILE_DIR, 'characters'), { recursive: true })

  // [3b] 配置里的路径与桥端口：源 profile 指向 .testhome/7791，必须改到本局的 home/端口，
  // 否则世界会写进 .testhome（等于污染正式测试环境），桥也会和正式环境抢端口。
  const patchFile = join(PROFILE_DIR, 'cordis.patch.yml')
  const raw = readFileSync(patchFile, 'utf8')
  if (!raw.includes('.testhome/profiles/' + PROFILE)) throw new EnvError('源 profile 的 cordis.patch.yml 里找不到 .testhome 路径，配置形状变了')
  if (!/^\s*port:\s*7791\s*$/m.test(raw)) throw new EnvError('源 profile 的 cordis.patch.yml 里找不到 "port: 7791"，配置形状变了')
  const rewritten = raw
    .split('.testhome/profiles/' + PROFILE)
    .join(PROFILE_DIR)
    .replace(/^(\s*)port:\s*7791\s*$/m, (_all, indent) => indent + 'port: ' + BRIDGE_PORT)
  if (rewritten.includes('.testhome')) throw new EnvError('改完路径后仍残留 .testhome 引用，隔离断言失败')
  if (/\b7791\b/.test(rewritten)) throw new EnvError('改完端口后仍残留 7791，隔离断言失败')
  writeFileSync(patchFile, rewritten, 'utf8')
  note('cordis.patch.yml 已改：stateDir/bindingsFile → 本局 home，桥端口 → ' + BRIDGE_PORT)

  // [3c] 凭据与默认模型：没有凭据模型一轮都跑不起来，任务永远停在 pending
  const credentials = join(SOURCE_HOME, '.credentials.yaml')
  if (!existsSync(credentials)) throw new EnvError('缺 .testhome/.credentials.yaml：没有模型凭据跑不出三单')
  cpSync(credentials, join(SMOKE_HOME, '.credentials.yaml'))
  const defaultModel = join(SOURCE_HOME, 'default-model.patch.yml')
  if (existsSync(defaultModel)) cpSync(defaultModel, join(SMOKE_HOME, 'default-model.patch.yml'))
  note('凭据已复制（源 .testhome → 目标 .smokehome，只读复制、不反向写）')

  // [3d] state 目录必须**先建出来**。
  // 插件的推进者锁是「openSync(stateDir/.owner.lock, 'wx')」：目录不存在时拿到 ENOENT，
  // 于是它认为自己不是推进者（owned=false），**桥就不会启动**——世界照建，7891 却永远没有监听。
  // 全新 DSH_HOME 正好命中这一条，所以这里先建目录；这是插件缺陷，冒烟不替它改代码。
  mkdirSync(join(PROFILE_DIR, 'state'), { recursive: true })
  note('已建 state 目录（插件的推进者锁要求它先存在，否则桥不启动）')
}

// ── [4] 起宿主并等就绪 ──
async function startHost() {
  mkdirSync(join(SMOKE_HOME, 'work'), { recursive: true })
  hostState.logFile = join(SMOKE_HOME, 'host.log')
  hostState.pidFile = join(SMOKE_HOME, 'host.pid')
  const logStream = createWriteStream(hostState.logFile, { flags: 'a' })
  const child = spawn(
    CLI,
    ['--profile', PROFILE, '--port', String(WEB_PORT), '--host', '127.0.0.1', '--no-open'],
    {
      cwd: join(SMOKE_HOME, 'work'), // cwd 也放进本局 home：任何相对落盘都不会漏到仓库里
      env: { ...process.env, DSH_HOME: SMOKE_HOME },
      detached: true, // 自成一个进程组，收尾时整组杀干净
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  hostState.child = child
  // [F3] pid 落盘：父进程被强杀时，人还能按这个文件把宿主清掉
  writeFileSync(hostState.pidFile, String(child.pid) + '\n', 'utf8')
  child.stdout.pipe(logStream)
  child.stderr.pipe(logStream)
  child.on('exit', (code, signal) => {
    hostState.exitCode = code
    hostState.exitSignal = signal
  })
  note('宿主 pid=' + child.pid + '（DSH_HOME=' + SMOKE_HOME + '），日志 ' + hostState.logFile)

  const until = Math.min(deadline, Date.now() + HOST_READY_MS)
  while (Date.now() < until) {
    assertHostAlive()
    try {
      return await readWorld()
    } catch (error) {
      // getJson 的"连不上"是正常的（宿主还没起），其它错误才是真错误
      if (error instanceof StepError && !error.message.startsWith('GET ')) throw error
    }
    await sleep(500)
  }
  if (remainingMs() <= 0) throw new StepError('timeout：起宿主阶段就用完了 --timeout ' + timeoutSec + 's')
  throw new StepError(HOST_READY_MS / 1000 + 's 内世界没起来——日志末尾：\n' + hostLogTail())
}

// ── [5] spawn 三会话（bridge 上的 /api/xcity/spawn）──
// 世界（3290）比桥（7891）先就绪，所以先等桥应答，别把启动竞态当成 spawn 失败。
async function waitBridge() {
  const until = Math.min(deadline, Date.now() + 60_000)
  while (Date.now() < until) {
    assertHostAlive()
    try {
      await getJson(bridge + '/api/xcity/bindings')
      return
    } catch (error) {
      if (error instanceof StepError && !error.message.startsWith('GET ')) throw error
    }
    await sleep(500)
  }
  if (remainingMs() <= 0) throw new StepError('timeout：等桥就绪阶段用光了总预算')
  throw new StepError('60s 内桥 ' + bridge + ' 没有应答——日志末尾：\n' + hostLogTail())
}

async function spawnSessions(agents) {
  const created = []
  for (const agent of agents) {
    const result = await postJson(
      bridge + '/api/xcity/spawn',
      { characterId: agent.id, characterName: agent.name },
      Math.max(5_000, Math.min(60_000, remainingMs())), // 建会话要 load 模型清单 + 选模型
    )
    if (result.ok !== true || typeof result.sessionId !== 'string') {
      throw new StepError('spawn ' + agent.id + ' 失败：' + JSON.stringify(result))
    }
    created.push({ agentId: agent.id, characterName: agent.name, characterId: agent.id, sessionId: result.sessionId })
    note(agent.id + '（' + agent.name + '）→ ' + result.sessionId)
  }
  return created
}

// ── [6] 写 bindings + agents.json（写穿到本局 home，然后回读核对）──
// spawn 只建会话不绑：绑定表按"角色"记账，spawn 不知道世界里的插槽是谁。
function writeBindings(rows) {
  const dir = join(PROFILE_DIR, 'characters')
  const bindingsFile = join(dir, 'bindings.json')
  const agentsFile = join(dir, 'agents.json')

  const previous = existsSync(bindingsFile) ? JSON.parse(readFileSync(bindingsFile, 'utf8')) : {}
  const mine = new Set(rows.map((row) => row.characterId))
  const kept = (Array.isArray(previous.bindings) ? previous.bindings : []).filter(
    (row) => typeof row?.characterId === 'string' && !mine.has(row.characterId),
  )
  const bindings = [
    ...kept,
    ...rows.map((row) => ({ characterId: row.characterId, sessionId: row.sessionId, boundAt: new Date().toISOString() })),
  ]
  writeFileSync(bindingsFile, JSON.stringify({ version: 1, bindings }, null, 2) + '\n', 'utf8')

  const agentMap = existsSync(agentsFile) ? JSON.parse(readFileSync(agentsFile, 'utf8')) : {}
  for (const row of rows) agentMap[row.agentId] = row.characterId
  writeFileSync(agentsFile, JSON.stringify(agentMap, null, 2) + '\n', 'utf8')
  return { bindingsFile, agentsFile }
}

async function verifyBindings(rows) {
  const payload = await getJson(bridge + '/api/xcity/bindings')
  const resolved = Array.isArray(payload.agents) ? payload.agents : []
  const broken = []
  for (const row of rows) {
    const hit = resolved.find((item) => item.agentId === row.agentId)
    if (hit === undefined || hit.sessionId !== row.sessionId) broken.push(row.agentId + '→' + String(hit?.sessionId ?? 'null'))
  }
  if (broken.length > 0) throw new StepError('绑定回读不符：' + broken.join(', '))
  note('回读 /api/xcity/bindings：' + resolved.length + ' 个插槽全部指向本轮会话')
}

// ── [7] dispatch 一轮，返回这一轮新单的 id ──
async function dispatchRound() {
  const before = new Set(tasksOf(await readWorld()).map((task) => task.id))
  const result = await postJson(base + '/agent-world/api/command', { command: { kind: 'dispatch', taskSet: TASK_SET } })
  if (result.accepted !== true) throw new StepError('dispatch 没被接受：' + JSON.stringify(result))

  // 命令是入队的，要等一个 tick 才落到世界；用"新出现的 id"认这一轮，别信一次快照。
  const until = Math.min(deadline, Date.now() + 20_000)
  while (Date.now() < until) {
    assertHostAlive()
    const added = tasksOf(await readWorld())
      .filter((task) => !before.has(task.id))
      .map((task) => task.id)
    if (added.length > 0) return added
    await sleep(500)
  }
  if (remainingMs() <= 0) throw new StepError('timeout：派单后等新工单落地时用光了总预算')
  throw new StepError('dispatch 之后 20s 内没有新工单落地（taskSet=' + TASK_SET + '）')
}

/** 等这一轮的三单：done / failed / timeout（timeout 由全局 deadline 决定，不另设私有超时）。 */
async function waitRoundDone(roundIds) {
  const lastStatus = new Map()
  while (true) {
    assertHostAlive()
    const world = await readWorld().catch(() => null)
    if (world !== null) {
      const rows = tasksOf(world).filter((task) => roundIds.includes(task.id))
      for (const task of rows) {
        const status = statusOf(task)
        if (lastStatus.get(task.id) !== status) {
          lastStatus.set(task.id, status)
          note('tick ' + world.tick + ' · ' + task.id + '「' + task.title + '」→ ' + status + (task.owner ? '（' + task.owner + '）' : ''))
        }
      }
      if (rows.length === roundIds.length) {
        if (rows.some((task) => statusOf(task) === 'failed')) return 'failed'
        if (rows.every((task) => DONE_STATUSES.has(statusOf(task)))) return 'done'
      }
    }
    if (Date.now() >= deadline) return 'timeout'
    await sleep(Math.min(POLL_MS, Math.max(200, remainingMs())))
  }
}

// ── [8] 记忆：三单做完要在主人记忆里留下 kind=task 的情节 ──
function checkMemory(world, roundTasks) {
  const agents = Array.isArray(world.agents) ? world.agents : []
  const episodes = []
  for (const agent of agents) {
    for (const episode of Array.isArray(agent.episodes) ? agent.episodes : []) {
      if (episode.kind === 'task') episodes.push({ agentId: agent.id, summary: episode.summary, tick: episode.tick })
    }
  }
  const missing = roundTasks
    .map((task) => task.title)
    .filter((title) => !episodes.some((episode) => String(episode.summary).includes('「' + title + '」')))
  note('kind=task 情节 ' + episodes.length + ' 条' + (missing.length === 0 ? '，三单标题都有对应记忆' : '，缺：' + missing.join(' / ')))
  for (const episode of episodes.slice(-3)) note('· ' + episode.agentId + '：' + episode.summary)
  return { episodes, missing }
}

// ── [9] 成本：复用 measure-tokens 的口径（provider 自报 usage），不在这里另算一套 ──
function measureCost(tick) {
  const days = Math.max(0.01, tick / 1440)
  const result = spawnSync(
    process.execPath,
    [join(pkgRoot, 'tools', 'measure-tokens.mjs'), '--testhome', SMOKE_HOME, '--profile', PROFILE, '--days', days.toFixed(2)],
    { encoding: 'utf8', timeout: Math.max(10_000, remainingMs()) },
  )
  if (result.status !== 0) {
    throw new StepError('measure-tokens 失败（exit ' + String(result.status) + '）：' + String(result.stdout ?? '').trim().slice(0, 240))
  }
  let payload
  try {
    payload = JSON.parse(String(result.stdout))
  } catch {
    throw new StepError('measure-tokens 的输出不是 JSON：' + String(result.stdout).slice(0, 160))
  }
  if (payload.ok !== true) throw new StepError('measure-tokens 判失败：' + JSON.stringify(payload.reason ?? payload))
  const turns = Number(payload.totals?.turns ?? 0)
  const tokensPerDay = Number(payload.tokensPerDay ?? 0)
  note(
    '模型调用 ' + turns + ' 轮 · 可计费 ' + Number(payload.totals?.billableTokens ?? 0) + ' tokens'
      + ' · 缓存占比 ' + String(payload.cacheShare ?? 'null')
      + ' · 窗口 ' + days.toFixed(2) + ' 游戏日 → ' + tokensPerDay + ' tokens/天',
  )
  return { turns, tokensPerDay }
}

// ── 清理：信号兜底走同步版（不能 await）──
let cleaned = false
/** 同步判活：进程组还在不在（信号兜底路径不能 await）。 */
function hostAliveSync() {
  if (hostState.child === null || hostGone()) return false
  try {
    process.kill(-hostState.child.pid, 0)
    return true
  } catch {
    return false
  }
}

function cleanupSync() {
  if (cleaned) return
  cleaned = true
  killHost()
  // 杀完要等它真的死：宿主收到 SIGTERM 会落盘（state/world.json + events.jsonl），
  // 先删后写会把目录又建回来——这正是上一版信号路径漏删的真因。
  for (let tick = 0; tick < 40 && hostAliveSync(); tick += 1) sleepSync(200)
  if (!keepHome) {
    try {
      removeSmokeHome()
    } catch {
      // 清理失败不能盖住真正的错误
    }
  }
  releaseLock()
}

async function cleanupGraceful() {
  await stopHost()
  if (cleaned) return
  cleaned = true
  if (!keepHome) removeSmokeHome()
  releaseLock()
}

// ── 主流程 ──
async function main() {
  // [1] 参数与环境
  phase('1', '参数与环境')
  const options = parseArgs(process.argv.slice(2))
  keepHome = options.keep
  timeoutSec = options.timeoutSec
  deadline = startedAt + timeoutSec * 1000
  note('timeout=' + timeoutSec + 's keep=' + keepHome)
  if (SMOKE_HOME === SOURCE_HOME) throw new EnvError('DSH_HOME 指向了 .testhome，隔离断言失败')
  assertSmokeHome(SMOKE_HOME)
  acquireLock()
  note('已持锁 ' + LOCK_FILE)
  for (const port of [WEB_PORT, BRIDGE_PORT]) {
    if (FORBIDDEN_PORTS.includes(port)) throw new EnvError('端口 ' + port + ' 在禁用名单里')
    if (!(await isPortFree(port))) {
      const pidHint = existsSync(join(SMOKE_HOME, 'host.pid')) ? readFileSync(join(SMOKE_HOME, 'host.pid'), 'utf8').trim() : null
      throw new EnvError(
        '端口 ' + port + ' 已被占用：本脚本绝不 kill 进程，请先自行处理'
          + (pidHint === null ? '' : '（.smokehome/host.pid 记着上次的宿主 pid=' + pidHint + '，确认后 kill -TERM -' + pidHint + '）'),
      )
    }
  }
  note('web ' + WEB_PORT + ' / bridge ' + BRIDGE_PORT + ' 都空着；正式环境的 3190/7791/7788 不会被动到')

  // [2] build（脚本自己构建，别让"忘了 build"变成假通过）
  phase('2', 'build')
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: pkgRoot,
    encoding: 'utf8',
    timeout: Math.max(30_000, remainingMs()),
  })
  if (build.status !== 0) {
    throw new StepError('npm run build 失败（exit ' + String(build.status) + '）：\n' + String(build.stdout + build.stderr).trim().split('\n').slice(-15).join('\n'))
  }
  note('build ok')

  // [3] 备 DSH_HOME
  phase('3', '备独立 DSH_HOME：' + SMOKE_HOME)
  prepareHome()

  // [4] 起宿主
  phase('4', '起宿主（约 14s）')
  const world0 = await startHost()
  const residents = (Array.isArray(world0.agents) ? world0.agents : []).map((agent) => ({ id: agent.id, name: agent.name }))
  note('世界 tick=' + world0.tick + '，居民 ' + residents.length + ' 人：' + residents.map((agent) => agent.id + '/' + agent.name).join('、'))
  if (residents.length < 3) throw new StepError('空世界只有 ' + residents.length + ' 个居民，凑不出三个会话')

  // [5] spawn：只给前三个居民开会话。
  // 调度器只把单派给**有会话的人**（claimTasks 的 sessionWorkers），所以剩下的人留在世界里当背景，
  // 不会出现"单派给了没会话的人 → 永远 pending"。
  const workers = residents.slice(0, 3)
  if (residents.length > workers.length) {
    note('只给前 3 人开会话，其余 ' + (residents.length - workers.length) + ' 人不派单（调度器只认有会话的人）')
  }
  phase('5', 'spawn 三会话')
  await waitBridge()
  const rows = await spawnSessions(workers)

  // [6] bindings
  phase('6', '写 bindings + agents.json')
  const files = writeBindings(rows)
  note('写 ' + files.bindingsFile)
  note('写 ' + files.agentsFile)
  await verifyBindings(rows)

  // [7] dispatch + 等三单
  phase('7', 'dispatch ' + TASK_SET + ' → 等三单 done')
  let roundIds = []
  let outcome = 'timeout'
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    roundIds = await dispatchRound()
    note('第 ' + round + ' 轮派发：' + roundIds.join(', '))
    outcome = await waitRoundDone(roundIds)
    if (outcome === 'done') break
    if (outcome === 'timeout') break
    if (round < MAX_ROUNDS) note('这一轮有单判 failed，重派一轮（' + round + '/' + MAX_ROUNDS + '）')
  }

  const world = await readWorld()
  const roundTasks = tasksOf(world).filter((task) => roundIds.includes(task.id))
  const board = { done: 0, failed: 0, pending: 0 }
  for (const task of roundTasks) {
    const status = statusOf(task)
    if (DONE_STATUSES.has(status) && typeof task.output === 'string' && task.output.trim() !== '' && task.owner) board.done += 1
    else if (status === 'failed') board.failed += 1
    else board.pending += 1
  }

  // 超时要能一眼看出卡在哪：卡住的步骤 + 当前 tick + 三单状态。
  if (outcome !== 'done') {
    const lines = roundTasks.map(
      (task) => task.id + '「' + task.title + '」' + statusOf(task) + ' owner=' + String(task.owner ?? 'null') + ' output=' + (task.output ? '有' : '空'),
    )
    const reason = outcome === 'timeout' ? 'timeout' : 'task-failed'
    throw new StepError(
      '第 [7] 步没走完（' + reason + '）：tick=' + world.tick + '，' + timeoutSec + 's 到点。三单状态：\n' + lines.join('\n'),
    )
  }
  note('三单 done：' + roundTasks.map((task) => task.id + '/' + task.owner).join(', ') + '（tick=' + world.tick + '）')

  // [8] 记忆
  phase('8', '核对记忆（kind=task 情节）')
  const memory = checkMemory(world, roundTasks)
  if (memory.missing.length > 0) throw new StepError('三单做完了，但记忆里缺这些工单的情节：' + memory.missing.join(' / '))

  // [9] 成本
  phase('9', '核对成本（measure-tokens 口径）')
  const cost = measureCost(world.tick)
  if (!(cost.turns > 0)) throw new StepError('会话日志里 0 轮模型调用：三单不是真跑出来的')
  if (!(cost.tokensPerDay > 0)) throw new StepError('tokensPerDay 为 0：成本口径没拿到 usage')

  // [10] 清理
  phase('10', '收尾：杀宿主 pid=' + String(hostState.child?.pid ?? '-'))
  await cleanupGraceful()
  note('宿主已退出（code=' + String(hostState.exitCode) + ' signal=' + String(hostState.exitSignal) + '）')
  note(keepHome ? '保留 ' + SMOKE_HOME + '（宿主日志 ' + String(hostState.logFile) + '）' : '已删除 ' + SMOKE_HOME)

  // [11] 汇总：末行固定一行 JSON
  console.log(
    JSON.stringify({
      ok: true,
      tick: world.tick,
      tasks: board,
      memoryEpisodes: memory.episodes.length,
      cost: { turns: cost.turns, tokensPerDay: cost.tokensPerDay },
      seconds: round1(Number(seconds())),
    }),
  )
}

// [F3] 信号兜底：Ctrl-C / kill / 父进程退出都要把宿主进程组和本局 home 收掉。
// 'exit' 里只能同步做事，所以清理逻辑拆成同步版；正常路径走 async 版（能等宿主真的死掉）。
process.on('SIGINT', () => {
  console.error('SMOKE ABORT SIGINT（已清理本脚本起的宿主与 ' + SMOKE_HOME + '）')
  cleanupSync()
  process.exit(130)
})
process.on('SIGTERM', () => {
  console.error('SMOKE ABORT SIGTERM（已清理本脚本起的宿主与 ' + SMOKE_HOME + '）')
  cleanupSync()
  process.exit(143)
})
process.on('exit', () => {
  cleanupSync()
})

try {
  await main()
} catch (error) {
  const code = error instanceof EnvError ? 2 : 1
  const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
  const detail = error instanceof Error ? error.message.split('\n').slice(1).join('\n') : undefined
  console.error('SMOKE FAIL ' + reason + (detail === undefined || detail === '' ? '' : '\n' + detail))
  if (hostState.logFile !== null && existsSync(hostState.logFile)) {
    console.error('宿主日志末尾：\n' + hostLogTail(6))
  }
  try {
    await cleanupGraceful()
  } catch {
    // 清理失败不能盖住真正的错误
  }
  console.log(JSON.stringify({ ok: false, reason, step, seconds: round1(Number(seconds())) }))
  process.exitCode = code
}
