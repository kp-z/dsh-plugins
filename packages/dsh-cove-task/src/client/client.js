/**
 * dsh-cove-task 的 **Client 半体**（构建入口，产物是 lib/client.iife.js）。
 *
 * 它只做「宿主侧的装配与注册」，**不装视图**：
 *   1. 右侧栏「Cove Task」页签 —— iframe（panel.html 是上一代整页面板）；
 *   2. 左侧栏「任务」—— 挂到 `sidebar.panellist` + `main` 的 React 组件；
 *   3. 会话输入框上方的「存为飞书任务」dock。
 *
 * 视图从哪来（这条很重要）：
 *   不在这个包里静态 import 组件树，而是运行时 `import('/dsh-cove-task/tasks/src/ui.js')`。
 *   原因是面板有两条入口 —— 宿主里的客户端半体，和浏览器里的独立页（tasksBoot.js）。
 *   两个入口如果各自静态 import，构建产物就内联了一份界面快照：改了 src/client/*.js
 *   之后独立页（直接吃源码）立刻变、宿主里还是旧包，非要重构建加重载插件才动。
 *   界面的唯一来源因此是 src/client/ui.js：宿主侧动态 import 它，独立页静态 import 它，
 *   改完刷新页面两边一起变。这个包里剩下的只有宿主接缝（页签、桥、注册）。
 *
 * 构建：`pnpm --filter dsh-cove-task build:client`（tsdown → lib/client.iife.js）。
 * 本文件改完需要重载插件；视图改完只要刷新页面。
 */

import { createSidebarHalf, TAB_ID as COVE_TAB_ID } from './sidebar-tab.js'
import { installSessionBridge } from './sessionBridge.js'

/* 视图装配模块在插件自己的路由上（/tasks/src/<file>.js → src/client/<file>.js）。
   用变量接住地址：构建期不能把这个动态 import 当成静态依赖解析掉。 */
const UI_MODULE_PATH = '/dsh-cove-task/tasks/src/ui.js'

/**
 * 装配模块的绝对地址。
 *
 * 必须按 **document.baseURI** 解析，不能直接 import('/dsh-cove-task/...')：
 * 桌面外壳的页面 origin 是 dsh-app://app/，直接写路径会把「/dsh-cove-task」当成主机名
 * 解析成 dsh-app://dsh-cove-task/...（那条协议只服务 app 这个主机，必然 404）。
 * 相对 baseURI 解析得到 dsh-app://app/dsh-cove-task/...，和 /api/file 那类路由同一条路；
 * 而 Web 端（http://127.0.0.1:PORT/）解析结果不变。
 */
function uiModuleUrl() {
  try {
    const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : undefined
    if (base) return new URL(UI_MODULE_PATH, base).href
  } catch (error) {
    /* 落到下面的裸路径 */
  }
  return UI_MODULE_PATH
}

/* sidebar.panellist 的 id 同时就是 main 面板的 key（DSH 约定），两处必须同源。 */
const OVERVIEW_KEY = 'cove-task-overview'
/* 面板在左侧栏显示的名字：插件改名 Cove Task 后跟随；面板内部的品牌标仍是「海湾」。 */
const OVERVIEW_LABEL = 'Cove Task'

/* 取可选服务：cordis 里访问未声明的服务会直接抛，两段分开 try。 */
function serviceOf(ctx, name) {
  if (!ctx) return undefined
  try {
    if (ctx[name]) return ctx[name]
  } catch (error) {
    /* 没有 inject 权限，走 ctx.get */
  }
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined
  } catch (error) {
    return undefined
  }
}

/* 总览图标：三个节点连成一条链（关系图的抽象），与页签纸飞机区分。宿主会给 {size, active}。 */
function overviewIcon(h, props) {
  const size = props && typeof props.size === 'number' ? props.size : 16
  return h('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.4,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    style: { display: 'block', opacity: props && props.active === false ? 0.75 : 1 },
  },
    h('path', { d: 'M3.5 12.5 8 8l4.5-4.5' }),
    h('circle', { cx: 3.4, cy: 12.6, r: 1.7 }),
    h('circle', { cx: 8, cy: 8, r: 1.7 }),
    h('circle', { cx: 12.6, cy: 3.4, r: 1.7 }))
}

/* 视图偏好（选中项、折叠）只落本地，且必须走 store，方便测试替换。 */
function createStore() {
  const prefix = 'fo:'
  return {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(prefix + key)
        return raw == null ? fallback : JSON.parse(raw)
      } catch (error) {
        return fallback
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(prefix + key, JSON.stringify(value))
      } catch (error) {
        /* 隐私模式等场景写不进去就算了，视图偏好不值得报错 */
      }
    },
  }
}

