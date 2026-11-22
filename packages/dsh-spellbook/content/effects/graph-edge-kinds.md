---
title: 关系图：用线型区分关系，选中只亮相连的边
slug: graph-edge-kinds
category: 组件
tags: [svg, stroke, keyframes, 图表, 悬停]
since: 2026-11
source: 取自 Cove Task 关系画布（dsh-cove-task 的 GraphView / layout.edgePath），布线思路参考 dagre 的正交路由，自行实现
when: 任务、节点之间有「依赖 / 派生 / 先后」几种关系，要在同一张图里一眼分清，并能顺着一个节点追它的上下游
stage: dark
tier: core
---

## 描述

一张小的节点图：实线箭头是「依赖」（必须先完成），虚线是「派生」（来源），点线是「先后」（只有时间顺序、不阻塞）。线是横平竖直的折线，从上游节点右边出、进下游节点左边。鼠标放到一个节点上，只有和它相连的线保持清晰、其余的线退成淡灰，节点自己也被圈出来。

机制是 ==关系类型只用 stroke-dasharray 区分，箭头用与线同色的 marker，选中只切 class，不重画任何东西==。三种线型颜色相近、形状不同——色觉障碍用户也能分清，打印成黑白也能分清；图例直接用同样的 `border-top` 样式画出线样本，保证图例与图一致。

折线路径是个很小的纯函数：起点在上游右边中点，终点在下游左边中点，中间在水平方向的中点处竖直拐一次（`M x1 y1 H mid V y2 H x2`）。上下游挨得太近、没有足够水平空间时，改成绕到右侧再回来，避免线从卡片里穿过。

## 代码

```html
<div class="eg">
  <div class="eg-legend">
    <span><i data-kind="dep"></i>依赖</span>
    <span><i data-kind="der"></i>派生</span>
    <span><i data-kind="tmp"></i>先后</span>
  </div>
  <svg class="eg-svg" viewBox="0 0 300 150" width="300" height="150"></svg>
</div>
```

```css
.eg {
  --brand: #7c8cff;
  --idle: #9d9ab5;
  width: 320px;
  padding: 10px 10px 4px;
  border: 1px solid color-mix(in oklab, #4a4566 60%, transparent);
  border-radius: 14px;
  background: color-mix(in oklab, #15131f 92%, transparent);
  color: #9d9ab5;
  font: 400 11px/1 system-ui, sans-serif;
}

.eg-legend { display: flex; gap: 12px; margin-bottom: 4px; }
.eg-legend span { display: inline-flex; align-items: center; gap: 5px; }
/* 图例样本：用 border-top 画出同样的线型 */
.eg-legend i { width: 16px; border-top: 2px solid var(--brand); }
.eg-legend i[data-kind="der"] { border-top: 2px dashed var(--idle); }
.eg-legend i[data-kind="tmp"] { border-top: 2px dotted var(--idle); }

.eg-svg { display: block; overflow: visible; }

.eg-node rect {
  fill: color-mix(in oklab, #1d1b2b 95%, transparent);
  stroke: color-mix(in oklab, #4a4566 80%, transparent);
  rx: 8;
  transition: stroke 0.2s;
}
.eg-node text { fill: #eceaf6; font-size: 11px; pointer-events: none; }
.eg-node { cursor: pointer; }
.eg-node:hover rect, .eg-node.is-hot rect { stroke: var(--brand); }

.eg-edge { fill: none; stroke-width: 1.6; transition: opacity 0.2s; }
/* @mechanism 线型靠 dasharray 区分：实线 / 虚线 / 点线，不只靠颜色 */
.eg-edge[data-kind="dep"] { stroke: var(--brand); }
.eg-edge[data-kind="der"] { stroke: var(--idle); stroke-dasharray: 5 4; }
.eg-edge[data-kind="tmp"] { stroke: var(--idle); stroke-dasharray: 1.5 4; stroke-linecap: round; }

.eg-arrow[data-kind="dep"] { fill: var(--brand); }
.eg-arrow[data-kind="der"], .eg-arrow[data-kind="tmp"] { fill: var(--idle); }

/* @mechanism 选中 = 给 svg 加 data-hot，非相连的边退成淡灰；只切 class，不重画 */
.eg-svg[data-hot] .eg-edge:not(.is-hot) { opacity: 0.12; }
.eg-svg[data-hot] .eg-arrow-wrap:not(.is-hot) { opacity: 0.12; }
```

