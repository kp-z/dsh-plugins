/**
 * R532：夜间床位翻台。
 *
 * 现场（docs/REST-DEMAND.md 第 4 节，56 人 / 22 张床）：04:00–07:00 十张以上床 100% 占满，
 * 占用者全是 sleep；每人每天只睡到 86 分钟，能量收支 −17.7/人/天。根因不是参数，是结构：
 * SLEEP_TICKS(=480) 与夜窗 [23:00, 07:00) 的 480 分钟**等长** ⇒ 一张床一晚只服务一个人
 * ⇒ 床位需求 = 人数（56），而不是"同时想睡的人数"（≈35）。
 *
 * 这里钉四件事。决策是纯函数（chooseLife / intentOptions），所以直接问它，不跑世界：
 * 1. 单次睡眠 300 tick（5 小时）< 夜窗 480 ⇒ 每张床每晚不止一轮；
 * 2. 夜里 energy<60 的人才睡，且时长就是 SLEEP_TICKS；
 * 3. 夜里 energy≥60 的人**不进睡眠档，也不早退**——继续走后面的档（学习/聊天）；
 * 4. 60 是严格门槛：59.9 睡，60 不睡。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import {
  SLEEP_TICKS,
  chooseLife,
  intentOptions,
  isNightMinute,
  selfLifeCommands,
} from '../lib/sim/life.js'

const content = new ContentRegistry()
content.loadAll(builtinPacks())

const NIGHT_MINUTE = 2 * 60

/** 一个"站在夜里、什么都能自己选"的人：站着、没单、没有活动、没有目标站点。 */
function atNight(needs = { hunger: 90, energy: 40, social: 90 }) {
  const world = createWorld({ content, scene: 'scene.office', createdAt: '2026-01-01T00:00:00.000Z' })
  world.tick = NIGHT_MINUTE
  const agent = world.agents[0]
  agent.state = 'idle'
  agent.station = null
  agent.targetStation = null
  agent.path = []
  agent.activityUntil = undefined
  agent.carrying = null
  agent.needs = { ...needs }
  return { world, agent }
}

test('R532：睡一觉 300 tick，夜窗 480 分钟 —— 每张床每晚不止一轮', () => {
  assert.equal(SLEEP_TICKS, 300, '一次睡眠是 5 小时，不是整个夜窗')
  const nightMinutes = Array.from({ length: 1440 }, (_, minute) => minute).filter((minute) => isNightMinute(minute)).length
  assert.equal(nightMinutes, 480, '夜窗 [23:00, 07:00) 是 480 分钟（这条是上面那句话的基准）')
  // 结构判据：把 SLEEP_TICKS 改回 480 就会在这里红——那是"一张床一晚只服务一个人"的原状。
  assert.ok(nightMinutes / SLEEP_TICKS > 1.5, '每张床每晚至少翻 1.5 轮，否则床位需求退化成"人数"')
})

test('R532：夜里 energy=40 → 睡一觉，时长就是 SLEEP_TICKS', () => {
  const { world, agent } = atNight({ hunger: 90, energy: 40, social: 90 })
  const intent = chooseLife(world, agent)
  assert.equal(intent?.purpose, 'sleep', '困了（<60）的人夜里该去睡')
  assert.equal(intent?.ticks, SLEEP_TICKS, '睡的时长必须跟着 SLEEP_TICKS 走，不是写死的另一个数')
  const station = world.stations.find((row) => row.id === intent?.stationId)
  assert.ok(station?.capabilities.includes('rest'), '睡在休息位：只有占床才谈得上翻台')
})

test('R532：夜里 energy=80 → 不产生 sleep 意图', () => {
  const { world, agent } = atNight({ hunger: 90, energy: 80, social: 90 })
  const options = intentOptions(world, agent)
  assert.equal(
    options.some((option) => option.intent?.purpose === 'sleep'),
    false,
    '睡饱的人不该占床：实际候选 ' + JSON.stringify(options.map((option) => option.intent?.purpose ?? null)),
  )
  assert.notEqual(chooseLife(world, agent)?.purpose, 'sleep')
})

test('R532：夜里 energy≥60 不早退 —— 继续走后面的档（夜猫子去学习）', () => {
  const { world, agent } = atNight({ hunger: 90, energy: 80, social: 90 })
  const options = intentOptions(world, agent)
  // 门槛只该挡掉"睡觉"这一档；整段夜里若直接 return null，人就只能站在原地——
  // 那等于把睡眠问题换成"夜里没人干活"。所以这里断言后面几档真的还走得通。
  assert.ok(options.length > 0, '不睡的人必须有别的候选，不能整段夜间分支提前返回')
  const intent = chooseLife(world, agent)
  assert.equal(intent?.purpose, 'study', '02:00 不在上班时段 → 落到"闲着，学点东西"这一档')
  assert.ok(intent?.stationId, '是去某个位置做事，不是空转')
})

test('R532：夜里 energy≥60 但想说话 → 去聊天（同一段夜里两种人各走各的档）', () => {
  const { world, agent } = atNight({ hunger: 90, energy: 80, social: 10 })
  assert.equal(chooseLife(world, agent)?.purpose, 'social', '不困又想说话的人，夜里该能去社交')
})

test('R532：60 是严格门槛 —— 59.9 睡，60 不睡', () => {
  const below = atNight({ hunger: 90, energy: 59.9, social: 90 })
  assert.equal(chooseLife(below.world, below.agent)?.purpose, 'sleep', '低于门槛就该睡')

  const at = atNight({ hunger: 90, energy: 60, social: 90 })
  assert.notEqual(chooseLife(at.world, at.agent)?.purpose, 'sleep', '刚好等于 60 不睡（条件写的是 <）')
})

test('R532：同一夜里只有困的人占床 —— 睡饱的人不挤床位', () => {
  const { world, agent: sleepy } = atNight({ hunger: 90, energy: 35, social: 90 })
  const rested = world.agents[1]
  assert.ok(rested, '办公室里应当不止一个角色')
  rested.state = 'idle'
  rested.station = null
  rested.targetStation = null
  rested.path = []
  rested.activityUntil = undefined
  rested.carrying = null
  rested.needs = { hunger: 90, energy: 90, social: 90 }

  const commands = selfLifeCommands(world)
  assert.equal(commands.find((row) => row.agentId === sleepy.id)?.purpose, 'sleep', '困的人照常去睡')
  assert.notEqual(
    commands.find((row) => row.agentId === rested.id)?.purpose,
    'sleep',
    '睡饱的人不能也占一张床——床位紧张时这直接决定另一个困的人睡不睡得着',
  )
})
