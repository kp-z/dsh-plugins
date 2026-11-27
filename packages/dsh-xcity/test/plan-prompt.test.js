import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_PLAN_ITEMS, buildPlanPrompt, parsePlan } from '../lib/bridge/plan-prompt.js'

/** 06:30：每日计划被问的那一刻。 */
const TICK = 6 * 60 + 30

const PROMPT_INPUT = {
  agentName: '阿金',
  persona: '你在仓库当班，说话短，先看货再说话。',
  todaySummary: ['06:00–06:20 在仓库干活'],
  knownPeers: [{ id: 'agent-2', name: '小蓝' }],
  nowTick: TICK,
}

const PARSE_INPUT = { nowTick: TICK, agentId: 'agent-1', peerIds: ['agent-2', 'agent-3'] }

const codesOf = (result) => result.rejected.map((item) => item.code)

/** 一条形状完好的条目（各用例按需要覆盖字段）。 */
const item = (withId, what, due) => ({ with: withId, what, due })

// ---------------------------------------------------------------- R500-1 怎么问

test('R500-1：提示词写进了人名、人设、今天的记录、认识的人与当前时刻', () => {
  const prompt = buildPlanPrompt(PROMPT_INPUT)

  assert.match(prompt, /阿金/)
  assert.ok(prompt.includes(PROMPT_INPUT.persona), '人设原文要进去')
  assert.ok(prompt.includes('06:00–06:20 在仓库干活'), '今天的记录要进去')
  assert.ok(prompt.includes('agent-2：小蓝'), '认识的人要带 id 与名字')
  assert.ok(prompt.includes('现在是 06:30'), '要说清现在几点')
  assert.ok(prompt.includes('只输出一个 JSON 数组'), '必须要求只吐 JSON 数组')
  assert.ok(prompt.includes(String(MAX_PLAN_ITEMS) + ' 条'), '必须说清条数上限')
  assert.ok(prompt.includes('"due"'), '必须给出字段名')
  assert.ok(prompt.includes('HH:mm'), '必须说清 due 的格式')
  assert.ok(prompt.includes('[]'), '必须允许"今天不做"这个答案')
})

test('R500-1：没有记录、没有认识的人时也给得出提示词，示例的 with 是空字符串', () => {
  const prompt = buildPlanPrompt({ ...PROMPT_INPUT, todaySummary: [], knownPeers: [] })

  assert.ok(prompt.includes('（今天还没有任何记录）'))
  assert.ok(prompt.includes('（今天还没有认识的人）'))
  assert.ok(prompt.includes('"with":""'), '一个人都不认识时，示例必须是"自己一个人做"')
  assert.ok(!prompt.includes('undefined'), '缺数据不许漏出 undefined')
})

test('R500-1：示例用的是他认识的第一个人', () => {
  const prompt = buildPlanPrompt(PROMPT_INPUT)
  assert.ok(prompt.includes('"with":"agent-2"'))
})

// ---------------------------------------------------------------- R500-2 怎么取

test('R500-2：正常两条 → 两条承诺，字段齐全', () => {
  const text = JSON.stringify([item('agent-2', '一起去仓库看看', '15:00'), item('', '把欠的账理清', '18:00')])
  const result = parsePlan(text, PARSE_INPUT)

  assert.deepEqual(result.rejected, [])
  assert.equal(result.commitments.length, 2)

  const first = result.commitments[0]
  assert.deepEqual(first, {
    id: 'plan-agent-1-900-0',
    with: 'agent-2',
    what: '一起去仓库看看',
    dueTick: 15 * 60,
    status: 'open',
    source: 'plan',
    createdAtTick: TICK,
  })
  assert.equal(result.commitments[1].with, '', '空字符串 = 自己一个人做')
  assert.equal(result.commitments[1].dueTick, 18 * 60)
})

test('R500-2：代码围栏照样能取（不靠剥围栏，靠配平）', () => {
  const fence = String.fromCharCode(96, 96, 96)
  const text = '好的，我这样安排：\n\n' + fence + 'json\n' + JSON.stringify([item('agent-3', '聊一下排班', '09:00')]) + '\n' + fence + '\n'
  const result = parsePlan(text, PARSE_INPUT)

  assert.deepEqual(result.rejected, [])
  assert.equal(result.commitments.length, 1)
  assert.equal(result.commitments[0].with, 'agent-3')
})

test('R500-2：多余字段被忽略，不漏进承诺', () => {
  const text = JSON.stringify([{ with: '', what: '整理货架', due: '10:00', note: '怕忘', priority: 9 }])
  const result = parsePlan(text, PARSE_INPUT)

  assert.equal(result.commitments.length, 1)
  assert.deepEqual(Object.keys(result.commitments[0]).sort(), [
    'createdAtTick',
    'dueTick',
    'id',
    'source',
    'status',
    'what',
    'with',
  ])
})

