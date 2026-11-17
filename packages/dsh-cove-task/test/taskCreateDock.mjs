/**
 * 新会话「创建为飞书任务」勾选条的纯逻辑与接口口径。
 *
 * 这里不渲染 React：组件接线由 test/client.mjs 钉（slot id/order/组件函数），
 * 真正渲染与点击在宿主里验收。此处保证：
 *   1. 任务名输入折叠空白并截断；
 *   2. 界面只有勾选框 + 可选任务名，没有「创建任务」按钮/编号提示；
 *   3. 客户端请求打到正确路由。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createApi } from '../src/client/api.js'
import { normalizeTitleInput, TITLE_MAX } from '../src/client/taskCreateDock.js'

const checks = []
function check(name, fn) {
  try {
    fn()
    checks.push([name, true])
    console.log(`  ok  ${name}`)
  } catch (error) {
    checks.push([name, false])
    console.log(`  FAIL ${name}`)
    console.log(String((error && error.stack) || error).split('\n').slice(0, 4).map((line) => `       ${line}`).join('\n'))
  }
}

check('任务名：首尾空白与换行折叠', () => {
  assert.equal(normalizeTitleInput('  修复 登录\n问题  '), '修复 登录 问题')
})
check('任务名：空值 / null / undefined 都变成空串（自动命名）', () => {
  assert.equal(normalizeTitleInput(''), '')
  assert.equal(normalizeTitleInput(null), '')
  assert.equal(normalizeTitleInput(undefined), '')
  assert.equal(normalizeTitleInput('   '), '')
})
check('任务名：超过上限截断', () => {
  assert.equal(normalizeTitleInput('一'.repeat(TITLE_MAX + 20)).length, TITLE_MAX)
})

/* 客户端接口：sessionTask 走 GET 查询串，intent 勾选写 POST。 */
{
  const calls = []
  const api = createApi({
    fetchImpl: async (input, init) => {
      calls.push({ input, init })
      return { ok: true, status: 200, async json() { return { ok: true, task: null, intent: null } } }
    },
  })
  await api.sessionTask('session a/b')
  assert.equal(calls[0].input, '/dsh-cove-task/api/sessions/task?sessionId=session%20a%2Fb')
  assert.equal(calls[0].init.method, undefined)
  await api.setTaskCreateIntent('session-1', true, '修复登录', 'P1', '🎯')
  const body = JSON.parse(calls[1].init.body)
  assert.deepEqual(body, { sessionId: 'session-1', enabled: true, title: '修复登录', priority: 'P1', emoji: '🎯' })
  assert.equal(calls[1].input, '/dsh-cove-task/api/sessions/task-intent')
  console.log('  ok  客户端接口：sessionTask / setTaskCreateIntent 路由与 body 口径')
  checks.push(['客户端接口', true])
}

/* 源码口径：只有勾选框 + 可选任务名，没有按钮和多余提示。 */
const component = await readFile(new URL('../src/client/taskCreateDock.js', import.meta.url), 'utf8')
check('没有「创建任务」按钮', () => {
  assert.equal(/h\('button'/.test(component), false)
  assert.equal(component.includes("'创建任务'"), false)
})
check('没有「编号自动生成」这类多余文字', () => {
  assert.equal(component.includes('编号自动生成'), false)
  assert.equal(component.includes('编号生成中'), false)
})
check('标签是 CoveTask', () => {
  assert.ok(component.includes("type: 'checkbox'"))
  assert.ok(component.includes("'CoveTask'"))
  assert.ok(component.includes("placeholder: '任务名（可选）'"))
  assert.equal(component.includes('创建为飞书任务'), false, '不写旧标签')
})
check('最前面有可选 emoji，默认显示图标', () => {
  assert.ok(component.includes("className: 'ftc-emoji'"))
  assert.ok(component.includes("className: 'ftc-emoji-default'"))
  assert.ok(component.includes("h('option', { value: '' }, '默认')"))
  assert.ok(component.includes('EMOJI_OPTIONS.map'))
})
check('右侧有可选优先级下拉（复用任务卡 .prio 徽标），默认 P2', () => {
  assert.ok(component.includes("className: 'ftc-prio tc-scope'"))
  assert.ok(component.includes("className: 'prio' + (priority ? '' : ' prio-empty')"))
  assert.ok(component.includes("h('option', { value: '' }, '无')"))
  assert.ok(component.includes("useState('P2')"), '默认优先级是 P2')
})
check('勾选后把 intent 交给宿主，而不是直接建任务', () => {
  assert.ok(component.includes('api.setTaskCreateIntent(sessionId, enabled, normalizeTitleInput(nextTitle), nextPriority || \'\', nextEmoji || \'\')'))
  assert.equal(component.includes('promoteSession'), false)
})
check('只在 session.blank 且未绑定任务时出现', () => {
  assert.ok(component.includes('props.session.blank === true'))
  assert.ok(component.includes('data && data.task'))
})
check('勾选后会话开始会自动打开右侧Cove Task 页签', () => {
  assert.ok(component.includes('host.openFeishuTab(sessionId)'))
  assert.ok(component.includes('wasBlank.current = true'))
})

const failed = checks.filter(([, ok]) => !ok)
console.log(`\ntaskCreateDock.mjs: ${checks.length - failed.length} passed, ${failed.length} failed`)
if (failed.length) process.exit(1)
