---
title: 风格 · Cove 深色玻璃
slug: style-cove-dark-glass
category: 风格
tags: [color-mix, custom-property, 玻璃, 卡片, 设计系统]
since: 2026-11
source: 取自 Cove Task 的任务总览与洞察面板（dsh-cove-task 的 styles.js），视觉参考 Claude Manager 的深色玻璃卡片，整理成一套可抄的取值
when: 给一个运行在深色宿主里的面板、看板或插件定视觉基调：要现代、克制、有层次，又要跟着宿主明暗走
stage: dark
tier: core
---

## 描述

一套「深色玻璃」的视觉语言：面板底是深色，上面浮着半透明的卡片；大圆角（卡片 14–16px、导航项 12px），大内边距，12px 小字号；交互态只改透明度，选中态是品牌色的 30% 底加 50% 描边；动效短（120–300ms）、缓出曲线统一。

机制是 ==所有颜色都是「少量令牌 × color-mix 百分比」，层级只靠透明度，交互态只改百分比==。不写任何字面量颜色：参考项目里 `bg-white/5`、`border-white/10` 这类写法，被逐一翻译成 `color-mix(in oklab, 标签色 5%, transparent)`。翻译表比风格本身更重要，因为它让这套风格能「换宿主」——宿主的令牌是深色就深色，是浅色就浅色，百分比关系不变。

下面是整套取值的速查，demo 里一块小面板把它们全用了一遍：

- 面板底 = 底色 100%；卡片面 = 层 1 × 92%；次级面 = 层 2 × 88%
- 边线 = 边框色 × 65%；悬停边线 = 边框色 × 82%
- 悬停底 = 标签色 × 5%；选中底 = 品牌 × 30%、选中描边 = 品牌 × 50%
- 品牌渐隐 = 135° 品牌 × 6% → 透明 72%
- 圆角：卡片 14、导航项 12、徽章 6；间距：4 的倍数，卡片内边距 12–16
- 动效：入场 120ms 上浮 4px、逐行递延 20ms；悬停 300ms；曲线 `cubic-bezier(.2,.8,.2,1)`
- 字号：正文 12、标题 13–14（600）、辅助 11、大数字 24（600）

## 代码

```html
<div class="cg">
  <aside class="cg-rail">
    <button class="cg-nav" data-on>总览</button>
    <button class="cg-nav">洞察</button>
  </aside>
  <section class="cg-body">
    <article class="cg-card">
      <header><h4>本周</h4><span class="cg-badge">进行中</span></header>
      <p>12 项任务 · 3 项逾期</p>
    </article>
    <article class="cg-card">
      <header><h4>准时率</h4><span class="cg-badge" data-tone="ok">良好</span></header>
      <p class="cg-num">92%</p>
    </article>
  </section>
</div>
```

```css
.cg {
  /* @mechanism 令牌：全风格只有这 8 个实色，其余都是它们的 color-mix */
  --bg-base: #15131f;
  --bg-1: #1d1b2b;
  --line: #4a4566;
  --brand: #7c8cff;
  --label: #eceaf6;
  --label-2: #9d9ab5;
  --ok: #3ecf8e;
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);

  display: grid;
  grid-template-columns: 74px 1fr;
  width: 310px;
  border: 1px solid color-mix(in oklab, var(--line) 50%, transparent);
  border-radius: 16px;
  background: var(--bg-base);
  color: var(--label);
  font: 400 12px/1.5 system-ui, sans-serif;
  overflow: hidden;
}

.cg-rail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 8px;
  border-right: 1px solid color-mix(in oklab, var(--label) 6%, transparent);
  /* 品牌色 5% 的一团径向光晕 */
  background: radial-gradient(circle at 30% 20%, color-mix(in oklab, var(--brand) 5%, transparent), transparent 70%);
}

.cg-nav {
  height: 34px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: var(--label-2);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.3s var(--ease), color 0.3s var(--ease), border-color 0.3s var(--ease);
}
/* @mechanism 悬停只改百分比：标签色 5% */
.cg-nav:hover { background: color-mix(in oklab, var(--label) 5%, transparent); color: var(--label); }
/* @mechanism 选中 = 品牌 30% 底 + 50% 描边 */
.cg-nav[data-on] {
  background: color-mix(in oklab, var(--brand) 30%, transparent);
  border-color: color-mix(in oklab, var(--brand) 50%, transparent);
  color: color-mix(in oklab, var(--brand) 60%, var(--label));
}

.cg-body { display: grid; gap: 10px; padding: 10px; }

.cg-card {
  padding: 10px 12px;
  border: 1px solid color-mix(in oklab, var(--line) 65%, transparent);
  border-radius: 14px;
  background:
    linear-gradient(135deg, color-mix(in oklab, var(--brand) 6%, transparent), transparent 72%),
    color-mix(in oklab, var(--bg-1) 92%, transparent);
  /* @mechanism 入场：120ms 上浮 4px；用 backwards 而不是 both，否则末帧的 transform 会吃掉悬停位移 */
  animation: cg-rise 120ms var(--ease) backwards;
  transition: transform 0.3s var(--ease), border-color 0.3s var(--ease);
}
.cg-card:nth-child(2) { animation-delay: 20ms; }
.cg-card:hover { transform: translateY(-2px); border-color: color-mix(in oklab, var(--line) 82%, transparent); }
@keyframes cg-rise { from { opacity: 0; transform: translateY(4px); } }

.cg-card header { display: flex; align-items: center; justify-content: space-between; }
.cg-card h4 { margin: 0; font-size: 13px; font-weight: 600; }
.cg-card p { margin: 2px 0 0; color: var(--label-2); }
.cg-num { color: var(--ok) !important; font-size: 24px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; }

.cg-badge {
  --tone: var(--brand);
  padding: 2px 7px;
  border: 1px solid color-mix(in oklab, var(--tone) 36%, transparent);
  border-radius: 6px;
  background: color-mix(in oklab, var(--tone) 12%, transparent);
  color: color-mix(in oklab, var(--tone) 70%, var(--label));
  font-size: 10.5px;
}
.cg-badge[data-tone="ok"] { --tone: var(--ok); }
```

## 边界

- 这套风格**依赖背后有内容或渐变**才显出「玻璃」。纯平的深色底上，半透明卡片只是比底略亮一点的块——好看，但不是玻璃。要保留质感，面板底最好有一层极淡的品牌色渐变。
- `color-mix` 的百分比是相对「叠在什么上面」的，所以每个百分比都是在深色宿主上调出来的。搬到浅色宿主，要把「标签色 5%」这类**提亮**用法换成**压暗**——可以只改一处：把悬停底的混色对象从标签色改成一个由主题给的「反色」令牌。
- 大圆角 + 大内边距的代价是信息密度低。数据密集的页面（大表格、几十行）不要用这套，去用「数据优先」那一条（style-dviz-data-first）。
- 不要给每个元素都加品牌渐隐：渐隐是「这是一张卡」的标记，加在徽章、按钮上会让整个界面都泛着一层紫。

## 备注

- 这一套之所以是「风格」而不是「组件」：它没有一个可以单独抄走的东西，抄走的是取值表。把上面的速查表交给 AI，比交给它一段 CSS 更能让它在别的框架里复现。
- 配套：`glass-card-layers`（卡片的透明度分层）、`nested-nav-groups`（大包小导航）、`tone-badge-mix`（语义徽章）。
