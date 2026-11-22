/**
 * 页面结构与加载纪律。
 *
 * 这一份守两类东西：
 *   1. 加载：首页首屏 HTML 里不许有任何 iframe（缩略图按需挂载），目录里的每张卡都是占位；
 *   2. 结构：分章顺序、对开页的骨架、吸顶顶栏、[hidden] 兜底、两套主题。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { chaptersOf, renderIndex, renderSpell } from '../src/render/pages.mjs'
import { CATEGORIES } from '../shared/schema.mjs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const CSS = read('../src/styles/spellbook.css')
const JS = read('../src/site.js')

function entry(meta = {}, extra = {}) {
  return {
    meta: {
      title: '无名',
      slug: 'wuming',
      category: '材质',
      since: '2025-09',
      source: '自行实现',
      when: '想用的时候',
      stage: 'plain',
      tags: ['blur', '卡片', '玻璃'],
      ...meta,
    },
    description: '机制是 ==某个东西==。',
    code: [{ lang: 'css', lines: ['.a {}'], mechanismLines: [0] }],
    notes: [],
    mechanisms: ['某个东西'],
    ...extra,
  }
}

const count = (html, re) => (html.match(re) ?? []).length

/* ------------------------------------------------------------ 分章 */

test('组件与风格排在最前，其余章按原顺序', () => {
  const chapters = chaptersOf([
    entry({ category: '交互', slug: 'a' }), entry({ category: '材质', slug: 'b' }),
    entry({ category: '风格', slug: 'c' }), entry({ category: '组件', slug: 'd' }),
  ])
  assert.deepEqual(chapters.map((c) => c.category), ['组件', '风格', '材质', '交互'])
  // 展示顺序里的每一章都必须是合法分类，否则会悄悄丢章
  assert.ok(chapters.every((c) => CATEGORIES.includes(c.category)))
})

test('每一个分类都会出现在目录里，不因展示顺序漏章', () => {
  const all = CATEGORIES.map((category, i) => entry({ category, slug: 's' + i }))
  assert.equal(chaptersOf(all).length, CATEGORIES.length)
})

test('章内精选在前', () => {
  const chapters = chaptersOf([entry({ category: '组件', slug: 'zzz' }), entry({ category: '组件', slug: 'kpi-tile' })])
  assert.deepEqual(chapters[0].items.map((e) => e.meta.slug), ['kpi-tile', 'zzz'])
})

test('组件章开头两张、风格章开头一张是两倍宽的精选卡', () => {
  const html = renderIndex([
    entry({ category: '组件', slug: 'kpi-tile' }), entry({ category: '组件', slug: 'glass-card-layers' }), entry({ category: '组件', slug: 'plain-one' }),
    entry({ category: '风格', slug: 'style-cove-dark-glass' }), entry({ category: '风格', slug: 'token-mix-theming' }),
  ])
  assert.equal(count(html, /class="card is-wide"/g), 3)
  assert.equal(count(html, /card-badge/g), 3)
})

test('首页有开场介绍，带真实数字', () => {
  const html = renderIndex([entry({ category: '组件', slug: 'a' }), entry({ slug: 'b' })])
  assert.match(html, /data-hero/)
  assert.match(html, /<b>2<\/b>条/)
})

test('空分类不出现', () => {
  assert.equal(chaptersOf([entry({ category: '材质' })]).length, 1)
})

/* ------------------------------------------------------------ 加载 */

test('首屏 HTML 里一个 iframe 都没有 —— 缩略图是占位，按需挂载', () => {
  const html = renderIndex([entry({ slug: 'a' }), entry({ slug: 'b', category: '动效' })])
  // 放大预览的 dialog 里没有 iframe（打开时才创建），卡片里也没有
  assert.equal(count(html, /<iframe/g), 0, '首屏出现了 iframe：每一个都会在页面加载时去取一份文档')
  assert.equal(count(html, /class="card-thumb"/g), 2)
})

test('站点脚本按自己的算法挂缩略图，不用 IntersectionObserver', () => {
  // 侧边栏里这页嵌在 iframe 里，隐式根算的是宿主窗口的视口；显式取根又会整页都算相交
  assert.doesNotMatch(JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /IntersectionObserver/)
  assert.match(JS, /PER_TICK/, '挂载要限速，一拍只挂几个')
})

