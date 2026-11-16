/**
 * 布局引擎测试：确定性、依赖方向、不重叠、边界、性能、坏输入。
 */
import assert from 'node:assert/strict'
import { layoutGraph, DEFAULT_LAYOUT_OPTIONS } from '../src/graph/engine.js'

let passed = 0
const failures = []
function check(name, fn) {
  try { fn(); passed += 1; console.log('  ok  ' + name) }
  catch (error) { failures.push(name); console.log('  FAIL ' + name); console.log(String((error && error.stack) || error).split('\n').slice(0, 5).map((line) => '       ' + line).join('\n')) }
}

const node = (id, w = 300, h = 84) => ({ id, w, h })
const edge = (from, to, kind = 'depends_on') => ({ from, to, kind })
const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)

check('确定性：同样输入两次结果一致（含边顺序打乱）', () => {
  const nodes = [node('a'), node('b'), node('c'), node('d')]
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('a', 'd')]
  const one = layoutGraph({ nodes, edges })
  const shuffled = layoutGraph({ nodes: [...nodes].reverse(), edges: [edges[2], edges[0], edges[1]] })
  assert.deepEqual(one, shuffled)
})
check('LR：依赖从左到右（a → b → c 的 x 递增）', () => {
  const { positions } = layoutGraph({ nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'b'), edge('b', 'c')] })
  assert.ok(positions.a.x + positions.a.w <= positions.b.x)
  assert.ok(positions.b.x + positions.b.w <= positions.c.x)
})
check('不重叠：任意两个节点矩形不相交', () => {
  const nodes = Array.from({ length: 12 }, (_, i) => node('n' + i))
  const edges = [edge('n0', 'n1'), edge('n0', 'n2'), edge('n1', 'n3'), edge('n2', 'n3'), edge('n3', 'n4'), edge('n4', 'n5'), edge('n5', 'n6'), edge('n6', 'n7'), edge('n5', 'n8'), edge('n8', 'n9'), edge('n9', 'n10'), edge('n10', 'n11')]
  const { positions } = layoutGraph({ nodes, edges })
  const list = Object.values(positions)
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    assert.equal(overlap(list[i], list[j]), false, i + '/' + j + ' 重叠')
  }
})
check('边界：所有节点都在 bounds 内', () => {
  const { positions, bounds } = layoutGraph({ nodes: [node('a'), node('b')], edges: [edge('a', 'b')] })
  for (const p of Object.values(positions)) {
    assert.ok(p.x >= 0 && p.y >= 0)
    assert.ok(p.x + p.w <= bounds.width && p.y + p.h <= bounds.height)
  }
})
check('坏输入：自环/未知端点/重复边被忽略，空输入不抛', () => {
  const out = layoutGraph({
    nodes: [node('a'), { id: 'a', w: 1, h: 1 }, node('b')],
    edges: [edge('a', 'a'), edge('a', 'zzz'), edge('a', 'b'), edge('a', 'b')],
  })
  assert.deepEqual(Object.keys(out.positions).sort(), ['a', 'b'])
  const empty = layoutGraph({ nodes: [], edges: [] })
  assert.deepEqual(empty.positions, {})
  assert.equal(empty.bounds.width, DEFAULT_LAYOUT_OPTIONS.margin * 2)
})
check('性能：100 个节点的链式图 < 50ms', () => {
  const nodes = Array.from({ length: 100 }, (_, i) => node('n' + i))
  const edges = Array.from({ length: 99 }, (_, i) => edge('n' + i, 'n' + (i + 1)))
  const started = Date.now()
  layoutGraph({ nodes, edges })
  const cost = Date.now() - started
  assert.ok(cost < 50, '实际耗时 ' + cost + 'ms')
})
check('参数：ranksep 越大，两列之间越宽', () => {
  const tight = layoutGraph({ nodes: [node('a'), node('b')], edges: [edge('a', 'b')] }, { ranksep: 40 })
  const loose = layoutGraph({ nodes: [node('a'), node('b')], edges: [edge('a', 'b')] }, { ranksep: 200 })
  assert.ok(loose.positions.b.x - tight.positions.b.x >= 150)
})

check('长列折行：20 个兄弟 + maxRankRows=6 → 4 根物理列，高度不爆', () => {
  const nodes = [node('root'), ...Array.from({ length: 20 }, (_, i) => node('c' + i)), node('tail')]
  const edges = [
    ...Array.from({ length: 20 }, (_, i) => edge('root', 'c' + i)),
    edge('c0', 'tail'),
  ]
  const { positions, bounds } = layoutGraph({ nodes, edges }, { maxRankRows: 6 })
  const columns = new Set(Object.values(positions).map((p) => p.x)).size
  assert.ok(columns >= 4, '应该有 4 根以上物理列，实际 ' + columns)
  assert.ok(bounds.height <= 6 * 84 + 5 * 24 + 32 * 2 + 40, '高度应该被压住，实际 ' + bounds.height)
  const list = Object.values(positions)
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    assert.equal(overlap(list[i], list[j]), false, i + '/' + j + ' 折行后重叠')
  }
})
check('长列折行：maxRankRows=0 时不折（保持 dagre 原样）', () => {
  const nodes = [node('root'), ...Array.from({ length: 12 }, (_, i) => node('c' + i))]
  const edges = Array.from({ length: 12 }, (_, i) => edge('root', 'c' + i))
  const wrapped = layoutGraph({ nodes, edges }, { maxRankRows: 6 })
  const plain = layoutGraph({ nodes, edges }, { maxRankRows: 0 })
  assert.ok(plain.bounds.height > wrapped.bounds.height, '不折应该更高')
})

console.log('\ngraphEngine.mjs: ' + passed + ' passed, ' + failures.length + ' failed')
if (failures.length) process.exit(1)
