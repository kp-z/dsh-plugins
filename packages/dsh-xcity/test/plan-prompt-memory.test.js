/**
 * R524：计划提示词要带「你还记得」——昨天以前那几条**相关**记忆。
 *
 * 现场：06:30 生成计划时，模型只看得到「昨天你怎么过的」一句和「今天已经发生的事」
 * （典型作息 23:00–07:00 在睡觉，后者基本是空的）。上周做过什么、跟谁一起做成的，
 * 只在对话里检索得到（`bridge/memory-context.ts` 的 Top-K），安排今天时读不到。
 *
 * 这里钉住三件事：段落在哪（昨天之后、今天之前）、挑几条（≤5、日小结不算）、
 * 以及同样的世界状态永远拼出同一段话（没有随机）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_PLAN_MEMORIES, buildPlanPrompt, planMemories } from '../lib/bridge/plan-prompt.js'
import { selectEpisodes } from '../lib/sim/memory.js'

const DAY = 1440
/** 06:30：每日计划被问的那一刻（第 4 天）。 */
const NOW = 3 * DAY + 6 * 60 + 30

const BASE = {
  agentName: '小蓝',
  persona: '角色：engineer',
  todaySummary: ['06:00–06:20 在仓库干活'],
  knownPeers: [{ id: 'agent-1', name: '阿金' }],
  nowTick: NOW,
}

/** 一条情节（字段与 `sim/memory.ts` 的 `episodeOfActivity` 同形）。 */
const episode = (day, summary, kind = 'work', salience = 0.3) => ({
  tick: (day - 1) * DAY + 10 * 60,
  day,
  kind,
  summary,
  with: [],
  placeId: 'station.desk-a',
  salience,
})

/** 接的就是 index.ts 里那条路：`planMemories` + `sim/memory.ts` 的 `selectEpisodes`。 */
const memoriesOf = (episodes) => planMemories({ episodes, nowTick: NOW, selectEpisodes })

/** 两条日小结（最新最显眼——没按 kind 跳过的话必然入选）+ 六条真事。 */
const EPISODES = [
  episode(3, '第3天：干活×2、和人聊了聊×1', 'day', 0.9),
  episode(2, '第2天：吃了顿饭×2、干活×3', 'day', 0.9),
  episode(2, '把仓库的账理清了', 'work', 0.6),
  episode(2, '和阿金一起巡了趟街', 'meet', 0.6),
  episode(1, '写完了排班表', 'study', 0.4),
  episode(1, '把货架补满', 'work', 0.4),
  episode(1, '在食堂吃了顿饭', 'meal', 0.4),
  episode(1, '睡了一觉', 'sleep', 0.4),
]

test('R524：有记忆就给「你还记得」，位置在昨天之后、今天之前', () => {
  const text = buildPlanPrompt({
    ...BASE,
    yesterday: '第3天：干活×2、和人聊了聊×1',
    memories: ['第2天：把仓库的账理清了', '第1天：和阿金一起巡了趟街'],
  })

  assert.ok(text.includes('## 你还记得'))
  assert.ok(text.includes('- 第2天：把仓库的账理清了'), '每条一行，前缀是 "- "')
  assert.ok(text.includes('- 第1天：和阿金一起巡了趟街'))

  const yesterday = text.indexOf('## 昨天你怎么过的')
  const remember = text.indexOf('## 你还记得')
  const today = text.indexOf('## 今天已经发生的事')
  assert.ok(yesterday >= 0 && remember > yesterday, '记忆段必须在昨天段之后')
  assert.ok(today > remember, '记忆段必须在今天段之前')
})

test('R524：没有记忆就整段省略（不输出空标题）', () => {
  const bare = buildPlanPrompt(BASE)
  assert.equal(bare.includes('你还记得'), false, '不传 memories 时不许出现这段')

  const empty = buildPlanPrompt({ ...BASE, memories: [] })
  assert.equal(empty.includes('你还记得'), false, '传空数组时整段省略')
  assert.equal(empty, bare, '传空数组与不传必须拼出同一段话')

  assert.deepEqual(planMemories({ episodes: [], nowTick: NOW, selectEpisodes }), [], '一条情节都没有时选不出东西')
})

test('R524：最多 5 条，且日小结（kind=day）不算——昨天已经单独给过', () => {
  const lines = memoriesOf(EPISODES)

  assert.equal(lines.length, MAX_PLAN_MEMORIES, '候选够时应取满上限，实际 ' + String(lines.length))
  assert.ok(lines.length <= 5, '不许超过 5 条')

  for (const line of lines) {
    assert.match(line, /^第\d+天：/, '每条都要写成「第N天：…」：' + line)
    assert.equal(line.includes('×'), false, '日小结（形如「干活×2」）不该进这份清单：' + line)
  }

  // 渲染进提示词里也正好是 5 行「- 」。
  const text = buildPlanPrompt({ ...BASE, memories: lines })
  const section = text.slice(text.indexOf('## 你还记得'), text.indexOf('## 今天已经发生的事'))
  const bullets = section.split('\n').filter((row) => row.startsWith('- '))
  assert.equal(bullets.length, MAX_PLAN_MEMORIES)
})

test('R524：同一份记忆永远挑出同样的几条、拼出同一段话（没有随机）', () => {
  assert.deepEqual(memoriesOf(EPISODES), memoriesOf(EPISODES), '选择必须是确定的')

  const once = buildPlanPrompt({ ...BASE, yesterday: '第3天：干活×2', memories: memoriesOf(EPISODES) })
  const twice = buildPlanPrompt({ ...BASE, yesterday: '第3天：干活×2', memories: memoriesOf(EPISODES) })
  assert.equal(once, twice, '同样的输入必须拼出同样的提示词')
})

test('R524-2：同一句记忆只留一条（重复派单不该占满 5 个名额）', () => {
  const episodes = [
    { tick: 400, day: 4, kind: 'task', summary: '工单「检查走廊的应急灯是否亮」做完了', with: [], placeId: 'p', salience: 0.6 },
    { tick: 300, day: 4, kind: 'task', summary: '工单「检查走廊的应急灯是否亮」做完了', with: [], placeId: 'p', salience: 0.6 },
    { tick: 200, day: 3, kind: 'task', summary: '工单「检查走廊的应急灯是否亮」做完了', with: [], placeId: 'p', salience: 0.6 },
    { tick: 100, day: 3, kind: 'social', summary: '守约：答应阿金的「对一遍工单」兑现了', with: ['agent-2'], placeId: 'p', salience: 0.55 },
  ]
  const lines = planMemories({ episodes, nowTick: 500, selectEpisodes })
  assert.equal(lines.length, 2, JSON.stringify(lines))
  assert.ok(lines.some((line) => line.includes('检查走廊的应急灯')), JSON.stringify(lines))
  assert.ok(lines.some((line) => line.includes('守约')), JSON.stringify(lines))
})

