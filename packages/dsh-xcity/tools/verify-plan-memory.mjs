#!/usr/bin/env node
/**
 * 验收：每日计划里真的带记忆（「你还记得」段），而且**每个角色记得的不一样**。**只读**：
 * 只读会话日志，不写世界、不改代码、不启进程；不 import 内核 lib/（能脱离构建直接跑）。
 *
 * 用法：
 *   node tools/verify-plan-memory.mjs
 *   node tools/verify-plan-memory.mjs --home .testhome --agents 3
 *
 * 数据源只有一个：<home>/sessions/<workspace-slug>/<sessionId>/session.v4.jsonl.zstd
 * （用 zstd -dc 解出，逐行解析 v4 JSONL）。计划是当**用户消息**投给角色会话的，
 * 所以只认事件 user/message（assistant 的复述不算证据——那可能只是模型编的）。
 *
 * 判据（任务口径，不自己发明）：
 *   1. 每个角色取**最新**的那个会话（同一角色会 spawn 很多会话，旧的不算）；
 *   2. 在该会话里取**最近一条**含「你还记得」的 user/message，抽这一段的记忆行；
 *   3. 三个角色都 found，且各自 items 条数在 1..5；
 *   4. 交叉断言：三个角色的 items 不完全相同——同一份世界，但记忆是各人自己的。
 *
 * 失败 reason（先报发现层，再报断言层）：
 *   no-sessions  找不到角色会话（目录不在 / 角色会话少于 --agents 个）
 *   log-missing  会话日志解不开（zstd 缺失、文件截断、没有可解析的 user/message）
 *   no-section   日志读到了，但没有「你还记得」段（功能还没落地，或计划没投递过）
 *   item-count   段有了，条数不在 1..5（空段 / 塞太多）
 *   same-memory  三个角色的记忆完全一样（说明记忆没按角色分）
 */

import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { arg, emit } from './lib/cli.mjs'

const execFileAsync = promisify(execFile)
const SESSION_FILE = 'session.v4.jsonl.zstd'
/** 段的标识：计划 prompt 里的那一段标题。 */
const SECTION_MARK = '你还记得'
/** 段在下一个二级标题处结束（计划 prompt 的其它段都以两个 # 开头）。 */
const HEADING = '## '
/** 一段记忆该有几条：空段等于没记忆，塞太多模型读不完（同时是验收口径）。 */
const MIN_ITEMS = 1
const MAX_ITEMS = 5
/**
 * 记忆行的分类标记——照抄内核写记忆时的文案（src/sim/memory.ts 的 summarizeActivity /
 * recordTaskEpisode、src/sim/commitments.ts 的裁决前缀），不自己另立口径：
 *   工单「X」做完了 / 守约：… / 没做完：…
 * 分类互斥（「没做完：工单「X」…」只算没做完），其他 装日常活动那种既非工单也非承诺的行，
 * 于是 kinds 各项之和恒等于 items 条数，能直接对账。
 */
const KINDS = ['工单', '守约', '没做完', '其他']

// [0] 参数与输出契约在 tools/lib/cli.mjs（各脚本共用一份，纯 .mjs 不经构建）
const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const homeArg = String(arg('home', '.testhome'))
const home = isAbsolute(homeArg) ? homeArg : join(pkgRoot, homeArg)
const wanted = Math.max(1, Number(arg('agents', 3)) || 3)
const sessionsDir = join(home, 'sessions')

// [1] 收集会话日志：sessions/<slug>/<sessionId>/session.v4.jsonl.zstd（深度与 measure-tokens 同口径）
async function findSessions(dir, depth = 0) {
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
    if (entry.isDirectory()) {
      found.push(...(await findSessions(full, depth + 1)))
      continue
    }
    if (entry.name !== SESSION_FILE) continue
    const info = await stat(full).catch(() => null)
    if (info === null) continue
    // 「最新」按文件 mtime：会话每写一个事件都会改它，比目录名里的 base36 时间更贴近事实。
    found.push({ file: full, sessionId: basename(dirname(full)), mtimeMs: info.mtimeMs })
  }
  return found
}

