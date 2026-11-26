import assert from 'node:assert/strict'
import { DEFAULT_INSIGHT_PROMPT, DEFAULT_MORNING_PROMPT, PROMPT_REV } from '../index.js'

/* 早会口述稿的契约：昨天逐条、每条先解释「这块是干嘛的」，听众只听得到项目名。 */
assert.ok(PROMPT_REV >= 13, 'prompt revision bumped so cached scripts regenerate')
for (const needle of [
  '一条条讲',
  '昨天做了 N 件事',
  '1. ',
  '这块是干嘛的',
  '听众只知道',
  '外行能懂',
  '2-4 条',
]) {
  assert.ok(DEFAULT_MORNING_PROMPT.includes(needle), 'morning prompt must require: ' + needle)
}
assert.ok(!DEFAULT_MORNING_PROMPT.includes('不要 bullet、不要编号'), 'itemized list is now required, not forbidden')

/* 诊断契约：优点必须和问题对称出现，否则用户只被告知哪里错、不知道该保留什么。 */
for (const needle of ['"strengths"', 'strengths 0-2 条', '不要为了凑对称硬夸', '没出问题']) {
  assert.ok(DEFAULT_INSIGHT_PROMPT.includes(needle), 'insight prompt must require: ' + needle)
}

/* 建议契约：必须点到任务、必须能验收，空话一律不许写。 */
for (const needle of ['点名 T 号', '换个项目也成立', '等于没给建议', '必须能对上证据', '宁少勿凑']) {
  assert.ok(DEFAULT_INSIGHT_PROMPT.includes(needle), 'advice/improve must be concrete: ' + needle)
}
assert.ok(PROMPT_REV >= 17, 'prompt rev bumped so cached diagnoses regenerate')
assert.ok(DEFAULT_MORNING_PROMPT.includes('项目只认材料里的「项目」字段'))
assert.ok(DEFAULT_MORNING_PROMPT.includes('不要从工作区、目录或标题前缀猜项目'))
assert.ok(PROMPT_REV >= 18)
console.log('MORNING_PROMPT_OK: itemized yesterday script with plain-language project context')
