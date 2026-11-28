/**
 * xcity 客户端半体：DSH 左侧栏 tab，里面是小镇前端（iframe）。
 *
 * ## 为什么 iframe 不放在 React 树里
 *
 * DSH 侧栏切 tab 会**卸载**面板组件；iframe 一旦随组件被移除，
 * 浏览上下文就被销毁——切回来等于整页重载（登录态、打开的抽屉、动画全丢）。
 *
 * 实测确认过：把 iframe 从 DOM 里搬到别处再搬回来，同样会重载
 * （window.name 从 MARK 变成 1，说明子文档重新跑了一遍）。
 * 所以"停车场"那种挪来挪去的写法是无效的。
 *
 * 这里的做法是：iframe 只创建一次，挂在 document.body 下的固定定位容器里，
 * 永远不离开文档。面板只负责**量出自己该占的矩形**，把容器摆过去；
 * 面板卸载时把容器 display:none，而不是删节点。于是切走再久，回来还是原来那一帧。
 *
 * ## 桥的地址
 *
 * 端口是配置项（正式 7788、测试 7790），不能写死，先问宿主 /agent-world/api/bridge。
 */
(function () {
  window.__ModuleLoader__.load({
    id: 'dsh-xcity',
    factory: function (require) {
      var React = require('react')
      var h = React.createElement
      var KEY = 'xcity-game'
      var FALLBACK = 'http://127.0.0.1:7788'

      var baseCache = null
      /**
       * R534（用户要求）：tab 不再内嵌 iframe，而是**在小镇自己的窗口里打开**。
       *
       * 之前把 iframe 挂在 body 下、跨面板周期不销毁，是为了避免切 tab 重载游戏；
       * 但那条路要维护一套"隐藏/摆放/首次有尺寸才加载"的机制，还和 Cookie、文档计数耦合。
       * 换成独立窗口后：DSH 侧栏只是一个"打开/再次打开"的入口，游戏自己管自己的生命周期，
       * 切 tab、刷新面板、甚至关掉侧栏都不会影响它。
       */
      var TOWN_WINDOW = 'xcity-town'
      var TOWN_FEATURES = 'popup=yes,width=1440,height=900,left=80,top=60'

      /** 打开（或聚焦）小镇窗口；返回是否成功——弹窗被拦时返回 false，由面板提示用户再点一次。 */
      function openTown(base) {
        try {
          var win = window.open(base + '/', TOWN_WINDOW, TOWN_FEATURES)
          if (win === null) return false
          try { win.focus() } catch (e) { /* 跨窗口 focus 可能被拒，不影响 */ }
          return true
        } catch (error) {
          console.warn('[dsh-xcity] 打开小镇窗口失败：' + String(error))
          return false
        }
      }

      function useBridgeBase() {
        var st = React.useState(baseCache)
        var base = st[0]
        var setBase = st[1]
        React.useEffect(function () {
          if (baseCache !== null) return undefined
          var alive = true
          fetch('/agent-world/api/bridge')
            .then(function (r) { return r.ok ? r.json() : null })
            .then(function (d) {
              var next = d && typeof d.base === 'string' && d.base !== '' ? d.base : FALLBACK
              baseCache = next
              if (alive) setBase(next)
            })
            .catch(function () { baseCache = FALLBACK; if (alive) setBase(FALLBACK) })
          return function () { alive = false }
        }, [])
        return base
      }

      function Icon() {
        return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
          h('path', {
            d: 'M2.5 7.2 8 3l5.5 4.2V13a.8.8 0 0 1-.8.8h-3v-3.4H6.3v3.4h-3A.8.8 0 0 1 2.5 13V7.2Z',
            stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
          }))
      }

      /**
       * R535（用户要求）：侧栏 tab 变成 xcity 控制台——启动/暂停世界、看状态、开小镇窗口。
       *
       * 为什么不嵌 iframe：小镇是个独立页面（Phaser + 自己的窗口尺寸），塞进侧栏会随
       * 切 tab 反复重建；控制台只要状态与按钮，比 iframe 更省也更好用。
       */

      /* ── R536：xcity 监控看板 ────────────────────────────────────────────
       *
       * 布局用 span-dashboard-grid 的做法：**固定 4 列** + 卡片自带 span，
       * 面板变窄时用 ResizeObserver（等价于容器查询，但不依赖 container-type
       * 挂在哪个祖先上）退回单列堆叠。
       * 图表用 chart-dark-subtle-gridlines 的做法：辅助线只画在实际刻度上、
       * 压暗；数据线用青色、末值用琥珀色——读值靠刻度，看趋势靠线色。
       */
      var PALETTE = {
        paper: '#14161d', card: '#1a1d26', line: '#262a36',
        ink: '#e8e6f0', label: '#8d93a6', faint: '#5b6274',
        teal: '#6ee7d0', amber: '#ffc279', rose: '#ef8fa6', violet: '#a99cf5',
      }

      var HISTORY_MAX = 60

      function svgPath(values, width, height, min, max) {
        if (values.length < 2) return ''
        var span = Math.max(1e-9, max - min)
        var step = width / (values.length - 1)
        var out = ''
        for (var i = 0; i < values.length; i += 1) {
          var x = i * step
          var y = height - ((values[i] - min) / span) * height
          out += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' '
        }
        return out.trim()
      }

      function svgArea(values, width, height, min, max) {
        var line = svgPath(values, width, height, min, max)
        if (line === '') return ''
        return line + ' L' + width.toFixed(1) + ' ' + height.toFixed(1) + ' L0 ' + height.toFixed(1) + ' Z'
      }

      function chart(values, opts) {
        var o = opts || {}
        var w = o.width || 220
        var h = o.height || 44
        var color = o.color || PALETTE.teal
        var min = o.min === undefined ? 0 : o.min
        var max = o.max
        if (max === undefined) {
          var peak = values.length === 0 ? 1 : Math.max.apply(null, values)
          max = Math.max(peak, min + 1)
        }
        var id = 'g' + Math.random().toString(36).slice(2, 8)
        var guides = [0, 0.5, 1].map(function (r) {
          var y = h - r * h
          return h('line', { key: 'g' + r, x1: 0, y1: y, x2: w, y2: y, stroke: PALETTE.line, 'stroke-width': 1 })
        })
        var children = [
          h('defs', { key: 'd' },
            h('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 },
              h('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': 0.28 }),
              h('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }))),
          h('g', { key: 'grid' }, guides),
          h('path', { key: 'area', d: svgArea(values, w, h, min, max), fill: 'url(#' + id + ')' }),
          h('path', { key: 'line', d: svgPath(values, w, h, min, max), fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
        ]
        if (values.length > 0) {
          var last = values[values.length - 1]
          var y = h - ((last - min) / Math.max(1e-9, max - min)) * h
          children.push(h('circle', { key: 'dot', cx: w, cy: Math.max(1, Math.min(h - 1, y)), r: 2.2, fill: PALETTE.amber }))
        }
        return h('svg', { width: '100%', height: String(h), viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: 'none', role: 'img', 'aria-label': o.label || '' }, children)
      }

      function card(span, title, extra, body) {
        return h('article', {
          key: title,
          style: {
            gridColumn: span > 1 ? 'span ' + String(span) : 'auto',
            background: PALETTE.card,
            border: '1px solid ' + PALETTE.line,
            borderRadius: '10px',
            padding: '10px 12px',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            overflow: 'hidden',
          },
        },
          h('header', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px' } },
            h('span', { style: { fontSize: '11px', color: PALETTE.label, letterSpacing: '0.02em' } }, title),
            extra === null ? null : h('span', { style: { fontSize: '15px', color: PALETTE.ink, fontFamily: 'ui-monospace, monospace' } }, extra)),
          body,
        )
      }

      function statRow(label, value, color) {
        return h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: PALETTE.label } },
          h('span', null, label),
          h('b', { style: { color: color || PALETTE.ink, fontFamily: 'ui-monospace, monospace' } }, value))
      }

      function Dashboard() {
        var base = useBridgeBase()
        var snap = React.useState(null)
        var world = snap[0]
        var setWorld = snap[1]
        var hist = React.useState([])
        var history = hist[0]
        var setHistory = hist[1]
        var err = React.useState(null)
        var error = err[0]
        var setError = err[1]
        var busy = React.useState(false)
        var pending = busy[0]
        var setPending = busy[1]
        var wide = React.useState(true)
        var isWide = wide[0]
        var setWide = wide[1]
        var rootRef = React.useRef(null)

        var apply = function (w) {
          setWorld(w || null)
          if (w && typeof w.tick === 'number') {
            setHistory(function (prev) {
              var agents = Array.isArray(w.agents) ? w.agents : []
              var avg = function (key) {
                if (agents.length === 0) return 0
                return Math.round(agents.reduce(function (sum, a) {
                  var needs = a.needs || {}
                  return sum + (typeof needs[key] === 'number' ? needs[key] : 0)
                }, 0) / agents.length)
              }
              var counts = { working: 0, sleeping: 0, walking: 0, talking: 0, idle: 0 }
              for (var i = 0; i < agents.length; i += 1) {
                var st = agents[i].state
                counts[st] = (counts[st] || 0) + 1
              }
              var next = prev.concat([{
                tick: w.tick,
                hunger: avg('hunger'),
                energy: avg('energy'),
                social: avg('social'),
                counts: counts,
              }])
              return next.slice(-HISTORY_MAX)
            })
          }
        }

        React.useEffect(function () {
          var alive = true
          var load = function () {
            fetch('/agent-world/api/world')
              .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)) })
              .then(function (d) { if (alive) { apply(d && d.world ? d.world : null); setError(null) } })
              .catch(function (e) { if (alive) setError(String(e && e.message ? e.message : e)) })
          }
          load()
          var timer = setInterval(load, 2000)
          return function () { alive = false; clearInterval(timer) }
        }, [])

        React.useLayoutEffect(function () {
          var node = rootRef.current
          if (node === null || typeof ResizeObserver !== 'function') return undefined
          var observer = new ResizeObserver(function (entries) {
            var width = entries[0] && entries[0].contentRect ? entries[0].contentRect.width : node.clientWidth
            setWide(width >= 300)
          })
          observer.observe(node)
          return function () { observer.disconnect() }
        }, [])

        var send = function (kind) {
          setPending(true)
          fetch('/agent-world/api/command', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ command: { kind: kind } }),
          })
            .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)) })
            .then(function () { return fetch('/agent-world/api/world') })
            .then(function (r) { return r.json() })
            .then(function (d) { apply(d && d.world ? d.world : null); setError(null) })
            .catch(function (e) { setError(String(e && e.message ? e.message : e)) })
            .then(function () { setPending(false) })
        }

        var paused = world !== null && world.paused === true
        var agents = world !== null && Array.isArray(world.agents) ? world.agents : []
        var tasks = world !== null && Array.isArray(world.tasks) ? world.tasks : []
        var tick = world !== null ? world.tick : null
        var day = tick === null || tick === undefined ? null : Math.floor(tick / 1440) + 1
        var minute = tick === null || tick === undefined ? null : tick % 1440
        var clock = minute === null ? '—'
          : String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0')
        var doneCount = tasks.filter(function (t) { return t.status === 'done' }).length
        var openCount = tasks.length - doneCount
        var energySeries = history.map(function (h2) { return h2.energy })
        var socialSeries = history.map(function (h2) { return h2.social })
        var hungerSeries = history.map(function (h2) { return h2.hunger })
        var last = history.length === 0 ? null : history[history.length - 1]
        var stateRows = last === null ? [] : Object.keys(last.counts).filter(function (k) { return last.counts[k] > 0 })
        var button = function (label, kind, tone) {
          return h('button', {
            key: label,
            disabled: pending,
            onClick: function () {
              // 打开小镇不是世界命令：它只是开一个窗口，别往 /api/command 发 null。
              if (kind === null) { openTown(base === null ? FALLBACK : base); return }
              send(kind)
            },
            style: {
              flex: '1 1 auto', padding: '6px 8px', borderRadius: '7px',
              border: '1px solid ' + (tone || PALETTE.line),
              background: 'transparent', color: tone || PALETTE.ink,
              cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.45 : 1,
              font: 'inherit', fontSize: '12px',
            },
          }, label)
        }

        // R542：看板**只渲染快照发下来的派生结果**（`agents[].skills`，来源是 sim/skills.ts）。
        // 这里不 filter、不计数、不判等级：R541 第一版在这自己抄了一遍，口径当天就和内核分叉
        // （内核跳过带 taskAttemptId 的活动，这里没跳）；而且阈值、标签表也会变成第二份。
        // 口径叫「近期手感」：按活动窗口派生，窗口滚动会回落——那只是窗口语义，不是惩罚。
        // 老存档/老快照没有 skills 字段时按空数组处理（additive 字段，缺了不炸）。
        var skillRows = agents.map(function (a) {
          var rows = Array.isArray(a.skills) ? a.skills : []
          return { name: a.name, rows: rows.slice(0, 3) }
        })

        var cards = [
          card(2, '运行状态', paused ? '已暂停' : '运行中',
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
              statRow('世界时间', clock),
              statRow('第几天', day === null ? '—' : 'D' + String(day)),
              statRow('tick', tick === null ? '—' : String(tick)),
              statRow('角色', String(agents.length) + ' 人'),
              statRow('工单', openCount + ' 进行 / ' + doneCount + ' 完成'))),
          card(1, '平均体力', last === null ? '—' : String(last.energy),
            chart(energySeries, { color: PALETTE.teal, label: '平均体力', min: 0, max: 100 })),
          card(1, '平均社交', last === null ? '—' : String(last.social),
            chart(socialSeries, { color: PALETTE.violet, label: '平均社交', min: 0, max: 100 })),
          card(4, '需求曲线（近 ' + String(history.length) + ' 个采样 · 每 2 秒）', null,
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
              chart(energySeries, { color: PALETTE.teal, height: 52, label: '体力', min: 0, max: 100 }),
              chart(hungerSeries, { color: PALETTE.amber, height: 40, label: '饥饿', min: 0, max: 100 }),
              h('div', { style: { display: 'flex', gap: '12px', fontSize: '11px', color: PALETTE.faint } },
                h('span', { style: { color: PALETTE.teal } }, '● 体力'),
                h('span', { style: { color: PALETTE.amber } }, '● 饥饿'),
                h('span', { style: { color: PALETTE.violet } }, '● 社交')))),
          card(2, '角色状态', null,
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
              stateRows.length === 0 ? h('span', { style: { color: PALETTE.faint, fontSize: '12px' } }, '等待采样…')
                : stateRows.map(function (k) {
                  return h('div', { key: k, style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' } },
                    h('span', { style: { width: '52px', color: PALETTE.label } }, k),
                    h('span', { style: { flex: '1 1 auto', height: '5px', borderRadius: '3px', background: PALETTE.line, position: 'relative' } },
                      h('span', {
                        style: {
                          position: 'absolute', inset: '0 auto 0 0', borderRadius: '3px',
                          width: String(Math.round((last.counts[k] / Math.max(1, agents.length)) * 100)) + '%',
                          background: PALETTE.teal,
                        },
                      })),
                    h('b', { style: { color: PALETTE.ink, fontFamily: 'ui-monospace, monospace' } }, String(last.counts[k])))
                }))),
          card(2, '近期手感（滚动窗口）', null,
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              skillRows.length === 0 ? h('span', { style: { color: PALETTE.faint, fontSize: '12px' } }, '还没有角色')
                : skillRows.map(function (row) {
                  return h('div', { key: row.name, style: { display: 'flex', gap: '8px', fontSize: '12px' } },
                    h('span', { style: { color: PALETTE.label, width: '52px' } }, row.name),
                    h('span', { style: { color: PALETTE.ink, fontFamily: 'ui-monospace, monospace' } },
                      row.rows.length === 0 ? '—'
                        : row.rows.map(function (r) {
                          return r.label + ' ' + String(r.level) + ' 级 · ' + String(r.sample) + ' 次'
                        }).join(' · ')))
                }),
              h('span', { style: { color: PALETTE.faint, fontSize: '10px', marginTop: '2px' } },
                '按最近的活动窗口派生，窗口滚动会回落——不是惩罚。'))),
          card(2, '控制', null,
            h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
              button(paused ? '▶ 启动' : '⏸ 暂停', paused ? 'resume' : 'pause', paused ? PALETTE.teal : PALETTE.amber),
              button('↻ 重开', 'reset'),
              button('打开小镇', null))),
        ]

        return h('div', {
          ref: rootRef,
          style: {
            padding: '12px',
            background: PALETTE.paper,
            color: PALETTE.ink,
            font: '12px/1.5 system-ui, -apple-system, sans-serif',
            minHeight: '100%',
            boxSizing: 'border-box',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } },
            h('b', { style: { fontSize: '13px', letterSpacing: '0.04em' } }, 'XCITY'),
            h('span', {
              style: {
                fontSize: '10px', padding: '1px 7px', borderRadius: '9px',
                background: paused ? 'rgba(255,194,121,0.14)' : 'rgba(110,231,208,0.14)',
                color: paused ? PALETTE.amber : PALETTE.teal,
              },
            }, world === null ? '读取中' : paused ? '已暂停' : '运行中')),
          h('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: isWide ? 'repeat(4, minmax(0, 1fr))' : 'minmax(0, 1fr)',
              gridAutoRows: isWide ? '86px 86px auto auto auto' : 'auto',
              gap: '8px',
            },
          }, cards.map(function (node) {
            return isWide ? node : React.cloneElement(node, { key: node.key, style: Object.assign({}, node.props.style, { gridColumn: 'auto' }) })
          })),
          error === null ? null : h('div', { style: { color: PALETTE.rose, marginTop: '10px', fontSize: '11px' } }, '操作失败：' + error),
          h('div', { style: { color: PALETTE.faint, marginTop: '10px', fontSize: '10px' } },
            '启动/暂停只影响模拟推进；关掉面板不会停世界。'),
        )
      }

      function Panel() {
        return h(Dashboard, null)
      }

      function apply(ctx) {
        try {
          var slots = ctx.slots || (ctx.get && ctx.get('slots'))
          if (!slots) {
            console.warn('[dsh-xcity] 宿主没有 slots 服务，左侧栏 tab 不可用')
            return
          }
          var disposers = []
          slots.inject('sidebar.panellist', function () {
            disposers.push(slots.register({ name: 'sidebar.panellist', id: KEY, order: 24, label: function () { return 'xcity' } }, Icon))
          })
          slots.inject('main', function () {
            disposers.push(slots.register({ name: 'main', key: KEY }, Panel))
          })
          ctx.effect(function () {
            return function () {
              for (var i = 0; i < disposers.length; i += 1) {
                try { disposers[i]() } catch (e) { /* 卸载时不要抛 */ }
              }
            }
          })
        } catch (error) {
          console.warn('[dsh-xcity] 客户端半体注册失败：' + String(error))
        }
      }

      return { name: 'dsh-xcity', inject: ['slots'], apply: apply }
    },
  })
})()
