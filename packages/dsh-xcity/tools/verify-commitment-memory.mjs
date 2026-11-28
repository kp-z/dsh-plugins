#!/usr/bin/env node
/**
 * 验收：承诺的裁决有没有真的写进情节记忆（R521）。**只读**——只 GET 快照；不写世界、不改代码、不启进程。
 *
 * 用法：
 *   node tools/verify-commitment-memory.mjs --base http://127.0.0.1:3190
 *
 * 判据照抄 R521 的契约（commitments.ts 的 settleCommitments 写 appendEpisode），不自己发明：
 *   kept   → 双方**各**一条 episode，summary 以 `守约：` 开头，且含事项（what）；
 *   missed → 双方**各**一条，summary 以 `没做完：` 开头，且含事项。
 * 一条约定在双方各存一行、共用 id（commitments.ts 纪律 1），所以核对单位是 id，
 * 核对面却是**双方各自的 episodes**：记忆是每个人各自读的，只写一边也是漏。
 *
 * 事项按"关键词"比对（前 KEYWORD_CHARS 个字）而不是全文：契约只要求 summary 含事项，
 * 没规定原样全写（可能加书名号、可能截断），关键词认得出，又不因排版差异误报。
 *
 * 留存窗口决定"找不到"敢不敢当失败（与 tools/verify-commitments.mjs 同一条理由）：
 *   · 找到 = 真的写过，直接算命中，不受留存影响；
 *   · 找不到且承诺还在 SETTLED_KEEP_DAYS 窗口内（dueTick >= tick - 7 天）→ missing，必须红；
 *   · 找不到且早已滑出留存窗口 → stale，证据过期不算失败（episodes 与已裁决承诺共用 7 天
 *     窗口，正常跑起来几乎不会出现；留着是为了长跑/删档宿主不假红）。
 *
 * 判定：ok = missing 为空。missing 按"方"记（一条承诺可能只漏一边），命中率按 id 算。
 * unreachable / no-commitments 给明确 reason，退出码 1。
 */

import { arg, baseUrl, failVerify, getJson } from './lib/cli.mjs'

// [0] 参数：解析与 base 归一化在 tools/lib/cli.mjs（各脚本共用一份，纯 .mjs 不经构建）
const base = baseUrl()
/**
 * 只核对"修复之后才裁决"的承诺。
 *
 * 为什么需要：R521 之前裁决的承诺**不可能**有情节记忆，把它们算成 missing 只会掩盖真问题。
 * 传 --since <tick>（一般填部署那次重启的 tick）即可把历史行排除；不传就是全量核对。
 */
const sinceRaw = arg('since', '')
const since = typeof sinceRaw === 'string' && sinceRaw !== '' ? Number(sinceRaw) : null
const REQUEST_MS = 8000

// 内核常量的镜像（src/sim/memory.ts 的 DAY_TICKS、src/sim/commitments.ts 的 SETTLED_KEEP_DAYS）：
// 核对脚本不许自创口径，改那边就得改这里。
const DAY_TICKS = 1440
const SETTLED_KEEP_DAYS = 7
/** 事项关键词取几个字：够区分一天里的几件事，又不依赖实现是否原样写全文。 */
const KEYWORD_CHARS = 8
/** 裁决 → 情节前缀，与 R521 契约、memoryMood 的正负向约定一致。 */
const PREFIX = { kept: '守约：', missed: '没做完：' }

// [1] 快照：世界只有 base 这一个出口；失败也要给明确 reason
let world = null
let fetchError = null
try {
  world = (await getJson(base + '/agent-world/api/world', REQUEST_MS)).world ?? null
} catch (error) {
  fetchError = error.message
}
const tick = world === null ? 0 : (world.tick ?? 0)

// [2] 证据源：每人自己的情节记忆。只留核对要用的形状（summary 一句话）。
const agents = (world === null ? [] : world.agents ?? []).map((agent) => ({
  id: agent.id,
  summaries: (agent.episodes ?? []).map((episode) => String(episode.summary ?? '')),
  commitments: agent.commitments ?? [],
}))
const summariesByAgent = new Map(agents.map((agent) => [agent.id, agent.summaries]))
const episodesByAgent = new Map(agents.map((agent) => [agent.id, agent.episodes]))

