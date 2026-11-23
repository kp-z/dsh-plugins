#!/usr/bin/env node
/**
 * Slow Vale 适配层的独立开发入口（不启 DSH 宿主）。
 *
 * 这一版把城里的人换成 **dsh-slowvale 的三个角色**：
 *   林野（克制）· 小满（活泼）· 老周（慢条斯理）
 * 他们的名字、性格、家与工作地都来自 dsh-slowvale 的角色模型，
 * 位置来自各自的行走去向（同一个地图、不同步速），点开短信/角色面板能看到的就是他们。
 *
 *   node scripts/slowvale-dev.mjs [--port 7788] [--assets <dir>]
 *
 * 会话这一侧：目前还没有真 DSH 会话（宿主 ctx 才拿得到 sessionController），
 * 所以人物的"脑子"尚未接上；这里先让**人在城里是对的**。
 */
import { homedir } from 'node:os'
import { createSlowvaleBridge } from '../lib/adapters/slowvale/server.js'
import { createStage } from '../lib/adapters/slowvale/stage.js'
import { CHARACTERS } from '../../dsh-slowvale/lib/index.js'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}

const port = Number(arg('port', '7788'))
const castSize = Number(arg('cast', '3'))
const CAST = CHARACTERS.slice(0, Math.max(1, castSize))
const assetsDir = arg('assets', new URL('../../../slowvale-mirror/site', import.meta.url).pathname)

// 三个人各有一个行走状态机：同一条路线，不同步速，看起来像各走各的。
// 步速单位是像素/秒（默认 90）：三个人的快慢差别，是性格最便宜的体现。
const SPEEDS = { 'role.lin': 120, 'role.mei': 95, 'role.zhou': 68 }
const walkers = CAST.map((character) => ({
  character,
  stage: createStage({ assetsDir, name: character.name, speed: SPEEDS[character.id] ?? 1 }),
}))
console.log('舞台场景：' + walkers[0].stage.places().join(' → '))
console.log('城里的人：' + CAST.map((c) => c.name + '（' + c.persona.traits[0] + '）').join(' · '))

// 前端的世界用 agent-N 这套 id（它按这个认角色）；名字仍是我们的三个人。
const AGENT_IDS = { 'role.lin': 'agent-1', 'role.mei': 'agent-2', 'role.zhou': 'agent-3' }
const agents = CAST.map((character) => ({
  id: AGENT_IDS[character.id] ?? character.id,
  name: character.name,
  state: 'idle',
  station: process.env.SLOWVALE_START_PLACE || null,
  position: { x: 0, z: 0 },
  facing: 0,
}))
const world = { id: 'w1', name: '演示小镇', tick: 0, paused: false, agents }

// 观察者 = 林野（前端左下角那条流、角色面板里看到的是他）
const viewerId = AGENT_IDS[CAST[0].id] ?? CAST[0].id

const bridge = await createSlowvaleBridge({
  host: '127.0.0.1',
  port,
  assetsDir,
  opts: {
    worldId: 'w1',
    viewerRoleId: viewerId,
    place: process.env.SLOWVALE_START_PLACE || CAST[0].work.placeId,
    startDate: '2026-01-01',
    // 单场景调试：只暴露一个地点，且人不走动，排除多场景互相干扰
    ...(process.env.SLOWVALE_SINGLE_SCENE === '1' ? { singlePlace: true } : {}),
  },
  account: { email: 'demo@slowvale.dev', password: 'slowvale123' },
  getWorld: () => world,
  pushMs: Number(process.env.SLOWVALE_PUSH_MS ?? '1000'),
  debug: true,
  forceVisible: process.env.SLOWVALE_FORCE_VISIBLE === '1',
  // 谁代表谁：读 DSH 工作区里的绑定表（跟 cove 一样放在 ~/.dsh 下）
  bindingsFile: process.env.XCITY_BINDINGS ?? homedir() + '/.dsh/xcity/bindings.json',
  log: (line) => console.log(line),
})

const timer = setInterval(() => {
  world.tick += 1
  for (const walker of walkers) {
    if (process.env.SLOWVALE_ONE_SWITCH === '1') {
      // 只做一次干净切换：让前端执行唯一一次 preload，便于观察它到底发了什么
      if (world.tick === 40) { const a = agents[0]; a.station = 'place:residential.mini_market' }
      continue
    }
    if (process.env.SLOWVALE_SINGLE_SCENE === '1') continue
    const frame = walker.stage.tick(100)
    const agent = agents.find((item) => item.id === AGENT_IDS[walker.character.id])
    if (agent === undefined) continue
    agent.position = { x: frame.x, z: frame.y }
    agent.state = frame.moving ? 'moving' : 'idle'
    agent.station = frame.place
  }
}, 100)

console.log('正式前端：http://127.0.0.1:' + port + '/   （自动登录，账号 demo@slowvale.dev / slowvale123）')

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(timer)
    void bridge.close().then(() => process.exit(0))
  })
}
