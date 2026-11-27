import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MEMORY_CONTEXT_MAX_CHARS,
  MEMORY_OPEN_COMMITMENTS,
  MEMORY_RECALL_K,
  renderMemoryContext,
} from '../lib/bridge/memory-context.js'
// 打分与 Top-K 由调用方注入（bridge 不许 import sim，见 protocol/boundaries.ts）。
// 测试里注入的就是真实实现——"渲染器没有第二套打分"因此是被证明的，不是被声明的。
import { scoreEpisode, selectEpisodes } from '../lib/sim/memory.js'

const DAY = 1440
/** 一条情节记忆（字段与 domain/types.ts 的 Episode 一致）。 */
const episode = (tick, summary, salience = 0.3, kind = 'work') => ({
  tick,
  day: Math.floor(tick / DAY) + 1,
  kind,
  summary,
  with: [],
  placeId: 'office',
  salience,
})
/** 一条承诺（字段与 domain/types.ts 的 Commitment 一致）。 */
const commitment = (id, what, dueTick, status = 'open', withId = 'agent-2') => ({
  id,
  with: withId,
  what,
  dueTick,
  status,
  source: 'plan',
  createdAtTick: 0,
})
/** 默认走真实打分。 */
const build = (episodes, commitments, nowTick, recall = { selectEpisodes, scoreEpisode }) =>
  renderMemoryContext({ episodes, commitments, nowTick, ...recall })
const render = (episodes, commitments, nowTick) => build(episodes, commitments, nowTick)
const countLines = (text, prefix) => text.split('\n').filter((line) => line.startsWith(prefix)).length

// ---------------------------------------------------------------- 空输入

test('R505：没有任何记忆与承诺 → 空串，不输出「无」这种废话', () => {
  assert.equal(render([], [], 600), '')

  // 只带已结算（kept/missed/released）的承诺，同样算"没有内容"。
  const settled = [
    commitment('c1', '去看仓库', 900, 'kept'),
    commitment('c2', '对账', 1200, 'missed'),
    commitment('c3', '搬货', 1500, 'released'),
  ]
  assert.equal(render([], settled, 600), '')
})

test('R505：只有承诺没有记忆时，不出现空的「你记得」标题', () => {
  const text = render([], [commitment('c1', '一起看仓库', DAY + 15 * 60)], 600)

  assert.ok(!text.includes('你记得'), '没有记忆就不该有这段标题')
  assert.equal(text, '你答应过：\n- 第2天 15:00 前，和 agent-2：一起看仓库')
})

// ---------------------------------------------------------------- 正常渲染

test('R505：先「你记得」再「你答应过」；记忆按时间顺序、带第几天与时刻', () => {
  const text = render(
    // 故意把新的放前面，验证渲染会按时间重排。
    [episode(DAY + 380, '跑了趟工地'), episode(380, '吃了顿饭')],
    [commitment('c1', '一起看仓库', DAY + 18 * 60)],
    DAY + 12 * 60,
  )

  assert.equal(text, [
    '你记得：',
    '- 第1天 06:20 吃了顿饭',
    '- 第2天 06:20 跑了趟工地',
    '',
    '你答应过：',
    '- 第2天 18:00 前，和 agent-2：一起看仓库',
  ].join('\n'))
  // 给模型读的是人话，不是 JSON。
  assert.ok(!text.trimStart().startsWith('['))
  assert.ok(!text.includes('undefined'))
})

test('R505：日小结用它自己那句，不重复天数，也不编一个 00:00 的时刻', () => {
  const digest = episode(2 * DAY, '第2天：吃了顿饭×2、干活×3', 0.5, 'day')
  const text = render([digest], [], 2 * DAY + 30)

  assert.equal(text, '你记得：\n- 第2天：吃了顿饭×2、干活×3')
  assert.ok(!text.includes('00:00'), '日小结的 tick 是当天 0 点，不该被当成事件时刻')
})

