/**
 * 关系图「引擎接管坐标」：结构来自 layoutScope 的图，坐标由 dagre 重排。
 */
import assert from 'node:assert/strict'
import { relayoutGraph, relayoutScope } from '../src/graph/relayout.js'

let passed = 0
const failures = []
function check(name, fn) {
  try { fn(); passed += 1; console.log('  ok  ' + name) }
  catch (error) { failures.push(name); console.log('  FAIL ' + name); console.log(String((error && error.stack) || error).split('\n').slice(0, 4).map((l) => '       ' + l).join('\n')) }
}

const node = (id, extra) => ({ id, x: 0, y: 0, w: 300, h: 84, title: id, ...extra })
const edge = (from, to, kind = 'depends_on') => ({ from, to, kind })
const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)

const graph = {
  key: 'g1', top: 0, width: 10, height: 10, bands: [],
  nodes: [node('a'), node('b'), node('c'), node('m', { ghost: true })],
  edges: [edge('a', 'b'), edge('b', 'c'), edge('a', 'm'), edge('a', 'a')],
}

check('单图：x 递增、不重叠、宽高重算', () => {
  const out = relayoutGraph(graph)
  assert.equal(out.nodes.length, 4)
  const by = Object.fromEntries(out.nodes.map((n) => [n.id, n]))
  assert.ok(by.a.x + by.a.w <= by.b.x)
  assert.ok(by.b.x + by.b.w <= by.c.x)
  const list = out.nodes
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    assert.equal(overlap(list[i], list[j]), false, i + '/' + j)
  }
  assert.ok(out.width > 300 && out.height > 84)
  assert.deepEqual(out.bands, [])
})

check('多图：第二张的 top = 第一张 height，节点 y 带偏移', () => {
  const second = { ...graph, key: 'g2', nodes: [node('d'), node('e')], edges: [edge('d', 'e')] }
  const scope = relayoutScope({ graphs: [graph, second], nodes: [], edges: [], width: 0, height: 0 })
  assert.equal(scope.graphs.length, 2)
  assert.equal(scope.graphs[1].top, scope.graphs[0].height)
  const firstBottom = Math.max(...scope.graphs[0].nodes.map((n) => n.y + n.h))
  const secondTop = Math.min(...scope.graphs[1].nodes.map((n) => n.y))
  assert.ok(secondTop >= firstBottom, '两张图不重叠')
  assert.equal(scope.height, scope.graphs[0].height + scope.graphs[1].height)
  assert.ok(scope.width >= Math.max(scope.graphs[0].width, scope.graphs[1].width))
  assert.equal(scope.nodes.length, 6)
})

check('空图不炸、坐标保留原样', () => {
  const empty = { key: 'e', nodes: [], edges: [], width: 7, height: 9 }
  const out = relayoutGraph(empty)
  assert.equal(out.nodes.length, 0)
  assert.ok(out.width >= 64)
})

console.log('\ngraphRelayout.mjs: ' + passed + ' passed, ' + failures.length + ' failed')
if (failures.length) process.exit(1)
