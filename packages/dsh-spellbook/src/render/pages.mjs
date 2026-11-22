/**
 * 页面渲染。
 *
 * 结构上只有两种页面：
 *   /               目录 —— 一块吸顶的操作区（查词 + 分类）+ 一张卡片网格
 *   /spell/<slug>/  条目 —— 图版在前（先看效果），机制、代码、边界在后；右侧一张元数据卡
 *
 * 页面上唯一被强调的东西仍是「机制」：描述里的 ==…== 与代码里的 @mechanism
 * 共享 data-mech，悬停任一侧会点亮另一侧 —— 排版权重 = 迁移权重。
 *
 * 目录里的筛选与检索全部作用在**同一批卡片**上（隐藏 / 重排），不另渲染一份结果列表：
 * 结果就是卡片本身，带着缩略图、带着工具，没有「搜索结果页」这个第二套界面。
 */

import { escapeHtml, renderInline, renderParagraphs, stripMechanismMarkers } from './text.mjs'
import { icon, iconUse, iconSprite, logo } from './icons.mjs'
import { CATEGORIES } from '../../shared/schema.mjs'
import { tagsByAxis, TAG_INDEX } from '../../shared/tags.mjs'

const SITE_NAME = '长这样'
const SITE_TAGLINE = '前端效果库' // 只进 <title> 与描述，页面上不显示

/**
 * 章的展示顺序：先是「组件」与「风格」——这本书是给做前端界面的人用的，
 * 打开第一眼应该看到最好看、最能直接拿走的东西；平台能力那六章在后面。
 * 这是展示顺序，不是分类定义（分类定义在 shared/schema.mjs 的 CATEGORIES）。
 */
const DISPLAY_ORDER = ['组件', '风格', '材质', '动效', '交互', '布局', '排版', '图形']

/** 每章里排在最前的几条（挑的是「一眼就想要」的）。其余按标题排。 */
const FEATURED = [
  'style-cove-dark-glass', 'glass-card-layers', 'ai-composer-bar', 'kpi-tile', 'donut-legend-linked',
  'contribution-calendar', 'priority-task-card', 'nested-nav-groups', 'water-level-bubble', 'tone-badge-mix',
  'token-mix-theming', 'style-dviz-data-first',
]

/** 这几章的开头几张卡做成两倍宽：目录有了节奏，最好看的也最大。 */
const WIDE_COUNT = { 组件: 2, 风格: 1 }

/** 查词口下拉里的「试试这样搜」。构建期会用真实索引过一遍，搜不到东西的不放（见 build.mjs）。 */
const TRY_QUERIES = ['跟着鼠标发光', '毛玻璃', '滚动驱动', '卡片悬停', '表格', '拖拽', '输入框', '骨架屏', '渐变文字']

function layout({ title, description, body, root, page }) {
  return '<!doctype html>\n' +
'<html lang="zh-CN">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>' + escapeHtml(title) + '</title>\n' +
'<meta name="description" content="' + escapeHtml(description) + '">\n' +
'<link rel="stylesheet" href="' + root + 'styles/spellbook.css">\n' +
`<!-- 明暗与版式在首屏渲染前恢复：晚一步就会先闪一下默认样子。
     被 DSH 侧边栏嵌进来时会多带两个参数：
       ?theme=dark|light  跟宿主明暗同步（优先于 localStorage，宿主说了算）
       ?embed=1           嵌入态：收起品牌名，跟宿主取色（见 site.js 的 initHostTokens）
     embed 记进 sessionStorage：站内跳转丢查询串，但「嵌在侧边栏里」这件事不该在第二页失效。 -->
<script>try{
var p=new URLSearchParams(location.search),d=document.documentElement;
var t=p.get('theme')||localStorage.getItem('spellbook:theme');
if(t)d.dataset.theme=t;
var e=p.get('embed');
if(e){try{sessionStorage.setItem('spellbook:embed','1')}catch(x){}}
else{try{e=sessionStorage.getItem('spellbook:embed')}catch(x){}}
if(e)d.dataset.embed='1';
var l=localStorage.getItem('spellbook:layout');
if(l==='list'||l==='grid')d.dataset.layout=l;
}catch(e){}</script>
</head>
` +
'<body class="' + page + '">\n' +
'<a class="skip" href="#main">跳到正文</a>\n' +
body + '\n' +
'<script type="module" src="' + root + 'site.js"></script>\n' +
'</body>\n</html>\n'
}

