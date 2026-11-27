#!/usr/bin/env node
// verify-cost.mjs —— 成本口径的**独立复核**实现（R525）
//
// 存在理由：measure-tokens.mjs 自己说自己对，不算证据。这里用另一份实现算同一件事，
// 两边的数必须对得上；对不上就说明口径里有歧义，得先把歧义写清楚。
//
// 流程：
//   R525-1  定位会话文件 .testhome/sessions/**/session.v4.jsonl.zstd
//   R525-2  逐行解压解析，只认 type === 'assistant/message'
//   R525-3  取该事件的 usage（data.message.usage 为主，data.usage 为日志 v4 实际落点），累加
//   R525-4  按会话名归到角色（xcity-agent1-xxxx -> xcity-agent1）
//   R525-5  算每轮 token 的 p50/p95/max；可选按世界天数折算 tokensPerDay
//   R525-6  判 ok：无 usage 的轮次占比 < 1% 且 turns > 0
//
// 口径边界（明确不做）：
//   - 不估算字符、不信 chars/4，只信模型写进日志的 usage；
//   - 不算每步重发的历史上下文这类计费口径，只有模型自报的数；
//   - 不外推：tokensPerDay 只是 totalTokens / days。
//
// 用法：
//   node tools/verify-cost.mjs
//   node tools/verify-cost.mjs --days 41.37
//   node tools/verify-cost.mjs --root .testhome/sessions --days 41.37
//   --per-day 是 --days 的别名（同一个数：这次运行覆盖几个世界天），不新增第二个概念。

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const SESSION_FILE = 'session.v4.jsonl.zstd'

// R525-1 命令行
function parseArgs(argv) {
  const opts = { root: '.testhome/sessions', days: null }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    const val = argv[i + 1]
    if (key === '--root') {
      opts.root = val
      i++
    } else if (key === '--days' || key === '--per-day') {
      const n = Number(val)
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error('bad-days: ' + key + ' 需要一个 > 0 的数（世界天数），收到 ' + JSON.stringify(val))
      }
      opts.days = n
      i++
    } else if (key === '--help' || key === '-h') {
      console.log('node tools/verify-cost.mjs [--root <sessionsDir>] [--days <worldDays> | --per-day <worldDays>]')
      process.exit(0)
    } else {
      throw new Error('bad-arg: 不认识 ' + key + '；--help 看用法')
    }
  }
  return opts
}

// R525-1 找会话：一层 profile 目录 + 一层会话目录，只要真的存在那个 zstd 且非空
async function findSessionFiles(root) {
  const hits = []
  let profiles = []
  try {
    profiles = await readdir(root, { withFileTypes: true })
  } catch {
    return hits
  }
  for (const profile of profiles) {
    if (!profile.isDirectory()) continue
    const profileDir = path.join(root, profile.name)
    const sessions = await readdir(profileDir, { withFileTypes: true })
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const file = path.join(profileDir, session.name, SESSION_FILE)
      if (!existsSync(file)) continue
      const info = await stat(file)
      if (info.size === 0) continue
      hits.push({ sessionName: session.name, file })
    }
  }
  return hits.sort((a, b) => a.sessionName.localeCompare(b.sessionName))
}

// R525-2 逐行读解压流；坏行计数，不静默吞掉
async function readSession(file, onEvent) {
  const proc = spawn('zstd', ['-dc', file], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  let badLines = 0
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk) => { stderr += chunk })

  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity })
  for await (const line of rl) {
    const text = line.trim()
    if (!text) continue
    let event
    try {
      event = JSON.parse(text)
    } catch {
      badLines++
      continue
    }
    onEvent(event)
  }

  const code = await new Promise((resolve) => proc.on('close', resolve))
  if (code !== 0) {
    throw new Error('zstd-failed: ' + file + ' (exit ' + code + ') ' + stderr.trim().slice(0, 200))
  }
  return { badLines }
}

// R525-3 两个落点：任务卡写 data.message.usage，日志 v4 实际写 data.usage。
// 两个都认，并数出命中来源——和 measure-tokens 对不上时，第一嫌疑就是路径差异。
function pickUsage(event) {
  const viaMessage = event && event.data && event.data.message && event.data.message.usage
  if (viaMessage && typeof viaMessage === 'object') return { usage: viaMessage, via: 'message' }
  const viaData = event && event.data && event.data.usage
  if (viaData && typeof viaData === 'object') return { usage: viaData, via: 'data' }
  return null
}

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

