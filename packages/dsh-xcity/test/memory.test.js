import assert from 'node:assert/strict'
import test from 'node:test'

import { DAY_TICKS, EPISODE_KEEP_DAYS, appendEpisode, dayOf, episodeOfActivity, pruneEpisodes, recordActivityEpisode, scoreEpisode, selectEpisodes } from '../lib/sim/memory.js'

const ep = (tick, summary, salience = 0.3, kind = 'work') => ({ tick, day: dayOf(tick), kind, summary, with: [], placeId: 'place:office', salience })

test('R497：按天裁剪只留最近 7 天，且不改变原数组', () => {
  const list = [ep(DAY_TICKS * 1, '第一天'), ep(DAY_TICKS * 5, '第五天'), ep(DAY_TICKS * 9, '第九天')]
  const kept = pruneEpisodes(list, DAY_TICKS * 9)
  assert.deepEqual(kept.map((x) => x.summary), ['第五天', '第九天'])
  assert.equal(list.length, 3, '纯函数，不许就地改')
  assert.equal(EPISODE_KEEP_DAYS, 7)
})

test('R497：appendEpisode 就地滚动，老档没有 episodes 也能开始记', () => {
  const agent = { id: 'a', episodes: undefined }
  for (let day = 1; day <= 9; day++) appendEpisode(agent, ep(DAY_TICKS * day + 100, 'd' + day))
  assert.equal(agent.episodes.length, 7)
  assert.equal(agent.episodes[0].summary, 'd3', '第八天的世界不该还留着第一天')
})

test('R497：近因 —— 同样重要时，新的排在前面', () => {
  const list = [ep(DAY_TICKS * 1, '旧事'), ep(DAY_TICKS * 6, '新事')]
  assert.deepEqual(selectEpisodes(list, { nowTick: DAY_TICKS * 6, k: 2 }).map((x) => x.summary), ['新事', '旧事'])
})

test('R497：关键词命中能压过时间，但不会凭空编造', () => {
  const list = [ep(DAY_TICKS * 1, '完成了工单「补测试」', 0.9), ep(DAY_TICKS * 6, '吃了顿饭', 0.3)]
  assert.equal(selectEpisodes(list, { nowTick: DAY_TICKS * 6, query: '工单', k: 1 })[0].summary, '完成了工单「补测试」')
  assert.equal(scoreEpisode(list[0], { nowTick: DAY_TICKS * 6, query: '工单' }) > scoreEpisode(list[0], { nowTick: DAY_TICKS * 6 }), true)
  assert.equal(selectEpisodes(list, { nowTick: DAY_TICKS * 6, query: '量子', k: 2 }).length, 2, '查不到就按近因返回，不是空')
})

test('R497：k=0 返回空；同分按 tick 降序保证确定性', () => {
  const list = [ep(10, 'a'), ep(20, 'b')]
  assert.deepEqual(selectEpisodes(list, { nowTick: 20, k: 0 }), [])
  const a = selectEpisodes(list, { nowTick: 20, k: 2 }).map((x) => x.summary)
  const b = selectEpisodes(list, { nowTick: 20, k: 2 }).map((x) => x.summary)
  assert.deepEqual(a, b)
})

test('R497：单个词命中压不过"刚完成且重要"（权重回归）', () => {
  const oldMeal = ep(DAY_TICKS * 0, '吃了顿饭', 0.3, 'meal')
  const freshTask = ep(DAY_TICKS * 6, '做完了工单「补测试」', 0.9, 'work')
  const picked = selectEpisodes([oldMeal, freshTask], { nowTick: DAY_TICKS * 6 + 10, query: '吃', k: 1 })
  assert.equal(picked[0].summary, '做完了工单「补测试」')
})

test('R497：中文长查询按二字组命中，不是整串失配', () => {
  const list = [ep(DAY_TICKS * 3, '做完了工单「补测试」', 0.9)]
  assert.equal(selectEpisodes(list, { nowTick: DAY_TICKS * 3, query: '补测试的工单', k: 1 }).length, 1)
  assert.ok(scoreEpisode(list[0], { nowTick: DAY_TICKS * 3, query: '补测试的工单' }) > scoreEpisode(list[0], { nowTick: DAY_TICKS * 3 }))
})

test('R497：桥的 idle 活动不写成"完成"；短打断也不记', () => {
  const agent = { id: 'a', episodes: [] }
  const world = { agents: [agent] }
  const idle = { id: 'act-9', agentId: 'a', kind: 'rest', placeId: 'p', stationId: null, status: 'completed', startedAt: 0 }
  recordActivityEpisode(world, idle, 30)
  assert.equal(agent.episodes.length, 0, '没有 purpose 也没有工单代次 → 不是真做过的事')
  const short = { ...idle, purpose: 'meal', status: 'interrupted' }
  recordActivityEpisode(world, short, 5, 'interrupted')
  assert.equal(agent.episodes.length, 0, '不到 15 tick 的打断是噪音')
  recordActivityEpisode(world, short, 20, 'interrupted')
  assert.equal(agent.episodes.length, 1)
  assert.equal(agent.episodes[0].summary, '没做完：吃了顿饭')
  assert.equal(agent.episodes[0].salience, 0.2)
})

test('R497：活动 → 记忆，只写真实字段；工单最值得记', () => {
  const task = episodeOfActivity({ id: 'act-1', agentId: 'a', kind: 'work', placeId: 'place:office', stationId: 's1', status: 'completed', startedAt: 10, trigger: { kind: 'task', text: '开始执行工单「补测试」' } }, 100)
  assert.equal(task.salience, 0.9)
  assert.equal(task.summary, '工单「补测试」', '完成态不能照抄触发文案的将来时')
  const meet = episodeOfActivity({ id: 'act-3', agentId: 'a', kind: 'meet', purpose: 'social', placeId: 'p', stationId: null, status: 'completed', startedAt: 0 }, 100)
  assert.equal(meet.summary, '和人聊了聊', '不能出现「和人一起和人聊了聊」')
  assert.equal(task.day, 1)
  const meal = episodeOfActivity({ id: 'act-2', agentId: 'a', kind: 'rest', purpose: 'meal', placeId: 'place:office', stationId: null, status: 'completed', startedAt: 10 }, 100)
  assert.equal(meal.summary, '吃了顿饭')
  assert.equal(meal.salience, 0.3)
})