function brand(root) {
  return '<a class="brand" href="' + root + '">' + logo() +
    '<span class="brand-name">' + SITE_NAME + '</span></a>'
}

function searchField(placeholder) {
  return '<div class="search-field">' + icon('search', 'search-icon') +
    '<label class="visually-hidden" for="spellbook-query">搜索</label>' +
    '<input class="search-input" id="spellbook-query" type="search" name="q" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="' + escapeHtml(placeholder) + '">' +
    '<button class="search-clear" type="button" data-search-clear hidden aria-label="清空">' + icon('close') + '</button>' +
    '<kbd class="search-kbd" aria-hidden="true">/</kbd>' +
    '</div>'
}

function themeButton() {
  return '<button class="icon-btn" type="button" data-theme-toggle aria-label="切换明暗" title="切换明暗">' +
    icon('sun', 'is-sun') + icon('moon', 'is-moon') + '</button>'
}

/* ------------------------------------------------------------------ *
 * 目录
 * ------------------------------------------------------------------ */

function renderCard(entry, wide = false) {
  const meta = entry.meta
  const slug = meta.slug
  const href = 'spell/' + encodeURIComponent(slug) + '/'
  const title = escapeHtml(meta.title)
  const tags = meta.tags ?? []
  return '<article class="card' + (wide ? ' is-wide' : '') + '" data-slug="' + escapeHtml(slug) + '" data-cat="' + escapeHtml(meta.category) + '" data-tags="' + escapeHtml(tags.join(' ')) + '">\n' +
    // 缩略图只是个占位：iframe 由 site.js 在它接近视口时才挂（见 initThumbs），
    // 页面里没有任何一个在一开始就会去取的文档。
    '  <div class="card-thumb"></div>\n' +
    '  <div class="card-body">\n' +
    '    <h3 class="card-title"><a class="card-link" href="' + href + '">' + title + '</a>' + (wide ? '<span class="card-badge" title="精选">' + icon('sparkle') + '</span>' : '') + '</h3>\n' +
    '    <p class="card-when">' + escapeHtml(meta.when) + '</p>\n' +
    '    <p class="card-why" hidden></p>\n' +
    '  </div>\n' +
    '  <div class="card-tools">\n' +
    '    <button class="tool" type="button" data-peek="' + escapeHtml(slug) + '" aria-label="放大预览：' + title + '" title="放大预览">' + iconUse('expand') + '</button>\n' +
    '    <button class="tool" type="button" data-prompt="' + escapeHtml(slug) + '" data-prompt-url="' + href + 'prompt.txt" aria-label="复制咒语：' + title + '" title="复制咒语">' + iconUse('copy') + '</button>\n' +
    '  </div>\n' +
    '</article>'
}

/** 按展示顺序分章（见 DISPLAY_ORDER）；空分类不出现。章内精选在前，其余保持输入顺序。 */
export function chaptersOf(entries) {
  const rank = (slug) => { const i = FEATURED.indexOf(slug); return i === -1 ? FEATURED.length : i }
  const known = DISPLAY_ORDER.filter((c) => CATEGORIES.includes(c))
  const order = [...known, ...CATEGORIES.filter((c) => !known.includes(c))]
  return order.map((category) => ({
    category,
    items: entries
      .filter((entry) => entry.meta.category === category)
      .sort((a, b) => rank(a.meta.slug) - rank(b.meta.slug)),
  })).filter((chapter) => chapter.items.length > 0)
}

