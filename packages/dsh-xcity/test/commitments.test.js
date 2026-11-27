/**
 * R497：承诺的生命周期（sim/commitments.ts）。
 *
 * 守六件事：
 * 1. 一个约定双方各一条，共用 id，with 互指；同一天同一件事重复写是幂等的；
 * 2. 非法输入（未知角色、自己对自己、过期、空 what）不写半条；
 * 3. 只有两类证据算数：窗口内和对方有交集（episode.with / 同地点 meet 重叠），或显式 keepCommitment；
 * 4. 到期当 tick 不判；到期没证据也不立刻判 missed——忙碌宽限（BUSY_GRACE_TICKS）先顺延，
 *    再用失约宽限（MISS_GRACE_TICKS，R513）等到 dueTick + 宽限，期间出现证据立刻 kept；
 * 5. 每人同时 open ≤3，超出时最旧的一条双方一起 released；
 * 6. 已裁决的旧承诺会被裁剪，不会让存档无限长。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {

  MISS_GRACE_TICKS,
  OPEN_MAX,
  SETTLED_KEEP_DAYS,
  commitmentId,
  keepCommitment,
  promiseBetween,
  settleCommitments,
} from '../lib/sim/commitments.js'
import { DAY_TICKS } from '../lib/sim/memory.js'

function makeAgent(id) {
  return { id, name: id, commitments: [], episodes: [] }
}

function makeWorld(tick = 0) {
  return { tick, agents: [makeAgent('a'), makeAgent('b'), makeAgent('c')], activities: [] }
}

function rows(world, id) {
  return world.agents.find((agent) => agent.id === id).commitments
}

function rowById(world, id, commitmentRowId) {
  return rows(world, id).find((row) => row.id === commitmentRowId)
}

/** 让某人在某地有一段 meet 活动（默认还在进行）。 */
function meetActivity(world, agentId, placeId, startedAt, endedAt) {
  const activity = {
    id: 'act-' + agentId + '-' + String(startedAt),
    agentId,
    kind: 'meet',
    placeId,
    stationId: null,
    status: endedAt === undefined ? 'active' : 'completed',
    startedAt,
    endsAt: endedAt ?? startedAt + 30,
  }
  world.activities.push(activity)
  if (endedAt === undefined) world.agents.find((agent) => agent.id === agentId).activityId = activity.id
  return activity
}

function episodeWith(tick, peerId) {
  return { tick, day: 1, kind: 'social', summary: '和人聊了聊', with: [peerId], placeId: 'pmeet', salience: 0.6 }
}

test('R497：一个约定双方各一条，id 一致、with 互指', () => {
  const world = makeWorld(100)
  const written = promiseBetween(world, 'a', 'b', { what: ' 一起吃饭 ', dueTick: 1300 })

  assert.notEqual(written, null)
  assert.equal(written.mine.with, 'b')
  assert.equal(written.theirs.with, 'a')
  assert.equal(written.mine.id, written.theirs.id)
  assert.equal(written.mine.what, '一起吃饭', 'what 去掉首尾空白')
  assert.equal(written.mine.status, 'open')
  assert.equal(written.mine.source, 'plan', '缺省来源是每日计划')
  assert.equal(written.mine.createdAtTick, 100)
  assert.equal(written.mine.dueTick, 1300)
  assert.equal(rows(world, 'a').length, 1)
  assert.equal(rows(world, 'b').length, 1)
  assert.equal(rows(world, 'c').length, 0, '不相关的人没被写')
})

test('R497：同一天同一件事重写是幂等的，正反方向同一个 id，不同的事另算一条', () => {
  const world = makeWorld(100)
  const first = promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })
  const again = promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })
  assert.equal(again.id, first.id)
  assert.equal(rows(world, 'a').length, 1, '重复解析不会写出第二条')

  const reversed = promiseBetween(world, 'b', 'a', { what: '一起吃饭', dueTick: 1300 })
  assert.equal(reversed.id, first.id, '当事人顺序不影响 id')
  assert.equal(rows(world, 'b').length, 1)

  const another = promiseBetween(world, 'a', 'b', { what: '一起看片', dueTick: 1300 })
  assert.notEqual(another.id, first.id)
  assert.equal(rows(world, 'a').length, 2)
})

test('R497：id 稳定可复现（同输入同 id，不用随机与时钟）', () => {
  assert.equal(commitmentId('a', 'b', '一起吃饭', 3), commitmentId('a', 'b', '一起吃饭', 3))
  assert.equal(commitmentId('a', 'b', '一起吃饭', 3), commitmentId('b', 'a', '一起吃饭', 3))
  assert.notEqual(commitmentId('a', 'b', '一起吃饭', 3), commitmentId('a', 'b', '一起吃饭', 4))
})

