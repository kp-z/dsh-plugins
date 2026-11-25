import assert from 'node:assert/strict'
import { test } from 'node:test'

import { extractFrontendReply, REPLY_MAX_CHARS } from '../lib/adapters/slowvale/reply.js'

test('有标记：只取标记里的内容，标记外的详细分析不进前端', () => {
  const text = '我查了一下工位排期，今天下午有三个会。\n<xcity-reply>我这就去工位，十分钟后开工。</xcity-reply>\n另外注意 B 区还没清空。'
  assert.equal(extractFrontendReply(text), '我这就去工位，十分钟后开工。')
})

test('没有标记：退回第一句（不让玩家的短信石沉大海）', () => {
  assert.equal(extractFrontendReply('好的，我马上过去。前面还有两件事我先说清楚……'), '好的，我马上过去。')
  assert.equal(extractFrontendReply('收到\n我这就去'), '收到')
})

test('标记没闭合也能用；空白标记当作没有', () => {
  assert.equal(extractFrontendReply('<xcity-reply>我在路上了'), '我在路上了')
  assert.equal(extractFrontendReply('<xcity-reply>   </xcity-reply>\n我在忙'), '我在忙')
})

test('过长会截断到上限（前端要短）', () => {
  const long = '啊'.repeat(200)
  const got = extractFrontendReply(long)
  assert.ok(got !== null)
  assert.ok(got.length <= REPLY_MAX_CHARS + 1)
  assert.ok(got.endsWith('…'))
})

test('空文本返回 null', () => {
  assert.equal(extractFrontendReply('   '), null)
})
