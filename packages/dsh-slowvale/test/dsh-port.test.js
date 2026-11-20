
/**
 * DSH 端口：用假 ctx 验接线逻辑（发话请求形状、事件匹配、超时）。
 *
 * 这一层不测模型：真机验证放到 H2.5，先用假事件流把"线有没有接错"钉住。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createDshPort, defaultExtractReply } from '../lib/runtime/dsh-port.js'
import { SessionError } from '../lib/runtime/session-port.js'

function makeCtx() {
  const handlers = []
  const prompts = []
  const ctx = {
    sessionController: {
      async prompt(request) {
        prompts.push(request)
        return { accepted: true }
      },
    },
    on(name, callback) {
      handlers.push({ name, callback })
      return () => {}
    },
  }
  return {
    ctx,
    prompts,
    emit(sessionId, event) {
      for (const handler of handlers) if (handler.name === 'session/event') handler.callback({ id: sessionId }, event)
    },
  }
}

const assistant = (text) => ({ type: 'assistant/message', message: { content: [{ type: 'text', text }] } })

test('缺服务时返回 undefined（让上层给人话原因）', () => {
  assert.equal(createDshPort(undefined), undefined)
  assert.equal(createDshPort({ on() {} }), undefined)
  assert.equal(createDshPort({ sessionController: { prompt() {} } }), undefined)
})

test('发话：prompt 请求带对 sessionId 与文本，等事件回来的文本', async () => {
  const { ctx, prompts, emit } = makeCtx()
  const port = createDshPort(ctx)
  assert.ok(port)
  port.attach({ characterId: 'role.lin', channel: 'work', contextText: '你是林野' }, 'sess-1')
  const reply = port.say('sess-1', '这单能接吗')
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(prompts[0].sessionId, 'sess-1')
  assert.equal(prompts[0].mode, 'queue')
  assert.deepEqual(prompts[0].content, [{ type: 'text', text: '这单能接吗' }])
  emit('sess-1', assistant('行。'))
  assert.equal(await reply, '行。')
})

test('别的会话的事件不会串到这次回复上', async () => {
  const { ctx, emit } = makeCtx()
  const port = createDshPort(ctx)
  assert.ok(port)
  port.attach({ characterId: 'role.lin', channel: 'work', contextText: '' }, 'sess-1')
  port.attach({ characterId: 'role.mei', channel: 'work', contextText: '' }, 'sess-2')
  const first = port.say('sess-1', '在吗')
  const second = port.say('sess-2', '在吗')
  await new Promise((resolve) => setTimeout(resolve, 5))
  emit('sess-2', assistant('在呀～'))
  emit('sess-1', assistant('在。'))
  assert.equal(await first, '在。')
  assert.equal(await second, '在呀～')
})

test('超时按失败处理，不返回空串', async () => {
  const { ctx } = makeCtx()
  const port = createDshPort(ctx, { replyTimeoutMs: 20 })
  assert.ok(port)
  port.attach({ characterId: 'role.lin', channel: 'work', contextText: '' }, 'sess-1')
  await assert.rejects(() => port.say('sess-1', '在吗'), (error) => error instanceof SessionError && /超时/.test(error.message))
})

test('open 不会自己造会话：没 attach 就如实报错；attach 后直接接上', async () => {
  const { ctx } = makeCtx()
  const port = createDshPort(ctx)
  assert.ok(port)
  await assert.rejects(
    () => port.open({ characterId: 'role.lin', channel: 'work', contextText: '' }),
    (error) => error instanceof SessionError && /attach/.test(error.message),
  )
  port.attach({ characterId: 'role.lin', channel: 'work', contextText: '' }, 'sess-1')
  assert.deepEqual(await port.open({ characterId: 'role.lin', channel: 'work', contextText: '' }), { sessionId: 'sess-1' })
})

test('默认提取器只认 assistant 消息，别的类型返回 null', () => {
  assert.equal(defaultExtractReply(assistant('好')), '好')
  assert.equal(defaultExtractReply({ type: 'user/message', message: { content: [{ text: '哦' }] } }), null)
  assert.equal(defaultExtractReply({ type: 'assistant/message', message: { content: [] } }), null)
})