test('R497：非法约定返回 null，不写半条', () => {
  const world = makeWorld(100)
  assert.equal(promiseBetween(world, 'a', 'ghost', { what: '一起吃饭', dueTick: 1300 }), null, '对方不存在')
  assert.equal(promiseBetween(world, 'a', 'a', { what: '和自己吃饭', dueTick: 1300 }), null, '自己对自己')
  assert.equal(promiseBetween(world, 'a', 'b', { what: '   ', dueTick: 1300 }), null, '空 what')
  assert.equal(promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 100 }), null, 'dueTick 不在将来')
  assert.equal(promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: Number.NaN }), null, 'NaN')
  assert.equal(rows(world, 'a').length, 0)
  assert.equal(rows(world, 'b').length, 0, '没写出对方那条')
})

test('R497：source 可覆盖（玩家开口的约定）', () => {
  const world = makeWorld(100)
  const written = promiseBetween(world, 'a', 'b', { what: '帮我修车', dueTick: 900, source: 'player' })
  assert.equal(written.mine.source, 'player')
  assert.equal(written.theirs.source, 'player')
})

test('R497：窗口内有交集 → kept（双方一起，裁决只有一种结果）', () => {
  const world = makeWorld(100)
  const written = promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })
  world.agents[0].episodes = [episodeWith(1290, 'b')]

  const settled = settleCommitments(world, 1301)
  assert.equal(settled.length, 1, '一个约定只裁决一次')
  assert.deepEqual(settled[0].pair, ['a', 'b'])
  assert.equal(settled[0].status, 'kept')
  assert.equal(rowById(world, 'a', written.id).status, 'kept')
  assert.equal(rowById(world, 'b', written.id).status, 'kept', '对方那条同步 kept')
})

test('R513：到期没证据先保持 open，宽限用完仍没证据才判 missed', () => {
  const world = makeWorld(100)
  const written = promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })

  assert.deepEqual(settleCommitments(world, 1301), [], '刚过到期、没证据：不判 missed')
  assert.deepEqual(settleCommitments(world, 1300 + MISS_GRACE_TICKS), [], '宽限右端还在等')
  assert.equal(rowById(world, 'a', written.id).status, 'open', '宽限期内保持 open')
  assert.equal(rowById(world, 'b', written.id).status, 'open')

  const settled = settleCommitments(world, 1300 + MISS_GRACE_TICKS + 1)
  assert.equal(settled.length, 1)
  assert.equal(settled[0].status, 'missed', '两个宽限都用完仍无证据才判 missed')
  assert.equal(rowById(world, 'a', written.id).status, 'missed')
  assert.equal(rowById(world, 'b', written.id).status, 'missed')

  assert.deepEqual(settleCommitments(world, 1300 + MISS_GRACE_TICKS + 2), [], '已裁决的不再重复判')
})

test('R513：宽限期内出现证据立刻判 kept（不等宽限结束，也不再翻成 missed）', () => {
  const world = makeWorld(100)
  const written = promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })

  assert.deepEqual(settleCommitments(world, 1310), [], '到期后还没证据')

  world.agents[0].episodes = [episodeWith(1320, 'b')] // 过了点才碰上，仍在宽限内
  const settled = settleCommitments(world, 1321)
  assert.equal(settled.length, 1, '这一 tick 就裁决，不等到宽限结束')
  assert.equal(settled[0].status, 'kept')
  assert.equal(rowById(world, 'a', written.id).status, 'kept')
  assert.equal(rowById(world, 'b', written.id).status, 'kept')

  assert.deepEqual(settleCommitments(world, 1300 + MISS_GRACE_TICKS + 100), [], 'kept 是终局')
  assert.equal(rowById(world, 'a', written.id).status, 'kept')
})

test('R497：到期当 tick 不判，更早也不判', () => {
  const world = makeWorld(100)
  const written = promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })
  assert.deepEqual(settleCommitments(world, 1200), [])
  assert.deepEqual(settleCommitments(world, 1300), [], 'dueTick === now 不算过期')
  assert.equal(rowById(world, 'a', written.id).status, 'open')
})

test('R497：还在忙不算违约——忙碌宽限先顺延，两个宽限都用完才裁决', () => {
  const world = makeWorld(100)
  const written = promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })
  meetActivity(world, 'a', 'pmeet', 1290)

  assert.deepEqual(settleCommitments(world, 1301), [], '刚过到期，人在忙，先顺延')
  assert.deepEqual(
    settleCommitments(world, 1300 + MISS_GRACE_TICKS),
    [],
    '忙碌宽限窗口内（含右端）继续等',
  )
  assert.equal(rowById(world, 'a', written.id).status, 'open', '顺延期间不动状态')

  assert.deepEqual(
    settleCommitments(world, 1300 + MISS_GRACE_TICKS),
    [],
    '忙完之后还有失约宽限，仍保持 open',
  )
  const settled = settleCommitments(world, 1300 + MISS_GRACE_TICKS + 1)
  assert.equal(settled.length, 1)
  assert.equal(settled[0].status, 'missed', '宽限用完仍无证据才判 missed')
})

