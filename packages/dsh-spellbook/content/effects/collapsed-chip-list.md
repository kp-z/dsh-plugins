---
title: 折叠多项：标题放前 N 个，展开放全部
slug: collapsed-chip-list
category: 组件
tags: [details, 标签, 列表, 点击]
since: 2026-11
source: 取自 DemoLite（demo-app）的 CollapsedMany 组件，自行用原生 details 重写
when: 一个格子里可能有 1 个也可能有 40 个标签（负责人、版本、关键词），要在不撑破行高的前提下让用户能看全
stage: plain
tier: core
---

## 描述

列表单元格里放着一串标签。折叠时只显示前 3 个，后面跟一个「+4」；点一下，这一格展开成完整的一块，所有标签都在里面；再点收回。只有 2 个标签时没有任何折叠的东西——不多此一举。

机制是 ==折叠态让标题行放前 N 个预览，展开态让预览让位、正文放全部==。原组件用 ProCard 的 `title` 与 `collapsed` 做的就是这件事：标题与正文是同一份数据的两种截取，不是两份。用原生 `<details>` 来表达最自然：`<summary>` 是折叠态的样子，`[open]` 之后 `<summary>` 里的预览隐藏，下面的正文显示全部。

「要不要折叠」是数据决定的：数量不超过 N 就直接渲染成普通的一串，不套 `details`。用户看到的箭头必须意味着「点了会多出东西」——如果点开后内容一模一样，箭头就是骗人。

## 代码

```html
<div class="cc-demo">
  <p>版本</p>
  <!-- @mechanism 超过 3 个才用 details；预览与全量是同一批标签的两种截取 -->
  <details class="cc">
    <summary>
      <span class="cc-arrow" aria-hidden="true">▸</span>
      <span class="cc-preview"><i>v1.0</i><i>v1.1</i><i>v1.2</i></span>
      <em class="cc-more">+4</em>
    </summary>
    <div class="cc-all"><i>v1.0</i><i>v1.1</i><i>v1.2</i><i>v1.3</i><i>v2.0</i><i>v2.1</i><i>v2.2</i></div>
  </details>
  <p>负责人（只有 2 个，不折叠）</p>
  <div class="cc-all"><i>小林</i><i>阿杰</i></div>
</div>
```

```css
.cc-demo { width: 280px; font: 400 12px/1.4 system-ui, sans-serif; color: #5c6070; }
.cc-demo p { margin: 10px 0 4px; }
.cc-demo p:first-child { margin-top: 0; }

.cc summary {
  display: flex;
  align-items: center;
  gap: 6px;
  list-style: none;
  cursor: pointer;
}
.cc summary::-webkit-details-marker { display: none; }

.cc i, .cc-all i {
  display: inline-block;
  padding: 2px 8px;
  margin: 0 4px 4px 0;
  border: 1px solid rgb(35 165 113 / 0.35);
  border-radius: 6px;
  background: rgb(35 165 113 / 0.1);
  color: #178055;
  font-style: normal;
}

.cc-arrow { transition: rotate 0.2s; }
.cc[open] .cc-arrow { rotate: 90deg; }
.cc-more { color: #9ba3b5; font-style: normal; }

/* @mechanism 展开后标题里的预览让位，正文显示全部 */
.cc[open] .cc-preview, .cc[open] .cc-more { display: none; }
.cc:not([open]) .cc-all { display: none; }
.cc[open] .cc-all { margin-top: 4px; }
```

## 边界

- 折叠态的预览与展开态的全量是**两份 DOM**（同一批标签渲染两遍）。标签带交互（可点击、可删除）时，要保证两份的行为一致，或者展开态隐藏时不让预览里的那份响应。
- `<summary>` 里放交互元素（按钮、链接）会和「点击展开」抢事件。预览标签应只是展示；要交互的放在展开后的正文里。
- 「+4」这个数要由数据算（总数 − N），不要写死；写死之后数据一变就和事实不符。
- 没有 JS 的版本无法做到「点别处自动收起」。同一页有很多个折叠格时通常不需要，但需要「手风琴」效果时给 `details` 加同名的 `name` 属性（Chrome 120+）。

## 备注

- 这是「渐进披露」最小的一个单位：默认给够用的摘要，把「全部」放在用户一次点击之后。同样的结构可用于评论折叠、日志折叠、长文引用折叠。