// ---------------------------------------------------------------- R500-3 怎么判

test('R500-3：with 不在认识的人里 → 只丢这一条，另一条照收', () => {
  const text = JSON.stringify([item('agent-9', '去吃面', '12:00'), item('agent-2', '对一下工单', '12:30')])
  const result = parsePlan(text, PARSE_INPUT)

  assert.equal(result.commitments.length, 1)
  assert.equal(result.commitments[0].what, '对一下工单')
  assert.deepEqual(codesOf(result), ['unknown-peer'])
  assert.equal(result.rejected[0].index, 0, 'index 指向原文的第几条')
  assert.ok(result.rejected[0].reason.includes('agent-9'), '原因里要带出问题的那个值')
})

test('R500-5：已经过的时刻顺延到明天，不再当过期丢掉', () => {
  const result = parsePlan(JSON.stringify([item('', '赶早班', '05:00')]), PARSE_INPUT)

  assert.equal(result.commitments.length, 1)
  // PARSE_INPUT 的 nowTick 是 06:30 → 05:00 顺延到次日同一时刻。
  // 理由：1 游戏小时 = 6 秒，问完到答完世界已经过了几十分钟。
  assert.equal(result.commitments[0].dueTick, 1440 + 5 * 60, '次日 05:00')
  assert.deepEqual(codesOf(result), [])
})

test('R500-3：due 越界 / 不是 HH:mm → bad-due', () => {
  const text = JSON.stringify([item('', '写周报', '25:00'), item('', '修门', '9点')])
  const result = parsePlan(text, PARSE_INPUT)

  assert.deepEqual(result.commitments, [])
  assert.deepEqual(codesOf(result), ['bad-due', 'bad-due'])
})

test('R500-3：超过 2 条 → 只留前 2 条，多出来的记 too-many', () => {
  const text = JSON.stringify([
    item('', '第一件', '08:00'),
    item('', '第二件', '09:00'),
    item('', '第三件', '10:00'),
  ])
  const result = parsePlan(text, PARSE_INPUT)

  assert.equal(result.commitments.length, MAX_PLAN_ITEMS)
  assert.deepEqual(result.commitments.map((c) => c.what), ['第一件', '第二件'])
  assert.deepEqual(codesOf(result), ['too-many'])
  assert.equal(result.rejected[0].index, 2)
})

test('R500-3：返回 [] → 没有承诺，也不算失败', () => {
  const result = parsePlan('[]', PARSE_INPUT)

  assert.deepEqual(result.commitments, [])
  assert.deepEqual(result.rejected, [])
})

test('R500-3：乱文本 → no-array（index -1），不抛', () => {
  for (const text of ['我今天想去仓库理货，然后早点睡。', '   ', '{"with":"agent-2"}']) {
    const result = parsePlan(text, PARSE_INPUT)
    assert.deepEqual(result.commitments, [])
    assert.deepEqual(codesOf(result), ['no-array'], '输入：' + JSON.stringify(text))
    assert.equal(result.rejected[0].index, -1)
    assert.equal(typeof result.rejected[0].reason, 'string')
  }
})

test('R500-3：what 空 / 超过 40 字 → 丢掉', () => {
  const text = JSON.stringify([
    { with: '', what: '   ', due: '10:00' },
    { with: '', what: 'x'.repeat(41), due: '10:00' },
  ])
  const result = parsePlan(text, PARSE_INPUT)

  assert.deepEqual(result.commitments, [])
  assert.deepEqual(codesOf(result), ['empty-what', 'what-too-long'])
})

test('R500-3：条目不是 JSON 对象 → not-object', () => {
  const result = parsePlan('[42]', PARSE_INPUT)

  assert.deepEqual(result.commitments, [])
  assert.deepEqual(codesOf(result), ['not-object'])
})

test('R500-3：40 字是边界，正好 40 字收', () => {
  const text = JSON.stringify([{ with: '', what: '干'.repeat(40), due: '10:00' }])
  const result = parsePlan(text, PARSE_INPUT)

  assert.equal(result.commitments.length, 1)
  assert.equal(result.commitments[0].what.length, 40)
})

test('R500-3：with 不是字符串 → bad-with', () => {
  const result = parsePlan(JSON.stringify([{ with: 2, what: '对账', due: '10:00' }]), PARSE_INPUT)

  assert.deepEqual(codesOf(result), ['bad-with'])
})

// ---------------------------------------------------------------- 纯函数

test('R500-4：同一输入两次结果完全一致（没有随机数、没有读时钟）', () => {
  const text = JSON.stringify([item('agent-2', '去仓库看看', '15:00')])
  assert.deepEqual(parsePlan(text, PARSE_INPUT), parsePlan(text, PARSE_INPUT))
  assert.deepEqual(buildPlanPrompt(PROMPT_INPUT), buildPlanPrompt(PROMPT_INPUT))
})
