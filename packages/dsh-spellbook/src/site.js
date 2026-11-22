/**
 * 长这样 —— 页面行为
 *
 * 目录页：检索 + 分类 + 标签 + 版式，全部作用在同一批卡片上；缩略图按需挂载。
 * 条目页：图版参数、机制联动、复制、应用到对话、上一条 / 下一条。
 *
 * 加载的纪律（这个版本重写的主要原因）：
 *   首屏 HTML 里没有任何 iframe。缩略图是占位 div，接近视口才挂（一次几个、分帧挂），
 *   远离视口就卸。检索索引 1MB，等首屏画完、浏览器空闲再取；用户一碰搜索框就立刻取。
 */

import { paramValues } from './param.mjs'

const html = document.documentElement
const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
const store = {
  get(key) { try { return localStorage.getItem('spellbook:' + key) } catch { return null } },
  set(key, value) { try { localStorage.setItem('spellbook:' + key, value) } catch { /* 隐私模式写不了，不影响使用 */ } },
}

function escapeHtml(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function escapeRegExp(text) { return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&') }

/* ------------------------------------------------------------ 提示条 */

let toastTimer = 0
function toast(text) {
  const el = $('[data-toast]')
  if (!el) return
  el.textContent = text
  el.classList.add('is-on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 1800)
}

/* ------------------------------------------------------------ 明暗 */

function initTheme() {
  const toggle = $('[data-theme-toggle]')
  if (!toggle) return
  toggle.addEventListener('click', () => {
    const next = (html.dataset.theme || 'light') === 'light' ? 'dark' : 'light'
    html.dataset.theme = next
    store.set('theme', next)
  })
}

/* ------------------------------------------------ 嵌入：只跟明暗，不跟配色 */

/*
 * 刻意**不**去读宿主的 --dsw-* 令牌：这一版是「新粗野」，力量全在「黑框压在浅底上」。
 * 把底色换成宿主的深色，那圈 3px 黑框就沉进背景里，整套语言当场失效。
 * 所以只跟明暗（宿主切主题时给 data-theme），颜色始终是这本书自己的。
 */
function initEmbed() {
  if (!html.dataset.embed) return
  window.addEventListener('message', (event) => {
    const data = event.data
    if (!data || data.type !== 'dsh-spellbook-theme') return
    html.dataset.theme = data.theme === 'light' ? 'light' : 'dark'
    store.set('theme', html.dataset.theme)
  })
}

/* --------------------------------------------------------- 顶栏高度 */

function syncTopbar() {
  const bar = $('.topbar')
  if (!bar) return
  const set = () => html.style.setProperty('--topbar-h', Math.round(bar.getBoundingClientRect().height) + 'px')
  set()
  new ResizeObserver(set).observe(bar)
}

/* ------------------------------------------------------------ 检索 */

let ranker = null
let indexPromise = null
function loadSearch() {
  if (indexPromise) return indexPromise
  indexPromise = Promise.all([
    import('./rank.mjs'),
    fetch('./search-index.json', { cache: 'force-cache' }).then((r) => {
      if (!r.ok) throw new Error('索引取不到（' + r.status + '）')
      return r.json()
    }),
  ]).then(([mod, data]) => {
    ranker = { mod, index: mod.buildIndex(data.docs) }
    return ranker
  })
  indexPromise.catch(() => { indexPromise = null })
  return indexPromise
}

/** 首屏画完、浏览器空闲时悄悄取索引；用户碰搜索框则立即取。 */
function warmSearchWhenIdle() {
  const go = () => loadSearch().catch(() => {})
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200))
  const start = () => idle(go, { timeout: 4000 })
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

function markTerms(text, terms) {
  let out = escapeHtml(text)
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    if (!term) continue
    out = out.replace(new RegExp('(' + escapeRegExp(escapeHtml(term)) + ')', 'gi'), '<mark>$1</mark>')
  }
  return out
}

/* 目录状态：分类 + 标签 + 查询 三个条件合取，同步到地址栏 */
function initCatalog() {
  const grid = $('[data-grid]')
  if (!grid) return

  const input = $('.search-input')
  const clear = $('[data-search-clear]')
  const pop = $('[data-search-pop]')
  const bar = $('[data-filterbar]')
  const status = $('[data-status]', bar)
  const tagBadge = $('[data-active-tag]', bar)
  const reset = $('[data-reset]', bar)
  const empty = $('[data-empty]')
  const hero = $('[data-hero]')
  const chips = $$('.chip')
  const cards = $$('.card', grid)
  const heads = $$('.group-head', grid)

  const params = new URLSearchParams(location.search)
  const state = { q: params.get('q') || '', cat: params.get('cat') || '', tag: params.get('tag') || '' }
  input.value = state.q

  let renderToken = 0

  const writeUrl = () => {
    const next = new URLSearchParams()
    for (const key of ['q', 'cat', 'tag']) if (state[key]) next.set(key, state[key])
    const qs = next.toString()
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''))
  }

  const recent = () => { try { return JSON.parse(store.get('recent') || '[]') } catch { return [] } }
  const remember = (q) => {
    if (!q || q.length < 2) return
    store.set('recent', JSON.stringify([q, ...recent().filter((x) => x !== q)].slice(0, 6)))
  }
  const paintRecent = () => {
    const list = recent()
    $('[data-recent]', pop).hidden = !list.length
    $('[data-recent-list]', pop).innerHTML = list.map((q) => '<button class="pill" type="button" data-q="' + escapeHtml(q) + '">' + escapeHtml(q) + '</button>').join('')
  }

  const apply = () => {
    const token = ++renderToken
    clear.hidden = !state.q
    for (const chip of chips) chip.setAttribute('aria-pressed', String((chip.dataset.cat || '') === state.cat))

    const searching = state.q.trim().length > 0
    if (searching && !ranker) {
      status.textContent = '…'
      bar.hidden = false
      loadSearch().then(() => token === renderToken && apply()).catch(() => { status.textContent = '搜索不可用' })
      return
    }

    let terms = []
    let hitMap = null
    if (searching) {
      const hits = ranker.mod.rank(ranker.index, state.q.trim(), { limit: 80 })
      terms = ranker.mod.units ? ranker.mod.units(state.q.trim()).map((u) => u.join('')) : []
      hitMap = new Map(hits.map((hit, i) => [hit.slug, { rank: i, why: hit.why }]))
    }

    const filtering = searching || !!state.tag
    let shown = 0
    for (const card of cards) {
      let ok = !state.cat || card.dataset.cat === state.cat
      if (ok && state.tag) ok = card.dataset.tags.split(' ').includes(state.tag)
      if (ok && searching) ok = hitMap.has(card.dataset.slug)
      card.hidden = !ok

      const why = $('.card-why', card)
      const title = $('.card-title a', card)
      const when = $('.card-when', card)
      // 标题与场合的原文放在 data-raw 里：描红每次都从原文来，不会越描越叠
      title.dataset.raw ??= title.textContent
      when.dataset.raw ??= when.textContent
      if (ok && searching) {
        const hit = hitMap.get(card.dataset.slug)
        card.style.order = String(hit.rank + 1)
        title.innerHTML = markTerms(title.dataset.raw, terms)
        when.innerHTML = markTerms(when.dataset.raw, terms)
        if (hit.why) { why.innerHTML = '<b>' + escapeHtml(hit.why.label) + '</b>' + markTerms(hit.why.text, terms); why.hidden = false } else why.hidden = true
      } else {
        card.style.order = ''
        title.textContent = title.dataset.raw
        when.textContent = when.dataset.raw
        why.hidden = true
      }
      if (ok) shown++
    }
    // 章标题：只在「没有检索 / 标签筛选」时出现；选了某一章就只留那一章的
    for (const head of heads) head.hidden = filtering || (!!state.cat && head.dataset.cat !== state.cat)

    const active = !!(state.q || state.cat || state.tag)
    // 检索 / 标签筛选时卡片按相关度排，两倍宽的「精选」就不该再占位；首页的介绍也让位
    grid.toggleAttribute('data-filtering', filtering)
    if (hero) hero.hidden = active
    bar.hidden = !active
    if (active) {
      status.textContent = shown + ' 条'
      tagBadge.hidden = !state.tag
      tagBadge.textContent = state.tag
      reset.hidden = false
    }
    empty.hidden = shown > 0
    grid.hidden = shown === 0
    writeUrl()
    document.dispatchEvent(new Event('spellbook:layout'))
  }

  const firstCard = () => $('.card:not([hidden]) .card-link', grid)

  let timer = 0
  input.addEventListener('input', () => {
    state.q = input.value
    pop.hidden = !!input.value
    clearTimeout(timer)
    timer = setTimeout(apply, 70)
  })
  input.addEventListener('focus', () => { loadSearch().catch(() => {}); if (!input.value) { paintRecent(); pop.hidden = false } })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { remember(input.value.trim()); pop.hidden = true; firstCard()?.focus() }
    else if (e.key === 'Escape') {
      if (input.value) { input.value = ''; state.q = ''; apply(); paintRecent(); pop.hidden = false } else { input.blur(); pop.hidden = true }
    } else if (e.key === 'ArrowDown') { e.preventDefault(); pop.hidden = true; firstCard()?.focus() }
  })
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.search')) pop.hidden = true })

  clear.addEventListener('click', () => { input.value = ''; state.q = ''; apply(); input.focus() })

  // 弹层里的词与标签、卡片上的标签：点一下就筛
  document.addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]')
    const tag = e.target.closest('[data-tag]')
    if (q) { input.value = state.q = q.dataset.q; remember(state.q); pop.hidden = true; apply(); window.scrollTo({ top: 0 }) }
    else if (tag) { state.tag = tag.dataset.tag; pop.hidden = true; apply(); window.scrollTo({ top: 0 }) }
  })
  for (const chip of chips) chip.addEventListener('click', () => { state.cat = chip.dataset.cat || ''; apply(); window.scrollTo({ top: 0 }) })
  reset.addEventListener('click', () => { input.value = ''; Object.assign(state, { q: '', cat: '', tag: '' }); apply() })

  // 版式
  const layoutBtns = $$('[data-layout]')
  const paintLayout = () => {
    const cur = html.dataset.layout || 'grid'
    for (const b of layoutBtns) b.setAttribute('aria-pressed', String(b.dataset.layout === cur))
  }
  for (const b of layoutBtns) b.addEventListener('click', () => {
    html.dataset.layout = b.dataset.layout
    store.set('layout', b.dataset.layout)
    paintLayout()
    document.dispatchEvent(new Event('spellbook:layout'))
  })
  paintLayout()

  if (state.q || state.cat || state.tag) apply()
  initThumbs(grid)
}

