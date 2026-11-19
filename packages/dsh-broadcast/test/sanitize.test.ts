import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  clipToSentence,
  firstParagraph,
  sanitizeForSpeech,
  summarizeLocally,
} from '../lib/sanitize.js'

/** 真实样本：某个会话里带代码块/路径/URL/表格/列表的 2581 字回复（截断保存）。 */
const rich = readFileSync(new URL('./fixtures/real-reply-markdown.txt', import.meta.url), 'utf8')
/** 真实样本：一段没有 Markdown 的英文说明。 */
const plain = readFileSync(new URL('./fixtures/real-reply-plain.txt', import.meta.url), 'utf8')

test('真实长回复：洗完后不含反引号 / 斜杠 / http / 星号', () => {
  const clean = sanitizeForSpeech(rich)
  assert.ok(clean.length > 200, '洗完不该只剩几句话')
  for (const forbidden of ['`', '/', 'http', '*', '|', '#']) {
    assert.equal(clean.includes(forbidden), false, `不该残留 ${forbidden}`)
  }
  // 中文正文还在（不是把整段都删了）
  assert.match(clean, /你说得对/)
  assert.match(clean, /设计原则/)
})

test('真实长回复：代码块、路径、URL、文件名都不念', () => {
  const clean = sanitizeForSpeech(rich)
  assert.equal(clean.includes('buildRuns'), false) // 行内代码
  assert.equal(clean.includes('dsh-ui'), false) // 自定义围栏整块丢
  assert.equal(clean.includes('127.0.0.1'), false) // URL
  assert.equal(clean.includes('charts.html'), false) // 文件名
  assert.equal(clean.includes('344px'), false) // 单位后缀被收掉
  assert.match(clean, /344/) // 但数字留着
})

test('真实英文短回复：正文不被误伤，只压空白', () => {
  const clean = sanitizeForSpeech(plain)
  assert.equal(clean, plain.trim().replace(/\s+/g, ' '))
})

test('表格、列表、标题、引用、表情、链接文字', () => {
  const markdown = [
    '# 结论',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '> 引用一句话',
    '',
    '- 第一项',
    '1. 第二项',
    '',
    '看这里 [文档](https://example.com/a) 和 ![图](https://example.com/x.png) 🎉',
  ].join('\n')
  const clean = sanitizeForSpeech(markdown)
  assert.equal(clean.includes('|'), false)
  assert.equal(clean.includes('#'), false)
  assert.equal(clean.includes('https'), false)
  assert.equal(clean.includes('🎉'), false)
  assert.match(clean, /结论/)
  assert.match(clean, /引用一句话/)
  assert.match(clean, /第一项/)
  assert.match(clean, /文档/) // 链接只留文字
})

test('firstParagraph 取第一段（空行分段）', () => {
  assert.equal(firstParagraph('第一段\n第一段续\n\n第二段'), '第一段 第一段续')
  assert.equal(firstParagraph('\n\n  只有一段  \n'), '只有一段')
  assert.equal(firstParagraph('   \n\n  '), '')
})

test('clipToSentence 停在句号上，找不到就硬截', () => {
  const sentence = '第一句话说完了。第二句话也说完。'
  assert.equal(clipToSentence(sentence, 100), sentence)
  const clipped = clipToSentence(sentence, 12)
  assert.ok(clipped.length <= 12)
  assert.ok(clipped.endsWith('。'))
  assert.equal(clipToSentence('没有标点的一长串文字', 4), '没有标点')
  assert.equal(clipToSentence('   ', 10), '')
  assert.equal(clipToSentence('短', 0), '短')
})

test('summarizeLocally：首段 + 上限，空输入返回空', () => {
  const summary = summarizeLocally(rich, 80)
  assert.ok(summary.length > 0 && summary.length <= 80)
  assert.equal(summary.includes('`'), false)
  assert.equal(summarizeLocally('', 80), '')
  assert.equal(summarizeLocally('```ts\nconst a = 1\n```', 80), '')
})
