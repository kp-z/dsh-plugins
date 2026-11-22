---
title: 玻璃卡片的透明度分层
slug: glass-card-layers
category: 组件
tags: [color-mix, custom-property, backdrop-filter, 玻璃, 卡片]
since: 2026-11
source: 取自 Cove Task 总览面板（dsh-cove-task）的玻璃层，视觉参考 Claude Manager 的深色玻璃卡片，自行实现
when: 面板里有「底 → 卡片 → 次级卡」几层内容，想要玻璃感，又不想维护一整套灰阶色板
stage: dark
tier: core
params:
  - { name: wash, label: 品牌渐隐强度, type: range, min: 0, max: 24, step: 1, default: 6, unit: % }
  - { name: blur, label: 背景模糊, type: range, min: 0, max: 24, step: 1, default: 12, unit: px }
---

## 描述

一块深色面板，上面浮着两张卡片，卡片里还有一格次级卡。每一层都比下一层更「透」，边线是半透明的，卡片左上角带一抹品牌色渐隐，悬停时边线变亮、整张卡上浮 2px。

机制是 ==层级用透明度表达，而不是用灰阶==：卡片面 = 层 1 的颜色 × 92%，次级面 = 层 2 的颜色 × 88%，边线 = 边框色 × 65%，悬停边线 = 边框色 × 82%。每一档都是 `color-mix(in oklab, 令牌 N%, transparent)` 写出来的。这样「换主题」只需要换那几个令牌的值，所有层级的透明度关系原样保留；如果用灰阶，每换一套主题就得重挑一遍 5 个灰。

四个半透明值（面 / 次级面 / 边线 / 悬停边线）全部收在根容器的自定义属性里，组件只引用 `var(--glass-*)`。想整体更「透」或更「实」，改这四个数，而不是去改每个组件。品牌渐隐 `linear-gradient(135deg, 品牌 6%, transparent 72%)` 是叠在卡片面之上的一层「着色」，强度做成参数，0% 时就是纯玻璃。

## 代码

```html
<!-- @mechanism 三层结构：面板底 → 卡片 → 次级卡，每层只引用自己的那一档透明度 -->
<section class="gl-panel">
  <article class="gl-card">
    <h4>本周任务</h4>
    <p>12 项进行中 · 3 项逾期</p>
    <div class="gl-sub"><span>下一步</span><b>评审方案</b></div>
  </article>
  <article class="gl-card">
    <h4>团队负载</h4>
    <p>5 人在线 · 平均 68%</p>
  </article>
</section>
```

```css
.gl-panel {
  /* @mechanism 宿主令牌：只有这几个「实色」，其余全由它们 × 百分比派生 */
  --bg-base: #15131f;
  --bg-1: #1d1b2b;
  --bg-2: #272437;
  --line: #4a4566;
  --brand: #7c8cff;
  --label: #eceaf6;
  --label-2: #9d9ab5;

  /* @mechanism 玻璃四档：透明度关系写在这里一次，组件只读变量 */
  --glass-card: color-mix(in oklab, var(--bg-1) 92%, transparent);
  --glass-sub: color-mix(in oklab, var(--bg-2) 88%, transparent);
  --glass-line: color-mix(in oklab, var(--line) 65%, transparent);
  --glass-line-hover: color-mix(in oklab, var(--line) 82%, transparent);
  --glass-wash: linear-gradient(135deg, color-mix(in oklab, var(--brand) var(--wash, 6%), transparent), transparent 72%);

  display: grid;
  gap: 12px;
  width: 280px;
  padding: 14px;
  border-radius: 16px;
  background: color-mix(in oklab, var(--bg-base) 70%, transparent);
  backdrop-filter: blur(var(--blur, 12px));
  color: var(--label);
  font: 400 12px/1.5 system-ui, sans-serif;
}

.gl-card {
  padding: 12px 14px;
  border: 1px solid var(--glass-line);
  border-radius: 14px;
  /* @mechanism 品牌渐隐叠在卡片面上面，是「着色」不是新颜色 */
  background: var(--glass-wash), var(--glass-card);
  transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), border-color 0.3s;
}

.gl-card:hover {
  transform: translateY(-2px);
  border-color: var(--glass-line-hover);
  box-shadow: 0 8px 24px color-mix(in oklab, var(--label) 10%, transparent);
}

.gl-card h4 { margin: 0 0 2px; font-size: 13px; font-weight: 600; }
.gl-card p { margin: 0; color: var(--label-2); }

.gl-sub {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--glass-sub);
}
.gl-sub span { color: var(--label-2); }
```

## 边界

- `backdrop-filter` 只会模糊「它背后的东西」。面板底如果是纯色而背后没有内容，模糊看不出任何效果，玻璃感会退化成一块半透明灰；要么背后有内容，要么接受这一点。
- `color-mix` 的透明度是相对「它叠在什么上面」的。同一个 92% 的卡片面，叠在亮底和暗底上观感差很多，所以百分比要在两套主题里都实际看过，不能只在一套里调。
- 层级超过三层（底 / 卡 / 次级卡）之后，半透明叠加会让文字对比度悄悄掉下去。第四层应当改回不透明，而不是继续降百分比。
- `oklab` 插值与 `srgb` 在深色上差别明显：srgb 下半透明的饱和色会发灰，所以这里统一写 `in oklab`。

## 备注

- 悬停只改「边线透明度 + 位移 + 投影」三样，没有换底色，这样键盘焦点环（也走同一套令牌）不会与悬停态打架。
- 想让卡片在亮色主题下也成立，只需要把 `--bg-*` 与 `--label*` 换成亮色那一套；百分比不动。
