import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  decodeAssistantMessage,
  decodeTurnEnd,
  decodeUserMessage,
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
  const decoded = decodeAssistantMessage(data)
  assert.equal(decoded?.text, '我先看一眼。\n\n然后再说。')
  assert.equal(decoded?.turn, 3)
  assert.equal(decoded?.step, 2)
  assert.deepEqual(decoded?.tools, ['read'])
  // 动作摘要：工具名 + 一个能看懂的对象（read 取 file_path）
  assert.deepEqual(decoded?.actions, [{ name: 'read', detail: 'a' }])
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

test('decodeUserMessage：剥掉 system-reminder，只留人话', () => {
  const decoded = decodeUserMessage({
    turn: 1,
    content: [
      { type: 'text', text: '把这个胶囊缩短一点\n<system-reminder>\nCurrent working directory: /x\n</system-reminder>' },
    ],
    source: { kind: 'user' },
  })
  assert.equal(decoded?.text, '把这个胶囊缩短一点')
  assert.equal(decoded?.fromHuman, true)
})

test('decodeUserMessage：整条都是提示 / 审批变更 / 空 → 不算人话', () => {
  assert.equal(
    decodeUserMessage({ content: [{ type: 'text', text: '<system-reminder>只有环境说明</system-reminder>' }] }),
    null,
  )
  assert.equal(decodeUserMessage({ content: [] }), null)
  const approval = decodeUserMessage({ content: [{ type: 'text', text: '审批策略已改为不询问' }], source: { kind: 'user-approval' } })
  assert.equal(approval?.fromHuman, false)
})

test('定时任务的 user/message：从 JSON 里取出真正的指令，而不是让模型念 UUID', () => {
  const NL = String.fromCharCode(10)
  const BACKSLASH = String.fromCharCode(92)
  const reminder = [
    '[SCHEDULE REMINDER] This is a scheduled message from the user',
    'schedule_id_json: "schedule-abc"',
    'occurrence_at: 2026-11-19T16:00:00.000Z',
    // 指令是个 JSON 字符串，换行在里面是转义写出来的
    'reminder_prompt_json: "继续开发 dsh-broadcast。' + BACKSLASH + 'n1. 先读计划文档"',
  ].join(NL)
  const decoded = decodeUserMessage({ content: [{ type: 'text', text: reminder }], source: { kind: 'schedule' } })
  assert.equal(decoded?.text, '继续开发 dsh-broadcast。' + NL + '1. 先读计划文档')
  assert.equal(decoded?.fromHuman, true)
})

test('定时任务的批量格式（reminders_json）也能取到指令', () => {
  const reminder = '[SCHEDULE REMINDER] This is a scheduled message from the user\n'
    + 'reminders_json: [{"reminder_prompt":"把昨天的改动收个尾","occurrence_at":"2026-11-19T16:00:00.000Z"}]'
  const decoded = decodeUserMessage({ content: [{ type: 'text', text: reminder }], source: { kind: 'schedule' } })
  assert.equal(decoded?.text, '把昨天的改动收个尾')
})

test('格式变了（不是预期 JSON）就原样保留，至少不丢内容', () => {
  const weird = '[SCHEDULE REMINDER] 直接把指令写在这里'
  const decoded = decodeUserMessage({ content: [{ type: 'text', text: weird }], source: { kind: 'schedule' } })
  assert.equal(decoded?.text, weird)
})

test('只有 user / schedule 算人话；注入的上下文、插件指令、后台回执都不算', () => {
  for (const kind of ['runtime-context', 'skill-catalog', 'plugin:graphflow-dsh', 'time-context', 'tool-jobs', 'model-selection']) {
    const decoded = decodeUserMessage({ content: [{ type: 'text', text: '一些内容' }], source: { kind } })
    assert.equal(decoded?.fromHuman, false, `${kind} 不该算人话`)
  }
  for (const kind of ['user', 'schedule']) {
    const decoded = decodeUserMessage({ content: [{ type: 'text', text: '一些内容' }], source: { kind } })
    assert.equal(decoded?.fromHuman, true, `${kind} 应当算人话`)
  }
  const noSource = decodeUserMessage({ content: [{ type: 'text', text: '一些内容' }] })
  assert.equal(noSource?.fromHuman, true, '老日志没有 source，按人话处理')
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
