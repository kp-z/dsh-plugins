/**
 * R515：记忆影响决策（最小实现）。
 *
 * 守四件事：
 * 1. 心情只由**已有**的 episodes 字段算出来（kind/summary/salience），没有记忆就是 0；
 * 2. 幅度 ≤ ±10%，只动"社交 vs 工作/学习"的相对优先级，动不了饿/困这类硬需求；
 * 3. 同处境、同性格、只有记忆不同 → 首选动作真的不同（否则这个机制等于没接上）；
 * 4. 纯函数：同输入同结果，无随机。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import {
  MEMORY_MOOD_WEIGHT,
  MEMORY_MOOD_WINDOW,
  chooseLife,
  intentOptions,
  memoryMood,
  memoryWeightOf,
} from '../lib/sim/life.js'

const content = new ContentRegistry()
content.loadAll(builtinPacks())
const OFFICE = { id: 'place:office.tech_company_1', name: 'Office', asset: 'company', spawn: { x: 480, z: 800 } }

/** 一条情节记忆；day 由 tick 推出来，与 sim/memory.ts 的 dayOf 同式。 */
const episode = (tick, summary, salience, kind = 'work') => ({
  tick,
  day: Math.floor(Math.max(0, tick) / 1440) + 1,
  kind,
  summary,
  with: [],
  placeId: OFFICE.id,
  salience,
})

const WORK_MINUTE = 10 * 60
const NOW = 10 * 60

/**
 * 一个"可社交也可上班"的处境：上班时段、社交需求低、其余需求满、性格中庸。
 * 两种候选的裸分 0.7（社交）vs 0.65（上班）——差距 7.7%，正好落在 ±10% 里，
 * 所以只有记忆能翻动它；这正是要钉的可观测差异。
 */
function makeScene() {
  const world = createWorld({ content, scene: 'scene.office', name: 'memory', maxAgents: 3, places: [OFFICE] })
  world.tick = WORK_MINUTE
  for (const agent of world.agents) {
    agent.state = 'idle'
    agent.station = null
    agent.targetStation = null
    agent.path = []
    agent.activityUntil = undefined
    agent.carrying = null
    agent.traits = { diligence: 0.5, duty: 0.5 }
    agent.needs = { hunger: 100, energy: 100, social: 20 }
  }
  return world
}

test('R515：没有记忆 → 心情 0', () => {
  const world = makeScene()
  assert.equal(memoryMood(world.agents[0], NOW), 0)
})

test('R515：吃饭/睡觉/干活/聊天/日小结都不算心情（日常琐事不是情绪来源）', () => {
  const world = makeScene()
  const agent = world.agents[0]
  const before = chooseLife(world, agent)?.purpose
  agent.episodes = [
    episode(NOW - 200, '吃了顿饭', 0.3, 'meal'),
    episode(NOW - 160, '睡了一觉', 0.3, 'sleep'),
    episode(NOW - 120, '和人聊了聊', 0.6, 'social'),
    episode(NOW - 80, '干活', 0.3, 'work'),
    episode(NOW - 40, '第1天：干活×3', 0.5, 'day'),
  ]
  assert.equal(memoryMood(agent, NOW), 0, '琐事不计分，否则心情恒为 +1，加权退化成常数偏置')
  assert.equal(chooseLife(world, agent)?.purpose, before, '中性记忆不该改变选择')
})

test('R515：办成的工单 → 心情 > 0；没做完 → < 0；正负按 salience 相抵', () => {
  const world = makeScene()
  const agent = world.agents[0]

  agent.episodes = [episode(NOW - 100, '工单「补测试」', 0.9, 'work')]
  assert.ok(memoryMood(agent, NOW) > 0, '完成工单应当是正向')
  assert.equal(memoryMood(agent, NOW), 0.9)

  agent.episodes = [episode(NOW - 100, '没做完：工单「补测试」', 0.5, 'work')]
  assert.ok(memoryMood(agent, NOW) < 0, '没做完应当是负向')
  assert.equal(memoryMood(agent, NOW), -0.5)

  agent.episodes = [
    episode(NOW - 100, '工单「补测试」', 0.9, 'work'),
    episode(NOW - 50, '没做完：工单「写文档」', 0.45, 'work'),
  ]
  assert.ok(Math.abs(memoryMood(agent, NOW) - 0.45) < 1e-9, '正负相抵后剩一半多一点')

  // 相抵干净 → 0：同一天又成又败，就是"没心情"。
  agent.episodes = [
    episode(NOW - 100, '工单「补测试」', 0.5, 'work'),
    episode(NOW - 50, '没做完：工单「写文档」', 0.5, 'work'),
  ]
  assert.equal(memoryMood(agent, NOW), 0)
})

