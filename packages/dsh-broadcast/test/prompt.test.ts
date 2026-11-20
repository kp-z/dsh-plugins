import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_INPUT_CHARS, SYSTEM_PROMPT, buildPrompt, clipInput } from '../lib/prompt.js'

test('系统提示把「怎么说人话」的约束写全了', () => {
  for (const must of ['普通话口语', '2 到 3 句', '80 字', '先说结论', '拍板', '不要念代码', '路径', '数字说成中文', '不要开场白', 'Markdown']) {
    assert.ok(SYSTEM_PROMPT.includes(must), `system 提示缺了「${must}」`)
  }
})

test('系统提示要求避开多音字与中英混排（合成器只吃纯文本，只能靠换词消除歧义）', () => {
  assert.match(SYSTEM_PROMPT, /多音字/)
  assert.match(SYSTEM_PROMPT, /换一个不含歧义的词/)
  assert.match(SYSTEM_PROMPT, /逐字母/) // 说明为什么英文要换中文
  for (const word of ['行', '长', '重', '还']) {
    assert.ok(SYSTEM_PROMPT.includes(word), `应覆盖 ${word} 这类多音字`)
  }
})

test('user 里带正文，并把工具名去重、限条数', () => {
  const { user, system } = buildPrompt({
    text: '我把接口改好了。',
    tools: ['read', 'read', 'edit', 'bash', 'grep', 'write', 'glob', 'grep', 'task', 'todo_write', 'read', 'edit', 'x', 'y'],
  })
  assert.equal(system, SYSTEM_PROMPT)
  assert.match(user, /这一轮的收尾记录：\n我把接口改好了。/)
  assert.match(user, /工具（只作参考，不要念出来）：/)
  const toolLine = user.split('\n').find((line) => line.includes('工具（只作参考')) ?? ''
  const names = toolLine.split('：')[1]?.split('、') ?? []
  assert.ok(names.length <= 12, '工具名最多带 12 个')
  assert.equal(new Set(names).size, names.length, '工具名去重')
})

test('异常收尾时把 kind 告诉模型，正常完成时不说废话', () => {
  assert.match(buildPrompt({ text: 'x', kind: 'error' }).user, /不是正常完成，结束原因是 error/)
  assert.equal(buildPrompt({ text: 'x', kind: 'completed' }).user.includes('不是正常完成'), false)
})

test('长正文按行边界截到上限', () => {
  const long = Array.from({ length: 400 }, (_, i) => `第 ${i} 行，这里有一些内容。`).join('\n')
  const clipped = clipInput(long)
  assert.ok(clipped.length <= MAX_INPUT_CHARS)
  assert.ok(clipped.endsWith('。'), '不该把一句话切两半')
  assert.equal(clipInput('短文本'), '短文本')
})
