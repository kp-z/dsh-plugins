---
title: 贡献日历：列数变量与方格自适应
slug: contribution-calendar
category: 组件
tags: [grid, aspect-ratio, color-mix, 图表, 看板]
since: 2026-11
source: 取自 Cove Task 总览看板的任务完成日历（dsh-cove-task 的 fd-cal），形态参考 GitHub 贡献图，自行实现
when: 要在一个固定宽度里画「最近半年每天做了多少」，格子要铺满宽度，宽度变了格子跟着变
stage: dark
tier: core
params:
  - { name: gap, label: 格距, type: range, min: 1, max: 6, step: 1, default: 2, unit: px }
---

## 描述

一张半年的日历热力图：每一列是一周、每一行是星期几，格子颜色从暗到亮分五档，月份写在顶部。格子是正方形，容器变宽格子就一起变大，不会出现「宽了但格子还是 12px，右边空一截」。

机制是 ==用 grid-auto-flow: column 加 7 行，把一串平铺的格子自动排成「一列一周」，列数只来自一个变量 --weeks==。不需要为每周再包一层元素：数据是一维数组，CSS 让它按列优先排。格子宽度由每列的宽度（`1fr`）决定，高度用 `aspect-ratio: 1` 跟着宽度走，所以整张图随容器缩放。

颜色五档是同一个绿色的 `color-mix`：0 档是前景色 7%，1–3 档是绿 28% / 48% / 70%，4 档是满绿。换主题或换语义色（把绿换成品牌色）只改一个变量。

## 代码

```html
<div class="cal" style="--weeks:26">
  <div class="cal-months"></div>
  <!-- @mechanism 一维的格子，由 CSS 排成 7 行、按列优先 -->
  <div class="cal-grid"></div>
  <div class="cal-legend">少 <i data-l="0"></i><i data-l="1"></i><i data-l="2"></i><i data-l="3"></i><i data-l="4"></i> 多</div>
</div>
```

```css
.cal {
  --ok: #3ecf8e;
  --text: #eceaf6;
  width: 300px;
  padding: 12px;
  border: 1px solid color-mix(in oklab, #4a4566 65%, transparent);
  border-radius: 14px;
  background: color-mix(in oklab, #1d1b2b 92%, transparent);
  color: color-mix(in oklab, var(--text) 60%, transparent);
  font: 400 9px/1 system-ui, sans-serif;
}

.cal-months {
  display: grid;
  grid-template-columns: repeat(var(--weeks), minmax(0, 1fr));
  column-gap: var(--gap, 2px);
  height: 12px;
}
.cal-months span { white-space: nowrap; }

.cal-grid {
  display: grid;
  /* @mechanism 7 行 + 列优先：数据是一维数组，一列恰好是一周 */
  grid-template-rows: repeat(7, auto);
  grid-auto-flow: column;
  grid-template-columns: repeat(var(--weeks), minmax(0, 1fr));
  gap: var(--gap, 2px);
}

.cal-grid i, .cal-legend i {
  display: block;
  border-radius: 2px;
  /* @mechanism 正方形随每列的宽度长大：宽度来自 1fr，高度来自 aspect-ratio */
  aspect-ratio: 1;
  background: color-mix(in oklab, var(--text) 7%, transparent);
}
[data-l="1"] { background: color-mix(in oklab, var(--ok) 28%, transparent) !important; }
[data-l="2"] { background: color-mix(in oklab, var(--ok) 48%, transparent) !important; }
[data-l="3"] { background: color-mix(in oklab, var(--ok) 70%, transparent) !important; }
[data-l="4"] { background: var(--ok) !important; }

.cal-legend { display: flex; align-items: center; justify-content: flex-end; gap: 3px; margin-top: 8px; }
.cal-legend i { width: 9px; }
```

```js
// 伪随机但确定：每次渲染得到同一张图
let seed = 7
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const grid = stage.querySelector('.cal-grid')
const months = stage.querySelector('.cal-months')
const names = ['1月', '2月', '3月', '4月', '5月', '6月', '7月']
for (let w = 0; w < 26; w++) {
  for (let d = 0; d < 7; d++) {
    const cell = document.createElement('i')
    const r = rnd()
    const level = d > 4 ? (r > 0.8 ? 1 : 0) : r > 0.92 ? 4 : r > 0.75 ? 3 : r > 0.5 ? 2 : r > 0.3 ? 1 : 0
    cell.dataset.l = String(level)
    cell.title = '第' + (w + 1) + '周 · ' + level + ' 项'
    grid.appendChild(cell)
  }
  if (w % 4 === 0) {
    const m = document.createElement('span')
    m.style.gridColumn = String(w + 1)
    m.textContent = names[w / 4]
    months.appendChild(m)
  }
}
```

## 边界

- `grid-auto-flow: column` 要求**显式写行数**（`grid-template-rows: repeat(7, …)`）。没写时浏览器按列数反推，格子会按行排而不是按列排。
- 日历的第一列通常不满 7 天（今天是周三，第一周只有后半周）。数据层要用 `is-empty` 的占位格补齐到「从周日开始」，否则整张图错位一天。
- `aspect-ratio: 1` 只在宽度确定时可靠。容器宽度过窄（格子 <5px）时圆角与间距会吞掉格子本身，该改成按月聚合。
- 颜色档位只靠明度差，色觉障碍用户难以分辨。每个格子应带 `title` 或 `aria-label` 给出具体数字，重要数值不能只留在颜色里。
- 月份标签用 `grid-column` 定位到对应的周列；跨月不是整周对齐时，标签会略有偏差，需要的话以「该月 1 号所在周」为准。
