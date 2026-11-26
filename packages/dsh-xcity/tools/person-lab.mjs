#!/usr/bin/env node
/**
 * R478：活人仿真台。
 *
 * 把世界按游戏时间往前推，统计每个角色把时间花在什么上、需求是否越界、
 * 状态是否在抖。后续每个小时都可以直接用它当验收命令。
 *
 * 用法：
 *   node tools/person-lab.mjs --hours 24
 *   node tools/person-lab.mjs --hours 24 --agents 8 --seed demo --json
 */
import { resolveConfig } from '../lib/config.js'
import { createPluginState } from '../lib/state.js'
import { createRuntime } from '../lib/runtime/index.js'
import { occupancyOf } from '../lib/sim/scheduler.js'

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}

const hours = Math.max(1, Number(arg('hours', 24)) || 24)
const agentCount = Math.max(1, Number(arg('agents', 8)) || 8)
const asJson = arg('json', false) === true
const seed = String(arg('seed', 'person-lab'))

const config = resolveConfig({
  autoStart: false,
  persistEveryTicks: 0,
  maxAgents: agentCount,
  worldName: seed,
})
const service = createPluginState(config, { initialAgents: 'all' })
const world = service.ensureWorld()
world.tick = 8 * 60 // 08:00 开局，一天里最先有意义的时段

const runtime = createRuntime({
  service,
  tickMs: 100,
  idleActionsEnabled: true,
  selfLifeEnabled: true,
})

function classify(agent) {
  if (agent.activityUntil !== undefined && agent.activityPurpose !== undefined) return agent.activityPurpose
  if (agent.state === 'sleeping') return 'rest'
  if (agent.state === 'talking') return 'social'
  if (agent.state === 'walking' || agent.state === 'traveling') return 'walking'
  if (agent.state === 'working') return 'work'
  return 'idle'
}

const stats = new Map(
  world.agents.map((agent) => [
    agent.id,
    { name: agent.name, counts: {}, switches: 0, last: null, energy: [], hunger: [], social: [] },
  ]),
)
const stationPeak = new Map()
const violations = []
// --hours 是**游戏小时**（1 小时 = 60 tick），不是"跑多少天"。
const total = hours * 60

for (let step = 0; step < total; step += 1) {
  runtime.advance(1)
  for (const agent of world.agents) {
    const row = stats.get(agent.id)
    if (row === undefined) continue
    const key = classify(agent)
    row.counts[key] = (row.counts[key] ?? 0) + 1
    // 切换只数"生活活动"之间的变化：走路/到站不算一次换主意，
    // 否则一次出门会被拆成 idle→walking→work 三次。
    const life = agent.activityUntil !== undefined && agent.activityPurpose !== undefined
      ? agent.activityPurpose
      : agent.state === 'idle' ? 'idle' : null
    if (life !== null) {
      if (row.last !== null && row.last !== life) row.switches += 1
      row.last = life
    }
    const needs = agent.needs
    if (needs === undefined) continue
    row.energy.push(needs.energy)
    row.hunger.push(needs.hunger)
    row.social.push(needs.social)
    for (const [kind, value] of Object.entries(needs)) {
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        violations.push(`${agent.id} 的 needs.${kind} 越界：${String(value)}（tick ${world.tick}）`)
      }
    }
  }
  if (step % 10 === 0) {
    for (const station of world.stations) {
      const used = occupancyOf(world, station.id)
      stationPeak.set(station.id, Math.max(stationPeak.get(station.id) ?? 0, used))
    }
  }
}

const summary = [...stats.entries()].map(([id, row]) => {
  const sum = (list) => list.reduce((a, b) => a + b, 0)
  const avg = (list) => (list.length === 0 ? 0 : sum(list) / list.length)
  const min = (list) => (list.length === 0 ? 0 : Math.min(...list))
  const max = (list) => (list.length === 0 ? 0 : Math.max(...list))
  const percentage = Object.fromEntries(
    Object.entries(row.counts)
      .map(([kind, count]) => [kind, Math.round((count / total) * 1000) / 10])
      .sort((a, b) => b[1] - a[1]),
  )
  return {
    id,
    name: row.name,
    switchesPerHour: Math.round((row.switches / hours) * 10) / 10,
    percentage,
    needs: {
      energy: { min: Math.round(min(row.energy)), avg: Math.round(avg(row.energy)), max: Math.round(max(row.energy)) },
      hunger: { min: Math.round(min(row.hunger)), avg: Math.round(avg(row.hunger)), max: Math.round(max(row.hunger)) },
      social: { min: Math.round(min(row.social)), avg: Math.round(avg(row.social)), max: Math.round(max(row.social)) },
    },
  }
})

const peak = [...stationPeak.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['-', 0]
const result = { hours, agents: summary, stationPeak: { id: peak[0], used: peak[1] }, violations }

if (asJson) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`仿真 ${hours}h（${total} tick），agents=${world.agents.length}`)
  for (const row of summary) {
    const parts = Object.entries(row.percentage).map(([kind, pct]) => `${kind} ${pct}%`).join(' / ')
    console.log(`- ${row.id} ${row.name}: ${parts}｜切换 ${row.switchesPerHour}/h`)
    console.log(`  需求 e ${row.needs.energy.min}-${row.needs.energy.max} (avg ${row.needs.energy.avg}) · h ${row.needs.hunger.min}-${row.needs.hunger.max} (avg ${row.needs.hunger.avg}) · s ${row.needs.social.min}-${row.needs.social.max} (avg ${row.needs.social.avg})`)
  }
  console.log(`站点占用峰值：${peak[0]} = ${peak[1]}`)
}

if (violations.length > 0) {
  console.error('不变量违例：')
  for (const line of violations.slice(0, 10)) console.error('  ' + line)
  process.exitCode = 1
}
