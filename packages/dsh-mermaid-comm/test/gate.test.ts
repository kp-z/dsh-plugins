/**
 * L3 输出闸（gate.ts）单测：钉死 DSH 0.2.x 的 surface replace 契约。
 *
 * 为什么单独测形状：这几条约束只在**运行时**校验，类型层面抓不到（gate 与 session 的
 * 交互参数是 any）。0.3.1 的闸门就是因为在 0.2.x 上用了旧形状，异常被 try/catch 吞掉、
 * 闸门静默失效，而 tsc 全绿。所以这里断言 append 的入参本身：
 * - surfaceOp 用 startSeq / endSeq（0.1.x 的 start / end 已移除，且只允许这三个键）
 * - assistant/message 禁止携带 sourceEventSeqs
 * - data 必须带 provider stream（缺了会让会话恢复失败，比不修图严重得多）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReplacement, createOutputGateHandler } from '../lib/gate.js'

interface AppendCall {
  type: string
  data: any
  opts: any
}

function fakeSession() {
  const calls: AppendCall[] = []
  return {
    calls,
    append(type: string, data: any, opts: any) {
      calls.push({ type, data, opts })
      return { type, seq: 99 }
    },
  }
}

/** 校验器替身：统一报「改好了」，built 是重写后的源码（不含围栏）。 */
const rewriteTo = (built: string) => async () => ({
  ok: true,
  built,
  fixes: ['Unicode 箭头已改写为 ASCII'],
  errors: [],
  hints: [],
  type: 'flowchart',
})

/** 校验器替身：判定没得改（ok 且无 fixes）。 */
const cleanAlready = async () => ({
  ok: true,
  built: 'A --> B',
  fixes: [],
  errors: [],
  hints: [],
  type: 'flowchart',
})

function gateEvent(overrides: Record<string, unknown> = {}) {
  const stream = [{ kind: 'text-delta', text: '看这张图' }]
  const base = {
    type: 'assistant/message',
    seq: 7,
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 2,
      message: {
        id: 'm1',
        role: 'assistant',
        source: { kind: 'model', provider: 'deepseek', model: 'flash' },
        content: [{ type: 'text', text: '看这张图\n\u0060\u0060\u0060mermaid\nA \u2192 B\n\u0060\u0060\u0060' }],
      },
      stream,
      usage: { inputTokens: 1, outputTokens: 2 },
    },
  }
  return { event: { ...base, ...overrides } as any, stream }
}

test('闸门：replace 用 startSeq/endSeq，且不带 sourceEventSeqs', async () => {
  const session = fakeSession()
  const handle = createOutputGateHandler({ verify: rewriteTo('A --> B') })
  const { event, stream } = gateEvent()

  await handle(session, event)

  assert.equal(session.calls.length, 1, '应写入一次替换事件')
  const call = session.calls[0]!
  assert.equal(call.type, 'assistant/message')
  assert.deepEqual(call.opts.surfaceOp, { op: 'replace', startSeq: 7, endSeq: 7 })
  assert.equal('sourceEventSeqs' in call.opts, false, '0.2.x 禁止 assistant/message 带 sourceEventSeqs')
})

test('闸门：替换事件保留 provider stream 与 usage（否则会话恢复会炸）', async () => {
  const session = fakeSession()
  const handle = createOutputGateHandler({ verify: rewriteTo('A --> B') })
  const { event, stream } = gateEvent()

  await handle(session, event)

  const data = session.calls[0]!.data
  assert.deepEqual(data.stream, stream, 'stream 必须原子保留')
  assert.deepEqual(data.usage, { inputTokens: 1, outputTokens: 2 })
  assert.equal(data.turn, 1)
  assert.equal(data.step, 2)
  assert.equal(data.gateFixed, true, '循环守卫标记')
})

test('闸门：正文被换成重写后的干净图，并在移除坏块时附注', async () => {
  const session = fakeSession()
  const handle = createOutputGateHandler({ verify: rewriteTo('A --> B') })
  const { event } = gateEvent()

  await handle(session, event)

  const text = session.calls[0]!.data.message.content[0].text as string
  assert.ok(text.includes('\u0060\u0060\u0060mermaid\nA --> B\n\u0060\u0060\u0060'), '写成干净图: ' + text)
  assert.ok(!text.includes('\u2192'), 'Unicode 箭头应已消失')
})

test('闸门：缺 stream 的旧事件不替换（宁可少修，不能写坏日志）', async () => {
  const session = fakeSession()
  const warned: unknown[] = []
  const handle = createOutputGateHandler({ verify: rewriteTo('A --> B'), warn: (...a: unknown[]) => warned.push(a) })
  const { event } = gateEvent()
  delete event.data.stream

  await handle(session, event)

  assert.equal(session.calls.length, 0)
  assert.equal(warned.length, 1, '应留下可诊断的 warn')
})

test('闸门：已处理过的替换事件不再二次处理', async () => {
  const session = fakeSession()
  const handle = createOutputGateHandler({ verify: rewriteTo('A --> B') })
  const { event } = gateEvent()
  event.data.gateFixed = true

  await handle(session, event)
  assert.equal(session.calls.length, 0)
})

test('闸门：校验通过且无需改写时不产生替换', async () => {
  const session = fakeSession()
  const handle = createOutputGateHandler({ verify: cleanAlready })
  const { event } = gateEvent()

  await handle(session, event)
  assert.equal(session.calls.length, 0)
})

test('buildReplacement：非法 seq / 缺 stream 一律返回 undefined', () => {
  const msg = { id: 'm1', role: 'assistant', content: [] }
  assert.equal(buildReplacement({ seq: 3, data: {} }, msg), undefined, '缺 stream')
  assert.equal(buildReplacement({ seq: -1, data: { stream: [] } }, msg), undefined, 'seq 非法')
  assert.deepEqual(
    buildReplacement({ seq: 3, data: { turn: 0, step: 0, stream: [] } }, msg)!.opts.surfaceOp,
    { op: 'replace', startSeq: 3, endSeq: 3 },
  )
})
