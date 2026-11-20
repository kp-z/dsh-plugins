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

/** 用户发的话（真实形状：data.content[].text + data.source.kind）。 */
function userEvent(turn: number, text: string, source = 'user') {
  return { type: 'user/message', seq: 0, time: 0, data: { turn, content: [{ type: 'text', text }], source: { kind: source }, role: 'user' } }
}

/** 一次工具结果（isError 决定成没成）。 */
function toolResultEvent(callId: string | number, ok: boolean) {
  return { type: 'tool/result', seq: 0, time: 0, data: { message: { role: 'tool', toolCallId: String(callId), isError: !ok } } }
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

/** 文案生成是异步的（S3 可能要走模型），断言前先把微任务跑完。 */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** 足够长（> minChars 30）的一句收尾，避免测试因为「太短」被静默。 */
const LONG = '这一轮把接口改好了，单元测试和真机都过了一遍，日志也看过了，你可以看一下要不要合并到主干。'

test('一轮正常结束：把这一轮的话洗干净念出来', async () => {
  clock = 10_000
  const { listener, spoken, decisions } = harness()
  listener(session('s1'), assistantEvent(1, '我把 \`retry\` 改成三次退避了，测试都过了，可以直接上线，你看要不要现在合并。'))
  listener(session('s1'), assistantEvent(1, '另外把日志里那个路径 /Users/demo/a.ts 删了。', ['edit', 'bash']))
  listener(session('s1'), turnEndEvent(1, 'completed'))
  await settle()

  assert.equal(spoken.length, 1)
  const text = spoken[0] ?? ''
  assert.equal(text.includes('`'), false)
  assert.equal(text.includes('/Users'), false)
  assert.match(text, /三次退避/)
  assert.equal(decisions.at(-1)?.decision.action, 'speak')
  assert.deepEqual(decisions.at(-1)?.tools, ['edit', 'bash'])
})

test('回复太短：不开口', async () => {
  clock = 10_000
  const { listener, spoken, decisions } = harness()
  listener(session('s2'), assistantEvent(1, '好的。'))
  listener(session('s2'), turnEndEvent(1, 'completed'))
  await settle()
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

test('子代理会话默认不出声，打开开关才播', async () => {
  clock = 10_000
  const quiet = harness()
  quiet.listener(session('s4', { origin: 'subagent', delegationDepth: 1 }), assistantEvent(1, LONG))
  quiet.listener(session('s4', { origin: 'subagent', delegationDepth: 1 }), turnEndEvent(1, 'completed'))
  await settle()
  assert.deepEqual(quiet.spoken, [])

  clock = 10_000
  const loud = harness({ announceSubagent: true })
  loud.listener(session('s5', { delegationDepth: 1 }), assistantEvent(1, LONG))
  loud.listener(session('s5', { delegationDepth: 1 }), turnEndEvent(1, 'completed'))
  await settle()
  assert.equal(loud.spoken.length, 1)
})

test('同一会话 2 秒内连播只出声一次；不同会话互不影响', async () => {
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
  await settle()

  assert.equal(spoken.length, 2, 'a 的第 2 轮被去抖，b 不受影响')
  clock = 13_000 // 3 秒后，a 又能播了
  listener(session('a'), assistantEvent(3, long))
  listener(session('a'), turnEndEvent(3, 'completed'))
  await settle()
  assert.equal(spoken.length, 3)
})

test('总开关关闭：一条都不播', async () => {
  clock = 10_000
  const { listener, spoken } = harness({ enabled: false })
  listener(session('s6'), assistantEvent(1, LONG))
  listener(session('s6'), turnEndEvent(1, 'completed'))
  await settle()
  assert.deepEqual(spoken, [])
})

test('文案生成器拿到三样原料：用户原话、正文、做过的事', async () => {
  clock = 10_000
  const inputs: any[] = []
  const spoken: string[] = []
  const listener = createSessionListener({
    config: resolveConfig({ enabled: true }),
    speak: async (text) => { spoken.push(text) },
    summarize: async (input) => {
      inputs.push(input)
      return { text: '模型写的一句话。' }
    },
    now: () => clock,
  })
  listener(session('s9'), userEvent(1, '把接口的返回值改一下，顺便跑测试'))
  listener(session('s9'), assistantEvent(1, LONG, ['read', 'edit']))
  listener(session('s9'), turnEndEvent(1, 'completed'))
  await settle()

  assert.equal(inputs.length, 1)
  const input = inputs[0]
  assert.equal(input.ask, '把接口的返回值改一下，顺便跑测试', '用户的要什么必须传到')
  assert.match(input.text, /这一轮把接口改好了/)
  assert.deepEqual(input.tools, ['read', 'edit'])
  assert.equal(input.actions.length, 2)
  assert.equal(input.actions[0].name, 'read')
  assert.equal(input.kind, 'completed')
  assert.deepEqual(spoken, ['模型写的一句话。'])
})

test('审批策略那类 user/message 不算「用户说的话」', async () => {
  clock = 10_000
  const inputs: any[] = []
  const listener = createSessionListener({
    config: resolveConfig({ enabled: true }),
    speak: async () => {},
    summarize: async (input) => { inputs.push(input); return { text: '好' } },
    now: () => clock,
  })
  listener(session('s9b'), userEvent(1, '审批策略已改为不询问', 'user-approval'))
  listener(session('s9b'), assistantEvent(1, LONG))
  listener(session('s9b'), turnEndEvent(1, 'completed'))
  await settle()
  assert.equal(inputs[0]?.ask, '', '审批变更不该被当成需求')
})

test('同一轮的 turn/end 重复到达：只播一次', async () => {
  clock = 10_000
  const { listener, spoken, decisions } = harness()
  listener(session('s10'), assistantEvent(1, LONG))
  listener(session('s10'), turnEndEvent(1, 'completed'))
  await settle()
  listener(session('s10'), turnEndEvent(1, 'completed'))
  await settle()
  assert.equal(spoken.length, 1)
  assert.equal(decisions.at(-1)?.decision.action, 'silent')
})

test('总开关是活的：运行时改 config.enabled 立刻生效（对话框按钮就是改它）', async () => {
  clock = 10_000
  const { listener, spoken, config } = harness()
  listener(session('s12'), assistantEvent(1, LONG))
  listener(session('s12'), turnEndEvent(1, 'completed'))
  await settle()
  assert.equal(spoken.length, 1)

  config.enabled = false
  clock = 20_000
  listener(session('s12'), assistantEvent(2, LONG))
  listener(session('s12'), turnEndEvent(2, 'completed'))
  await settle()
  assert.equal(spoken.length, 1, '关掉之后一声不响')

  config.enabled = true
  clock = 30_000
  listener(session('s12'), assistantEvent(3, LONG))
  listener(session('s12'), turnEndEvent(3, 'completed'))
  await settle()
  assert.equal(spoken.length, 2, '再打开又能播')
})

test('安静时段：落在区间里就不播，出了区间照播', async () => {
  clock = 10_000
  const quiet = new Date(clock)
  const from = String(quiet.getHours()).padStart(2, '0')
  const to = String((quiet.getHours() + 1) % 24).padStart(2, '0')

  const { listener, spoken } = harness({ quietHours: `${from}:00-${to}:00` })
  listener(session('s13'), assistantEvent(1, LONG))
  listener(session('s13'), turnEndEvent(1, 'completed'))
  await settle()
  assert.deepEqual(spoken, [], '安静时段不该开口')

  // 两小时后：不在区间里（跨零点的写法也由 inQuietHours 处理）
  clock = 10_000 + 2 * 60 * 60 * 1000
  listener(session('s13'), assistantEvent(2, LONG))
  listener(session('s13'), turnEndEvent(2, 'completed'))
  await settle()
  assert.equal(spoken.length, 1, '出了安静时段就该播')
})

test('文案生成失败不吞异常：交给 onError', async () => {
  clock = 10_000
  const errors: unknown[] = []
  const listener = createSessionListener({
    config: resolveConfig({ enabled: true }),
    speak: async () => {},
    summarize: async () => { throw new Error('模型彻底挂了') },
    now: () => clock,
    onError: (error) => errors.push(error),
  })
  listener(session('s11'), assistantEvent(1, LONG))
  listener(session('s11'), turnEndEvent(1, 'completed'))
  await settle()
  await settle()
  assert.equal(errors.length, 1)
  assert.match(String((errors[0] as Error).message), /模型彻底挂了/)
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
  await settle()
  await settle()
  assert.equal(errors.length, 1)
  assert.match(String((errors[0] as Error).message), /afplay/)
})
