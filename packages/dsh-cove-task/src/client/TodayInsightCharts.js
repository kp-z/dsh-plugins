import { createEChartBox } from './echartsRuntime.js'
import { chartOption } from './insightChartOptions.js'

const STYLE_ID = 'dsh-cove-task-today-insight-charts'

const CSS = `
.fd-tic-insight-charts, .fd-tic-insight-chart-section {
  --tic-text: var(--fd-text, var(--dsw-alias-label-primary, CanvasText));
  --tic-dim: var(--fd-dim, var(--dsw-alias-label-secondary, CanvasText));
  --tic-line: var(--fd-line, var(--dsw-alias-border-l2, GrayText));
  --tic-line-strong: var(--fd-line-strong, var(--dsw-alias-border-l2, GrayText));
  --tic-surface: var(--fd-surface, var(--dsw-alias-bg-layer-1, Canvas));
  --tic-surface-2: var(--fd-surface-2, color-mix(in oklab, var(--tic-text) 6%, transparent));
  --tic-brand: var(--fd-brand, var(--dsw-alias-brand-primary, Highlight));
  --tic-ok: var(--fd-ok, var(--dsw-alias-state-success-primary, LinkText));
  --tic-warn: var(--fd-warn, var(--dsw-alias-state-warn-primary, Mark));
  --tic-idle: var(--fd-idle, var(--dsw-alias-state-idle-primary, GrayText));
  --tic-danger: var(--fd-danger, var(--dsw-alias-state-error-primary, VisitedText));
}

.fd-tic-insight-charts {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  min-width: 0;
  min-height: 156px;
  align-self: stretch;
}

.fd-tic-insight-chart { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.fd-tic-chart-fig { min-width: 0; }

/* 主图按内容定高：环图是 132px 的环 + 标题，固定 132 会把环裁掉/出滚动条 */
.fd-tic-insight-charts .fd-tic-insight-chart.is-hero {
  flex: 0 0 auto;
  height: auto;
  max-height: none;
}

.fd-tic-insight-charts .fd-tic-insight-chart.is-hero .fd-tic-chart-fig {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--tic-line-strong) transparent;
  padding-right: 3px;
}

.fd-tic-insight-charts .fd-tic-insight-chart.is-hero .fd-tic-chart-fig::-webkit-scrollbar { width: 6px; }
.fd-tic-insight-charts .fd-tic-insight-chart.is-hero .fd-tic-chart-fig::-webkit-scrollbar-thumb {
  background: var(--tic-line-strong);
  border-radius: 3px;
}

@media (max-width: 500px) {
  .fd-tic-insight-charts { min-height: 0; }
  .fd-tic-insight-charts .fd-tic-insight-chart.is-hero {
    flex: 0 0 auto;
    height: auto;
    max-height: none;
  }
  .fd-tic-insight-charts .fd-tic-insight-chart.is-hero .fd-tic-chart-fig { overflow: visible; }
}

.fd-tic-chart-switch {
  flex: 0 0 auto;
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 24px;
}

.fd-tic-chart-switch .fd-tic-chart-nav {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--tic-dim);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.fd-tic-chart-switch .fd-tic-chart-nav:hover { color: var(--tic-brand); }
.fd-tic-chart-switch .fd-tic-chart-nav:focus-visible { outline: 2px solid var(--tic-brand); outline-offset: 1px; border-radius: 4px; }

.fd-tic-chart-switch .fd-tic-chart-switch-count {
  font-size: 9.5px;
  color: var(--tic-dim);
  font-variant-numeric: tabular-nums;
}

.fd-tic-insight-chart .fd-tic-chart-title {
  flex: 0 0 auto;
  min-height: 12px;
  font-size: 11px;
  line-height: 1.3;
  color: var(--tic-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fd-tic-insight-chart-grid .fd-tic-chart-title {
  color: var(--tic-dim);
  font-weight: 600;
}

.fd-tic-chart-canvas { width: 100%; height: 100%; min-height: 124px; }
.fd-tic-insight-chart.is-hero .fd-tic-chart-canvas { min-height: 140px; }

.fd-tic-chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  font-size: 10px;
  color: var(--tic-dim);
  border: 1px dashed var(--tic-line);
  border-radius: 8px;
}

.fd-tic-insight-chart-section { display: flex; flex-direction: column; gap: 6px; }

.fd-tic-insight-chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
  gap: 10px;
}

.fd-tic-insight-chart-grid .fd-tic-insight-chart {
  padding: 9px 10px;
  background: var(--tic-surface-2);
  border: 1px solid var(--tic-line);
  border-radius: 10px;
}

.fd-tic-chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  font-size: 10px;
  color: var(--tic-dim);
  border: 1px dashed var(--tic-line);
  border-radius: 8px;
}

.fd-tic-insight-chart-section { display: flex; flex-direction: column; gap: 6px; }

.fd-tic-insight-chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
  gap: 10px;
}

.fd-tic-insight-chart-grid .fd-tic-insight-chart {
  padding: 9px 10px;
  background: var(--tic-surface-2);
  border: 1px solid var(--tic-line);
  border-radius: 10px;
}

`

