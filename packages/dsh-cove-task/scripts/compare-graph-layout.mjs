/**
 * P0 验收：同一批任务，「旧的自写深度分列」与「新的 dagre 分层」摆位对比。
 *
 * 指标：画布宽高、列数、边交叉数（按节点中心直线近似）、总边长、重叠数。
 * 产物：控制台表格 + .graph-layout-compare.json。
 * 跑法：node scripts/compare-graph-layout.mjs
 */
import { writeFileSync } from 'node:fs'
import { layoutScope, estimateCardHeight } from '../src/overview/layout.js'
import { layoutGraph } from '../src/graph/engine.js'

const W = 300
const mk = (id, workspace) => ({ id, no: Number(id.replace(/\D/g, '')) || 1, title: '任务 ' + id, done: false, workspaceKey: workspace, workspaceTitle: workspace, workspacePath: '/x/' + workspace, blocked: false, ready: true, started: false, suspended: false, docs: [], members: [], customFields: [], meta: {} })

const chain = {
  name: '链式 10 节点',
  tasks: Array.from({ length: 10 }, (_, i) => mk('t' + i, 'wA')),
  relations: Array.from({ length: 9 }, (_, i) => ({ from: 't' + i, to: 't' + (i + 1), kind: 'depends_on' })),
}
const fan = {
  name: '扇出 1→9',
  tasks: Array.from({ length: 10 }, (_, i) => mk('f' + i, 'wA')),
  relations: Array.from({ length: 9 }, (_, i) => ({ from: 'f0', to: 'f' + (i + 1), kind: 'depends_on' })),
}
const mixed = {
  name: '跨项目 14 节点（依赖 + 来源 + 时间）',
  tasks: Array.from({ length: 14 }, (_, i) => mk('m' + i, ['wA', 'wB', 'wC'][i % 3])),
  relations: [
    { from: 'm0', to: 'm1', kind: 'depends_on' }, { from: 'm1', to: 'm2', kind: 'depends_on' },
    { from: 'm3', to: 'm4', kind: 'depends_on' }, { from: 'm4', to: 'm5', kind: 'depends_on' },
    { from: 'm6', to: 'm7', kind: 'depends_on' }, { from: 'm7', to: 'm8', kind: 'depends_on' },
    { from: 'm9', to: 'm10', kind: 'depends_on' }, { from: 'm10', to: 'm11', kind: 'depends_on' },
    { from: 'm12', to: 'm13', kind: 'depends_on' },
    { from: 'm0', to: 'm3', kind: 'derived_from' }, { from: 'm6', to: 'm9', kind: 'derived_from' },
    { from: 'm2', to: 'm6', kind: 'temporal' }, { from: 'm5', to: 'm12', kind: 'temporal' },
    { from: 'm8', to: 'm12', kind: 'temporal' },
  ],
}

const center = (p) => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 })
const segIntersect = (a, b, c, d) => {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
  return d1 * d2 < 0 && d3 * d4 < 0
}
const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)

function metrics(positions, edges, bounds) {
  const ids = Object.keys(positions)
  const lines = edges.filter((e) => positions[e.from] && positions[e.to] && e.from !== e.to).map((e) => [center(positions[e.from]), center(positions[e.to])])
  let crossings = 0
  for (let i = 0; i < lines.length; i += 1) for (let j = i + 1; j < lines.length; j += 1) {
    if (lines[i][0].x === lines[j][0].x && lines[i][0].y === lines[j][0].y) continue
    if (segIntersect(lines[i][0], lines[i][1], lines[j][0], lines[j][1])) crossings += 1
  }
  let length = 0
  for (const [a, b] of lines) length += Math.hypot(a.x - b.x, a.y - b.y)
  let overlaps = 0
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
    if (overlap(positions[ids[i]], positions[ids[j]])) overlaps += 1
  }
  const columns = new Set(ids.map((id) => positions[id].x)).size
  return { nodes: ids.length, edges: lines.length, width: Math.round(bounds.width), height: Math.round(bounds.height), columns, crossings, edgeLength: Math.round(length), overlaps }
}

function oldLayout(fixture) {
  const scope = layoutScope({ tasks: fixture.tasks, relations: fixture.relations, scope: { kind: 'all' } })
  const positions = {}
  const nodeById = new Map(scope.nodes.map((node) => [node.id, node]))
  for (const task of fixture.tasks) {
    const node = nodeById.get(task.id)
    if (!node) continue
    positions[task.id] = { x: node.x, y: node.y, w: node.w, h: node.h }
  }
  return { positions, bounds: { width: scope.width, height: scope.height } }
}

function newLayout(fixture) {
  const sizes = new Map(fixture.tasks.map((task) => [task.id, estimateCardHeight(task)]))
  const nodes = fixture.tasks.map((task) => ({ id: task.id, w: W, h: sizes.get(task.id) || 84 }))
  return layoutGraph({ nodes, edges: fixture.relations })
}

const rows = []
for (const fixture of [chain, fan, mixed]) {
  const oldOne = oldLayout(fixture)
  const next = newLayout(fixture)
  rows.push({ fixture: fixture.name, old: metrics(oldOne.positions, fixture.relations, oldOne.bounds), new: metrics(next.positions, fixture.relations, next.bounds) })
}
console.log('| 场景 | 布局 | 宽 | 高 | 列数 | 交叉 | 总边长 | 重叠 |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const row of rows) {
  for (const [name, m] of [['旧（深度分列）', row.old], ['新（dagre）', row.new]]) {
    console.log(`| ${row.fixture} | ${name} | ${m.width} | ${m.height} | ${m.columns} | ${m.crossings} | ${m.edgeLength} | ${m.overlaps} |`)
  }
}
writeFileSync(new URL('../.graph-layout-compare.json', import.meta.url), JSON.stringify(rows, null, 2))
console.log('\nwrote .graph-layout-compare.json')
