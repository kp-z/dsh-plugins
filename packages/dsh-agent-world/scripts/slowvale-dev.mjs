#!/usr/bin/env node
/**
 * Slow Vale 适配层的独立开发入口（不启 DSH 宿主）。
 *
 * 两个页面：
 *   /      Slow Vale 正式前端（自动登录直达，HUD 已能进，但场景像素还差一道）
 *   /show  极简可视化：一个人物在几座主要场景之间自动行走（用同一套地图与角色帧）
 *
 * 数据只有一份：stage 状态机。世界快照里的位置也取自它，所以两个页面看到的是同一个人。
 *
 *   node scripts/slowvale-dev.mjs [--port 7788] [--assets <dir>]
 */
import { createSlowvaleBridge } from '../lib/adapters/slowvale/server.js'
import { createStage } from '../lib/adapters/slowvale/stage.js'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}

const port = Number(arg('port', '7788'))
const assetsDir = arg('assets', new URL('../../../slowvale-mirror/site', import.meta.url).pathname)

const stage = createStage({ assetsDir, name: '阿吉' })
console.log('舞台场景：' + stage.places().join(' → '))

// 只有一个人：世界快照里的角色就是舞台上的那个人，位置每 tick 同步。
const agent = { id: 'agent-1', name: '阿吉', state: 'idle', station: null, position: { x: 0, z: 0 }, facing: 0 }
const world = { id: 'w1', name: '演示小镇', tick: 0, paused: false, agents: [agent] }

const bridge = await createSlowvaleBridge({
  host: '127.0.0.1',
  port,
  assetsDir,
  opts: { worldId: 'w1', viewerRoleId: 'agent-1', place: 'place:office.tech_company_1', startDate: '2026-01-01' },
  account: { email: 'demo@slowvale.dev', password: 'slowvale123' },
  getWorld: () => world,
  getStageFrame: () => stage.frame(),
  pushMs: 1000,
  autoEnter: true,
  debug: true,
  log: (line) => console.log(line),
})

const timer = setInterval(() => {
  world.tick += 1
  const frame = stage.tick(100)
  agent.position = { x: frame.x, z: frame.y }
  agent.state = frame.moving ? 'moving' : 'idle'
  agent.station = frame.place
}, 100)

console.log('正式前端：http://127.0.0.1:' + port + '/   （自动登录，账号 demo@slowvale.dev / slowvale123）')
console.log('走动视图：http://127.0.0.1:' + port + '/show')

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(timer)
    void bridge.close().then(() => process.exit(0))
  })
}
