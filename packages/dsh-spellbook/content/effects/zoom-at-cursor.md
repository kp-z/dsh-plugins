---
title: 光标锚点缩放：滚轮缩放时内容不跑
slug: zoom-at-cursor
category: 交互
tags: [transform, setPointerCapture, 图表, 滚动, 拖拽]
since: 2026-11
source: 取自 Cove Task 关系画布的视口模型（dsh-cove-task 的 GraphView：zoomView / panView / clampZoom），自行实现
when: 画布、地图、关系图要支持缩放与平移，用户希望「鼠标指着哪里，就围着哪里放大」
stage: grid
tier: core
---

## 描述

一块可缩放的画布：按住 Ctrl（或 ⌘）滚动滚轮缩放，鼠标指着哪一点，那一点就一直停在鼠标下面，不会随缩放漂走；按住空白处拖动平移；缩放限制在 0.35× 到 2.6× 之间。不按 Ctrl 的滚轮不拦截，照常滚动页面。

机制是 ==用「用户坐标 = 内容坐标 × k + t」建模，缩放时让锚点缩放前后落在同一处，推出 t' = 锚点 − (锚点 − t) × k'/k==。直觉写法是「先放大，再把画布往回挪一点」，要凑数字；用这个公式就是一行，而且对任何锚点成立。

视口状态只有三个数 `{k, x, y}`，样式层一句 `transform: translate(x, y) scale(k)`（`transform-origin: 0 0`）。所有交互——滚轮、拖动、双指——都只是在算新的三个数。缩放倍率钳在上下限里，因为太小看不清线、太大只剩一个节点，都没意义；坏值（NaN、0、负数）一律回退到恒等视口，不做半截缩放。

## 代码

```html
<div class="zm">
  <div class="zm-world">
    <span style="left:30px;top:30px">A</span>
    <span style="left:150px;top:50px">B</span>
    <span style="left:80px;top:110px">C</span>
    <span style="left:210px;top:120px">D</span>
  </div>
  <div class="zm-hud">Ctrl/⌘ + 滚轮缩放 · 拖动平移 · <b>1.00×</b></div>
</div>
```

```css
.zm {
  position: relative;
  width: 300px;
  height: 190px;
  border: 1px solid rgb(60 48 30 / 0.4);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.5);
  overflow: hidden;
  cursor: grab;
  /* 让指针手势归我，别当成页面滚动 */
  touch-action: none;
}
.zm.is-pan { cursor: grabbing; }

.zm-world {
  position: absolute;
  left: 0;
  top: 0;
  width: 280px;
  height: 180px;
  /* @mechanism 变换原点必须是左上角：公式里的 t 就是内容原点在视口里的位置 */
  transform-origin: 0 0;
  transform: translate(var(--tx, 0px), var(--ty, 0px)) scale(var(--k, 1));
  background-image:
    linear-gradient(to right, rgb(60 48 30 / 0.12) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(60 48 30 / 0.12) 1px, transparent 1px);
  background-size: 20px 20px;
}
.zm-world span {
  position: absolute;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: #b4462f;
  color: #f7f1e6;
  font: 600 14px/1 system-ui, sans-serif;
}

.zm-hud {
  position: absolute;
  left: 8px;
  bottom: 6px;
  padding: 2px 6px;
  border-radius: 5px;
  background: rgb(28 26 23 / 0.7);
  color: #f7f1e6;
  font: 400 10px/1.4 system-ui, sans-serif;
  pointer-events: none;
}
```

```js
const root = stage.querySelector('.zm')
const world = stage.querySelector('.zm-world')
const hud = stage.querySelector('.zm-hud b')
const K_MIN = 0.35, K_MAX = 2.6
let view = { k: 1, x: 0, y: 0 }

const clampK = (k) => (isFinite(k) && k > 0 ? Math.min(K_MAX, Math.max(K_MIN, k)) : 1)

// @mechanism 缩放前后让锚点落在同一处：t' = a - (a - t) * k'/k
function zoomAt(v, factor, a) {
  const k2 = clampK(v.k * factor)
  const r = k2 / v.k
  return { k: k2, x: a.x - (a.x - v.x) * r, y: a.y - (a.y - v.y) * r }
}

function apply() {
  world.style.setProperty('--k', view.k)
  world.style.setProperty('--tx', view.x + 'px')
  world.style.setProperty('--ty', view.y + 'px')
  hud.textContent = view.k.toFixed(2) + '×'
}

root.addEventListener('wheel', (e) => {
  // 不按 Ctrl/⌘ 的滚轮不拦截：留给页面滚动
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  const box = root.getBoundingClientRect()
  const anchor = { x: e.clientX - box.left, y: e.clientY - box.top }
  view = zoomAt(view, Math.exp(-e.deltaY * 0.0025), anchor)
  apply()
}, { passive: false })

root.addEventListener('pointerdown', (e) => {
  root.setPointerCapture(e.pointerId)
  root.classList.add('is-pan')
  let lx = e.clientX, ly = e.clientY
  const move = (ev) => {
    view = { k: view.k, x: view.x + ev.clientX - lx, y: view.y + ev.clientY - ly }
    lx = ev.clientX; ly = ev.clientY
    apply()
  }
  const up = () => {
    root.classList.remove('is-pan')
    root.removeEventListener('pointermove', move)
    root.removeEventListener('pointerup', up)
    root.removeEventListener('pointercancel', up)
  }
  root.addEventListener('pointermove', move)
  root.addEventListener('pointerup', up)
  root.addEventListener('pointercancel', up)
})
apply()
```

## 边界

- 滚轮监听必须 `{ passive: false }`，否则 `preventDefault()` 无效，页面会跟着一起滚。同时只在按下 Ctrl/⌘ 时拦截：在整页滚动的界面里无条件拦截滚轮，等于把用户的页面锁死。
- macOS 触控板的双指捏合会被浏览器翻译成 `ctrlKey: true` 的滚轮事件，所以上面的判断同时覆盖了捏合缩放，不需要另写手势。
- 锚点必须是**相对视口左上角**的坐标（`clientX − box.left`），不是相对页面或相对内容的。传错坐标系是这类代码最常见的 bug，现象是「放大时内容往某个方向飘」。
- `transform-origin` 若不是 `0 0`，公式里的 t 就不再是「内容原点的位置」，整套推导失效；要用别的原点，要先换算。
- 缩放倍率在极端值时要钳住后**再算 ratio**（上面 `k2 / v.k`），而不是先用未钳的倍率算位移，否则触到上下限时画面会继续漂移。
- 拖动平移的位移要除以缩放比的前提是你把平移写在缩放之前（本例是 translate 在外、scale 在内，位移直接是屏幕像素，不用除）。顺序反了就要除。

## 备注

- 同一组公式可以做「以某节点为中心」：求 t 使得内容点 p 落在视口中心，即 `t = 视口中心 − p × k`。
- 视口状态只有三个数，很适合存进 URL 或本地存储，下次打开回到同一视角；载入时同样要钳制与回退。