// [2] sessionId → 角色：xcity- + 角色 id 去掉非字母数字 + - + base36 时间戳
//     （src/adapters/slowvale/spawn.ts 的 xcitySessionId）。不是角色会话就返回 null。
function agentTokenOf(sessionId) {
  const match = /^xcity-(.+)-[0-9a-z]+$/.exec(sessionId)
  return match === null ? null : match[1]
}

/** 角色 id 的展示名：spawn 会把 agent-1 洗成 agent1，这里按世界里的命名还原；别的角色名原样用。 */
function displayIdOf(token) {
  const match = /^agent(\d+)$/.exec(token)
  return match === null ? token : 'agent-' + match[1]
}

// [3] 解压 + 逐行解析；只留 user/message 的文本
function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
}

async function readUserTexts(file) {
  try {
    const { stdout } = await execFileAsync('/usr/bin/env', ['zstd', '-dc', file], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const texts = []
    for (const line of stdout.split('\n')) {
      if (line === '') continue
      let event
      try {
        event = JSON.parse(line)
      } catch {
        continue // 日志被截断时的坏行
      }
      if (event?.type !== 'user/message') continue
      const text = textOf(event.data?.content)
      if (text !== '') texts.push(text)
    }
    return { texts }
  } catch (error) {
    // zstd 不在 PATH 时 /usr/bin/env 退出码 127；其余是文件坏了。
    const missing = error.code === 127 || error.code === 'ENOENT' || /zstd/.test(String(error.stderr ?? ''))
    return { error: missing ? 'zstd 未安装（brew install zstd）' : String(error.message ?? '').slice(0, 160) }
  }
}

// [4] 从一段 user/message 里抽「你还记得」段：标题行之后、下一个二级标题之前。
//     段体是一行一条记忆（plan-prompt.ts 写的是 "- 第N天：做了什么"），所以条目数就是行数。
function sectionItems(text) {
  const lines = text.split('\n')
  const start = lines.findLastIndex((line) => line.includes(SECTION_MARK))
  if (start === -1) return null
  const items = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.startsWith(HEADING)) break
    const trimmed = line.trim()
    if (trimmed === '') continue
    items.push(trimmed.startsWith('- ') ? trimmed.slice(2).trim() : trimmed)
  }
  return items
}

function kindsOf(items) {
  const kinds = Object.fromEntries(KINDS.map((kind) => [kind, 0]))
  // 一行记忆带「第N天 HH:mm 」前缀（memory-context 的 episodeLine），所以按 includes 认标记；
  // 判定顺序是互斥的关键：失败工单写成「没做完：工单「X」没成」，先认没做完，就不会又算一条工单。
  for (const item of items) {
    if (item.includes('没做完：')) kinds.没做完 += 1
    else if (item.includes('守约：')) kinds.守约 += 1
    else if (item.includes('工单「')) kinds.工单 += 1
    else kinds.其他 += 1
  }
  return kinds
}

const files = await findSessions(sessionsDir)

// [5] 每个角色只留最新那个会话；要 --agents 个最近活跃的角色
const newestByAgent = new Map()
for (const entry of files) {
  const token = agentTokenOf(entry.sessionId)
  if (token === null) continue
  const seen = newestByAgent.get(token)
  if (seen === undefined || entry.mtimeMs > seen.mtimeMs) newestByAgent.set(token, entry)
}
const picked = [...newestByAgent.entries()]
  .sort((left, right) => right[1].mtimeMs - left[1].mtimeMs)
  .slice(0, wanted)
  .sort((left, right) => displayIdOf(left[0]).localeCompare(displayIdOf(right[0])))

