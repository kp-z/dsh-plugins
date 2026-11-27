/**
 * R520：存档体积预算。
 *
 * 守五件事：
 * 1. 没超预算一个字节都不许动（预算不是"每次保存都裁一点"）；
 * 2. 超了就一定裁回预算内，且不会把情节全裁光；
 * 3. 日小结（kind==='day'）永远在——它是那一天唯一的一句话摘要，裁了再也算不出来；
 *    承诺、任务、站点一概不动；
 * 4. 确定性：同样的世界裁两次得到同样的结果（不随机、不依赖插入顺序以外的运气）；
 * 5. 空世界 / 只剩日小结也不炸、不空转。
 *
 * 外加一条**接线**测试：保存路径真的调了它（函数写好了没人调，是这类补丁最常见的死法）。
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { resolveConfig } from '../lib/config.js'
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createRuntime } from '../lib/runtime/index.js'
import { createWorldStore } from '../lib/store/index.js'
import {
  SNAPSHOT_BUDGET_BYTES,
  snapshotBytes,
  trimToSnapshotBudget,
} from '../lib/sim/memory.js'
import { createPluginState } from '../lib/state.js'
import { createWorld } from '../lib/world/create.js'

const content = new ContentRegistry()
content.loadAll(builtinPacks())
const OFFICE = { id: 'place:office.tech_company_1', name: 'Office', asset: 'company', spawn: { x: 480, z: 800 } }

const tempDirs = []
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

const episode = (tick, summary, kind = 'work') => ({
  tick,
  day: Math.floor(Math.max(0, tick) / 1440) + 1,
  kind,
  summary,
  with: [],
  placeId: OFFICE.id,
  salience: 0.3,
})

/** 一条"占地方"的情节：体积要真的能超预算，摘要就不能太短。 */
const fatEpisode = (tick, index) => episode(tick, '第' + String(index) + '条：' + '干活'.repeat(60))

function makeWorld(agentCount = 3) {
  return createWorld({
    content,
    scene: 'scene.office',
    name: 'budget',
    createdAt: '2026-01-01T00:00:00.000Z',
    maxAgents: agentCount,
    places: [OFFICE],
  })
}

/** 给每个角色灌 n 条情节；返回总条数。 */
function flood(world, n) {
  let total = 0
  for (const [index, agent] of world.agents.entries()) {
    agent.episodes = Array.from({ length: n }, (_, i) => fatEpisode(index * 10000 + i, index * 10000 + i))
    total += n
  }
  return total
}

/**
 * 一个"裁得动"的预算：让基础世界（不含情节）占一半，情节占另一半。
 * 固定在两者之间，才能断言"裁得回去"而不是"怎么裁都超"。
 */
function budgetBetween(base, current) {
  return Math.floor((base + current) / 2)
}

test('R520：预算常量是 2 MiB（24 人平台实测约 1.2 MB 的两倍余量）', () => {
  assert.equal(SNAPSHOT_BUDGET_BYTES, 2 * 1024 * 1024)
})

test('R520：没超预算就一个字节都不动', () => {
  const world = makeWorld(2)
  world.agents[0].episodes = [episode(100, '干活'), episode(1440, '第1天：干活×1', 'day')]
  const before = snapshotBytes(world)
  assert.ok(before < SNAPSHOT_BUDGET_BYTES, '这个测试世界本身就该在预算内')

  const result = trimToSnapshotBudget(world, before)
  assert.equal(result.dropped, 0)
  assert.equal(result.bytes, before)
  assert.equal(world.agents[0].episodes.length, 2, '没超预算不许裁')
})

test('R520：超预算会裁到预算内，且不是把情节全裁光', () => {
  const world = makeWorld(3)
  const base = snapshotBytes(world)
  const total = flood(world, 300)
  const before = snapshotBytes(world)
  assert.ok(before > base * 2, '灌进去的情节得真的让体积涨起来，否则这个测试没意义')

  const budget = budgetBetween(base, before)
  const result = trimToSnapshotBudget(world, budget)

  assert.ok(result.dropped > 0, '超预算必须裁')
  assert.ok(result.bytes <= budget, '裁完必须回到预算内，实际 ' + String(result.bytes) + ' > ' + String(budget))
  assert.equal(result.bytes, snapshotBytes(world), '返回的字节数就是裁完世界的字节数')
  assert.ok(result.dropped < total, '不能一裁就全没了')
})

test('R520：日小结永远保留；承诺、任务、站点不动', () => {
  const world = makeWorld(2)
  const base = snapshotBytes(world)
  const [first, second] = world.agents
  first.episodes = [episode(1440, '第1天：干活×7', 'day'), ...Array.from({ length: 200 }, (_, i) => fatEpisode(i + 1, i))]
  second.episodes = [episode(1440, '第1天：开会×2', 'day'), ...Array.from({ length: 200 }, (_, i) => fatEpisode(i + 1, i))]
  first.commitments = [
    { id: 'cmt-1-' + second.id, with: second.id, what: '下午一起看片', dueTick: 99999, status: 'open', source: 'plan', createdAtTick: 500 },
  ]
  const tasksBefore = world.tasks.length
  const stationsBefore = world.stations.length

  const result = trimToSnapshotBudget(world, budgetBetween(base, snapshotBytes(world)))
  assert.ok(result.dropped > 0)

  assert.deepEqual(
    first.episodes.filter((item) => item.kind === 'day').map((item) => item.summary),
    ['第1天：干活×7'],
  )
  assert.deepEqual(
    second.episodes.filter((item) => item.kind === 'day').map((item) => item.summary),
    ['第1天：开会×2'],
  )
  assert.equal(first.commitments.length, 1, 'open 的承诺不许被裁掉')
  assert.equal(first.commitments[0].status, 'open')
  assert.equal(world.tasks.length, tasksBefore)
  assert.equal(world.stations.length, stationsBefore)
})

