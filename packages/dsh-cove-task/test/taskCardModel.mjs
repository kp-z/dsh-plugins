/**
 * 任务卡模型测试：字段映射、显隐规则、动作顺序。
 *
 * 这一层是「卡片画什么」的唯一来源，所以断言写得比渲染测试更细：
 * 空字段必须消失、有值必须出现、顺序必须和面板一致。
 */
import assert from 'node:assert/strict'
import { buildTaskCardModel, normPriority, shortDayText, scheduleNextText, etaShortText } from '../src/card/taskCardModel.js'
import { NOW, minimalTask, fullTask, suspendedTask, runningTask, reopenedTask, noWorkspaceTask } from './fixtures/tasks.mjs'

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log('  ok  ' + name)
  } catch (error) {
    failures.push(name)
    console.log('  FAIL ' + name)
    console.log(String((error && error.stack) || error).split('\n').slice(0, 5).map((line) => '       ' + line).join('\n'))
  }
}

const build = (task, ctx) => buildTaskCardModel(task, Object.assign({ now: NOW }, ctx))
const chip = (model, key) => (model.chips || []).find((item) => item.key === key)
const badge = (model, key) => (model.badges || []).find((item) => item.key === key)

/* ---- 纯函数 ---- */
check('normPriority：只认 P0-P3', () => {
  assert.equal(normPriority('p0'), 'P0')
  assert.equal(normPriority(' P2 '), 'P2')
  assert.equal(normPriority('P9'), '')
  assert.equal(normPriority(null), '')
})
check('shortDayText：同年省年份', () => {
  assert.equal(shortDayText('2026-11-20', NOW), '11-20')
  assert.equal(shortDayText('2027-01-02', NOW), '2027-01-02')
  assert.equal(shortDayText('', NOW), '')
})
check('scheduleNextText：破折号 = 没有下一次', () => {
  assert.equal(scheduleNextText({ nextText: '—' }, NOW), '')
  assert.equal(scheduleNextText({ nextText: '2026-11-17 09:00' }, NOW), '11-17 09:00')
})
check('etaShortText：保留时分', () => {
  assert.equal(etaShortText('2026-11-18 18:00'), '11-18 18:00')
})

/* ---- 最简卡 ---- */
check('最简：没有会话就没有 session，也没有文档/关系', () => {
  const m = build(minimalTask)
  assert.equal(m.session, null)
  assert.equal(m.docs.length, 0)
  assert.equal(m.relations, null)
  assert.equal(m.priority.value, 'P2')
})
check('最简：没排期时定时 chip 是虚线占位，没绑会话时禁用', () => {
  const m = build(minimalTask)
  const sched = chip(m, 'schedule')
  assert.ok(sched)
  assert.equal(sched.label, '⏰ 定时')
  assert.ok(sched.cls.includes('chip-sched-empty'))
  assert.equal(sched.disabled, true)
})
check('最简：没预期时是「📅 预期」入口', () => {
  const m = build(minimalTask)
  assert.equal(chip(m, 'eta').label, '📅 预期')
  assert.ok(chip(m, 'eta').cls.includes('chip-eta-empty'))
})
check('最简：工作区 chip 带路径提示', () => {
  const m = build(minimalTask)
  const ws = chip(m, 'workspace')
  assert.equal(ws.label, 'blog_dev')
  assert.ok(ws.title.includes('/Users/kp/blog_dev'))
})
check('最简：没绑会话 → 动作里有开工/绑定，没完成态', () => {
  const m = build(minimalTask)
  const keys = m.actions.map((a) => a.key)
  assert.deepEqual(keys, ['start', 'bind', 'complete', 'docs', 'sync', 'comments', 'suspend', 'more'])
  assert.equal(m.actions.find((a) => a.key === 'complete').disabled, false)
})

