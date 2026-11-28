/** 7 类洞察图 → ECharts option（纯函数，便于单测）。颜色由调用方给已解析的主题色。 */

const asArray = (value) => (Array.isArray(value) ? value : [])
const num = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0 }
const text = (value) => (value == null ? '' : String(value))
const sum = (list) => list.reduce((total, value) => total + num(value), 0)
const palette = (colors) => (Array.isArray(colors) && colors.length ? colors : ['#2F93C8', '#AEC48F', '#FFDB5C', '#F98862'])
const axisLabel = (label) => {
  const value = text(label)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(5) : value
}
const baseGrid = { left: 6, right: 6, top: 16, bottom: 4, containLabel: true }
const axisStyle = { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 9 }, splitLine: { show: false } }

export function chartOption(spec, data, options = {}) {
  const colors = palette(options.colors)
  const hero = options.hero === true
  const type = text(spec && spec.type)
  const source = data && typeof data === 'object' ? data : {}
  const labelSize = hero ? 10 : 9

  if (type === 'donut') {
    const labels = asArray(source.labels)
    const values = asArray(source.values).map(num)
    return {
      color: colors,
      tooltip: { trigger: 'item', formatter: '{b} · {c}（{d}%）' },
      legend: { bottom: 0, itemWidth: 7, itemHeight: 7, textStyle: { fontSize: 9 }, icon: 'roundRect' },
      series: [{
        type: 'pie', radius: ['52%', '78%'], center: ['50%', '44%'],
        avoidLabelOverlap: true, label: { show: false }, labelLine: { show: false },
        data: labels.map((label, index) => ({ name: text(label), value: values[index] || 0 })),
      }],
    }
  }

  if (type === 'bars') {
    const labels = asArray(source.labels || source.days)
    const values = asArray(source.values).map(num)
    return {
      color: [colors[0]],
      tooltip: { trigger: 'axis' },
      grid: baseGrid,
      xAxis: { type: 'category', data: labels.map(axisLabel), ...axisStyle },
      yAxis: { type: 'value', ...axisStyle, axisLabel: { fontSize: 9, show: hero } },
      series: [{ type: 'bar', data: values, barMaxWidth: 18, itemStyle: { borderRadius: [3, 3, 0, 0] } }],
    }
  }

  if (type === 'line') {
    const labels = asArray(source.days || source.labels)
    const series = ['done', 'started', 'wip']
      .filter((key) => asArray(source[key]).length)
      .map((key, index) => ({
        name: key === 'done' ? '完成' : key === 'started' ? '新开工' : '在跑',
        type: 'line', smooth: false, symbol: 'none', lineStyle: { width: 1.6 },
        itemStyle: { color: colors[index % colors.length] },
        data: asArray(source[key]).map(num),
      }))
    return {
      color: colors,
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, itemWidth: 7, itemHeight: 7, textStyle: { fontSize: 9 } },
      grid: { ...baseGrid, bottom: 18 },
      xAxis: { type: 'category', data: labels.map(axisLabel), ...axisStyle },
      yAxis: { type: 'value', ...axisStyle },
      series,
    }
  }

  if (type === 'stacked') {
    const labels = asArray(source.labels)
    const series = asArray(source.series)
    return {
      color: colors,
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, itemWidth: 7, itemHeight: 7, textStyle: { fontSize: 9 } },
      grid: { ...baseGrid, bottom: 18 },
      xAxis: { type: 'value', ...axisStyle },
      yAxis: { type: 'category', data: labels.map(text), ...axisStyle, axisLabel: { fontSize: labelSize } },
      series: series.map((row, index) => ({
        name: text(row && row.label), type: 'bar', stack: 'total', barMaxWidth: 14,
        itemStyle: { color: colors[index % colors.length] },
        data: asArray(row && row.values).map(num),
      })),
    }
  }

  if (type === 'heatmap') {
    const rows = asArray(source.rows)
    const cols = asArray(source.cols)
    const matrix = asArray(source.values)
    const cells = []
    let max = 1
    rows.forEach((_, rowIndex) => {
      const line = asArray(matrix[rowIndex])
      cols.forEach((_, colIndex) => {
        const value = num(line[colIndex])
        max = Math.max(max, value)
        cells.push([colIndex, rowIndex, value])
      })
    })
    return {
      tooltip: { position: 'top' },
      grid: { ...baseGrid, bottom: 8 },
      xAxis: { type: 'category', data: cols.map(text), ...axisStyle },
      yAxis: { type: 'category', data: rows.map(text), ...axisStyle },
      visualMap: { min: 0, max, show: false, inRange: { color: [colors[0], colors[2] || colors[1]] } },
      series: [{ type: 'heatmap', data: cells, label: { show: true, fontSize: 9 } }],
    }
  }

  if (type === 'hbars') {
    const labels = asArray(source.labels)
    const values = asArray(source.values).map(num)
    return {
      color: [colors[2] || colors[0]],
      tooltip: { trigger: 'axis' },
      grid: baseGrid,
      xAxis: { type: 'value', ...axisStyle },
      yAxis: { type: 'category', data: labels.map(text), ...axisStyle, axisLabel: { fontSize: labelSize } },
      series: [{ type: 'bar', data: values, barMaxWidth: 12, itemStyle: { borderRadius: [0, 3, 3, 0] } }],
    }
  }

  const labels = asArray(source.labels)
  const values = asArray(source.values).map(num)
  return {
    color: colors,
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, itemWidth: 7, itemHeight: 7, textStyle: { fontSize: 9 } },
    grid: { ...baseGrid, bottom: 18 },
    xAxis: { type: 'value', show: false, max: sum(values) || 1 },
    yAxis: { type: 'category', data: [''], show: false },
    series: labels.map((label, index) => ({
      name: text(label), type: 'bar', stack: 'total', barMaxWidth: 14,
      itemStyle: { color: colors[index % colors.length] },
      data: [values[index] || 0],
    })),
  }
}