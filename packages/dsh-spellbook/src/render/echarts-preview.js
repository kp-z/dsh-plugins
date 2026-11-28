/* Run pinned Apache ECharts gallery scripts inside the opaque preview frame. */
(() => {
  const config = JSON.parse(document.getElementById('echarts-example').textContent)
  const local = new URL('.', document.currentScript.src)
  const chartNode = document.getElementById('chart-container')
  let painted = false

  function report(state, message) {
    parent.postMessage({ type: 'spellbook:echarts-status', state, message }, '*')
  }

  function fail(error) {
    console.error('ECharts example:', config.id, error)
    if (!painted) report('error', '图版暂不可用：' + (error?.message || String(error)))
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = src
      script.onload = resolve
      script.onerror = () => reject(new Error('无法加载 ' + new URL(src).pathname.split('/').pop()))
      document.head.append(script)
    })
  }

  async function readSource() {
    if (config.source) return config.source
    const folder = config.gl ? 'gl/' : ''
    const url = config.root + '/examples/js/' + folder + config.id + '.js'
    const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error('官方示例源码响应 ' + response.status)
    return response.text()
  }

  async function loadDependencies(code) {
    if (/['"]bmap['"]|\bBMap\b/.test(code)) {
      throw new Error('该示例依赖百度地图授权，本站未配置其密钥')
    }
    const { cdn, gl, theme } = config
    await loadScript(new URL('echarts.min.js', local).href)
    const scripts = []
    if (gl) scripts.push(new URL('echarts-gl.min.js', local).href)
    if (/\$\s*[.(]/.test(code)) scripts.push(new URL('jquery.min.js', local).href)
    if (/\becStat\b/.test(code)) scripts.push(cdn + 'echarts-stat@1.2.0/dist/ecStat.min.js')
    if (/\bmodularity\b/.test(code)) scripts.push(cdn + 'echarts-graph-modularity@2.1.0/dist/echarts-graph-modularity.min.js')
    if (/app\.config\b/.test(code)) scripts.push(cdn + 'dat.gui@0.6.5/build/dat.gui.min.js')
    if (/(?:map|mapType)\s*:\s*['"]world['"]/.test(code)) scripts.push('https://echarts.apache.org/en/asset/map/js/world.js')
    if (/(?:map|mapType)\s*:\s*['"]china['"]/.test(code)) scripts.push(cdn + 'echarts@4.9.0/map/js/china.js')
    if (theme && theme !== 'dark' && /^[\w-]+$/.test(theme)) {
      scripts.push(cdn + 'echarts@6.1.0/theme/' + theme + '.js')
    }
    await Promise.all(scripts.map(loadScript))
  }

  function addControls(app) {
    if (!app.config || !window.dat?.GUI) return
    const gui = new window.dat.GUI({ autoPlace: false })
    gui.domElement.style.cssText = 'position:absolute;right:0;top:0;z-index:2'
    document.body.append(gui.domElement)
    const values = app.config
    for (const key of Object.keys(values)) {
      if (key === 'onChange' || key === 'onFinishChange') continue
      const parameters = app.configParameters?.[key]
      const options = parameters?.options
      let controller
      if (options) controller = gui.add(values, key, options)
      else if (parameters?.min != null) controller = gui.add(values, key, parameters.min, parameters.max, parameters.step)
      else if (typeof values[key] === 'string' && echarts.color.parse(values[key])) controller = gui.addColor(values, key)
      else controller = gui.add(values, key)
      for (const event of ['onChange', 'onFinishChange']) {
        if (typeof values[event] !== 'function') continue
        controller[event]((value) => {
          if (options) values[key] = Object.values(options).find((raw) => String(raw) === String(value)) ?? value
          values[event]()
        })
      }
    }
  }

  async function start() {
    const code = (await readSource()).trim().replace(/export\s+\{\s*\}\s*;?$/, '')
      .replace(/ROOT_PATH\s*\+\s*(['"])(\/data\/asset\/(?:data\/npmdepgraph\.min10\.json|img\/custom-gauge-panel\.png))\1/g,
        (_match, _quote, asset) => JSON.stringify(config.rawAssets + asset))
    // This upstream demo reads pixels from a texture that used to be same-origin.
    const runnable = config.id === 'bar3d-voxelize-image'
      ? code.replace('var img = new Image();', 'var img = new Image(); img.crossOrigin = "anonymous";')
      : code
    await loadDependencies(runnable)
    const chart = echarts.init(chartNode, config.theme ?? undefined)
    // The upstream roam-indicator examples use the bounding boxes of the rendered view.
    const app = { __internalAPI: { retrieveViewCoordSysRects(chart, query) {
      const view = chart.getModel().queryComponents(query)[0]?.coordinateSystem
      if (!view?.getViewRect || !view.getBoundingRect) throw new Error('该图版的坐标系不可用')
      const viewRect = view.getViewRect().clone()
      const contentBoundingRect = view.getBoundingRect().clone()
      const transform = view.getComputedTransform()
      if (transform) contentBoundingRect.applyTransform(transform)
      return { viewRect, contentBoundingRect }
    } } }
    if (window.jQuery) window.jQuery(document).ajaxError((_event, _response, request) => {
      fail(new Error('无法读取 ' + new URL(request.url, location.href).pathname.split('/').pop()))
    })
    function markRendered() {
      if (painted || !chart.getModel()) return
      // A globe or 3D map may have no series and paints outside the 2D display list.
      const model = chart.getModel()
      const glMap = config.gl && (model.getComponent('globe') || model.getComponent('geo3D'))
      if (!glMap && !chart.getZr().storage.getDisplayList().length && !model.getSeriesCount()) return
      painted = true
      clearTimeout(timeout)
      report('ready')
    }
    chart.getZr().on('rendered', markRendered)
    new ResizeObserver(() => {
      chart.resize()
      app.onresize?.()
    }).observe(chartNode)
    const run = new Function('myChart', 'app', 'ROOT_PATH', 'CDN_PATH', 'top', 'parent',
      'var css, option;\n' + runnable + '\nreturn [option, css];')
    const [option, css] = run(chart, app, config.root, config.cdn)
    if (css) document.getElementById('chart-styles').textContent = css
    if (option && typeof option === 'object') chart.setOption(option, true)
    addControls(app)
    if (config.gl) requestAnimationFrame(markRendered)
  }

  window.addEventListener('error', (event) => { if (event.error) fail(event.error) })
  window.addEventListener('unhandledrejection', (event) => fail(event.reason))
  const timeout = setTimeout(() => fail(new Error('运行超时，可能缺少资源或网络不可用')), 30000)
  start().catch((error) => { clearTimeout(timeout); fail(error) })
})()
