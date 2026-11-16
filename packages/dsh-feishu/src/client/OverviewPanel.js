/**
 * 总览页容器 —— 工厂组件，模块顶层不 import react。
 *
 * 职责（也是它唯一的「副作用面」）：
 * - 通过**注入的 api** 取快照（api.overview / api.revision / api.groupAction），自己不做 fetch、
 *   不碰 localStorage（走注入的 store）、不写 document.body、不做 DOM 查询；
 * - 持有纯视图状态：当前 scope、目录折叠、展开的详情、右键菜单、拖拽高亮、就地重命名/新建；
 * - 按 revision 变化轮询刷新（间隔下限 15s，宿主侧是瘦快照）；
 * - 把树 / 图 / 详情三个子组件按同一份 {React, h, model} 实例化并接线（卡片区已删：
 *   图上的节点就是任务列表，再列一遍只是重复）。
 *
 * 兼容两套注入命名（lead 早期冻结名与最终名都吃）：
 *   api.overview | api.loadOverview；api.groupAction | api.saveGroups；api.revision() → 值或 {revision}
 *   store.get(key, fallback) / store.set(key, value)，本组件只写 'selection' / 'collapsed' / 'keyword' /
 *   'feature' / 'scope' / 'rail' / 'nodePos'（最后一个是画布上拖动过的节点位置）
 *   宿主能力位 deps.host：canOpenSession() → {ok,reason}、openSession(id, title) → Promise<{ok,reason}>
 *
 * props（都可选）：api、store、host、pollMs、title、subtitle、api 覆写
 */

import * as modelModule from '../overview/model.js'
import * as layoutModule from '../overview/layout.js'
import * as relayoutModule from '../graph/relayout.js'
import { coveMark } from './coveLogo.js'
import { createDetailPanel } from './DetailPanel.js'
import { createFeatures, featureById } from './features.js'
import { createOrganizeDrawer } from './OrganizeDrawer.js'
import { renderIcon, searchIcons, suggestIcons, iconLabel, emojiGroups, searchEmojiGroups, ICON_COLORS, normalizeIcon, ICON_IDS } from './projectIcons.js'
import { BUILD_LABEL } from './buildInfo.js'
import { openPanelInBrowser } from './browserOpen.js'

const MIN_POLL_MS = 15000
/* 侧栏可拖范围：太窄放不下「运行/洞察/关系」三个字，太宽会把正文挤没 */
const RAIL_MIN = 160
const RAIL_MAX = 420
const DEFAULT_POLL_MS = 30000

const asArray = (value) => (Array.isArray(value) ? value : [])

function adaptApi(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const fn = (name) => (typeof source[name] === 'function' ? (...args) => source[name](...args) : null)
  return {
    overview: typeof source.overview === 'function'
      ? () => source.overview()
      : (typeof source.loadOverview === 'function' ? () => source.loadOverview() : null),
    revision: typeof source.revision === 'function' ? () => source.revision() : null,
    groupAction: typeof source.groupAction === 'function'
      ? (body) => source.groupAction(body)
      : (typeof source.saveGroups === 'function' ? (body) => source.saveGroups(body) : null),
    /* 一键整理（task-16）：旧宿主没有这四个方法时是 null —— 按钮不渲染，而不是点了报错。 */
    organize: fn('organize'),
    organizeView: fn('organizeView'),
    organizeAccept: fn('organizeAccept'),
    organizeReject: fn('organizeReject'),
    organizeUndo: fn('organizeUndo'),
    /* 历史指标（task-21）：洞察页要「更全面」时用它取 /api/insight/stats；
       旧宿主没有这个方法就是 null —— 洞察页自己降级成「只有快照口径」，不报错。 */
    insightStats: fn('insightStats'),
    /* 项目图标（纯本地展示）：旧宿主没有就退化成 null，气泡回退到任务编号 */
    setWorkspaceLogo: fn('setWorkspaceLogo'),
  }
}

/** revision 是不透明值（宿主的 sha256 前 16 位）：只用来比「变没变」，不参与算术。 */
function revisionOf(value) {
  if (value == null) return null
  if (typeof value === 'object') return value.revision == null ? null : value.revision
  return value
}

function unwrap(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('宿主没有返回总览快照')
  if (payload.ok === false) throw new Error(String(payload.error || '读取总览快照失败'))
  return payload
}

function readStore(store, key) {
  if (!store || typeof store.get !== 'function') return null
  try { return store.get(key, null) } catch (error) { return null }
}

function writeStore(store, key, value) {
  if (!store || typeof store.set !== 'function') return
  try { store.set(key, value) } catch (error) { /* 隐私模式/超限：忽略 */ }
}

function clockOf(now) {
  const value = Number(now)
  if (!isFinite(value) || value <= 0) return ''
  try { return new Date(value).toLocaleTimeString() } catch (error) { return '' }
}

/**
 * 宿主能力位：`host.canOpenSession() → {ok, reason}`（lead 在 client.js 注入）。
 * 可能整个缺失、返回形状不对、或直接抛 —— 一律折成 `{ok:false, reason}`，
 * 绝不让 undefined 漏到节点上（那样按钮会「看着能点、点了没反应」）。
 */
function hostCapability(host) {
  const fallback = { ok: false, reason: '当前宿主不支持打开会话' }
  if (!host || typeof host.canOpenSession !== 'function') return fallback
  try {
    const res = host.canOpenSession()
    if (!res || typeof res !== 'object') return fallback
    const ok = res.ok === true
    return { ok, reason: String(res.reason || (ok ? '' : '当前宿主不支持打开会话')) }
  } catch (error) {
    return { ok: false, reason: String((error && error.message) || fallback.reason) }
  }
}

/** 本地拖动位置（store 键 nodePos）：形状坏掉就整块丢掉，别让坏数据把画布画歪。 */
function readNodePos(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  Object.keys(value).forEach((graphKey) => {
    const bag = value[graphKey]
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return
    const clean = {}
    Object.keys(bag).forEach((id) => {
      const pos = bag[id]
      if (!pos || typeof pos !== 'object') return
      const x = Number(pos.x)
      const y = Number(pos.y)
      if (!isFinite(x) || !isFinite(y)) return
      clean[id] = { x, y }
    })
    if (Object.keys(clean).length) out[graphKey] = clean
  })
  return out
}

/* ---------------- 右键菜单（纯展示，动作由 runMenu 决定） ----------------
 * 键盘口径与宿主菜单一致：↑↓ 在当前层移动、→ 进子菜单、← 退回主层、Enter 执行、Esc 关闭；
 * 鼠标悬停即切换当前项。两层各有自己的游标，子菜单项同样可达。
 */
function Menu(props) {
  const { React, h, menu, onRun, onClose } = props
  const { useEffect, useRef, useState } = React
  const [cursor, setCursor] = useState(-1)
  const [subCursor, setSubCursor] = useState(-1)
  const [subOpen, setSubOpen] = useState(false)
  const rootRef = useRef(null)
  const subRef = useRef(null)
  const items = asArray(menu.items)

  useEffect(() => {
    const onDown = (event) => {
      const root = rootRef.current
      const subRoot = subRef.current
      const inside = (root && typeof root.contains === 'function' && root.contains(event.target))
        || (subRoot && typeof subRoot.contains === 'function' && subRoot.contains(event.target))
      if (!inside) onClose()
    }
    const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    const onMove = () => onClose()
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('mousedown', onDown, true)
      document.addEventListener('keydown', onKey, true)
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', onMove)
      window.addEventListener('scroll', onMove, true)
    }
    return () => {
      if (typeof document !== 'undefined' && document.removeEventListener) {
        document.removeEventListener('mousedown', onDown, true)
        document.removeEventListener('keydown', onKey, true)
      }
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('resize', onMove)
        window.removeEventListener('scroll', onMove, true)
      }
    }
  }, [onClose])

  const parent = cursor >= 0 ? items[cursor] : null
  const subItems = parent && Array.isArray(parent.submenu) ? parent.submenu : []
  const level = subOpen && subItems.length ? subItems : items
  const active = subOpen && subItems.length ? subCursor : cursor
  const isRunnable = (item) => !!item && item.kind !== 'separator' && item.disabled !== true

  const setActive = (next) => { if (subOpen && subItems.length) setSubCursor(next); else setCursor(next) }
  const step = (delta) => {
    let next = active
    for (let i = 0; i < level.length; i += 1) {
      next = (next + delta + level.length) % level.length
      if (isRunnable(level[next])) break
    }
    setActive(next)
  }
  const enterSub = () => {
    if (!subItems.length) return
    let index = subItems.findIndex(isRunnable)
    if (index < 0) index = 0
    setSubCursor(index)
    setSubOpen(true)
  }

  const maxX = typeof window !== 'undefined' && window.innerWidth ? Math.max(8, window.innerWidth - 220) : menu.x
  const maxY = typeof window !== 'undefined' && window.innerHeight ? Math.max(8, window.innerHeight - 40 - items.length * 26) : menu.y
  const left = Math.min(Math.max(8, menu.x), maxX)
  const top = Math.min(Math.max(8, menu.y), Math.max(8, maxY))

  const renderItems = (list, levelIndex) => list.map((item, index) => {
    if (item.kind === 'separator') return h('div', { key: `sep:${levelIndex}:${index}`, className: 'fo-menu-sep' })
    const hasSub = Array.isArray(item.submenu) && item.submenu.length > 0
    const isActive = levelIndex === 0
      ? (!subOpen || !subItems.length) && cursor === index
      : subOpen && subCursor === index
    return h('button', {
      key: `${levelIndex}:${item.id || index}`,
      type: 'button',
      className: 'fo-menu-item',
      disabled: item.disabled === true,
      'data-id': item.id || '',
      'data-danger': item.danger === true ? '1' : '0',
      'data-open': isActive ? '1' : '0',
      onMouseEnter: () => {
        if (levelIndex === 0) { setCursor(index); setSubOpen(hasSub) } else setSubCursor(index)
      },
      onClick: () => {
        if (hasSub) { setCursor(index); enterSub(); return }
        onRun(item, menu.row)
      },
    },
      h('span', { className: 'fo-menu-check' }, item.checked === true ? '✓' : ''),
      h('span', null, item.label),
      hasSub ? h('span', { className: 'fo-menu-more' }, '▸') : null,
    )
  })

  return h('div', {
    ref: rootRef,
    className: 'fo-menu',
    role: 'menu',
    style: { left, top },
    onKeyDown: (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); step(1) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); step(-1) }
      else if (event.key === 'ArrowRight') { event.preventDefault(); enterSub() }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); setSubOpen(false) }
      else if (event.key === 'Escape') { event.preventDefault(); onClose() }
      else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const item = active >= 0 ? level[active] : null
        if (!isRunnable(item)) return
        if (Array.isArray(item.submenu) && item.submenu.length && !subOpen) { setCursor(items.indexOf(item)); enterSub(); return }
        onRun(item, menu.row)
      }
    },
  },
    renderItems(items, 0),
    subOpen && subItems.length
      ? h('div', {
        ref: subRef,
        className: 'fo-menu fo-menu-sub',
        role: 'menu',
        style: {
          left: Math.min(left + 190, typeof window !== 'undefined' && window.innerWidth ? window.innerWidth - 200 : left + 190),
          top: Math.min(Math.max(8, top + Math.max(0, cursor) * 26 + 4), typeof window !== 'undefined' && window.innerHeight ? Math.max(8, window.innerHeight - 140) : top),
        },
      }, renderItems(subItems, 1))
      : null,
  )
}