/* 已知数据集 → 固定图元。AI 只能从这些 key 里挑；形状由数据集决定，
   免得模型给出「用饼图画 5×6 矩阵」这种画不出来的组合。数值一律来自本地 stats。 */
const CHART_TYPE_BY_DATASET = {
  done_by_day_7: 'bars',
  started_by_day_7: 'bars',
  wip_by_day_14: 'line',
  throughput_14: 'line',
  state_distribution: 'donut',
  workspace_distribution: 'donut',
  priority_urgency: 'heatmap',
  stalled_aging: 'bars',
  workspace_load: 'stacked',
  fulfillment_quality: 'quality',
  delay_reasons: 'hbars'
}

const CHART_DEFAULT_TITLES = {
  done_by_day_7: '近 7 天完成',
  started_by_day_7: '近 7 天新开工',
  wip_by_day_14: '在跑 WIP',
  throughput_14: '近 14 天吞吐',
  state_distribution: '状态分布',
  workspace_distribution: '工作区分布',
  priority_urgency: '优先级 × 紧急度',
  stalled_aging: '停滞老化',
  workspace_load: '工作区负载',
  fulfillment_quality: '履约质量',
  delay_reasons: '延期原因'
}

const HEAT_COL_SHORT = {
  '已逾期': '逾期',
  '2–3 天': '2–3',
  '4–7 天': '4–7',
  '8 天+': '8+',
  '无截止': '无'
}

/* 早会：今天从哪开始 → 近一周产出 → 负载堆在哪个工作区 */
const MORNING_CHARTS = [
  { dataset: 'state_distribution', title: '今天从哪开始' },
  { dataset: 'done_by_day_7', title: '近 7 天完成' },
  { dataset: 'workspace_load', title: '工作区负载' }
]

/* 诊断：优先级 × 紧急度定位「先动哪个」，停滞老化看「放了多久」，
   延期原因看「流程卡在哪」。AI 没给图时这三张也够读。 */
const DIAGNOSE_CHARTS = [
  { dataset: 'priority_urgency', title: '优先级 × 紧急度' },
  { dataset: 'stalled_aging', title: '停滞老化' },
  { dataset: 'delay_reasons', title: '延期原因' }
]

const chartArray = (values) => Array.isArray(values) ? values : []
function chartNumber(value) {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0
  return Number.isFinite(number) ? Math.max(0, number) : 0
}
const chartSum = (values) => chartArray(values).reduce((sum, value) => sum + chartNumber(value), 0)
const chartMax = (values) => values.reduce((max, value) => Math.max(max, chartNumber(value)), 0)
const chartText = (value) => typeof value === 'string' ? value.trim() : ''
const chartLabel = (value) => String(value ?? '')
const chartColor = (index) => CHART_COLORS[index % CHART_COLORS.length]
/* 环图几何与 dashboardStyles 的 .fd-donut 对齐（132 盒 / r=52 / 12px 描边）。 */
const DONUT_BOX = 132
const DONUT_R = 52
const DONUT_CENTER = DONUT_BOX / 2
const DONUT_CIRC = Math.PI * 2 * DONUT_R
const CHART_COLORS = ['var(--tic-ok)', 'var(--tic-brand)', 'var(--tic-idle)', 'var(--tic-danger)', 'var(--tic-warn)']

