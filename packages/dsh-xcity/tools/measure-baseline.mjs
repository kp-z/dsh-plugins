// R0 基线测量：每人每天活动量 + 社交窗口。只读内核，不接模型。
// 用法：cd packages/dsh-xcity && npm run build && node tools/measure-baseline.mjs
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'
import { chooseLife, selfLifeCommands } from '../lib/sim/life.js'

const OFFICE = { id: 'place:office.tech_company_1', name: 'Office', asset: 'company', spawn: { x: 480, z: 800 } }
function newWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({ content, scene: 'scene.office', name: 'baseline', maxAgents: 3, places: [OFFICE] })
}

function activitiesPerDay(world, days) {
  const perDay = []
  let by = {}
  let seen = -1
  for (let i = 0; i < days * 1440; i++) {
    step(world, selfLifeCommands(world))
    for (const a of world.activities) {
      if (a.status !== 'completed' || a.endedAt === undefined || a.endedAt <= seen) continue
      by[a.agentId] = (by[a.agentId] ?? 0) + 1
      seen = Math.max(seen, a.endedAt)
    }
    if ((i + 1) % 1440 === 0) {
      perDay.push({ day: perDay.length + 1, total: Object.values(by).reduce((x, y) => x + y, 0), by: { ...by } })
      by = {}
    }
  }
  return perDay
}

function socialWindows(world, days) {
  let ticks = 0
  let blocked = 0
  let chosen = 0
  for (let i = 0; i < days * 1440; i++) {
    for (const agent of world.agents) {
      const free = agent.state === 'idle' && agent.carrying === null && agent.activityUntil === undefined &&
        agent.station === null && agent.targetStation === null && agent.path.length === 0
      if (!free || agent.needs.social >= 35) continue
      ticks += 1
      const intent = chooseLife(world, agent)
      if (intent === null) blocked += 1
      else if (intent.purpose === 'social') chosen += 1
    }
    step(world, selfLifeCommands(world))
  }
  return { ticks, blocked, chosen }
}

const a = newWorld()
const perDay = activitiesPerDay(a, 3)
const kept = a.activities.length
const needs = a.agents.map((x) => [x.id, Math.round(x.needs.energy), Math.round(x.needs.hunger), Math.round(x.needs.social)])

const b = newWorld()
const social = socialWindows(b, 3)

console.log(JSON.stringify({ perDay, kept, needs, social }, null, 1))
