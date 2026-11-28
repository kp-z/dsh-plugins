#!/usr/bin/env node
/**
 * verify-growth.mjs —— 从**存档**复算每人的「近期手感」（H37 / R542）。
 *
 * ## 口径不在这个脚本里
 *
 * 直接 import 编译产物 `lib/sim/skills.js` 的 `skillsOf`。为什么：R541 第一版在脚本里
 * 自己 filter 了一遍"完工活动 + 完工单"，当天就和内核分叉——内核**跳过**带 `taskAttemptId`
 * 的活动（那一段活已经由工单结过账），脚本没跳，于是同一份存档能算出两组数字。
 * 核对脚本**不许自创证据定义**，否则核的是自己。
 *
 * 因此跑之前先 `npm run build`（本脚本读 lib）。
 *
 * 口径（与内核同一份）：
 *   - 主来源 `world.activities`（kind=work + completed + skill 非空），一次练习 +8；
 *   - 补充来源 `world.tasks`（status=done），一张单 +25，同 (set,key) 第 2 次 +10、第 3 次起 +5；
 *   - 窗口 = 活动环上限 max(64, 24×人数)，**每人保底 24 条**（超出的才按全局 FIFO 丢）；
 *   - 等级门槛见 LEVEL_THRESHOLDS（L1..L5 = 32/72/160/280/440 → 练 4/9/20/35/55 次）。
 *
 * 用法：node tools/verify-growth.mjs [world.json]
 * 默认 ~/.dsh/profiles/desktop/.xcity/world.json（只读）。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { activityKeepFor, ACTIVITY_KEEP_PER_AGENT } from '../lib/sim/activity.js'
import { LEVEL_THRESHOLDS, MAX_LEVEL, POINTS_PRACTICE, skillLineForPrompt, skillsOf } from '../lib/sim/skills.js'

const file = process.argv[2] ?? join(homedir(), '.dsh/profiles/desktop/.xcity/world.json')
const raw = JSON.parse(readFileSync(file, 'utf8'))
const world = raw.world ?? raw
const agents = Array.isArray(world.agents) ? world.agents : []
const activities = Array.isArray(world.activities) ? world.activities : []
const tasks = Array.isArray(world.tasks) ? world.tasks : []
const doneTasks = tasks.filter((task) => task.status === 'done')

const keep = activityKeepFor({ agents })
const thresholdLine = LEVEL_THRESHOLDS.map(
  (points, index) => 'L' + String(index + 1) + '=' + String(points) + '（练 ' + String(Math.ceil(points / POINTS_PRACTICE)) + ' 次）',
).join(' ')

console.log('存档：' + file)
console.log(
  '世界：tick=' + String(world.tick) + ' 角色=' + String(agents.length) +
  ' 活动=' + String(activities.length) + '（保留窗口 ' + String(keep) + '，每人保底 ' + String(ACTIVITY_KEEP_PER_AGENT) + '）' +
  ' 工单=' + String(tasks.length) + '（done ' + String(doneTasks.length) + '）',
)
console.log('门槛（' + String(MAX_LEVEL) + ' 级，一次练习 +' + String(POINTS_PRACTICE) + '）：' + thresholdLine)

const rows = agents.map((agent) => {
  const skills = skillsOf(world, agent.id)
  const parts = skills.map(
    (row) =>
      row.skill + ' ' + String(row.level) + ' 级 ' + String(row.points) + ' 分 / 练 ' + String(row.sample) + ' 次' +
      (row.failed === 0 ? '' : ' / 打回 ' + String(row.failed) + ' 张') +
      (row.lastUsedTick === null ? '' : ' / 最近 t' + String(row.lastUsedTick)),
  )
  console.log('· ' + agent.name + '（' + agent.id + '）：' + (parts.join(' | ') || '—'))
  const prompt = skillLineForPrompt(world, agent.id)
  if (prompt !== '') console.log('  提示词行：' + prompt)
  return { id: agent.id, name: agent.name, skills, prompt }
})

const total = rows.reduce((sum, row) => sum + row.skills.length, 0)
if (total === 0) console.log('（没有任何可用于派生的完工记录：近期手感会全空——这是事实，不是 bug）')
console.log(JSON.stringify({ file, keep, thresholds: LEVEL_THRESHOLDS, agents: rows }))
