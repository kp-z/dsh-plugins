import assert from 'node:assert/strict'
import { sunburstOption, sunburstRange, sunburstFromTasks } from '../src/client/insightSunburst.js'
import { loadEcharts } from '../src/client/echartsRuntime.js'

const tree = [
  { name: 'W1', value: 6, children: [{ name: 'A', value: 4 }, { name: 'B', value: 2 }] },
  { name: 'W2', value: 900, children: [{ name: 'C', value: 900 }] },
]

// 连续视觉映射：数值 → 渐变色，范围随数据走，不写死 0–10。
const option = sunburstOption(tree)
assert.equal(option.visualMap.type, 'continuous')
assert.equal(option.visualMap.min, 2)
assert.equal(option.visualMap.max, 900)
assert.ok(Array.isArray(option.visualMap.inRange.color) && option.visualMap.inRange.color.length >= 2)
assert.equal(option.series[0].type, 'sunburst')
assert.equal(option.series[0].label.rotate, 'radial')
assert.equal(option.series[0].data, tree)

// 换量纲仍然自适应：这是示例里最容易失效的点（固定 0–10）。
const small = sunburstOption([{ name: 'a', value: 1 }, { name: 'b', value: 3 }])
assert.equal(small.visualMap.min, 1)
assert.equal(small.visualMap.max, 3)

// 单一数值不能让 min === max（ECharts 会画成一片同色）。
const flat = sunburstOption([{ name: 'a', value: 7 }])
assert.equal(flat.visualMap.min, 7)
assert.equal(flat.visualMap.max, 8)
assert.deepEqual(sunburstRange([]), { min: 0, max: 1 })
assert.deepEqual(sunburstRange(null), { min: 0, max: 1 })

// 主题色可以覆盖（canvas 不认 CSS 变量，组件会先解析成真实颜色）。
const themed = sunburstOption(tree, { colors: ['rgb(1, 2, 3)', 'rgb(4, 5, 6)'] })
assert.deepEqual(themed.visualMap.inRange.color, ['rgb(1, 2, 3)', 'rgb(4, 5, 6)'])

// 任务快照 → 工作区 / 项目层级（只算未完成）。
assert.deepEqual(sunburstFromTasks([
  { meta: { workspace: 'W1' }, project: 'A' },
  { meta: { workspace: 'W1' }, project: 'A' },
  { meta: { workspace: 'W2' }, project: 'B' },
  { meta: { workspace: 'W2' }, project: 'B', done: true },
]), [
  { name: 'W1', value: 2, children: [{ name: 'A', value: 2 }] },
  { name: 'W2', value: 1, children: [{ name: 'B', value: 1 }] },
])
assert.deepEqual(sunburstFromTasks(null), [])

// 没有 document 时不抛，返回 rejected promise（调用方会显示错误态）。
await assert.rejects(() => loadEcharts(null))

console.log('SUNBURST_OK: continuous visualMap, adaptive range, radial labels, theme colours, task hierarchy')