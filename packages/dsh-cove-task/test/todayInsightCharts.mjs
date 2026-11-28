import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTodayInsightCharts } from '../src/client/TodayInsightCharts.js'

const h = React.createElement
const { TodayInsightChart, TodayInsightChartGrid } = createTodayInsightCharts({ React, h })
const datasets = {
  state_distribution: { labels: ['已完成', '在跑', '未开始'], values: [3, 2, 5] },
  done_by_day_7: { days: ['2026-11-20', '2026-11-21'], values: [0, 3] },
  workspace_load: { labels: ['Core'], series: [{ label: '在跑', values: [2] }] },
  priority_urgency: { rows: ['P0', 'P1'], cols: ['已逾期', '今天'], values: [[1, 0], [0, 3]] },
  stalled_aging: { labels: ['0–1 天', '8 天+'], values: [1, 3] },
  delay_reasons: { labels: ['估时不准'], values: [2] },
  wip_by_day_14: { values: [2, 1, 3] },
  throughput_14: { wip: [2, 1, 3], done: [0, 2, 1], started: [1, 0, 2] },
  fulfillment_quality: { labels: ['提前', '准时', '延期'], values: [2, 3, 1] },
  started_by_day_7: { values: [0, 0] },
}

const render = (Component, props) => renderToStaticMarkup(h(Component, { datasets, ...props }))
const chartDatasets = (markup) => [...markup.matchAll(/data-chart-dataset="([^"]+)"/g)].map((match) => match[1])

test('selects different local defaults for morning and diagnosis', () => {
  const morning = render(TodayInsightChart, { mode: 'morning', ai: { charts: [{ dataset: 'priority_urgency' }] } })
  assert.deepEqual(chartDatasets(morning), ['state_distribution'])
  assert.match(morning, /aria-label="今天从哪开始：已完成 3，在跑 2，未开始 5"/)
  /* 中心总数与图例由 ECharts 绘制；这里只钉住容器与可读名，数值口径见 insightChartOptions 测试。 */
  assert.match(morning, /fd-tic-chart-canvas/)
  assert.deepEqual(chartDatasets(render(TodayInsightChartGrid, { mode: 'morning' })), ['done_by_day_7', 'workspace_load'])

  const diagnose = render(TodayInsightChart, { mode: 'diagnose', ai: { mode: 'morning', charts: [{ dataset: 'state_distribution' }] } })
  assert.deepEqual(chartDatasets(diagnose), ['priority_urgency'])
  assert.match(diagnose, /aria-label="优先级 × 紧急度：P0 · 已逾期 1，P1 · 今天 3"/)
  assert.equal((diagnose.match(/role="img"/g) || []).length, 1)
  const details = render(TodayInsightChartGrid, { mode: 'diagnose' })
  assert.deepEqual(chartDatasets(details), ['stalled_aging', 'delay_reasons'])
  assert.match(details, /8 天\+ 3/)
  assert.match(details, /估时不准 2/)
})

test('accepts only unique known AI datasets with signal, trusts local types and values, and caps at four', () => {
  const ai = { mode: 'diagnose', charts: [
    null, { dataset: 'not_a_dataset' }, { dataset: 'constructor' }, { dataset: 'started_by_day_7' },
    { type: 'hbars', dataset: 'state_distribution', title: ' <状态> ', why: ' 根据任务状态 ', values: [999] },
    { dataset: 'state_distribution', title: '重复' }, { dataset: 'wip_by_day_14' },
    { dataset: 'throughput_14' }, { dataset: 'fulfillment_quality' }, { dataset: 'done_by_day_7' },
  ] }
  const hero = render(TodayInsightChart, { mode: 'diagnose', ai })
  assert.deepEqual(chartDatasets(hero), ['state_distribution'])
  assert.match(hero, /data-chart-type="donut"/)
  assert.match(hero, /&lt;状态&gt;/)
  assert.doesNotMatch(hero, /999|重复/)
  const details = render(TodayInsightChartGrid, { mode: 'diagnose', ai })
  assert.deepEqual(chartDatasets(details), ['wip_by_day_14', 'throughput_14', 'fulfillment_quality'])
  assert.match(details, /新开工 最新 2，峰值 2/)
  assert.match(details, /提前 2，准时 3，延期 1/)
  const afterSwitch = render(TodayInsightChartGrid, { mode: 'diagnose', ai, chartIndex: 1 })
  assert.doesNotMatch(afterSwitch, /根据任务状态/)
  const invalidAI = { charts: [{ dataset: 'started_by_day_7' }, { dataset: 'unknown' }] }
  assert.deepEqual(chartDatasets(render(TodayInsightChart, { mode: 'diagnose', ai: invalidAI })), ['priority_urgency'])
})

