import assert from 'node:assert/strict'
import { test } from 'node:test'

import { extractFrontendReply, REPLY_MAX_CHARS } from '../lib/adapters/slowvale/reply.js'

test('只取完整标记里的正文，不发送周围的详细说明', () => {
  const text = '内部说明。\n<xcity-reply>我这就去工位。\n到了通知你。</xcity-reply>\n另一段内部说明。'
  assert.equal(extractFrontendReply(text), '我这就去工位。 到了通知你。')
})

test('没有标记、空白、未闭合或嵌套标记时不发短信', () => {
  for (const text of ['私有说明。', ' ', '<xcity-reply>尚未闭合', '<xcity-reply> </xcity-reply>内部说明', '<xcity-reply>内部说明<xcity-reply>公开回复</xcity-reply>']) {
    assert.equal(extractFrontendReply(text), null)
  }
})

test('短信总长包含省略号且不截断 Unicode 字符', () => {
  const got = extractFrontendReply('<xcity-reply>' + '🙂'.repeat(200) + '</xcity-reply>')
  assert.equal(got, '🙂'.repeat(REPLY_MAX_CHARS - 1) + '…')
})
