// client.js 是靠 window.__ModuleLoader__.load({id, factory}) 自注册的；demo 里接住它的工厂。
window.__ModuleLoader__ = { load: (m) => { window.__pnModule = m } }
