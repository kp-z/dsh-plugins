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
 * 口径（见输出里的 method 字段）：字符数 / 4 换算 token，**输入侧** = user/message 文本
 * （含 runtime-context / time-context / skill-catalog 这类以 user 角色注入的上下文）
 * + tool/result 的工具结果文本 + system/message 与 developer/message 文本；
 * **输出侧** = assistant 消息的 text + reasoning + tool-call 参数。两侧都是字符粗估，不是计费值。
 * 每轮 inputChars 是**该轮新投递**的输入，不含每步重发的历史上下文与工具 schema（request/header），
 * 所以 turnBudget 是每轮输入的下界。
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

// [2a] 消息 content 里纯文本 part 的字符数；图片等非文本块不计（本来也不是 token 大头）
function textChars(content) {
  if (!Array.isArray(content)) return 0
  let chars = 0
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string') chars += part.text.length
  }
  return chars
}

/**
 * [2b] 单会话统计
 *   turns         assistant 消息条数（≈ 模型回复次数，「每轮成本」的分子）
 *   outputChars   assistant 消息里 text + reasoning + tool-call 参数的字符数
 *   inputChars    模型收到的消息文本 = user/message + tool/result + system|developer/message
 *   turnInputs    每轮**新投递**的输入字符数，交给 [6d] 求分位数
 *
 * user/message 事件没有 turn 字段，按事件顺序归到最近一个 turn/start 的轮次；
 * agent/inbox/spliced 与 user/message 是同一份内容（97% 重合），只算 user/message，避免重复计数。
 */
function summarize(file, events) {
  const sessionId = basename(dirname(file))
  let turns = 0
  let outputChars = 0
  let userChars = 0
  let toolChars = 0
  let systemChars = 0
  let toolCalls = 0
  let currentTurn = 0
  const turnChars = new Map() // turn → 该轮新投递的输入字符数
  const addInput = (turn, chars) => {
    if (chars <= 0) return
    turnChars.set(turn, (turnChars.get(turn) ?? 0) + chars)
  }
  for (const event of events) {
    const data = event.data ?? {}
    const turn = Number(data.turn)
    const eventTurn = Number.isFinite(turn) ? turn : currentTurn
    if (event.type === 'turn/start') {
      if (Number.isFinite(turn)) currentTurn = turn
      if (!turnChars.has(eventTurn)) turnChars.set(eventTurn, 0)
      continue
    }
    if (event.type === 'user/message') {
      const chars = textChars(data.content)
      userChars += chars
      addInput(eventTurn, chars)
      continue
    }
    if (event.type === 'tool/result') {
      const chars = textChars(data.message?.content)
      toolChars += chars
      addInput(eventTurn, chars)
      continue
    }
    if (event.type === 'system/message' || event.type === 'developer/message') {
      const chars = textChars(data.message?.content)
      systemChars += chars
      addInput(eventTurn, chars)
      continue
    }
    if (event.type === 'tool/call') {
      toolCalls += 1
      continue
    }
    if (event.type !== 'assistant/message') continue
    turns += 1
    const content = data.message?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (part?.type === 'text' || part?.type === 'reasoning') {
        outputChars += typeof part.text === 'string' ? part.text.length : 0
      } else if (part?.type === 'tool-call') {
        outputChars += JSON.stringify(part.arguments ?? {}).length
      }
    }
  }
  const inputChars = userChars + toolChars + systemChars
  const summary = {
    sessionId,
    turns,
    inputChars,
    outputChars,
    toolCalls,
    avgInputCharsPerTurn: turns > 0 ? Math.round(inputChars / turns) : null,
    inputShare: inputChars + outputChars > 0 ? round2(inputChars / (inputChars + outputChars)) : null,
  }
  return { summary, turnInputs: [...turnChars.values()] }
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
const turnInputs = [] // 所有会话所有轮的新增输入字符样本，[6d] 求分位数
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
  const { summary, turnInputs: sessionTurns } = summarize(file, read.events)
  perSession.push(summary)
  turnInputs.push(...sessionTurns)
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