/* --------------------------------------------------- 缩略图：按需挂载 */

/**
 * 首屏里没有任何 iframe。缩略图是占位，接近视口才挂、远离就卸；一次最多挂几个、分帧挂，
 * 不让主线程被一口气 N 个文档解析卡住。
 *
 * 不用 IntersectionObserver：侧边栏里这页是嵌在 iframe 里的，隐式根算的是宿主窗口的视口，
 * 不是侧边栏那块滚动区（实测只剩贴着视口的三四个有预览）。所以直接按 innerHeight 算。
 */
function initThumbs(grid) {
  const thumbs = $$('.card-thumb', grid)
  const NEAR = 1.2      // 视口上下各多留 1.2 屏：滚到跟前时早就画好了
  const FAR = 3         // 离开 3 屏以外才卸，避免来回滚动反复挂卸
  const PER_TICK = 3    // 每一拍最多新挂几个
  let scheduled = false

  const mount = (thumb) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.tabIndex = -1
    frame.title = ''
    frame.addEventListener('load', () => thumb.classList.add('is-ready'), { once: true })
    frame.src = 'spell/' + encodeURIComponent(thumb.parentElement.dataset.slug) + '/demo.html'
    thumb.appendChild(frame)
  }
  const unmount = (thumb) => {
    thumb.replaceChildren()
    thumb.classList.remove('is-ready')
  }

  const sync = () => {
    scheduled = false
    const h = window.innerHeight || 1
    const wanted = []
    for (const thumb of thumbs) {
      const has = thumb.firstElementChild
      if (thumb.parentElement.hidden || !thumb.offsetWidth) { if (has) unmount(thumb); continue }
      const r = thumb.getBoundingClientRect()
      const dist = r.bottom < 0 ? -r.bottom : r.top > h ? r.top - h : 0
      if (has) { if (dist > h * FAR) unmount(thumb) } else if (dist <= h * NEAR) wanted.push([dist, thumb])
    }
    wanted.sort((a, b) => a[0] - b[0])
    wanted.slice(0, PER_TICK).forEach(([, thumb]) => mount(thumb))
    if (wanted.length > PER_TICK) schedule(90)
  }
  const schedule = (delay = 0) => {
    if (scheduled) return
    scheduled = true
    // 不用 rAF：标签页在后台时 rAF 不跑，缩略图就永远不挂；定时器照常
    setTimeout(sync, delay || 16)
  }

  // 缩放比跟着各自缩略图的宽度走：400×250 的真预览按比例缩进框里（两倍宽的精选卡比别的宽）
  const onLayout = () => {
    for (const t of thumbs) if (t.offsetWidth) t.style.setProperty('--s', String(t.offsetWidth / 400))
    schedule()
  }
  addEventListener('scroll', () => schedule(), { passive: true })
  addEventListener('resize', onLayout, { passive: true })
  document.addEventListener('spellbook:layout', onLayout)
  new ResizeObserver(onLayout).observe(grid)
  onLayout()
}