// [3] 已裁决的承诺：按 id 收成"一条约定"（双方各存一行，共用 id），双方都要出现在 parties 里。
const commitments = new Map()
let openRows = 0
for (const agent of agents) {
  for (const row of agent.commitments) {
    if (row.status !== 'kept' && row.status !== 'missed') {
      openRows += 1
      continue
    }
    const merged = commitments.get(row.id) ?? {
      id: row.id,
      statuses: new Set(),
      parties: new Set(),
      dueTick: 0,
      what: '',
    }
    merged.statuses.add(row.status)
    merged.parties.add(agent.id)
    if (typeof row.with === 'string' && row.with !== '') merged.parties.add(row.with)
    // 窗口判定用 dueTick：裁决只在 dueTick 之后发生，它就是这条记忆最早可能的时刻（取两行最大值兜底）。
    merged.dueTick = Math.max(merged.dueTick, Number.isFinite(row.dueTick) ? row.dueTick : 0)
    if (merged.what === '') merged.what = String(row.what ?? '')
    commitments.set(row.id, merged)
  }
}
const promises = [...commitments.values()].map((merged) => ({
  id: merged.id,
  // 同一 id 双方状态不一致不归这里管（verify-commitments 会报）；取排序后的第一个。
  status: [...merged.statuses].sort()[0],
  parties: [...merged.parties].sort(),
  dueTick: merged.dueTick,
  what: merged.what,
}))
const checked = { kept: 0, missed: 0 }
for (const promise of promises) checked[promise.status] += 1

// [4] 逐条核对双方：某一方自己的 episodes 里没有"前缀对 + 含事项关键词"的那条，就是这一方漏了。
//     双方都找不到时，还要看窗口：窗口内必须命中，窗口外是证据过期。
const windowStart = tick - SETTLED_KEEP_DAYS * DAY_TICKS
const keywordOf = (what) => String(what ?? '').trim().slice(0, KEYWORD_CHARS)
const missing = []
let stale = 0
let remembered = 0

for (const promise of promises) {
  const prefix = PREFIX[promise.status]
  const keyword = keywordOf(promise.what)
  const wrote = (party) =>
    (summariesByAgent.get(party) ?? []).some(
      (summary) => summary.startsWith(prefix) && summary.includes(keyword),
    )
  const lacked = promise.parties.filter((party) => !wrote(party))
  if (lacked.length === 0) {
    remembered += 1
    continue
  }
  // 修复前的历史裁决：不是漏写，是当时还没有这条通路。
  if (since !== null && Number.isFinite(since) && promise.dueTick < since) {
    stale += 1
    continue
  }
  if (lacked.length === promise.parties.length && promise.dueTick < windowStart) {
    stale += 1
    continue
  }
  for (const owner of lacked) {
    missing.push({
      id: promise.id,
      status: promise.status,
      owner,
      with: promise.parties.find((party) => party !== owner) ?? '',
      what: promise.what,
    })
  }
}

// [5] 判定 + 卡点：命中率按 id 算（分母是窗口内敢下结论的那些条，stale 不算失败也不算命中）。
const asserted = promises.length - stale
const hitRate = asserted === 0 ? null : Number((remembered / asserted).toFixed(3))
let reason = null
if (world === null) reason = 'unreachable'
else if (promises.length === 0) reason = 'no-commitments'
else if (missing.length > 0) reason = 'memory-missing'
const ok = reason === null

const notes = []
if (world === null) notes.push('快照拿不到，什么都没核对')
else if (promises.length === 0) notes.push('有 ' + agents.length + ' 个角色、' + openRows + ' 条 open 承诺，没有一条已裁决，无从核对')
else notes.push('已裁决 ' + promises.length + ' 条（kept ' + checked.kept + ' / missed ' + checked.missed + '），窗口内核对 ' + asserted + ' 条，双方情节齐 ' + remembered + ' 条')
if (stale > 0) notes.push('stale ' + stale + ' 条已滑出 ' + SETTLED_KEEP_DAYS + ' 天留存窗口，不计失败')
if (missing.length > 0) notes.push('漏写 ' + missing.length + ' 边，涉及 ' + new Set(missing.map((item) => item.id)).size + ' 条承诺')

const summary = {
  ok,
  ...(reason === null ? {} : { reason }),
  base,
  tick,
  checked,
  stale,
  hitRate,
  missing,
  note: notes.join('；'),
  ...(fetchError === null ? {} : { fetchError }),
}
console.log(JSON.stringify(summary, null, 1))

if (!ok) {
  const stuck = (() => {
    if (reason === 'unreachable') return fetchError ?? base
    if (reason === 'no-commitments') return '世界里有 ' + agents.length + ' 个角色、' + openRows + ' 条 open 承诺，但没有一条已裁决的承诺'
    const head = missing
      .slice(0, 6)
      .map((item) => item.id + '(' + item.status + ' 缺 ' + item.owner + '：' + keywordOf(item.what) + '…)')
    return head.join(', ') + (missing.length > head.length ? ' … 共 ' + missing.length + ' 边，全量见 stdout 的 missing' : '')
  })()
  failVerify(reason, { stuck, base, error: fetchError })
}
if (asserted === 0) {
  console.error('WARN 一条也没核对到：' + promises.length + ' 条已裁决承诺全部落在 ' + SETTLED_KEEP_DAYS + ' 天留存窗口之外（windowStart ' + windowStart + '）')
}
