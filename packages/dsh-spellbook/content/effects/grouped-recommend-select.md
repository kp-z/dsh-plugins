---
title: 分组下拉：推荐置顶，其余去重
slug: grouped-recommend-select
category: 组件
tags: [select, appearance, 选择, 表单, 菜单]
since: 2026-11
source: 取自 DemoLite（demo-app）的 AIModelSelect 组件：Recommend 与 All 两个分组，All 里剔除已在推荐里的项，自行用原生 select 重写
when: 选项很多（几十个模型、几十个版本），用户 90% 的时候只要几个常用的，但仍要能选到全部
stage: plain
tier: core
---

## 描述

一个模型选择框：打开后上面是「推荐」几项，下面是「全部」；同一个模型不会在两组里各出现一次，推荐里有的，「全部」里就没有。推荐列表还没加载回来时，「全部」照常可用；两组都没有数据时，下拉是空的而不是出现两个空标题。

机制是 ==先把推荐项放进一个 Set，再从全部里把 Set 里有的剔掉，两组合在一起恰好等于全集，且互不重复==。原组件正是这样：`all` 先收齐推荐与全部，构造推荐组时逐项从 `all` 里 `delete`，剩下的就是「全部」组。结果是用户既能一眼拿到常用的，又不会看到同一个名字出现两遍而困惑「这是两个不同的东西吗」。

原生 `<select>` 的 `<optgroup>` 就是分组：键盘导航、读屏器、移动端的原生选择器都是现成的。只在某一组非空时才生成该组，空组不渲染标题。

## 代码

```html
<label class="gs">
  <span>模型</span>
  <select class="gs-select"></select>
</label>
<p class="gs-picked"></p>
```

```css
.gs { display: grid; gap: 4px; font: 400 12px/1.4 system-ui, sans-serif; color: #5c6070; }
.gs-select {
  width: 220px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #c9ccd6;
  border-radius: 8px;
  background: #fff;
  color: #1a1d27;
  font: inherit;
  font-size: 13px;
}
.gs-select:focus-visible { outline: 2px solid #1f4ead; outline-offset: 1px; }
.gs-picked { margin: 8px 0 0; color: #5c6070; font: 400 12px/1.4 system-ui, sans-serif; }
```

```js
const select = stage.querySelector('.gs-select')
const picked = stage.querySelector('.gs-picked')

// 模拟两个独立到达的数据源
const recommend = ['gpt-4o', 'claude-sonnet', 'deepseek-chat']
const everything = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet', 'claude-haiku', 'deepseek-chat', 'deepseek-reasoner', 'qwen-max']

// @mechanism 先收齐，再让推荐组逐项从「全部」里剔除：两组互不重复，合起来恰好是全集
function buildOptions(recommendList, allList) {
  const rest = new Set([...recommendList, ...allList])
  const groups = []
  if (recommendList.length) {
    groups.push({ label: '推荐', items: recommendList.map((x) => (rest.delete(x), x)) })
  }
  if (rest.size) groups.push({ label: '全部', items: [...rest] })
  return groups
}

function render(groups) {
  select.replaceChildren()
  for (const g of groups) {
    const og = document.createElement('optgroup')
    og.label = g.label
    for (const item of g.items) {
      const o = document.createElement('option')
      o.value = o.textContent = item
      og.appendChild(o)
    }
    select.appendChild(og)
  }
  picked.textContent = '当前：' + (select.value || '（无）')
}

select.addEventListener('change', () => { picked.textContent = '当前：' + select.value })
render(buildOptions(recommend, everything))
```

## 边界

- 去重的键必须是**稳定标识**（模型 id），不能是显示名。两个不同的模型显示名相同（比如「默认」）时，用名字去重会吞掉其中一个。
- 推荐数据与全量数据是**独立请求**，到达顺序不定。渲染函数必须接受任意一方为空（空数组、undefined），而不是等两边都到齐才渲染——否则一方失败，整个下拉就空了。
- 当前选中值如果不在任何一组里（比如推荐列表刷新后把它拿掉了），`select.value` 会悄悄回落到第一项。需要保留时，把当前值作为单独的一项补进去。
- `<optgroup>` 的样式能力很弱（各平台原生渲染）。要自定义外观（图标、说明、搜索）就得换成自绘的 combobox，那时要自己负责键盘与读屏。
- 选项数达到几百个时，原生 select 没有搜索框；这时分组之外要加搜索，不是更多分组。

## 备注

- 「推荐置顶 + 全集兜底」的结构适用于任何长列表选择：最近使用、常用标签、模板。置顶那一组本身要有上限（通常 ≤5），否则它也变成一个长列表。