/* ------------------------------------------------------------ 抄录 */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

/** 复制代码块：每行一个 .line，用换行拼回原文，不带行号。 */
function initCopy() {
  for (const button of $$('[data-copy]')) {
    const code = button.closest('.code-block')?.querySelector('.code-body code')
    button.addEventListener('click', async () => {
      if (!code) return
      const lines = $$('.line', code)
      const done = await copyText((lines.length ? lines.map((l) => l.textContent) : [code.textContent]).join('\n'))
      const label = $('span', button)
      const idle = label.textContent
      label.textContent = done ? '已复制' : '失败'
      button.classList.toggle('is-done', done)
      setTimeout(() => { label.textContent = idle; button.classList.remove('is-done') }, 1400)
    })
  }
}

/** 复制整条咒语（prompt.txt）。取哪个地址由模板写在 data-prompt-url 上，不在这里按 slug 拼 —— 目录页与条目页深度不同。 */
function initPromptCopy() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-prompt]')
    if (!button || button.disabled) return
    button.disabled = true
    try {
      const response = await fetch(button.dataset.promptUrl, { cache: 'force-cache' })
      if (!response.ok) throw new Error(String(response.status))
      const done = await copyText(await response.text())
      toast(done ? '已复制' : '复制失败')
      button.classList.toggle('is-done', done)
    } catch {
      toast('取不到')
    }
    setTimeout(() => { button.disabled = false; button.classList.remove('is-done') }, 1400)
  })
}

