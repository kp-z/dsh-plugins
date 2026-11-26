import assert from 'node:assert/strict'
import { buildOpp, buildPlanRows, mergeEmptyOkr, mergeOppStats, mergeOppStructure, oppStatus, parseOppDate } from '../src/client/oppModel.js'

let passed = 0
const check = (name, fn) => { try { fn(); passed++; console.log('  ok  ' + name) } catch (error) { console.error('  FAIL ' + name); throw error } }

check('状态映射：done / blocked / suspended / running / todo', () => {
  assert.equal(oppStatus({ done: true }), 'done')
  assert.equal(oppStatus({ state: 'blocked' }, {}), 'blocked')
  assert.equal(oppStatus({ state: 'suspended' }, {}), 'suspended')
  assert.equal(oppStatus({ state: 'open' }, { running: true }), 'in-progress')
  assert.equal(oppStatus({ state: 'open' }, {}), 'todo')
})

check('日期：YYYY-MM-DD / 毫秒都解析', () => {
  assert.ok(parseOppDate('2026-11-17') > 0)
  assert.ok(parseOppDate('2026-11-17 10:30') > 0)
  assert.ok(parseOppDate(1794929689993) > 0)
  assert.equal(parseOppDate(''), null)
})

check('投影：Objective 只认真实字段，不拿工作区名冒充；listName → Key Result', () => {
  /* 三个任务都**没填** objective，但分属两个工作区。旧实现会拿 workspaceTitle 兜底，
     于是「项目A / 项目B」变成两个假 Objective —— 名字看着像目标，其实是目录名。
     现在必须并进同一组，且组名明确说明未归入。 */
  const nodes = [
    { id: 'a', state: 'open', done: true, priority: 'P1', no: 1, workspaceTitle: '项目A' },
    { id: 'b', state: 'open', done: false, priority: 'P2', no: 2, workspaceTitle: '项目A' },
    { id: 'c', state: 'blocked', priority: 'P0', no: 3, workspaceTitle: '项目B' },
  ]
  const tasks = {
    a: { done: true, listName: '清单1', workspaceTitle: '项目A', start: '2026-11-01', expectedAt: 1795000000000 },
    b: { done: false, listName: '清单1', workspaceTitle: '项目A', start: '2026-11-02', expectedAt: 1795100000000 },
    c: { done: false, listName: '清单2', workspaceTitle: '项目B', start: '2026-11-03' },
  }
  const model = buildOpp(nodes, tasks)
  assert.equal(model.objectives.length, 1, '不能按工作区拆成多个假 Objective')
  const a = model.objectives.find((o) => o.title === '未归入 Objective')
  assert.ok(a, '没有真实 O 的统一归入「未归入 Objective」')
  assert.deepEqual(a.krs.map((kr) => kr.title).sort(), ['清单1', '清单2'], 'KR 仍按 listName 分组')
  const kr1 = a.krs.find((kr) => kr.title === '清单1')
  assert.equal(kr1.done, 1)
  assert.equal(kr1.total, 2)
  assert.equal(kr1.progress, 50)
  assert.equal(model.stats.total, 3)
  assert.equal(model.stats.done, 1)
  assert.equal(model.stats.progress, 33)
  assert.equal(model.stats.blocked, 1)
})

check('O/KR 字段优先于 workspace/listName', () => {
  const model = buildOpp([
    { id: 'a', state: 'open', priority: 'P1', no: 1, workspaceTitle: '项目A' },
    { id: 'b', state: 'open', priority: 'P2', no: 2, workspaceTitle: '项目A' },
  ], {
    a: { listName: '旧清单', workspaceTitle: '项目A', objective: 'O1 让看板可读', keyResult: 'KR1 画布稳定' },
    b: { listName: '旧清单', workspaceTitle: '项目A', objective: 'O1 让看板可读', keyResult: 'KR2 OPP 有信息量' },
  })
  assert.equal(model.objectives.length, 1)
  assert.equal(model.objectives[0].title, 'O1 让看板可读')
  assert.equal(model.objectives[0].krs.length, 2)
  assert.deepEqual(model.objectives[0].krs.map((kr) => kr.title).sort(), ['KR1 画布稳定', 'KR2 OPP 有信息量'])
})

check('排序：P0 在 P3 前，空数据不抛', () => {
  const model = buildOpp([
    { id: 'x', state: 'open', priority: 'P3', no: 9 },
    { id: 'y', state: 'open', priority: 'P0', no: 1 },
  ], { x: { listName: 'L' }, y: { listName: 'L' } })
  assert.equal(model.tasks[0].id, 'y')
  assert.deepEqual(buildOpp([], {}).stats.total, 0)
})

