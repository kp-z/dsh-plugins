---
title: 列显隐：用 :has() 把勾选投影到表格
slug: column-visibility-menu
category: 组件
tags: [has-selector, details, 表格, 菜单, 表头]
since: 2026-11
source: 取自 DemoLite（demo-app）的 TableColumnConfig 组件：齿轮按钮 + 勾选浮层，自行用原生 HTML/CSS 重写
when: 表格列多，要让用户自己选看哪几列，不想为这一件事引入状态管理
stage: plain
tier: core
---

## 描述

表格右上角一个「列」按钮，点开是一张勾选列表，每行一个复选框加列名；取消勾选，对应那一列立刻从表格里消失，再勾回来就回来了。「名称」这类不能没有的列是置灰勾住的，取消不了。

机制是 ==用 :has(input:not(:checked)) 把复选框的状态投影到同一个祖先下的表格列上==。复选框是真的 `input`，状态由浏览器保管；表格列用 `data-col` 标记；CSS 说「如果这个容器里有一个没被勾选的 `#col-status`，就把所有 `[data-col="status"]` 隐藏」。整个交互里没有一行 JS，也没有「可见列」这份需要同步的状态——状态的真相只有复选框一处。

原来的 React 组件需要 `visibleKeys` 受控、`onChange` 回调、还要按 options 顺序重排输出，那是因为它要把状态交给外面的表格。纯 CSS 版本把「谁可见」直接交给 DOM 自己，列顺序天然不变。

## 代码

```html
<div class="cv">
  <!-- @mechanism 浮层用原生 details：点开收起、Esc 与可访问性都是浏览器给的 -->
  <details class="cv-menu">
    <summary>列 ⚙</summary>
    <div class="cv-pop">
      <label><input type="checkbox" checked disabled> 名称</label>
      <label><input id="col-status" type="checkbox" checked> 状态</label>
      <label><input id="col-owner" type="checkbox" checked> 负责人</label>
      <label><input id="col-eta" type="checkbox" checked> 预期完成</label>
    </div>
  </details>
  <table>
    <thead><tr><th>名称</th><th data-col="status">状态</th><th data-col="owner">负责人</th><th data-col="eta">预期完成</th></tr></thead>
    <tbody>
      <tr><td>方案评审</td><td data-col="status">进行中</td><td data-col="owner">小林</td><td data-col="eta">11-21</td></tr>
      <tr><td>接口联调</td><td data-col="status">未开始</td><td data-col="owner">阿杰</td><td data-col="eta">11-25</td></tr>
      <tr><td>回归测试</td><td data-col="status">已完成</td><td data-col="owner">小周</td><td data-col="eta">11-18</td></tr>
    </tbody>
  </table>
</div>
```

```css
.cv {
  position: relative;
  width: 300px;
  padding: 8px;
  border: 1px solid #e4e6eb;
  border-radius: 8px;
  background: #fff;
  color: #1a1d27;
  font: 400 12px/1 system-ui, sans-serif;
}

.cv-menu { display: flex; justify-content: flex-end; margin-bottom: 6px; }
.cv-menu summary {
  padding: 4px 8px;
  border-radius: 6px;
  color: #5c6070;
  cursor: pointer;
  list-style: none;
}
.cv-menu summary:hover { background: #f0f2f5; }
.cv-menu summary::-webkit-details-marker { display: none; }

.cv-pop {
  position: absolute;
  top: 36px;
  right: 8px;
  z-index: 2;
  display: grid;
  gap: 8px;
  min-width: 130px;
  padding: 10px 12px;
  border: 1px solid #e4e6eb;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 4px 16px rgb(26 29 39 / 0.12);
}
.cv-pop label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.cv-pop input:disabled + * , .cv-pop label:has(input:disabled) { color: #9ba3b5; cursor: not-allowed; }

.cv table { width: 100%; border-collapse: collapse; }
.cv th, .cv td { height: 32px; padding: 0 8px; text-align: left; white-space: nowrap; }
.cv th { background: #f5f6f8; font-weight: 600; }
.cv tbody tr + tr td { border-top: 1px solid #f0f2f5; }

/* @mechanism 没被勾选的复选框 → 隐藏同一个容器里对应的列；状态只存在复选框一处 */
.cv:has(#col-status:not(:checked)) [data-col="status"],
.cv:has(#col-owner:not(:checked)) [data-col="owner"],
.cv:has(#col-eta:not(:checked)) [data-col="eta"] { display: none; }
```

## 边界

- 每一列要手写一条 `:has()` 规则，列是动态生成的就不适用——那时用 JS 往容器上写 `data-hidden="status owner"`，再用 `[data-hidden~="status"]` 选，仍然不需要受控状态。
- `:has()` 需要 Chrome 105+ / Safari 15.4+ / Firefox 121+。更老的浏览器里列永远不会隐藏——是静默失败，要在产品支持范围里确认。
- 复选框不在表格的祖先里时（比如菜单渲染在 portal 里）`:has()` 够不着它。它们必须是同一个祖先的后代。
- 隐藏列用 `display: none` 会让表格重新计算布局；列特别多（几十列）时会感觉到，这时改成 `visibility: collapse` 或者虚拟化。
- 「锁定列」靠 `disabled + checked` 表达，不是靠样式：禁用的复选框用户在 UI 上改不动，而「不能取消」是业务约束，不该只存在于外观里。

## 备注

- 同一个模式可以做「筛选条件 → 列表项显隐」：勾选标签，列表里没有该标签的项被 `:has()` 隐藏，没有后端、没有状态库。
