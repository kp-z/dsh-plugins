#!/usr/bin/env node
/**
 * 每轮 / 每日 token 成本计量。**只读**：不写世界、不启进程、不改代码。
 *
 * 用法：
 *   node tools/measure-tokens.mjs                     # 只给 token 量，不给日成本（tokensPerDay = null）
 *   node tools/measure-tokens.mjs --days 41.37        # 显式给窗口天数才输出 tokensPerDay
 *   node tools/measure-tokens.mjs --testhome .testhome --profile xcity-3
 *
 * 数据源：
 *   .testhome/sessions/<slug>/<sessionId>/session.v4.jsonl.zstd  会话日志（/usr/bin/env zstd -dc 解出，逐行解析）
 *   .testhome/profiles/<profile>/state/events.jsonl              世界事件（initiative 次数）
 *
 * 口径（见输出里的 method 字段）：**优先 provider 回报的真实 usage**（assistant/message 的
 * data.usage；data.message.usage 也认，命中数记在 totals.usageVia）；只有没带 usage 的轮次
 * （如 interrupted）才退回 chars/4，turnsWithUsage / turnsEstimated 分别计数。
 * 主口径 billableTokens = inputTokens + outputTokens（新增计费量，不含 cacheRead）；
 * cacheReadTokens 单独一行报。日成本的分母只认 --days：不传就没有 tokensPerDay
 * （用世界总天数会把分母放大、把日成本讲便宜）。
 */

import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SESSION_FILE = 'session.v4.jsonl.zstd'
const CHARS_PER_TOKEN = 4

// [0] 参数：手写解析，不引依赖（与 tools/verify-tasks.mjs 同风格）
function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const testhomeArg = String(arg('testhome', '.testhome'))
const testhome = isAbsolute(testhomeArg) ? testhomeArg : join(pkgRoot, testhomeArg)
const profile = String(arg('profile', 'xcity-3'))
// [0a] --days：窗口天数，只有显式传了才输出 tokensPerDay（不猜、不用世界总天数）
const daysArg = Number(arg('days', Number.NaN))
const windowDays = Number.isFinite(daysArg) && daysArg > 0 ? daysArg : null
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
 * [2b] provider usage：assistant/message 的 data.usage（实测命中在这里；data.message.usage 也认，
 * 实测 0 命中，两个路径都算并计数）。provider 每条消息的 totalTokens 恒等于
 * input + cacheRead + output，本工具不再单独输出它，避免和主口径混淆。
 * 缺 usage 返回 null，由调用方退回 chars/4。
 */
function readUsage(data) {
  const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
  const asUsage = (raw, via) => ({
    via,
    inputTokens: count(raw.inputTokens),
    outputTokens: count(raw.outputTokens),
    cacheReadTokens: count(raw.cacheReadTokens),
  })
  if (data.usage !== null && typeof data.usage === 'object') return asUsage(data.usage, 'data')
  if (data.message?.usage !== null && typeof data.message.usage === 'object') {
    return asUsage(data.message.usage, 'message')
  }
  return null
}

/**
 * [2c] 单会话统计
 *   turns            assistant 消息条数（= 模型调用次数）
 *   turnsWithUsage   带 provider usage 的轮次（真值）
 *   turnsEstimated   无 usage、按 chars/4 兜底的轮次
 *   inputTokens / outputTokens / cacheReadTokens   provider 原值累加
 *   billableTokens   inputTokens + outputTokens + estimatedTokens（主口径：新增计费量，不含 cacheRead）
 *   inputChars       模型收到的**新投递**消息文本 = user/message + tool/result + system|developer/message
 *   outputChars      assistant 消息里 text + reasoning + tool-call 参数的字符数（只用于旧口径对比与兜底）
 *   turnTokens       每条 assistant/message 一个样本（= 该次调用的 input + output），交给 [6d]
 *
 * user/message 事件没有 turn 字段，按事件顺序归到最近一个 turn/start 的轮次；
 * agent/inbox/spliced 与 user/message 是同一份内容（97% 重合），只算 user/message，避免重复计数。
 */
