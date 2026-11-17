#!/usr/bin/env node
/**
 * 新会话任务条的服务端口径（不碰网络、不碰飞书、不落盘）。
 *
 * 从生产 index.js 里抽出 promoteSessionToTask / projectTitleOfSession /
 * sessionTaskView 三个函数，配假会话记录与假 createTaskFromSession，
 * 钉住：
 *   - 人填了名字 → 直接用，不调模型；
 *   - 没填名字 → 正文 → 会话标题 → 项目名 → 短 id 的兜底顺序；
 *   - 返回体带 no/task，供 composer 条显示 T<飞书号>；
 *   - 已绑定任务的会话不能再建；
 *   - sessionTaskView 能回答「这条会话绑了哪条任务」。
 *
 * Run: node test/sessionTaskCreate.mjs
 */
import assert from 'node:assert/strict'
import { basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { resolveTaskCreateTitle, deriveTaskDraft, leadingEmojiOf, stripTaskNo } from '../index.js'

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const start = source.indexOf('  /** 会话记录里的 cwd → 项目名')
const end = source.indexOf('\n  /**\n   * 用当前默认模型给一段会话内容起个短标题')
assert.ok(start >= 0 && end > start, 'production extraction: promoteSessionToTask block')
const block = source.slice(start, end)
assert.ok(block.includes('async function promoteSessionToTask('))
assert.ok(block.includes('function sessionTaskView('))

function harness({ cwd = '/work/dsh-plugin', sessionTitle = '新会话', text = '', userText = '', registry = [] } = {}) {
  const created = []
  const priorities = []
  let aiCalls = 0
  const h = {
    asString: (value) => (value == null ? '' : String(value)),
    basename,
    state: { tasks: [], suspensions: {} },
    settings: { priorityOptions: ['P0', 'P1', 'P2', 'P3'] },
    ctx: {},
    nowMs: Date.now,
    setTaskPriority: async (taskId, value) => { priorities.push({ taskId, value }); return { ok: true } },
    taskCreateIntents: new Map(),
    TASK_CREATE_INTENT_TTL: 30 * 60 * 1000,
    runEngineOperation: async (fn, args) => fn(...args),
    log: () => {},
    service: (_ctx, name) => {
      if (name !== 'workspaceRegistry') return undefined
      return { list: () => registry }
    },
    readSessionRecord: async (id) => {
      if (id === 'missing') return undefined
      return { session: { cwd }, header: { cwd }, events: [] }
    },
    lastAssistantText: () => text,
    lastUserText: () => userText,
    readSessionTitle: async () => sessionTitle,
    generateSessionTitle: async (material, fallback) => {
      aiCalls += 1
      return { title: 'AI 起名', ai: true }
    },
    createTaskFromSession: async (sessionId, input) => {
      const guid = 'guid-' + (created.length + 1)
      created.push({ sessionId, input })
      const task = {
        id: guid,
        no: 516000 + created.length,
        title: '🧪 T' + (516000 + created.length) + '-' + input.title,
        url: 'https://example.feishu.cn/task/' + guid,
        sessionId,
        done: false,
      }
      h.state.tasks.push(task)
      return { ok: true, taskId: guid, title: task.title }
    },
    resolveTaskCreateTitle,
    deriveTaskDraft,
    leadingEmojiOf,
    stripTaskNo,
  }
  vm.createContext(h)
  vm.runInContext(block, h)
  return { h, created, priorities, aiCalls: () => aiCalls, ai: () => aiCalls }
}

/* 1. 人填的任务名优先，且不调模型。 */
{
  const { h, created, aiCalls } = harness()
  const result = await h.promoteSessionToTask('session-a', { title: '  修复 登录\n问题  ' })
  assert.equal(result.ok, true, result.error)
  assert.equal(created.length, 1)
  assert.equal(created[0].input.title, '修复 登录 问题')
  assert.equal(aiCalls(), 0, '人填了名字就不该再让模型起名')
  assert.equal(result.namedBy, 'user')
  assert.equal(result.no, 516001)
  assert.equal(result.task.no, 516001)
  assert.equal(result.task.url.includes('/task/' + result.task.id), true)
  console.log('✓ 人填任务名：直接创建、不调模型、返回飞书编号')
}

/* 2. 空白会话留空：项目名兜底，不拿「新会话」当任务名。 */
{
  const { h, created, aiCalls } = harness()
  const result = await h.promoteSessionToTask('session-b', {})
  assert.equal(result.ok, true, result.error)
  assert.equal(created[0].input.title, 'dsh-plugin · 新任务')
  assert.equal(aiCalls(), 0, '空白会话没有正文，不该调模型')
  assert.equal(result.namedBy, 'auto')
  console.log('✓ 空白会话自动命名：项目名兜底，不写「新会话」')
}

/* 3. 注册表项目名优先于目录名。 */
{
  const { h, created } = harness({ cwd: '/work/whatever', registry: [{ path: '/work/whatever', title: 'Cove Task 插件' }] })
  await h.promoteSessionToTask('session-c', {})
  assert.equal(created[0].input.title, 'Cove Task 插件 · 新任务')
  console.log('✓ 项目名来自工作区注册表')
}

/* 4. 有正文且留空：走模型起名。 */
{
  const { h, created, aiCalls } = harness({ text: '已经修好了登录页的样式\n验证通过' })
  const result = await h.promoteSessionToTask('session-d', {})
  assert.equal(result.ok, true, result.error)
  assert.equal(aiCalls(), 1)
  assert.equal(created[0].input.title, 'AI 起名')
  assert.equal(result.namedBy, 'ai')
  console.log('✓ 有正文且留空：模型起名')
}

/* 5. 已绑定 / 超长标题 / 没会话：明确拒绝，且不调用创建。 */
{
  const { h, created } = harness()
  h.state.tasks.push({ id: 'bound', sessionId: 'session-e', title: '已绑定', done: false })
  const bound = await h.promoteSessionToTask('session-e', { title: '新名字' })
  assert.equal(bound.ok, false)
  assert.match(bound.error, /已经绑定/)
  assert.equal(created.length, 0)
  const tooLong = await h.promoteSessionToTask('session-f', { title: '一'.repeat(61) })
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.error, /60/)
  const noSession = await h.promoteSessionToTask('missing', {})
  assert.equal(noSession.ok, false)
  console.log('✓ 已绑定 / 超长 / 会话不存在：拒绝且不创建')
}

