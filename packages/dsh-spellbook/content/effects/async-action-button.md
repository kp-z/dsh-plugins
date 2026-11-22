---
title: 异步按钮：执行中自动锁定
slug: async-action-button
category: 组件
tags: [focus, 按钮, 加载, 点击, 键盘]
since: 2026-11
source: 取自 DemoLite（demo-app）的 LoadingBtn 组件：把 onClick 包进一个异步调用，自动给出 loading，自行用原生 JS 重写
when: 按钮点下去要发请求，用户容易连点；不想在每个按钮上手写 loading 状态与防重复提交
stage: plain
tier: core
---

## 描述

一个「保存」按钮：点一下，按钮里出现转圈、文字变成「保存中…」，期间再点没有任何反应；请求成功后恢复成原样并闪一下「已保存」，请求失败时恢复并报错。点击处理函数只管写业务，不用关心 loading。

机制是 ==用一个包装函数接管点击：把业务处理器当成返回 Promise 的函数，执行前锁住按钮（aria-busy + disabled 语义），无论成功失败都在 finally 里解锁==。原组件 `LoadingBtn` 就是这样：业务侧传一个 `onClick`，包装层用 `useAsync` 管 `loading`。好处是**每个按钮都自动正确**，不会因为某个人忘了加 `setLoading(false)` 而留下一个永远转圈的按钮。

锁用 `aria-busy="true"` 而不是真的 `disabled`：禁用的按钮会失去焦点，键盘用户按下回车后焦点突然丢到页面顶部；保留焦点 + `aria-busy` + 忽略重复点击，焦点不丢，读屏器也能念出「忙碌」。

## 代码

```html
<div class="ab">
  <button class="ab-btn" data-demo="ok"><i class="ab-spin" hidden></i><span>保存</span></button>
  <button class="ab-btn ab-ghost" data-demo="fail"><i class="ab-spin" hidden></i><span>保存（会失败）</span></button>
  <p class="ab-log" role="status"></p>
</div>
```

```css
.ab { display: grid; gap: 10px; justify-items: start; font: 400 13px/1.4 system-ui, sans-serif; color: #1c1a17; }

.ab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid #b4462f;
  border-radius: 8px;
  background: #b4462f;
  color: #f7f1e6;
  font: inherit;
  cursor: pointer;
  transition: opacity 0.15s;
}
.ab-ghost { background: transparent; color: #b4462f; }
.ab-btn:focus-visible { outline: 2px solid #b4462f; outline-offset: 2px; }

/* @mechanism 忙碌态由 aria-busy 驱动：保留焦点，样式只降低存在感 */
.ab-btn[aria-busy="true"] { opacity: 0.7; cursor: progress; }

.ab-spin {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ab-spin 0.7s linear infinite;
}
.ab-spin[hidden] { display: none; }
@keyframes ab-spin { to { rotate: 360deg; } }

.ab-log { min-height: 18px; margin: 0; color: #5c6070; }
```

```js
const log = stage.querySelector('.ab-log')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// @mechanism 包装：把任何 async 处理器变成「自带 loading、防重复」的点击处理
function withBusy(button, handler) {
  button.addEventListener('click', async (e) => {
    if (button.getAttribute('aria-busy') === 'true') return // 忙碌中：忽略重复点击
    const label = button.querySelector('span')
    const spin = button.querySelector('.ab-spin')
    const original = label.textContent
    button.setAttribute('aria-busy', 'true')
    spin.hidden = false
    label.textContent = '处理中…'
    try {
      await handler(e)
    } finally {
      // 无论成功失败都解锁：永远不会留下一个转圈的死按钮
      button.removeAttribute('aria-busy')
      spin.hidden = true
      label.textContent = original
    }
  })
}

stage.querySelectorAll('.ab-btn').forEach((btn) => {
  withBusy(btn, async () => {
    log.textContent = ''
    await wait(1200)
    log.textContent = btn.dataset.demo === 'fail' ? '保存失败：网络超时' : '已保存'
  })
})
```

## 边界

- `finally` 里解锁是整个组件成立的前提。如果只在成功分支解锁，请求一失败按钮就永远转圈——这是最常见的 loading 按钮 bug。
- 处理器抛出的错误会在 `click` 的异步回调里变成 unhandled rejection（示例里为了简洁，失败也是正常返回并写一行提示）。生产里要么在包装层捕获并展示，要么交给全局错误处理；示例里只是让它冒泡到控制台。
- 忽略重复点击是在**事件处理里**判的，不是靠按钮 `disabled`。键盘用户按住回车会不断触发 `click`，没有这个判断就会连发请求。
- 同一份业务逻辑如果能从别处触发（快捷键、菜单项），锁要放在业务函数里而不是按钮上，否则绕过按钮的路径不受保护。
- 长耗时操作（>5 秒）光有转圈不够，应给出进度或可取消；转圈只表达「还在」，不表达「还要多久」。
- 要保证按钮宽度在文字切换时不抖动：给 `min-width`，或让 loading 文案与原文字等宽，否则一点击布局就跳。

## 备注

- 与 `copy-feedback-inline` 是同一族：那条讲「完成后给准话」，这条讲「进行中不重复」。两者合起来是一个按钮完整的异步生命周期：空闲 → 忙碌 → 成功/失败 → 空闲。