function summarize(file, events) {
  const sessionId = basename(dirname(file))
  let turns = 0
  let turnsWithUsage = 0
  let turnsEstimated = 0
  let outputChars = 0
  let userChars = 0
  let toolChars = 0
  let systemChars = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let estimatedTokens = 0
  let usageViaData = 0
  let usageViaMessage = 0
  let currentTurn = 0
  const turnChars = new Map() // turn → 该轮新投递的输入字符数（兜底用）
  const turnTokens = [] // 每条 assistant/message 的 token 样本（input + output）
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
    if (event.type !== 'assistant/message') continue
    turns += 1
    let messageOutputChars = 0
    const content = data.message?.content
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === 'text' || part?.type === 'reasoning') {
          messageOutputChars += typeof part.text === 'string' ? part.text.length : 0
        } else if (part?.type === 'tool-call') {
          messageOutputChars += JSON.stringify(part.arguments ?? {}).length
        }
      }
    }
    outputChars += messageOutputChars
    const usage = readUsage(data)
    if (usage !== null) {
      turnsWithUsage += 1
      inputTokens += usage.inputTokens
      outputTokens += usage.outputTokens
      cacheReadTokens += usage.cacheReadTokens
      if (usage.via === 'data') usageViaData += 1
      else usageViaMessage += 1
      turnTokens.push(usage.inputTokens + usage.outputTokens)
      continue
    }
    turnsEstimated += 1
    // 兜底：该轮新投递的输入 + 本条消息的输出，chars/4（下界，见 method）
    const estimated = Math.ceil(((turnChars.get(eventTurn) ?? 0) + messageOutputChars) / CHARS_PER_TOKEN)
    estimatedTokens += estimated
    turnTokens.push(estimated)
  }
  const inputChars = userChars + toolChars + systemChars
  const summary = {
    sessionId,
    turns,
    turnsWithUsage,
    turnsEstimated,
    inputChars,
    outputChars,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    billableTokens: inputTokens + outputTokens + estimatedTokens,
    estimatedTokens,
    usageVia: { data: usageViaData, message: usageViaMessage },
  }
  return { summary, turnTokens }
}

// [3] 世界事件：8 MB 级追加日志，整个流程只读一次；initiative 次数从它取
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
const turnTokens = [] // 所有会话所有轮次的 token 样本，[6d] 求分位数
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
  const { summary, turnTokens: sessionTokens } = summarize(file, read.events)
  perSession.push(summary)
  turnTokens.push(...sessionTokens)
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

// [6a] 日成本：分母只认 --days（世界总天数会把分母放大、把日成本讲便宜）；不传就 null
const days = windowDays
const daysNote = days === null ? '未传 --days：没有窗口天数就不给日成本，tokensPerDay 与每角色 perDay 均为 null' : null
const perDay = (value) => (days === null ? null : Math.round(value / days))

// [6b] 按角色累加：主口径 billableTokens（cacheRead 不进主口径）
const agentTotals = new Map()
for (const session of perSession) {
  const agentId = agentOfSession(session.sessionId)
  const total = agentTotals.get(agentId) ?? {
    sessions: 0,
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    billableTokens: 0,
  }
  total.sessions += 1
  total.turns += session.turns
  total.inputTokens += session.inputTokens
  total.outputTokens += session.outputTokens
  total.cacheReadTokens += session.cacheReadTokens
  total.billableTokens += session.billableTokens
  agentTotals.set(agentId, total)
}

// [6c] 世界真实发起了多少次模型轮次（agent.initiative），用来交叉校验每角色每天
const initiatives = new Map()
for (const event of await worldEvents()) {
  if (event.type !== 'agent.initiative') continue
  const agentId = event.payload?.agentId
  if (typeof agentId === 'string') initiatives.set(agentId, (initiatives.get(agentId) ?? 0) + 1)
}

// [6d] 分位数：nearest-rank（p50 即中位数）
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
    return {
      agentId,
      sessions: total.sessions,
      turns: total.turns,
      inputTokens: total.inputTokens,
      outputTokens: total.outputTokens,
      cacheReadTokens: total.cacheReadTokens,
      billableTokens: total.billableTokens,
      tokensPerDay: perDay(total.billableTokens),
      initiatives: count,
      initiativesPerDay: count === null ? null : perDay(count),
    }
  })

// [6e] 每轮成本分位数：样本 = 每条 assistant/message 的 input + output（一次调用的新增计费量）
const turnSamples = turnTokens.sort((left, right) => left - right)
const tokensPerTurn = {
  samples: turnSamples.length,
  fromUsage: perSession.reduce((sum, session) => sum + session.turnsWithUsage, 0),
  p50: percentile(turnSamples, 50),
  p95: percentile(turnSamples, 95),
  max: turnSamples.length === 0 ? null : turnSamples[turnSamples.length - 1],
}

const sumOf = (list, key) => list.reduce((sum, item) => sum + item[key], 0)
const totals = perSession.reduce(
  (sum, session) => ({
    turns: sum.turns + session.turns,
    turnsWithUsage: sum.turnsWithUsage + session.turnsWithUsage,
    turnsEstimated: sum.turnsEstimated + session.turnsEstimated,
    inputTokens: sum.inputTokens + session.inputTokens,
    outputTokens: sum.outputTokens + session.outputTokens,
    cacheReadTokens: sum.cacheReadTokens + session.cacheReadTokens,
    billableTokens: sum.billableTokens + session.billableTokens,
    estimatedTokens: sum.estimatedTokens + session.estimatedTokens,
    usageVia: {
      data: sum.usageVia.data + session.usageVia.data,
      message: sum.usageVia.message + session.usageVia.message,
    },
  }),
  {
    turns: 0,
    turnsWithUsage: 0,
    turnsEstimated: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    billableTokens: 0,
    estimatedTokens: 0,
    usageVia: { data: 0, message: 0 },
  },
)