check('空 O/KR：保留定义，聚合进度仍按全量任务', () => {
  const tasks = {
    /* O1 必须是**真实 objective 字段**：workspaceTitle 不再冒充 Objective。 */
    a: { done: true, listName: 'KR1', objective: 'O1' },
    b: { done: false, listName: 'KR2', objective: 'O1' },
  }
  const full = mergeEmptyOkr(buildOpp([{ id: 'a', state: 'done' }, { id: 'b', state: 'open' }], tasks), {
    objectives: ['Empty O'],
    keyResults: [{ objective: 'Empty O', title: 'Empty KR' }],
  })
  const filtered = mergeEmptyOkr(buildOpp([{ id: 'b', state: 'open' }], tasks), {
    objectives: ['Empty O'],
    keyResults: [{ objective: 'Empty O', title: 'Empty KR' }],
  })
  const merged = mergeOppStats(filtered, full)
  const o1 = merged.objectives.find((obj) => obj.title === 'O1')
  assert.equal(o1.total, 2)
  assert.equal(o1.progress, 50)
  assert.equal(o1.tasks.length, 1)
  assert.ok(merged.objectives.find((obj) => obj.title === 'Empty O'))
  const structured = mergeOppStructure(merged, full)
  assert.equal(structured.objectives.find((obj) => obj.title === 'O1').krs.length, 2)
  assert.equal(structured.objectives.find((obj) => obj.title === 'O1').krs.find((kr) => kr.title === 'KR1').tasks.length, 0)
  assert.equal(structured.objectives.find((obj) => obj.title === 'O1').krs.find((kr) => kr.title === 'KR2').tasks.length, 1)
})

check('buildPlanRows：只按真实 KR 分组，没填 KR 的全部并进同一组', () => {
  const model = buildOpp(
    [
      { id: 'a', state: 'open', no: 1 },
      { id: 'b', state: 'open', no: 2 },
      { id: 'c', state: 'open', no: 3 },
      { id: 'd', state: 'open', no: 4 },
    ],
    {
      /* a / b 没有 KR，但分属不同工作区与清单 —— 旧实现会因此拆成两行假 KR */
      a: { workspaceTitle: '项目A', listName: '清单1' },
      b: { workspaceTitle: '项目B', listName: '清单2' },
      /* c / d 有真实 KR */
      c: { workspaceTitle: '项目A', listName: '清单1', objective: 'O1', keyResult: 'KR1' },
      d: { workspaceTitle: '项目A', listName: '清单1', objective: 'O1', keyResult: 'KR1', done: true },
    },
  )
  const rows = buildPlanRows(model.tasks)
  assert.equal(rows.length, 2, '应该只有「真实 KR1」和「未填 KR」两组')
  const blank = rows.find((row) => row.title === '')
  assert.ok(blank, '没填 KR 的组 title 必须是空串，不能填硬编码')
  assert.equal(blank.tasks.length, 2, 'a / b 必须并进同一组（哪怕工作区/清单不同）')
  assert.equal(blank.objective, '', '组内 Objective 不一致时不能编造')
  const kr1 = rows.find((row) => row.title === 'KR1')
  assert.equal(kr1.objective, 'O1')
  assert.equal(kr1.total, 2)
  assert.equal(kr1.done, 1)
  assert.equal(kr1.progress, 50)
})

check('buildPlanRows：任务自带 demote 的假 KR 不会进入 Plan', () => {
  /* 模型里的 keyResult 是兜底过的值；Plan 只认 keyResultRaw */
  const model = buildOpp([{ id: 'a', state: 'open' }], { a: { workspaceTitle: '项目A', listName: '主线任务 · Main Quest' } })
  assert.equal(model.tasks[0].keyResult, '主线任务 · Main Quest', '模型仍保留兜底（OKR 视图用）')
  assert.equal(model.tasks[0].keyResultRaw, '', 'raw 字段必须是空的')
  const rows = buildPlanRows(model.tasks)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, '', '不能把清单名当 KR 显示')
})

check('buildPlanRows：组内共享同一个真实 Objective 时才显示它', () => {
  const tasks = [
    { id: 'a', status: 'open', objectiveRaw: 'O1', keyResultRaw: '' },
    { id: 'b', status: 'done', objectiveRaw: 'O1', keyResultRaw: '' },
  ]
  const rows = buildPlanRows(tasks)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].objective, 'O1')
  assert.equal(rows[0].done, 1)
  assert.equal(rows[0].progress, 50)
})

console.log('\noppModel.mjs: ' + passed + ' passed, 0 failed')
