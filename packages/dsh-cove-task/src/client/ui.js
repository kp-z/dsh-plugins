/**
 * 面板 UI 的**唯一装配点**（宿主内嵌面板 与 浏览器独立页 共用同一份）。
 *
 * 为什么要有这个文件：
 *   面板的界面有两条入口 —— 宿主里的客户端半体（lib/client.iife.js）和独立页
 *   （tasksBoot.js）。如果两个入口各自静态 import 组件树，构建产物就会内联一份
 *   快照：改了 src/client/*.js 之后，独立页（直接吃源码）立刻变，宿主里却还是旧包，
 *   直到有人重跑构建并重载插件。那正是「浏览器里改了、DSH 里没变化」的成因。
 *   现在两个入口都**在运行时**取这棵树：宿主侧通过 /dsh-cove-task/tasks/src/ui.js
 *   动态 import，独立页静态 import 同一个文件。界面只有一份源码，改完刷新即可。
 *
 * 约束：
 *   - 本模块必须能在浏览器里直接跑（纯相对 import，无 node 内置、无裸包名）；
 *   - React / ReactDOM 由调用方传入（宿主侧是 ModuleLoader 的 require，独立页是 window）；
 *   - 样式表随装配注入一次（幂等），返回的 styleIds 供卸载时清理。
 *
 * 这里只做装配，不含任何视图逻辑：视图在 OverviewPanel / taskCreateDock / features。
 */
import { REACTFLOW_UMD } from './reactflowVendor.js'
import { createOverviewPanel } from './OverviewPanel.js'
import { createTaskCreateDock } from './taskCreateDock.js'
import { createApi } from './api.js'
import { CSS as OVERVIEW_CSS, STYLE_ID as OVERVIEW_STYLE_ID } from './styles.js'
import { CSS as DASHBOARD_CSS, STYLE_ID as DASHBOARD_STYLE_ID } from './dashboardStyles.js'
import { CSS as RUNS_CSS, STYLE_ID as RUNS_STYLE_ID } from './runsExactStyles.js'
import { CSS as DOCK_CSS, STYLE_ID as DOCK_STYLE_ID } from './taskCreateDockStyles.js'

/* 面板自己的样式表：id 固定，注入幂等，卸载时按 id 摘掉。 */
const SHEETS = [
  [OVERVIEW_STYLE_ID, OVERVIEW_CSS],
  [DASHBOARD_STYLE_ID, DASHBOARD_CSS],
  [RUNS_STYLE_ID, RUNS_CSS],
  [DOCK_STYLE_ID, DOCK_CSS],
]

/** 注入全部样式表（幂等）。 */
export function injectUiStyles(doc) {
  const target = doc || (typeof document === 'undefined' ? null : document)
  if (!target || !target.head) return
  for (const [id, css] of SHEETS) {
    if (!id || target.getElementById(id)) continue
    const style = target.createElement('style')
    style.id = id
    style.textContent = css
    target.head.appendChild(style)
  }
}

/** 摘掉注入过的样式表（插件卸载时用；重复调用无副作用）。 */
export function removeUiStyles(doc) {
  const target = doc || (typeof document === 'undefined' ? null : document)
  if (!target || typeof target.getElementById !== 'function') return
  for (const [id] of SHEETS) {
    const node = target.getElementById(id)
    if (node && node.parentNode) node.parentNode.removeChild(node)
  }
}

/** React Flow 的 UMD 要 createContext；宿主/页面的 React 版本不够时直接放弃。 */
function canBootReactFlow(React) {
  return Boolean(React && typeof React.createContext === 'function')
}

/**
 * React Flow 的 UMD：它要注入 react / react-dom 才能跑起来。
 * 宿主侧的 require 与独立页的 window 都走这里。
 */
function bootReactFlow(React, ReactDOM) {
  if (!canBootReactFlow(React)) return null
  try {
    const umd = { exports: {} }
    const requireImpl = (name) => (name === 'react' ? React : name === 'react-dom' ? ReactDOM : undefined)
    new Function('exports', 'require', 'module', REACTFLOW_UMD)(umd.exports, requireImpl, umd)
    return umd.exports
  } catch (error) {
    /* 关系图会退回旧画布，不出白屏 */
    return null
  }
}


/**
 * 装配面板 UI。
 * @param {object} deps
 * @param {object} deps.React 宿主或页面提供的 React
 * @param {object} [deps.ReactDOM] React Flow 需要；缺了就退回旧画布
 * @param {Function} [deps.h] createElement（默认 React.createElement）
 * @param {object} [deps.api] 接口层（默认按当前 origin 新建）
 * @param {object} [deps.store] get/set 存储（默认无）
 * @param {object} [deps.host] canOpenSession / openSession 能力位（默认无）
 * @param {boolean} [deps.standalone] 是否就是独立页（隐藏「在浏览器打开」）
 * @param {number} [deps.pollMs] 轮询间隔
 * @param {Function} [deps.fetchImpl] 接口层注入点（单测用）
 * @param {object} [deps.document] 注入样式用的文档（单测用）
 */
export function createUi(deps = {}) {
  const React = deps.React
  if (!React) throw new Error('[dsh-cove-task] createUi 需要 React')
  const h = deps.h || React.createElement
  const api = deps.api || createApi(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {})
  const ReactFlow = deps.ReactFlow || bootReactFlow(React, deps.ReactDOM)
  injectUiStyles(deps.document)

  const OverviewPanel = createOverviewPanel({
    React,
    h,
    api,
    ReactFlow,
    store: deps.store,
    host: deps.host,
    standalone: deps.standalone === true,
    pollMs: deps.pollMs,
  })
  const TaskCreateDock = createTaskCreateDock({ React, h, api, host: deps.host })

  return { OverviewPanel, TaskCreateDock, api, styleIds: SHEETS.map(([id]) => id) }
}

export default createUi