function stackColor(label, index) {
  if (label === '已完成' || label === '提前') return 'var(--tic-ok)'
  if (label === '在跑' || label === '准时') return 'var(--tic-brand)'
  if (label === '未开始') return 'var(--tic-idle)'
  if (label === '延期') return 'var(--tic-warn)'
  return chartColor(index)
}

// 只缩短 ISO 日期，保留「0–1 天」这类区间标签。
function chartAxisLabel(label, dateOffset) {
  const text = chartLabel(label)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.slice(dateOffset) : text
}

function lineSeries(data) {
  if (Array.isArray(data.values)) return [{ label: '', values: data.values, color: 'var(--tic-brand)' }]
  return [
    { label: '在跑', values: data.wip, color: 'var(--tic-brand)' },
    { label: '完成', values: data.done, color: 'var(--tic-ok)' },
    { label: '新开工', values: data.started, color: 'var(--tic-danger)' },
  ].filter((series) => Array.isArray(series.values) && series.values.length)
}

function hasChartSignal(dataset, data) {
  if (!data) return false
  const positive = (values) => chartArray(values).some((value) => chartNumber(value) > 0)
  switch (dataset) {
    case 'priority_urgency': return chartArray(data.values).some(positive)
    case 'workspace_load': return chartArray(data.series).some((series) => positive(series?.values))
    case 'throughput_14': return lineSeries(data).some(({ values }) => positive(values))
    case 'wip_by_day_14': return chartArray(data.values).filter((value) => chartNumber(value) > 0).length >= 2
    default: return positive(data.values)
  }
}

// AI 只能选择数据集和文案；图元和数值来自本地数据。过滤空图后去重、截断。
function pickChartSpecs(candidates, datasets, limit) {
  const specs = new Map()
  for (const candidate of candidates) {
    const dataset = candidate?.dataset
    if (typeof dataset !== 'string' || !Object.hasOwn(CHART_TYPE_BY_DATASET, dataset)
      || specs.has(dataset) || !hasChartSignal(dataset, datasets?.[dataset])) continue
    specs.set(dataset, {
      type: CHART_TYPE_BY_DATASET[dataset], dataset,
      title: chartText(candidate.title) || CHART_DEFAULT_TITLES[dataset],
    })
    if (specs.size === limit) break
  }
  return [...specs.values()]
}

function chartSpecs(mode, ai, datasets) {
  if (mode !== 'diagnose') return pickChartSpecs(MORNING_CHARTS, datasets, 3)
  const picked = ai?.mode !== 'morning' ? pickChartSpecs(chartArray(ai?.charts), datasets, 4) : []
  return picked.length ? picked : pickChartSpecs(DIAGNOSE_CHARTS, datasets, 3)
}

function activeChartIndex(index, length) {
  const integer = Number.isInteger(index) ? index : 0
  return length ? ((integer % length) + length) % length : 0
}

function stackRowValues(series, index) {
  return series.map((item, seriesIndex) => ({
    label: chartLabel(item?.label), value: chartNumber(chartArray(item?.values)[index]),
    color: stackColor(item?.label, seriesIndex),
  }))
}

// 与图形使用同一份数值；即使看不到颜色、形状也能读出摘要。
function chartAriaLabel(spec, data) {
  let parts = []
  if (spec.type === 'heatmap') {
    const rows = chartArray(data.rows), cols = chartArray(data.cols)
    parts = rows.flatMap((row, ri) => cols.flatMap((col, ci) => {
      const value = chartNumber(chartArray(data.values[ri])[ci])
      return value ? [chartLabel(row) + ' · ' + chartLabel(col) + ' ' + value] : []
    })).slice(0, 10)
  } else if (spec.type === 'stacked') {
    const series = chartArray(data.series)
    parts = chartArray(data.labels).slice(0, 6).map((label, index) => {
      const items = stackRowValues(series, index)
      const total = chartSum(items.map(({ value }) => value))
      return chartLabel(label) + '（' + items.map(({ label, value }) => label + ' ' + value).join('，') + '，共 ' + total + '）'
    })
  } else if (spec.type === 'line') {
    parts = lineSeries(data).map(({ label, values }) => (label ? label + ' ' : '')
      + '最新 ' + chartNumber(values[values.length - 1]) + '，峰值 ' + chartMax(values))
  } else {
    const labels = chartArray(data.labels || data.days)
    parts = chartArray(data.values).slice(0, 12).map((value, index) => chartLabel(labels[index]) + ' ' + chartNumber(value))
  }
  const separator = spec.type === 'stacked' || spec.type === 'line' ? '；' : '，'
  return spec.title + '：' + (parts.length ? parts.join(separator) : '暂无数据')
}

