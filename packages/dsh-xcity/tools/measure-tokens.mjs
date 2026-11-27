#!/usr/bin/env node
/**
 * 每轮 / 每日 token 成本计量。**只读**：不写世界、不启进程、不改代码。
 *
 * 用法：
 *   node tools/measure-tokens.mjs
 *   node tools/measure-tokens.mjs --base http://127.0.0.1:3190 --testhome .testhome --profile xcity-3
 *
 * 数据源：
 *   .testhome/sessions/<slug>/<sessionId>/session.v4.jsonl.zstd  会话日志（/usr/bin/env zstd -dc 解出，逐行解析）
 *   .testhome/profiles/<profile>/state/events.jsonl              世界事件（initiative 次数 + 天数兜底）
 *   GET {base}/agent-world/api/world                             world.tick → 天数（tick / 1440）
 *
 * 口径（见输出里的 method 字段）：estTokens = ceil(字符数 / 4)，只覆盖模型**输出**侧，
 * 不含输入上下文（系统提示 / 工具结果），所以它是粗估上界，不是计费值。
 */

import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SESSION_FILE = 'session.v4.jsonl.zstd'
const TICKS_PER_DAY = 1440
const CHARS_PER_TOKEN = 4
const REQUEST_MS = 3000

// [0] 参数：手写解析，不引依赖（与 tools/verify-tasks.mjs 同风格）
function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const base = String(arg('base', 'http://127.0.0.1:3190')).replace(/\/+$/, '')
const testhomeArg = String(arg('testhome', '.testhome'))
const testhome = isAbsolute(testhomeArg) ? testhomeArg : join(pkgRoot, testhomeArg)
const profile = String(arg('profile', 'xcity-3'))
const sessionsDir = join(testhome, 'sessions')
const eventsFile = join(testhome, 'profiles', profile, 'state', 'events.jsonl')

function done(result, code) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  process.exit(code)
}

function fail(reason, extra) {
  done({ ok: false, reason, ...extra }, 1)
}

const round2 = (value) => Math.round(value * 100) / 100

// [1] 会话日志：定位 sessions/<workspace-slug>/<sessionId>/session.v4.jsonl.zstd
async function findSessionFiles(dir, depth = 0) {
  if (depth > 3) return []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await findSessionFiles(full, depth + 1)))
    else if (entry.name === SESSION_FILE) found.push(full)
  }
  return found
}

// [1a] 逐行解析；空行与坏行（日志被截断）直接跳过
function parseJsonl(text) {
  const events = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // 忽略坏行
    }
  }
  return events
}

// [1b] 解压到内存再解析（zstd 不是 zlib，只能调系统命令）
async function readSessionEvents(file) {
  let stdout
  try {
    const result = await execFileAsync('/usr/bin/env', ['zstd', '-dc', file], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    stdout = result.stdout
  } catch (error) {
    // zstd 不在 PATH 时 /usr/bin/env 退出码 127，stderr 是 "env: zstd: No such file or directory"
    const missing = error.code === 127 || error.code === 'ENOENT' || /zstd/.test(String(error.stderr ?? ''))
    if (missing) return { error: 'zstd-missing', detail: null }
    return { error: 'zstd-failed', detail: String(error.message ?? '').slice(0, 160) }
  }
  return { events: parseJsonl(stdout) }
}

/**
 * [2] 单会话统计
 *   turns          assistant 消息条数（≈ 模型回复次数，「每轮成本」的分子）
 *   assistantChars 每条 assistant 消息里 text + reasoning + tool-call 参数的字符数
 *   toolCalls      tool/call 事件数
 */
function summarize(file, events) {
  const sessionId = basename(dirname(file))
  let turns = 0
  let assistantChars = 0
  let toolCalls = 0
  for (const event of events) {
    if (event.type === 'tool/call') toolCalls += 1
    if (event.type !== 'assistant/message') continue
    turns += 1
    const content = event.data?.message?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (part.type === 'text' || part.type === 'reasoning') {
        assistantChars += typeof part.text === 'string' ? part.text.length : 0
      } else if (part.type === 'tool-call') {
        assistantChars += JSON.stringify(part.arguments ?? {}).length
      }
    }
  }
  return { sessionId, turns, assistantChars, toolCalls, estTokens: Math.ceil(assistantChars / CHARS_PER_TOKEN) }
}

// [3] 世界事件：8 MB 级追加日志，整个流程只读一次；initiative 计数与天数兜底都从它取
let worldEventsCache = null
async function worldEvents() {
  if (worldEventsCache !== null) return worldEventsCache
  let text
  try {
    text = await readFile(eventsFile, 'utf8')
  } catch {
    worldEventsCache = []
    return worldEventsCache
  }
  worldEventsCache = parseJsonl(text)
  return worldEventsCache
}

