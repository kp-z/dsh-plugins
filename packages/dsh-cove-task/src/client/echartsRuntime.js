/** ECharts 运行时：本地 vendor 懒加载 + 主题令牌解析（canvas 不认 var(--x)）。 */

/* 走已存在的 /tasks/src/ 直出路由：旧宿主也能加载，不要求先重启。 */
export const ECHARTS_URL = '/dsh-cove-task/tasks/src/echartsVendor.js'
const NAMED_TOKENS = ['--fd-brand', '--fd-ok', '--fd-warn', '--fd-danger']
let loading = null

export function loadEcharts(doc) {
  const target = doc || (typeof document !== 'undefined' ? document : null)
  if (typeof window !== 'undefined' && window.echarts) return Promise.resolve(window.echarts)
  if (!target || !target.head) return Promise.reject(new Error('没有可用的 document'))
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = target.createElement('script')
    script.src = ECHARTS_URL
    script.onload = () => (window.echarts ? resolve(window.echarts) : reject(new Error('echarts 未挂上 window')))
    script.onerror = () => { loading = null; reject(new Error('加载 echarts 失败')) }
    target.head.appendChild(script)
  })
  return loading
}

/** CSS 变量 → canvas 认的颜色；探针元素只活一瞬，不参与布局。 */
export function resolveThemeColors(el, tokens = NAMED_TOKENS) {
  if (!el || typeof getComputedStyle !== 'function' || !el.ownerDocument) return []
  const probe = el.ownerDocument.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  el.appendChild(probe)
  const out = []
  for (const token of tokens) {
    probe.style.color = 'var(' + token + ')'
    const color = getComputedStyle(probe).color
    if (color && !color.includes('var(')) out.push(color)
  }
  probe.remove()
  return out.length === tokens.length ? out : []
}

/** 一类图一个实例：ref 挂载、resize、卸载 dispose，主题色在挂载时解析。 */
export function createEChartBox({ React, h, optionOf, fallback }) {
  const { useEffect, useRef, useState } = React
  return function EChartBox({ spec, data, hero = false }) {
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
          chart.setOption(optionOf(spec, data, { colors: colors.length ? colors : fallback, hero }))
          if (typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(() => chart && chart.resize())
            observer.observe(el)
          }
        })
        .catch((failure) => { if (alive) setError(failure && failure.message ? failure.message : '图表加载失败') })
      return () => {
        alive = false
        if (observer) observer.disconnect()
        if (chart) chart.dispose()
      }
    }, [spec, data])
    if (error) return h('div', { className: 'fd-tic-chart-empty', role: 'status' }, error)
    /* 高度交给样式表（.fd-tic-chart-canvas），这里只保证撑满容器。 */
    return h('div', { ref: box, className: 'fd-tic-chart-canvas', style: { width: '100%', height: '100%' } })
  }
}