// [6f] cacheShare：命中上下文缓存的部分占提示词总量的比例（provider 的 inputTokens 不含 cacheRead）
const promptTokens = totals.inputTokens + totals.cacheReadTokens
const cacheShare = promptTokens > 0 ? round2(totals.cacheReadTokens / promptTokens) : null

// [6g] 旧口径（chars/4）与新口径在同一批会话上的偏差：只用带 usage 的会话，负数 = 旧口径低估
const usageSessions = perSession.filter((session) => session.turnsWithUsage > 0)
const deviation = (estimate, actual) => (actual > 0 ? round2(((estimate - actual) / actual) * 100) : null)
const billableTokens = usageSessions.reduce((sum, session) => sum + session.billableTokens, 0)
const estimateInputTokens = toTokens(sumOf(usageSessions, 'inputChars'))
const estimateOutputTokens = toTokens(sumOf(usageSessions, 'outputChars'))
const estimateTokens = estimateInputTokens + estimateOutputTokens
const estimateVsUsage = {
  sessions: usageSessions.length,
  estimateTokens,
  billableTokens,
  deviationPct: deviation(estimateTokens, billableTokens),
  inputDeviationPct: deviation(estimateInputTokens, sumOf(usageSessions, 'inputTokens')),
  outputDeviationPct: deviation(estimateOutputTokens, sumOf(usageSessions, 'outputTokens')),
}

// [6h] 每会话输出：source 说明该会话走哪条路径（有 usage = usage，全没有 = estimate）
const perSessionOut = perSession.map((session) => ({
  sessionId: session.sessionId,
  source: session.turnsWithUsage > 0 ? 'usage' : 'estimate',
  turns: session.turns,
  turnsWithUsage: session.turnsWithUsage,
  turnsEstimated: session.turnsEstimated,
  inputTokens: session.inputTokens,
  outputTokens: session.outputTokens,
  cacheReadTokens: session.cacheReadTokens,
  billableTokens: session.billableTokens,
  estimatedTokens: session.estimatedTokens,
}))

// [7] 输出
done(
  {
    ok: true,
    days,
    daysNote,
    sessionsSeen: files.length,
    perSession: perSessionOut,
    perAgentDay,
    totals,
    tokensPerDay: perDay(totals.billableTokens),
    tokensPerTurn,
    cacheShare,
    estimateVsUsage,
    method:
      'token 数**优先取 provider 回报的 usage**（assistant/message 的 data.usage；data.message.usage 也认，' +
      '命中数见 totals.usageVia，实测全部命中 data.usage，message 路径 0 命中，留着兼容）。' +
      '只有没带 usage 的轮次（如 interrupted）才退回 chars/4 兜底，其量单独记在 estimatedTokens，' +
      'turnsWithUsage / turnsEstimated 分别计数，perSession[].source 标该会话走 usage 还是 estimate。' +
      '主口径 billableTokens = inputTokens + outputTokens（新增计费量）；cacheReadTokens 单独一行，不进 tokensPerDay。' +
      'inputTokens = 未命中缓存的提示词 token，cacheReadTokens = 已在上下文缓存命中、被复用的提示词 token，' +
      'cacheShare = cacheReadTokens / (inputTokens + cacheReadTokens)（provider 的 inputTokens 不含缓存命中，' +
      '直接用 cacheRead/inputTokens 会远大于 1）。' +
      'provider 每条消息自报的 totalTokens 恒等于 inputTokens + cacheReadTokens + outputTokens，本工具不输出它，' +
      '免得和主口径混成一行。' +
      'turns = assistant 消息条数（= 模型调用次数）；tokensPerTurn 的样本就是每条 assistant/message 的 input + output，' +
      'nearest-rank 分位数。' +
      'tokensPerDay 只在显式给 --days N（游戏天）时才有值：分母是会话覆盖窗口，不是世界总天数' +
      '（后者会把分母放大到约 2 倍、看起来便宜一半）；不传就是 null，不给日成本。' +
      'estimateVsUsage 用同一批带 usage 的会话对比旧 chars/4 口径：estimateTokens = ceil(inputChars/4) + ceil(outputChars/4)，' +
      'inputChars 只算新投递的 user/message + tool/result + system|developer/message 文本' +
      '（不含每次调用重发的历史上下文与工具 schema），负数是旧口径低估。',
  },
  0,
)