// [4] 世界天数：优先 world.tick（API）；API 不可达时退到 events.jsonl 的**最后**一个 tick
//     （events.jsonl 跨重启追加，取最大 tick 会把已经作废的历史世界算进来）
async function worldDays() {
  try {
    const res = await fetch(base + '/agent-world/api/world', { signal: AbortSignal.timeout(REQUEST_MS) })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const payload = await res.json()
    const tick = Number(payload?.world?.tick)
    if (Number.isFinite(tick) && tick >= 0) return { tick, daysSource: 'api' }
  } catch {
    // 落到 events.jsonl
  }
  const events = await worldEvents()
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const tick = Number(events[i].tick)
    if (Number.isFinite(tick)) return { tick, daysSource: 'events' }
  }
  return { tick: null, daysSource: 'none' }
}

// [5] 角色归并：会话 id 形如 xcity-agent<N>-<suffix>，world 角色 id 形如 agent-N
function agentOfSession(sessionId) {
  const match = /agent(\d+)/.exec(sessionId)
  return match === null ? 'unknown' : 'agent-' + match[1]
}

// [6] 主流程：读会话日志
const files = (await findSessionFiles(sessionsDir)).sort()
if (files.length === 0) {
  fail('no-sessions', { sessionsDir, hint: '先跑一次世界，或确认 --testhome 指向正确目录' })
}

const perSession = []
const errors = []
for (const file of files) {
  const read = await readSessionEvents(file)
  if (read.error !== undefined) {
    errors.push({ file: relative(pkgRoot, file), error: read.error, detail: read.detail })
    continue
  }
  if (read.events.length === 0) {
    errors.push({ file: relative(pkgRoot, file), error: 'empty', detail: null })
    continue
  }
  perSession.push(summarize(file, read.events))
}
if (perSession.length === 0) {
  const kinds = new Set(errors.map((error) => error.error))
  fail(kinds.has('zstd-missing') ? 'zstd-missing' : 'zstd-failed', {
    hint: kinds.has('zstd-missing') ? '装上 zstd（brew install zstd）后重跑' : '检查 .testhome/sessions 下的日志是否完整',
    failedSessions: errors.length,
    errors: errors.slice(0, 5),
  })
}
perSession.sort((left, right) => (left.sessionId < right.sessionId ? -1 : 1))

// [6a] 天数与除法
const { tick, daysSource } = await worldDays()
const daysRaw = tick === null ? 0 : tick / TICKS_PER_DAY
const days = tick === null ? null : round2(daysRaw)
const perDay = (value) => (daysRaw > 0 ? Math.round(value / daysRaw) : null)

// [6b] 按角色累加
const agentTotals = new Map()
for (const session of perSession) {
  const agentId = agentOfSession(session.sessionId)
  const total = agentTotals.get(agentId) ?? { sessions: 0, turns: 0, assistantChars: 0, toolCalls: 0, estTokens: 0 }
  total.sessions += 1
  total.turns += session.turns
  total.assistantChars += session.assistantChars
  total.toolCalls += session.toolCalls
  total.estTokens += session.estTokens
  agentTotals.set(agentId, total)
}

// [6c] 世界真实发起了多少次模型轮次（agent.initiative），用来交叉校验每角色每天
const initiatives = new Map()
for (const event of await worldEvents()) {
  if (event.type !== 'agent.initiative') continue
  const agentId = event.payload?.agentId
  if (typeof agentId === 'string') initiatives.set(agentId, (initiatives.get(agentId) ?? 0) + 1)
}

const perAgentDay = [...agentTotals.entries()]
  .sort(([left], [right]) => (left < right ? -1 : 1))
  .map(([agentId, total]) => {
    const count = initiatives.get(agentId) ?? null
    return {
      agentId,
      sessions: total.sessions,
      turns: total.turns,
      assistantChars: total.assistantChars,
      toolCalls: total.toolCalls,
      estTokens: total.estTokens,
      tokensPerDay: perDay(total.estTokens),
      initiatives: count,
      initiativesPerDay: count === null || daysRaw <= 0 ? null : round2(count / daysRaw),
    }
  })

const totalTokens = perSession.reduce((sum, session) => sum + session.estTokens, 0)

// [7] 输出
done(
  {
    ok: true,
    days,
    daysSource,
    sessionsSeen: files.length,
    perSession,
    perAgentDay,
    totalPerDay: perDay(totalTokens),
    method:
      'estTokens = ceil(assistantChars / 4)：assistantChars 是每条 assistant 消息的 text + reasoning + tool-call 参数字符数，' +
      '只覆盖模型输出侧、不含输入上下文（系统提示 / 工具结果），中文按 1 字 ≈ 1 token 的保守取整，' +
      '所以这是粗估上界，不是计费值。turns = assistant 消息条数（≈ 模型回复次数）。toolCalls = tool/call 事件数。' +
      'days = world.tick / 1440；tokensPerDay 只是 estTokens / days，不外推。',
  },
  0,
)
