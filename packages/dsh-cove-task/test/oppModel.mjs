import assert from 'node:assert/strict'
import { buildOpp, mergeEmptyOkr, mergeOppStats, mergeOppStructure, oppStatus, parseOppDate } from '../src/client/oppModel.js'

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

check('投影：workspace → Objective，listName → Key Result，进度按 done/total', () => {
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
  assert.equal(model.objectives.length, 2)
  const a = model.objectives.find((o) => o.title === '项目A')
  assert.equal(a.krs.length, 1)
  assert.equal(a.krs[0].title, '清单1')
  assert.equal(a.krs[0].done, 1)
  assert.equal(a.krs[0].total, 2)
  assert.equal(a.krs[0].progress, 50)
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
    a: { done: true, listName: 'KR1', workspaceTitle: 'O1' },
    b: { done: false, listName: 'KR2', workspaceTitle: 'O1' },
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

console.log('\noppModel.mjs: ' + passed + ' passed, 0 failed')