/* ------------------------------------------------------ 应用到对话 */

/**
 * 页面嵌在侧边栏 iframe 里，自己够不着对话输入框，只有宿主能。所以「应用」是一次 postMessage：
 *   站点 → 宿主 {type:'spellbook:apply', requestId, prompt, mode}
 *   宿主 → 站点 {type:'spellbook:apply-result', requestId, ok, reason?}
 * 回执是这条路上的正常分支（草稿版本变了、正在提交、没有会话），超时也算失败。
 * 失败时把正文放进剪贴板：最坏的结果是「正文没了」，而它此刻就在手里。
 */
const APPLY_TIMEOUT_MS = 4000
const APPLY_FAIL_TEXT = { timeout: '无响应', 'no-sink': '无会话', rejected: '被拒', 'bad-request': '被拒', fetch: '取不到', 'no-url': '无地址' }
let applySeq = 0
const pendingApplies = new Map()

function requestApply(prompt, mode) {
  return new Promise((resolve) => {
    const requestId = 'sp-' + Date.now().toString(36) + '-' + ++applySeq
    const timer = setTimeout(() => { pendingApplies.delete(requestId); resolve({ ok: false, reason: 'timeout' }) }, APPLY_TIMEOUT_MS)
    pendingApplies.set(requestId, (result) => { clearTimeout(timer); pendingApplies.delete(requestId); resolve(result) })
    // targetOrigin 写明确的原点：宿主与这页同源，用 '*' 等于把咒语广播给任何嵌了这一页的人
    window.parent.postMessage({ type: 'spellbook:apply', requestId, prompt, mode }, window.location.origin)
  })
}