// [6b] 按角色累加（输入侧与输出侧一起累，token 在 [6d] 统一按 chars/4 换算）
const agentTotals = new Map()
for (const session of perSession) {
  const agentId = agentOfSession(session.sessionId)
  const total = agentTotals.get(agentId) ?? { sessions: 0, turns: 0, inputChars: 0, outputChars: 0, toolCalls: 0 }
  total.sessions += 1
  total.turns += session.turns
  total.inputChars += session.inputChars
  total.outputChars += session.outputChars
  total.toolCalls += session.toolCalls
  agentTotals.set(agentId, total)
}

// [6c] 世界真实发起了多少次模型轮次（agent.initiative），用来交叉校验每角色每天
const initiatives = new Map()
for (const event of await worldEvents()) {
  if (event.type !== 'agent.initiative') continue
  const agentId = event.payload?.agentId
  if (typeof agentId === 'string') initiatives.set(agentId, (initiatives.get(agentId) ?? 0) + 1)
}

// [6d] 换算与分位数：tokens = chars / 4；分位数用 nearest-rank（p50 即中位数）
const toTokens = (chars) => Math.ceil(chars / CHARS_PER_TOKEN)
function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

const perAgentDay = [...agentTotals.entries()]
  .sort(([left], [right]) => (left < right ? -1 : 1))
  .map(([agentId, total]) => {
    const count = initiatives.get(agentId) ?? null
    const inputTokens = toTokens(total.inputChars)
    const outputTokens = toTokens(total.outputChars)
    const totalTokens = inputTokens + outputTokens
    return {
      agentId,
      sessions: total.sessions,
      turns: total.turns,
      inputChars: total.inputChars,
      outputChars: total.outputChars,
      toolCalls: total.toolCalls,
      inputTokens,
      outputTokens,
      totalTokens,
      tokensPerDay: perDay(totalTokens),
      initiatives: count,
      initiativesPerDay: count === null || daysRaw <= 0 ? null : round2(count / daysRaw),
    }
  })

// 全量每轮输入分位数：只统计真实发生过输入的轮次，避免空轮把 p50 拉低
const turnSamples = turnInputs.filter((chars) => chars > 0).sort((left, right) => left - right)
const turnBudget = {
  samples: turnSamples.length,
  p50: percentile(turnSamples, 50),
  p95: percentile(turnSamples, 95),
  max: turnSamples.length === 0 ? null : turnSamples[turnSamples.length - 1],
}

const totals = perSession.reduce(
  (sum, session) => ({ inputChars: sum.inputChars + session.inputChars, outputChars: sum.outputChars + session.outputChars }),
  { inputChars: 0, outputChars: 0 },
)
const inputTokens = toTokens(totals.inputChars)
const outputTokens = toTokens(totals.outputChars)
const totalTokens = inputTokens + outputTokens
const charTotal = totals.inputChars + totals.outputChars

// [7] 输出
done(
  {
    ok: true,
    days,
    daysSource,
    sessionsSeen: files.length,
    perSession,
    perAgentDay,
    totals: {
      inputChars: totals.inputChars,
      outputChars: totals.outputChars,
      inputTokens,
      outputTokens,
      totalTokens,
      inputShare: charTotal > 0 ? round2(totals.inputChars / charTotal) : null,
    },
    tokensPerDay: perDay(totalTokens),
    turnBudget,
    method:
      'tokens = ceil(chars / 4)，中文 1 字按 1 token 更保守，所以这是粗估上界、不是计费值。' +
      '输出侧 outputChars = assistant 消息的 text + reasoning + tool-call 参数字符数。' +
      '输入侧 inputChars = user/message 文本（含 runtime-context / time-context / skill-catalog 这类以 user 角色注入的上下文）' +
      ' + tool/result 的工具结果文本 + system/message 与 developer/message 文本；' +
      'agent/inbox/spliced 与 user/message 是同一份内容（只算一次）；request/header 里的工具 schema 与每步重发的历史上下文不计入。' +
      'inputShare = inputChars / (inputChars + outputChars)。turns = assistant 消息条数（≈ 模型回复次数）。' +
      'turnBudget 按轮统计**该轮新投递**的输入字符数（不含重发的历史上下文与工具 schema），nearest-rank 分位数，所以是每轮输入的下界。' +
      'days = world.tick / 1440；tokensPerDay 只是 totalTokens / days，不外推。',
  },
  0,
)