test('R520：确定性——同样的世界裁两次，结果逐条一致', () => {
  const world = makeWorld(4)
  const base = snapshotBytes(world)
  flood(world, 150)
  const budget = budgetBetween(base, snapshotBytes(world))

  const twin = JSON.parse(JSON.stringify(world))
  const first = trimToSnapshotBudget(world, budget)
  const second = trimToSnapshotBudget(twin, budget)

  assert.equal(first.dropped, second.dropped)
  assert.equal(first.bytes, second.bytes)
  assert.deepEqual(
    world.agents.map((agent) => (agent.episodes ?? []).map((item) => item.summary)),
    twin.agents.map((agent) => (agent.episodes ?? []).map((item) => item.summary)),
  )
})

test('R520：空世界不炸；只剩日小结时丢不动也不空转', () => {
  const empty = makeWorld(1)
  empty.agents = []
  const fetched = trimToSnapshotBudget(empty, 0)
  assert.equal(fetched.dropped, 0, '没有情节可裁')
  assert.ok(fetched.bytes > 0)

  const digestOnly = makeWorld(1)
  digestOnly.agents[0].episodes = [episode(1440, '第1天：睡觉×1', 'day')]
  const result = trimToSnapshotBudget(digestOnly, 0)
  assert.equal(result.dropped, 0, '日小结不在候选里，所以一条都丢不动')
  assert.equal(digestOnly.agents[0].episodes.length, 1)
})

test('R520：保存路径（deactivate 落盘）先裁再写，并在日志里说一声', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aw-budget-'))
  tempDirs.push(dir)
  const logs = []
  const state = createPluginState(resolveConfig({ autoStart: false, scene: 'scene.default-town' }), {
    storeDir: dir,
    initialAgents: 'captain',
    log: (line) => logs.push(line),
  })
  const world = state.activateSession('budget-session')
  // 灌到刚过预算：每条约 580 字节（含缩进），4200 条 ≈ 2.4 MB > 2 MiB。
  // 刻意不灌到几倍——要验的是"越线后裁回来"，不是"裁一个巨型世界要多久"。
  world.agents[0].episodes = Array.from({ length: 4200 }, (_, i) => fatEpisode(i, i))

  state.deactivate()

  const file = join(dir, 'sessions', encodeURIComponent('budget-session'), 'world.json')
  const raw = await readFile(file, 'utf8')
  const saved = JSON.parse(raw)

  // 预算管的是 world 那一段：裁完必须真的落在预算内（这条是硬断言）。
  assert.ok(
    snapshotBytes(saved.world) <= SNAPSHOT_BUDGET_BYTES,
    '落盘的 world 必须回到预算内，实际 ' + String(snapshotBytes(saved.world)) + ' 字节',
  )
  // 整个文件 = world + 外壳（内容包清单，实测约 5 KB，不随世界长大）。
  // 留 16 KB 只是给外壳与"32 条一量"的粒度留余量，不是给世界留的。
  assert.ok(
    Buffer.byteLength(raw) <= SNAPSHOT_BUDGET_BYTES + 16 * 1024,
    '整个存档文件也不该明显超过预算，实际 ' + String(Buffer.byteLength(raw)) + ' 字节',
  )
  assert.equal(logs.length, 1, '裁了就得说一声，而且只说一句')
  assert.match(logs[0], /裁掉 \d+ 条最老的情节/)
  assert.ok(saved.world.agents[0].episodes.length < 4200, '存档里的情节得真的少了')
})

/**
 * 真正在长的是这条：周期 checkpoint 每 100 tick 把**当前世界**写一遍。
 * 只接 state 的保存路径、不接这条，等于"关视图时裁一次，跑着的时候照旧无限长"。
 */
test('R520：运行时的 flush（周期 checkpoint 那条路）也先裁再写', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aw-budget-rt-'))
  tempDirs.push(dir)
  const state = createPluginState(resolveConfig({ autoStart: false, scene: 'scene.default-town' }), {
    initialAgents: 'captain',
  })
  const world = state.activateSession('rt-session')
  world.agents[0].episodes = Array.from({ length: 3800 }, (_, i) => fatEpisode(i, i))
  assert.ok(snapshotBytes(world) > SNAPSHOT_BUDGET_BYTES, '这个测试世界本身就该超预算')

  const logs = []
  const runtime = createRuntime({
    service: state,
    tickMs: 100,
    persist: {
      store: createWorldStore(dir),
      // 间隔设大：这一次落盘只可能来自 flush，测试不看节拍。
      checkpointEveryTicks: 100_000,
      log: (line) => logs.push(line),
    },
  })
  await runtime.flush()
  runtime.stop()

  const raw = await readFile(join(dir, 'world.json'), 'utf8')
  const saved = JSON.parse(raw)
  assert.ok(snapshotBytes(saved.world) <= SNAPSHOT_BUDGET_BYTES, '运行时写的快照也得在预算内')
  assert.equal(logs.length, 1)
  assert.match(logs[0], /裁掉 \d+ 条最老的情节/)
})
