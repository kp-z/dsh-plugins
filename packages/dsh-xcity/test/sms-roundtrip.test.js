/**
 * 短信往返（R537）：玩家发一条 → 会话（假）回一句 → 世界线程里有回复，signal 前进。
 *
 * 为什么要有这条测试：这是全链路里唯一没有测试的一段。写回线程原来只由 index.ts
 * 的 `session/event` 内联接线驱动（observe → appendIncoming），没有测试从"玩家发一条"
 * 走到"线程里有回复"，所以"发出去、收不到回复"只能靠重启手点，而且分不清断在哪一段：
 * 投递失败？会话没绑定？回复回调没接上？这里把三段**真代码**用假会话拼起来：
 *
 *   ① SmsStore.send → responder → respondViaSession（真；形状与 requestId 都要对）
 *   ② 假宿主按 DSH **真实事件形状**回放：turn/start → step/start → user/message → assistant/message
 *      （user/message 不带 turn——这是 .dsh/sessions/xcity-rolelin-* 里的实测形状，
 *       之前的测试一律手写 {turn: N}，把这层差异盖住了）
 *   ③ createSmsReplyTracker（真；index.ts 用的同一个）认轮次 → 写回 →
 *      signal() / projectPhone() 水位
 *
 * 不联网、不调模型：fakeSession 只做"受理 prompt"和"把事件按形状回放"。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SmsStore, SMS_REPLY_TIMEOUT_MS } from '../lib/adapters/slowvale/sms.js'
import { projectPhone } from '../lib/adapters/slowvale/project.js'
import { respondViaSession } from '../lib/adapters/slowvale/respond-sms.js'
import { createSmsReplyTracker } from '../lib/adapters/slowvale/session-events.js'
import { deliverInitiative } from '../lib/adapters/slowvale/initiative-delivery.js'

const TTL = 10 * 60 * 1000
const names = { 'agent-1': '林野' }
const at = (seconds) => new Date(Date.parse('2026-11-28T10:00:00.000Z') + seconds * 1000).toISOString()

/**
 * 假会话：DSH 会话的替身。prompt 只"受理"（真实宿主也是返回即受理，受理 ≠ 有回复），
 * events() 把一次回复展开成真实形状的事件序列，交给接线函数回放。
 */
function fakeSession(sessionId) {
  const prompts = []
  const host = {
    sessionId,
    prompts,
    prompt: async (payload) => { prompts.push(payload) },
    /**
     * 一次回复的事件序列。turn/start 带轮次，user/message **不带**（真实形状），
     * 轮次靠前一条 turn/start 给 tracker —— 顺序错了回复就认不回来。
     */
    events(turn, replyText) {
      const sent = prompts[prompts.length - 1]
      const promptText = sent.content[0].text
      return [
        ['turn/start', { turn }],
        ['step/start', { turn, step: 1 }],
        ['user/message', { content: [{ type: 'text', text: promptText }], source: { kind: 'user', rpcId: sent.requestId }, role: 'user' }],
        ['assistant/message', { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: replyText }] } }],
      ]
    },
  }
  return host
}

/**
 * index.ts:1066-1085 的短信接线（observe → appendIncoming），压成一个函数：
 * 先喂 tracker，认出回复就写回线程。写回的三步与 server.ts:643-657 的
 * Bridge.appendIncoming 一致（ensureThread + append；水位推送在桥的推送循环里，这里不重复）。
 */
function wireSessionEvents(sms, tracker) {
  return (sessionId, type, data) => {
    const message = data?.message
    const content = type === 'user/message' ? data?.content ?? message?.content : message?.content
    const blocks = Array.isArray(content) ? content : []
    const seen = tracker.observe(sessionId, type, data, blocks)
    if (!seen?.reply) return seen
    const peerRoleId = seen.reply.peerRoleId
    const thread = sms.ensureThread(peerRoleId, names[peerRoleId] ?? peerRoleId)
    sms.append({
      threadId: thread.threadId,
      senderRoleId: thread.peerRoleId,
      senderName: thread.peerName,
      content: seen.reply.text,
      sentAt: at(1),
      isSelf: false,
    })
    return seen
  }
}

