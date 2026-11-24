/**
 * xcity 客户端半体：在 DSH 左侧栏注册一个 tab，里面是小镇前端（iframe）。
 *
 * 为什么用 iframe：小镇是一整套独立前端（自己的路由 / SSE / Phaser），我们只负责把它托起来，
 * 不改它一行代码。
 *
 * 「切回来停在原处」由服务端负责：访问过 /world/... 会下发 xcity_resume Cookie，
 * iframe 重建时从 / 加载，服务端 302 回上次那个路径（浏览器会自动带 Cookie）。
 */
(function () {
  window.__ModuleLoader__.load({
    id: 'dsh-xcity',
    factory: function (require) {
      var React = require('react')
      var h = React.createElement
      var KEY = 'xcity-game'
      var SRC = 'http://127.0.0.1:7788/'

      function Icon() {
        return h(
          'svg',
          { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
          h('path', {
            d: 'M2.5 7.2 8 3l5.5 4.2V13a.8.8 0 0 1-.8.8h-3v-3.4H6.3v3.4h-3A.8.8 0 0 1 2.5 13V7.2Z',
            stroke: 'currentColor',
            strokeWidth: 1.3,
            strokeLinejoin: 'round',
          }),
        )
      }

      function Panel() {
        return h('iframe', {
          src: SRC,
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
