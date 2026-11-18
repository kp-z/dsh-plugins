/**
 * 独立海湾页的启动器。
 *
 * 它**不重写页面**：直接 import 面板自己的组件（src/client/OverviewPanel.js），
 * 注入同一份样式（styles.js 的 CSS）、同一个接口层（api.js 的 createApi）、
 * 一个 localStorage 版 store 和一个「不能开会话」的 host 能力位。
 * standalone: true 告诉面板「你已经独立成页了」——左下角不再渲染「在浏览器打开」。
 *
 * React 用的是官方 UMD（lib/vendor 里 vendor 的 react / react-dom 18，和面板里跑的是同一个库），
 * 本文档页面用两个 <script> 先加载它们，所以这里直接取 window.React。
 */

import { createOverviewPanel } from './src/OverviewPanel.js';
import { REACTFLOW_UMD } from './src/reactflowVendor.js';
import { openSessionInDsh } from './src/openSession.js';
import { createApi } from './src/api.js';
import { CSS as PANEL_CSS, STYLE_ID } from './src/styles.js';

const React = window.React;
const { createRoot } = window.ReactDOM;
/* React Flow UMD 在页面模块里执行，注入官方 React/ReactDOM；
   不依赖 /tasks/vendor 路由，刷新即可生效。 */
let ReactFlow = null;
try {
  const umd = { exports: {} };
  const umdRequire = (name) => (name === 'react' ? React : name === 'react-dom' ? window.ReactDOM : undefined);
  new Function('exports', 'require', 'module', REACTFLOW_UMD)(umd.exports, umdRequire, umd);
  ReactFlow = umd.exports;
} catch (error) {
  console.warn('[dsh-cove-task] React Flow 初始化失败，退回旧画布：', error);
}
const h = React.createElement;

/* 面板的样式表（面板里由 client.js 注入，这里自己注入同一份） */
const style = document.createElement('style');
style.id = STYLE_ID;
style.textContent = PANEL_CSS;
document.head.append(style);

/* store：面板只要求 get(key, fallback) / set(key, value) */
const PREFIX = 'dsh-cove-task-bay:';
const store = {
  get(key, fallback) {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? (fallback === undefined ? null : fallback) : JSON.parse(raw);
  },
  set(key, value) {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  },
};

/* host：独立页不能直接调 DSH 的 uiWorkspace，但可以请宿主转一手：
   POST /api/open-session → 宿主 SSE → DSH 客户端切会话，并把桌面端叫到前台。 */
const host = {
  canOpenSession: () => ({ ok: true, reason: '' }),
  openSession: (sessionId, title) => openSessionInDsh(sessionId, title),
};

const OverviewPanel = createOverviewPanel({
  React,
  ReactFlow,
  h,
  api: createApi(),
  store,
  host,
  /* 已经在浏览器里：rail 左下角的「打开页面」没有意义，面板不再渲染它。 */
  standalone: true,
  pollMs: 30000,
});

createRoot(document.getElementById('ts-app')).render(h(OverviewPanel, {}));
