---
title: 空态居中：只有它一个孩子时才居中
slug: empty-state-only-child
category: 布局
tags: [flex, has-selector, 空状态, 卡片, 容器]
since: 2026-11
source: 取自 Cove Task 总览看板卡片的空态处理（dsh-cove-task 的 fd-panel-body > .fd-empty-line:only-child），自行实现
when: 一排等高的卡片，有的有数据、有的是空的；空的那张里「暂无数据」不该贴在顶部、也不该影响有数据的卡
stage: dark
tier: core
---

## 描述

三张等高的卡片并排：两张有内容，一张没有。没内容的那张里，「暂无数据」这句提示在卡片的正中间；而有内容的卡片里，内容照常从顶部开始排，提示也不会冒出来。

机制是 ==用 :only-child 判断「卡片体里只有这一个元素」，只在这时给它 margin: auto，把它在 flex 列里推到正中间==。flex 容器里 `margin: auto` 会吃掉所有剩余空间并平分到两侧，等价于垂直水平居中。关键是条件：只有它是唯一的孩子时才居中；卡片里一旦有真内容，它就不是 `:only-child`，规则自然失效，不需要在 JS 里判断「现在是不是空态」。

卡片按行等高时，空态贴顶会让下半截看起来像「没加载完」；居中则明确表达「这里就是没有」。这条规则写在容器上而不是空态元素上，所以以后换文案、换成图标 + 文案，规则都不用改。

## 代码

```html
<div class="es-row">
  <section class="es-card"><h4>最近完成</h4><div class="es-body"><p>方案评审</p><p>接口联调</p><p>回归测试</p></div></section>
  <section class="es-card"><h4>阻塞榜</h4><div class="es-body"><!-- @mechanism 空态：只有这一个孩子 --><div class="es-empty">暂无阻塞任务</div></div></section>
  <section class="es-card"><h4>即将到期</h4><div class="es-body"><p>周报 · 明天</p><p>汇报 · 周五</p></div></section>
</div>
```

```css
.es-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 310px; height: 150px; font: 400 11px/1.5 system-ui, sans-serif; color: #eceaf6; }

.es-card {
  display: flex;
  flex-direction: column;
  padding: 10px;
  border: 1px solid color-mix(in oklab, #4a4566 65%, transparent);
  border-radius: 12px;
  background: color-mix(in oklab, #1d1b2b 92%, transparent);
}
.es-card h4 { margin: 0 0 6px; font-size: 11px; font-weight: 600; color: #9d9ab5; }

.es-body { display: flex; flex: 1; flex-direction: column; gap: 4px; min-height: 0; }
.es-body p { margin: 0; padding: 3px 6px; border-radius: 6px; background: color-mix(in oklab, #eceaf6 5%, transparent); }

/* @mechanism 唯一的孩子才居中：flex 列里 margin:auto 吃掉剩余空间，等价于居中 */
.es-body > .es-empty:only-child {
  margin: auto;
  max-width: 120px;
  color: #9d9ab5;
  text-align: center;
  line-height: 1.6;
}
```

## 边界

- `:only-child` 数的是**元素**孩子，文本节点不算；但注释节点与空白不影响它。容器里如果还有一个看不见的占位元素（隐藏的加载条），它就不再是唯一的孩子，居中悄悄失效。
- 要求容器是 flex（或 grid）并且有确定的高度：`flex: 1; min-height: 0` 让它撑满卡片的剩余空间。高度由内容决定的容器里，`margin: auto` 没有多余空间可分，看起来仍然贴顶。
- 空态元素自身要给 `max-width`，否则一句长文案会撑满整行，居中看起来像左对齐。
- 「是否空」本应由数据层决定。这条规则只是在 DOM 里有一个空态元素时让它好看，不要用它来**判断**是否为空——数据变化时，必须是渲染层换掉 DOM，而不是样式层猜。

## 备注

- 与 `empty-state-skeleton` 不同：那一条讲空态的内容怎么画；这一条讲空态放在哪、什么条件下居中。
