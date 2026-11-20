#!/usr/bin/env node
/**
 * Slow Vale 适配层的独立开发入口（不启 DSH 宿主）。
 *
 * 用途：只改前端或只改投影时，不必把整个宿主拉起来。它造一个**会走动的假世界**，
 * 其余（HTTP 契约、SSE、静态站）走的是与生产完全相同的代码路径——
 * 所以在这里看到的东西，等于在宿主里看到的东西。
 *
 *   node scripts/slowvale-dev.mjs [--port 7788] [--assets <dir>] [--place downtown_street]
 */
import { createSlowvaleBridge } from '../lib/adapters/slowvale/server.js'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}

const port = Number(arg('port', '7788'))
const assetsDir = arg('assets', new URL('../../../slowvale-mirror/site', import.meta.url).pathname)
const place = arg('place', 'place:office.tech_company_1')

/** 假世界：三个人沿着固定巡逻点来回走，tick 决定位置。 */
const NAMES = ['阿吉', '小满', '老周']
const agents = NAMES.map((name, i) => ({
  id: 'agent-' + String(i + 1),
  name,
  state: i === 0 ? 'working' : 'idle',
  station: null,
  position: { x: 0, z: 0 },
  facing: 0,
}))

const world = { id: 'w1', name: '演示小镇', tick: 0, paused: false, agents }

setInterval(() => {
  world.tick += 1
  for (let i = 0; i < agents.length; i += 1) {
    const agent = agents[i]
    const phase = (world.tick * 0.02 + i * 2.1) % (Math.PI * 2)
    agent.position = { x: 1600 + Math.cos(phase) * 380, z: 1800 + Math.sin(phase) * 260 }
    agent.facing = phase + Math.PI / 2
    agent.station = Math.sin(phase) > 0.6 ? place : null
  }
}, 100)

// 世界 tick 的推进入口与宿主一致：10Hz 由 runtime 驱动，这里用一个定时器代替。
const bridge = await createSlowvaleBridge({
  host: '127.0.0.1',
  port,
  assetsDir,
  opts: { worldId: 'w1', viewerRoleId: 'agent-1', place, startDate: '2026-01-01' },
  account: { email: 'demo@slowvale.dev', password: 'slowvale123' },
  getWorld: () => world,
  pushMs: 1000,
  autoEnter: true,
  log: (line) => console.log(line),
})

console.log('账号：demo@slowvale.dev / slowvale123')
console.log('世界：3 个角色在城里绕圈，每 100ms 一个 tick，每秒推一次快照')

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void bridge.close().then(() => process.exit(0))
  })
}
