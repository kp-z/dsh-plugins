---
title: 水位气泡：圆内水面与波纹
slug: water-level-bubble
category: 组件
tags: [svg, clip-path, keyframes, 进度, 图表]
since: 2026-11
source: 取自 Cove Task 总览的气泡墙（dsh-cove-task 的 waterBubble），原型是 open_adventure 的 WaterLevel.tsx，改用 CSS 动画重写
when: 想用一个圆表达「还剩多少 / 已用多少」，比进度环更有生命感，适合 3~8 个并排的小指标
stage: dark
tier: core
params:
  - { name: level, label: 水位, type: range, min: 0, max: 100, step: 1, default: 62 }
  - { name: wave, label: 波纹周期, type: range, min: 1, max: 8, step: 0.5, default: 3.5, unit: s }
---

## 描述

一个圆形的气泡，里面有一汪水：水面是一条缓缓平移的波浪线，水位越高、水面越靠上；圆外是一圈细边。并排的几个气泡水位各不相同，一眼能比出高低。

机制是 ==用 clip-path: circle() 把一块「水」裁成圆，水位靠 translate 一个比圆更宽的波形图形==。水是一个 SVG：一条两周期宽的正弦路径 + 它下方的填充矩形，整体比圆宽一倍；水位用 `translate: 0 calc((100 - var(--level)) * 1px)` 往下推多少；波纹则是水平方向循环平移「一个周期的宽度」，首尾无缝。

水位是数据，不是动画：它只在数据变时过渡一次（`transition: translate`），波纹则是永远在跑的装饰。两者分在两个嵌套元素上，各自一个 transform，互不覆盖——如果把它们塞在同一个 `transform` 里，改水位就会打断波纹的相位。

## 代码

```html
<div class="wb-row">
  <!-- @mechanism 单个气泡：外层圆裁切，里层 svg 是水，--level 是唯一数据 -->
  <figure class="wb"><div class="wb-water"><svg viewBox="0 0 200 140" preserveAspectRatio="none"><path d="M0 8 Q25 0 50 8 T100 8 T150 8 T200 8 V140 H0 Z"/></svg></div><figcaption>62</figcaption></figure>
  <figure class="wb" style="--level:30"><div class="wb-water"><svg viewBox="0 0 200 140" preserveAspectRatio="none"><path d="M0 8 Q25 0 50 8 T100 8 T150 8 T200 8 V140 H0 Z"/></svg></div><figcaption>30</figcaption></figure>
  <figure class="wb" style="--level:88"><div class="wb-water"><svg viewBox="0 0 200 140" preserveAspectRatio="none"><path d="M0 8 Q25 0 50 8 T100 8 T150 8 T200 8 V140 H0 Z"/></svg></div><figcaption>88</figcaption></figure>
</div>
```

```css
.wb-row { display: flex; gap: 18px; }

.wb {
  position: relative;
  width: 76px;
  height: 76px;
  margin: 0;
  border: 2px solid color-mix(in oklab, #7c8cff 55%, transparent);
  border-radius: 50%;
  background: color-mix(in oklab, #1d1b2b 90%, transparent);
  /* @mechanism 圆形裁切：水面溢出的部分被裁成圆，不用蒙版也不用 id 引用 */
  clip-path: circle(50%);
  overflow: hidden;
}

.wb-water {
  position: absolute;
  left: 0;
  top: 0;
  width: 200%;
  height: 100%;
  /* @mechanism 水位 = 把整块水往下推 (100 - level)% ；只在数据变时过渡 */
  translate: 0 calc((100 - var(--level, 62)) * 0.72px);
  transition: translate 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.wb-water svg {
  display: block;
  width: 100%;
  height: 100%;
  fill: color-mix(in oklab, #7c8cff 55%, transparent);
  /* @mechanism 波纹：水平平移半个宽度（= 一个整周期组），首尾相接无缝 */
  animation: wb-flow var(--wave, 3.5s) linear infinite;
}
@keyframes wb-flow { to { translate: -50% 0; } }

.wb figcaption {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #eceaf6;
  font: 600 16px/1 system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
}
```

## 边界

- 波形路径的**首尾必须一致**，并且宽度恰好是循环位移量的两倍：路径 200 宽、位移 -50%（100）时，每个周期的曲线相同才能无缝。改了周期数要同步改位移。
- 水位的像素换算（这里 0.72px 每 1%）依赖气泡的高度（76px 减去边框）。改了气泡尺寸这个系数要跟着改——更稳妥是把水位写成 `calc(var(--level) * 1%)` 作用在一个高度等于圆的容器上，用 `translate` 百分比（相对自身）而非像素。
- `prefers-reduced-motion` 下应停掉波纹，仅保留水位。静止的水面依然表达数据。
- 水位 0 时波峰仍会探进圆底一小截，100 时波谷露出圆顶一小截；需要「空」与「满」绝对干净时，在两端把数值钳到 3 与 97，或在端点额外淡出波形。
- 同一页放超过十来个气泡就别让它们都持续动画了：每个都是一个无限动画。可以只让悬停或最重要的那几个动。

## 备注

- 原版用 SMIL 的 `<animate>` 让波浪线上下浮动 2px。SMIL 不受 `prefers-reduced-motion` 管、也不能被 CSS 变量调速，这里换成 CSS 动画是为了让参数能接进来。
