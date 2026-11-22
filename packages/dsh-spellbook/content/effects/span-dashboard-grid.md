---
title: 看板网格：固定列数、跨列、等高行
slug: span-dashboard-grid
category: 布局
tags: [grid, container-query, custom-property, 看板, 卡片]
since: 2026-11
source: 取自 Cove Task 运行页的卡片网格（dsh-cove-task 的 frx-grid / is-spanN），布局原型是 Claude Manager 的 Dashboard，自行实现
when: 仪表盘要「几张大卡 + 几张小卡」整齐排成几行，行与行同高；面板变窄时自动改成松散堆叠
stage: dark
tier: core
params:
  - { name: width, label: 面板宽度, type: range, min: 200, max: 360, step: 10, default: 320, unit: px }
---

## 描述

一个 4 列的卡片网格：状态卡占 2 列，两张指标卡各占 1 列，历史卡占满 4 列；每一行同样高，整齐得像一张方格纸。面板被拖窄时，网格自动退回「每张卡占满一行、高度随内容」的堆叠，不再硬塞。

机制是 ==固定列数（repeat(4, minmax(0, 1fr))）配 grid-auto-rows 固定行高，用 is-span2 / is-span4 类让卡片自己决定跨几列，窄面板用容器查询退回自适应==。用固定列数而不是 `auto-fit`：auto-fit 随宽度变化列数，面板一宽就排成 N 列，原本该占 2 列的大卡被挤到下一行，版面整个变了。固定 4 列保证「这张卡永远在这个位置」。

行高固定（`--row-h`）是故意的：行高由内容决定时，跨行永远不可能相等（329 / 360 / 334 就是这么来的）。代价是内容必须受控，装不下时要有滚动或截断；所以窄面板时（容器查询）把固定行高换回 `auto`，那时卡片被重排成更多行，固定高度只会裁内容。

## 代码

```html
<div class="dg-page">
  <div class="dg">
    <article class="dg-card is-span2"><h4>状态</h4><p>运行中 · 3</p></article>
    <article class="dg-card"><h4>准时率</h4><p>92%</p></article>
    <article class="dg-card"><h4>逾期</h4><p>7</p></article>
    <article class="dg-card is-span4"><h4>历史</h4><p>近 30 天完成 128 项</p></article>
  </div>
</div>
```

```css
.dg-page {
  /* @mechanism 容器查询的锚点：面板活在宿主的 tab 里，宽度与视口无关，只能按自身宽度判断 */
  container-type: inline-size;
  width: min(var(--width, 320px), 92vw);
  font: 400 11px/1.4 system-ui, sans-serif;
  color: #eceaf6;
}

.dg {
  display: grid;
  /* @mechanism 固定 4 列：每张卡永远在同一个位置，不随宽度重排 */
  grid-template-columns: repeat(4, minmax(0, 1fr));
  /* @mechanism 固定行高：跨行才能真等高（内容决定的行高永远参差） */
  grid-auto-rows: var(--row-h, 62px);
  gap: 8px;
}

.dg-card {
  display: flex;
  flex-direction: column;
  padding: 9px 10px;
  border: 1px solid color-mix(in oklab, #4a4566 65%, transparent);
  border-radius: 12px;
  background: color-mix(in oklab, #1d1b2b 92%, transparent);
  overflow: hidden;
}
.dg-card h4 { margin: 0; color: #9d9ab5; font-size: 10px; font-weight: 500; }
.dg-card p { margin: auto 0 0; font-size: 15px; font-weight: 600; }

.is-span2 { grid-column: span 2; }
.is-span4 { grid-column: span 4; }

/* @mechanism 窄面板：卡片被重排成更多行，固定行高只会裁内容，换回 auto 并全部占满一行 */
@container (max-width: 260px) {
  .dg { grid-template-columns: minmax(0, 1fr); grid-auto-rows: auto; }
  .is-span2, .is-span4 { grid-column: auto; }
}
```

## 边界

- `container-type: inline-size` 要放在**网格的祖先**上、而不是网格本身：容器查询只能查询祖先容器，查询自己的尺寸会无效。
- 容器本身若是 `display: inline` 或宽度由内容决定（`width: max-content`），容器查询会形成循环依赖，浏览器会把它当成零宽。容器要有来自外部的宽度。
- 固定行高的代价是内容必须受控：卡片内是图表（可缩放）或可滚动列表则没问题；是不定长文字时，要么截断（`line-clamp`），要么放弃等高、改用 `grid-auto-rows: minmax(62px, auto)`。
- 跨列卡片超过总列数时（`span 4` 但只有 3 列）会生成隐式列，布局炸开。重排断点里要同步重置所有 `span`。
- 断点值（260px）是按卡片最小可读宽度推出的：每列至少 60px，4 列加 3 个 8px 的间距约 270px，在这之下再硬排 4 列就不成立了。

## 备注

- 与 `container-card` 的区别：那一条是单张卡片根据自己所在容器改变内部排版；这一条是整个网格根据容器宽度改变列结构。两者常常叠用。
