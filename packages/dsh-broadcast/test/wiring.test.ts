import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveConfig } from '../lib/config.js'
import { createSessionListener } from '../lib/wiring.js'
import type { TurnDecision } from '../lib/turn.js'

let clock = 10_000

/** 与真机日志同形的三种事件（字段名从 ~/.dsh/sessions 的 v4 日志里读出来的）。 */
function assistantEvent(turn: number, text: string, tools: string[] = []) {
  return {
    type: 'assistant/message',
    seq: 1,
    time: 0,
    data: {
      turn,
      step: 0,
      message: {
        role: 'assistant',
        content: [
          ...(text === '' ? [] : [{ type: 'text', text }]),
          ...tools.map((name) => ({ type: 'tool-call', id: `call_${name}`, name, arguments: '{}' })),
        ],
      },
    },
  }
}

function turnEndEvent(turn: number, kind: string, errorMessage?: string) {
  return {
    type: 'turn/end',
    seq: 2,
    time: 0,
    data: { turn, reason: errorMessage === undefined ? { kind } : { kind, error: { message: errorMessage } } },
  }
}

function harness(overrides: Parameters<typeof resolveConfig>[0] = {}) {
  const spoken: string[] = []
  const decisions: { sessionId: string; decision: TurnDecision; tools: readonly string[] }[] = []
  const errors: unknown[] = []
  const config = resolveConfig({ enabled: true, ...overrides })
  const listener = createSessionListener({
    config,
    speak: async (text) => {
      spoken.push(text)
    },
    now: () => clock,
    onDecision: (info) => decisions.push(info),
    onError: (error) => errors.push(error),
  })
  return { listener, spoken, decisions, errors, config }
}

const session = (id: string, header: Record<string, unknown> = { delegationDepth: 0 }) => ({ id, header })

/** 足够长（> minChars 30）的一句收尾，避免测试因为「太短」被静默。 */
const LONG = '这一轮把接口改好了，单元测试和真机都过了一遍，日志也看过了，你可以看一下要不要合并到主干。'

test('一轮正常结束：把这一轮的话洗干净念出来', () => {
  clock = 10_000
  const { listener, spoken, decisions } = harness()
  listener(session('s1'), assistantEvent(1, '我把 \`retry\` 改成三次退避了，测试都过了，可以直接上线，你看要不要现在合并。'))
  listener(session('s1'), assistantEvent(1, '另外把日志里那个路径 /Users/demo/a.ts 删了。', ['edit', 'bash']))
  listener(session('s1'), turnEndEvent(1, 'completed'))

  assert.equal(spoken.length, 1)
  const text = spoken[0] ?? ''
  assert.equal(text.includes('`'), false)
  assert.equal(text.includes('/Users'), false)
  assert.match(text, /三次退避/)
  assert.equal(decisions.at(-1)?.decision.action, 'speak')
  assert.deepEqual(decisions.at(-1)?.tools, ['edit', 'bash'])
})

test('回复太短：不开口', () => {
  clock = 10_000
  const { listener, spoken, decisions } = harness()
  listener(session('s2'), assistantEvent(1, '好的。'))
  listener(session('s2'), turnEndEvent(1, 'completed'))
  assert.deepEqual(spoken, [])
  assert.equal(decisions.at(-1)?.decision.action, 'silent')
})

test('报错轮：念一句短提示，不去念报错原文', () => {
  clock = 10_000
  const { listener, spoken } = harness()
  listener(session('s3'), assistantEvent(1, '正在跑测试。'))
  listener(session('s3'), turnEndEvent(1, 'error', 'ECONNRESET at /Users/demo/x.ts'))
  assert.deepEqual(spoken, ['这一轮出错了，需要你看一眼。'])
})

test('子代理会话默认不出声，打开开关才播', () => {
  clock = 10_000
  const quiet = harness()
  quiet.listener(session('s4', { origin: 'subagent', delegationDepth: 1 }), assistantEvent(1, LONG))
  quiet.listener(session('s4', { origin: 'subagent', delegationDepth: 1 }), turnEndEvent(1, 'completed'))
  assert.deepEqual(quiet.spoken, [])

  clock = 10_000
  const loud = harness({ announceSubagent: true })
  loud.listener(session('s5', { delegationDepth: 1 }), assistantEvent(1, LONG))
  loud.listener(session('s5', { delegationDepth: 1 }), turnEndEvent(1, 'completed'))
  assert.equal(loud.spoken.length, 1)
})

test('同一会话 2 秒内连播只出声一次；不同会话互不影响', () => {
  clock = 10_000
  const { listener, spoken } = harness()
  const long = LONG

  listener(session('a'), assistantEvent(1, long))
  listener(session('a'), turnEndEvent(1, 'completed'))
  clock = 10_800 // 800ms 后
  listener(session('a'), assistantEvent(2, long))
  listener(session('a'), turnEndEvent(2, 'completed'))
  // 另一个会话同一时刻结束，应该照常播
  listener(session('b'), assistantEvent(1, long))
  listener(session('b'), turnEndEvent(1, 'completed'))

  assert.equal(spoken.length, 2, 'a 的第 2 轮被去抖，b 不受影响')
  clock = 13_000 // 3 秒后，a 又能播了
  listener(session('a'), assistantEvent(3, long))
  listener(session('a'), turnEndEvent(3, 'completed'))
  assert.equal(spoken.length, 3)
})

test('总开关关闭：一条都不播', () => {
  clock = 10_000
  const { listener, spoken } = harness({ enabled: false })
  listener(session('s6'), assistantEvent(1, LONG))
  listener(session('s6'), turnEndEvent(1, 'completed'))
  assert.deepEqual(spoken, [])
})

test('脏事件不抛、不播', () => {
  clock = 10_000
  const { listener, spoken, errors } = harness()
  for (const bad of [null, undefined, {}, { type: 'assistant/message' }, { type: 'turn/end', data: {} }, { type: 'weird' }]) {
    listener(session('s7'), bad)
    listener(null, bad)
  }
  assert.deepEqual(spoken, [])
  assert.deepEqual(errors, [])
})

test('播放失败不会把异常抛回事件总线', async () => {
  clock = 10_000
  const errors: unknown[] = []
  const listener = createSessionListener({
    config: resolveConfig({ enabled: true }),
    speak: async () => {
      throw new Error('afplay 挂了')
    },
    now: () => clock,
    onError: (error) => errors.push(error),
  })
  listener(session('s8'), assistantEvent(1, LONG))
  listener(session('s8'), turnEndEvent(1, 'completed'))
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(errors.length, 1)
  assert.match(String((errors[0] as Error).message), /afplay/)
})
