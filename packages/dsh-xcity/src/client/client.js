/**
 * xcity 客户端半体：DSH 左侧栏 tab，里面是小镇前端（iframe）。
 *
 * 桥的端口是配置项（正式 7788、测试 7790），**不能写死在客户端里**——
 * 之前写死 7788，测试 profile 的 tab 结果打开的是正式环境的小镇，改什么都"没生效"。
 * 现在先问宿主 GET /agent-world/api/bridge 拿 base，拿不到才退回 7788。
 */
(function () {
  window.__ModuleLoader__.load({
    id: 'dsh-xcity',
    factory: function (require) {
      var React = require('react')
      var h = React.createElement
      var KEY = 'xcity-game'
      var FALLBACK = 'http://127.0.0.1:7788'
      var cache = null

      function useBridgeBase() {
        var st = React.useState(cache)
        var base = st[0]
        var setBase = st[1]
        React.useEffect(function () {
          if (cache !== null) return undefined
          var alive = true
          fetch('/agent-world/api/bridge')
            .then(function (r) { return r.ok ? r.json() : null })
            .then(function (d) {
              var next = d && typeof d.base === 'string' && d.base !== '' ? d.base : FALLBACK
              cache = next
              if (alive) setBase(next)
            })
            .catch(function () { cache = FALLBACK; if (alive) setBase(FALLBACK) })
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

      function Panel() {
        var base = useBridgeBase()
        if (base === null) return h('div', { style: { padding: 12, font: '12px system-ui', opacity: 0.6 } }, '正在连接小镇…')
        return h('iframe', {
          src: base + '/',
          title: 'xcity',
          style: { display: 'block', width: '100%', height: '100%', border: '0', background: '#14131b' },
        })
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