test('R497：同地点 meet 活动重叠算碰过面；不同地点不算', () => {
  const world = makeWorld(100)
  const written = promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })
  meetActivity(world, 'a', 'pmeet', 1200, 1250)
  meetActivity(world, 'b', 'pmeet', 1230, 1260)

  const settled = settleCommitments(world, 1301)
  assert.equal(settled[0].status, 'kept', '到期当 tick 之后立刻裁决，不用等宽限')
  assert.equal(rowById(world, 'b', written.id).status, 'kept')

  const elsewhere = makeWorld(100)
  const other = promiseBetween(elsewhere, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })
  meetActivity(elsewhere, 'a', 'pmeet', 1200, 1250)
  meetActivity(elsewhere, 'b', 'pcafe', 1230, 1260)
  assert.equal(settleCommitments(elsewhere, 1300 + MISS_GRACE_TICKS + 1)[0].status, 'missed')
  assert.equal(rowById(elsewhere, 'a', other.id).status, 'missed')
})

test('R513：宽限之外的迟到见面不算证据（不能倒填成守约）', () => {
  const world = makeWorld(100)
  const written = promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })
  world.agents[0].episodes = [episodeWith(1300 + MISS_GRACE_TICKS + 5, 'b')]

  const settled = settleCommitments(world, 1300 + MISS_GRACE_TICKS + 10)
  assert.equal(settled[0].status, 'missed', '宽限之后的见面不能倒填成守约')
  assert.equal(rowById(world, 'a', written.id).status, 'missed')
})

test('R497：显式 keepCommitment 是第二类证据，且只有当事人能标', () => {
  const world = makeWorld(100)
  const written = promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })

  assert.equal(keepCommitment(world, 'c', written.id), false, '不相关的人不能替人守约')
  assert.equal(rowById(world, 'a', written.id).status, 'open')

  assert.equal(keepCommitment(world, 'a', written.id), true)
  assert.equal(rowById(world, 'a', written.id).status, 'kept')
  assert.equal(rowById(world, 'b', written.id).status, 'kept')
  assert.equal(keepCommitment(world, 'a', written.id), false, '重复调用安全')
  assert.deepEqual(
    settleCommitments(world, 1300 + MISS_GRACE_TICKS + 100),
    [],
    '已 kept 的不再判 missed',
  )
})

test('R497：每人同时 open ≤3，超出时最旧的一条双方一起 released', () => {
  const world = makeWorld(10)
  const ids = []
  for (const [index, what] of ['一起吃饭', '一起看片', '一起散步', '一起跑步'].entries()) {
    world.tick = 10 + index * 5
    ids.push(promiseBetween(world, 'a', 'b', { what, dueTick: 500 + index }).id)
  }

  const mine = rows(world, 'a')
  assert.equal(mine.length, 4, '被挤掉的那条不是删除，而是留痕')
  assert.equal(mine.filter((row) => row.status === 'open').length, OPEN_MAX)
  assert.equal(rowById(world, 'a', ids[0]).status, 'released', '最旧的一条让位')
  assert.equal(rowById(world, 'b', ids[0]).status, 'released', '双方一起作废，不是单方面赖账')
  assert.equal(rowById(world, 'a', ids[3]).status, 'open')

  const settled = settleCommitments(world, 1000)
  assert.equal(settled.length, OPEN_MAX, 'released 的不参与裁决')
  assert.ok(settled.every((item) => item.id !== ids[0]))
})

test('R497：已裁决的旧承诺会被裁剪，open 的永远留着', () => {
  const world = makeWorld(100)
  const written = promiseBetween(world, 'a', 'b', { what: '一起吃饭', dueTick: 1300 })
  const judgedAt = 1300 + MISS_GRACE_TICKS + 1
  assert.equal(settleCommitments(world, judgedAt)[0].status, 'missed')
  assert.equal(rows(world, 'a').length, 1)

  settleCommitments(world, judgedAt + SETTLED_KEEP_DAYS * DAY_TICKS + 5)
  assert.equal(rows(world, 'a').length, 0, '过期多天的裁决滚出存档')
  assert.equal(rowById(world, 'b', written.id), undefined)

  const fresh = makeWorld(100)
  promiseBetween(fresh, 'a', 'b', { what: '一起吃饭', dueTick: 1300 + 30 * DAY_TICKS })
  settleCommitments(fresh, judgedAt + SETTLED_KEEP_DAYS * DAY_TICKS + 5)
  assert.equal(rows(fresh, 'a').length, 1, '还没到期的 open 不会被裁掉')
})