test('navigation requests a wrapped index and the grid excludes the same active chart', () => {
  const updates = []
  const props = { mode: 'morning', datasets, chartIndex: 0, onChangeIndex: (index) => updates.push(index) }
  const tree = TodayInsightChart(props)
  const [previous, count, next] = tree.props.children[1].props.children
  assert.equal(previous.props['aria-label'], '上一张图表')
  assert.equal(next.props['aria-label'], '下一张图表')
  assert.equal(count.props['aria-live'], 'polite')
  let stopped = 0
  const event = { stopPropagation() { stopped++ } }
  previous.props.onClick(event)
  next.props.onClick(event)
  assert.deepEqual(updates, [2, 1])
  assert.equal(stopped, 2)

  for (const [index, expectedHero, expectedDetails] of [
    [1, 'done_by_day_7', ['state_distribution', 'workspace_load']],
    [5, 'workspace_load', ['state_distribution', 'done_by_day_7']],
    [-1, 'workspace_load', ['state_distribution', 'done_by_day_7']],
  ]) {
    const current = { ...props, chartIndex: index }
    assert.deepEqual(chartDatasets(render(TodayInsightChart, current)), [expectedHero])
    assert.deepEqual(chartDatasets(render(TodayInsightChartGrid, current)), expectedDetails)
  }
})

test('an empty hero has a readable name and a single chart has no duplicate grid or navigation', () => {
  const empty = render(TodayInsightChart, { mode: 'morning', datasets: { state_distribution: { values: [0] } } })
  assert.deepEqual(chartDatasets(empty), [])
  assert.match(empty, /data-chart-hero="1"/)
  assert.match(empty, /role="img" aria-label="暂无数据"/)
  assert.doesNotMatch(empty, /<button/)
  assert.equal(render(TodayInsightChartGrid, { mode: 'diagnose', datasets: null }), '')

  const single = { mode: 'morning', datasets: { state_distribution: { labels: ['完成', '在跑'], values: [4, 0] } } }
  const hero = render(TodayInsightChart, single)
  /* 自绘 SVG 已换成 ECharts canvas 容器；图的内容由 option 决定，见 insightChartOptions 测试。 */
  assert.match(hero, /fd-tic-chart-canvas/)
  assert.match(hero, /role="img" aria-label="今天从哪开始：完成 4，在跑 0"/)
  assert.doesNotMatch(hero, /<button/)
  assert.equal(render(TodayInsightChartGrid, single), '')
})

test('injects namespaced chart styles only once per mounted document', () => {
  const appended = []
  const doc = {
    getElementById: (id) => appended.find((style) => style.id === id),
    createElement: (tag) => ({ tag }),
    head: { appendChild: (style) => appended.push(style) },
  }
  const props = { mode: 'morning', datasets }
  const heroRef = TodayInsightChart(props).ref
  const gridRef = TodayInsightChartGrid(props).ref
  heroRef({ ownerDocument: doc })
  gridRef({ ownerDocument: doc })
  gridRef(null)
  assert.equal(appended.length, 1)
  assert.equal(appended[0].tag, 'style')
  assert.match(appended[0].textContent, /\.fd-tic-chart-nav:focus-visible/)
  assert.match(appended[0].textContent, /var\(--fd-brand, var\(--dsw-alias-brand-primary/)
  assert.doesNotMatch(appended[0].textContent, /var\(--p-/)
})