test('R515：只看最近 1440 tick —— 昨天以前的记忆不再影响今天', () => {
  const world = makeScene()
  const agent = world.agents[0]
  const stale = episode(NOW - MEMORY_MOOD_WINDOW - 1, '工单「补测试」', 0.9, 'work')
  const edge = episode(NOW - MEMORY_MOOD_WINDOW, '没做完：工单「写文档」', 0.4, 'work')
  const future = episode(NOW + 60, '工单「还没发生」', 0.9, 'work')

  agent.episodes = [stale]
  assert.equal(memoryMood(agent, NOW), 0, '窗口外的旧记忆不计分')
  agent.episodes = [stale, edge]
  assert.ok(Math.abs(memoryMood(agent, NOW) + 0.4) < 1e-9, '窗口左边界这一 tick 仍然算（闭区间）')
  agent.episodes = [future]
  assert.equal(memoryMood(agent, NOW), 0, '未来的记忆不该被提前读到')
})

test('R515：加权幅度 ≤ ±10%，且 meal/sleep/rest 完全不受心情影响', () => {
  assert.equal(MEMORY_MOOD_WEIGHT, 0.1)
  for (const mood of [-1, -0.8, -0.3, 0, 0.3, 0.8, 1]) {
    for (const purpose of ['work', 'study']) {
      const weight = memoryWeightOf(purpose, mood)
      assert.ok(weight >= 1 - MEMORY_MOOD_WEIGHT - 1e-12 && weight <= 1 + MEMORY_MOOD_WEIGHT + 1e-12,
        purpose + ' 的乘数越界：' + String(weight))
    }
    const social = memoryWeightOf('social', mood)
    assert.ok(social >= 1 - MEMORY_MOOD_WEIGHT - 1e-12 && social <= 1 + MEMORY_MOOD_WEIGHT + 1e-12,
      'social 的乘数越界：' + String(social))
    for (const purpose of ['meal', 'sleep', 'rest']) {
      assert.equal(memoryWeightOf(purpose, mood), 1, purpose + ' 是硬需求，乘数必须恒为 1')
    }
  }
  // 越界的心情值也被夹回 [-1, 1]，乘数不会被放大。
  assert.equal(memoryWeightOf('work', 5), 1 + MEMORY_MOOD_WEIGHT)
  assert.equal(memoryWeightOf('work', -5), 1 - MEMORY_MOOD_WEIGHT)
})

test('R515：同处境、同性格，只有记忆不同 → 首选动作不同', () => {
  const positive = makeScene()
  const negative = makeScene()
  const mePos = positive.agents[0]
  const meNeg = negative.agents[0]

  // 两个世界除了记忆完全一样：同样的 tick、同样的需求、同样的性格。
  assert.deepEqual(mePos.needs, meNeg.needs)
  assert.deepEqual(mePos.traits, meNeg.traits)
  assert.deepEqual(intentOptions(positive, mePos).map((option) => option.intent?.purpose),
    intentOptions(negative, meNeg).map((option) => option.intent?.purpose),
    '场景前提：两个世界的候选必须一样')

  mePos.episodes = [episode(NOW - 60, '工单「补测试」', 0.9, 'work')]
  meNeg.episodes = [episode(NOW - 60, '没做完：工单「补测试」', 0.9, 'work')]

  assert.equal(chooseLife(positive, mePos)?.purpose, 'work', '记着办成了事 → 留下来干活')
  assert.equal(chooseLife(negative, meNeg)?.purpose, 'social', '记着没做完 → 想找人说话')
})

test('R515：心情翻不动硬需求 —— 饿着照样去吃饭，夜里照样去睡', () => {
  const hungry = makeScene()
  const eater = hungry.agents[0]
  eater.needs = { hunger: 10, energy: 100, social: 100 }
  eater.episodes = [episode(NOW - 60, '没做完：工单「补测试」', 1, 'work')]
  assert.equal(chooseLife(hungry, eater)?.purpose, 'meal')

  const night = makeScene()
  night.tick = 2 * 60
  const sleeper = night.agents[0]
  sleeper.episodes = [episode(60, '工单「补测试」', 1, 'work')]
  assert.equal(chooseLife(night, sleeper)?.purpose, 'sleep')
})

test('R515：确定性 —— 同输入同结果，记忆顺序不影响心情', () => {
  const world = makeScene()
  const agent = world.agents[0]
  const rows = [
    episode(NOW - 300, '工单「补测试」', 0.9, 'work'),
    episode(NOW - 200, '没做完：工单「写文档」', 0.5, 'work'),
    episode(NOW - 100, '工单「跑基准」', 0.6, 'work'),
  ]
  agent.episodes = rows
  const mood = memoryMood(agent, NOW)
  const choice = chooseLife(world, agent)?.purpose
  assert.equal(memoryMood(agent, NOW), mood, '重复求值必须一致')
  assert.equal(chooseLife(world, agent)?.purpose, choice, '重复决策必须一致')

  agent.episodes = [rows[2], rows[0], rows[1]]
  assert.equal(memoryMood(agent, NOW), mood, '记忆顺序不该改变心情')
  assert.equal(chooseLife(world, agent)?.purpose, choice, '记忆顺序不该改变选择')
})
