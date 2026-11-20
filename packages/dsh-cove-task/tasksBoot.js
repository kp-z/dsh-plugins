/**
 * 独立海湾页（/dsh-cove-task/tasks）的启动器。
 *
 * 它**不重写页面**：装配交给 src/client/ui.js（宿主内嵌面板用的是同一个文件），
 * 这里只负责三件页内的事 —— store（localStorage）、host（走宿主 SSE 切会话）、
 * 以及把根组件挂到 #ts-app。
 *
 * standalone: true 告诉面板「你已经独立成页了」——左下角不再渲染「在浏览器打开」。
 *
 * React 用的是官方 UMD（lib/vendor 里 vendor 的 react / react-dom 18，和面板里跑的是同一个库），
 * 本文档页面用两个 <script> 先加载它们，所以这里直接取 window.React。
 */
import { createUi } from './src/ui.js'
import { openSessionInDsh } from './src/openSession.js'

const React = window.React
const { createRoot } = window.ReactDOM

/* store：面板只要求 get(key, fallback) / set(key, value) */
const PREFIX = 'dsh-cove-task-bay:'
const store = {
  get(key, fallback) {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw === null ? (fallback === undefined ? null : fallback) : JSON.parse(raw)
  },
  set(key, value) {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  },
}

/* host：独立页不能直接调 DSH 的 uiWorkspace，但可以请宿主转一手：
   POST /api/open-session → 宿主 SSE → DSH 客户端切会话，并把桌面端叫到前台。 */
const host = {
  canOpenSession: () => ({ ok: true, reason: '' }),
  openSession: (sessionId, title) => openSessionInDsh(sessionId, title),
}

const { OverviewPanel } = createUi({
  React,
  ReactDOM: window.ReactDOM,
  store,
  host,
  standalone: true,
  pollMs: 30000,
})

createRoot(document.getElementById('ts-app')).render(React.createElement(OverviewPanel, {}))
