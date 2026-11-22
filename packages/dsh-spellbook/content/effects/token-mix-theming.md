---
title: 风格 · 令牌 + color-mix 的换肤法
slug: token-mix-theming
category: 风格
tags: [color-mix, custom-property, oklch, 色彩, 设计系统]
since: 2026-11
source: 取自 Cove Task 的「零字面量颜色」约束（dsh-cove-task 的 styles.js 与其样式测试），自行整理成通用做法
when: 组件要放进别人的宿主（插件、嵌入页、多主题应用），宿主的明暗与品牌色你控制不了
stage: plain
tier: core
params:
  - { name: hue, label: 品牌色相, type: range, min: 0, max: 360, step: 5, default: 265 }
---

## 描述

同一个小面板并排放两份，一份套深色令牌、一份套浅色令牌；面板里的卡片、徽章、按钮、悬停、选中态一行没改，却各自长在各自的主题里。拖「品牌色相」，两份面板的强调色同时转，所有由品牌色派生的底、边、渐隐一起跟着转。

机制是 ==组件只引用语义令牌，所有「半透明 / 变深 / 变浅」一律用 color-mix 从令牌现算，代码里不出现一个字面量颜色==。换主题等于换令牌的值；换品牌色等于换一个令牌。这是 Cove 插件放在不同 DSH 宿主（深、浅、各种品牌）里仍然协调的原因，它甚至被写成了测试：样式源码里出现字面量颜色就失败，令牌集合是固定的 14 个，多一个少一个都红。

两个细节让它成立。其一，品牌色用 `oklch()` 写：`oklch(0.68 0.16 var(--hue))` 转色相时明度与彩度保持不变，所以转到黄色、绿色也不会突然刺眼或发灰；HSL 的黄比蓝亮得多，转色相会让对比度乱掉。其二，派生色统一写 `in oklab` 插值，混出的中间色不会像 sRGB 那样发灰发脏。

## 代码

```html
<div class="tk-pair">
  <section class="tk-panel" data-theme="dark">
    <h4>深色</h4>
    <div class="tk-card"><span>本周完成</span><b>42</b></div>
    <span class="tk-badge">进行中</span>
    <button class="tk-btn">主操作</button>
  </section>
  <section class="tk-panel" data-theme="light">
    <h4>浅色</h4>
    <div class="tk-card"><span>本周完成</span><b>42</b></div>
    <span class="tk-badge">进行中</span>
    <button class="tk-btn">主操作</button>
  </section>
</div>
```

```css
.tk-pair { display: flex; gap: 10px; }

/* @mechanism 令牌层：每个主题只提供这几个实色；品牌色用 oklch，转色相不改明度 */
.tk-panel {
  --brand: oklch(0.68 0.16 var(--hue, 265));
  --bg: #15131f;
  --layer: #1d1b2b;
  --line: #4a4566;
  --text: #eceaf6;
  --text-2: #9d9ab5;
}
.tk-panel[data-theme="light"] {
  --brand: oklch(0.52 0.18 var(--hue, 265));
  --bg: #f5f6f8;
  --layer: #ffffff;
  --line: #c9ccd6;
  --text: #1a1d27;
  --text-2: #5c6070;
}

/* —— 以下是组件层：只引用令牌，没有字面量颜色 —— */
.tk-panel {
  display: grid;
  gap: 8px;
  align-content: start;
  width: 140px;
  padding: 10px;
  border: 1px solid color-mix(in oklab, var(--line) 60%, transparent);
  border-radius: 12px;
  background: var(--bg);
  color: var(--text);
  font: 400 12px/1.4 system-ui, sans-serif;
}
.tk-panel h4 { margin: 0; font-size: 12px; font-weight: 600; }

.tk-card {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 10px;
  border: 1px solid color-mix(in oklab, var(--line) 65%, transparent);
  border-radius: 10px;
  /* @mechanism 品牌渐隐、卡片面全是令牌的百分比，主题与品牌色一起换，这里一行不动 */
  background:
    linear-gradient(135deg, color-mix(in oklab, var(--brand) 10%, transparent), transparent 70%),
    color-mix(in oklab, var(--layer) 92%, transparent);
}
.tk-card span { color: var(--text-2); }
.tk-card b { font-size: 18px; font-variant-numeric: tabular-nums; }

.tk-badge {
  justify-self: start;
  padding: 2px 8px;
  border: 1px solid color-mix(in oklab, var(--brand) 40%, transparent);
  border-radius: 6px;
  background: color-mix(in oklab, var(--brand) 14%, transparent);
  color: color-mix(in oklab, var(--brand) 75%, var(--text));
}

.tk-btn {
  height: 28px;
  border: 1px solid color-mix(in oklab, var(--brand) 50%, transparent);
  border-radius: 8px;
  background: color-mix(in oklab, var(--brand) 26%, transparent);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.tk-btn:hover { background: color-mix(in oklab, var(--brand) 36%, transparent); }
```

## 边界

- 令牌**自己**仍是字面量——它们必须在某处被定义。这条约束的意思是「组件层不写颜色」，不是「全世界没有颜色」。在宿主里，令牌由宿主提供；独立运行时要有一份兜底值，否则 `var(--x)` 解析失败会让 `stroke`、`background` 整个失效（SVG 边会整条消失），而且不报错。
- 令牌必须有**回退链**：宿主的某个版本可能没有 `--border-l1`，回退到 `--border-l2` 或次要文字色，而不是回退到字面量。回退的仍是令牌，才不违反约束。
- 浅色与深色**不能共用同一组百分比**：深色上「标签色 5%」是提亮，浅色上是压暗，视觉重量不同。两套主题都要实际看一遍，必要时让百分比也成为令牌。
- `oklch()` 的色相环不是均匀的：某些色相（例如接近 140°–180° 的绿青）在高彩度下会超出 sRGB 色域被钳制，看起来「转不动」。需要时降低彩度，或用 `@supports (color: oklch(0 0 0))` 兜底。
- `color-mix` 需要 Chrome 111+ / Safari 16.2+ / Firefox 113+。更老的环境没有回退，要在支持范围里确认。

## 备注

- 把「字面量颜色会让测试失败」写成断言是这套做法能长期成立的关键：规则写在文档里会被慢慢破坏，写在测试里就不会。
- 与 `light-dark-pair` 的区别：那一条讲怎么让一个值随系统明暗切换；这一条讲整个组件库怎么只依赖令牌，主题与品牌色都能换。