/** 常用标签：只取「场合 / 观感」两轴里条数最多的 —— 那是人会拿来找东西的词。 */
function popularTags(entries, limit = 14) {
  const counts = new Map()
  for (const { meta } of entries) {
    for (const tag of meta.tags ?? []) {
      const axis = TAG_INDEX.get(tag)
      if (axis === 'use' || axis === 'look') counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN')).slice(0, limit)
}

/** 首页最上面：一句话 + 三个数。筛选或检索时收起，把位置还给结果。 */
function hero(entries, chapters) {
  const components = chapters.find((c) => c.category === '组件')?.items.length ?? 0
  return '  <section class="hero" data-hero>\n' +
    '    <h1 class="hero-title">把好看的界面，<em>说成一句咒语</em></h1>\n' +
    '    <p class="hero-stats"><span><b>' + entries.length + '</b>条</span><span><b>' + chapters.length + '</b>章</span>' +
    (components ? '<span><b>' + components + '</b>组件</span>' : '') + '</p>\n' +
    '  </section>\n'
}

const pills = (queries) => queries.map((q) => '<button class="pill" type="button" data-q="' + escapeHtml(q) + '">' + escapeHtml(q) + '</button>').join('')

export function renderIndex(entries, { tryQueries = TRY_QUERIES } = {}) {
  const chapters = chaptersOf(entries)

  const chips = ['<button class="chip" type="button" data-cat="" aria-pressed="true"><span class="chip-name">全部</span><b class="chip-count">' + entries.length + '</b></button>']
    .concat(chapters.map((c) =>
      '<button class="chip" type="button" data-cat="' + escapeHtml(c.category) + '" aria-pressed="false">' +
      icon(c.category, 'chip-icon') + '<span class="chip-name">' + escapeHtml(c.category) + '</span><b class="chip-count">' + c.items.length + '</b></button>'))
    .join('\n      ')

  const cards = chapters.map((c) =>
    '<h2 class="group-head" data-cat="' + escapeHtml(c.category) + '" id="cat-' + escapeHtml(c.category) + '">' +
    icon(c.category, 'group-icon') +
    '<span class="group-name">' + escapeHtml(c.category) + '</span>' +
    '<span class="group-count">' + c.items.length + '</span></h2>\n' +
    c.items.map((entry, i) => renderCard(entry, i < (WIDE_COUNT[c.category] ?? 0))).join('\n')).join('\n')

  const pop = '<div class="search-pop" data-search-pop hidden>\n' +
    '      <section class="pop-section" data-recent hidden><h3 class="pop-title">最近</h3><div class="pop-chips" data-recent-list></div></section>\n' +
    '      <section class="pop-section"><h3 class="pop-title">试试</h3><div class="pop-chips">' + pills(tryQueries) + '</div></section>\n' +
    '      <section class="pop-section"><h3 class="pop-title">标签</h3><div class="pop-chips">' +
    popularTags(entries).map(([t, n]) => '<button class="pill" type="button" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '<b>' + n + '</b></button>').join('') + '</div></section>\n' +
    '    </div>'

  const body = iconSprite(['expand', 'copy']) + '\n<header class="topbar">\n' +
    '  <div class="topbar-row">\n' +
    '    ' + brand('./') + '\n' +
    '    <div class="search" role="search">\n' +
    '      ' + searchField('搜索') + '\n' +
    '    ' + pop + '\n' +
    '    </div>\n' +
    '    <div class="tools">\n' +
    '      <div class="seg" role="group" aria-label="版式">' +
    '<button type="button" data-layout="grid" aria-label="卡片" title="卡片" aria-pressed="true">' + icon('grid') + '</button>' +
    '<button type="button" data-layout="list" aria-label="列表" title="列表" aria-pressed="false">' + icon('list') + '</button></div>\n' +
    '      ' + themeButton() + '\n' +
    '    </div>\n' +
    '  </div>\n' +
    '  <nav class="chips" aria-label="分类"><div class="chips-scroll">\n      ' + chips + '\n  </div></nav>\n' +
    '</header>\n' +
    '<main id="main">\n' +
    hero(entries, chapters) +
    '  <div class="filterbar" data-filterbar hidden>\n' +
    '    <p class="filterbar-text" data-status role="status" aria-live="polite"></p>\n' +
    '    <span class="filterbar-tag" data-active-tag hidden></span>\n' +
    '    <button class="link-btn" type="button" data-reset hidden>清除</button>\n' +
    '  </div>\n' +
    '  <div class="grid" data-grid>\n' + cards + '\n  </div>\n' +
    '  <div class="empty" data-empty hidden>\n' +
    '    <p class="empty-title">无结果</p>\n' +
    '    <div class="pop-chips">' + pills(tryQueries) + '</div>\n' +
    '  </div>\n' +
    '</main>\n' +
    '<div class="toast" data-toast role="status" aria-live="polite"></div>\n' +
    '<dialog class="peek" data-peek-dialog aria-labelledby="peek-title">\n' +
    '  <div class="peek-frame">\n' +
    '    <div class="peek-head"><h2 class="peek-title" id="peek-title" data-peek-title></h2>' +
    '<button class="icon-btn" type="button" data-peek-close aria-label="关闭预览">' + icon('close') + '</button></div>\n' +
    '    <div class="peek-stage" data-peek-stage></div>\n' +
    '    <div class="peek-foot">\n' +
    // 全书共用这一份对话框：slug 与取址由 initPeek 在打开那一刻填。取址先留空、按钮先禁用 ——
    // 空着还能点的话，fetch('') 会把当前这一页当咒语送出去。
    '      <span class="peek-actions"><button class="btn is-primary" type="button" data-apply data-apply-url="" data-apply-mode="insert" disabled>应用</button>' +
    '<a class="btn" data-peek-more href="#">全文</a></span>\n' +
    '    </div>\n' +
    '  </div>\n' +
    '</dialog>'

  return layout({
    title: SITE_NAME + ' · ' + SITE_TAGLINE,
    description: '前端效果库：每条是一段描述加一段可运行的示例代码。',
    body,
    root: './',
    page: 'page-index',
  })
}

/* ------------------------------------------------------------------ *
 * 条目页
 * ------------------------------------------------------------------ */

function renderControl(param) {
  const name = escapeHtml(param.name)
  const label = escapeHtml(param.label)
  const unit = param.unit ?? ''

  if (param.type === 'range') {
    return '      <label class="control">\n' +
      '        <span class="control-label">' + label + '</span>\n' +
      '        <input type="range" min="' + param.min + '" max="' + param.max + '" step="' + (param.step ?? 1) + '" value="' + param.default + '" data-param="' + name + '" data-unit="' + escapeHtml(unit) + '">\n' +
      '        <output class="control-value">' + param.default + escapeHtml(unit) + '</output>\n' +
      '      </label>'
  }
  if (param.type === 'color') {
    return '      <label class="control control-color">\n' +
      '        <span class="control-label">' + label + '</span>\n' +
      '        <input type="color" value="' + escapeHtml(param.default) + '" data-param="' + name + '">\n' +
      '      </label>'
  }
  if (param.type === 'select') {
    return '      <label class="control control-select">\n' +
      '        <span class="control-label">' + label + '</span>\n' +
      '        <select data-param="' + name + '">\n' +
      (param.options ?? []).map((o) => '          <option value="' + escapeHtml(o) + '"' + (o === param.default ? ' selected' : '') + '>' + escapeHtml(o) + '</option>').join('\n') + '\n' +
      '        </select>\n' +
      '      </label>'
  }
  return ''
}

function renderPlate(entry) {
  const stage = entry.meta.stage ?? 'plain'
  const controls = (entry.meta.params ?? []).map(renderControl).filter(Boolean)

  return '<figure class="plate" data-stage="' + escapeHtml(stage) + '">\n' +
    '    <div class="plate-frame">\n' +
    '      <iframe class="plate-doc" src="demo.html" sandbox="allow-scripts" loading="lazy" title="' + escapeHtml(entry.meta.title) + '的实时预览"></iframe>\n' +
    '      <noscript><p class="plate-noscript">需要 JavaScript</p></noscript>\n' +
    '    </div>\n' +
    (controls.length ? '    <div class="plate-controls">\n' + controls.join('\n') + '\n      <button class="btn" type="button" data-replay>重播</button>\n    </div>\n' : '') +
    '  </figure>'
}

function renderCodeBlock(block) {
  const lines = block.lines
    .map((line, index) => {
      const content = escapeHtml(line) || '&nbsp;'
      return block.mechanismLines.includes(index)
        ? '<span class="line is-mech" data-mech>' + content + '</span>'
        : '<span class="line">' + content + '</span>'
    })
    .join('')

  return '    <div class="code-block">\n' +
    '      <div class="code-head"><span class="code-lang">' + escapeHtml(block.lang) + '</span>' +
    '<button class="btn is-ghost" type="button" data-copy>' + icon('copy') + '<span>复制</span></button></div>\n' +
    '      <pre class="code-body"><code>' + lines + '</code></pre>\n' +
    '    </div>'
}

function pagerLink(kind, entry) {
  if (!entry) return '<span class="pager-gap"></span>'
  return '<a class="pager-link is-' + kind + '" href="../' + encodeURIComponent(entry.meta.slug) + '/">' +
    (kind === 'prev' ? icon('left') : '') +
    '<span class="pager-text">' + escapeHtml(entry.meta.title) + '</span>' +
    (kind === 'next' ? icon('right') : '') + '</a>'
}

export function renderSpell(entry, { ordinal, prev = null, next = null }) {
  const meta = entry.meta
  const description = (entry.description ?? '').trim()
  const firstSentence = description.split(/(?<=。)/)[0] ?? ''

  // 标签按轴（机制 / 观感 / 场合 / 触发）排好顺序，不写轴名；每个都是回目录筛选的入口。
  const tagList = tagsByAxis(meta.tags ?? [])
    .map((group) => group.tags.map((tag) => '<a class="tag" href="../../?tag=' + encodeURIComponent(tag) + '">' + escapeHtml(tag) + '</a>').join(''))
    .join('')

  const section = (name, items) => items.length
    ? '<section class="notes">\n        <h2 class="section-head">' + name + '</h2>\n        <ul class="notes-list">\n' +
      items.map((i) => '          <li>' + renderInline(i) + '</li>').join('\n') + '\n        </ul>\n      </section>\n'
    : ''

  const body = '<header class="topbar">\n' +
    '  <div class="topbar-row">\n' +
    '    ' + brand('../../') + '\n' +
    '    <div class="search" role="search">' + searchField('搜索') + '</div>\n' +
    '    <div class="tools">' + themeButton() + '</div>\n' +
    '  </div>\n' +
    '</header>\n' +
    '<main id="main" class="spell-page">\n' +
    '  <nav class="crumbs" aria-label="位置"><a href="../../">全部咒语</a>' + icon('right', 'crumb-sep') +
    '<a href="../../?cat=' + encodeURIComponent(meta.category) + '">' + escapeHtml(meta.category) + '</a></nav>\n' +
    '  <div class="spell-layout">\n' +
    '    <article class="spell-main">\n' +
    '      <header class="spell-head">\n' +
    '        <p class="eyebrow">' + icon(meta.category, 'eyebrow-icon') + escapeHtml(meta.category) + '<span class="eyebrow-no">' + String(ordinal).padStart(3, '0') + '</span></p>\n' +
    '        <h1 class="title">' + escapeHtml(meta.title) + '</h1>\n' +
    '        <p class="when"><span class="when-label">用于</span>' + escapeHtml(meta.when) + '</p>\n' +
    // 应用按钮只在被侧边栏嵌进来时出现：自己开标签页看站时没有对话可应用，按钮留着只会骗人。
    // 显隐交给 CSS 的 :root[data-embed]，与其余嵌入态样式同一套判据。
    '        <div class="spell-actions">\n' +
    '          <button class="btn is-primary apply" type="button" data-apply="' + escapeHtml(meta.slug) + '" data-apply-url="prompt.txt" data-apply-mode="insert">应用</button>\n' +
    '          <button class="btn apply" type="button" data-apply="' + escapeHtml(meta.slug) + '" data-apply-url="prompt.txt" data-apply-mode="send">发送</button>\n' +
    '          <button class="btn" type="button" data-prompt="' + escapeHtml(meta.slug) + '" data-prompt-url="prompt.txt">' + icon('copy') + '<span>复制</span></button>\n' +
    '        </div>\n' +
    '      </header>\n\n' +
    '  ' + renderPlate(entry) + '\n\n' +
    '      <section class="desc">\n        <h2 class="section-head">机制</h2>\n' + renderParagraphs(description) + '\n      </section>\n\n' +
    '      <section class="source">\n        <h2 class="section-head">代码</h2>\n' +
    entry.code.map(renderCodeBlock).join('\n') + '\n      </section>\n\n' +
    '      ' + section('边界', entry.caveats ?? []) + section('备注', entry.notes ?? []) +
    '      <nav class="pager" aria-label="相邻咒语">' + pagerLink('prev', prev) + pagerLink('next', next) + '</nav>\n' +
    '    </article>\n' +
    '    <aside class="spell-side">\n' +
    '      <dl class="meta">\n' +
    '        <div class="meta-pair"><dt>收录</dt><dd>' + escapeHtml(meta.since) + '</dd></div>\n' +
    '        <div class="meta-pair"><dt>出处</dt><dd>' + escapeHtml(meta.source) + '</dd></div>\n' +
    '      </dl>\n' +
    '      <div class="side-tags">' + tagList + '</div>\n' +
    '    </aside>\n' +
    '  </div>\n' +
    '</main>\n' +
    '<div class="toast" data-toast role="status" aria-live="polite"></div>'

  return layout({
    title: meta.title + ' · ' + SITE_NAME,
    description: firstSentence || meta.when,
    body,
    root: '../../',
    page: 'page-spell',
  })
}

export { SITE_NAME, SITE_TAGLINE, stripMechanismMarkers, TRY_QUERIES }
