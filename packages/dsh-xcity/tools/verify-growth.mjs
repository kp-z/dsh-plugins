#!/usr/bin/env node
/**
 * verify-growth.mjs —— 从**存档**复算「每人的技能熟练度来源」（R541）。
 *
 * 为什么要这个脚本：PLAN 的「可复算」一栏要能原样复制一条命令跑出数字。
 * 判据只看世界里的既有事实，不依赖测试埋点：
 *   - 主来源 world.activities（kind=work + completed + skill 非空；保留窗口 max(64, 24×人数)）
 *   - 补充来源 world.tasks（status=done 的工单，按 requires 记）
 *
 * 用法：node tools/verify-growth.mjs [world.json]
 * 默认 ~/.dsh/profiles/desktop/.xcity/world.json（只读）。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const file = process.argv[2] ?? join(homedir(), '.dsh/profiles/desktop/.xcity/world.json')
const raw = JSON.parse(readFileSync(file, 'utf8'))
const world = raw.world ?? raw
const agents = Array.isArray(world.agents) ? world.agents : []
const activities = Array.isArray(world.activities) ? world.activities : []
const tasks = Array.isArray(world.tasks) ? world.tasks : []

const workDone = activities.filter((a) => a.kind === 'work' && a.status === 'completed' && typeof a.skill === 'string')
const taskDone = tasks.filter((t) => t.status === 'done' && typeof t.owner === 'string')

const rows = agents.map((agent) => {
  const skills = {}
  for (const act of workDone) {
    if (act.agentId !== agent.id) continue
    const key = act.skill
    const cur = skills[key] ?? { acts: 0, lastUsedTick: 0 }
    cur.acts += 1
    cur.lastUsedTick = Math.max(cur.lastUsedTick, act.endedAt ?? act.startedAt ?? 0)
    skills[key] = cur
  }
  for (const task of taskDone) {
    if (task.owner !== agent.id) continue
    for (const cap of task.requires ?? []) {
      const cur = skills[cap] ?? { acts: 0, lastUsedTick: 0 }
      cur.acts += 1
      skills[cap] = cur
    }
  }
  return { id: agent.id, name: agent.name, skills }
})

const keep = Math.max(64, 24 * agents.length)
console.log('存档：' + file)
console.log('世界：tick=' + world.tick + ' 角色=' + agents.length + ' 活动=' + activities.length + '（work+completed ' + workDone.length + '，保留窗口 ' + keep + '）工单=' + tasks.length + '（done ' + taskDone.length + '）')
for (const row of rows) {
  const parts = Object.entries(row.skills).map(([k, v]) => k + '×' + v.acts + '(最近 t' + v.lastUsedTick + ')')
  console.log('· ' + row.name + '（' + row.id + '）：' + (parts.join(' ') || '—'))
}
if (workDone.length === 0 && taskDone.length === 0) console.log('（没有任何可用于派生的完工记录：熟练度会全空——这是事实，不是 bug）')
console.log(JSON.stringify(rows))