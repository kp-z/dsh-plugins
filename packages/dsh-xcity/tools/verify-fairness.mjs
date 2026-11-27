#!/usr/bin/env node
/**
 * 派单分布核对：把「三张单是不是一人一张」变成可复算的数字。**只读**——不写世界、不启任何进程。
 *
 * 用法：
 *   node tools/verify-fairness.mjs --base http://127.0.0.1:3190 [--tasks 3] [--timeout 10]
 *
 * 判定（ok）：最新一批 N 张单（createdAtTick 落在最新 tick 的 BATCH_SLACK 内）里
 *   - 每张都有 owner；
 *   - 没有任何 owner 拿到 >1 张。
 * 卡上的第三条「不同 owner 数 >= min(N, 空闲人数)」由前两条直接推出（每张都有人 + 没人拿两张
 * ⇒ 不同 owner 数 = N >= min(N, 空闲人数)），所以不单列判据——只把 min(N, 可派人数) 打进 workers 备查。
 * 失败时 stderr 打印卡在哪一步，退出码 1：
 *   unreachable / no-tasks / batch-size / no-owner / duplicate-owner
 *
 * 「可派的角色数」用快照里看得见的两个数一起报，判定用 available：
 *   available = 手上没有别的单（carrying 为空，或就是本批某张）的角色数——本批当时能派的人的上界；
 *   idleNow   = state 为 idle 且手上没有单的角色数（与 sim/scheduler.ts 的 idleAgents 同判据），只作参考。
 * 之所以不用 idleNow 判定：核对通常在派完之后跑，那时大家都已经忙起来了，idleNow 恒为 0 等于不判。
 */

// [0] 参数：手写解析，不引依赖（与 tools/verify-tasks.mjs 同风格）
function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}

const base = String(arg('base', 'http://127.0.0.1:3190')).replace(/\/+$/, '')
const wantRaw = arg('tasks', 3)
const wantTasks = Number(wantRaw)
if (typeof wantRaw === 'boolean' || !Number.isInteger(wantTasks) || wantTasks <= 0) {
  console.error('--tasks 必须是正整数')
  process.exit(2)
}
const timeoutRaw = arg('timeout', 10)
const timeoutSec = Number(timeoutRaw)
if (typeof timeoutRaw === 'boolean' || !(Number.isFinite(timeoutSec) && timeoutSec > 0)) {
  console.error('--timeout 必须是正数（秒）')
  process.exit(2)
}

const POLL_MS = 500
const REQUEST_MS = 3000
// 一批单是同一条派单命令落进世界的，通常同一个 tick；留 2 tick 容忍分几拍落盘的实现。
const BATCH_SLACK = 2

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_MS) })
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120))
  return res.json()
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** 未归档：世界里的 Task 没有 archivedAtTick；老存档/外部任务行带它时按归档跳过。 */
const notArchived = (task) => task.archivedAtTick === null || task.archivedAtTick === undefined

/** 最新一批：以最新 createdAtTick 为锚，取锚附近 N 张（按 createdAtTick, ordinal 排，取最新 N 张）。 */
function latestBatch(tasks) {
  const anchor = tasks.reduce((max, task) => Math.max(max, task.createdAtTick), -Infinity)
  const near = tasks
    .filter((task) => anchor - task.createdAtTick <= BATCH_SLACK)
    .sort((left, right) => left.createdAtTick - right.createdAtTick || left.ordinal - right.ordinal)
  return near.slice(-wantTasks)
}

// [1] 轮询 {base}/agent-world/api/world，直到最新一批到齐且都派出去了（或超时）
const deadline = Date.now() + timeoutSec * 1000
let snap = null
let lastError = null
while (true) {
  try {
    snap = await getJson(base + '/agent-world/api/world')
    lastError = null
  } catch (error) {
    lastError = error.message
  }
  const current = snap === null ? null : snap.world
  if (current !== null) {
    const settled = (current.tasks ?? []).filter(notArchived)
    const batch = latestBatch(settled)
    if (batch.length >= wantTasks && batch.every((task) => task.owner !== null && task.owner !== undefined)) break
  }
  const left = deadline - Date.now()
  if (left <= 0) break
  await sleep(Math.min(POLL_MS, left))
}

// [2] 统计：最新一批的 owner 分布 + 候选人数
const world = snap === null ? null : snap.world
const liveTasks = (world === null ? [] : world.tasks ?? []).filter(notArchived)
const batch = latestBatch(liveTasks)
const agents = world === null ? [] : world.agents ?? []

const byOwner = {}
for (const task of batch) {
  if (task.owner === null || task.owner === undefined) continue
  byOwner[task.owner] = (byOwner[task.owner] ?? 0) + 1
}
const batchIds = new Set(batch.map((task) => task.id))
const available = agents.filter((agent) =>
  agent.carrying === null || agent.carrying === undefined || batchIds.has(agent.carrying)).length
const idleNow = agents.filter((agent) =>
  agent.state === 'idle' && (agent.carrying === null || agent.carrying === undefined)).length
const requiredOwners = Math.min(batch.length, available)
const distinctOwners = Object.keys(byOwner).length

const tasks = batch.map((task) => ({
  id: task.id,
  status: task.status,
  owner: task.owner ?? null,
}))

// [3] 历史 awarded 计数：persona 存储里有就报，没开不算失败（与 verify-tasks 取 skills 同策略）
const awarded = {}
try {
  const personas = await getJson(base + '/agent-world/api/personas')
  for (const persona of personas.personas ?? []) {
    awarded[persona.id] = Array.isArray(persona.awardedTaskIds) ? persona.awardedTaskIds.length : 0
  }
} catch {
  // persona 存储没开：awarded 留空对象，判定不受影响。
}

// [4] 判定 + 卡点
const dupOwners = Object.entries(byOwner).filter(([, count]) => count > 1)
let reason = null
if (world === null) reason = 'unreachable'
else if (liveTasks.length === 0) reason = 'no-tasks'
else if (batch.length < wantTasks) reason = 'batch-size'
else if (tasks.some((task) => task.owner === null)) reason = 'no-owner'
else if (dupOwners.length > 0) reason = 'duplicate-owner'

const ok = reason === null
const summary = {
  ok,
  ...(ok ? {} : { reason }),
  base,
  batch: {
    tasks: batch.length,
    createdAtTicks: [...new Set(batch.map((task) => task.createdAtTick))],
    ids: batch.map((task) => task.id),
  },
  byOwner,
  workers: { available, idleNow, requiredOwners, distinctOwners },
  tasks,
  awarded,
}
console.log(JSON.stringify(summary, null, 1))

if (!ok) {
  const detail = {
    unreachable: '世界 API 连不上',
    'no-tasks': '世界里没有未归档的工单',
    'batch-size': '最新一批只有 ' + batch.length + ' 张，不足 --tasks ' + wantTasks + ' 张',
    'no-owner': '还没派出去: ' + tasks.filter((task) => task.owner === null).map((task) => task.id).join(', '),
    'duplicate-owner': dupOwners.map(([owner, count]) => owner + ' 拿了 ' + count + ' 张').join('；'),
  }[reason]
  console.error('VERIFY FAIL ' + reason + ' · ' + detail + ' · base ' + base)
  if (lastError !== null) console.error('最后错误: ' + lastError)
  process.exit(1)
}
