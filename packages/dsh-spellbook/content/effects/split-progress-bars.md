---
title: 双层进度条榜：总量与完成叠在同一条轨道
slug: split-progress-bars
category: 组件
tags: [custom-property, color-mix, 进度, 图表, 悬停]
since: 2026-11
source: 取自 Cove Task 总览的项目分布榜（dsh-cove-task 的 fd-list / fd-bar-split），自行实现
when: 要比较多个项目的体量，同时看出每个项目做完了多少；文字细节只在需要时才出现
stage: dark
tier: core
---

## 描述

一排横条：左边项目名，中间一条轨道，右边总数。轨道里淡色那段的长度表示这个项目的任务总量（相对最大的项目），里面更亮的一段表示已经完成的部分。每一行平时只有「名称、条、总数」，把鼠标放上去才浮出「已完成 12 / 共 16 · 75%」。

机制是 ==同一条轨道里叠两段：淡色段表总量、实色段表完成，宽度全部按同一个最大值归一成百分比，写进 --t 与 --d 两个变量==。这样横向可比（条越长项目越大），纵向也可比（实色占淡色的比例就是完成率），一张图回答两个问题，而不是画两排图。

文字信息放进 `data-tip`，悬停时用 `::after` 显示。默认界面干净，细节随需出现——代价是触屏没有悬停，所以重要的数（总数）仍然常驻在右侧。

## 代码

```html
<ul class="sb">
  <!-- @mechanism 数据只以 --t（总量）与 --d（完成）两个百分比进入样式 -->
  <li class="sb-row" style="--t:100%;--d:75%" data-tip="已完成 12 / 共 16 · 75%"><span>Cove 重构</span><div class="sb-track"><i></i><b></b></div><em>16</em></li>
  <li class="sb-row" style="--t:81%;--d:25%" data-tip="已完成 4 / 共 13 · 31%"><span>飞书同步</span><div class="sb-track"><i></i><b></b></div><em>13</em></li>
  <li class="sb-row" style="--t:50%;--d:50%" data-tip="已完成 8 / 共 8 · 100%"><span>咒语书</span><div class="sb-track"><i></i><b></b></div><em>8</em></li>
  <li class="sb-row" style="--t:31%;--d:6%" data-tip="已完成 1 / 共 5 · 20%"><span>日报</span><div class="sb-track"><i></i><b></b></div><em>5</em></li>
</ul>
```

```css
.sb {
  --brand: #7c8cff;
  width: 290px;
  margin: 0;
  padding: 14px 14px 10px;
  list-style: none;
  border-radius: 14px;
  background: color-mix(in oklab, #1d1b2b 92%, transparent);
  color: #eceaf6;
  font: 400 11px/1 system-ui, sans-serif;
}

.sb-row { position: relative; display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.sb-row span { flex: none; width: 64px; overflow: hidden; color: #9d9ab5; text-overflow: ellipsis; white-space: nowrap; }
.sb-row em { flex: none; width: 24px; text-align: right; font-style: normal; font-variant-numeric: tabular-nums; }

.sb-track {
  position: relative;
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: color-mix(in oklab, #4a4566 30%, transparent);
  overflow: hidden;
}
/* @mechanism 淡色段 = 总量，实色段 = 完成；同一个起点，宽度同一把尺 */
.sb-track i { position: absolute; inset: 0 auto 0 0; width: var(--t); background: color-mix(in oklab, var(--brand) 55%, transparent); }
.sb-track b { position: absolute; inset: 0 auto 0 0; width: var(--d); border-radius: 999px; background: var(--brand); }

/* @mechanism 细节只在悬停时出现：文字放 data-tip，伪元素显示，不占常驻空间 */
.sb-row::after {
  content: attr(data-tip);
  position: absolute;
  right: 0;
  bottom: 16px;
  padding: 4px 8px;
  border: 1px solid color-mix(in oklab, #4a4566 80%, transparent);
  border-radius: 6px;
  background: #272437;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(2px);
  transition: opacity 0.15s, transform 0.15s;
  pointer-events: none;
}
.sb-row:hover::after { opacity: 1; transform: none; }
```

## 边界

- 实色段宽度 `--d` 是**相对最大值**的百分比，不是相对本行总量的百分比。写成后者，每一行的实色都会和淡色一样长，失去「体量」这个维度。数据层要先除以同一个最大值。
- 悬停提示依赖 `::after` 与 `attr()`，内容是纯文本；需要富文本（多行、图标）时换成真正的浮层元素。
- 触屏没有悬停：同样的细节应当还能通过点击行或展开获得，不能只存在于 `data-tip`。
- 提示用 `bottom: 16px` 向上弹出，最顶上一行的提示可能被容器裁掉；给容器留出顶部空间，或第一行改向下弹。
- 条很短（<3%）时实色段只剩一个点；可给 `min-width: 3px` 让「有」和「没有」可区分。

## 备注

- 与 `stacked-bar-flex-grow` 的区别：那一条是多类别按比例分一条；这一条是「总量 + 完成」两个量叠在一起、跨行可比。