// 挂载时按实际 ownerDocument 注入；不同 React 根可能共享同一份样式。
function mountChartStyles(node) {
  const doc = node?.ownerDocument
  if (!doc?.head || doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  doc.head.appendChild(style)
}

/**
 * 两个组件共享 { mode, ai, datasets, chartIndex, onChangeIndex }。
 * Chart 渲染主图并通过 onChangeIndex(nextIndex) 请求切换；
 * ChartGrid 由宿主在展开时挂载，始终排除 chartIndex 对应的主图。
 * chartIndex 从 0 开始，由宿主在切换 tab 时重置。
 */
export function createTodayInsightCharts({ React, h = React.createElement }) {
  const cls = (name) => 'fd-tic-' + name
  const variant = (name, enabled, modifier) => cls(name) + (enabled ? ' ' + modifier : '')

  function ChartEmpty({ label = '暂无数据', standalone = false }) {
    return h('div', { className: cls('chart-empty'), role: standalone ? 'img' : undefined,
      'aria-label': standalone ? label : undefined }, label)
  }

  const EChart = createEChartBox({ React, h, optionOf: chartOption, fallback: [] })

  function ChartCard({ spec, data, hero = false }) {
    return h('div', { className: variant('insight-chart', hero, 'is-hero'), 'data-chart-hero': hero ? '1' : undefined,
      'data-chart-dataset': spec.dataset, 'data-chart-type': spec.type },
      h('div', { className: cls('chart-title'), title: spec.title }, spec.title),
      h('div', { className: cls('chart-fig'), role: 'img', 'aria-label': chartAriaLabel(spec, data) }, h(EChart, { spec, data, hero })))
  }

  function TodayInsightChart({ mode, ai, datasets, chartIndex, onChangeIndex }) {
    const specs = chartSpecs(mode, ai, datasets)
    const index = activeChartIndex(chartIndex, specs.length)
    const spec = specs[index]
    const navButton = (step, label, glyph) => h('button', { type: 'button', className: cls('chart-nav'),
      title: label, 'aria-label': label, disabled: !onChangeIndex,
      onClick(event) {
        event.stopPropagation()
        onChangeIndex?.(activeChartIndex(index + step, specs.length))
      },
    }, glyph)
    return h('div', { ref: mountChartStyles, className: cls('insight-charts'), role: 'group', 'aria-label': '图表' },
      spec ? h(ChartCard, { key: spec.dataset, spec, data: datasets[spec.dataset], hero: true })
        : h('div', { className: variant('insight-chart', true, 'is-hero'), 'data-chart-hero': '1' }, h(ChartEmpty, { standalone: true })),
      specs.length > 1 ? h('div', { className: cls('chart-switch') }, navButton(-1, '上一张图表', '‹'),
        h('span', { className: cls('chart-switch-count'), 'aria-live': 'polite' }, (index + 1) + ' / ' + specs.length),
        navButton(1, '下一张图表', '›')) : null)
  }

  function TodayInsightChartGrid({ mode, ai, datasets, chartIndex }) {
    const specs = chartSpecs(mode, ai, datasets)
    if (specs.length < 2) return null
    const index = activeChartIndex(chartIndex, specs.length)
    return h('section', { ref: mountChartStyles, className: cls('insight-chart-section'), 'data-chart-grid': '1', 'aria-label': '其余图表' },
      h('div', { className: cls('insight-chart-grid') }, specs.filter((_, i) => i !== index).map((spec) =>
        h(ChartCard, { key: spec.dataset, spec, data: datasets[spec.dataset] }))))
  }

  return { TodayInsightChart, TodayInsightChartGrid }
}