test('R505：一次最多回忆 K 条（同分取新的）', () => {
  const episodes = Array.from({ length: 10 }, (_, i) => episode(DAY + (i + 1) * 60, '第' + String(i + 1) + '件事'))

  const text = render(episodes, [], DAY + 600)

  assert.equal(countLines(text, '- '), MEMORY_RECALL_K)
  assert.ok(text.includes('第10件事'), '最近的必须在')
  assert.ok(!text.includes('第1件事'), '最早的四条进不了 Top-K')
})

// ---------------------------------------------------------------- 承诺

test('R505：承诺只列 open、最多 3 条，到期早的在前', () => {
  const commitments = [
    commitment('c1', '甲答应的事', DAY + 60),
    commitment('c2', '乙已过期的事', DAY + 120, 'missed'),
    commitment('c3', '丙答应的事', DAY + 180),
    commitment('c4', '丁答应的事', DAY + 240),
    commitment('c5', '戊答应的事', DAY + 300),
  ]

  const text = render([], commitments, DAY + 30)
  const lines = text.split('\n').filter((line) => line.startsWith('- '))

  assert.equal(lines.length, MEMORY_OPEN_COMMITMENTS)
  assert.deepEqual(
    lines.map((line) => line.slice(line.indexOf('：') + 1)),
    ['甲答应的事', '丙答应的事', '丁答应的事'],
  )
  assert.ok(!text.includes('乙'), 'missed 的不再算"答应过"')
  assert.ok(!text.includes('戊'), '超出上限的那条被丢')
})

test('R505：with 为空 = 自己一个人，不硬凑一个「和 ：」', () => {
  const text = render([], [commitment('c1', '把手上的活收尾', DAY + 60, 'open', '')], DAY)

  assert.equal(text, '你答应过：\n- 第2天 01:00 前：把手上的活收尾')
})

// ---------------------------------------------------------------- 预算

test('R505：超 400 字先丢分数最低的记忆，高的留下', () => {
  const long = (marker) => marker + '，' + '走访了三处工地并记录问题'.repeat(5)
  const episodes = [
    episode(DAY + 60, long('最重要的'), 0.9),
    episode(DAY + 120, long('次重要'), 0.6),
    episode(DAY + 180, long('一般'), 0.3),
    episode(DAY + 240, long('很一般'), 0.25),
    episode(DAY + 300, long('偏不重要'), 0.2),
    episode(DAY + 360, long('最不重要'), 0.1),
  ]

  const text = render(episodes, [], DAY + 400)

  assert.ok(text.length <= MEMORY_CONTEXT_MAX_CHARS, '实际 ' + String(text.length) + ' 字')
  assert.ok(text.includes('最重要的'), '高分记忆必须留下')
  assert.ok(!text.includes('最不重要'), '低分记忆先被丢')
  assert.ok(text.length > MEMORY_CONTEXT_MAX_CHARS - 100, '不该一次丢光（只该丢几条）')
})

test('R505：预算不够时先丢记忆，承诺一条都不丢', () => {
  const long = (marker) => marker + '，' + '把仓库三排货架全部重数了一遍'.repeat(4)
  const episodes = Array.from({ length: 6 }, (_, i) => episode(DAY + (i + 1) * 60, long('第' + String(i + 1) + '段记忆'), 0.3))
  const commitments = [
    commitment('c1', '甲答应的事', DAY + 600),
    commitment('c2', '乙答应的事', DAY + 660),
    commitment('c3', '丙答应的事', DAY + 720),
  ]

  const text = render(episodes, commitments, DAY + 400)

  assert.ok(text.length <= MEMORY_CONTEXT_MAX_CHARS, '实际 ' + String(text.length) + ' 字')
  for (const line of ['甲答应的事', '乙答应的事', '丙答应的事']) {
    assert.ok(text.includes(line), '承诺不能被记忆挤掉：' + line)
  }
  assert.ok(countLines(text, '- ') < 6 + 3, '确实丢了记忆')
})

