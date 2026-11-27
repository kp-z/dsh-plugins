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
      /** iframe 的固定容器：跨面板挂载周期存在，绝不销毁。 */
      var host = null
      var frame = null
      /** iframe 第一次“有尺寸”时才加载的地址（见 ensureFrame 的注释）。 */
      var frameBase = null

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

      /** 建一次：容器 + iframe，挂到 body 下。之后的显隐都只改样式。 */
      function ensureFrame(base) {
        if (frame !== null) { frameBase = base; return }
        frameBase = base
        host = document.createElement('div')
        host.setAttribute('data-xcity-host', '')
        host.style.cssText = [
          'position:fixed',
          'z-index:1',
          'display:none',
          'overflow:hidden',
          'background:#14131b',
          'border-radius:0',
        ].join(';')
        frame = document.createElement('iframe')
        // R492：先不设 src。
        // 这个 iframe 先挂在 display:none 的容器里；隐藏状态下画布尺寸是 0，
        // Phaser 会以“现场画面未能启动”收场，之后即使面板打开也只剩错误页。
        // 等 place() 第一次拿到非零尺寸再加载，保证游戏一启动就是可见、有尺寸的。
        frame.title = 'xcity'
        frame.setAttribute('allow', 'clipboard-write')
        frame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#14131b'
        host.appendChild(frame)
        document.body.appendChild(host)
      }

      /** 把容器摆到面板占的位置上。 */
      function place(slot) {
        if (host === null || slot === null) return
        var rect = slot.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) {
          host.style.display = 'none'
          return
        }
        host.style.display = 'block'
        host.style.left = rect.left + 'px'
        host.style.top = rect.top + 'px'
        host.style.width = rect.width + 'px'
        host.style.height = rect.height + 'px'
        // R492：第一次真正可见、有尺寸时才加载游戏。
        if (frame !== null && frame.getAttribute('src') === null && frameBase !== null) {
          frame.setAttribute('src', frameBase + '/')
        }
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
        var slotRef = React.useRef(null)

        React.useLayoutEffect(function () {
          if (base === null) return undefined
          ensureFrame(base)
          var slot = slotRef.current
          var sync = function () { place(slot) }
          sync()
          var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null
          if (observer !== null && slot !== null) observer.observe(slot)
          window.addEventListener('resize', sync)
          window.addEventListener('scroll', sync, true)
          return function () {
            if (observer !== null) observer.disconnect()
            window.removeEventListener('resize', sync)
            window.removeEventListener('scroll', sync, true)
            // 只隐藏，不销毁：这正是"切走再久也不重载"的关键。
            if (host !== null) host.style.display = 'none'
          }
        }, [base])

        return h('div', {
          ref: slotRef,
          style: { position: 'relative', width: '100%', height: '100%' },
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
