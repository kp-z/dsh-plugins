import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decideTurn, failureNotice, inQuietHours, type TurnPolicy, type TurnSignal } from '../lib/turn.js'

const policy: TurnPolicy = {
  enabled: true,
  announceSubagent: false,
  announceFailure: true,
  minChars: 30,
  debounceMs: 2000,
  quietHours: '',
}

/** 造一个本地时间点（只关心时与分）。 */
const at = (hours: number, minutes = 0): Date => new Date(2026, 0, 15, hours, minutes, 0, 0)

const signal = (overrides: Partial<TurnSignal> = {}): TurnSignal => ({
  isSubagent: false,
  kind: 'completed',
  text: '这一轮把接口改好了，单元测试和真机都过了一遍，日志也看过了，你可以看一下要不要合并到主干。',
  now: 10_000,
  lastSpokenAt: undefined,
  ...overrides,
})

/** 表驱动：一行一个场景，失败时能看出是哪一行。 */
const cases: { name: string; signal: Partial<TurnSignal>; policy?: Partial<TurnPolicy>; expect: 'speak' | 'notice' | 'silent' }[] = [
  { name: '正常完成的长回复 → 播', signal: {}, expect: 'speak' },
  { name: '总开关关闭 → 静默', signal: {}, policy: { enabled: false }, expect: 'silent' },
  { name: '子代理会话默认静默', signal: { isSubagent: true }, expect: 'silent' },
  { name: '打开子代理播报 → 播', signal: { isSubagent: true }, policy: { announceSubagent: true }, expect: 'speak' },
  { name: '回复只有 29 字 → 静默', signal: { text: '字'.repeat(29) }, expect: 'silent' },
  { name: '回复正好 30 字 → 播', signal: { text: '字'.repeat(30) }, expect: 'speak' },
  { name: '报错轮 → 一句提示', signal: { kind: 'error' }, expect: 'notice' },
  { name: '关掉失败提示 → 静默', signal: { kind: 'error' }, policy: { announceFailure: false }, expect: 'silent' },
  { name: '被中止 → 一句提示', signal: { kind: 'aborted' }, expect: 'notice' },
  { name: '卡住 → 一句提示', signal: { kind: 'blocked' }, expect: 'notice' },
  { name: '超长被截断 → 一句提示', signal: { kind: 'max-tokens' }, expect: 'notice' },
  { name: '未知的结束原因 → 通用提示', signal: { kind: 'something-new' }, expect: 'notice' },
  { name: '1 秒前刚播过 → 去抖', signal: { lastSpokenAt: 9_000 }, expect: 'silent' },
  { name: '3 秒前播过 → 播', signal: { lastSpokenAt: 7_000 }, expect: 'speak' },
  { name: '报错提示不受去抖压制', signal: { kind: 'error', lastSpokenAt: 9_999 }, expect: 'notice' },
  { name: '去抖为 0 时不压', signal: { lastSpokenAt: 9_999 }, policy: { debounceMs: 0 }, expect: 'speak' },
  { name: '子代理报错也静默（子代理优先级更高）', signal: { isSubagent: true, kind: 'error' }, expect: 'silent' },
]

for (const item of cases) {
  test(item.name, () => {
    const decision = decideTurn(signal(item.signal), { ...policy, ...item.policy })
    assert.equal(decision.action, item.expect)
  })
}

test('安静时段：跨零点也认，端点不含', () => {
  const spec = '23:00-08:00'
  assert.equal(inQuietHours(at(23, 30), spec), true)
  assert.equal(inQuietHours(at(2, 0), spec), true)
  assert.equal(inQuietHours(at(7, 59), spec), true)
  assert.equal(inQuietHours(at(8, 0), spec), false, '终点不含')
  assert.equal(inQuietHours(at(22, 59), spec), false)
  assert.equal(inQuietHours(at(12, 0), spec), false)
})

test('安静时段：普通区间、写法容错、非法值一律不管', () => {
  assert.equal(inQuietHours(at(12, 0), '09:00-18:00'), true)
  assert.equal(inQuietHours(at(8, 59), '09:00-18:00'), false)
  assert.equal(inQuietHours(at(18, 0), '09:00-18:00'), false)
  assert.equal(inQuietHours(at(12, 0), '9:00-18:00'), true, '一位数小时也认')
  assert.equal(inQuietHours(at(12, 0), '09:00 到 18:00'), true, '中文连接词也认')
  for (const bad of ['', '   ', 'abc', '25:00-08:00', '09:00-24:00', '10:00-10:00']) {
    assert.equal(inQuietHours(at(10, 0), bad), false, `${bad} 应当当作没设`)
  }
})

test('安静时段命中 → 静默（优先级在总开关之后）', () => {
  const quiet = decideTurn(signal({ quietNow: true }), policy)
  assert.equal(quiet.action, 'silent')
  assert.match(quiet.action === 'silent' ? quiet.reason : '', /安静时段/)
  assert.equal(decideTurn(signal({ quietNow: true }), { ...policy, enabled: false }).action, 'silent')
  assert.equal(decideTurn(signal({ quietNow: false }), policy).action, 'speak')
})

test('提示语短、能听懂、说清要不要你管', () => {
  assert.match(failureNotice('error'), /出错/)
  assert.match(failureNotice('aborted'), /打断/)
  assert.match(failureNotice('blocked'), /卡住/)
  assert.match(failureNotice('unknown-kind'), /没有正常收尾/)
  for (const kind of ['error', 'aborted', 'blocked', 'max-tokens', 'interrupted', 'x']) {
    assert.ok(failureNotice(kind).length <= 30, `${kind} 的提示太长`)
  }
})
