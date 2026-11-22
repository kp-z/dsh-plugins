---
title: 任务卡：色条、徽标与呼吸环
slug: priority-task-card
category: 组件
tags: [keyframes, custom-property, box-shadow, 卡片, 徽章]
since: 2026-11
source: 取自 Cove Task 面板的任务卡（dsh-cove-task 的 taskCardStyles），自行实现
when: 一列任务要在不展开的前提下一眼分出优先级、谁在跑、谁有新消息
stage: dark
tier: core
params:
  - { name: dur, label: 呼吸周期, type: range, min: 0.8, max: 3, step: 0.1, default: 1.6, unit: s }
---

## 描述

一列紧凑的任务卡：标题一行省略，左边一道 3px 的优先级色条（P0 红、P1 橙、P2 蓝、P3 灰），标题前一个同色的小徽标；正在运行的任务徽标外面套一圈呼吸的环；有未读更新的任务徽标右上角一个绿点。

机制是 ==把状态放在 data-* 属性上，样式只读属性选择器，不在样式里算任何逻辑==。`data-priority="P0"` 同时决定色条颜色与徽标底色；`.is-running` 只负责加一个伪元素环；`.is-unread` 只负责加另一个伪元素点。三个状态互不干扰，可以任意组合——最坏的情况是同一个徽标既在跑又有未读，两个伪元素分别占 `::before` 与 `::after`，各管各的。

呼吸环用 `inset: -3px` 的伪元素 + `opacity` 与 `transform: scale` 的关键帧，而不是动画 `box-shadow`——阴影每帧都要重绘，一列十几张卡同时呼吸就能感到卡顿；透明度和缩放交给合成器。P0 另外多一圈 18% 的静态光晕，「最紧急」不靠动，靠常亮。

## 代码

```html
<div class="tk-list">
  <!-- @mechanism 状态全在属性/类上：优先级 data-priority，运行与未读是类 -->
  <article class="tk" data-priority="P0">
    <span class="tk-prio is-running">P0</span>
    <div class="tk-main"><b>修复同步任务丢失</b><small>运行中 · 3 分钟前</small></div>
  </article>
  <article class="tk" data-priority="P1">
    <span class="tk-prio is-unread">P1</span>
    <div class="tk-main"><b>评审 Cove 洞察页方案</b><small>有 2 条新评论</small></div>
  </article>
  <article class="tk" data-priority="P2">
    <span class="tk-prio">P2</span>
    <div class="tk-main"><b>整理周报模板</b><small>未开始</small></div>
  </article>
</div>
```

```css
.tk-list {
  display: grid;
  gap: 8px;
  width: 280px;
  font: 400 12px/1.4 system-ui, sans-serif;
  color: #eceaf6;
}

.tk {
  --c: #8b8f9a;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px 9px 8px;
  border: 1px solid color-mix(in oklab, #4a4566 65%, transparent);
  border-left: 3px solid var(--c);
  border-radius: 10px;
  background: color-mix(in oklab, #1d1b2b 92%, transparent);
  transition: border-color 0.15s, transform 0.15s;
}
.tk:hover { transform: translateY(-1px); border-color: color-mix(in oklab, #4a4566 90%, transparent); border-left-color: var(--c); }

/* @mechanism 一个变量 --c 既画色条又染徽标，优先级只在这里翻译成颜色 */
.tk[data-priority="P0"] { --c: #e5484d; }
.tk[data-priority="P1"] { --c: #f59e0b; }
.tk[data-priority="P2"] { --c: #3b82f6; }
.tk[data-priority="P3"] { --c: #94a3b8; }

.tk-prio {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  min-width: 28px;
  height: 20px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--c);
  color: #fff;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
}
.tk[data-priority="P0"] .tk-prio { box-shadow: 0 0 0 3px color-mix(in oklab, var(--c) 18%, transparent); }

/* @mechanism 运行环：伪元素 + opacity/scale 关键帧，不动画 box-shadow */
.tk-prio.is-running::before {
  content: '';
  position: absolute;
  inset: -4px;
  border: 2px solid #7c8cff;
  border-radius: 9px;
  pointer-events: none;
  animation: tk-breathe var(--dur, 1.6s) ease-in-out infinite;
}
@keyframes tk-breathe {
  0%, 100% { opacity: 0.15; transform: scale(0.94); }
  50% { opacity: 0.9; transform: scale(1.04); }
}

/* 未读点：另一个伪元素，与运行环互不占位 */
.tk-prio.is-unread::after {
  content: '';
  position: absolute;
  top: -4px;
  right: -4px;
  width: 8px;
  height: 8px;
  border: 2px solid #1d1b2b;
  border-radius: 50%;
  background: #3ecf8e;
}

.tk-main { display: grid; min-width: 0; }
.tk-main b { overflow: hidden; font-size: 12.5px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.tk-main small { color: #9d9ab5; font-size: 11px; }
```

## 边界

- 色条用 `border-left` 而不是伪元素，是为了让它跟着圆角走；代价是左边框变粗后内容会右移 2px，所以左内边距要比右边少 2px 来抵消。
- 呼吸环如果被父级的 `overflow: hidden` 裁掉就看不见了。徽标要离卡片边缘至少留出 4px，或者让环画在 `overflow: visible` 的层里。
- 颜色**不能是唯一的信号**：P0 与 P2 对色盲用户可能分不清，所以徽标里始终写着 P0/P1 的文字。色条是加速扫读用的，不是信息本身。
- `prefers-reduced-motion` 下应该关掉呼吸，仅保留静态的环（opacity 0.7）——运行状态依然可见，只是不动。

## 备注

- 把「运行 / 未读 / 逾期」这类互斥性不强的状态拆成独立的类，比用一个 `data-state` 枚举更耐用：同时成立时不需要新增组合态。
