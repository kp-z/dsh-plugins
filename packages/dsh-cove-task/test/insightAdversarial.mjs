/**
 * 长期结论的对抗评测（12 个场景）。
 *
 * 目标：模型「说得好听」不算数——编数字、堆视角、贴人格标签、写空话，都必须被宿主丢掉；
 * 合法但措辞不同的（「先」而不是「就」、metric 带括号）必须能通过。
 * 提示词侧的红线（不提 MBTI、不做人格诊断）用静态断言钉住。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { normalizeLongTerm } from '../insightLongTerm.js'
import { DEFAULT_INSIGHT_PROMPT, INSIGHT_PLAYBOOK, INSIGHT_SESSION_PREFIX, insightSessionIdFor } from '../index.js'

const now = new Date(2026, 4, 20, 12, 0).getTime()

/* 洞察会话每日滚动：同一天稳定、跨天换新 */
assert.equal(INSIGHT_SESSION_PREFIX, 'cove-insight-')
const dayA = new Date(2026, 10, 28, 0, 5).getTime()
const dayB = new Date(2026, 10, 29, 0, 5).getTime()
assert.equal(insightSessionIdFor(dayA), 'cove-insight-20261128')
assert.equal(insightSessionIdFor(dayA + 3 * 3600_000), 'cove-insight-20261128', '同一天复用同一条会话')
assert.notEqual(insightSessionIdFor(dayA), insightSessionIdFor(dayB), '跨天换新会话（旧的在开新时归档）')
const profileText = [
  '周节奏（8 周，n=72）：四 24 / 五 16 / 日 13',
  '进出台账（8 周）：新增 0/0/0/5/26/11/18/24；完成 0/0/0/0/26/13/16/17',
  '在跑（n=34 天）：中位 6，85 分位 8',
  '预期兑现（n=36）：提前 20 / 准时 3 / 延期 13；完成但没设预期 67/103',
].join('\n')
const base = {
  lens: 'contradiction',
  fact: '在跑（n=34 天）：中位 6，85 分位 8',
  hypothesis: '在跑过多导致挂着不收口',
  falsifier: '下周净积压在 0 以上',
  secondOrder: '限流后长尾更久没人碰',
  action: '当我要开新任务时，就先关一条在跑任务',
  metric: '在跑',
  until: '2026-05-27',
}
const opts = { profileText, sampleDays: 37, windowDays: 84, now }
const run = (patch = {}, extra = {}) => normalizeLongTerm({ ...base, ...patch }, { ...opts, ...extra })
const scenarios = []
const check = (name, fn) => {
  try { fn(); scenarios.push({ name, ok: true }) } catch (error) { scenarios.push({ name, ok: false, error }) }
}

check('① 编造数字（fact 不在行为档案里）→ 丢弃', () => {
  assert.equal(run({ fact: '在跑（n=999 天）：中位 2，85 分位 3' }), null)
})
check('② fact 里没有数字 → 丢弃', () => {
  assert.equal(run({ fact: '你经常拖延' }), null)
})
check('③ 堆视角 / 非白名单 lens（multiple、mbti）→ 丢弃', () => {
  assert.equal(run({ lens: 'multiple' }), null)
  assert.equal(run({ lens: 'mbti' }), null)
})
check('④ 没有反证条件 → 丢弃', () => {
  assert.equal(run({ falsifier: '' }), null)
  assert.equal(run({ falsifier: '   ' }), null)
})
check('⑤ action 是空话（提高效率）→ 丢弃', () => {
  assert.equal(run({ action: '提高效率' }), null)
  assert.equal(run({ action: '加强沟通' }), null)
})
check('⑥ action 缺触发条件（只有动作）→ 丢弃', () => {
  assert.equal(run({ action: '先关掉一条在跑任务' }), null)
  assert.equal(run({ action: '当写预期时' }), null)
})
check('⑦ metric 不是信号名 → 丢弃', () => {
  assert.equal(run({ metric: '效率' }), null)
  assert.equal(run({ metric: '' }), null)
})
check('⑧ 样本不足 14 天 → 整条丢弃', () => {
  assert.equal(run({}, { sampleDays: 3 }), null)
  assert.equal(run({}, { sampleDays: 13 }), null)
})
check('⑨ 人格 / 临床标签（拖延型、MBTI、抑郁）→ 丢弃', () => {
  assert.equal(run({ hypothesis: '你就是拖延型' }), null)
  assert.equal(run({ falsifier: '这是 MBTI 说的' }), null)
  assert.equal(run({ secondOrder: '可能会抑郁' }), null)
})
check('⑩ 超长字段：裁剪到上限但不丢弃', () => {
  const out = run({ hypothesis: '很长的假设'.repeat(40) })
  assert.ok(out)
  assert.equal(out.hypothesis.length <= 60, true, 'hypothesis 应被裁到 60 字内')
})
check('⑪ until 越界（2099 / 过去）→ 默认 +7 天且仍接受', () => {
  assert.equal(run({ until: '2099-01-01' }).until, '2026-05-27')
  assert.equal(run({ until: '2000-01-01' }).until, '2026-05-27')
})
check('⑫ 合法但措辞不同（「先」+ 带括号 metric）→ 接受', () => {
  const out = run({ action: '当我要开新任务时，先关一条在跑任务', metric: '在跑（中位从 6 降到 4）' })
  assert.ok(out)
  assert.equal(out.metric, '在跑')
  assert.equal(out.metricNote, '在跑（中位从 6 降到 4）')
})

/* 提示词红线：静态钉住（这层不是校验，而是模型的输入约束） */
const promptChecks = []
const staticCheck = (name, ok) => promptChecks.push({ name, ok })
staticCheck('prompt 明令「不做人格诊断」', DEFAULT_INSIGHT_PROMPT.includes('不做人格诊断'))
staticCheck('prompt 明令不提 MBTI', DEFAULT_INSIGHT_PROMPT.includes('MBTI'))
staticCheck('prompt 要求 fact 原样引用行为档案', DEFAULT_INSIGHT_PROMPT.includes('原样引用行为档案'))
staticCheck('prompt 要求写不出 falsifier/if-then 就 longTerm=null', DEFAULT_INSIGHT_PROMPT.includes('longTerm=null'))
for (const lens of ['contradiction', 'inversion', 'values', 'structure', 'second_order']) {
  staticCheck('playbook 含视角 ' + lens, INSIGHT_PLAYBOOK.includes(lens))
}
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
staticCheck('发布白名单含 insightLongTerm.js', Array.isArray(pkg.files) && pkg.files.includes('insightLongTerm.js'))

const failed = scenarios.filter((item) => !item.ok)
const staticFailed = promptChecks.filter((item) => !item.ok)
for (const item of failed) console.error('FAIL ' + item.name + '\n     ' + (item.error && item.error.message))
for (const item of staticFailed) console.error('FAIL ' + item.name)
console.log('\n' + (scenarios.length - failed.length) + '/' + scenarios.length + ' 场景通过；'
  + (promptChecks.length - staticFailed.length) + '/' + promptChecks.length + ' 提示词断言通过')
if (failed.length || staticFailed.length) process.exitCode = 1
