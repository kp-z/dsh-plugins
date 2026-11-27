/**
 * R521：承诺的裁决写进情节记忆（守约/爽约不再是盲区）。
 *
 * 守四件事：
 * 1. 裁决成 kept → 双方各写一条 `守约：`，kind 仍是 social，with 指向对方，salience 0.55；
 * 2. 裁决成 missed → 双方各写一条 `没做完：`，salience 0.45；
 * 3. 同一条承诺只写一次：重复 settle / 重复 keep 都不追加（幂等靠状态机，不靠去重表）；
 * 4. 写进去的记忆真的被 mood 读到：同处境、只差一次承诺的结局 → 心情一正一负、首选动作相反。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import {
  MISS_GRACE_TICKS,
  keepCommitment,
  promiseBetween,
  settleCommitments,
} from '../lib/sim/commitments.js'
import { dayOf } from '../lib/sim/memory.js'
import { chooseLife, intentOptions, memoryMood } from '../lib/sim/life.js'

function makeAgent(id) {
  return { id, name: '名字-' + id, placeId: 'pmeet', commitments: [], episodes: [] }
}

function makeWorld(tick = 0) {
  return { tick, agents: [makeAgent('a'), makeAgent('b'), makeAgent('c')], activities: [] }
}

/** 某人在某地的一段**已结束** meet：同地点、时间重叠即算见过面（不改 agent.activityId）。 */
function meetActivity(world, agentId, placeId, startedAt, endedAt) {
  world.activities.push({
    id: 'act-' + agentId + '-' + String(startedAt),
    agentId,
    kind: 'meet',
    placeId,
    stationId: null,
    status: 'completed',
    startedAt,
    endsAt: endedAt,
  })
}

function episodesOf(world, id) {
  return world.agents.find((agent) => agent.id === id).episodes
}

function withPrefix(episodes, prefix) {
  return episodes.filter((episode) => episode.summary.startsWith(prefix))
}

test('R521：裁决成 kept → 双方各写一条「守约：」情节', () => {
  const world = makeWorld(100)
  promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })
  meetActivity(world, 'a', 'pmeet', 1290, 1300)
  meetActivity(world, 'b', 'pmeet', 1295, 1305)

  const settled = settleCommitments(world, 1301)
  assert.equal(settled.length, 1)
  assert.equal(settled[0].status, 'kept')

  for (const [me, peer] of [['a', 'b'], ['b', 'a']]) {
    const mine = withPrefix(episodesOf(world, me), '守约：')
    assert.equal(mine.length, 1, me + ' 应当刚好一条守约情节')
    const episode = mine[0]
    assert.equal(episode.kind, 'social', '沿用既有 kind，不为承诺新开记忆类型')
    assert.deepEqual(episode.with, [peer], 'with 指向对方')
    assert.equal(episode.tick, 1301, '按裁决的那一刻记')
    assert.equal(episode.day, dayOf(1301))
    assert.equal(episode.placeId, 'pmeet')
    assert.equal(episode.salience, 0.55)
    assert.ok(episode.summary.includes('名字-' + peer), '要写清是对谁：' + episode.summary)
    assert.ok(episode.summary.includes('一起吃饭'), '要写清是什么事：' + episode.summary)
  }

  assert.equal(episodesOf(world, 'a').length, 1, '除了这一条没多写')
  assert.equal(episodesOf(world, 'c').length, 0, '不相关的人不写')
})

test('R521：裁决成 missed → 双方各写一条「没做完：」情节', () => {
  const world = makeWorld(100)
  promiseBetween(world, 'a', 'b', { what: '一起看片', dueTick: 1300 })

  const judgedAt = 1300 + MISS_GRACE_TICKS + 1
  const settled = settleCommitments(world, judgedAt)
  assert.equal(settled[0].status, 'missed')

  for (const [me, peer] of [['a', 'b'], ['b', 'a']]) {
    const mine = withPrefix(episodesOf(world, me), '没做完：')
    assert.equal(mine.length, 1, me + ' 应当刚好一条爽约情节')
    const episode = mine[0]
    assert.equal(episode.kind, 'social')
    assert.deepEqual(episode.with, [peer])
    assert.equal(episode.tick, judgedAt)
    assert.equal(episode.salience, 0.45, '爽约比守约轻一点，但仍然是负向')
    assert.ok(episode.summary.includes('名字-' + peer), episode.summary)
    assert.ok(episode.summary.includes('一起看片'), episode.summary)
  }
  assert.equal(episodesOf(world, 'c').length, 0)
})

