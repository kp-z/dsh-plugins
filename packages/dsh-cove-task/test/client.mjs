/**
 * Client 半体的契约测试：装进假的 ModuleLoader / React / ctx 跑一遍 apply()。
 *
 * 从「整页 HTML + iframe」改成「宿主页面里的 React 组件」之后，这一层要钉住两件事：
 *   1. 右侧栏页签还是老样子（iframe → /dsh-cove-task/panel），别被重写碰坏；
 *   2. 左侧栏总览走 **slots 注册的 React 组件**，iframe 那条路彻底消失。
 *
 * 跑法：node test/client.mjs（需要先 `pnpm run build:client` 生成 lib/client.iife.js）
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createSidebarHalf } from '../src/client/sidebar-tab.js'

const BUNDLE = new URL('../lib/client.iife.js', import.meta.url)
let source = ''
try {
  source = await readFile(BUNDLE, 'utf8')
} catch (error) {
  throw new Error('缺少构建产物 lib/client.iife.js，请先跑 pnpm run build:client')
}

/* 静态口径：产物必须是经典脚本，且总览不再有整页路由。 */
assert.ok(source.includes('__ModuleLoader__.load'), '产物必须自己注册到 ModuleLoader')
assert.ok(source.includes('/dsh-cove-task/panel'), '右侧栏面板路由必须还在')
assert.ok(!source.includes('/dsh-cove-task/overview'), '总览不该再有整页路由（iframe 版已删除）')
assert.ok(!source.includes('dfe-overview-frame'), '总览不该再有 iframe 容器')
console.log('✓ 产物：经典脚本 + 只有右侧栏面板路由，没有总览整页路由/iframe')

/* 同会话项目上下文：源码层单测（行为与反射都不依赖构建产物）。 */
const half = createSidebarHalf({ React: { createElement: () => ({}) }, h: () => ({}) })
const projectContext = half.workspaceContextOf({ scope: { workspaceId: 'w1', cwd: '/one' } })
assert.equal(projectContext.workspaceId, 'w1')
assert.equal(projectContext.workspacePath, '/one')
console.log('✓ 源码：workspaceContextOf 从 scope 读出项目上下文')

/* 总览面板的宿主能力位：面板在宿主页面里，开不了 iframe 那套 postMessage，
   「打开会话」直接走 uiWorkspace —— 这条接线断了按钮就是死的，所以钉在源码层。 */