test('缩略图与图版一样走沙箱', () => {
  assert.match(JS, /setAttribute\('sandbox', 'allow-scripts'\)/)
  assert.doesNotMatch(JS, /allow-same-origin/)
})

test('检索索引不在首屏同步取：由空闲或碰搜索框触发', () => {
  assert.match(JS, /requestIdleCallback/)
  assert.match(JS, /addEventListener\('focus'/)
})

/* ------------------------------------------------------------ 目录 */

test('每张卡：标题是链接，放大与复制是它的兄弟，不嵌进 <a>', () => {
  const html = renderIndex([entry()])
  assert.match(html, /<h3 class="card-title"><a class="card-link" href="spell\/wuming\/">无名<\/a><\/h3>/)
  // 按钮不能塞进 <a>（无效 HTML，点工具会连带跳页）
  assert.doesNotMatch(html, /<a [^>]*>(?:(?!<\/a>)[\s\S])*<button/)
  assert.match(html, /data-peek="wuming"/)
  assert.match(html, /data-prompt="wuming"[^>]*data-prompt-url="spell\/wuming\/prompt\.txt"/)
})

test('分类筹码带数量，「全部」排第一', () => {
  const html = renderIndex([entry({ slug: 'a' }), entry({ slug: 'b' }), entry({ slug: 'c', category: '动效' })])
  assert.match(html, /<button class="chip"[^>]*data-cat=""[^>]*aria-pressed="true"><span class="chip-name">全部<\/span><b class="chip-count">3<\/b>/)
  assert.match(html, /data-cat="材质"[^>]*>[\s\S]*?<b class="chip-count">2<\/b>/)
})

test('查词口有可访问名，且弹层默认收着', () => {
  const html = renderIndex([entry()])
  assert.match(html, /<label class="visually-hidden" for="spellbook-query">搜索<\/label>/)
  assert.match(html, /data-search-pop hidden/)
  assert.match(html, /data-empty hidden/)
})

test('放大预览用的 dialog 只出现一次，且默认没内容', () => {
  const html = renderIndex([entry({ slug: 'a' }), entry({ slug: 'b' })])
  assert.equal(count(html, /<dialog/g), 1)
  assert.match(html, /<div class="peek-stage" data-peek-stage><\/div>/)
  // 取址先留空、按钮先禁用：空着还能点的话 fetch('') 会把当前页当咒语送出去
  assert.match(html, /data-apply-url="" data-apply-mode="insert" disabled/)
})

test('常用标签只取「场合 / 观感」轴，不拿机制词凑数', () => {
  const html = renderIndex([entry()])
  const pop = html.match(/<h3 class="pop-title">标签[\s\S]*?<\/section>/)?.[0] ?? ''
  assert.match(pop, /data-tag="卡片"/)
  assert.match(pop, /data-tag="玻璃"/)
  assert.doesNotMatch(pop, /data-tag="blur"/)
})

test('首屏顶栏里没有编号、罗马数字这类旧书的装置', () => {
  const html = renderIndex([entry()])
  assert.doesNotMatch(html, /row-numeral|chapter-nav|tabula/)
})

/* ------------------------------------------------------------ 条目页 */

function spellHtml(extra = {}) {
  return renderSpell(entry({}, extra), { ordinal: 2, total: 9, prev: entry({ slug: 'p', title: '前一条' }), next: entry({ slug: 'n', title: '后一条' }) })
}

test('条目页只有一个 h1，就是条目名', () => {
  const html = spellHtml()
  assert.equal(count(html, /<h1/g), 1)
  assert.match(html, /<h1 class="title">无名<\/h1>/)
})

test('图版在机制与代码之前 —— 先看效果，再读为什么', () => {
  const html = spellHtml()
  const plate = html.indexOf('class="plate"')
  assert.ok(plate > 0)
  assert.ok(plate < html.indexOf('class="desc"'))
  assert.ok(html.indexOf('class="desc"') < html.indexOf('class="source"'))
})

test('图版 iframe 走沙箱、懒加载', () => {
  const html = spellHtml()
  assert.match(html, /<iframe class="plate-doc" src="demo\.html" sandbox="allow-scripts" loading="lazy"/)
  assert.doesNotMatch(html, /allow-same-origin/)
})

test('上一条 / 下一条：有就带链接，没有就留空位', () => {
  const both = spellHtml()
  assert.match(both, /href="\.\.\/p\/"/)
  assert.match(both, /href="\.\.\/n\/"/)
  const first = renderSpell(entry(), { ordinal: 1, total: 9, prev: null, next: entry({ slug: 'n' }) })
  assert.match(first, /pager-gap/)
})

test('标签是通往目录筛选的入口，不写轴名', () => {
  const html = spellHtml()
  assert.match(html, /href="\.\.\/\.\.\/\?tag=%E7%8E%BB%E7%92%83"/)
  assert.doesNotMatch(html, /tag-axis/)
})

test('页面上的字要少：目录里没有长段说明', () => {
  const html = renderIndex([entry({ category: '组件', slug: 'a' })])
  assert.doesNotMatch(html, /colophon|hero-sub|group-blurb|brand-sub|card-tags|section-note|plate-caption/)
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ')
  // 去掉条目自己的内容后，界面文案总共不到 150 个字
  const chrome = text.replace(/无名|想用的时候/g, '').replace(/\s+/g, '')
  assert.ok(chrome.length < 150, '界面文案 ' + chrome.length + ' 字，太啰嗦了：' + chrome)
})

test('机制短语与代码机制行共享 data-mech', () => {
  const html = spellHtml()
  assert.match(html, /<mark class="mech" data-mech>某个东西<\/mark>/)
  assert.match(html, /<span class="line is-mech" data-mech>/)
})

test('应用到对话的按钮在页面里，显隐交给 :root[data-embed]', () => {
  const html = spellHtml()
  assert.match(html, /data-apply="wuming"[^>]*data-apply-mode="insert"/)
  assert.match(html, /data-apply="wuming"[^>]*data-apply-mode="send"/)
  assert.match(CSS, /\.apply \{ display: none; \}/)
  assert.match(CSS, /:root\[data-embed\] \.apply \{ display: inline-flex; \}/)
})

/* ------------------------------------------------------------ 样式 */

test('样式表里有 [hidden] 兜底 —— 类规则上的 display 会盖过浏览器默认', () => {
  assert.match(CSS, /\[hidden\]\s*\{\s*display:\s*none\s*!important/)
})

test('两套主题都声明了 color-scheme', () => {
  assert.match(CSS, /:root \{[^}]*color-scheme: light/)
  assert.match(CSS, /:root\[data-theme='dark'\] \{[^}]*color-scheme: dark/)
})

test('顶栏吸顶，并且带底色 —— 透字就废了', () => {
  const rule = CSS.match(/^\.topbar \{[\s\S]*?^\}/m)?.[0] ?? ''
  assert.match(rule, /position:\s*sticky/)
  assert.match(rule, /background:/)
})

test('缩略图里的 iframe 必须让开指针，否则点图没反应而且不报错', () => {
  const rule = CSS.match(/\.card-thumb iframe \{[\s\S]*?\}/)?.[0] ?? ''
  assert.match(rule, /pointer-events:\s*none/)
})

test('整张卡可点：标题链接的伪元素铺满，工具按钮层级更高', () => {
  assert.match(CSS, /\.card-link::after \{[^}]*inset: 0/)
  const tools = CSS.match(/\.card-tools \{[\s\S]*?\}/)?.[0] ?? ''
  assert.match(tools, /z-index:\s*3/)
})

test('触屏没有悬停：卡片工具常驻', () => {
  assert.match(CSS, /@media \(hover: none\) \{ \.card-tools \{ opacity: 1/)
})

test('嵌入态只跟明暗，不跟宿主的配色 —— 换了底色，粗黑框就沉进背景里了', () => {
  assert.doesNotMatch(JS, /--dsw-alias-brand-primary/)
  assert.match(JS, /dsh-spellbook-theme/)
})