test('R505：只剩承诺也超预算时，丢最晚到期的那条（最早的留到最后）', () => {
  const big = '答应的事'.repeat(50)
  const commitments = [
    commitment('c1', '甲' + big, DAY + 60),
    commitment('c2', '乙' + big, DAY + 120),
    commitment('c3', '丙' + big, DAY + 180),
  ]

  const text = render([], commitments, DAY)

  assert.ok(text.length <= MEMORY_CONTEXT_MAX_CHARS, '实际 ' + String(text.length) + ' 字')
  assert.equal(countLines(text, '- '), 1)
  assert.ok(text.includes('甲'))
  assert.ok(!text.includes('乙') && !text.includes('丙'), '先丢最晚到期的那条')
})

test('R505：400 字按字符算，不按 UTF-8 字节算', () => {
  // 六条中文记忆：字符数小于 400，字节数大于 400 —— 按字节裁就会误杀。
  const episodes = Array.from({ length: 6 }, (_, i) =>
    episode(DAY + (i + 1) * 60, '第' + String(i + 1) + '件事' + '乙'.repeat(40), 0.3))

  const text = render(episodes, [], DAY + 600)

  assert.ok(text.length <= MEMORY_CONTEXT_MAX_CHARS)
  assert.ok(Buffer.byteLength(text, 'utf8') > MEMORY_CONTEXT_MAX_CHARS, '这段字按字节早就超了')
  assert.equal(countLines(text, '- '), 6, '按字符算，六条都放得下')
})

// ---------------------------------------------------------------- 复用注入的打分

test('R505：谁先被丢由注入的打分决定（本文件没有第二套打分）', () => {
  const long = (marker) => marker + '，' + '走访了三处工地并记录问题'.repeat(12)
  const episodes = [
    episode(DAY + 60, long('最早的'), 0.9),
    episode(DAY + 120, long('中间的'), 0.9),
    episode(DAY + 180, long('最新的'), 0.9),
  ]
  // 故意注入一个「越早分越高」的反向打分：真打分（近因）会保最早的，这里必须反而丢它。
  const text = build(episodes, [], DAY + 400, {
    selectEpisodes: (rows) => [...rows],
    scoreEpisode: (row) => row.tick,
  })

  assert.ok(text.length <= MEMORY_CONTEXT_MAX_CHARS, '实际 ' + String(text.length) + ' 字')
  assert.ok(!text.includes('最早的'), '分数由注入的函数给，不是本文件自己算的')
  assert.ok(text.includes('最新的'))
})

// ---------------------------------------------------------------- 纯函数

test('R505：同一输入两次结果完全一致（没有随机数、没有读时钟）', () => {
  const input = {
    episodes: [episode(DAY + 60, '跑了趟工地', 0.9), episode(DAY + 120, '吃了顿饭')],
    commitments: [commitment('c1', '一起看仓库', DAY + 600), commitment('c2', '对账', DAY + 400)],
    nowTick: DAY + 300,
    selectEpisodes,
    scoreEpisode,
  }

  assert.equal(renderMemoryContext(input), renderMemoryContext(input))
  // 入参不被就地改动（调用方还要拿它继续用）。
  assert.equal(input.episodes.length, 2)
  assert.deepEqual(input.commitments.map((row) => row.id), ['c1', 'c2'])
})

test('R505：承诺里显示人名，不是 agent-2', () => {
  const text = renderMemoryContext({
    episodes: [],
    commitments: [commitment('c1', '一起吃早饭', 900)],
    nowTick: 100,
    selectEpisodes,
    scoreEpisode,
    nameOf: (id) => (id === 'agent-2' ? '小蓝' : id),
  })
  assert.ok(text.includes('和 小蓝：一起吃早饭'), text)
  assert.equal(text.includes('agent-2'), false)
})

test('R505：不传 nameOf 时退回 id（老调用方不炸）', () => {
  const text = render([], [commitment('c1', '一起对进度', 900)], 100)
  assert.ok(text.includes('agent-2'))
})