const clientSrc = await readFile(new URL('../src/client/client.js', import.meta.url), 'utf8')
assert.match(clientSrc, /host\.__ctx = ctx/, 'apply 时要把 ctx 晚绑定给 host（factory 里没有 ctx）')
assert.match(clientSrc, /openSession\(sessionId/, 'host 要提供 openSession')
assert.match(clientSrc, /canOpenSession\(\)/, 'host 要能回答「当前宿主支不支持打开会话」')
assert.match(clientSrc, /openFeishuTab\(sessionId\)/, 'host 要能自动打开右侧Cove Task 页签')
assert.match(clientSrc, /betterSidebar[^]*openTab/, '打开右侧栏要调 betterSidebar.openTab')
console.log('✓ 源码：总览面板的 host 能力位（openSession / canOpenSession）已接线')

/* 视图的唯一来源：宿主半体**不内联**组件树，运行时 import 插件自己的 /tasks/src/ui.js；
   独立页 import 同一个文件。这条接线断了就退回「两份代码各自跑」——
   「浏览器里改了、DSH 里没变化」正是这么来的，所以钉在源码层。 */
assert.match(clientSrc, /UI_MODULE_PATH = '\/dsh-cove-task\/tasks\/src\/ui\.js'/, '宿主半体要从插件路由取视图装配模块')
/* 桌面外壳的页面 origin 是 dsh-app://app/：裸路径会被解析成 dsh-app://dsh-cove-task/…（404），
   必须按 document.baseURI 解析成 dsh-app://app/dsh-cove-task/… 。 */
assert.match(clientSrc, /new URL\(UI_MODULE_PATH, base\)/, '装配地址要按 document.baseURI 解析（dsh-app://app/ 才知道插件路由在哪）')
assert.match(clientSrc, /import\(url\)/, '装配模块必须动态 import（静态 import 会被内联成第二份视图）')
assert.equal(/from '\.\/OverviewPanel\.js'/.test(clientSrc), false, '客户端半体不该再静态 import 视图')
assert.equal(/from '\.\/styles\.js'/.test(clientSrc), false, '样式表随装配模块走，不在宿主半体里内联')
const tasksBootSrc = await readFile(new URL('../tasksBoot.js', import.meta.url), 'utf8')
assert.match(tasksBootSrc, /from '\.\/src\/ui\.js'/, '独立页要 import 同一个装配模块')
assert.equal(/new Function\('exports'/.test(tasksBootSrc), false, 'React Flow 的启动收在 ui.js，不在独立页重复一份')
const uiSrc = await readFile(new URL('../src/client/ui.js', import.meta.url), 'utf8')
const overviewSrc = await readFile(new URL('../src/client/browserOpen.js', import.meta.url), 'utf8')
assert.match(uiSrc, /export function createUi/, '装配模块要导出 createUi')
assert.match(uiSrc, /export function injectUiStyles/, '样式随装配模块注入')
assert.match(uiSrc, /createOverviewPanel\(\{[^}]*\bhost\b/, '总览面板要拿到 host 能力位')
console.log('✓ 单一来源：宿主半体与独立页都从 src/client/ui.js 取视图')

const captured = []
const slotRegistrations = []
const slots = {
  inject(name, factory) {
    const dispose = factory()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  register(options, component) {
    slotRegistrations.push({ options, component })
    return () => {}
  },
}
const betterSidebar = {
  registerTab(descriptor) {
    captured.push(descriptor)
    return () => {}
  },
}
const openedSessions = []
const uiWorkspace = { openSession: (id) => openedSessions.push(id) }
const ctx = {
  get(name) {
    if (name === 'betterSidebar') return betterSidebar
    if (name === 'uiWorkspace') return uiWorkspace
    if (name === 'slots') return slots
    return undefined
  },
  effect(fn) { fn() },
}

/* React 只用到 createElement / useState / useRef / useEffect / useCallback / useMemo / memo。 */
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  memo: (fn) => fn,
  forwardRef: (fn) => fn,
  /* React Flow 的 UMD 在模块初始化时就要 createContext；缺了它整个客户端半体会静默降级。 */
  createContext: (value) => ({
    Provider: ({ children }) => children ?? null,
    Consumer: ({ children }) => (typeof children === 'function' ? children(value) : null),
    _currentValue: value,
  }),
  Fragment: 'Fragment',
  Children: { toArray: (children) => (Array.isArray(children) ? children : [children]) },
  isValidElement: (node) => Boolean(node && typeof node === 'object' && 'type' in node),
  cloneElement: (node, props) => ({ ...node, props: { ...(node.props || {}), ...(props || {}) } }),
}
const ReactDOMStub = { createPortal: (node) => node, flushSync: (fn) => fn(), createRoot: () => ({ render() {}, unmount() {} }) }

const styleElement = { id: '', textContent: '' }
const appendedStyles = []
/* 宿主页面里 createElement('style') 出来的对象要能 setId/setAttribute，测试里补齐这两个。 */
function makeElement() {
  const node = { id: '', textContent: '', attrs: {} }
  node.setAttribute = (key, value) => {
    node.attrs[key] = String(value)
    if (key === 'id') node.id = String(value)
  }
  node.getAttribute = (key) => (key in node.attrs ? node.attrs[key] : null)
  node.appendChild = () => {}
  return node
}
const fakeDocument = {
  head: { appendChild: (node) => appendedStyles.push(node) },
  body: { classList: { contains: () => false } },
  documentElement: {},
  getElementById: () => null,
  createElement: () => makeElement(),
}

let loaded
const messageListeners = []
const fakeWindow = {
  location: { origin: 'http://localhost' },
  localStorage: { getItem: () => null, setItem: () => {} },
  addEventListener: (type, fn) => { if (type === 'message') messageListeners.push(fn) },
  removeEventListener: (type, fn) => {
    const i = messageListeners.indexOf(fn)
    if (i >= 0) messageListeners.splice(i, 1)
  },
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      loaded = { id, exports: factory((name) => (name === 'react' ? ReactStub : name === 'react-dom' ? ReactDOMStub : (() => ({})))) }
    },
  },
}
const vm = await import('node:vm')
const sandbox = {
  window: fakeWindow,
  document: fakeDocument,
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  getComputedStyle: () => ({ colorScheme: 'light' }),
  console,
  setTimeout,
  clearTimeout,
}
sandbox.globalThis = sandbox
/* 宿主半体在运行时 import 装配模块。vm 里的动态 import 要有人接：这里给一个
   data: 模块当替身，顺便验证「交给装配模块的依赖是不是宿主的那一套」。 */
const uiCalls = []
const uiStub = await import('data:text/javascript,' + encodeURIComponent([
  'globalThis.__coveUiCalls = globalThis.__coveUiCalls || []',
  'export function createUi(deps) {',
  '  globalThis.__coveUiCalls.push(deps)',
  '  return { OverviewPanel: function OverviewPanel() { return null }, TaskCreateDock: function TaskCreateDock() { return null }, api: {}, styleIds: [] }',
  '}',
  'export function removeUiStyles() {}',
].join('\n')))
vm.createContext(sandbox)
/* 动态 import 的钩子挂在 Script 上（挂在 context 上对 runInContext 不生效）。 */
const bundleScript = new vm.Script(source, {
  filename: 'client.iife.js',
  importModuleDynamically: (specifier) => {
    uiCalls.push(specifier)
    return uiStub
  },
})
bundleScript.runInContext(sandbox)

assert.ok(loaded, '模块没有通过 __ModuleLoader__.load 注册')
assert.equal(loaded.id, 'dsh-cove-task')
const { exports } = loaded
assert.ok(Array.isArray(exports.inject) && exports.inject.includes('slots'), `inject 没声明 slots：${JSON.stringify(exports.inject)}`)
/* betterSidebar 必须**不进** inject：否则没有右侧栏插件的 profile 里总览也会被门控掉（运行时探测即可）。 */
assert.ok(!exports.inject.includes('betterSidebar'), `betterSidebar 不该进 inject（可选能力，运行时探测）：${JSON.stringify(exports.inject)}`)

exports.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 400))

