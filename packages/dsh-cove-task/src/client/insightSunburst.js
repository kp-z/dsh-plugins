/** 旭日图：ECharts 连续视觉映射（数值 → 渐变色）+ 径向标签。 */

/** 色阶：低 → 高，全部用主题令牌，亮暗主题都成立。 */
import { loadEcharts, resolveThemeColors } from './echartsRuntime.js'

const FALLBACK_COLORS = ['#2F93C8', '#AEC48F', '#FFDB5C', '#F98862']

export const SUNBURST_COLORS = [
  'var(--fd-brand)',
  'var(--fd-ok)',
  'var(--fd-warn)',
  'var(--fd-danger)',
]

function valuesOf(tree) {
  const out = []
  const walk = (nodes) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      const value = Number(node?.value) || 0
      if (value > 0) out.push(value)
      if (Array.isArray(node?.children)) walk(node.children)
    }
  }
  walk(tree)
  return out
}

/**
 * 视觉映射范围按数据算，不写死 0–10：换一批量纲不同的数据，色阶自动跟着变。
 * 只有一个值时给一个有限的区间，避免 ECharts 拿到 min === max。
 */
export function sunburstRange(tree) {
  const values = valuesOf(tree)
  if (!values.length) return { min: 0, max: 1 }
  const min = Math.min(...values)
  const max = Math.max(...values)
  return { min, max: min === max ? min + 1 : max }
}

export function sunburstOption(tree, options = {}) {
  const { min, max } = sunburstRange(tree)
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', formatter: '{b} · {c}' },
    visualMap: {
      type: 'continuous',
      min,
      max,
      show: options.showScale === true,
      dimension: 0,
      inRange: { color: options.colors || SUNBURST_COLORS },
    },
    series: [{
      type: 'sunburst',
      data: tree,
      radius: ['12%', '92%'],
      /* 视觉映射按数值着色，所以扇区不带自己的 itemStyle.color */
      itemStyle: { borderColor: 'transparent', borderWidth: 1 },
      label: { rotate: 'radial', fontSize: 10, minAngle: 8 },
      emphasis: { focus: 'ancestor' },
      levels: [{}, {}, {}],
    }],
  }
}
export function createSunburstChart({ React, h = React.createElement }) {
  const { useEffect, useRef, useState } = React
  return function SunburstChart({ data, height = 240 }) {
    const box = useRef(null)
    const [error, setError] = useState('')
    useEffect(() => {
      const el = box.current
      if (!el) return undefined
      let chart = null
      let alive = true
      let observer = null
      loadEcharts(el.ownerDocument)
        .then((echarts) => {
          if (!alive) return
          chart = echarts.init(el, null, { renderer: 'canvas' })
          const colors = resolveThemeColors(el)
          chart.setOption(sunburstOption(data, colors.length ? { colors } : { colors: FALLBACK_COLORS }))
          if (typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(() => chart && chart.resize())
            observer.observe(el)
          }
        })
        .catch((failure) => { if (alive) setError(failure?.message || '图表加载失败') })
      return () => {
        alive = false
        if (observer) observer.disconnect()
        if (chart) chart.dispose()
      }
    }, [data])
    if (error) return h('div', { className: 'fd-sunburst-error', role: 'status' }, error)
    return h('div', {
      ref: box, className: 'fd-sunburst', style: { width: '100%', height: height + 'px' },
      role: 'img', 'aria-label': '层级分布：' + (Array.isArray(data) ? data.map((node) => node.name).join('、') : ''),
    })
  }
}

/** 任务快照 → 旭日图层级：工作区 → 项目 → 任务数。 */
export function sunburstFromTasks(tasks) {
  const list = Array.isArray(tasks) ? tasks.filter((task) => task && !task.done) : []
  const groups = new Map()
  for (const task of list) {
    const workspace = String(task.meta?.workspace || task.workspace || '未归属')
    const project = String(task.meta?.project || task.project || task.projectName || '未分组')
    if (!groups.has(workspace)) groups.set(workspace, new Map())
    const bucket = groups.get(workspace)
    bucket.set(project, (bucket.get(project) || 0) + 1)
  }
  return [...groups].map(([workspace, bucket]) => {
    const children = [...bucket].map(([project, count]) => ({ name: project, value: count }))
    return { name: workspace, value: children.reduce((sum, child) => sum + child.value, 0), children }
  })
}
