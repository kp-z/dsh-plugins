import './loader-shim.js'
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../client.js'
import { installMock, resetMock } from './mock.js'

installMock()

// 把真实的 client.js 当插件跑：apply() 会把「便签」页签注册给（假的）侧栏服务，我们拿到它的组件来渲染。
let tab
window.__pnModule.factory(() => React).apply({
  effect: (fn) => { fn() },
  betterSidebar: { registerTab: (t) => { tab = t; return () => {} }, getSnapshot: () => ({ sessionId: '' }) },
  slots: null,
})

const VIEWERS = {
  a: { label: { zh: '会话 A', en: 'Session A' }, sub: '/proj/a', scope: { sessionId: 'sess-A', cwd: '/proj/a' } },
  b: { label: { zh: '会话 B', en: 'Session B' }, sub: '/other', scope: { sessionId: 'sess-B', cwd: '/other' } },
  none: { label: { zh: '无会话', en: 'No session' }, sub: '', scope: null },
}
const state = { viewer: 'a', theme: 'dark', lang: 'zh', n: 0 }
const root = createRoot(document.getElementById('panel'))

function render() {
  document.documentElement.setAttribute('lang', state.lang)
  document.documentElement.setAttribute('data-theme', state.theme)
  const v = VIEWERS[state.viewer]
  state.n++
  root.render(React.createElement(tab.component, v.scope ? { scope: v.scope, key: state.n } : { key: state.n }))
  for (const el of document.querySelectorAll('[data-set]')) {
    const [k, val] = el.dataset.set.split(':')
    el.setAttribute('aria-pressed', String(state[k] === val))
  }
  for (const el of document.querySelectorAll('[data-i18n]')) el.hidden = el.dataset.i18n !== state.lang
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-set]')
  if (b) { const [k, val] = b.dataset.set.split(':'); state[k] = val; render() }
  if (e.target.closest('[data-reset]')) { resetMock(); render() }
})
render()
