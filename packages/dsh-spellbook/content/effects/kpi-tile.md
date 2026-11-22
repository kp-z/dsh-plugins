---
title: 指标卡：大数字、色调与进度
slug: kpi-tile
category: 组件
tags: [custom-property, font-variant, 卡片, 看板, 进度]
since: 2026-11
source: 取自 Cove Task 总览看板的 KPI 卡（dsh-cove-task）与 DemoLite 的「数据大字」规范，自行实现
when: 看板顶部要摆一排核心指标，数字多、位数不一，要对齐、要能一眼看出好坏
stage: dark
tier: core
---

## 描述

四张并排的指标卡：小号标签在上，24px 的大数字居中偏下，数字下面一条细进度条，右下角一行注脚。数字有的是整数，有的带百分号，但位数对得齐；好的指标是绿的，要关注的是橙的，坏的是红的。

机制是 ==业务数据只通过 --v 与 data-tone 两个入口进入样式，色调与进度条宽度都读它们==。另外数字位宽交给字体特性，这意味着 `1111` 和 `8888` 一样宽，数值刷新时卡片不会因为位数窄了一点点而抖动；DemoLite 的规范把它写成「数字优先用等宽字体」，这里落到一行 `font-variant-numeric`。

进度条的宽度就是 `width: var(--v)`，业务侧只在元素上写 `style="--v: 72%"`，样式层不出现任何具体数值。色调同理：`data-tone` 决定数字与进度条的颜色，卡片本身永远是中性的——「只有异常才跳出来」。

## 代码

```html
<div class="kp-grid">
  <!-- @mechanism 数据只以 --v 与 data-tone 进入样式 -->
  <article class="kp" data-tone="ok" style="--v:92%"><span>准时率</span><b>92%</b><i></i><small>较上周 +4</small></article>
  <article class="kp" data-tone="warn" style="--v:58%"><span>进行中</span><b>1,284</b><i></i><small>上限 2,000</small></article>
  <article class="kp" data-tone="danger" style="--v:23%"><span>逾期</span><b>37</b><i></i><small>需处理</small></article>
  <article class="kp" style="--v:64%"><span>完成</span><b>8,432</b><i></i><small>本月累计</small></article>
</div>
```

```css
.kp-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  width: 300px;
  font-family: system-ui, sans-serif;
}

.kp {
  --tone: #7c8cff;
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid color-mix(in oklab, #4a4566 65%, transparent);
  border-radius: 12px;
  background: color-mix(in oklab, #1d1b2b 92%, transparent);
  color: #eceaf6;
}
.kp[data-tone="ok"] { --tone: #3ecf8e; }
.kp[data-tone="warn"] { --tone: #f5a524; }
.kp[data-tone="danger"] { --tone: #ef5b5b; }

.kp span { color: #9d9ab5; font-size: 11px; }
.kp b {
  color: var(--tone);
  font-size: 24px;
  font-weight: 600;
  line-height: 1.2;
  /* 位宽固定：刷新数值不抖 */
  font-variant-numeric: tabular-nums;
}
.kp i {
  display: block;
  height: 4px;
  margin: 4px 0 2px;
  border-radius: 2px;
  background: color-mix(in oklab, #eceaf6 10%, transparent);
  overflow: hidden;
}
.kp i::after {
  content: '';
  display: block;
  height: 100%;
  /* @mechanism 进度宽度只读 --v，色调只读 --tone */
  width: var(--v, 0%);
  background: var(--tone);
  border-radius: inherit;
}
.kp small { color: #9d9ab5; font-size: 10px; }
```

## 边界

- `tabular-nums` 依赖字体本身提供等宽数字特性。多数系统字体有，少数装饰字体没有——换字体之后要验一遍 `1` 与 `8` 是否同宽。
- `--v` 必须带单位（`72%`）。写成裸数字 `72` 时 `width` 无效，进度条是 0 宽而且不报错，这是最常见的一次静默失败。
- 进度条只表达「占比」，不能表达「好坏」——好坏由 `data-tone` 单独给。两者混在一起（例如越长越红）会让同一个条在不同卡里含义不一致。
- 4 列在窄面板里挤不下，用 `grid-template-columns: repeat(auto-fit, minmax(120px, 1fr))` 让列数跟着容器宽度走，而不是用媒体查询。

## 备注

- 卡片里的「中性底 + 单一着色元素」是看板的纪律：同时有三张卡在发光，就等于没有一张在发光。
