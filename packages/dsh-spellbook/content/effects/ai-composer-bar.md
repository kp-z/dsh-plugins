---
title: AI 输入框：方键 + 自增高 + 回车发送
slug: ai-composer-bar
category: 组件
tags: [focus, 输入, 菜单, 按钮, 键盘]
since: 2026-11
source: 取自 Cove Task 建议栏底部的 agent composer（dsh-cove-task），形态参考 Cove 的 agent 输入框，自行实现
when: 给侧栏或抽屉做一个「说一句话让 AI 重来」的输入框，要紧凑，又要能临时展开多写几句
stage: dark
tier: core
---

## 描述

底部一条输入栏：左边两颗等大的方形按钮（工具、模式），中间是文本框，右边是发送。工具菜单里能「展开输入框」，展开后文本框变成多行；模式菜单切换后，占位文案和模式图标一起变。回车发送，Shift+回车换行。

机制是 ==两颗方键各自挂一个弹出菜单，文本框只负责文字，发送手势由 keydown 统一判==。方键与文本框、发送键同一行（`display: flex; align-items: flex-end`），文本框增高时按钮贴着底边，不会飘到中间；展开只是切一个 `is-expanded` 类让文本框的最小高度从一行变成四行，而不是换一个组件。

菜单项是「图标 + 名称 + 一行说明」三件套，当前项右侧一个小圆点。这样 34×34 的按钮上不用写字，意思由菜单告诉用户，按钮本身干净。发送手势的细节是：输入法组词中（`event.isComposing`）的回车只是确认候选字，不能当成发送——中文用户一天会撞上很多次。

## 代码

```html
<div class="cp">
  <div class="cp-row">
    <div class="cp-slot">
      <button class="cp-square" data-menu="tools" aria-label="工具" aria-haspopup="menu">⚙</button>
      <!-- @mechanism 菜单是按钮的兄弟节点，绝对定位在按钮上方；一次只开一个 -->
      <div class="cp-menu" data-for="tools" role="menu" hidden>
        <button class="cp-item" role="menuitem" data-act="expand"><b>展开输入框</b><small>多写几句要求</small></button>
        <button class="cp-item" role="menuitem" data-act="clear"><b>清空</b><small>丢掉当前草稿</small></button>
      </div>
    </div>
    <div class="cp-slot">
      <button class="cp-square" data-menu="mode" aria-label="模式" aria-haspopup="menu">◎</button>
      <div class="cp-menu" data-for="mode" role="menu" hidden>
        <button class="cp-item" role="menuitem" data-mode="全部"><b>全部任务</b><small>在所有任务里整理</small></button>
        <button class="cp-item" role="menuitem" data-mode="当前"><b>当前项目</b><small>只看选中的项目</small></button>
      </div>
    </div>
    <textarea class="cp-input" rows="1" placeholder="告诉 AI 想怎么整理…"></textarea>
    <button class="cp-send" aria-label="发送">↑</button>
  </div>
  <p class="cp-hint">Enter 发送 · Shift+Enter 换行</p>
  <p class="cp-log" aria-live="polite"></p>
</div>
```