/**
 * 宿主能力位：面板是宿主页面里的 React 组件，拿不到 iframe 那套 postMessage，
 * 所以「打开会话」直接调宿主的 uiWorkspace 服务。ctx 只有在 apply 时才有，
 * 因此用一个**晚绑定**的 holder：装配时先把它交给面板，apply 时再填实现。
 */
function makeHostHolder() {
  return {
    /** 面板用它决定「打开会话」按钮是否可用；返回原因便于 tooltip。 */
    canOpenSession() {
      const ui = serviceOf(this.__ctx, 'uiWorkspace')
      if (!ui) return { ok: false, reason: '当前宿主没有 uiWorkspace 服务' }
      if (typeof ui.openSession !== 'function') return { ok: false, reason: '当前宿主不支持打开会话' }
      return { ok: true }
    },
    /** 打开右侧栏的「Cove Task」页签；宿主没有 betterSidebar 时返回 false（不报错）。 */
    openFeishuTab(sessionId) {
      const sidebar = serviceOf(this.__ctx, 'betterSidebar')
      if (!sidebar || typeof sidebar.openTab !== 'function') return false
      try {
        sidebar.openTab(
          { type: COVE_TAB_ID, id: COVE_TAB_ID, title: 'Cove Task' },
          sessionId ? { sessionId } : undefined,
        )
        return true
      } catch (error) {
        return false
      }
    },
    /**
     * 打开某条会话。openSession 是「尽力而为」的：宿主解析不到时不一定抛错，
     * 所以切过去后读回宿主真正选中的会话核对一次，对不上就把真相告诉调用方。
     * 返回 Promise<{ok, reason}>。
     */
    openSession(sessionId, expectedTitle) {
      const ui = serviceOf(this.__ctx, 'uiWorkspace')
      if (!ui || typeof ui.openSession !== 'function') {
        return Promise.resolve({ ok: false, reason: '当前宿主不支持打开会话' })
      }
      try {
        ui.openSession(sessionId)
      } catch (error) {
        return Promise.resolve({ ok: false, reason: (error && error.message) || '打开会话失败' })
      }
      return new Promise((resolve) => {
        const settle = typeof setTimeout === 'function' ? setTimeout : null
        const check = () => {
          let actual = ''
          try {
            const snap = ui.selection && typeof ui.selection.getSnapshot === 'function' ? ui.selection.getSnapshot() : null
            if (snap && typeof snap.sessionId === 'string') actual = snap.sessionId
          } catch (error) {
            actual = ''
          }
          if (actual) {
            resolve(actual === sessionId ? { ok: true } : { ok: false, reason: `宿主切到了 ${actual}，不是这条会话` })
            return
          }
          /* 读不到 selection 时退回窗口标题（会话名默认 = 任务名）；无从判断就算成功。 */
          let docTitle = ''
          try {
            docTitle = document && document.title ? String(document.title) : ''
          } catch (error) {
            docTitle = ''
          }
          const snippet = String(expectedTitle || '').replace(/\s+/g, '').slice(0, 8)
          if (!snippet || !docTitle) {
            resolve({ ok: true })
            return
          }
          resolve(docTitle.replace(/\s+/g, '').includes(snippet) ? { ok: true } : { ok: false, reason: `窗口标题是「${docTitle.slice(0, 28)}」，对不上这张卡的任务名` })
        }
        if (settle) settle(check, 260)
        else check()
      })
    },
  }
}