// R525-4 会话名 xcity-agent1-mwzepq16 -> 角色 xcity-agent1
const agentOf = (sessionName) => sessionName.split('-').slice(0, 2).join('-')

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const root = path.resolve(process.cwd(), opts.root)

  const files = await findSessionFiles(root)
  if (files.length === 0) {
    return { ok: false, reason: 'no-sessions', root, sessions: 0 }
  }

  const totals = { input: 0, output: 0, cacheRead: 0, turns: 0, withUsage: 0, withoutUsage: 0 }
  const byAgent = new Map()
  const turnTokens = []
  const turnTokensWithCache = []
  const usageVia = { message: 0, data: 0 }
  const sessions = []

  for (const { sessionName, file } of files) {
    const agentId = agentOf(sessionName)
    if (!byAgent.has(agentId)) {
      byAgent.set(agentId, { agentId: agentId, input: 0, output: 0, cacheRead: 0, turns: 0 })
    }
    const agent = byAgent.get(agentId)
    const local = { sessionName: sessionName, turns: 0, withUsage: 0, input: 0, output: 0 }

    // R525-2 只认 assistant/message
    const { badLines } = await readSession(file, (event) => {
      if (!event || event.type !== 'assistant/message') return
      totals.turns++
      local.turns++
      agent.turns++

      const picked = pickUsage(event)
      if (!picked) {
        totals.withoutUsage++
        return
      }
      usageVia[picked.via]++
      totals.withUsage++
      local.withUsage++

      const input = num(picked.usage.inputTokens)
      const output = num(picked.usage.outputTokens)
      const cacheRead = num(picked.usage.cacheReadTokens)
      totals.input += input
      totals.output += output
      totals.cacheRead += cacheRead
      local.input += input
      local.output += output
      agent.input += input
      agent.output += output
      agent.cacheRead += cacheRead

      // R525-5 每轮两个口径都出：cacheRead 是真实的 prompt 复读量，但不是新增计费量。
      // 只报一个数会让人和别的工具对不上，所以两个都给，别让人猜。
      turnTokens.push(input + output)
      turnTokensWithCache.push(input + cacheRead + output)
    })

    sessions.push({ ...local, badLines: badLines })
  }

  if (totals.turns === 0) {
    return { ok: false, reason: 'usage-missing', root, sessions: files.length, totals }
  }

  // R525-6 判据
  const missingRatio = totals.withoutUsage / totals.turns
  const ok = missingRatio < 0.01 && totals.turns > 0

  turnTokens.sort((a, b) => a - b)
  turnTokensWithCache.sort((a, b) => a - b)
  const totalTokens = totals.input + totals.output
  const perAgent = [...byAgent.values()].sort((a, b) => (b.input + b.output) - (a.input + a.output))

  return {
    ok: ok,
    reason: ok ? null : 'usage-missing',
    root: root,
    sessions: files.length,
    totals: totals,
    perAgent: perAgent,
    tokensPerTurn: {
      p50: percentile(turnTokens, 50),
      p95: percentile(turnTokens, 95),
      max: turnTokens.length ? turnTokens[turnTokens.length - 1] : null
    },
    // 同一条数据把 cacheRead 也算进 prompt 的口径（对齐 measure-tokens 的 turnBudget）
    tokensPerTurnWithCache: {
      p50: percentile(turnTokensWithCache, 50),
      p95: percentile(turnTokensWithCache, 95),
      max: turnTokensWithCache.length ? turnTokensWithCache[turnTokensWithCache.length - 1] : null
    },
    tokensPerDay: opts.days ? Math.round(totalTokens / opts.days) : null,
    days: opts.days,
    usageVia: usageVia,
    missingRatio: Number(missingRatio.toFixed(4)),
    sessionsWithZeroTurns: sessions.filter((s) => s.turns === 0).length
  }
}

try {
  const result = await main()
  console.log(JSON.stringify(result, null, 1))
  process.exit(result.ok ? 0 : 1)
} catch (error) {
  console.log(JSON.stringify({ ok: false, reason: String(error && error.message ? error.message : error) }, null, 1))
  process.exit(1)
}
