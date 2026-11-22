---
title: 拖拽跟手，松手吸附网格
slug: drag-snap-to-grid
category: 组件
tags: [setPointerCapture, transform, transition, 卡片, 拖拽]
since: 2026-11
source: 取自 Cove Task 关系画布的节点拖动（dsh-cove-task 的 GraphView，snapToGrid 与 40px 网格），自行实现
when: 画布上的卡片要让用户自己摆位置，既要拖起来顺手，又要最终排得整齐
stage: dark
tier: core
---

## 描述

一块带 40px 细网格的画布，上面有三张卡片。按住一张卡片拖，它跟着手指走、完全不受网格限制；松手的瞬间，它滑向最近的网格交点，停下来时恰好对齐。拖不出画布边界。

机制是 ==拖动过程中用原始坐标，只在松手那一刻吸附到网格，并让 transform 的 transition 在这一刻才生效==。如果拖动中就吸附，卡片会一格一格地「跳」，手感发卡，用户觉得它在对抗自己；如果完全不吸附，画布最终就是乱的。把吸附推迟到松手，就同时拿到了跟手和整齐。

位置存成 `x / y` 两个数，样式层只用 `translate`。拖动时给卡片加 `is-drag` 类关掉 `transition`；松手时去掉它，再设置吸附后的坐标，浏览器自己补出滑动过程——不需要手写任何动画。吸附函数只有一行：`Math.round(v / 40) * 40`。

## 代码

```html
<div class="ds" data-grid="40">
  <article class="ds-card" data-x="40" data-y="40">需求评审</article>
  <article class="ds-card" data-x="160" data-y="40">方案设计</article>
  <article class="ds-card" data-x="80" data-y="120">联调测试</article>
</div>
```

```css
.ds {
  position: relative;
  width: 280px;
  height: 200px;
  border: 1px solid color-mix(in oklab, #4a4566 60%, transparent);
  border-radius: 12px;
  /* @mechanism 40px 网格：两层线性渐变画出横竖线，和吸附步长是同一个数 */
  background-color: color-mix(in oklab, #15131f 92%, transparent);
  background-image:
    linear-gradient(to right, color-mix(in oklab, #4a4566 25%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in oklab, #4a4566 25%, transparent) 1px, transparent 1px);
  background-size: 40px 40px;
  overflow: hidden;
  touch-action: none;
}

.ds-card {
  position: absolute;
  left: 0;
  top: 0;
  display: grid;
  place-items: center;
  width: 80px;
  height: 40px;
  border: 1px solid color-mix(in oklab, #7c8cff 45%, transparent);
  border-radius: 8px;
  background: color-mix(in oklab, #1d1b2b 95%, transparent);
  color: #eceaf6;
  font: 500 11px/1 system-ui, sans-serif;
  cursor: grab;
  user-select: none;
  translate: var(--x, 0px) var(--y, 0px);
  /* @mechanism 松手时的吸附滑动靠 transition，拖动中要关掉 */
  transition: translate 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.18s;
}
.ds-card.is-drag { transition: none; cursor: grabbing; z-index: 2; box-shadow: 0 8px 20px rgb(0 0 0 / 0.4); }
```

```js
const canvas = stage.querySelector('.ds')
const GRID = Number(canvas.dataset.grid)
const cw = canvas.clientWidth, ch = canvas.clientHeight

const place = (card, x, y) => {
  card.style.setProperty('--x', x + 'px')
  card.style.setProperty('--y', y + 'px')
}
// @mechanism 吸附函数只有一行：四舍五入到最近的网格交点
const snap = (v) => Math.round(v / GRID) * GRID

stage.querySelectorAll('.ds-card').forEach((card) => {
  let x = Number(card.dataset.x), y = Number(card.dataset.y)
  place(card, x, y)
  card.addEventListener('pointerdown', (e) => {
    card.setPointerCapture(e.pointerId)
    card.classList.add('is-drag')
    const ox = e.clientX - x, oy = e.clientY - y
    const maxX = cw - card.offsetWidth, maxY = ch - card.offsetHeight
    const move = (ev) => {
      // 拖动中：原始坐标，只做边界钳制
      x = Math.min(maxX, Math.max(0, ev.clientX - ox))
      y = Math.min(maxY, Math.max(0, ev.clientY - oy))
      place(card, x, y)
    }
    const up = () => {
      card.removeEventListener('pointermove', move)
      card.removeEventListener('pointerup', up)
      card.removeEventListener('pointercancel', up)
      card.classList.remove('is-drag')
      // 松手：吸附（再钳一次，防止吸附后越界）
      x = Math.min(maxX, snap(x)); y = Math.min(maxY, snap(y))
      place(card, x, y)
    }
    card.addEventListener('pointermove', move)
    card.addEventListener('pointerup', up)
    card.addEventListener('pointercancel', up)
  })
})
```

## 边界

- 吸附后要**再钳制一次**：卡片宽 80、画布宽 280，吸附到 240 会让卡片右缘越出 40px。钳制和吸附的先后顺序决定了最终位置是否合法。
- 两张卡片可能吸附到同一个交点而叠在一起。需要避免重叠时，吸附后检测碰撞并顺延到下一个空位，这不是 CSS 能解决的。
- `translate` 属性需要 Chrome 104+ / Safari 14.1+ / Firefox 72+。老环境用 `transform: translate(var(--x), var(--y))`，注意它与缩放等其它 transform 会互相覆盖。
- 网格线的步长（`background-size`）和吸附步长（`data-grid`）必须是同一个数，否则卡片对不齐肉眼看到的线。
- 画布被缩放时，指针位移要除以缩放比再加到坐标上，否则拖动速度与手不一致（见「光标锚点缩放」那一条）。
- 记得处理 `pointercancel`，触屏被系统接管手势时否则卡片会一直处于拖动态。

## 备注

- 要让用户能「关掉吸附」，常见做法是按住 Alt 时用原始坐标；这只需要在 `up` 里判一下 `ev.altKey`。
- 位置持久化时存**吸附后的**坐标，别存拖动中的小数，否则下次载入看起来是歪的。