/* 右侧栏页签：老口径。 */
assert.equal(captured.length, 1, `registerTab 调用次数不对：${captured.length}`)
const tab = captured[0]
assert.equal(tab.id, 'cove-task')
assert.equal(tab.single, true)
assert.equal(typeof tab.component, 'function')
assert.equal(typeof tab.icon, 'function')
assert.equal(tab.title(), 'Cove Task')
const tree = tab.component({})
assert.equal(tree.type, 'iframe')
assert.ok(String(tree.props.src).startsWith('/dsh-cove-task/panel'), `页签 iframe src 不对：${tree.props.src}`)
console.log(`✓ 右侧栏页签：id=${tab.id} title=${tab.title()} → <iframe src="${tree.props.src}">`)

/* 左侧栏总览：React 组件 + 同 key 的 main 面板。 */
const panellist = slotRegistrations.find((row) => row.options.name === 'sidebar.panellist')
const mainPanel = slotRegistrations.find((row) => row.options.name === 'main')
assert.ok(panellist, '没有注册 sidebar.panellist（左侧栏不会有「任务」入口）')
assert.ok(mainPanel, '没有注册 main 面板')
assert.equal(panellist.options.id, mainPanel.options.key, 'sidebar.panellist.id 与 main.key 必须一致')
assert.equal(panellist.options.id, 'cove-task-overview')
assert.equal(typeof panellist.options.label, 'function', 'label 要用 thunk（宿主会重读，日后可跟随 locale）')
assert.equal(panellist.options.label(), 'Cove Task')
assert.equal(typeof panellist.options.order, 'number')
assert.equal(typeof panellist.component, 'function')
assert.ok(typeof mainPanel.component === 'function', 'main 面板必须是组件（不能是 iframe 容器）')
console.log(`✓ 左侧栏总览：id=${panellist.options.id} label=${panellist.options.label} → React 组件（非 iframe）`)

/* 新会话任务条：挂在 conversation.input.dock，id 与顺序必须独立于官方 Queue/Todo/Goal。 */
const taskDock = slotRegistrations.find((row) => row.options.name === 'conversation.input.dock')
assert.ok(taskDock, '没有注册 conversation.input.dock（新会话里不会有「创建 Cove Task」操作条）')
assert.equal(taskDock.options.id, 'cove-task-create')
assert.equal(typeof taskDock.component, 'function')
assert.equal(taskDock.options.order, 40)
assert.ok(typeof taskDock.options.label === 'undefined', 'dock 不需要 label（不是导航项）')
console.log(`✓ 新会话任务条：conversation.input.dock id=${taskDock.options.id} → React 组件`)

/* 视图装配：宿主半体在 apply 时就去取 /tasks/src/ui.js，并把宿主那一套依赖交进去。
   vm 里的动态 import 要 node --experimental-vm-modules；没带这个 flag 的跑法只少这一层校验，
   其余契约（注册、页签、样式、桥）照旧。 */
