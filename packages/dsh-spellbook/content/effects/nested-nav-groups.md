---
title: 大包小导航：用容器表达层级
slug: nested-nav-groups
category: 组件
tags: [color-mix, border-radius, 导航, 目录, 菜单]
since: 2026-11
source: 取自 Cove Task 左侧 rail 的二级、三级菜单（dsh-cove-task），参考 Cove 的 NavGroup，自行实现
when: 侧栏有「分组 → 项目 → 子项」多层导航，缩进会吃掉文字宽度、竖线又像缩进
stage: dark
tier: core
---

## 描述

侧栏里「看板」下面挂着一组项目，项目下面还有子项。所有行长得**完全一样**——同样的 44px 高、同样的 16px 内边距、同样的 12px 圆角、同样的字号——但外层包着一块更深一点的圆角底，一层包一层。

机制是 ==归属关系由「外层容器包住内层」表达，行本身不缩进、不加竖线、不改字号==。第二层容器是 `白色 3%` 的底，第三层再包一层 `白色 5%`。眼睛看到「这几行在一块底里」，就读出了「它们属于上面那一项」；缩进做同一件事，代价是每深一层少一截项目名宽度。

选中态只给「真正打开的那一页」：品牌色 30% 的底 + 品牌色 50% 的描边。它所在的所有祖先分组只留一层很轻的底（文字变亮），不抢选中态——否则展开两层之后会有三个蓝块同时亮着，用户分不清自己在哪。

## 代码

```html
<nav class="nv" aria-label="示例导航">
  <button class="nv-row" data-parent data-sel>看板</button>
  <!-- @mechanism 一层一个 nv-group，嵌套就是更深的层级 -->
  <div class="nv-group">
    <button class="nv-row">全部项目</button>
    <button class="nv-row">Cove 重构</button>
    <div class="nv-group">
      <button class="nv-row">设计</button>
      <button class="nv-row">前端</button>
    </div>
  </div>
</nav>
```

```css
.nv {
  --brand: #7c8cff;
  --label: #eceaf6;
  --label-2: #9d9ab5;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 232px;
  padding: 12px;
  border-radius: 16px;
  background: color-mix(in oklab, #15131f 92%, transparent);
  font: 500 13px/1 system-ui, sans-serif;
}

.nv-row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 32px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: var(--label-2);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.3s, border-color 0.3s, color 0.3s;
}

.nv-row:hover { background: color-mix(in oklab, var(--label) 5%, transparent); color: var(--label); }

/* @mechanism 选中态 = 品牌色 30% 底 + 50% 描边，只给最深的那一页 */
.nv-row[data-sel] {
  background: color-mix(in oklab, var(--brand) 30%, transparent);
  border-color: color-mix(in oklab, var(--brand) 50%, transparent);
  color: color-mix(in oklab, var(--brand) 60%, var(--label));
}

/* 祖先分组只留很轻的一层底 */
.nv-row[data-parent] { background: color-mix(in oklab, var(--label) 6%, transparent); color: var(--label); }

/* @mechanism 层级就是容器：一层 3% 的底，里面再包就是 5% */
.nv-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: -2px;
  padding: 5px 0;
  border-radius: 12px;
  background: color-mix(in oklab, var(--label) 3%, transparent);
}
.nv-group .nv-group { margin: 0; background: color-mix(in oklab, var(--label) 5%, transparent); }
```

```js
// @mechanism 选中态只切 data-sel，样式层不关心「第几层」
stage.querySelectorAll('.nv-row').forEach((row) => {
  row.addEventListener('click', () => {
    stage.querySelectorAll('.nv-row[data-sel]').forEach((r) => r.removeAttribute('data-sel'))
    row.setAttribute('data-sel', '')
  })
})
```

## 边界

- 容器底色是半透明的，叠在不同底色上观感不同；嵌套超过三层后，5% 再叠 5% 会明显发灰，这时该折叠而不是再包一层。
- 「不缩进」的前提是**每一行都带同宽的图标位或前缀**，让文字落在同一条左缘上。如果有的行有图标、有的没有，文字会参差——要么都有，要么都留同宽空位。
- 容器边框若要画在外面（例如 `inset: -4px` 的伪元素框），不能放在 `overflow: auto` 的滚动容器里——它会被裁掉。要么底部留出 4px，要么把框画在滚动容器外面。
- 键盘用户依赖焦点环来看层级，而这里没有缩进可看；焦点环要用与选中态不同的形状（轮廓线而不是填充）。

## 备注

- 这套结构同样适合设置页的分组、文件树的目录。树非常深时（超过 4 层）才值得回到缩进，因为那时容器嵌套本身也读不清了。
