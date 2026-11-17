/**
 * 独立海湾页的启动器。
 *
 * 它**不重写页面**：直接 import 面板自己的组件（src/client/OverviewPanel.js），
 * 注入同一份样式（styles.js 的 CSS）、同一个接口层（api.js 的 createApi）、
 * 一个 localStorage 版 store 和一个「不能开会话」的 host 能力位。
 *
 * React 用的是官方 UMD（lib/vendor 里 vendor 的 react / react-dom 18，和面板里跑的是同一个库），
 * 本文档页面用两个 <script> 先加载它们，所以这里直接取 window.React。
 */

import { createOverviewPanel } from './src/OverviewPanel.js';
import { createApi } from './src/api.js';
import { CSS as PANEL_CSS, STYLE_ID } from './src/styles.js';

const React = window.React;
const { createRoot } = window.ReactDOM;
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

/* host：独立页不能拉起 DSH 会话，如实说不行（面板会退化成「看详情」） */
const host = {
  canOpenSession: () => ({ ok: false, reason: '独立页不能打开 DSH 会话' }),
};

const OverviewPanel = createOverviewPanel({
  React,
  h,
  api: createApi(),
  store,
  host,
  pollMs: 30000,
});

createRoot(document.getElementById('ts-app')).render(h(OverviewPanel, {}));
