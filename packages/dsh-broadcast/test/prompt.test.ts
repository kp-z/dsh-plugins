import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_ACTIONS,
  MAX_ASK_CHARS,
  MAX_REPLY_CHARS,
  SYSTEM_PROMPT,
  buildPrompt,
  clipInput,
  describeActions,
} from '../lib/prompt.js'

test('系统提示要求「汇报」而不是「复述」', () => {
  for (const must of [
    '普通话口语', '2 到 3 句', '80 字',
    '他让你做的事，做到哪了',   // 第一句必须是结论
    '不要复述原文',
    '拍板',
    '用「我」说',                // 不要「本轮/该会话」
    '不要念工具名',
    '数字说成中文',
    '多音字',
    '逐字母',
  ]) {
    assert.ok(SYSTEM_PROMPT.includes(must), `system 提示缺了「${must}」`)
  }
})

test('user 三段齐全：用户原话 → 最后回复 → 做过的事（含报错步数）', () => {
  const { user } = buildPrompt({
    ask: '把播报的菜单缩短一点',
    text: '改成了 28px 图标按钮，测试都过了。',
    actions: [
      { name: 'read', detail: 'src/client.js' },
      { name: 'edit', detail: 'src/client.js' },
      { name: 'bash', detail: 'node --test' },
    ],
    kind: 'completed',
  })
  assert.match(user, /用户这一轮的原话：\n把播报的菜单缩短一点/)
  assert.match(user, /我最后的回复（结论在这里）：\n改成了 28px 图标按钮/)
  assert.match(user, /读了 src\/client\.js/)
  assert.match(user, /改了 src\/client\.js/)
  assert.match(user, /运行了 node --test/)
  assert.ok(user.indexOf('原话') < user.indexOf('最后的回复'), '先给需求，再给结论')
})

test('没有用户原话时不出空段；没有动作时不出动作段', () => {
  const { user } = buildPrompt({ text: '只有回复。' })
  assert.equal(user.includes('用户这一轮的原话'), false)
  assert.equal(user.includes('实际做过的事'), false)
  assert.match(user, /只有回复。/)
})

test('动作最多 MAX_ACTIONS 条，其余折成一句', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ name: 'read', detail: `f${i}.ts` }))
  const lines = describeActions(many)
  assert.equal(lines.length, MAX_ACTIONS + 1)
  assert.match(lines.at(-1) ?? '', /另外还有 4 步/)
})

test('认不出的工具名说「做了」，不瞎猜动词', () => {
  assert.deepEqual(describeActions([{ name: 'some_new_tool', detail: 'x' }]), ['- 做了 x'])
  assert.deepEqual(describeActions([{ name: 'read', detail: undefined }]), ['- 读了'])
})

test('异常收尾时把 kind 告诉模型，正常完成时不说废话', () => {
  assert.match(buildPrompt({ text: 'x', kind: 'error' }).user, /不是正常完成，结束原因是 error/)
  assert.equal(buildPrompt({ text: 'x', kind: 'completed' }).user.includes('不是正常完成'), false)
})

test('长原料按行边界截断（需求与回复各自有上限）', () => {
  const long = Array.from({ length: 400 }, (_, i) => `第 ${i} 行。`).join('\n')
  assert.ok(clipInput(long, MAX_ASK_CHARS).length <= MAX_ASK_CHARS)
  assert.ok(clipInput(long, MAX_REPLY_CHARS).length <= MAX_REPLY_CHARS)
  assert.equal(clipInput('短文本', 100), '短文本')
})