/** index.ts:1401-1447 的 respondSms：把短信投进会话（宿主错误在这里被吞成 null）。 */
function responderOf(host, tracker) {
  return async (input) => {
    try {
      return await respondViaSession(
        { peerRoleId: input.peerRoleId, content: input.content },
        {
          characterOf: (peerRoleId) => (peerRoleId === 'agent-1' ? 'role.lin' : null),
          sessionOf: (characterId) => (characterId === 'role.lin' ? host.sessionId : null),
          onForward: (peerRoleId, sessionId, text) => tracker.track(peerRoleId, sessionId, text, 'player-sms'),
          prompt: host.prompt,
        },
        () => 'n1',
      )
    } catch {
      return null
    }
  }
}

test('玩家发一条 → 会话同轮回一句 → 线程里有回复，rowId/unread 前进', async () => {
  const sms = new SmsStore()
  const thread = sms.ensureThread('agent-1', '林野')
  const tracker = createSmsReplyTracker(TTL)
  const emit = wireSessionEvents(sms, tracker)
  const host = fakeSession('session-lin')
  sms.useResponder(responderOf(host, tracker))

  await sms.send({
    threadId: thread.threadId,
    senderRoleId: 'player',
    senderName: '我',
    content: '在吗？',
    sentAt: at(0),
    tick: 42,
  })

  // ① 投递这一跳：会话里收到的就是玩家原话 + 回复格式 + 能唯一定位的投递编号。
  assert.equal(host.prompts.length, 1, '短信必须真的投进会话')
  const prompt = host.prompts[0]
  assert.equal(prompt.sessionId, 'session-lin')
  assert.equal(prompt.mode, 'queue')
  assert.equal(prompt.content[0].type, 'text')
  assert.ok(prompt.content[0].text.includes('在吗？'), '原话要在投递文本里')
  assert.ok(prompt.content[0].text.includes('<xcity-reply>'), '还要带回复格式要求')
  assert.ok(prompt.content[0].text.endsWith(prompt.requestId), '投递编号在末尾，回复靠它编号对账')

  // ② 投递完成但还没回：世界侧给"在等"，不是静默。
  assert.equal(sms.get(thread.threadId).reply.state, 'awaiting')
  assert.equal(sms.signal(Date.parse(at(30))).reply.state, 'awaiting')

  // ③ 会话侧回一句（真实事件形状：user/message 不带 turn）。
  const events = host.events(7, '<xcity-reply>在呢，刚在忙。</xcity-reply>')
  assert.equal('turn' in events[2][1], false, '这条测试盯的就是"user/message 不带 turn"这个真实形状')
  for (const [type, data] of events) emit(host.sessionId, type, data)

  const after = sms.get(thread.threadId)
  assert.deepEqual(after.messages.map((m) => m.content), ['在吗？', '在呢，刚在忙。'], '回复要写回线程')
  assert.equal(after.messages[1].isSelf, false)
  assert.equal(after.messages[1].messageRowId, 2, '行号单调递增')
  assert.equal(after.unread, 1, '角色回的算未读')
  assert.equal(after.reply, null, '回复到了就销账，不留"还在等"')

  const signal = sms.signal(Date.parse(at(30)))
  assert.equal(signal.rowId, 2, '前端靠这个值判断要不要重拉线程')
  assert.equal(signal.unread, 1)
  assert.equal(signal.reply, null)

  const phone = projectPhone(signal)
  assert.equal(phone.sms.player_thread_message_row_id, 2)
  assert.equal(phone.sms.player_thread_unread_count, 1)
  assert.equal(phone.sms.reply, null)
})

test('R537：世界没接会话服务 → 线程留下 failed 结论，不静默', async () => {
  const sms = new SmsStore()
  const thread = sms.ensureThread('agent-1', '林野')
  await sms.send({
    threadId: thread.threadId,
    senderRoleId: 'player',
    senderName: '我',
    content: '在吗？',
    sentAt: at(0),
    tick: 42,
  })
  const reply = sms.get(thread.threadId).reply
  assert.equal(reply.state, 'failed')
  assert.equal(reply.reason, 'no-responder', '原因要能读出来')
  assert.equal(reply.messageRowId, 1, '要能对上哪一句话没发出去')
  // 消息本身照旧落库（玩家的话不能因为没会话就丢）
  assert.equal(sms.get(thread.threadId).messages.length, 1)

  const phone = projectPhone(sms.signal(Date.parse(at(0))))
  assert.deepEqual(phone.sms.reply, { state: 'failed', message_row_id: 1, since: at(0), reason: 'no-responder' })
})

