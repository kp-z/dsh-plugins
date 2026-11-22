---
title: 环形图与图例的悬停联动
slug: donut-legend-linked
category: 组件
tags: [svg, stroke, has-selector, 图表, 悬停]
since: 2026-11
source: 取自 Cove Task 总览的状态 donut（dsh-cove-task 的 fd-donut / fd-legend），自行实现
when: 要展示几个类别的占比，图例要能和扇区对应，鼠标放上去时整张图只突出那一类
stage: dark
tier: core
---

## 描述

左边是一个环形图，右边是图例（色点、名称、百分比）。鼠标放到图例的某一行上，环里对应的那一段变粗，其余各段变暗，圆心里的数字变成这一类的占比；移开后恢复总数。

机制是 ==每一段都是同一个圆上的一条描边，用 pathLength=100 把周长归一化，这样 stroke-dasharray 的数值就直接是百分比==。第一段 `45 55` 从 0 开始，第二段 `25 75` 偏移 −45，以此类推。不需要算弧线路径，也不需要 `arc` 命令；改占比只改两个数。

联动用 `:has()`：`.dn:has(.dn-row[data-k=a]:hover) .dn-arc[data-k=a]` 说「图例里 a 那行被悬停时，把环里的 a 段加粗」，另一条规则把「不是它」的段变暗。没有一行 JS，也没有「当前高亮哪一类」这份状态。

## 代码

```html
<div class="dn">
  <svg class="dn-svg" viewBox="0 0 36 36" aria-hidden="true">
    <circle class="dn-track" cx="18" cy="18" r="15.9155"/>
    <!-- @mechanism pathLength=100：dasharray 的数就是百分比 -->
    <circle class="dn-arc" data-k="a" cx="18" cy="18" r="15.9155" pathLength="100" stroke-dasharray="45 55" stroke-dashoffset="0"/>
    <circle class="dn-arc" data-k="b" cx="18" cy="18" r="15.9155" pathLength="100" stroke-dasharray="25 75" stroke-dashoffset="-45"/>
    <circle class="dn-arc" data-k="c" cx="18" cy="18" r="15.9155" pathLength="100" stroke-dasharray="20 80" stroke-dashoffset="-70"/>
    <circle class="dn-arc" data-k="d" cx="18" cy="18" r="15.9155" pathLength="100" stroke-dasharray="10 90" stroke-dashoffset="-90"/>
  </svg>
  <div class="dn-center"><b class="all">128</b><b data-k="a">45%</b><b data-k="b">25%</b><b data-k="c">20%</b><b data-k="d">10%</b></div>
  <ul class="dn-legend">
    <li class="dn-row" data-k="a"><i></i>已完成<span>45%</span></li>
    <li class="dn-row" data-k="b"><i></i>进行中<span>25%</span></li>
    <li class="dn-row" data-k="c"><i></i>未开始<span>20%</span></li>
    <li class="dn-row" data-k="d"><i></i>逾期<span>10%</span></li>
  </ul>
</div>
```

```css
.dn {
  --a: #3ecf8e; --b: #7c8cff; --c: #9d9ab5; --d: #ef5b5b;
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  width: 290px;
  padding: 14px;
  border-radius: 14px;
  background: color-mix(in oklab, #1d1b2b 92%, transparent);
  color: #eceaf6;
  font: 400 11px/1.4 system-ui, sans-serif;
}
.dn-svg { width: 112px; height: 112px; flex: none; rotate: -90deg; }
.dn-svg circle { fill: none; stroke-width: 4.5; transition: stroke-width 0.2s, opacity 0.2s; }
.dn-track { stroke: color-mix(in oklab, #eceaf6 8%, transparent); }
.dn-arc[data-k="a"], .dn-row[data-k="a"] i { stroke: var(--a); background: var(--a); }
.dn-arc[data-k="b"], .dn-row[data-k="b"] i { stroke: var(--b); background: var(--b); }
.dn-arc[data-k="c"], .dn-row[data-k="c"] i { stroke: var(--c); background: var(--c); }
.dn-arc[data-k="d"], .dn-row[data-k="d"] i { stroke: var(--d); background: var(--d); }

.dn-center { position: absolute; left: 14px; top: 14px; width: 112px; height: 112px; display: grid; place-items: center; pointer-events: none; }
.dn-center b { grid-area: 1 / 1; font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dn-center b[data-k] { display: none; }

.dn-legend { display: grid; gap: 7px; flex: 1; margin: 0; padding: 0; list-style: none; }
.dn-row { display: flex; align-items: center; gap: 8px; padding: 2px 6px; border-radius: 6px; cursor: default; }
.dn-row:hover { background: color-mix(in oklab, #eceaf6 6%, transparent); }
.dn-row i { width: 8px; height: 8px; border-radius: 50%; }
.dn-row span { margin-left: auto; color: #9d9ab5; font-variant-numeric: tabular-nums; }

/* @mechanism 联动：图例某行被悬停 → 对应段加粗，其余段变暗，圆心换成这一类的数字 */
.dn:has(.dn-row:hover) .dn-arc { opacity: 0.25; }
.dn:has(.dn-row[data-k="a"]:hover) .dn-arc[data-k="a"],
.dn:has(.dn-row[data-k="b"]:hover) .dn-arc[data-k="b"],
.dn:has(.dn-row[data-k="c"]:hover) .dn-arc[data-k="c"],
.dn:has(.dn-row[data-k="d"]:hover) .dn-arc[data-k="d"] { opacity: 1; stroke-width: 6.5; }
.dn:has(.dn-row:hover) .dn-center .all { display: none; }
.dn:has(.dn-row[data-k="a"]:hover) .dn-center [data-k="a"],
.dn:has(.dn-row[data-k="b"]:hover) .dn-center [data-k="b"],
.dn:has(.dn-row[data-k="c"]:hover) .dn-center [data-k="c"],
.dn:has(.dn-row[data-k="d"]:hover) .dn-center [data-k="d"] { display: block; }
```

## 边界

- 各段占比之和必须是 100，否则最后一段会和第一段重叠或留缺口。数据层归一化后再生成 `dasharray`，别指望 CSS 纠错。
- `stroke-dashoffset` 是**负的累计前缀和**：第 n 段的偏移是 −(前 n−1 段占比之和)。写成正值会让段往反方向跑，视觉上是一个镜像的环。
- `r = 15.9155` 是让周长恰为 100 的半径（100 / 2π）。用了 `pathLength` 之后半径其实可以任意，保留这个值只是让没有 `pathLength` 的老环境也大致正确。
- 加粗时 `stroke-width` 向两侧各扩一半，外沿会超出 viewBox；给 svg 留出 `overflow: visible` 或把 viewBox 外扩 2 单位。
- `:has()` 需要 Chrome 105+ / Safari 15.4+ / Firefox 121+。触屏没有悬停，需要时再配一个点击切换的 `data-active`。
- 段数多（>6）时小段（<3%）几乎看不见，也没法悬停。应合并成「其他」。

## 备注

- 圆心的数字用「默认 + 每类一个、按 :has 切换」的做法，是为了避免 JS。类别是动态的话，改成 JS 在容器上写 `data-hot="a"` 再用属性选择器，同样不需要重绘整个 SVG。
