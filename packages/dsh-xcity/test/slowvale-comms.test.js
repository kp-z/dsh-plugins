/**
 * 沟通层与绑定的单元测试。
 *
 * 盯三件容易悄悄坏掉的事：
 * 1. 短信"收下即回执"——没 responder 时也必须落库；
 * 2. 绑定表 1:1 且归档不删行（换会话时聊天记录不丢）；
 * 3. visual 包的两个硬约束（payload.tick_marker 与信封一致、kind=independent 带 actorId）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SmsStore } from '../lib/adapters/slowvale/sms.js'
import { loadXcityBindings, characterOfSession } from '../lib/adapters/slowvale/xcity.js'
import { independentDialogue, walkBeat, workBeat, independentTimeline, walkPathOf, pickWalkStarts } from '../lib/adapters/slowvale/visual.js'

test('短信：没有 responder 时也要收下（回执语义）', async () => {
  const store = new SmsStore()
  store.ensureThread('agent-2', '小满')
  await store.send({
    threadId: 'thread:agent-2',
    senderRoleId: 'agent-1',
    senderName: '我',
    content: '在吗',
    sentAt: 't0',
    tick: 1,
  })
  const thread = store.get('thread:agent-2')
  assert.equal(thread?.messages.length, 1)
  assert.equal(thread?.messages[0]?.content, '在吗')
  assert.equal(thread?.unread, 0, '自己发的不算未读')
})

test('短信：responder 回的话会进线程并算未读', async () => {
  const store = new SmsStore()
  store.ensureThread('agent-2', '小满')
  store.useResponder(async () => '在的呀')
  await store.send({
    threadId: 'thread:agent-2',
    senderRoleId: 'agent-1',
    senderName: '我',
    content: '在吗',
    sentAt: 't0',
    tick: 1,
  })
  const thread = store.get('thread:agent-2')
  assert.equal(thread?.messages.length, 2)
  assert.equal(thread?.messages[1]?.content, '在的呀')
  assert.equal(thread?.unread, 1)
  store.markRead('thread:agent-2')
  assert.equal(store.get('thread:agent-2')?.unread, 0)
})

test('绑定投影：只认活着的行，归档的不算', () => {
  const bindings = loadXcityBindings('/nonexistent/bindings.json')
  assert.deepEqual(bindings, [], '文件不存在时返回空而不是抛错')
  assert.equal(characterOfSession(bindings, 's1'), null)
})

test('visual：tick_marker 与 cursor 必须一致，且带 actorId', () => {
  const packet = independentDialogue({
    epoch: 'epoch-w1',
    seq: 7,
    tickMarker: 'tick-42',
    actorId: 'agent-1',
    beat: { text: '今天风不小。' },
  })
  assert.equal(packet['tick_marker'], 'tick-42')
  assert.equal(packet['seq'], 7)
  assert.equal(packet['kind'], 'independent')
  assert.equal(packet['actorId'], 'agent-1')
  const beats = packet['beats']
  assert.equal(beats[0]?.dialogue?.text, '今天风不小。')
})

test('walk / work beat：body.action 只能是动作表里的值，路径按点给', () => {
  const walk = walkBeat([{ x: 1, y: 2 }, { x: 3, y: 4 }], 2000)
  assert.deepEqual(walk.body, { action: 'walk', path: [{ x: 1, y: 2 }, { x: 3, y: 4 }] })
  assert.equal(walk.duration_ms, 2000)

  const work = workBeat()
  assert.deepEqual(work.body, { action: 'work' })
  assert.equal(work.duration_ms, undefined, '不给时长就用前端默认')

  const packet = independentTimeline({
    epoch: 'epoch-w1', seq: 3, tickMarker: 'tick-9', actorId: 'agent-1',
    beats: [walk, work],
  })
  assert.equal(packet.tick_marker, 'tick-9')
  assert.equal(packet.kind, 'independent')
  assert.equal(packet.actorId, 'agent-1')
  assert.equal(packet.beats.length, 2)
})

test('walkPathOf：世界路径 (x,z) 直接映射成 beat 的 (x,y)，不做缩放', () => {
  const agent = { path: [{ x: 10, z: 20 }, { x: 30, z: 40 }] }
  assert.deepEqual(walkPathOf(agent), [{ x: 10, y: 20 }, { x: 30, y: 40 }])
  assert.deepEqual(walkPathOf({}), [], '没有路径就是空数组，不是 undefined')
})

test('pickWalkStarts：只在「路径从无到有」时发一次，走路途中不重复发', () => {
  const path = [{ x: 1, z: 1 }, { x: 2, z: 2 }]
  let prev = new Map()

  const first = pickWalkStarts(prev, [{ id: 'a', path }])
  assert.equal(first.started.length, 1)
  assert.equal(first.started[0].agentId, 'a')
  assert.deepEqual(first.started[0].path, [{ x: 1, y: 1 }, { x: 2, y: 2 }])

  const second = pickWalkStarts(first.next, [{ id: 'a', path: [{ x: 2, z: 2 }] }])
  assert.equal(second.started.length, 0, '还在走，不应该再发')

  const third = pickWalkStarts(second.next, [{ id: 'a', path: [] }])
  assert.equal(third.started.length, 0)
  assert.equal(third.next.get('a'), 0, '走完后长度归零，下次再出发才会再发')
})
