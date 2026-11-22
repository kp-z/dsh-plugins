---
title: 把 backdrop-filter 挪到伪元素上
slug: backdrop-on-pseudo
category: 材质
tags: [backdrop-filter, isolation, stacking-context, 玻璃, 浮层]
since: 2026-11
source: 取自 Cove Task 的任务创建条（dsh-cove-task 的 ftc-bar：isolation + ::before 承载背景与模糊），自行实现
when: 想要一个毛玻璃的条或面板，但里面有绝对定位的下拉菜单，会被它莫名其妙地裁掉或错位
stage: photo
tier: core
---

## 描述

一条毛玻璃的工具栏，里面有一个按钮，点开会弹出一个下拉菜单。菜单是绝对定位的，会向下伸出工具栏之外、悬在背景上。直接给工具栏本身加 `backdrop-filter` 时，这个菜单会被它「框住」：位置计算以工具栏为参照，行为像被关进了盒子。把毛玻璃挪到一个铺满的伪元素上，菜单就恢复正常。

机制是 ==backdrop-filter 会让元素成为其后代（包括 fixed 定位的后代）的包含块，并创建层叠上下文；把它放到 ::before 伪元素上，这些副作用只发生在伪元素自己身上，真正的内容元素保持「干净」==。`isolation: isolate` 给内容一个自己的层叠上下文，伪元素用 `z-index: -1` 沉到内容后面。结果是视觉上一样（模糊、半透明底都在），而结构上内容元素不再是包含块。

## 代码

```html
<div class="bp">
  <div class="bp-bar">
    <span>选择</span>
    <div class="bp-pop-wrap">
      <button class="bp-btn" aria-haspopup="menu">更多 ▾</button>
      <ul class="bp-menu" hidden><li>导出</li><li>复制链接</li><li>删除</li></ul>
    </div>
  </div>
</div>
```

```css
.bp { width: 260px; height: 140px; font: 500 12px/1 system-ui, sans-serif; }

.bp-bar {
  /* @mechanism 内容元素自己不带 backdrop-filter，只建立层叠上下文 */
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 12px;
  border-radius: 12px;
  color: #fff;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.28);
}

/* @mechanism 毛玻璃画在伪元素上：模糊与半透明底都在，但包含块的副作用只落在伪元素 */
.bp-bar::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: rgb(255 255 255 / 0.2);
  backdrop-filter: blur(14px) saturate(1.4);
  pointer-events: none;
}

.bp-pop-wrap { position: relative; }
.bp-btn { padding: 6px 10px; border: 0; border-radius: 8px; background: rgb(255 255 255 / 0.22); color: inherit; font: inherit; cursor: pointer; }

.bp-menu {
  position: absolute;
  right: 0;
  top: 34px;
  z-index: 5;
  min-width: 110px;
  margin: 0;
  padding: 4px;
  list-style: none;
  border-radius: 10px;
  background: #1d1b2b;
  box-shadow: 0 10px 28px rgb(0 0 0 / 0.4);
}
.bp-menu[hidden] { display: none; }
.bp-menu li { padding: 7px 10px; border-radius: 6px; cursor: pointer; }
.bp-menu li:hover { background: rgb(255 255 255 / 0.1); }
```

```js
const btn = stage.querySelector('.bp-btn')
const menu = stage.querySelector('.bp-menu')
btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden })
document.addEventListener('click', () => { menu.hidden = true })
```

## 边界

- 这样做的前提是内容元素**确实不需要** `backdrop-filter` 提供的东西。如果希望内容整体被模糊（比如整块一起「淡出」），那就是应用在内容元素本身。
- 伪元素用 `z-index: -1` 沉到后面，必须配合 `isolation: isolate`（或其它层叠上下文），否则它会沉到祖先背景后面、整块看不见。这是最常见的「毛玻璃消失」。
- 伪元素的圆角要 `border-radius: inherit`，否则模糊区域是方的、从圆角里溢出来。
- 这解决的是「后代被框住」：含 `backdrop-filter` 的元素会成为 `position: fixed` 后代的包含块，fixed 菜单会按它定位而不是按视口。如果菜单是 fixed 的，这一招正是对症的修法。
- Safari 对嵌套 `backdrop-filter`（毛玻璃里再放毛玻璃）支持不稳定；伪元素方案同样受限，菜单本身应该用不透明背景。
- 伪元素不能接收点击（已设 `pointer-events: none`），所以「点击条的空白处」这类交互要加在内容元素上。

## 备注

- 同一手法适用于任何「会改变后代包含块」的属性：`transform`、`filter`、`will-change: transform` 都有同样的副作用，都可以拆到伪元素上。
