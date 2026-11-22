/**
 * 风格样张 —— 十种视觉方向，同一套结构、同一份内容。
 *
 * 每张样张是一页**独立的静态文档**：先载入站点的 spellbook.css（结构全在那儿），
 * 再叠一层 skins/<名字>.css（只改令牌与少数结构性规则）。所以看到的不是「另画的
 * 设计稿」，而是这本书换一层皮之后真正的样子；挑中哪一张，把那层皮并进 spellbook.css 即可。
 *
 * 样张页里的缩略图仍然是真在跑的 demo，只是由一小段内联脚本按宽度算缩放比 ——
 * 它们不跑 site.js，因为样张不需要检索与筛选。
 */

import { icon, iconUse, iconSprite, logo } from './icons.mjs'

export const SKINS = [
  { slug: "01-paper-book", name: "装帧书", note: "拟物 · 羊皮纸、皮革书脊、书沟阴影、图版装裱、丝带" },
  { slug: "11-paper-book-cool", name: "装帧书 · 冷调", note: "同一本书换墨色：冷灰绿纸、墨绿皮革、黄铜金" },
  { slug: "12-paper-book-night", name: "装帧书 · 夜读", note: "同一本书熄了灯：深棕黑纸、烫金标题、暖白墨" },
  { slug: "02-soft-neu", name: "柔和拟态", note: "同色系凸起，无边框，光线从左上角来" },
  { slug: "03-swiss", name: "瑞士国际", note: "黑白加一个红，粗线、零圆角、超大字" },
  { slug: "04-brutal", name: "新粗野", note: "粗黑描边、硬投影、荧光橙" },
  { slug: "05-terminal", name: "终端", note: "纯黑屏、磷光绿、等宽字体、扫描线" },
  { slug: "06-editorial", name: "杂志编辑", note: "衬线大标题、双线栏头、发丝分隔" },
  { slug: "07-wabi", name: "侘寂", note: "米白与墨，极细线，大留白" },
  { slug: "08-cyber", name: "霓虹赛博", note: "深空黑，青与洋红的描边发光" },
  { slug: "09-linear", name: "产品深色", note: "近乎无色，一线品牌紫，精确安静" },
  { slug: "10-bento", name: "明亮 Bento", note: "奶油底、大圆角、彩色块" },
]

const CARD = (slug, title, when, wide) => '<article class="card' + (wide ? ' is-wide' : '') + '">' +
  '<div class="card-thumb"><iframe src="../spell/' + slug + '/demo.html" sandbox="allow-scripts" tabindex="-1" title="" onload="this.parentElement.classList.add(\'is-ready\')"></iframe></div>' +
  '<div class="card-body"><h3 class="card-title"><a class="card-link" href="#">' + title + '</a>' +
  (wide ? '<span class="card-badge" title="精选">' + iconUse('sparkle') + '</span>' : '') + '</h3>' +
  '<p class="card-when">' + when + '</p></div></article>'

/** 一张样张：顶栏 + 开场 + 三张卡 + 一段条目页的排版（标题、机制、代码）。 */
export function previewPage(skin) {
  const chips = ['全部', '组件', '风格', '材质', '动效', '交互', '布局', '排版', '图形']
    .map((name, i) => '<button class="chip" type="button" aria-pressed="' + (i === 0) + '"><span class="chip-name">' + name + '</span>' +
      (i === 0 ? '<b class="chip-count">360</b>' : '') + '</button>').join('')

  return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + skin.name + ' · 风格样张</title>\n' +
    '<link rel="stylesheet" href="../styles/spellbook.css">\n' +
    '<link rel="stylesheet" href="./' + skin.slug + '.css">\n' +
    '<style>.card-thumb iframe{opacity:1} .pv-note{max-width:72ch}</style>\n' +
    '</head>\n<body class="page-index pv">\n' +
    '<header class="topbar"><div class="topbar-row">' +
    '<a class="brand" href="#">' + logo() + '<span class="brand-name">长这样</span></a>' +
    '<div class="search"><div class="search-field">' + icon('search', 'search-icon') +
    '<input class="search-input" placeholder="搜索" readonly><kbd class="search-kbd">/</kbd></div></div>' +
    '<div class="tools"><div class="seg"><button aria-pressed="true">' + icon('grid') + '</button><button aria-pressed="false">' + icon('list') + '</button></div>' +
    '<button class="icon-btn">' + icon('moon') + '</button></div>' +
    '</div><nav class="chips"><div class="chips-scroll">' + chips + '</div></nav></header>\n' +
    '<main>' +
    '<section class="hero"><h1 class="hero-title">把好看的界面，<em>说成一句咒语</em></h1>' +
    '<p class="hero-stats"><span><b>360</b>条</span><span><b>8</b>章</span><span><b>20</b>组件</span></p></section>' +
    '<div class="grid">' +
    '<h2 class="group-head">' + icon('组件', 'group-icon') + '<span class="group-name">组件</span><span class="group-count">20</span></h2>' +
    CARD('glass-card-layers', '玻璃卡片的透明度分层', '面板里几层内容想要玻璃感，又不想维护一整套灰阶色板', true) +
    CARD('kpi-tile', '指标卡：大数字、色调与进度', '看板顶部一排核心指标，位数不一却要对齐', false) +
    CARD('donut-legend-linked', '环形图与图例的悬停联动', '几个类别的占比，图例要和扇区对应', false) +
    '</div>' +
    '<section class="sample"><h2 class="section-head">条目页</h2>' +
    '<p class="pv-note">机制是 <mark class="mech" data-mech>层级用透明度表达，而不是用灰阶</mark>：卡片面 = 层 1 的颜色 × 92%，边线 = 边框色 × 65%。</p>' +
    '<div class="code-block"><div class="code-head"><span class="code-lang">css</span>' +
    '<button class="btn is-ghost" type="button">' + icon('copy') + '<span>复制</span></button></div>' +
    '<pre class="code-body"><code><span class="line">.card {</span><span class="line is-mech" data-mech>  background: color-mix(in oklab, var(--layer) 92%, transparent);</span><span class="line">  border: 1px solid color-mix(in oklab, var(--line) 65%, transparent);</span><span class="line">}</span></code></pre></div>' +
    '</section></main>\n' +
    iconSprite(['expand', 'copy', 'sparkle']) +
    '<script>function fit(){for(var t of document.querySelectorAll(".card-thumb")){var w=t.offsetWidth;if(w)t.style.setProperty("--s",(w/400).toFixed(3))}}' +
    'addEventListener("resize",fit);addEventListener("load",fit);fit();</script>\n' +
    '</body>\n</html>\n'
}

