/**
 * R516：计划提示词要带"昨天"。
 *
 * 现场：06:30 生成计划时，"今天已经发生的事"取的是当天 00:00 起的活动，
 * 而典型作息 23:00–07:00 在睡觉——这一段基本是空的，等于让人在没有昨天的情况下安排今天。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPlanPrompt } from '../lib/bridge/plan-prompt.js'

const base = {
  agentName: '小蓝',
  persona: '角色：engineer',
  todaySummary: ['08:12 吃了顿饭'],
  knownPeers: [{ id: 'agent-1', name: '阿金' }],
  nowTick: 390,
}

test('R516：有昨天就给「昨天你怎么过的」段，且排在今天之前', () => {
  const text = buildPlanPrompt({ ...base, yesterday: '第3天：干活×2、和人聊了聊×1' })
  assert.ok(text.includes('## 昨天你怎么过的'), text.slice(0, 200))
  assert.ok(text.includes('第3天：干活×2'), '昨天的原文要出现')
  const at = text.indexOf('## 昨天你怎么过的')
  const today = text.indexOf('## 今天已经发生的事')
  assert.ok(at >= 0 && today > at, '昨天段必须在今天段之前')
})

test('R516：没有昨天就整段省略（不输出空标题）', () => {
  const text = buildPlanPrompt(base)
  assert.equal(text.includes('昨天你怎么过的'), false)
})

test('R516：只有空白也当没有', () => {
  const text = buildPlanPrompt({ ...base, yesterday: '   ' })
  assert.equal(text.includes('昨天你怎么过的'), false)
})
