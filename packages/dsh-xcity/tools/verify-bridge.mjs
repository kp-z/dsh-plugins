#!/usr/bin/env node
/**
 * H7：独立桥验收工具（不启动 DSH，不碰正式进程）。
 *
 * 用途：用当前构建起一个独立的 Slow Vale 桥 + 世界，浏览器打开就能看
 * "活人一天"（移动、吃饭、睡觉、学习徽章、手机线程）。
 *
 * 它不接会话，所以**不能**验证 AI 回信/主动短信的模型内容——那两项要真 DSH 宿主。
 *
 * 用法：
 *   node tools/verify-bridge.mjs
 *   node tools/verify-bridge.mjs --port 7799 --viewer player --agents 8
 *   node tools/verify-bridge.mjs --sms-after 10   # 10 秒后塞一条角色短信
 */
import { resolveConfig } from '../lib/config.js'
import { createPluginState } from '../lib/state.js'
import { createRuntime } from '../lib/runtime/index.js'
import { createSlowvaleBridge } from '../lib/adapters/slowvale/index.js'

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}

const port = Number(arg('port', 7799))
const viewer = String(arg('viewer', 'player'))
const agents = Number(arg('agents', 8))
const smsAfter = Number(arg('sms-after', 0))
const assetsDir = String(arg('assets', '~/dsh-plugins/slowvale-mirror/site'))

const config = resolveConfig({ autoStart: false, persistEveryTicks: 0, maxAgents: agents })
const service = createPluginState(config, { initialAgents: 'all' })
const world = service.ensureWorld()
world.tick = 8 * 60
const runtime = createRuntime({ service, tickMs: 100, idleActionsEnabled: true, selfLifeEnabled: true })
runtime.start()

const bridge = await createSlowvaleBridge({
  port,
  host: '127.0.0.1',
  assetsDir,
  opts: { worldId: 'w1', place: 'place:office.tech_company_1', startDate: '2026-01-01', viewerRoleId: viewer },
  account: { email: 'demo@slowvale.dev', password: 'slowvale123' },
  getWorld: () => service.currentWorld(),
  pushMs: 1000,
  bindingsFile: '/tmp/xcity-verify-bindings.json',
  forceVisible: true,
  log: (line) => console.log('[bridge]', line),
})

console.log('READY', bridge.port, 'agents', world.agents.length, 'viewer', viewer)
if (smsAfter > 0) {
  setTimeout(() => {
    const first = world.agents[0]
    console.log('APPENDED', bridge.appendIncoming(first.id, first.name, '刚在茶水间吃了点东西，下午准备学点新东西。'), 'tick', world.tick)
  }, smsAfter * 1000)
}

const shutdown = async () => {
  await bridge.close()
  runtime.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