```css
.cp {
  --brand: #7c8cff;
  --label: #eceaf6;
  --label-2: #9d9ab5;
  width: 300px;
  padding: 10px;
  border: 1px solid color-mix(in oklab, #4a4566 70%, transparent);
  border-radius: 16px;
  background: color-mix(in oklab, #1d1b2b 92%, transparent);
  color: var(--label);
  font: 400 12px/1.5 system-ui, sans-serif;
}

/* @mechanism 同一行、底对齐：文本框长高时按钮留在底边 */
.cp-row { display: flex; align-items: flex-end; gap: 6px; }
.cp-slot { position: relative; flex: none; }

.cp-square, .cp-send {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid color-mix(in oklab, #4a4566 70%, transparent);
  border-radius: 10px;
  background: transparent;
  color: var(--label-2);
  font-size: 15px;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s, border-color 0.2s;
}
.cp-square:hover, .cp-square[aria-expanded="true"], .cp.is-expanded [data-menu="tools"] {
  background: color-mix(in oklab, var(--brand) 18%, transparent);
  border-color: color-mix(in oklab, var(--brand) 40%, transparent);
  color: var(--label);
}
.cp-send { background: var(--brand); border-color: var(--brand); color: #101020; font-weight: 700; }

.cp-input {
  flex: 1;
  min-width: 0;
  height: 34px;
  max-height: 120px;
  padding: 7px 10px;
  border: 1px solid color-mix(in oklab, #4a4566 70%, transparent);
  border-radius: 10px;
  background: color-mix(in oklab, #15131f 60%, transparent);
  color: inherit;
  font: inherit;
  resize: none;
}
.cp-input:focus { outline: none; border-color: color-mix(in oklab, var(--brand) 55%, transparent); }
/* @mechanism 展开 = 切一个类，最小高度从一行变四行 */
.cp.is-expanded .cp-input { height: 92px; }

.cp-menu {
  position: absolute;
  left: 0;
  bottom: 40px;
  z-index: 3;
  width: 190px;
  padding: 4px;
  border: 1px solid color-mix(in oklab, #4a4566 80%, transparent);
  border-radius: 12px;
  background: #1d1b2b;
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.45);
}
.cp-menu[hidden] { display: none; }
.cp-item {
  display: grid;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--label);
  text-align: left;
  cursor: pointer;
}
.cp-item:hover { background: color-mix(in oklab, var(--label) 7%, transparent); }
.cp-item b { font-size: 12px; font-weight: 500; }
.cp-item small { color: var(--label-2); font-size: 11px; }

.cp-hint { margin: 6px 2px 0; color: var(--label-2); font-size: 11px; }
.cp-log { min-height: 16px; margin: 2px 2px 0; color: color-mix(in oklab, var(--brand) 70%, var(--label)); }
```

```js
const cp = stage.querySelector('.cp')
const input = cp.querySelector('.cp-input')
const log = cp.querySelector('.cp-log')
let mode = '全部'

function closeMenus() {
  cp.querySelectorAll('.cp-menu').forEach((m) => (m.hidden = true))
  cp.querySelectorAll('[data-menu]').forEach((b) => b.setAttribute('aria-expanded', 'false'))
}

cp.querySelectorAll('[data-menu]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    const menu = cp.querySelector('[data-for="' + btn.dataset.menu + '"]')
    const willOpen = menu.hidden
    closeMenus()
    menu.hidden = !willOpen
    btn.setAttribute('aria-expanded', String(willOpen))
  })
})
document.addEventListener('click', closeMenus)

cp.querySelector('[data-act="expand"]').addEventListener('click', () => { cp.classList.toggle('is-expanded'); closeMenus(); input.focus() })
cp.querySelector('[data-act="clear"]').addEventListener('click', () => { input.value = ''; closeMenus() })
cp.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  mode = b.dataset.mode
  input.placeholder = mode === '全部' ? '告诉 AI 想怎么整理…' : '只整理当前项目…'
  closeMenus()
}))

function send() {
  const text = input.value.trim()
  if (!text) return
  log.textContent = '已发送（' + mode + '）：' + text
  input.value = ''
}
// @mechanism 发送手势统一在 keydown 里判：组词中的回车不算，Shift+回车换行
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() }
})
cp.querySelector('.cp-send').addEventListener('click', send)
```

## 边界

- `event.isComposing` 必须判。中文、日文输入法在组词时按回车是「确认候选」，不判的话每次选字都会把半句话发出去。
- 菜单绝对定位在方键上方（`bottom: 40px`）。输入框贴着容器底部时向上展开没问题；如果输入框在页面顶部，要改成向下，否则菜单会被裁出视口。
- 菜单开着时，点别处要关；这里挂在 `document` 上，嵌进别的组件时要确认没有谁在冒泡阶段吞掉了点击。
- `textarea` 的高度这里用「一行 / 四行」两档切换。想做成随内容自增高，现代浏览器可以用 `field-sizing: content`，但要带 `max-height` 兜住，否则一粘贴长文就把整栏撑出屏幕。
- 发送后要把焦点留在输入框里；示例为了简洁没有展示「发送中」态，真实场景里生成期间应禁用输入并换占位文案，避免重复提交。

## 备注

- 工具/模式两颗方键的「图标 + 名称 + 说明」菜单结构，可以直接复用到任何需要「按钮上不写字、意思放进菜单」的紧凑工具栏。
- 底部的 `Enter 发送 · Shift+Enter 换行` 提示行是常驻的：手势没有可见的提示，用户就只能靠试。