if (uiCalls.length === 0) {
  console.log('· vm 动态 import 未启用（node --experimental-vm-modules），跳过装配依赖断言')
} else {
  assert.deepEqual(uiCalls, ['/dsh-cove-task/tasks/src/ui.js'], `取装配模块的地址不对：${JSON.stringify(uiCalls)}`)
  const createUiCalls = globalThis.__coveUiCalls || []
  assert.equal(createUiCalls.length, 1, `装配模块调用次数不对：${createUiCalls.length}`)
  const assembled = createUiCalls[0] || {}
  assert.equal(assembled.React, ReactStub, '装配模块要用宿主提供的 React（同一份，不能自带一套）')
  assert.equal(typeof (assembled.host && assembled.host.openSession), 'function', '装配时要把 host 能力位交进去')
  assert.equal(typeof (assembled.store && assembled.store.get), 'function', '装配时要把视图偏好 store 交进去')
  assert.equal(assembled.standalone, false, '宿主内的面板不是独立页')
  console.log('✓ 视图装配：apply 时取 /dsh-cove-task/tasks/src/ui.js，并交入宿主 React / host / store')
}

/* 样式：宿主半体自己不再内联面板调色板；面板样式随装配模块注入一次。 */
const styleIds = appendedStyles.map((node) => node.id)
assert.ok(styleIds.includes('dsh-cove-task-style'), `缺少页签容器样式表：${styleIds.join(',')}`)
assert.ok(!styleIds.includes('dsh-cove-task-overview-style'), '总览样式不该内联在宿主半体里（应随 ui.js 注入）')
console.log(`✓ 样式注入：${styleIds.filter(Boolean).join(', ')}`)

/* 「打开任务页」：客户端只请宿主打开**独立任务页**（/dsh-cove-task/tasks），
   不自己拼地址、也不再请求落点标记（那一套随「跳转到 DSH」一起删掉了）。 */
/* 「打开任务页」的请求随视图走（OverviewPanel → browserOpen.js），不再内联在宿主半体里。 */
assert.ok(uiSrc.includes('createOverviewPanel'), '视图装配模块要接上总览面板')
assert.ok(overviewSrc.includes('/dsh-cove-task/api/open-panel'), '要能请宿主打开任务页')
assert.equal(source.includes('/api/panel-focus'), false, '落点标记已随旧方案删除')
assert.equal(/selectPanel/.test(source), false, '客户端不再需要切 DSH 主面板')
/* 客户端不许自己拼任务页**地址**（桌面端 Host 是 dsh-app://，拼绝对地址必错）；
   取视图模块用的是同源**路径**（/dsh-cove-task/tasks/src/…），两种宿主下都解析得到。 */
assert.equal(/https?:\/\/[^'"\s]*\/dsh-cove-task\/tasks/.test(source), false, '客户端不许自己拼任务页绝对地址')
assert.ok(source.includes('/dsh-cove-task/tasks/src/ui.js'), '视图装配模块走同源路径')
console.log('✓ 打开任务页：POST /api/open-panel（地址由宿主拼成独立任务页）')

/* 服务缺席时不能抛（否则会把宿主打成错误页）。 */
const emptyCtx = { get: () => undefined, effect: () => {} }
exports.apply(emptyCtx)
await new Promise((resolve) => setTimeout(resolve, 100))
console.log('✓ 服务缺席时 apply() 不抛')

/* 会话跳转桥：面板 postMessage → uiWorkspace.openSession，跨域消息忽略。 */
assert.ok(messageListeners.length > 0, '没有注册 message 监听，面板无法请求跳转')
for (const fn of messageListeners) {
  fn({ origin: 'http://localhost', data: { type: 'dsh-cove-task:open-session', sessionId: 'feishu-abc-1' } })
  fn({ origin: 'https://evil.example', data: { type: 'dsh-cove-task:open-session', sessionId: 'feishu-should-ignore' } })
}
assert.equal(openedSessions.length, 1)
assert.equal(openedSessions[0], 'feishu-abc-1')
console.log('✓ 会话跳转：面板 postMessage → uiWorkspace.openSession，跨域消息被忽略')
if (!styleIds.includes('dsh-cove-task-overview-style')) {
  /* 总览样式表由 styles.js 的 injectStyles 负责；这里只确认没有第二套调色板被注入。 */
  console.log('· 总览样式表由 src/client/styles.js 注入（不在本测试口径内）')
}
console.log('CLIENT_OK')
process.exit(0)
