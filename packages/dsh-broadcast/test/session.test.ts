import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  decodeAssistantMessage,
  decodeTurnEnd,
  isSubagentSession,
  sessionIdOf,
} from '../lib/session.js'

test('sessionIdOf：只认非空字符串 id', () => {
  assert.equal(sessionIdOf({ id: 'session-1' }), 'session-1')
  assert.equal(sessionIdOf({ id: '' }), undefined)
  assert.equal(sessionIdOf({}), undefined)
  assert.equal(sessionIdOf(null), undefined)
})

test('isSubagentSession：看 header.origin 与 delegationDepth', () => {
  assert.equal(isSubagentSession({ id: 'a', header: { delegationDepth: 0 } }), false)
  assert.equal(isSubagentSession({ id: 'a', header: {} }), false)
  assert.equal(isSubagentSession({ id: 'a' }), false)
  assert.equal(isSubagentSession({ id: 'a', header: { delegationDepth: 1 } }), true)
  assert.equal(isSubagentSession({ id: 'a', header: { origin: 'subagent' } }), true)
  assert.equal(isSubagentSession({ id: 'a', header: { origin: 'subagent', delegationDepth: 2 } }), true)
})

test('decodeAssistantMessage：真实形状（text + tool-call）', () => {
  const data = {
    turn: 3,
    step: 2,
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: '我先看一眼。' },
        { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"file_path":"a"}' },
        { type: 'text', text: '然后再说。' },
      ],
    },
  }
  assert.deepEqual(decodeAssistantMessage(data), {
    text: '我先看一眼。\n\n然后再说。',
    turn: 3,
    step: 2,
    tools: ['read'],
  })
})

test('decodeAssistantMessage：只有工具调用时 text 为空但不算错', () => {
  const decoded = decodeAssistantMessage({
    turn: 1,
    message: { role: 'assistant', content: [{ type: 'tool-call', name: 'bash', arguments: '{}' }] },
  })
  assert.equal(decoded?.text, '')
  assert.deepEqual(decoded?.tools, ['bash'])
})

test('decodeAssistantMessage：形状不对返回 null（不抛）', () => {
  assert.equal(decodeAssistantMessage(undefined), null)
  assert.equal(decodeAssistantMessage({}), null)
  assert.equal(decodeAssistantMessage({ message: { role: 'user', content: [] } }), null)
  assert.equal(decodeAssistantMessage({ message: { role: 'assistant', content: 'not-an-array' } })?.text, '')
})

test('decodeTurnEnd：completed / error / 形状不对', () => {
  assert.deepEqual(decodeTurnEnd({ turn: 2, reason: { kind: 'completed' } }), {
    turn: 2,
    kind: 'completed',
    errorMessage: undefined,
  })
  assert.deepEqual(
    decodeTurnEnd({ turn: 4, reason: { kind: 'error', error: { message: 'model overloaded' } } }),
    { turn: 4, kind: 'error', errorMessage: 'model overloaded' },
  )
  assert.deepEqual(decodeTurnEnd({ turn: 5, reason: { kind: 'aborted', reason: { kind: 'user' } } }), {
    turn: 5,
    kind: 'aborted',
    errorMessage: undefined,
  })
  assert.equal(decodeTurnEnd({ turn: 1 }), null)
  assert.equal(decodeTurnEnd({ turn: 1, reason: { kind: '' } }), null)
  assert.equal(decodeTurnEnd(null), null)
})