export function createOverviewPanel(deps) {
  const { React, h } = deps || {}
  const model = (deps && deps.model) || modelModule
  const layout = (deps && deps.layout) || layoutModule
  /* 坐标引擎（dagre）：测试可注入；默认走真实实现。 */
  const graphRelayout = (deps && deps.relayout) || relayoutModule
  const api = adaptApi(deps && deps.api)
  const store = (deps && deps.store) || null
  /* 宿主能力位（openSession / canOpenSession）：由 lead 在 client.js 注入，本组件只依赖接口本身。 */
  const host = (deps && deps.host) || null
  const pollMs = Math.max(MIN_POLL_MS, Number(deps && deps.pollMs) || DEFAULT_POLL_MS)

  const DetailPanel = createDetailPanel({ React, h, model })
  const OrganizeDrawer = createOrganizeDrawer({ React, h, model })
  /* 功能注册表：rail 导航项、正文渲染、activeFeature 全从它派生。
     `features` 允许注入（测试用它加一个假功能验证「注册表驱动」与切换）。 */
  const features = Array.isArray(deps && deps.features) && deps.features.length
    ? deps.features
    : createFeatures({ React, h, model, layout, api, store })

  const { useCallback, useEffect, useMemo, useRef, useState } = React
  /* 「接受建议后临时展开已完成」的时长；测试注入小值，线上 3 秒。 */
  const REVEAL_MS = Number(deps && deps.revealMs) > 0 ? Number(deps.revealMs) : 3000

  return function OverviewPanel(props) {
    const options = props || {}
    /* 只有「看起来确实像 api」的 props 覆写才生效：槽位渲染时塞进来的其它 props 不能顶掉注入的接口。 */
    const override = options.api && typeof options.api === 'object'
      && (typeof options.api.overview === 'function' || typeof options.api.loadOverview === 'function')
      ? adaptApi(options.api)
      : null
    const apiRef = useRef(override || api)
    const alive = useRef(true)

    const [state, setState] = useState({ status: 'loading', error: '', data: null })
    const [scope, setScope] = useState(() => model.normScope(readStore(store, 'selection')))
    const [activeFeatureId, setActiveFeatureId] = useState(() => {
      const hit = featureById(features, model.str(readStore(store, 'feature')))
      return hit ? hit.id : ''
    })
    /* rail 两级菜单：一级项（功能）的展开态，落 store 键 nav（如 { graph: true }），默认展开。 */
    const [navOpen, setNavOpen] = useState(() => {
      const saved = readStore(store, 'nav')
      return model.isObj(saved) ? saved : {}
    })
    const [railOpen, setRailOpen] = useState(() => readStore(store, 'rail') !== false)
    /* 拖动侧栏右边缘调宽度：从当前实测宽度起算，clamp 到 [RAIL_MIN, RAIL_MAX]，松手即落 store */
    const beginRailResize = (event) => {
      if (!event || (event.button != null && event.button !== 0)) return
      const aside = event.currentTarget && event.currentTarget.parentElement
      if (!aside) return
      event.preventDefault()
      const startX = Number(event.clientX) || 0
      const startWidth = aside.getBoundingClientRect().width
      const move = (moveEvent) => {
        const next = Math.round(startWidth + (Number(moveEvent.clientX) || 0) - startX)
        setRailWidth(Math.max(RAIL_MIN, Math.min(RAIL_MAX, next)))
      }
      const finish = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', finish)
    }
    const [collapsed, setCollapsed] = useState(() => {
      const value = readStore(store, 'collapsed')
      return model.isObj(value) ? value : {}
    })
    const [detailId, setDetailId] = useState('')
    /* 画布聚焦：点节点/按 F 都会落到这里；点空白或 Esc 取消。纯前端瞬态，不进 store。 */
    const [focusedId, setFocusedId] = useState('')
    /* 本地拖动位置：{ 图 key: { 任务 id: {x,y} } }，落 store（键 nodePos），「复位布局」清图。 */
    const [nodePos, setNodePos] = useState(() => readNodePos(readStore(store, 'nodePos')))
    /* 宿主动作（打开会话）失败时的可读提示：role=status，绝不静默。 */
    const [hostNote, setHostNote] = useState('')
    /* 侧栏「打开任务页」的瞬时回执：只改按钮文字（用户口径：不要正文头提示）。
       opened / openFailed，1.8 秒后自动回到默认。 */
    const [railAction, setRailAction] = useState('')
    const railTimer = useRef(null)
    /* 项目图标选择器：{ key, title } | null（纯本地展示配置，不写飞书） */
    const [logoPicker, setLogoPicker] = useState(null)
    /* 图标选择器的临时状态：搜索词 / 图标或 emoji 页 / 选中的颜色 */
    const [logoQuery, setLogoQuery] = useState('')
    const [logoTab, setLogoTab] = useState('icon')
    const [logoColor, setLogoColor] = useState('')
    /* 一键整理（task-16）：抽屉开关 + 最近一批建议 + 逐条失败原因。整块状态放一个对象里，
       因为「跑」是异步的，分开的 setState 会出现抽屉和 batch 短暂对不上的中间态。 */
    const [org, setOrg] = useState(() => {
      const saved = readStore(store, 'organize')
      return {
        open: model.isObj(saved) ? saved.open === true : false,
        batchId: model.isObj(saved) ? model.str(saved.batchId) : '',
        batch: null,
        groups: [],
        visible: 1,
        /* 点图头「建议」时记住要生成的范围；抽屉里的「提供新的建议」用它。 */
        scope: { kind: 'all', id: '' },
        status: 'idle',
        error: '',
        failed: {},
        droppedOpen: false,
      }
    })
    const [keyword, setKeyword] = useState(() => model.str(readStore(store, 'keyword')))
    /* 全局搜索：cove 的做法是先一个 42px 图标按钮，点开才是输入框（⌘K 直接展开并聚焦） */
    const searchRef = useRef(null)
    const [searchOpen, setSearchOpen] = useState(false)
    /* 侧栏宽度可拖：0 = 用 CSS 默认（展开 192 / 窄面板 196）；拖过就记住，双击把手复位。 */
    const [railWidth, setRailWidth] = useState(() => {
      const saved = Math.round(Number(readStore(store, 'railWidth')))
      return saved >= RAIL_MIN && saved <= RAIL_MAX ? saved : 0
    })
    useEffect(() => { if (railWidth) writeStore(store, 'railWidth', railWidth) }, [railWidth])
    /* 整理后的结果提示（接受了几条、有几条落在隐藏的已完成任务上）。 */
    const [orgNote, setOrgNote] = useState('')
    /* 已完成默认不画（用户口径）：「全部任务」里已完成往往占绝大多数（实测 57 条里 49 条已完成），
       画布会被已完成的卡片淹掉，看不出还剩哪些活。开关在关系页卡片头部，选择记进 store。 */
    const [hideDone, setHideDone] = useState(() => readStore(store, 'hideDone') !== false)
    /* 「临时看一眼已完成」：接受整理建议后，命中的关系可能全落在已完成任务上（默认不画）。
       这时把已完成展开几秒让人确认关系真的写进去了，再自动收回——不改用户存下来的偏好，
       也不算进 store（刷新后仍是隐藏）。 */
    const [revealDone, setRevealDone] = useState(false)
    /* 临时展开时**具体**要亮出来的已完成任务 id：比「全局都亮」准确，
       也不跟每张图自己的筛选打架（筛选默认藏已完成，但这几个必须可见）。 */
    const [revealIds, setRevealIds] = useState([])
    const revealTimer = useRef(null)
    const revealDoneTemporarily = useCallback((ms = 3000) => {
      if (revealTimer.current) clearTimeout(revealTimer.current)
      setRevealDone(true)
      revealTimer.current = setTimeout(() => { revealTimer.current = null; setRevealDone(false); setRevealIds([]) }, ms)
    }, [])
    useEffect(() => () => { if (revealTimer.current) clearTimeout(revealTimer.current) }, [])
    /* 「在浏览器打开」的按钮文字回执：不弹正文提示，只在按钮上闪一下。 */
    const flashRailAction = useCallback((value) => {
      setRailAction(value)
      if (railTimer.current) clearTimeout(railTimer.current)
      railTimer.current = setTimeout(() => { railTimer.current = null; setRailAction('') }, 1800)
    }, [])
    useEffect(() => () => { if (railTimer.current) clearTimeout(railTimer.current) }, [])
    /* 有效口径：用户偏好 + 临时展开。画布、计数、边裁剪全部只认这一个值。 */
    const showDone = hideDone ? revealDone : true
    const [renamingId, setRenamingId] = useState('')
    const [creating, setCreating] = useState(false)
    const [creatingFor, setCreatingFor] = useState('')
    const [menu, setMenu] = useState(null)
    const [dragKey, setDragKey] = useState('')
    const [dropKey, setDropKey] = useState('')
    const [busy, setBusy] = useState(false)
    const revision = useRef(null)
    /* 单调自增的请求序号：只让**最后一次** load 的回包落地。
       没有它就会有这个竞态：目录写操作改了 revision，而「写之前发出的那次 load」在写之后才返回，
       于是旧快照盖掉本地 patch（还顺手把 revision.current 拉回旧值，要等下一轮轮询才自愈）。 */
    const requestSeq = useRef(0)

    const load = useCallback((silent) => {
      const fn = apiRef.current.overview
      if (!fn) {
        setState((prev) => ({ status: prev.data ? 'ready' : 'error', error: '宿主接口不可用（缺少 api.overview）', data: prev.data }))
        return undefined
      }
      const seq = requestSeq.current + 1
      requestSeq.current = seq
      if (!silent) setState((prev) => ({ ...prev, status: prev.data ? 'ready' : 'loading' }))
      return Promise.resolve()
        .then(() => fn())
        .then((payload) => {
          /* 过期回包：直接丢。既不改数据，也不改 revision.current。 */
          if (seq !== requestSeq.current) return null
          const data = unwrap(payload)
          revision.current = revisionOf(payload)
          if (alive.current) setState({ status: 'ready', error: '', data })
          return data
        })
        .catch((error) => {
          /* 过期的失败也别报：它描述的是已经被更新请求取代的那一次。 */
          if (seq !== requestSeq.current) return null
          const message = String((error && error.message) || error) || '读取总览快照失败'
          if (alive.current) setState((prev) => ({ status: prev.data ? 'ready' : 'error', error: message, data: prev.data }))
          return null
        })
    }, [])

    useEffect(() => {
      alive.current = true
      load(false)
      return () => { alive.current = false }
    }, [load])

    /* 变了才刷：先问轻量 revision，值不同才重拉瘦快照。 */
    useEffect(() => {
      const id = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return
        const ask = apiRef.current.revision
        if (!ask) { load(true); return }
        Promise.resolve()
          .then(() => ask())
          .then((value) => {
            const next = revisionOf(value)
            if (next == null) return
            /* 服务端 revision !== 本地 revision.current 才重拉；本地写成功后会由写路径立刻 load(true)
               把 revision.current 修正成写后的值，所以这里不会因为「自己刚写的」而白拉一次。 */
            if (revision.current !== next) load(true)
          })
          .catch(() => { /* 轮询失败不打扰用户，下一轮再来 */ })
      }, pollMs)
      return () => clearInterval(id)
    }, [load, pollMs])

    /* 回到前台补一次：后台期间的变更不会等下一次轮询。 */
    useEffect(() => {
      if (typeof document === 'undefined' || !document.addEventListener) return undefined
      const onVisible = () => { if (!document.hidden) load(true) }
      document.addEventListener('visibilitychange', onVisible)
      return () => document.removeEventListener('visibilitychange', onVisible)
    }, [load])

    /* 选中项与折叠状态是纯视图状态：交给注入的 store（组件不碰 localStorage）。 */
    useEffect(() => { writeStore(store, 'selection', scope) }, [scope])
    useEffect(() => { writeStore(store, 'collapsed', collapsed) }, [collapsed])
    useEffect(() => { writeStore(store, 'keyword', keyword) }, [keyword])
    useEffect(() => { writeStore(store, 'hideDone', hideDone) }, [hideDone])
    useEffect(() => { writeStore(store, 'feature', activeFeatureId) }, [activeFeatureId])
    useEffect(() => { writeStore(store, 'nav', navOpen) }, [navOpen])
    useEffect(() => { writeStore(store, 'rail', railOpen) }, [railOpen])
    useEffect(() => { writeStore(store, 'nodePos', nodePos) }, [nodePos])
    useEffect(() => { writeStore(store, 'organize', { open: org.open, batchId: org.batchId }) }, [org.open, org.batchId])

    /* ⌘K / Ctrl+K：聚焦全局搜索（Search 是 Header 的固定入口，快捷键只是加速） */
    useEffect(() => {
      if (typeof window === 'undefined') return undefined
      const onKeyDown = (event) => {
        if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'k') {
          event.preventDefault()
          setSearchOpen(true)
          /* 输入框下一帧才渲染，等一拍再聚焦 */
          setTimeout(() => { if (searchRef.current && typeof searchRef.current.focus === 'function') searchRef.current.focus() }, 0)
        }
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    useEffect(() => {
      if (!detailId || typeof document === 'undefined' || !document.addEventListener) return undefined
      const onKey = (event) => { if (event.key === 'Escape') { setDetailId(''); setFocusedId('') } }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }, [detailId])

    const data = state.data
    const tasks = useMemo(() => asArray(data && data.tasks).filter((task) => model.isObj(task) && model.str(task.id)), [data])
    const relations = useMemo(() => asArray(data && data.relations), [data])
    const groups = useMemo(() => asArray(data && data.groups), [data])
    const workspaces = useMemo(() => asArray(data && data.workspaces), [data])
    /* 搜索：命中标题 / id / 编号 / 项目名，收窄的范围与树、图、卡片一致。
       过滤期间不把 workspaces 交给 buildTree/layoutScope —— 否则「0 个匹配的 项目」也会出现在树上。 */
    const keywordNeedle = model.collapse(keyword).toLowerCase()
    const visibleTasks = useMemo(() => {
      if (!keywordNeedle) return tasks
      return tasks.filter((task) => {
        const no = model.taskNo(task)
        const hay = `${model.collapse(task.title)} ${model.str(task.id)} ${model.collapse(task.workspaceTitle)} ${no > 0 ? `t${no} #${no} ${no}` : ''}`.toLowerCase()
        return hay.indexOf(keywordNeedle) >= 0
      })
    }, [tasks, keywordNeedle])
    const tasksById = useMemo(() => {
      const map = {}
      tasks.forEach((task) => { map[model.str(task.id)] = task })
      return map
    }, [tasks])
    const scopeWorkspaces = keywordNeedle ? [] : workspaces
    const tree = useMemo(() => model.buildTree(groups, visibleTasks, { collapsed, selection: scope, workspaces: scopeWorkspaces }), [groups, visibleTasks, collapsed, scope, scopeWorkspaces])

    /* 画布上的任务集 = 可见任务 − （默认）已完成。
       树仍按全部可见任务统计：那里是「这个项目有多少活」的全局口径，画布才是「现在看什么」。 */
    const hiddenDone = useMemo(() => (showDone ? 0 : visibleTasks.filter((task) => task.done === true).length), [visibleTasks, showDone])
    /* 画布任务集：**已完成也一起交给布局**，由每个项目自己决定画不画。
       （之前是在这里就滤掉，导致「某个项目想看已完成」根本拿不到那些节点。） */
    const graphTasks = visibleTasks
    const doneIds = useMemo(() => new Set(visibleTasks.filter((task) => task.done === true).map((task) => model.str(task.id))), [visibleTasks])
    /* 哪些项目单独开了「显示已完成」（按图 key） */
    const [doneGraphs, setDoneGraphs] = useState({})
    const toggleGraphDone = useCallback((graph) => {
      const key = model.str(graph && graph.key)
      if (!key) return
      setDoneGraphs((prev) => ({ ...prev, [key]: prev[key] !== true }))
    }, [])
    /* 边两端都必须在画布上：否则每条指向已完成任务的边都会长出一个 ghost 节点，
       等于「隐藏了卡片但把线头留在原地」，比不隐藏更乱。 */
    /* 边也全给：GraphView 会按「两端节点是否画出来」再过滤一遍（每个项目各管各的） */
    const graphRelations = relations
    /* 结构仍由 layoutScope 准备（范围/过滤/节点/边/ghost/卡片高度），坐标交给 dagre 重排（P1）。 */
    const drawing = useMemo(() => graphRelayout.relayoutScope(layout.layoutScope({ tasks: graphTasks, relations: graphRelations, groups, workspaces: scopeWorkspaces, scope })), [graphTasks, graphRelations, groups, scopeWorkspaces, scope, graphRelayout])
    /* 搜索时只留有节点的图：空目录不必在筛选态下占一屏 */
    const graphs = useMemo(() => {
      const list = asArray(drawing && drawing.graphs)
      /* 搜索时只留有节点的图。隐藏已完成**不**删空图：目录本身还在（重命名/删除入口在卡片上），
         一个「只剩已完成」的目录仍要看得见，只是没有节点。 */
      return keywordNeedle ? list.filter((graph) => asArray(graph.nodes).length > 0) : list
    }, [drawing, keywordNeedle])
    const scopedTasks = useMemo(() => model.scopeTasks(visibleTasks, scope, groups), [visibleTasks, scope, groups])
    /* 当前功能（rail 选中项）：Header 标题、搜索是否收窄数据、正文渲染都用它 */
    const activeFeature = featureById(features, activeFeatureId)
    /* 只有注册了 search:true 的功能（关系）才让搜索收窄页面数据；运行/洞察只弹浮层 */
    const filtersBySearch = Boolean(activeFeature && activeFeature.search === true)
    /* 运行/洞察页的搜索不走「过滤页面数据」，只在 Header 下弹结果（点一条直接开会话/详情） */
    const searchHits = useMemo(() => {
      const needle = model.collapse(keyword).toLowerCase()
      if (!needle || filtersBySearch) return []
      return tasks
        .filter((item) => model.collapse(`${model.str(item.title)} ${model.taskNo(item) || ''} ${model.str(item.workspaceTitle)}`).toLowerCase().includes(needle))
        .slice(0, 6)
    }, [keyword, filtersBySearch, tasks])
    const colorOf = useMemo(() => {
      const map = {}
      asArray(tree && tree.lanes).forEach((lane) => {
        asArray(lane.projects).forEach((project) => { map[project.key] = project.colorIndex })
      })
      return map
    }, [tree])

    /* scope 指向的目录/项目已经不在快照里（被删/改名）→ 退回「全部任务」，别停在空图上。 */
    useEffect(() => {
      if (state.status !== 'ready' || !data || scope.kind === 'all' || keywordNeedle) return
      const first = graphs[0]
      if (!first || first.kind === 'empty') setScope({ kind: 'all', id: '' })
    }, [state.status, data, scope, graphs, keywordNeedle])

    const runGroup = useCallback((body) => {
      const fn = apiRef.current.groupAction
      if (!fn) { setState((prev) => ({ ...prev, error: '宿主接口不可用（缺少目录写接口）' })); return Promise.resolve(null) }
      setBusy(true)
      return Promise.resolve()
        .then(() => fn(body))
        .then((res) => {
          if (!res || res.ok !== true) throw new Error(String((res && res.error) || '目录操作失败'))
          if (alive.current) {
            /* 先用返回的 groups 立刻反映到界面上（用户不该等一次网络往返才看到自己的操作）。 */
            setState((prev) => {
              if (!prev.data) return { ...prev, error: '' }
              const next = Array.isArray(res.groups) ? res.groups : prev.data.groups
              return { ...prev, error: '', data: { ...prev.data, groups: next } }
            })
          }
          /* 写成功后立刻拉一次权威快照：既校正 revision.current（不再停留在写前值），
             也让「写之前发出的那次 load」因为请求序号更旧而被丢掉（见 load 里的 requestSeq）。 */
          if (alive.current) load(true)
          return res
        })
        .catch((error) => {
          const message = String((error && error.message) || error) || '目录操作失败'
          if (alive.current) setState((prev) => ({ ...prev, error: message }))
          return null
        })
        .then((res) => { if (alive.current) setBusy(false); return res })
    }, [load])

    const runMenu = useCallback((item, row) => {
      setMenu(null)
      if (!item || item.disabled === true || !row) return
      const id = String(item.id || '')
      if (id === 'refresh') { load(true); return }
      if (id === 'rename') { setRenamingId(row.id); return }
      if (id === 'new-group') { setCreatingFor(''); setCreating(true); return }
      if (id === 'move-new') { setCreatingFor(row.id); setCreating(true); return }
      if (id === 'focus') { setScope({ kind: 'project', id: row.id }); return }
      if (id === 'logo') {
        const current = Array.isArray(workspaces) ? workspaces.find((w) => String(w.key || '') === String(row.id || '')) : null
        setLogoPicker({ key: String(row.id || ''), title: String(row.label || row.id || '') })
        setLogoQuery('')
        setLogoTab('icon')
        setLogoColor(String((current && current.logoColor) || ''))
        return
      }
      if (id === 'delete') {
        runGroup({ action: 'delete', id: row.id }).then((res) => {
          if (res && scope.kind === 'group' && scope.id === row.id) setScope({ kind: 'all', id: '' })
        })
        return
      }
      if (id.indexOf('move:') === 0) {
        runGroup({ action: 'add', id: item.groupId, member: { key: row.id, label: row.label } })
        return
      }
      if (id === 'remove') {
        const owner = model.normalizeGroups(groups).find((def) => def.members.indexOf(row.id) >= 0)
        if (owner) runGroup({ action: 'remove', id: owner.id, key: row.id })
      }
    }, [groups, load, runGroup, scope])

    /** 选一个项目图标（空串 = 清除）；失败写 hostNote，成功重拉快照让气泡立刻换图标 */
    const applyLogo = useCallback((iconId, colorId) => {
      const picker = logoPicker
      if (!picker || !picker.key) return Promise.resolve(false)
      const fn = apiRef.current.setWorkspaceLogo
      if (!fn) { setHostNote('当前宿主不支持设置项目图标'); return Promise.resolve(false) }
      const color = colorId === undefined ? logoColor : colorId
      return Promise.resolve()
        .then(() => fn(picker.key, iconId || '', color || ''))
        .then((res) => {
          if (res && res.ok === true) { setLogoPicker(null); setLogoQuery(''); setLogoColor(''); load(true); return true }
          setHostNote((res && res.error) || '设置项目图标失败')
          return false
        })
        .catch((error) => { setHostNote(String((error && error.message) || error) || '设置项目图标失败'); return false })
    }, [load, logoPicker, logoColor])

    /* 点行 = 选中该范围；**再点一次已选中的目录/根行 = 折叠或展开它**。
       去掉 caret 之后这是鼠标唯一的折叠入口（键盘左右键不变）。 */
    const onSelectRow = useCallback((row) => {
      if (!row) return
      if (row.kind === 'project') {
        setScope({ kind: 'project', id: row.id })
        return
      }
      if (row.kind === 'all') {
        if (scope.kind === 'all') {
          setCollapsed((prev) => ({ ...prev, all: prev.all !== true }))
          return
        }
        setScope({ kind: 'all', id: '' })
        return
      }
      /* 点目录行 = 只切换范围（不展开）。展开/收起是行首图标的事，见 TreeNav 的 onToggle。 */
      setScope({ kind: 'group', id: row.id })
    }, [scope])

    /* 折叠键是三态的（true 收 / false 开 / 没记录 = 用模型默认）。
       目录默认是「收起」，所以第一次点图标必须是**展开** —— 直接取反会算成 true（还是收着）。 */
    const onToggleRow = useCallback((row) => {
      if (!row) return
      setCollapsed((prev) => {
        const current = prev[row.key]
        if (typeof current === 'boolean') return { ...prev, [row.key]: !current }
        return { ...prev, [row.key]: row.kind !== 'group' }
      })
    }, [])

    const onMenu = useCallback((row, at) => {
      if (!row) return
      const items = model.rowMenu(row, groups, scope)
      if (!items.length) return
      setMenu({ row, items, x: at && at.x ? at.x : 40, y: at && at.y ? at.y : 40 })
    }, [groups, scope])

    const onDrop = useCallback((projectKey, targetRow) => {
      setDragKey('')
      setDropKey('')
      const key = String(projectKey || '').replace(/^project:/, '')
      if (!key) return
      if (targetRow && targetRow.kind === 'group' && targetRow.ungrouped !== true) {
        const row = tree && tree.byKey ? tree.byKey[`project:${key}`] : null
        runGroup({ action: 'add', id: targetRow.id, member: { key, label: row ? row.label : key } })
        return
      }
      const owner = model.normalizeGroups(groups).find((def) => def.members.indexOf(key) >= 0)
      if (owner) runGroup({ action: 'remove', id: owner.id, key })
    }, [groups, runGroup, tree])

    const onCreateCommit = useCallback((name) => {
      const pending = creatingFor
      setCreating(false)
      setCreatingFor('')
      const row = pending && tree && tree.byKey ? tree.byKey[`project:${pending}`] : null
      const body = { action: 'create', name }
      if (pending) {
        body.members = [pending]
        body.labels = row ? { [pending]: row.label } : {}
      }
      runGroup(body).then((res) => { if (res && res.group && res.group.id) setScope({ kind: 'group', id: res.group.id }) })
    }, [creatingFor, runGroup, tree])

    const onRenameCommit = useCallback((id, name) => {
      setRenamingId('')
      runGroup({ action: 'rename', id, name })
    }, [runGroup])

    const openTask = useCallback((id) => {
      const key = model.str(id)
      if (!key) return
      setDetailId(key)
      /* 点节点 = 选中 + 聚焦（task-15）：其余节点随之降透明度。 */
      setFocusedId(key)
    }, [])

    const focusTask = useCallback((id) => {
      const key = model.str(id)
      if (key) setFocusedId(key)
    }, [])

    /** 点画布空白 / Esc：取消聚焦（详情也一起收起来，两个状态本来就是一回事的两面）。 */
    const blurCanvas = useCallback(() => {
      setFocusedId('')
      setDetailId('')
    }, [])

    /* 拖动落位：松手时 GraphView 已经吸附过网格，这里只负责按「图 key + 任务 id」存下来。 */
    const moveNode = useCallback((graphKey, id, pos) => {
      const gk = model.str(graphKey)
      const key = model.str(id)
      if (!gk || !key || !pos) return
      const x = Number(pos.x)
      const y = Number(pos.y)
      if (!isFinite(x) || !isFinite(y)) return
      setNodePos((prev) => ({ ...prev, [gk]: { ...(prev[gk] || {}), [key]: { x, y } } }))
    }, [])

    /* 复位布局：只清这张图的本地位置，回到 layout 给的坐标。 */
    const resetLayout = useCallback((graphKey) => {
      const gk = model.str(graphKey)
      setNodePos((prev) => {
        if (!gk) return {}
        if (!prev[gk]) return prev
        const next = { ...prev }
        delete next[gk]
        return next
      })
    }, [])

    /**
     * 打开会话：host.openSession 是「尽力而为 + 读回核对」的异步动作，
     * 失败（含返回 false / 抛错）一律给一条 role=status 的可读提示，不静默。
     */
    const openSession = useCallback((sessionId, expectedTitle) => {
      const key = model.str(sessionId)
      if (!key) { setHostNote('这个任务没有绑定会话'); return Promise.resolve(false) }
      if (!host || typeof host.openSession !== 'function') {
        setHostNote(hostCapability(host).reason)
        return Promise.resolve(false)
      }
      return Promise.resolve()
        .then(() => host.openSession(key, model.str(expectedTitle)))
        .then((res) => {
          if (res && res.ok === true) { setHostNote(''); return true }
          const reason = (res && model.str(res.reason)) || '宿主没能打开这条会话'
          if (alive.current) setHostNote(reason)
          return false
        })
        .catch((error) => {
          const reason = model.str((error && error.message) || error) || '宿主没能打开这条会话'
          if (alive.current) setHostNote(reason)
          return false
        })
    }, [host])

    /* ---------------- 一键整理（task-16）：只出建议、人点了才落库 ---------------- */

    /* 首次挂载：把最近一批建议取回来（没有就是 null），抽屉一打开就有内容。
       建议永远按**全量任务**算，所以这里不跟 scope 走。 */
    useEffect(() => {
      const fn = apiRef.current.organizeView
      if (!fn) return undefined
      let stale = false
      Promise.resolve()
        .then(() => fn({ kind: 'all', id: '' }))
        .then((res) => {
          /* 兼容旧宿主/测试桩：直接返回 batch 对象时当成 { batch }。 */
          const batch = res && res.batch ? res.batch : (res && (res.batchId || Array.isArray(res.items)) ? res : null)
          const batches = asArray(res && res.batches)
          if (stale || !alive.current || (!batch && !batches.length)) return
          const groups = batches.length ? batches : (batch ? [batch] : [])
          setOrg((prev) => ({
            ...prev,
            batch,
            groups,
            visible: 1,
            batchId: model.str(batch && batch.batchId) || prev.batchId,
            status: 'ready',
          }))
        })
        .catch(() => { /* 恢复失败不打扰用户：画布照用，按钮还在 */ })
      return () => { stale = true }
    }, [])

    /* 建议栏：默认「自动」（宽屏固定成列、窄面板变浮层），用户可以手动钉成固定或浮层。
       值落 store 键 organizeDock：'1' 固定 / '0' 浮层 / 未设置 = 自动。 */
    const [organizeDock, setOrganizeDock] = useState(() => {
      const saved = model.str(readStore(store, 'organizeDock'))
      return saved === '1' || saved === '0' ? saved : ''
    })
    useEffect(() => { writeStore(store, 'organizeDock', organizeDock) }, [organizeDock])
    /* 当前**实际**是固定还是浮层：容器查询会按面板宽度自动切换，光看 organizeDock 判断不了。
       直接量布局（position === 'static' 就是占列的固定模式），按钮文案与切换目标都按它来。 */
    const [organizeEffective, setOrganizeEffective] = useState('dock')
    useEffect(() => {
      if (org.open !== true) return undefined
      const el = typeof document !== 'undefined' ? document.querySelector('.fo-organize') : null
      if (!el) return undefined
      const read = () => setOrganizeEffective(window.getComputedStyle(el).position === 'static' ? 'dock' : 'float')
      read()
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null
      if (ro) ro.observe(el)
      window.addEventListener('resize', read)
      return () => {
        if (ro) ro.disconnect()
        window.removeEventListener('resize', read)
      }
    }, [org.open, organizeDock, state.status])

    /* 按钮 = 切到另一种模式：现在是固定 → 钉成浮层；现在是浮层 → 钉成固定。 */
    const toggleOrganizeDock = useCallback(() => {
      setOrganizeDock(organizeEffective === 'dock' ? '0' : '1')
    }, [organizeEffective])

    const toggleOrganize = useCallback(() => {
      setOrg((prev) => ({ ...prev, open: prev.open !== true }))
    }, [])

    const closeOrganize = useCallback(() => {
      setOrg((prev) => ({ ...prev, open: false }))
    }, [])

    /** 组标题里的范围文案：全部 / 项目名 / 目录名。 */
    const scopeLabelOf = useCallback((batch) => {
      const s = (batch && batch.scope) || {}
      if (!s.kind || s.kind === 'all') return '全部任务'
      const id = model.str(s.id)
      if (s.kind === 'project') {
        const hit = asArray(data && data.workspaces).find((row) => model.str(row && row.key) === id)
        return '项目 · ' + (model.str(hit && (hit.title || hit.label)) || id)
      }
      const group = asArray(groups).find((row) => model.str(row && row.id) === id)
      return '目录 · ' + (model.str(group && (group.name || group.title)) || (id === model.UNGROUPED_KEY ? '未分类' : id))
    }, [data, groups])

    const loadMoreGroups = useCallback(() => {
      setOrg((prev) => ({ ...prev, visible: Math.max(1, Number(prev.visible) || 1) + 3 }))
    }, [])

    const toggleDropped = useCallback(() => {
      setOrg((prev) => ({ ...prev, droppedOpen: prev.droppedOpen !== true }))
    }, [])

    /**
     * 打开建议栏：只负责「打开」。上次那批建议由挂载时的那次 organizeView 取回（见上面的 effect），
     * 入口点击不再等于「跑一次几十秒的分析」——要重算按侧栏顶部的「重新分析」。
     */
    const openOrganize = useCallback(() => {
      setOrg((prev) => ({ ...prev, open: true }))
      return Promise.resolve(org.batch || null)
    }, [org.batch])

    /** 一张图 → 整理范围：project 用项目 key；分组/未分类用 group id。 */
    const scopeOfGraph = useCallback((graph) => {
      const g = graph && typeof graph === 'object' ? graph : {}
      const id = model.str(g.scopeId || g.key)
      if (!id) return { kind: 'all', id: '' }
      if (g.kind === 'project') return { kind: 'project', id }
      return { kind: 'group', id: g.kind === 'ungrouped' ? model.UNGROUPED_KEY : id }
    }, [])

    /** 跑一次分析：零副作用，只出建议；失败给 role=alert 的错误条（重试按钮再跑一次）。 */
    const runOrganize = useCallback((scopeArg) => {
      const fn = apiRef.current.organize
      if (!fn) return Promise.resolve(null)
      /* 点「建议」就**立刻**把右侧建议栏打开（分析可能要几十秒 —— 先给用户一个在跑的侧栏，
         而不是让按钮干转、什么也没发生）。 */
      setOrg((prev) => ({ ...prev, open: true, status: 'running', error: '', failed: {} }))
      /* 默认全量；从画布卡片的「整理」进来时按那张图的范围跑（项目 / 目录）。 */
      const scopeToRun = (scopeArg && typeof scopeArg === 'object' ? scopeArg : null) || org.scope || { kind: 'all', id: '' }
      return Promise.resolve()
        .then(() => fn(scopeToRun))
        .then((res) => {
          if (!alive.current) return null
          const batch = res && res.batch ? res.batch : null
          setOrg((prev) => ({
            ...prev,
            open: true,
            batch,
            groups: batch ? [batch, ...(prev.groups || []).filter((group) => group && group.batchId !== batch.batchId)] : prev.groups,
            visible: 1,
            batchId: model.str(batch && batch.batchId) || prev.batchId,
            status: 'ready',
            error: '',
            failed: {},
          }))
          return batch
        })
        .catch((error) => {
          const message = model.str((error && error.message) || error) || '一键整理失败'
          if (alive.current) setOrg((prev) => ({ ...prev, status: 'error', error: message }))
          return null
        })
    }, [org.scope])

    /** 画布图头的「建议」：唯一入口，打开右侧建议栏并记住这张图的范围。 */
    const organizeGraph = useCallback((graph) => {
      const scopeToRun = scopeOfGraph(graph)
      /* 只负责「打开右侧建议面板」，不在入口上直接跑分析（生成新的建议在面板里点）。 */
      setOrg((prev) => ({ ...prev, open: true, scope: scopeToRun }))
      return Promise.resolve(null)
    }, [scopeOfGraph])

    /**
     * 手动连边 / 断开：走宿主的 /api/overview/relations（与建议接受同一条落库路径）。
     * 成功就重拉快照；远端没同步上时宿主会给 warning，用同一条结论条说清楚。
     */
    const writeRelation = useCallback((payload) => {
      const fn = typeof apiRef.current.relationWrite === 'function' ? apiRef.current.relationWrite : null
      if (!fn) { setOrgNote('当前宿主版本不支持手动改关系，请升级插件。'); return Promise.resolve(null) }
      const verb = payload && payload.action === 'remove' ? '断开' : '添加'
      setOrgNote('')
      return Promise.resolve()
        .then(() => fn(payload || {}))
        .then((res) => {
          if (!alive.current) return null
          const warning = model.str(res && res.warning)
          setOrgNote(warning ? `关系已存到本机；${warning}` : `已${verb}一条关系，画布已更新。`)
          load(true)
          return res
        })
        .catch((error) => {
          const message = model.str((error && error.message) || error) || `${verb}关系失败`
          if (alive.current) setOrgNote(`${verb}关系失败：${message}`)
          return null
        })
    }, [load])

    /** 已接受但只落在本机的关系：再点一次「同步」走同一条写回路径（writeTaskRelations）。 */
    const retrySyncItem = useCallback((item) => {
      const target = item && typeof item === 'object' ? item : {}
      if (!model.str(target.to) || !model.str(target.from)) return Promise.resolve(null)
      return writeRelation({
        action: 'add',
        taskId: model.str(target.to),
        otherId: model.str(target.from),
        kind: model.str(target.kind) || 'depends_on',
      })
    }, [writeRelation])

    const addRelation = useCallback((input) => writeRelation({ ...input, action: 'add', taskId: detailId }), [writeRelation, detailId])
    const removeRelation = useCallback((input) => writeRelation({ ...input, action: 'remove', taskId: detailId }), [writeRelation, detailId])

    /** 用服务端返回的 batch 替换时间轴里同一组（并同步 batch 别名）。 */
    const replaceOrgGroup = useCallback((prev, batch) => {
      const id = model.str(batch && batch.batchId)
      if (!id) return prev
      const groups = (prev.groups || []).map((group) => (model.str(group && group.batchId) === id ? batch : group))
      return {
        ...prev,
        groups,
        batch: model.str(prev.batch && prev.batch.batchId) === id ? batch : prev.batch,
      }
    }, [])

    /** 接受若干条（空数组 = 全部待处理）：只作用于传入的组，并重拉快照让新边立刻上画布。 */
    const acceptOrganize = useCallback((batchIdArg, itemIds) => {
      const fn = apiRef.current.organizeAccept
      const batchId = model.str(batchIdArg) || org.batchId
      if (!fn || !batchId) return Promise.resolve(null)
      setOrg((prev) => ({ ...prev, status: 'running' }))
      return Promise.resolve()
        .then(() => fn(batchId, itemIds || []))
        .then((res) => {
          const batch = res && res.batch ? res.batch : null
          const failed = {}
          asArray(res && res.results).forEach((row) => {
            if (!row || row.ok === true) return
            failed[model.str(row.id)] = model.str(row.error) || '写入失败'
          })
          if (alive.current) {
            setOrg((prev) => {
              const next = replaceOrgGroup(prev, batch || prev.batch)
              return {
                ...next,
                batchId: model.str(batch && batch.batchId) || prev.batchId,
                status: 'ready',
                failed,
              }
            })
            /* 已完成的任务默认不画，落在它们身上的关系在画布上看不见 —— 明确说一句，
               否则用户会以为「接受了但没生效」。
               注意：临时展开必须等**新快照落地之后**再开计时，否则 3 秒在 refetch 期间就走完了，
               等边真的画上来时已经又收起来（这正是「接受了但画布没变化」的原因之一）。 */
            const accepted = asArray(res && res.results).filter((row) => row && row.ok === true)
            const doneIds = new Set(tasks.filter((task) => task.done === true).map((task) => model.str(task.id)))
            /* 判定用 batch 里的条目（带 from/to），results 只保证 ok/id —— 宿主两种都给了，
               但 worker 只保证 batch，所以以 batch 为准，results 兜底。 */
            const acceptedIds = new Set(accepted.map((row) => model.str(row.id)))
            const acceptedItems = asArray(res && res.batch && res.batch.items)
              .filter((item) => item && acceptedIds.has(model.str(item.id)))
            const pairs = (acceptedItems.length ? acceptedItems : accepted)
              .map((item) => [model.str(item.from), model.str(item.to)])
            const hiddenHits = pairs.filter(([from, to]) => doneIds.has(from) || doneIds.has(to)).length
            const localOnly = accepted.filter((row) => model.str(row.warning)).length
            const bits = []
            if (accepted.length) bits.push(`已接受 ${accepted.length} 条建议`)
            if (hiddenHits > 0) {
              bits.push(`其中 ${hiddenHits} 条连的是已完成任务——已临时展开 ${Math.round(REVEAL_MS / 1000 * 10) / 10} 秒，之后自动收起`)
              /* 立刻亮一次（用户马上能看到反馈），快照落地后再续一次计时（见下面 then） */
              setRevealIds(pairs.filter(([from, to]) => doneIds.has(from) || doneIds.has(to)).map(([from, to]) => (doneIds.has(from) ? from : to)))
              revealDoneTemporarily(REVEAL_MS)
            }
            if (localOnly > 0) bits.push(`${localOnly} 条只写进了本机，飞书同步待完成`)
            setOrgNote(bits.length ? `${bits.join('；')}。` : '')
            /* 先重拉快照让新边进数据，**再**开始临时展开的计时 —— 顺序反了就等于没展开。 */
            Promise.resolve(load(true)).then(() => {
              if (alive.current && hiddenHits > 0) revealDoneTemporarily(REVEAL_MS)
            })
          }
          return res
        })
        .catch((error) => {
          const message = model.str((error && error.message) || error) || '接受建议失败'
          if (alive.current) setOrg((prev) => ({ ...prev, status: 'error', error: message }))
          return null
        })
    }, [load, org.batchId, tasks, revealDoneTemporarily, REVEAL_MS])

    const rejectOrganize = useCallback((batchIdArg, itemIds) => {
      const fn = apiRef.current.organizeReject
      const batchId = model.str(batchIdArg) || org.batchId
      if (!fn || !batchId) return Promise.resolve(null)
      setOrg((prev) => ({ ...prev, status: 'running' }))
      return Promise.resolve()
        .then(() => fn(batchId, itemIds || []))
        .then((res) => {
          const batch = res && res.batch ? res.batch : null
          if (alive.current) {
            setOrg((prev) => {
              const next = replaceOrgGroup(prev, batch || prev.batch)
              return {
                ...next,
                batchId: model.str(batch && batch.batchId) || prev.batchId,
                status: 'ready',
              }
            })
          }
          return res
        })
        .catch((error) => {
          const message = model.str((error && error.message) || error) || '拒绝建议失败'
          if (alive.current) setOrg((prev) => ({ ...prev, status: 'error', error: message }))
          return null
        })
    }, [org.batchId])

    /**
     * 撤销已接受的建议：接受必须可回退（写错一条 depends_on，那条后继就永远开不了工）。
     * 与接受同一条路径：撤销成功后也拉一次权威快照，让边立刻从画布上消失。
     */
    const undoOrganize = useCallback((batchIdArg, itemIds) => {
      const fn = apiRef.current.organizeUndo
      const batchId = model.str(batchIdArg) || org.batchId
      if (!fn || !batchId) return Promise.resolve(null)
      setOrg((prev) => ({ ...prev, status: 'running' }))
      return Promise.resolve()
        .then(() => fn(batchId, itemIds || []))
        .then((res) => {
          const batch = res && res.batch ? res.batch : null
          const failed = {}
          asArray(res && res.results).forEach((row) => {
            if (!row || row.ok === true) return
            failed[model.str(row.id)] = model.str(row.error) || '撤销失败'
          })
          if (alive.current) {
            setOrg((prev) => {
              const next = replaceOrgGroup(prev, batch || prev.batch)
              return {
                ...next,
                batchId: model.str(batch && batch.batchId) || prev.batchId,
                status: 'ready',
                failed,
              }
            })
            load(true)
          }
          return res
        })
        .catch((error) => {
          const message = model.str((error && error.message) || error) || '撤销建议失败'
          if (alive.current) setOrg((prev) => ({ ...prev, status: 'error', error: message }))
          return null
        })
    }, [load, org.batchId])

    /** 关系里点过来的任务：能点过去就一定让它可见（不在当前 scope 里就切回全部）。 */
    const jumpToTask = useCallback((id) => {
      const key = model.str(id)
      if (!key || !tasksById[key]) return
      setDetailId(key)
      if (!scopedTasks.some((task) => model.str(task.id) === key)) setScope({ kind: 'all', id: '' })
    }, [scopedTasks, tasksById])

    const detailTask = detailId ? tasksById[detailId] || null : null
    const detailNode = useMemo(() => {
      if (!detailId) return null
      const nodes = asArray(drawing && drawing.nodes)
      return nodes.find((node) => node.id === detailId && node.ghost !== true) || nodes.find((node) => node.id === detailId) || null
    }, [detailId, drawing])

    /* task-15 冗余审计：正文头部只留「当前范围（面包屑）+ 搜索框 + 必要动作」。
       - 功能名删掉：它已经在 rail 品牌区、功能项、以及这里的第三次出现 —— 三处只留功能项。
       - `.fo-stats` 计数胶囊整串删掉：图数/节点数/阻塞数在树上、图头、节点 meta 上各有一份，
         同一份信息只该出现在离它描述的对象最近的那一处。
       - 副标题不再重复范围名；只留这份视图独有的上下文（revision / 快照时钟）。 */
    const scopeName = model.scopeLabel(scope, groups)

     /* 用户口径：「QVIZ / revision 6d8e44d9 · 09:28:57」也不需要。
        revision 是不透明指纹、时钟是快照时刻 —— 排错信息，不该占版面。
        Header 也不显示页面名：在哪一页看 rail 的选中态就够了。 */
    /* 骨架只负责「数据层面还没法渲染功能页」的几种状态；有数据时正文交给功能注册表。 */
    let shellNode = null
    if (state.status === 'loading' && !data) {
      shellNode = h('div', { className: 'fo-skeleton', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h('div', { key: i, className: 'fo-skeleton-row' })))
    } else if (!data) {
      shellNode = h('div', { className: 'fo-placeholder', role: 'status' },
        h('div', { className: 'fo-placeholder-title' }, '读不到飞书任务数据'),
        h('div', { className: 'fo-placeholder-body' }, state.error || '宿主接口没有返回快照。'),
        h('button', { type: 'button', className: 'fo-btn', 'data-variant': 'primary', onClick: () => load(false) }, '重试'),
      )
    } else if (!tasks.length) {
      shellNode = h('div', { className: 'fo-placeholder', role: 'status' },
        h('div', { className: 'fo-placeholder-title' }, '还没有任何任务'),
        h('div', { className: 'fo-placeholder-body' }, '插件同步到飞书任务后，这里会按「自定义目录」把多个项目合在一张关系图里画。'),
      )
    } else if (keywordNeedle && !visibleTasks.length) {
      shellNode = h('div', { className: 'fo-placeholder', role: 'status' },
        h('div', { className: 'fo-placeholder-title' }, '没有匹配的任务'),
        h('div', { className: 'fo-placeholder-body' }, `没有标题 / 编号 / 项目名包含「${model.collapse(keyword)}」的任务。`),
        h('button', { type: 'button', className: 'fo-btn', 'data-variant': 'primary', onClick: () => setKeyword('') }, '清除搜索'),
      )
    }

    const featureComponent = activeFeature && typeof activeFeature.Component === 'function' ? activeFeature.Component : null
    const featureHint = activeFeature ? model.str(activeFeature.hint) : ''
    const hostCan = hostCapability(host)

    /* 功能页的 ctx：数据 + 交互全在这里，功能组件自己不取数据、不碰 store。 */
    const featureCtx = {
      featureHint,
      /* 功能页要自己取数的能力面（运行页的「系统健康」用它读 /api/health） */
      api: apiRef.current,
      graphs,
      selectedId: detailTask ? detailId : '',
      focusedId,
      nodePos,
      hostReady: hostCan.ok,
      hostReason: hostCan.reason,
      onOpenTask: (id) => openTask(id),
      onFocusTask: focusTask,
      /* 画布卡片上的「整理」：按这张图的项目/目录范围跑 AI 关系建议，并打开右侧建议栏。
         宿主没有 organize 接口就置空，卡片不渲染这个按钮。 */
      onOrganizeGraph: apiRef.current.organize ? organizeGraph : null,
      onNodeMove: moveNode,
      onResetLayout: resetLayout,
      onBlur: blurCanvas,
      onOpenSession: openSession,
      /* 已完成默认隐藏 + 卡片头部的开关（见 GraphView 的 .fo-graph-actions）。 */
      /* 画布看到的是「有效口径」：临时展开期间它就是 false，按钮会显示「隐藏已完成」，
         这时点一下 = 立刻收起（而不是先取消临时展开、再等一次才生效）。 */
      hideDone: !showDone,
      /* 每个项目自己的「显示已完成」：id 集合 + 已展开的项目 key 表 */
      doneIds,
      /* 筛选「最近一周完成的」要用完成时间 */
      completedById: tasks.reduce((acc, task) => {
        if (task && task.done === true) acc[model.str(task.id)] = Number(task.completedAt) || 0
        return acc
      }, {}),
      /* 画布卡片要用完整任务字段：按 id 给一份索引。 */
      taskById: tasks.reduce((acc, task) => {
        if (task && task.id) acc[model.str(task.id)] = task
        return acc
      }, {}),
      /* 只表示「因为你刚接受建议、我临时帮你展开了」，用于提示条文案；不是持久状态。 */
      revealing: hideDone === true && revealDone === true,
      revealIds,
      hiddenDone,
      onToggleHideDone: () => {
        if (revealTimer.current) { clearTimeout(revealTimer.current); revealTimer.current = null }
        setRevealDone(false)
        setHideDone((prev) => prev !== true)
      },
      /* 接受建议后的一句话结论（含「有几条落在默认隐藏的已完成任务上」）。 */
      organizeNote: orgNote,
      onDismissOrganizeNote: () => setOrgNote(''),
      onShowDone: () => setHideDone(false),
      organize: {
        available: typeof apiRef.current.organize === 'function',
        running: org.status === 'running',
        open: org.open,
        pending: Number(org.batch && org.batch.pending) || 0,
        onRun: runOrganize,
        onToggle: toggleOrganize,
      },
      /* 仪表盘页（洞察 / 运行）看的是**全局**：不受当前范围、也不受搜索词影响，
         所以要传未过滤的 tasks（复核 R1：传 visibleTasks 会让搜索时 ghosts 虚高、KPI 总数缩水）。 */
      tasks,
      relations,
      groups,
      workspaces,
      stats: model.isObj(data && data.stats) ? data.stats : {},
      now: Number(data && data.now) || Date.now(),
      treeProps: {
        tree,
        hideDone,
        renamingId,
        creating,
        creatingFor,
        dragKey,
        dropKey,
        busy,
        onSelect: onSelectRow,
        onToggle: onToggleRow,
        onMenu,
        onDragKey: setDragKey,
        onDropKey: setDropKey,
        onDrop,
        onRenameStart: (row) => setRenamingId(row.id),
        onRenameCommit,
        onRenameCancel: () => setRenamingId(''),
        onCreateStart: (projectKey) => { setCreatingFor(projectKey || ''); setCreating(true) },
        onCreateCommit,
        onCreateCancel: () => { setCreating(false); setCreatingFor('') },
      },
    }

    return h('div', {
      className: 'fo-root',
      'data-detail': detailTask || detailNode ? '1' : '0',
      'data-busy': busy ? '1' : '0',
      'data-scope': scope.kind,
      'data-rail': railOpen ? '1' : '0',
      'data-feature': activeFeatureId,
      'data-organize': org.open ? '1' : '0',
      /* 构建号：DevTools 里 document.querySelector('.fo-root').dataset.build 就能确认跑的是哪次构建 */
      'data-build': BUILD_LABEL,
      /* 建议栏位置：'1' 固定成列 / '0' 浮层 / 不写 = 按容器宽度自动 */
      'data-organize-dock': organizeDock || undefined,
      /* 只有用户真的拖过才写行内变量：没拖过就让 CSS 默认值（含窄面板的容器查询）生效 */
      style: railWidth ? { '--fo-rail-w': railWidth + 'px' } : undefined,
    },
      /* 侧栏三段：品牌 / 功能导航 / 底部固定区（折叠按钮在这里，折起来 rail 变 56px 图标条） */
      h('aside', { className: 'fo-rail', 'aria-label': '功能导航' },
        h('div', { className: 'fo-brand' },
          /* 折叠按钮就是 logo 本身（用户口径：折叠按钮放在侧边栏上方的 logo）。
             收起后它和下面的一级项一样是正方形图标块，点一下展开。 */
          h('button', {
            type: 'button',
            className: 'fo-brand-logo',
            'aria-expanded': railOpen ? 'true' : 'false',
            'aria-label': railOpen ? '收起侧栏' : '展开侧栏',
            title: railOpen ? '收起侧栏' : '展开侧栏',
            onClick: () => setRailOpen((prev) => prev !== true),
          },
            /* 品牌标（cove）：这个方块本身仍是「收起 / 展开 rail」的按钮 */
            coveMark(h, 22),
          ),
          h('span', { className: 'fo-brand-text' },
            h('span', { className: 'fo-brand-title' }, model.str(options.title) || '海湾'),
            h('span', { className: 'fo-brand-sub' }, model.str(options.subtitle) || 'DeepSeek Harness'),
          ),
        ),
        /* 功能导航 = 两级菜单：一级项是功能（数量 = 注册表长度），可展开的项下面是它的二级菜单
           （「关系」下面是范围树）。展开态落 store 键 nav，默认展开；点当前已展开的一级项 = 收起。 */
        h('nav', { className: 'fo-featnav', 'aria-label': '功能' },
          features.map((feature) => {
            const active = feature.id === activeFeatureId
            const expandable = typeof feature.SubNav === 'function'
            const open = expandable && active && navOpen[feature.id] !== false
            return h('div', { key: feature.id, className: 'fo-featnav-group' },
              h('button', {
                type: 'button',
                className: 'fo-featnav-item',
                'data-active': active ? '1' : '0',
                'data-expandable': expandable ? '1' : '0',
                'data-expanded': open ? '1' : '0',
                'aria-current': active ? 'page' : undefined,
                'aria-expanded': expandable ? (open ? 'true' : 'false') : undefined,
                title: model.str(feature.hint) || model.str(feature.label),
                onClick: () => {
                  if (active && expandable) {
                    /* 再点一次当前功能 = 回到「全部」范围并收起/展开它的二级菜单。
                       侧栏里没有「全部任务」这一行，这就是回到全量的入口。 */
                    setScope({ kind: 'all', id: '' })
                    setNavOpen((prev) => ({ ...prev, [feature.id]: prev[feature.id] === false }))
                    return
                  }
                  setActiveFeatureId(feature.id)
                },
              },
                typeof feature.icon === 'function' ? feature.icon(h) : null,
                h('span', { className: 'fo-nav-label' }, model.str(feature.label) || feature.id),
                /* cove 的 NavGroup 没有展开箭头：一级项就是图标 + 文字，
                   展开由「点当前项」控制，展开与否看二级容器在不在。 */
              ),
              open ? h(feature.SubNav, { key: 'sub', ...featureCtx }) : null,
            )
          }),
        ),
        /* 右边缘拖动把手：调宽窄（双击复位成 CSS 默认）。折叠态没有把手。 */
        railOpen
          ? h('div', {
            className: 'fo-rail-resizer',
            role: 'separator',
            'aria-orientation': 'vertical',
            'aria-label': '拖动调整侧栏宽度',
            title: '拖动调整宽度 · 双击复位',
            onPointerDown: beginRailResize,
            onDoubleClick: () => setRailWidth(0),
          })
          : null,
        h('div', { className: 'fo-rail-foot' },
          h('button', {
            type: 'button',
            className: 'fo-rail-action fo-rail-open',
            title: '在浏览器打开海湾页',
            'aria-label': '在浏览器打开海湾页',
            onClick: () => {
              void (async () => {
                let opened = null
                try {
                  opened = await openPanelInBrowser()
                } catch (error) {
                  opened = null
                }
                flashRailAction(opened && opened.ok ? 'opened' : 'openFailed')
              })()
            },
          },
            h('svg', {
              className: 'fo-nav-icon',
              width: 18, height: 18, viewBox: '0 0 24 24',
              fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
              strokeLinecap: 'round', strokeLinejoin: 'round',
              'aria-hidden': 'true',
            },
              h('path', { d: 'M15 3h6v6' }),
              h('path', { d: 'M10 14 21 3' }),
              h('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
            ),
            h('span', { className: 'fo-nav-label' },
              railAction === 'opened' ? '已打开' : railAction === 'openFailed' ? '打开失败' : '打开页面'),
          ),
        ),
      ),
      h('div', { className: 'fo-body' },
        h('div', { className: 'fo-main' },
          /* 全局 Header：与左上品牌栏严格齐平（同为 48px + 同一条底边线）。
             三页共用：左=页面名，中=全局搜索，右=建议 + 刷新。 */
          h('header', { className: 'fo-main-head' },
            /* Header 不放页面名：当前在哪一页由 rail 的选中态表达（cove 的 TopBar 也不放标题）。 */
            /* 搜索全局常驻。只有注册了 search:true 的功能（关系）会**收窄页面数据**；
               运行/洞察只弹结果浮层 —— 免得 KPI 与图表被搜索悄悄改掉。 */
            /* 搜索（cove TopBar 同款）：默认只是 42px 圆形图标，点开变 320px 胶囊；Esc 收起 */
            h('div', { className: 'fo-search-wrap', 'data-open': searchOpen ? '1' : '0' },
              h('button', {
                type: 'button',
                className: 'fo-search-toggle',
                title: '搜索（⌘K）',
                'aria-label': searchOpen ? '收起搜索' : '搜索',
                'aria-expanded': searchOpen ? 'true' : 'false',
                onClick: () => {
                  if (searchOpen) setKeyword('')
                  setSearchOpen((prev) => prev !== true)
                },
              },
                h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
                  h('circle', { cx: 11, cy: 11, r: 7 }),
                  h('path', { d: 'm20 20-3.6-3.6' }),
                ),
              ),
              searchOpen
                ? h('input', {
                  ref: searchRef,
                  className: 'fo-search',
                  type: 'text',
                  value: keyword,
                  placeholder: '搜索…',
                  'aria-label': '搜索任务',
                  onChange: (event) => setKeyword(event.currentTarget.value),
                  onKeyDown: (event) => {
                    if (event.key !== 'Escape') return
                    setKeyword('')
                    setSearchOpen(false)
                  },
                })
                : null,
              searchOpen && keyword && !filtersBySearch
                ? h('div', { className: 'fo-search-pop', role: 'listbox', 'aria-label': '搜索结果' },
                  searchHits.length
                    ? searchHits.map((item) => h('button', {
                      key: model.str(item.id),
                      type: 'button',
                      className: 'fo-search-hit',
                      role: 'option',
                      onClick: () => { setKeyword(''); setSearchOpen(false); openTask(model.str(item.id)) },
                    },
                      h('span', { className: 'fo-search-hit-no' }, 'T' + (model.taskNo(item) || '')),
                      h('span', { className: 'fo-search-hit-title' }, model.str(item.title) || model.str(item.id)),
                    ))
                    : h('div', { className: 'fo-search-pop-empty' }, '没有匹配的任务'))
                : null,
              searchOpen && keyword && filtersBySearch
                ? h('span', { className: 'fo-search-hint' }, `匹配 ${scopedTasks.length} 条`)
                : null,
            ),
            /* 建议入口已收进关系面板的图头（唯一入口）；页头不再放第二个「建议」按钮。 */
          ),
          /* 宿主动作失败的提示（role=status）：打开会话没成功时给一句人话，别静默。 */
          hostNote
            ? h('div', { className: 'fo-note', role: 'status' },
              h('span', null, hostNote),
              h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', onClick: () => setHostNote('') }, '知道了'),
            )
            : null,
          state.error
            ? h('div', { className: 'fo-banner', role: 'alert' },
              h('span', null, state.error),
              h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', onClick: () => load(false) }, '重试'),
              h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', onClick: () => setState((prev) => ({ ...prev, error: '' })) }, '知道了'),
            )
            : null,
          /* 一键整理失败：同一套错误条口径（role=alert + 重试），不静默。 */
          org.error
            ? h('div', { className: 'fo-banner', role: 'alert' },
              h('span', null, org.error),
              h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', onClick: () => runOrganize() }, '重试'),
              h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', onClick: () => setOrg((prev) => ({ ...prev, error: '' })) }, '知道了'),
            )
            : null,
          /* 正文 = 当前功能页；功能从注册表来，骨架不认识任何具体功能 */
          h('div', { className: 'fo-feature-host', 'data-feature': activeFeatureId },
            shellNode || (featureComponent ? h(featureComponent, featureCtx) : null),
          ),
        ),
        (detailTask || detailNode)
          ? h(DetailPanel, {
            task: detailTask,
            node: detailNode,
            tasksById,
            colorOf,
            hostReady: hostCan.ok,
            hostReason: hostCan.reason,
            onOpenSession: openSession,
            onClose: () => { setDetailId(''); setFocusedId('') },
            onSelectTask: jumpToTask,
            onFocusProject: (key) => setScope({ kind: 'project', id: key }),
            onAddRelation: addRelation,
            onRemoveRelation: removeRelation,
            /* 候选：全部任务，最近的在前（关系图里连边常常是跨目录的，所以不做范围裁剪） */
            candidates: tasks.map((item) => ({ id: model.str(item.id), label: `T${model.taskNo(item) || ''} ${model.collapse(item.title)}`.trim() })),
          })
          : null,
        org.open
          ? h(OrganizeDrawer, {
            open: true,
            batch: org.batch,
            groups: org.groups && org.groups.length ? org.groups : (org.batch ? [org.batch] : []),
            visible: org.visible,
            status: org.status,
            failed: org.failed,
            droppedOpen: org.droppedOpen,
            scopeLabel: scopeLabelOf,
            onLoadMore: loadMoreGroups,
            onAcceptGroup: acceptOrganize,
            onRejectGroup: rejectOrganize,
            onUndoGroup: undoOrganize,
            /* 本机已接受但飞书没同步上的关系：抽屉里逐条「同步」。 */
            onRetrySync: retrySyncItem,
            onClose: closeOrganize,
            onToggleDropped: toggleDropped,
            /* 顶部的「固定 / 浮层」切换与「重新分析」 */
            docked: organizeEffective === 'dock',
            onToggleDock: toggleOrganizeDock,
            onRerun: () => runOrganize(org.scope || (org.batch && org.batch.scope) || undefined),
          })
          : null,
      ),
      menu ? h(Menu, { React, h, menu, onRun: runMenu, onClose: () => setMenu(null) }) : null,
      logoPicker
        ? h('div', { className: 'fo-logo-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': '设置项目图标', onClick: () => setLogoPicker(null) },
          h('div', { className: 'fo-logo-pop', onClick: (event) => { if (event && event.stopPropagation) event.stopPropagation() } },
            h('div', { className: 'fo-logo-head' },
              h('span', { className: 'fo-logo-title' }, `项目图标 · ${ICON_IDS.length} 个`),
              h('span', { className: 'fo-logo-sub' }, model.str(logoPicker.title)),
              /* 构建号放这里：图标选择器是这次改动的核心，能直接确认是否加载了新包 */
              h('span', { className: 'fo-logo-build', title: '当前客户端构建' }, BUILD_LABEL),
            ),
            /* 搜索：英文 id 与中文别名都能搜（1400+ 图标直接铺出来找不到） */
            h('div', { className: 'fo-logo-search' },
              h('input', {
                className: 'fo-logo-input',
                type: 'text',
                value: logoQuery,
                placeholder: logoTab === 'icon' ? '搜索图标：代码 / 数据 / cloud / chart…' : '搜索 Emoji 分类…',
                'aria-label': '搜索图标',
                autoFocus: true,
                onChange: (event) => setLogoQuery(event.currentTarget.value),
                onKeyDown: (event) => { if (event.key === 'Escape') setLogoPicker(null) },
              }),
              h('div', { className: 'fo-logo-tabs', role: 'tablist' },
                h('button', { type: 'button', className: 'fo-logo-tab', 'data-active': logoTab === 'icon' ? '1' : '0', onClick: () => setLogoTab('icon') }, '图标'),
                h('button', { type: 'button', className: 'fo-logo-tab', 'data-active': logoTab === 'emoji' ? '1' : '0', onClick: () => setLogoTab('emoji') }, 'Emoji'),
              ),
            ),
            /* 按项目名推荐：打开就给出几个「像这个项目」的图标 */
            logoTab === 'icon' && !logoQuery.trim()
              ? h('div', { className: 'fo-logo-section' },
                h('span', { className: 'fo-logo-section-title' }, '按项目名推荐'),
                h('div', { className: 'fo-logo-grid' }, suggestIcons(logoPicker.title, 8).map((id) => h('button', {
                  key: `s-${id}`,
                  type: 'button',
                  className: 'fo-logo-cell',
                  title: iconLabel(id),
                  onClick: () => { applyLogo(`lucide:${id}`) },
                }, renderIcon({ h }, `lucide:${id}`, 18)))))
              : null,
            logoTab === 'icon'
              ? h('div', { className: 'fo-logo-section' },
                h('span', { className: 'fo-logo-section-title' }, logoQuery.trim() ? '搜索结果' : '全部图标（可搜索）'),
                h('div', { className: 'fo-logo-grid fo-logo-grid-scroll' }, searchIcons(logoQuery, 240).map((id) => h('button', {
                  key: id,
                  type: 'button',
                  className: 'fo-logo-cell',
                  title: iconLabel(id),
                  onClick: () => { applyLogo(`lucide:${id}`) },
                }, renderIcon({ h }, `lucide:${id}`, 18)))))
              : h('div', { className: 'fo-logo-section fo-logo-emoji-scroll' },
                searchEmojiGroups(logoQuery).map((group) => h('div', { key: group.key, className: 'fo-logo-emoji-group' },
                  h('span', { className: 'fo-logo-section-title' }, group.label),
                  h('div', { className: 'fo-logo-emoji-grid' }, group.items.map((ch) => h('button', {
                    key: `${group.key}-${ch}`,
                    type: 'button',
                    className: 'fo-logo-emoji-cell',
                    onClick: () => { applyLogo(`emoji:${ch}`) },
                  }, ch))))),
              ),
            h('div', { className: 'fo-logo-foot' },
              h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', 'data-action': 'logo-clear', onClick: () => { applyLogo('', '') } }, '清除（回到任务编号）'),
              h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-action': 'logo-close', onClick: () => setLogoPicker(null) }, '关闭'),
            ),
          ))
        : null,
    )
  }
}

export default createOverviewPanel