// [6] 逐角色抽段
const failures = []
const agents = []
for (const [token, entry] of picked) {
  const agentId = displayIdOf(token)
  const read = await readUserTexts(entry.file)
  if (read.error !== undefined) {
    agents.push({ agentId, sessionId: entry.sessionId, found: false, items: [], kinds: kindsOf([]) })
    failures.push({ agentId, code: 'log-missing', detail: read.error })
    continue
  }
  // 取最近一条：从后往前找，越靠后越新。
  const hit = [...read.texts].reverse().find((text) => text.includes(SECTION_MARK))
  const items = hit === undefined ? null : sectionItems(hit)
  const found = items !== null
  agents.push({
    agentId,
    sessionId: entry.sessionId,
    found,
    items: items ?? [],
    kinds: kindsOf(items ?? []),
  })
  if (!found) {
    failures.push({
      agentId,
      code: 'no-section',
      detail:
        read.texts.length === 0
          ? '会话里没有 user/message'
          : read.texts.length + ' 条 user/message 里没有「' + SECTION_MARK + '」段',
    })
    continue
  }
  if (items.length < MIN_ITEMS || items.length > MAX_ITEMS) {
    failures.push({ agentId, code: 'item-count', detail: items.length + ' 条（要求 ' + MIN_ITEMS + '..' + MAX_ITEMS + '）' })
  }
}

// [7] 交叉断言：同一份世界，但记忆各是各的——三份 items 完全一样就是没分人。
//     只有一个角色时没得比（--agents 1 是给单角色调试用的），不算失败。
const distinct = new Set(agents.map((agent) => JSON.stringify(agent.items))).size
const allFound = agents.length > 0 && agents.every((agent) => agent.found)
const crossOk = allFound && (agents.length < 2 || distinct > 1)

// [8] 判定：发现层先报（够不够会话、日志能不能读），再报段与条数，最后报交叉。
let reason = null
// --agents 至少是 1，所以「角色会话不够」这一个条件也覆盖了「一份日志都没有」。
if (picked.length < wanted) reason = 'no-sessions'
else if (failures.some((failure) => failure.code === 'log-missing')) reason = 'log-missing'
else if (failures.some((failure) => failure.code === 'no-section')) reason = 'no-section'
else if (failures.some((failure) => failure.code === 'item-count')) reason = 'item-count'
else if (!crossOk) reason = 'same-memory'
const ok = reason === null && failures.length === 0

// 会话不够时也要说清卡在哪：把「要 N 个只有 M 个」写进 failures。
if (reason === 'no-sessions') {
  failures.unshift({
    agentId: '',
    code: 'no-sessions',
    detail: '要 ' + wanted + ' 个角色的会话，sessions/ 下只有 ' + picked.length + ' 个（共 ' + files.length + ' 份会话日志）',
  })
}
if (reason === 'same-memory' && failures.length === 0) {
  failures.unshift({ agentId: '', code: 'same-memory', detail: picked.length + ' 个角色的记忆完全一样' })
}

const note = (() => {
  if (reason === 'no-sessions') return '会话不够：要 ' + wanted + ' 个角色的最新会话，只有 ' + picked.length + ' 个（' + sessionsDir + '）'
  if (reason === 'log-missing')
    return (
      '会话日志解不开：' +
      failures
        .filter((failure) => failure.code === 'log-missing')
        .map((failure) => failure.agentId + ' → ' + failure.detail)
        .join('；')
    )
  if (reason === 'no-section')
    return '日志读到了，但计划里还没有「' + SECTION_MARK + '」段：这些角色都没找到（共 ' + files.length + ' 份会话日志）'
  if (reason === 'item-count')
    return (
      '段有了，条数不对：' +
      failures
        .filter((failure) => failure.code === 'item-count')
        .map((failure) => failure.agentId + ' ' + failure.detail)
        .join('，')
    )
  if (reason === 'same-memory') return picked.length + ' 个角色的记忆完全一样，记忆没按角色分'
  if (agents.length < 2) return '只核了 1 个角色（交叉断言无从比），条数 ' + agents.map((agent) => agent.agentId + ':' + agent.items.length).join('/')
  return (
    picked.length + ' 个角色的记忆各不相同（' + distinct + ' 份不同），条数 ' + agents.map((agent) => agent.agentId + ':' + agent.items.length).join('/')
  )
})()

const summary = {
  ok,
  ...(reason === null ? {} : { reason }),
  home,
  sessions: files.length,
  agents,
  cross: { ok: crossOk, distinct },
  ...(ok ? {} : { failures }),
  note,
}
emit(summary, ok ? 0 : 1, 1)