/**
 * 样张总览：十张并排摊开，每张一个大面板 + 一句说明，点标题在新标签页里单独看。
 * 这一页刻意用中性灰，不带任何风格倾向 —— 它只是看片台，不该参与评比。
 */
const GALLERY_CSS = ':root{color-scheme:dark}' +
  'body{margin:0;background:#0b0b0d;color:#e8e8ea;font:400 14px/1.6 system-ui,"PingFang SC",sans-serif}' +
  'header.top{position:sticky;top:0;z-index:9;display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 18px;padding:18px 28px;background:rgb(11 11 13/.92);backdrop-filter:blur(12px);border-bottom:1px solid #232327}' +
  'header.top h1{margin:0;font-size:16px;font-weight:600;letter-spacing:.02em}' +
  'header.top nav{display:flex;flex-wrap:wrap;gap:4px}' +
  'header.top a{color:#9a9aa2;text-decoration:none;font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid #26262b}' +
  'header.top a:hover{color:#fff;border-color:#4a4a52}' +
  'main{max-width:1600px;margin:0 auto;padding:24px 28px 80px;display:grid;gap:26px}' +
  '.panel{border:1px solid #232327;border-radius:14px;overflow:hidden;background:#111114;scroll-margin-top:90px}' +
  '.panel-head{display:flex;align-items:baseline;gap:14px;padding:14px 18px}' +
  '.panel-head .no{color:#5a5a63;font:500 12px/1 ui-monospace,monospace}' +
  '.panel-head h2{margin:0;font-size:15px;font-weight:600}' +
  '.panel-head h2 a{color:inherit;text-decoration:none}' +
  '.panel-head h2 a:hover{color:#fff;text-decoration:underline;text-underline-offset:3px}' +
  '.panel-head p{margin:0;color:#8c8c95;font-size:13px}' +
  '.panel iframe{display:block;width:100%;height:820px;border:0;border-top:1px solid #232327;background:#000}' +
  '@media(max-width:760px){main{padding:16px}.panel iframe{height:520px}}'

export function galleryPage(skins) {
  const panels = skins.map((skin, i) =>
    '<section class="panel" id="p' + i + '">' +
    '<header class="panel-head"><span class="no">' + String(i + 1).padStart(2, '0') + '</span>' +
    '<h2><a href="./' + skin.slug + '.html" target="_blank" rel="noopener">' + skin.name + '</a></h2>' +
    '<p>' + skin.note + '</p></header>' +
    '<iframe src="./' + skin.slug + '.html" loading="lazy" title="' + skin.name + '"></iframe>' +
    '</section>').join('\n')

  const nav = skins.map((s, i) => '<a href="#p' + i + '">' + String(i + 1).padStart(2, '0') + ' ' + s.name + '</a>').join('')

  return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>风格样张 · Spell Book</title>\n' +
    '<style>' + GALLERY_CSS + '</style>\n</head>\n<body>\n' +
    '<header class="top"><h1>风格样张 · 十种</h1><nav>' + nav + '</nav></header>\n' +
    '<main>\n' + panels + '\n</main>\n</body>\n</html>\n'
}