test('R537：投进去了但没人回（含会话没绑定）→ awaiting，超过阈值变 timed-out', async () => {
  // 这两种情况在适配层看起来一样：index.ts 的 catch 把 respond-sms 的失败也压成 null，
  // 所以世界侧分不清"没绑会话"和"投了没回"。这里如实记录这个边界：
  // 它们都会先显示 awaiting，过了与 tracker 同长的 TTL 变成 timed-out（唯一能给出的显式结论）。
  const sms = new SmsStore()
  const thread = sms.ensureThread('agent-1', '林野')
  let prompted = 0
  sms.useResponder(async (input) =>
    respondViaSession(
      { peerRoleId: input.peerRoleId, content: input.content },
      {
        // 角色存在、会话不存在 = 没绑定。
        characterOf: () => 'role.lin',
        sessionOf: () => null,
        prompt: async () => { prompted += 1 },
      },
    ),
  )

  await sms.send({ threadId: thread.threadId, senderRoleId: 'player', senderName: '我', content: '在吗？', sentAt: at(0), tick: 42 })
  assert.equal(prompted, 0, '没绑会话就什么都没投')
  assert.equal(sms.get(thread.threadId).reply.state, 'awaiting', '世界侧至少要说"在等"')

  const stillWaiting = sms.signal(Date.parse(at(0)) + SMS_REPLY_TIMEOUT_MS - 1000)
  assert.equal(stillWaiting.reply.state, 'awaiting')
  const timedOut = sms.signal(Date.parse(at(0)) + SMS_REPLY_TIMEOUT_MS + 1)
  assert.equal(timedOut.reply.state, 'timed-out')
  assert.equal(timedOut.reply.messageRowId, 1)
  assert.equal(projectPhone(timedOut).sms.reply.state, 'timed-out', '结论要能投影到世界快照')
  assert.equal(SMS_REPLY_TIMEOUT_MS, TTL, '必须与 index.ts 的 tracker TTL 一致，否则会话侧早丢、世界侧还在等')
})

test('R537：主动短信不退化——照旧投递，回复照旧写回线程', async () => {
  const sms = new SmsStore()
  const thread = sms.ensureThread('agent-1', '林野')
  const tracker = createSmsReplyTracker(TTL)
  const emit = wireSessionEvents(sms, tracker)
  const host = fakeSession('session-lin')
  const sent = []

  const delivered = await deliverInitiative('agent-1', '想找人说说话', 99, {
    characterOf: () => 'role.lin',
    sessionOf: () => 'session-lin',
    dayContext: () => [],
    track: (agentId, sessionId, text, kind) => tracker.track(agentId, sessionId, text, kind),
    prompt: async (payload) => { sent.push(payload); await host.prompt(payload) },
  })
  assert.equal(delivered, true)
  assert.equal(sent.length, 1)
  assert.ok(sent[0].content[0].text.includes('想找人说说话'), '念头要进投递文本')
  assert.ok(sent[0].content[0].text.includes('主动短信编号：xcity-init:session-lin:99'))
  assert.equal(sms.get(thread.threadId).reply, null, '主动短信不是玩家发的，不挂"等回复"状态')

  // 主动短信走同一条 tracker 接线（kind=initiative），回复照旧写回线程。
  for (const [type, data] of host.events(3, '<xcity-reply>忙了一整天，聊聊？</xcity-reply>')) {
    emit(host.sessionId, type, data)
  }
  const after = sms.get(thread.threadId)
  assert.deepEqual(after.messages.map((m) => m.content), ['忙了一整天，聊聊？'], '主动短信要进线程')
  assert.equal(after.unread, 1)
  assert.equal(sms.signal(Date.parse(at(30))).rowId, 1, '水位要前进，前端才会重拉')
  assert.equal(after.reply, null)
})
