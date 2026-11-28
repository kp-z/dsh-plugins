import assert from 'node:assert/strict'
import { chartOption } from '../src/client/insightChartOptions.js'

const colors = ['rgb(1, 2, 3)', 'rgb(4, 5, 6)', 'rgb(7, 8, 9)', 'rgb(10, 11, 12)']
const of = (type, data, extra = {}) => chartOption({ type }, data, { colors, ...extra })

// 环图：数值进 pie，图例在下，空值照收但不报错。
const donut = of('donut', { labels: ['完成', '在跑'], values: [3, 2] })
assert.equal(donut.series[0].type, 'pie')
assert.deepEqual(donut.series[0].data.map((row) => row.value), [3, 2])
assert.deepEqual(donut.color, colors)
assert.equal(donut.legend.bottom, 0)
assert.doesNotThrow(() => of('donut', {}))

// 柱状：日期缩成 MM-DD，数值原样。
const bars = of('bars', { days: ['2026-11-01', '2026-11-02'], values: [1, 4] })
assert.equal(bars.series[0].type, 'bar')
assert.deepEqual(bars.xAxis.data, ['11-01', '11-02'])
assert.deepEqual(bars.series[0].data, [1, 4])

// 折线：只画有数据的序列，空数组不生成空线。
const line = of('line', { days: ['d1', 'd2'], done: [1, 2], started: [] })
assert.equal(line.series.length, 1)
assert.equal(line.series[0].name, '完成')
assert.equal(line.series[0].type, 'line')

// 横向堆叠：一个 label 一个 stack 序列。
const stacked = of('stacked', { labels: ['W1'], series: [{ label: '在跑', values: [2] }, { label: '完成', values: [1] }] })
assert.equal(stacked.series.length, 2)
assert.equal(stacked.series[0].stack, 'total')
assert.equal(stacked.yAxis.type, 'category')

// 热力图：矩阵拍平成 [x, y, value] 三元组，区间跟随最大值。
const heat = of('heatmap', { rows: ['P0', 'P1'], cols: ['今天', '本周'], values: [[1, 2], [0, 3]] })
assert.equal(heat.series[0].type, 'heatmap')
assert.equal(heat.series[0].data.length, 4)
assert.deepEqual(heat.series[0].data[3], [1, 1, 3])
assert.equal(heat.visualMap.max, 3)

// 横向条与质量条：y 轴类别、单条堆叠。
const hbars = of('hbars', { labels: ['估时不准'], values: [2] })
assert.equal(hbars.series[0].type, 'bar')
assert.deepEqual(hbars.yAxis.data, ['估时不准'])
const quality = of('quality', { labels: ['提前', '准时'], values: [1, 3] })
assert.equal(quality.series.length, 2)
assert.equal(quality.xAxis.max, 4)

// 未知类型退回质量条口径，不抛。
assert.ok(of('nope', { labels: ['x'], values: [1] }).series.length === 1)

console.log('CHART_OPTIONS_OK: donut/bars/line/stacked/heatmap/hbars/quality all mapped to ECharts')