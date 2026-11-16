/**
 * 优先级工具函数回归：阶段 5 删旧卡片时把 PRIORITY_OPTIONS 一起删了，
 * 但排序/徽标菜单还在用，侧边栏整页 ReferenceError。
 * 这里直接跑面板里的 normPriority / sortPanelTasks，防止常量再次被带走。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')

const slice = (startMarker, endMarker) => {
  const start = script.indexOf(startMarker)
  assert.ok(start >= 0, '缺声明：' + startMarker)
  const end = script.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, '缺结束标记：' + endMarker)
  return script.slice(start, end)
}
const constants = slice('var PRIORITY_OPTIONS', 'function normPriority')
const norm = slice('function normPriority', '/* 点徽标弹出选择器')
const sort = slice('function sortPanelTasks', 'function reorderActivityTaskCards')
const sandbox = { app: { currentSessionId: '' } }
vm.createContext(sandbox)
vm.runInContext(constants + norm + sort + '\nthis.normPriority = normPriority; this.sortPanelTasks = sortPanelTasks;', sandbox)

assert.equal(sandbox.normPriority('p1'), 'P1')
assert.equal(sandbox.normPriority('P9'), '')
assert.equal(sandbox.normPriority(''), '')
const sorted = sandbox.sortPanelTasks([
  { id: 'c', priority: 'P3' },
  { id: 'a', priority: 'P0' },
  { id: 'd' },
  { id: 'b', priority: 'P1' },
])
assert.deepEqual(sorted.map((t) => t.id), ['a', 'b', 'c', 'd'], '按 P0→P3→无 排序')
console.log('PANEL_PRIORITY_OK: PRIORITY_OPTIONS/LABEL 已定义，norm/sortPanelTasks 可用')