```js
const NS = 'http://www.w3.org/2000/svg'
const svg = stage.querySelector('.eg-svg')
const W = 66, H = 28
const nodes = { a: { x: 6, y: 14, t: '需求' }, b: { x: 118, y: 14, t: '方案' }, c: { x: 118, y: 100, t: '开发' }, d: { x: 228, y: 58, t: '上线' }, e: { x: 6, y: 100, t: '调研' } }
const edges = [
  { from: 'a', to: 'b', kind: 'dep' },
  { from: 'b', to: 'd', kind: 'dep' },
  { from: 'c', to: 'd', kind: 'dep' },
  { from: 'a', to: 'c', kind: 'der' },
  { from: 'e', to: 'c', kind: 'tmp' },
]
const el = (name, attrs, parent) => {
  const n = document.createElementNS(NS, name)
  for (const k in attrs) n.setAttribute(k, attrs[k])
  if (parent) parent.appendChild(n)
  return n
}

// @mechanism 正交折线：上游右边中点 → 水平中点处竖直拐一次 → 下游左边中点
function route(a, b) {
  const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2
  if (x2 - x1 < 24) {
    const end = b.x + W, bend = Math.max(x1, end) + 14
    return 'M' + x1 + ' ' + y1 + ' H' + bend + ' V' + y2 + ' H' + end
  }
  const mid = Math.round(x1 + (x2 - x1) / 2)
  return 'M' + x1 + ' ' + y1 + ' H' + mid + ' V' + y2 + ' H' + x2
}

const edgeEls = edges.map((e) => {
  const a = nodes[e.from], b = nodes[e.to]
  const path = el('path', { class: 'eg-edge', d: route(a, b), 'data-kind': e.kind }, svg)
  const wrap = el('g', { class: 'eg-arrow-wrap' }, svg)
  el('path', { class: 'eg-arrow', 'data-kind': e.kind, d: 'M0 0 L-6 -3.5 L-6 3.5 Z', transform: 'translate(' + b.x + ' ' + (b.y + H / 2) + ')' }, wrap)
  return { e, path, wrap }
})

Object.keys(nodes).forEach((id) => {
  const n = nodes[id]
  const g = el('g', { class: 'eg-node', transform: 'translate(' + n.x + ' ' + n.y + ')' }, svg)
  el('rect', { width: W, height: H }, g)
  const t = el('text', { x: W / 2, y: H / 2 + 4, 'text-anchor': 'middle' }, g)
  t.textContent = n.t
  g.addEventListener('mouseenter', () => {
    svg.setAttribute('data-hot', id)
    g.classList.add('is-hot')
    edgeEls.forEach((x) => {
      const on = x.e.from === id || x.e.to === id
      x.path.classList.toggle('is-hot', on)
      x.wrap.classList.toggle('is-hot', on)
    })
  })
  g.addEventListener('mouseleave', () => {
    svg.removeAttribute('data-hot')
    g.classList.remove('is-hot')
    edgeEls.forEach((x) => { x.path.classList.remove('is-hot'); x.wrap.classList.remove('is-hot') })
  })
})
```

## 边界

- 箭头画在终点（下游节点左边中点），方向写死为朝右。如果某条线是绕行（`bend` 分支）进入下游**右边**的，箭头要朝左——否则箭头会指向卡片外面。
- 同一对节点之间有多条边时，路径完全重合。要给每条加一个固定偏移（例如 6px 递增），让它们并排而不是叠成一条。
- 虚线与点线在被缩放得很小的图里会糊成实线。缩放时让 `dasharray` 与缩放反比，或用 `vector-effect: non-scaling-stroke` 让线宽与虚线节奏不随缩放变化。
- 悬停高亮对触屏无效，需要选中（点击）作为等价入口，并支持 Esc 取消。
- 节点多（>50）时不要给每条边都带过渡动画；选中时一次性改 class 即可，别逐条 `transition`。

## 备注

- 「关系类型的语义」（谁阻塞谁）和「线型」应当是一张对照表：图例、图、提示文字三处用同一份，改了线型三处一起变。
- 与 `gradient-dashed-edge` 无关：那是卡片边框的虚线渐变；这里的虚线是数据图里的线型编码。