/* ---- 全字段卡 ---- */
check('全字段：已开工徽标；boundOnly 在 started 后不重复', () => {
  const m = build(fullTask)
  assert.ok(badge(m, 'started'))
  assert.equal(badge(m, 'bound'), undefined)
})
check('全字段：截止/定时/预期/归因/清单/触发/字段的顺序与文案', () => {
  const m = build(fullTask)
  const keys = m.chips.map((c) => c.key)
  assert.deepEqual(keys, ['list', 'trigger', 'end', 'schedule', 'eta', 'attribution', 'field:模块', 'field:环境', 'workspace'])
  assert.equal(chip(m, 'end').label, '截止 11-20')
  assert.equal(chip(m, 'schedule').label, '⏰ 每周一 09:00')
  assert.equal(chip(m, 'schedule').title.includes('11-17 09:00'), true)
  assert.equal(chip(m, 'eta').label, '📅 预期 · 11-18 18:00 · 剩 3.3 天')
  assert.equal(chip(m, 'list').label, '日常')
  assert.equal(chip(m, 'trigger').label, '人工触发')
  assert.equal(chip(m, 'attribution').label, '🤖 等接口')
})
check('全字段：预期写回未完成时尾巴挂「未同步」', () => {
  const m = build(fullTask)
  const eta = chip(m, 'eta')
  assert.deepEqual(eta.parts, [{ text: '未同步', cls: 'chip-eta-sync' }])
  assert.equal(eta.title.includes('写回飞书未完成'), true)
})
check('全字段：优先级字段不重复进信息行', () => {
  const m = build(fullTask)
  assert.equal(m.chips.some((c) => c.label.includes('优先级')), false)
})
check('全字段：文档去重；没标题的用链接尾号', () => {
  const m = build(fullTask)
  assert.equal(m.docs.length, 2)
  assert.equal(m.docs[0].label, '设计稿')
  assert.equal(m.docs[1].label, '文档 · def456')
})
check('全字段：人分组、头像与匿名兜底', () => {
  const m = build(fullTask)
  assert.equal(m.people.length, 2)
  const [assignee, follower] = m.people
  assert.equal(assignee.role, 'assignee')
  assert.equal(assignee.items.length, 2)
  assert.equal(assignee.items[0].avatar, 'https://example.com/a.png')
  assert.equal(assignee.items[1].initial, '李')
  assert.equal(follower.items[0].anon, true)
  assert.equal(follower.more, 0)
})
check('全字段：关系摘要', () => {
  const m = build(fullTask)
  assert.equal(m.relations.predecessors[0].title, '前置任务')
  assert.equal(m.relations.derivedTasks[0].title, '派生任务')
})
check('全字段：会话灯 = 运行中', () => {
  const m = build(fullTask)
  assert.equal(m.session.lamp, 'running')
  assert.equal(m.session.label, 'Session')
})
check('全字段：绑了会话就不再给开工/绑定', () => {
  const m = build(fullTask)
  assert.equal(m.actions.some((a) => a.key === 'start'), false)
  assert.equal(m.actions.some((a) => a.key === 'bind'), false)
})

/* ---- 其它形态 ---- */
check('挂起：徽标行有「已挂起」，动作里给「恢复」，不给开工', () => {
  const m = build(suspendedTask)
  assert.equal(m.suspended, true)
  assert.equal(m.actions.some((a) => a.key === 'start'), false)
  assert.equal(m.actions.find((a) => a.key === 'suspend').label, '恢复')
})
check('重开待同步：徽标带原因', () => {
  const m = build(reopenedTask)
  const item = badge(m, 'reopen')
  assert.equal(item.label, '已重开 · 飞书待同步')
  assert.equal(item.title, '写回失败')
})
check('完成态：已完成徽标 + 完成按钮禁用', () => {
  const m = build(noWorkspaceTask)
  assert.ok(badge(m, 'done'))
  assert.equal(m.actions.find((a) => a.key === 'complete').disabled, true)
  assert.equal(m.chips.some((c) => c.key === 'workspace'), false)
})
check('空任务不抛', () => {
  const m = buildTaskCardModel(null)
  assert.equal(m.title, '(无标题任务)')
  assert.deepEqual(m.badges, [])
})
check('隐藏字段名生效', () => {
  const m = build(fullTask, { hiddenFieldNames: ['模块'] })
  assert.equal(m.chips.some((c) => c.key === 'field:模块'), false)
})
check('画布上下文：canStart=false 时不给开工', () => {
  const m = build(minimalTask, { canStart: false })
  assert.equal(m.actions.some((a) => a.key === 'start'), false)
})

console.log('\ntaskCardModel.mjs: ' + passed + ' passed, ' + failures.length + ' failed')
if (failures.length) process.exit(1)
