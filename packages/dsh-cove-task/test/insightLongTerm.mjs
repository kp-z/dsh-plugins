/**
 * insightLongTerm.js 契约测试（流程号 ①–⑤）。
 * 只测公开行为：模型写的东西能不能落地、过期怎么算。
 */
import assert from 'node:assert/strict'
import { isLongTermExpired, normalizeLongTerm, MIN_SAMPLE_DAYS } from '../insightLongTerm.js'

const now = new Date(2026, 4, 20, 12, 0).getTime() // 2026-05-20 12:00 本地
const profileText = [
  '周节奏（8 周，n=72）：四 24 / 五 16 / 日 13',
  '预期兑现（n=36）：提前 20 / 准时 3 / 延期 13；完成但没设预期 67/103',
  '切换（n=5 周）：每周中位 9 个项目，最多 9 个',
].join('\n')
const base = {
  lens: 'inversion',
  fact: '预期兑现（n=36）：提前 20 / 准时 3 / 延期 13',
  hypothesis: '承诺按最乐观估，延期集中在估时',
  falsifier: '下周延期样本里估时占比 <30%',
  secondOrder: '缓冲加太多会让承诺失去约束力',
  action: '当写预期时，就先乘 1.5 再拆到 1 天以内',
  metric: '预期兑现',
  until: '2026-05-27',
}
const opts = { profileText, sampleDays: 37, windowDays: 84, now }
const run = (patch = {}, extra = {}) => normalizeLongTerm({ ...base, ...patch }, { ...opts, ...extra })
const results = []
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true }) } catch (error) { results.push({ name, ok: false, error }) }
}

check('① 样本不足（<14 天）→ null', () => assert.equal(run({}, { sampleDays: MIN_SAMPLE_DAYS - 1 }), null))
check('② 非对象 / 数组 → null', () => {
  assert.equal(normalizeLongTerm(null, opts), null)
  assert.equal(normalizeLongTerm([], opts), null)
  assert.equal(normalizeLongTerm('x', opts), null)
})
check('② lens 必须白名单', () => assert.equal(run({ lens: 'mbti' }), null))
check('③ fact 必须含数字', () => assert.equal(run({ fact: '你经常拖延' }), null))
check('③ fact 必须能在档案里找到', () => assert.equal(run({ fact: '预期兑现（n=99）：提前 1' }), null))
check('③ fact 忽略空白仍能命中（模型换行/多空格）', () => {
  const out = run({ fact: '预期兑现（n=36）：提前 20 / 准时 3 / 延期 13；完成但没设预期 67/103'.replace(' / ', '/') })
  assert.equal(out?.lens, 'inversion')
})
check('④ 缺 falsifier → null', () => assert.equal(run({ falsifier: '  ' }), null))
check('④ action 必须是 if-then（当…就/先/再…）', () => {
  assert.equal(run({ action: '提高效率' }), null, '没有「当」不算 if-then')
  assert.equal(run({ action: '当写预期时' }), null, '只有条件没有动作')
  assert.ok(run({ action: '当写预期时，先乘 1.5' }), '「先」与「就」等价')
  assert.ok(run({ action: '当写预期时，就先乘 1.5' }))
})
check('④ metric 必须是信号名（允许括号说明）', () => {
  assert.equal(run({ metric: '效率' }), null)
  const out = run({ metric: '在跑（中位从 6 降到 4）' })
  assert.ok(out)
  assert.equal(out.metric, '在跑')
  assert.equal(out.metricNote, '在跑（中位从 6 降到 4）')
})
check('⑤ 合法输入：字段裁剪 + 默认 7 天到期', () => {
  const out = run()
  assert.ok(out)
  assert.equal(out.lens, 'inversion')
  assert.equal(out.fact, base.fact)
  assert.equal(out.until, '2026-05-27')
  assert.equal(out.at, now)
  assert.equal(out.sampleDays, 37)
  assert.equal(out.windowDays, 84)
})
check('⑤ 缺 until / 超 28 天 → 默认 +7 天', () => {
  assert.equal(run({ until: '' }).until, '2026-05-27')
  assert.equal(run({ until: '2026-08-01' }).until, '2026-05-27')
  assert.equal(run({ until: '2026-05-30' }).until, '2026-05-30')
})
check('⑤ 过期判定：昨天过期、今天不过期、缺 until 过期', () => {
  assert.equal(isLongTermExpired({ data: { until: '2026-05-19' } }, '2026-05-20'), true)
  assert.equal(isLongTermExpired({ data: { until: '2026-05-20' } }, '2026-05-20'), false)
  assert.equal(isLongTermExpired({ data: {} }, '2026-05-20'), true)
  assert.equal(isLongTermExpired(null, '2026-05-20'), true)
})

check('发布白名单：package.json files 含 insightLongTerm.js', async () => {
  const { readFile } = await import('node:fs/promises')
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('insightLongTerm.js'), 'files 缺 insightLongTerm.js')
})

const failed = results.filter((item) => !item.ok)
for (const item of results) {
  if (!item.ok) console.error('FAIL ' + item.name + '\n     ' + (item.error && item.error.message))
}
console.log(results.length - failed.length + ' passed, ' + failed.length + ' failed, ' + results.length + ' total')
if (failed.length) process.exitCode = 1
