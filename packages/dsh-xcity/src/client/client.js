/**
 * dsh-xcity 的 Client 半体：把小镇放进 DSH 左侧栏的一个 tab。
 *
 * ## 为什么这么写
 *
 * DSH 的客户端插件不是本地 ES 模块，而是一个通过宿主模块加载器注册的工厂：
 *
 * ```
 * window.__ModuleLoader__.load({ id, factory })
 *   factory(require) -> { name, inject: ['slots'], apply }
 * ```
 *
 * `require('react')` 由宿主提供，所以这里**不需要打包 React**，
 * 也就不需要 esbuild/tsdown —— 这个文件本身就是最终产物（可读、可 diff）。
 *
 * ## 两个槽位必须同源
 *
 * `sidebar.panellist` 的 `id` 同时是 `main` 面板的 `key`（DSH 约定）。
 * 写成两个字符串就会各挂各的：点左边栏出来的是空白面板。
 *
 * ## 面板为什么是 iframe
 *
 * 小镇是一个独立的原版前端（http://127.0.0.1:7788/），它有自己的路由、SSE 和 Phaser 画布。
 * 把它塞进 React 树里的代价远大于收益；iframe 让它保持"自己是一个网站"，
 * 也能随时在浏览器里单独打开调试——cove 的侧栏面板也是这么做的。
 */
window.__ModuleLoader__.load({
  id: 'dsh-xcity',
  factory: function (require) {
    var React = require('react')
    var h = React.createElement

    /** 侧栏条目 id 与主面板 key，必须是同一个值。 */
    var KEY = 'xcity-game'
    /** 小镇前端地址；适配层默认监听 7788。 */
    var GAME_URL = 'http://127.0.0.1:7788/'

    /** 取可选服务：cordis 里访问未声明的服务会抛，所以要 try。 */
    function serviceOf(ctx, name) {
      if (!ctx) return undefined
      try {
        if (ctx[name]) return ctx[name]
      } catch (error) {
        /* 没有 inject 权限，往下走 ctx.get */
      }
      try {
        if (typeof ctx.get === 'function') return ctx.get(name)
      } catch (error) {
        /* 服务不存在 */
      }
      return undefined
    }

    /** 左侧栏里那个小图标（一条街道 + 一栋房子的极简轮廓）。 */
    function Icon() {
      return h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: 'M2 13h12' }),
        h('path', { d: 'M4 13V7l4-3 4 3v6' }),
        h('path', { d: 'M7 13v-3h2v3' }),
      )
    }

    /** 主面板：铺满的 iframe。 */
    function Panel() {
      return h('iframe', {
        src: GAME_URL,
        title: 'xcity',
        style: { display: 'block', width: '100%', height: '100%', border: 0, background: 'transparent' },
      })
    }

    function install(ctx) {
      var slots = serviceOf(ctx, 'slots')
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return false
      var disposers = []
      try {
        disposers.push(
          slots.inject('sidebar.panellist', function () {
            return slots.register({ name: 'sidebar.panellist', id: KEY, order: 24, label: function () { return 'xcity' } }, Icon)
          }),
        )
        disposers.push(
          slots.inject('main', function () {
            return slots.register({ name: 'main', key: KEY }, Panel)
          }),
        )
      } catch (error) {
        warn(error)
      }
      if (typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return function () {
            for (var i = 0; i < disposers.length; i += 1) {
              if (typeof disposers[i] === 'function') disposers[i]()
            }
          }
        })
      }
      return true
    }

    function warn(error) {
      try {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[dsh-xcity] 客户端半体初始化失败（不影响宿主启动）：', error)
        }
      } catch (ignored) {
        /* 打日志本身失败就算了 */
      }
    }

    function apply(ctx) {
      try {
        install(ctx)
      } catch (error) {
        warn(error)
      }
    }

    return { name: 'dsh-xcity', inject: ['slots'], apply: apply }
  },
})
