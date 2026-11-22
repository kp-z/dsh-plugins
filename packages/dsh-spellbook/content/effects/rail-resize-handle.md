---
title: 拖拽把手：宽命中带，细可见线
slug: rail-resize-handle
category: 组件
tags: [setPointerCapture, custom-property, 拖拽, 导航, 指针]
since: 2026-11
source: 取自 Cove Task 左侧 rail 的右边缘拖动把手（dsh-cove-task 的 fo-rail-resizer），自行实现
when: 侧栏、面板的宽度要让用户拖着调，但不想在边缘放一根粗粗的分隔条
stage: dark
tier: core
---

## 描述

侧栏的右边缘看起来只是一条 1px 的细线，平时几乎看不见。鼠标靠近时，细线亮成品牌色；按住往左右拖，侧栏宽度跟着变，有上下限；双击把手回到默认宽度；键盘聚焦到把手后，左右方向键每次调 16px。

机制是 ==命中带与可见线分离：把手本体是 6px 宽的透明命中带，真正画出来的线是它里面的 1px 伪元素==。用户瞄准一条 1px 的线非常困难，手一抖就脱靶；命中带比可见线宽 6 倍，既好抓，又不让界面上多一根粗条。命中带用负的 `right` 骑在侧栏的边缘上，不占布局，侧栏的内容宽度不受影响。

拖动用 Pointer Events + `setPointerCapture`：按下后即使指针移出把手、移出窗口，后续的移动事件仍然送回把手，不会出现「拖快了就脱手」。`touch-action: none` 告诉浏览器别把这个手势当成页面滚动。宽度存在 `--w` 这个自定义属性里，布局只读它。

## 代码

```html
<div class="rz" style="--w:150px">
  <aside class="rz-rail">
    <b>导航</b><span>概览</span><span>看板</span><span>洞察</span>
    <!-- @mechanism 命中带：透明、6px、骑在边缘上；可见的线是它的伪元素 -->
    <div class="rz-handle" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" aria-valuemin="110" aria-valuemax="220" aria-valuenow="150" tabindex="0"></div>
  </aside>
  <main class="rz-main">拖动左边缘的细线</main>
</div>
```

```css
.rz {
  --w: 150px;
  display: grid;
  grid-template-columns: var(--w) 1fr;
  width: 300px;
  height: 140px;
  border: 1px solid color-mix(in oklab, #4a4566 65%, transparent);
  border-radius: 12px;
  background: color-mix(in oklab, #15131f 85%, transparent);
  color: #eceaf6;
  font: 400 12px/1.4 system-ui, sans-serif;
  overflow: hidden;
}

.rz-rail {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-right: 1px solid color-mix(in oklab, #eceaf6 6%, transparent);
  color: #9d9ab5;
}
.rz-rail b { color: #eceaf6; }

.rz-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  /* @mechanism 向外多出 3px：命中带是 6px，骑在 1px 的边缘上，不占布局 */
  right: -3px;
  width: 6px;
  z-index: 2;
  cursor: col-resize;
  /* @mechanism 告诉浏览器这个手势归我，别当成页面滚动 */
  touch-action: none;
}
.rz-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  right: 3px;
  width: 1px;
  background: transparent;
  transition: background-color 0.16s;
}
.rz-handle:hover::after, .rz-handle:focus-visible::after, .rz-handle.is-drag::after {
  background: color-mix(in oklab, #7c8cff 70%, transparent);
}
.rz-handle:focus-visible { outline: none; }

.rz-main { display: grid; place-items: center; color: #9d9ab5; }
```

```js
const root = stage.querySelector('.rz')
const handle = stage.querySelector('.rz-handle')
const MIN = 110, MAX = 220, DEF = 150
let width = DEF

function setWidth(w) {
  width = Math.max(MIN, Math.min(MAX, Math.round(w)))
  root.style.setProperty('--w', width + 'px')
  handle.setAttribute('aria-valuenow', String(width))
}

handle.addEventListener('pointerdown', (e) => {
  // @mechanism 捕获指针：拖出把手、拖出窗口，move 事件依然送到这里
  handle.setPointerCapture(e.pointerId)
  handle.classList.add('is-drag')
  const startX = e.clientX
  const startW = width
  const move = (ev) => setWidth(startW + ev.clientX - startX)
  const up = () => {
    handle.classList.remove('is-drag')
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    handle.removeEventListener('pointercancel', up)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
  handle.addEventListener('pointercancel', up)
})

handle.addEventListener('dblclick', () => setWidth(DEF))
handle.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(width - 16) }
  if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(width + 16) }
})
```

## 边界

- 命中带向外伸出 3px，会盖在相邻内容的边缘上。相邻是可点击元素（比如滚动条、按钮）时，把手会抢走它们靠边那 3px 的点击。
- 父级 `overflow: hidden` 会把向外伸出的那一半裁掉，只剩里面 3px 可抓。示例里 `.rz-rail` 没有 overflow 限制，而外层 `.rz` 有——所以把手要放在不裁切的那一层里。
- 必须处理 `pointercancel`：触屏上浏览器可能中途把手势接管，不监听就会留下一个永远「拖着」的状态。
- 宽度的上下限要在写入处钳制，而不是靠 CSS；否则键盘与双击也可能绕过限制。
- 记住宽度（localStorage）时要在加载时再钳一次：用户可能把窗口缩小了，存的 220px 在新窗口里已经不合法。
- `role="separator"` 配 `aria-valuenow` 才能让读屏器念成「可调分隔条」；缺了它，键盘调节对看不见的用户毫无提示。

## 备注

- 「命中带 ≠ 可见线」的拆分适用于所有难瞄准的细小目标：表格列分隔、时间轴游标、画布节点连线。