function initApply() {
  if (!html.dataset.embed || window.parent === window) return
  window.addEventListener('message', (event) => {
    const data = event.data
    if (!data || data.type !== 'spellbook:apply-result') return
    pendingApplies.get(data.requestId)?.({ ok: data.ok === true, reason: typeof data.reason === 'string' ? data.reason : undefined })
  })

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-apply]')
    if (!button || button.disabled) return
    const mode = button.dataset.applyMode === 'send' ? 'send' : 'insert'
    const idle = button.dataset.applyIdle || (button.dataset.applyIdle = button.textContent)
    button.disabled = true
    button.textContent = '…'
    button.classList.remove('is-done', 'is-failed')

    let prompt = ''
    let result
    if (!button.dataset.applyUrl) {
      // 取址空着就别 fetch：fetch('') 会把当前这一页（HTML）当咒语送出去，而且是 200、不报错
      result = { ok: false, reason: 'no-url' }
    } else {
      try {
        const response = await fetch(button.dataset.applyUrl, { cache: 'force-cache' })
        if (!response.ok) throw new Error(String(response.status))
        prompt = await response.text()
        result = await requestApply(prompt, mode)
      } catch { result = { ok: false, reason: 'fetch' } }
    }

    let label
    if (result.ok) label = mode === 'send' ? '已发送' : '已应用'
    else {
      const why = APPLY_FAIL_TEXT[result.reason] || '失败'
      const rescued = prompt !== '' && (await copyText(prompt))
      label = rescued ? why + ' · 已复制' : why
    }
    button.textContent = label
    button.classList.toggle('is-done', result.ok)
    button.classList.toggle('is-failed', !result.ok)
    button.disabled = false
    setTimeout(() => { button.textContent = idle; button.classList.remove('is-done', 'is-failed') }, result.ok ? 1600 : 2600)
  })
}

/* ------------------------------------------------------------ 放大预览 */

function initPeek() {
  const dialog = $('[data-peek-dialog]')
  if (!dialog) return
  const stage = $('[data-peek-stage]', dialog)
  const title = $('[data-peek-title]', dialog)
  const more = $('[data-peek-more]', dialog)
  const apply = $('[data-apply]', dialog)

  const close = () => { stage.replaceChildren(); if (dialog.open) dialog.close() }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-peek]')
    if (!trigger) return
    event.preventDefault()
    const slug = trigger.dataset.peek
    const card = trigger.closest('.card')
    const base = 'spell/' + encodeURIComponent(slug) + '/'
    title.textContent = $('.card-title a', card)?.dataset.raw ?? $('.card-title a', card)?.textContent ?? slug
    more.href = base
    // 全书共用这一个对话框：每次打开都要重设应用按钮，并清掉上一条留下的「已放进 / 被拒」状态
    if (apply) {
      apply.dataset.apply = slug
      apply.dataset.applyUrl = base + 'prompt.txt'
      apply.disabled = false
      apply.classList.remove('is-done', 'is-failed')
      apply.textContent = apply.dataset.applyIdle || '应用'
      apply.hidden = !html.dataset.embed
    }
    const frame = document.createElement('iframe')
    frame.className = 'peek-doc'
    frame.src = base + 'demo.html'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.title = '放大预览：' + title.textContent
    stage.replaceChildren(frame)
    dialog.showModal()
  })

  $('[data-peek-close]', dialog)?.addEventListener('click', close)
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close() })
  dialog.addEventListener('close', () => stage.replaceChildren())
}