test('R521：同一条承诺只写一次 —— 重复 settle 不追加', () => {
  const world = makeWorld(100)
  promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })
  const judgedAt = 1300 + MISS_GRACE_TICKS + 1
  settleCommitments(world, judgedAt)
  assert.deepEqual([episodesOf(world, 'a').length, episodesOf(world, 'b').length], [1, 1])

  assert.deepEqual(settleCommitments(world, judgedAt), [], '已裁决的不再判')
  settleCommitments(world, judgedAt + 10)
  settleCommitments(world, judgedAt + 500)
  assert.deepEqual(
    [episodesOf(world, 'a').length, episodesOf(world, 'b').length],
    [1, 1],
    '重复 settle 不得重复写记忆',
  )

  // kept 那一侧同样只写一次。
  const kept = makeWorld(100)
  promiseBetween(kept, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })
  meetActivity(kept, 'a', 'pmeet', 1290, 1300)
  meetActivity(kept, 'b', 'pmeet', 1295, 1305)
  settleCommitments(kept, 1301)
  settleCommitments(kept, 1400)
  assert.deepEqual([episodesOf(kept, 'a').length, episodesOf(kept, 'b').length], [1, 1])
})

test('R521：显式 keepCommitment 也是 kept 裁决，同样留痕且不重复', () => {
  const world = makeWorld(100)
  const written = promiseBetween(world, 'a', 'b', { what: '帮我修车', dueTick: 900 })

  assert.equal(keepCommitment(world, 'a', written.id), true)
  assert.equal(withPrefix(episodesOf(world, 'a'), '守约：').length, 1)
  assert.equal(withPrefix(episodesOf(world, 'b'), '守约：').length, 1)
  assert.equal(episodesOf(world, 'a')[0].tick, 100, '按"现在"记，不按到期时间倒填')

  assert.equal(keepCommitment(world, 'a', written.id), false, '重复 keep 安全')
  settleCommitments(world, 1000)
  assert.equal(withPrefix(episodesOf(world, 'a'), '守约：').length, 1, 'keep 之后再 settle 也不重复写')
})

// ---- 第 4 条：记忆真的进到 mood/决策里 -------------------------------------

const content = new ContentRegistry()
content.loadAll(builtinPacks())
const OFFICE = {
  id: 'place:office.tech_company_1', name: 'Office', asset: 'company', spawn: { x: 480, z: 800 },
}
/** 10:00 写下约定；11:40 到期；14:50 裁决（宽限 880 已过，仍在上班时段）。 */
const PROMISED_AT = 600
const DUE_AT = 700
const NOW = 890

/**
 * 一个"可社交也可上班"的处境（与 life-memory 的 makeScene 同构）：裸分社交 0.7 vs 上班 0.65，
 * 差距 7.7% 落在 ±10% 之内——所以只有记忆能翻动它。
 */
function makeScene() {
  const world = createWorld({
    content, scene: 'scene.office', name: 'commit-memory', maxAgents: 3, places: [OFFICE],
  })
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
  world.tick = PROMISED_AT
  assert.notEqual(
    promiseBetween(world, 'agent-1', 'agent-2', { what: '一起吃饭', dueTick: DUE_AT }),
    null,
  )
  return world
}

test('R521：同处境、只差一次承诺的结局 → 心情一正一负、首选动作相反', () => {
  const kept = makeScene()
  meetActivity(kept, 'agent-1', OFFICE.id, 690, 700)
  meetActivity(kept, 'agent-2', OFFICE.id, 695, 705)
  kept.tick = NOW
  assert.equal(settleCommitments(kept, NOW)[0].status, 'kept')

  const missed = makeScene()
  missed.tick = NOW
  assert.equal(settleCommitments(missed, NOW)[0].status, 'missed')

  const meKept = kept.agents[0]
  const meMissed = missed.agents[0]
  assert.deepEqual(meKept.needs, meMissed.needs, '前提：两个世界的需求一样')
  assert.deepEqual(meKept.traits, meMissed.traits, '前提：两个世界的性格一样')
  assert.deepEqual(
    intentOptions(kept, meKept).map((option) => option.intent?.purpose),
    intentOptions(missed, meMissed).map((option) => option.intent?.purpose),
    '前提：两边的候选必须一样（只剩记忆不同）',
  )

  assert.equal(memoryMood(meKept, NOW), 0.55, '守约把心情抬起来')
  assert.equal(memoryMood(meMissed, NOW), -0.45, '爽约把心情压下去')
  assert.equal(chooseLife(kept, meKept)?.purpose, 'work', '记着兑现了承诺 → 坐得住干活')
  assert.equal(chooseLife(missed, meMissed)?.purpose, 'social', '记着爽了约 → 想找人说话')
})
