---
title: 紧凑数据表：只让异常跳出来
slug: dense-data-table
category: 组件
tags: [sticky, font-variant, 表格, 表头, 数字]
since: 2026-11
source: 取自 DemoLite（demo-app）的表格规范 style.md：紧凑 36px 行高、极低对比斑马纹、异常才着色，自行实现
when: 表格每屏几十行数字，用户要在其中找出「哪几个值不对」
stage: plain
tier: core
---

## 描述

一张紧凑的评测结果表：表头固定、行高 36px、斑马纹浅到几乎看不见、数字右对齐且等宽。正常的数字是安静的次要灰，**只有越界的数字**变红并带一个 ⚠。整屏扫一眼，红色的就是要处理的。

机制是 ==着色只给异常，其余一律退成次要文字色==。这不是审美偏好，是信息量的问题：如果每一格都有颜色（绿的好、红的坏、黄的警告），页面上就全是「重点」，等于没有重点。DemoLite 的规范写得很直白：「正常数字用次要文字色，只有异常才跳出来」。

实现上，每个数字格带一个 `data-flag="bad"`，由数据层按阈值打好；样式层只有一条规则读它。表头用 `position: sticky` 固定，横向列多时让表格容器滚动而不是压缩每列的宽度——数字被压成省略号比横向滚动更糟。

## 代码

```html
<div class="dt-wrap">
  <table class="dt">
    <thead><tr><th>场景</th><th class="n">通过率</th><th class="n">碰撞数</th><th class="n">耗时 s</th></tr></thead>
    <tbody>
      <tr><td>直行跟车</td><td class="n">99.2%</td><td class="n">0</td><td class="n">12.4</td></tr>
      <tr><td>无保护左转</td><td class="n" data-flag="bad">71.5%</td><td class="n" data-flag="bad">3</td><td class="n">18.9</td></tr>
      <tr><td>并线切入</td><td class="n">96.8%</td><td class="n">0</td><td class="n">15.1</td></tr>
      <tr><td>行人横穿</td><td class="n">98.0%</td><td class="n">0</td><td class="n" data-flag="bad">41.7</td></tr>
      <tr><td>环岛通行</td><td class="n">97.4%</td><td class="n">0</td><td class="n">22.0</td></tr>
    </tbody>
  </table>
</div>
```

```css
.dt-wrap {
  max-height: 168px;
  overflow: auto;
  border: 1px solid #e4e6eb;
  border-radius: 8px;
  background: #fff;
}

.dt {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font: 400 13px/1 system-ui, 'PingFang SC', sans-serif;
  color: #5c6070;
}

.dt th, .dt td { height: 36px; padding: 0 14px; text-align: left; white-space: nowrap; }

.dt th {
  /* @mechanism 表头固定：滚动时始终在最上面，且要有不透明底色，否则下面的行会透出来 */
  position: sticky;
  top: 0;
  background: #f5f6f8;
  color: #1a1d27;
  font-weight: 600;
  font-size: 12px;
}

/* 斑马纹：对比度极低，只是帮眼睛不串行 */
.dt tbody tr:nth-child(even) { background: rgb(26 29 39 / 0.018); }
.dt tbody tr:hover { background: #f0f2f5; }

/* @mechanism 数字右对齐 + 等宽数字，位数不同也能纵向对齐小数点 */
.dt .n { text-align: right; font-variant-numeric: tabular-nums; }

/* @mechanism 异常才着色：全表唯一的彩色规则 */
.dt [data-flag="bad"] { color: #dc2626; font-weight: 600; }
.dt [data-flag="bad"]::before { content: '⚠ '; font-weight: 400; }
```

## 边界

- `sticky` 的表头在 `border-collapse: collapse` 下，边线会跟着单元格滚走（浏览器把边线画在表格上而不是单元格上）。要么改成 `border-collapse: separate; border-spacing: 0`，要么用 `box-shadow: inset 0 -1px` 给表头画底线。
- `sticky` 需要祖先里没有别的 `overflow` 容器抢走滚动——示例里滚动容器就是 `.dt-wrap`，表头相对它固定。
- 「异常」的阈值必须由数据层判，不要在样式里用属性选择器写 `[data-v^="7"]` 这类取巧：阈值变了没人会去改样式。
- ⚠ 是用 `::before` 加的，读屏器可能念成「警告标志」也可能不念。真实产品里异常格应该带 `aria-label="异常：71.5%"`。
- 超过约 8 列时不要压缩每列的宽度，让容器横向滚动；固定首列用 `position: sticky; left: 0` 同样需要不透明底色。

## 备注

- 这条与「表头固定」类条目（`sticky-table-head`）的区别在于：它讲的是**信息分配**——什么该有颜色——而不是 sticky 的实现细节。