window.__ModuleLoader__.load({
  id: 'dsh-cove-task',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    let ReactDOM = null
    try {
      ReactDOM = require('react-dom')
    } catch (error) {
      /* 没有 react-dom 时 React Flow 退回旧画布，面板其余部分照常 */
    }

    const sidebar = createSidebarHalf({ React, h })
    const host = makeHostHolder()
    const store = createStore()

    /* 视图装配：第一次需要时取一次，之后复用；失败只记警告（面板显示空白而不是拖垮宿主）。 */
    const ui = {
      module: null,
      promise: null,
      load(doc) {
        if (this.promise) return this.promise
        const url = uiModuleUrl()
        let loading
        try {
          loading = import(url)
        } catch (error) {
          /* 动态 import 本身不可用（极老的宿主/受限 CSP）：当作加载失败，面板显示一行原因 */
          warn(error)
          return Promise.resolve(null)
        }
        this.promise = loading
          .then((module) => {
            this.module = module
            return module.createUi({ React, ReactDOM, h, store, host, document: doc, standalone: false })
          })
          .then((created) => {
            this.created = created
            return created
          })
          .catch((error) => {
            this.promise = null
            warn(error)
            return null
          })
        return this.promise
      },
      get() {
        return this.created || null
      },
      dispose(doc) {
        const module = this.module
        this.module = null
        this.created = null
        this.promise = null
        try {
          if (module && typeof module.removeUiStyles === 'function') module.removeUiStyles(doc)
        } catch (error) {
          /* 宿主页面已经没了就算了 */
        }
      },
    }

    /* 懒视图：注册同步完成，渲染时才等装配。加载中渲染空；失败渲染一行原因
       （否则视图加载不到时用户只看到一块空白，分不清是慢还是坏）。 */
    function lazyView(loader, key) {
      return function CoveLazyView(props) {
        const state = React.useState(0)
        const tick = state[0]
        const setTick = state[1]
        const failure = React.useState(null)
        const error = failure[0]
        const setError = failure[1]
        React.useEffect(() => {
          if (loader.get()) return undefined
          let live = true
          loader.load(document).then((created) => {
            if (!live) return
            if (created) setTick((n) => n + 1)
            else setError('视图模块没加载起来：' + uiModuleUrl() + '（详见控制台）')
          })
          return () => { live = false }
        }, [tick])
        const created = loader.get()
        if (created && typeof created[key] === 'function') return h(created[key], props)
        if (!error) return null
        return h('div', {
          style: {
            margin: '24px',
            font: '13px/1.6 -apple-system, BlinkMacSystemFont, sans-serif',
            color: 'var(--dsw-alias-label-secondary, #61666b)',
          },
        }, `Cove Task 面板：${error}`)
      }
    }

    const LazyOverviewPanel = lazyView(ui, 'OverviewPanel')
    const LazyTaskCreateDock = lazyView(ui, 'TaskCreateDock')

    function installOverview(ctx) {
      host.__ctx = ctx
      const slots = serviceOf(ctx, 'slots')
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return false
      /* 视图装配提前开跑：面板一般在用户点开之前就绪（失败也只是面板空着）。 */
      void ui.load(document)
      /* 独立页 → DSH 的切会话通道：连接本身不依赖 uiWorkspace 是否已挂载（客户端插件加载顺序不定），
         事件到达时 host.openSession 会现查服务；SSE 断开由 EventSource 自己重连。 */
      const disposeSessionBridge = installSessionBridge({
        openSession: (sessionId, title) => host.openSession(sessionId, title),
      })
      const disposers = [
        slots.inject('sidebar.panellist', () => slots.register(
          { name: 'sidebar.panellist', id: OVERVIEW_KEY, order: 24, label: () => OVERVIEW_LABEL },
          (props) => overviewIcon(h, props),
        )),
        slots.inject('main', () => slots.register({ name: 'main', key: OVERVIEW_KEY }, LazyOverviewPanel)),
      ]
      /* 会话 composer 上方的任务创建条是增量入口：旧宿主没有这个槽时只丢它，不连累总览。 */
      try {
        disposers.push(slots.inject('conversation.input.dock', () => slots.register(
          { name: 'conversation.input.dock', id: 'cove-task-create', order: 40 },
          LazyTaskCreateDock,
        )))
      } catch (error) {
        warn(error)
      }
      if (ctx.effect) {
        ctx.effect(() => () => {
          for (const dispose of disposers) if (typeof dispose === 'function') dispose()
          if (typeof disposeSessionBridge === 'function') disposeSessionBridge()
          ui.dispose(document)
        })
      }
      return true
    }

    function apply(ctx) {
      try {
        sidebar.apply(ctx)
      } catch (error) {
        warn(error)
      }
      try {
        installOverview(ctx)
      } catch (error) {
        /* 总览是增量入口：注册失败不能连右侧栏页签一起丢掉 */
        warn(error)
      }
    }

    function warn(error) {
      try {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[dsh-cove-task] 客户端半体初始化失败，已忽略（不影响宿主启动）：', error)
        }
      } catch (ignored) {
        /* 连 console 都没有就只能静默 */
      }
    }

    /* 只声明 slots：betterSidebar 是可选能力（右侧栏插件），它在时运行时探测注册页签，
       不在时总览照样可用——不要让它把整个客户端半体门控成 inactive。 */
    return { name: 'dsh-cove-task', inject: ['slots'], apply }
  },
});