/* 6. sessionTaskView：未绑定返回 null，绑定返回任务摘要。 */
{
  const { h } = harness()
  const none = h.sessionTaskView('none')
  assert.equal(none.ok, true)
  assert.equal(none.sessionId, 'none')
  assert.equal(none.task, null)
  assert.equal(none.intent, null)
  h.state.tasks.push({ id: 'guid-9', no: 516009, title: '🧪 T516009-已完成', url: 'https://x', done: true, sessionId: 'session-g' })
  h.state.suspensions['guid-9'] = { active: true }
  const view = h.sessionTaskView('session-g')
  assert.equal(view.ok, true)
  assert.equal(view.task.id, 'guid-9')
  assert.equal(view.task.no, 516009)
  assert.equal(view.task.done, true)
  assert.equal(view.task.suspended, true)
  const missing = h.sessionTaskView('')
  assert.equal(missing.ok, false)
  console.log('✓ sessionTaskView：绑定/未绑定/缺 sessionId')
}

/* 7. 勾选 intent：任务名折叠空白；取消勾选清空；已绑定会话拒绝。 */
{
  const { h } = harness()
  const on = h.setTaskCreateIntent('session-h', { enabled: true, title: '  修复 登录  ' })
  assert.equal(on.ok, true)
  assert.equal(on.intent.enabled, true)
  assert.equal(on.intent.title, '修复 登录')
  assert.equal(h.sessionTaskView('session-h').intent.enabled, true)
  const off = h.setTaskCreateIntent('session-h', { enabled: false })
  assert.equal(off.ok, true)
  assert.equal(off.intent, null)
  assert.equal(h.sessionTaskView('session-h').intent, null)
  h.state.tasks.push({ id: 'bound-2', sessionId: 'session-i', title: '已绑定', done: false })
  const rejected = h.setTaskCreateIntent('session-i', { enabled: true, title: 'x' })
  assert.equal(rejected.ok, false)
  assert.match(rejected.error, /已经绑定/)
  console.log('✓ intent：勾选/取消/已绑定拒绝')
}

/* 8. 勾选后第一条消息到达 → 自动创建一次，然后清掉 intent。 */
{
  const { h, created } = harness()
  h.setTaskCreateIntent('session-j', { enabled: true, title: '' })
  await h.autoCreateTaskFromTurn('session-j', '把登录页的样式修好')
  assert.equal(created.length, 1)
  assert.equal(created[0].sessionId, 'session-j')
  assert.equal(created[0].input.title, 'AI 起名')
  assert.equal(h.sessionTaskView('session-j').intent, null)
  await h.autoCreateTaskFromTurn('session-j')
  assert.equal(created.length, 1, '同一个 intent 不能重复创建')
  console.log('✓ user/message 自动创建：只建一次，自动命名')
}

/* 9. 没勾选时消息到达不创建。 */
{
  const { h, created } = harness({ userText: '普通对话' })
  await h.autoCreateTaskFromTurn('session-k')
  assert.equal(created.length, 0)
  console.log('✓ 没勾选不创建')
}

/* 10. 可选优先级：存进 intent，创建后写回；非法值拒绝。 */
{
  const { h, created, priorities } = harness()
  const bad = h.setTaskCreateIntent('session-l', { enabled: true, title: '优先级示例', priority: 'P9' })
  assert.equal(bad.ok, false)
  const set = h.setTaskCreateIntent('session-l', { enabled: true, title: '优先级示例', priority: 'p1' })
  assert.equal(set.ok, true)
  assert.equal(set.intent.priority, 'P1')
  assert.equal(h.sessionTaskView('session-l').intent.priority, 'P1')
  await h.autoCreateTaskFromTurn('session-l')
  assert.equal(created.length, 1)
  assert.equal(created[0].input.title, '优先级示例')
  assert.deepEqual(priorities, [{ taskId: 'guid-1', value: 'P1' }])
  console.log('✓ 优先级：intent 保存、创建后写回、非法值拒绝')
}

/* 11. 人选 emoji 优先，拼在最终标题最前面。 */
{
  const { h, created } = harness()
  const set = h.setTaskCreateIntent('session-m', { enabled: true, title: '表情任务', priority: 'P2', emoji: '🎯' })
  assert.equal(set.ok, true)
  assert.equal(set.intent.emoji, '🎯')
  assert.equal(h.sessionTaskView('session-m').intent.emoji, '🎯')
  await h.autoCreateTaskFromTurn('session-m')
  assert.equal(created.length, 1)
  assert.equal(created[0].input.title, '🎯 表情任务')
  console.log('✓ emoji：随 intent 保存，创建时放在标题最前')
}

console.log('SESSION_TASK_CREATE_OK')
