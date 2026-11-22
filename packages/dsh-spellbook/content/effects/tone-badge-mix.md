---
title: 语义徽章：一个色调派生三色
slug: tone-badge-mix
category: 组件
tags: [color-mix, custom-property, 徽章, 标签, 色彩]
since: 2026-11
source: 取自 Cove Task 任务卡的 badge-ok / badge-warn 一族与 DemoLite 的语义色规范，自行实现
when: 页面上有成功 / 警告 / 失败 / 进行中 / 已完成一排状态标签，不想为每种状态手写底色、描边、文字三个值
stage: plain
tier: core
params:
  - { name: weak, label: 底色浓度, type: range, min: 4, max: 30, step: 1, default: 12, unit: % }
---

## 描述

一排小标签：成功（绿）、警告（橙）、失败（红）、进行中（品牌色）、已完成（灰）。每个标签是「淡淡的同色底 + 同色描边 + 同色文字」，并且在浅底与深底上都读得清。

机制是 ==每个徽章只声明一个 --tone，底色、描边、文字都从它用 color-mix 派生==：文字 = tone 本身（在浅底上再向黑混 35%，保证对比度），底 = tone × weak%，描边 = tone × 3 倍浓度。新增一种状态只写一行 `--tone`，不用再挑三个颜色。

DemoLite 的规范里有一条「语义色严格对应语义」，这里正好把它变成了结构：颜色只能通过 `data-tone` 进来，业务代码里没有地方写「红色」，只能写「这是失败」。要改整套状态色，改五行变量。「底色浓度」做成了参数，因为同一套徽章放在白卡上用 8%，放在深色面板上要用 16% 才看得见。

## 代码

```html
<div class="tb-row">
  <!-- @mechanism 业务侧只表达语义（data-tone），不表达颜色 -->
  <span class="tb" data-tone="ok">已通过</span>
  <span class="tb" data-tone="warn">边缘值</span>
  <span class="tb" data-tone="danger">失败</span>
  <span class="tb" data-tone="brand">进行中</span>
  <span class="tb" data-tone="idle">已完成</span>
</div>
```

```css
.tb-row { display: flex; flex-wrap: wrap; gap: 8px; max-width: 300px; }

.tb {
  /* @mechanism 唯一的颜色输入是 --tone；三个派生值全从它来 */
  --tone: #6c7293;
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border: 1px solid color-mix(in oklab, var(--tone) calc(var(--weak, 12%) * 3), transparent);
  border-radius: 6px;
  background: color-mix(in oklab, var(--tone) var(--weak, 12%), transparent);
  /* 文字向黑混一点，浅底上才有足够对比度 */
  color: color-mix(in oklab, var(--tone) 65%, #000);
  font: 500 12px/1 system-ui, sans-serif;
  white-space: nowrap;
}

.tb[data-tone="ok"] { --tone: #23a571; }
.tb[data-tone="warn"] { --tone: #d97706; }
.tb[data-tone="danger"] { --tone: #dc2626; }
.tb[data-tone="brand"] { --tone: #1f4ead; }
.tb[data-tone="idle"] { --tone: #6c7293; }
```

## 边界

- `calc(var(--weak) * 3)` 作为 `color-mix` 的百分比，要求浏览器支持百分比里的 `calc()`（Chrome 111+ / Safari 16.2+ / Firefox 113+）。更老的环境写死两个变量 `--weak` 与 `--line`。
- 「向黑混 35%」只对**浅底**成立。放到深底上应改成向白混，否则文字比底还暗；最稳妥是让 `--ink` 也成为一个由主题提供的令牌。
- 灰色「已完成」的文字对比度天然偏低（灰在灰上）。它是「不用再看的东西」，低对比是有意的，但不能拿它承载必须读到的信息。
- 徽章颜色不是唯一信号：文字永远写状态名，不要出现纯色点标签。

## 备注

- 同样的单变量派生适用于：告警条、提示块、标签筛选 chip、表格里的状态列——凡是「底 + 边 + 字」需要同色三件套的地方。
