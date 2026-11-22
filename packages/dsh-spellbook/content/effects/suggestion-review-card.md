---
title: 建议审阅卡：状态一处，样式派生
slug: suggestion-review-card
category: 组件
tags: [color-mix, custom-property, 卡片, 按钮, 点击]
since: 2026-11
source: 取自 Cove Task 的整理建议抽屉（dsh-cove-task 的 OrganizeDrawer，fo-org-item），自行实现
when: AI 给出一批建议，用户要一张张接受或拒绝，并且随时看得出每条处理到哪了
stage: dark
tier: core
---

## 描述

一组建议卡：每张卡顶部是类型徽标（依赖、预期时间、OKR…，各一种色）和置信度，中间是建议内容，底部是「接受 / 拒绝」。接受后卡片描边变成淡绿，拒绝后整张卡退到 60% 透明度并且按钮不可再点；已处理的卡可以「撤销」回到待处理。

机制是 ==每张卡只有一个 data-status 属性，描边、透明度、按钮可用性、撤销按钮的出现全部从它派生==。状态机在 JS 里只有一行赋值（`card.dataset.status = 'accepted'`），样式层不依赖任何额外 class。这样不会出现「视觉上已接受、逻辑上还是待处理」这类两处状态各说各话的错位，也很容易测试：断言 `data-status` 就够了。

类型徽标同样是 `data-kind` → 一个 `--tone` 变量，底、描边、文字三色都从它 `color-mix` 出来（与「语义徽章」同一做法）。置信度用 `tabular-nums` 右对齐，整组卡的数字不会因位数不同而参差。

## 代码

```html
<div class="sg">
  <article class="sg-card" data-kind="dep" data-status="pending">
    <header><span class="sg-kind">依赖</span><em>92%</em></header>
    <p>「接口联调」应当等「方案评审」完成后再开始</p>
    <footer><button data-act="accept">接受</button><button data-act="reject">拒绝</button><button data-act="undo">撤销</button></footer>
  </article>
  <article class="sg-card" data-kind="eta" data-status="pending">
    <header><span class="sg-kind">预期时间</span><em>78%</em></header>
    <p>「回归测试」建议预期完成时间设为 11-28</p>
    <footer><button data-act="accept">接受</button><button data-act="reject">拒绝</button><button data-act="undo">撤销</button></footer>
  </article>
</div>
```

```css
.sg { display: grid; gap: 8px; width: 300px; font: 400 12px/1.5 system-ui, sans-serif; color: #eceaf6; }

.sg-card {
  --tone: #7c8cff;
  padding: 10px 12px;
  border: 1px solid color-mix(in oklab, #4a4566 65%, transparent);
  border-radius: 12px;
  background: color-mix(in oklab, #1d1b2b 92%, transparent);
  transition: border-color 0.2s, opacity 0.2s;
}
.sg-card[data-kind="eta"] { --tone: #3ecf8e; }

.sg-card header { display: flex; align-items: center; gap: 8px; }
.sg-kind {
  padding: 1px 7px;
  border: 1px solid color-mix(in oklab, var(--tone) 30%, transparent);
  border-radius: 6px;
  background: color-mix(in oklab, var(--tone) 12%, transparent);
  color: var(--tone);
  font-size: 10.5px;
}
.sg-card em { margin-left: auto; color: #9d9ab5; font-style: normal; font-variant-numeric: tabular-nums; }
.sg-card p { margin: 6px 0 8px; }

.sg-card footer { display: flex; gap: 6px; }
.sg-card button {
  height: 24px;
  padding: 0 10px;
  border: 1px solid color-mix(in oklab, #4a4566 80%, transparent);
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.sg-card button:hover:not(:disabled) { background: color-mix(in oklab, #eceaf6 7%, transparent); }
.sg-card button[data-act="accept"] { border-color: color-mix(in oklab, var(--tone) 45%, transparent); color: var(--tone); }

/* @mechanism 状态只有 data-status 一处；下面所有视觉都从它派生 */
.sg-card[data-status="accepted"] { border-color: color-mix(in oklab, #3ecf8e 34%, transparent); }
.sg-card[data-status="rejected"] { opacity: 0.6; }
.sg-card:not([data-status="pending"]) [data-act="accept"],
.sg-card:not([data-status="pending"]) [data-act="reject"] { display: none; }
.sg-card[data-status="pending"] [data-act="undo"] { display: none; }
```

```js
// @mechanism 全部状态变更就是一行赋值，样式自己跟着变
stage.querySelectorAll('.sg-card').forEach((card) => {
  card.addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.act
    if (!act) return
    card.dataset.status = act === 'accept' ? 'accepted' : act === 'reject' ? 'rejected' : 'pending'
  })
})
```

## 边界

- 「已拒绝」只降透明度、不隐藏：用户要能看见自己拒绝过什么，并且能撤销。直接移除会让误点变成不可逆。
- `opacity: 0.6` 作用在整张卡上，文字对比度会随之下降。已拒绝的卡仍可能需要被读（比如复核），要保证降到 60% 后仍达 WCAG 的 4.5:1，否则只降描边与底色、保留文字。
- 状态变更要和后端同步时，视觉上先乐观更新，失败再回滚 `data-status`；这一步要有可见的失败提示，别静默回弹。
- `data-status` 的取值集合要在一处定义（常量），样式里的字符串与 JS 里的字符串靠人眼对不上，拼写错了不会报错只会没效果。
- 批量操作（「全部接受」）要只作用于 `pending` 的卡，不能覆盖已拒绝的——否则用户的显式决定被一键冲掉。

## 备注

- 卡片内按钮靠事件委托（挂在 card 上、读 `data-act`），卡片是动态追加时不需要给新卡重新绑事件。