/* ------------------------------------------------------------ 条目页 */

function initPlate() {
  const plate = $('.plate')
  const doc = plate && $('.plate-doc', plate)
  if (!doc) return
  const inputs = $$('[data-param]', plate)
  const params = inputs.map((i) => ({ name: i.dataset.param, type: i.type === 'range' ? 'range' : 'text', unit: i.dataset.unit || undefined }))
  const values = () => {
    const raw = {}
    for (const i of inputs) raw[i.dataset.param] = i.type === 'range' ? Number(i.value) : i.value
    return paramValues(params, raw)
  }
  const post = (message) => doc.contentWindow?.postMessage(message, '*')
  const push = () => post({ type: 'spellbook:params', values: values() })

  for (const input of inputs) {
    input.addEventListener('input', () => {
      const out = input.parentElement?.querySelector('.control-value')
      if (out) out.textContent = input.value + (input.dataset.unit ?? '')
      push()
    })
  }
  // iframe 没加载完就发消息会丢，所以等 load 之后再推一次
  doc.addEventListener('load', push)
  if (doc.contentDocument?.readyState === 'complete') push()
  $('[data-replay]', plate)?.addEventListener('click', () => { post({ type: 'spellbook:replay' }); setTimeout(push, 60) })
}

/** 描述里的机制短语 ↔ 代码里的机制行：悬停任一侧点亮另一侧。排版权重 = 迁移权重。 */
function initMechanismLink() {
  const marks = $$('[data-mech]')
  if (marks.length < 2) return
  const light = (on) => { for (const m of marks) m.classList.toggle('is-lit', on) }
  for (const m of marks) {
    m.addEventListener('mouseenter', () => light(true))
    m.addEventListener('mouseleave', () => light(false))
  }
}

const isTyping = () => {
  const a = document.activeElement
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)
}

/** 条目页的查词口：回车带着词回目录；左右方向键翻页。 */
function initSpellSearch() {
  if (!document.body.classList.contains('page-spell')) return
  const input = $('.search-input')
  const clear = $('[data-search-clear]')
  input.addEventListener('input', () => { clear.hidden = !input.value })
  clear.addEventListener('click', () => { input.value = ''; clear.hidden = true; input.focus() })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) location.href = '../../?q=' + encodeURIComponent(input.value.trim())
    if (e.key === 'Escape') input.blur()
  })
  addEventListener('keydown', (e) => {
    if (isTyping() || e.metaKey || e.ctrlKey || e.altKey) return
    const link = e.key === 'ArrowLeft' ? $('.pager-link.is-prev') : e.key === 'ArrowRight' ? $('.pager-link.is-next') : null
    if (link) location.href = link.href
  })
}

/** 「/」或 ⌘K 直接落到查词口。 */
function initHotkeys() {
  const input = $('.search-input')
  if (!input) return
  addEventListener('keydown', (e) => {
    if ((e.key === '/' && !isTyping()) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault()
      input.focus()
      input.select()
    }
  })
}

initTheme()
initEmbed()
syncTopbar()
initCatalog()
initCopy()
initPromptCopy()
initApply()
initPeek()
initPlate()
initMechanismLink()
initSpellSearch()
initHotkeys()
warmSearchWhenIdle()
