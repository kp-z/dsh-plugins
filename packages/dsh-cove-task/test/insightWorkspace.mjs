import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { projectNameOf } from '../src/overview/model.js'

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const extract = name => {
  const match = source.match(new RegExp('  (?:async )?function ' + name + '\\([^]*?\\n  }'))
  assert.ok(match, name)
  return match[0]
}
const tasks = [
  { id: 'a', project: 'Demo', workspaceTitle: '[Wrong] first', started: true },
  { id: 'b', project: ' Demo ', workspaceTitle: '[Other] second', started: true },
  { id: 'c', project: 'Other', workspaceTitle: '[Wrong] first', started: true },
  { id: 'd', project: '', workspaceTitle: '[Demo] legacy', started: true },
  { id: 'e', workspaceTitle: '[Demo] legacy', started: true },
]
const h = {
  state: { tasks, relations: [] }, settings: {}, projectNameOf,
  nowMs: () => 1_000, dayStart: () => 0, dayKey: String, DAY_MS: 86_400_000,
  insightLocal: () => ({ board: {} }), fulfillmentSummary: () => ({}),
  completionQuality: () => ({}), delayPatterns: () => [], METRICS_FILE: '',
  asString: value => value == null ? '' : String(value), taskActivityAt: () => 0,
}
vm.createContext(h)
vm.runInContext(extract('insightStats') + String.fromCharCode(10) + extract('insightSignature'), h)
const distribution = () => JSON.parse(JSON.stringify(h.insightStats().distribution))
assert.deepEqual(distribution(), [
  { state: 'started', workspace: 'Demo', count: 2 },
  { state: 'started', workspace: 'Other', count: 1 },
  { state: 'started', workspace: '未归属项目', count: 2 },
])
const signature = h.insightSignature()
tasks[0].workspaceTitle = '[Changed] moved'
assert.equal(h.insightSignature(), signature, 'moving a workspace does not change project material')
assert.equal(distribution()[0].count, 2)
tasks[0].project = 'Renamed'
assert.notEqual(h.insightSignature(), signature, 'changing project invalidates diagnosis cache')
assert.equal(distribution()[0].workspace, 'Renamed')
assert.ok(!source.includes('function workspaceGroup('), 'analysis has no title-prefix inference helper')
for (const name of ['insightContext', 'attributionMaterial']) {
  assert.ok(extract(name).includes('项目=${projectNameOf(task)'), name + ' receives explicit project material')
  assert.ok(!extract(name).includes('task.workspaceTitle'), name + ' does not infer project from workspace')
}
console.log('INSIGHT_PROJECT_OK: project-only distribution and cache identity; workspace changes are irrelevant')
