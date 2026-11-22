---
title: 抽屉按需挂载：打开才渲染，关上就卸载
slug: lazy-mount-drawer
category: 组件
tags: [dialog, transition, 弹窗, 浮层, 点击]
since: 2026-11
source: 取自 DemoLite（demo-app）的 AutoDrawer 组件：触发器 + 抽屉，内容仅在打开时渲染，自行用原生 dialog 重写
when: 抽屉里装着重内容（图表、实时轮询、大表格），不想页面一加载就全部渲染，也不想关上后它还在后台跑
stage: plain
tier: core
---

## 描述

页面上一个「查看详情」的触发器，点它从右侧滑出一个抽屉；抽屉里是一块「实时」内容（这里是一个每秒跳动的计数）。抽屉没开的时候，这块内容根本不存在于页面里——没有 DOM，也没有计时器；关上抽屉，内容被拆掉，计时器停止。

机制是 ==内容用一个函数（工厂）传入，只在打开时调用、关上时丢弃，而不是预先渲染好再用 display 隐藏==。原组件的 `{open && drawerContent()}` 就是这个意思：内容的生命周期绑定到抽屉的开合。预渲染再隐藏看起来更快，但重内容会在页面加载时全部执行一遍，被隐藏的轮询、动画、订阅继续在后台消耗资源。

壳子用原生 `<dialog>`：`showModal()` 免费送出 Esc 关闭、焦点陷阱、背景遮罩（`::backdrop`）与「模态时背后不可交互」。滑入动画用 `@starting-style` 与 `transition` 做入场，不依赖脚本控制类名的时序。

## 代码

```html
<div class="ld">
  <button class="ld-open">查看详情</button>
  <dialog class="ld-drawer" aria-label="详情">
    <header><b>详情</b><button class="ld-close" aria-label="关闭">×</button></header>
    <div class="ld-body"></div>
  </dialog>
</div>
```

```css
.ld { font: 400 13px/1.5 system-ui, sans-serif; color: #1c1a17; }
.ld-open { height: 32px; padding: 0 14px; border: 1px solid #b4462f; border-radius: 8px; background: #b4462f; color: #f7f1e6; font: inherit; cursor: pointer; }

.ld-drawer {
  position: fixed;
  inset: 0 0 0 auto;
  width: 220px;
  height: 100vh;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: #fffdf8;
  color: inherit;
  box-shadow: -10px 0 30px rgb(0 0 0 / 0.25);
  /* @mechanism 入场与退场都靠 transition：dialog 从 display:none 变为打开时，起点由 @starting-style 给 */
  translate: 0 0;
  transition: translate 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), display 0.25s allow-discrete, overlay 0.25s allow-discrete;
}
.ld-drawer:not([open]) { translate: 100% 0; }
@starting-style { .ld-drawer[open] { translate: 100% 0; } }
.ld-drawer::backdrop { background: rgb(0 0 0 / 0.3); }

.ld-drawer header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #e4e6eb; }
.ld-close { border: 0; background: transparent; font-size: 18px; cursor: pointer; }
.ld-body { padding: 14px; }
.ld-body output { display: block; font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
```

```js
const dlg = stage.querySelector('.ld-drawer')
const body = stage.querySelector('.ld-body')
let teardown = null

// @mechanism 内容是个工厂：打开时才调用，返回清理函数；关上时清理并丢弃
function mountContent(host) {
  host.innerHTML = '<p>实时计数（只在抽屉打开时运行）</p><output>0</output>'
  const out = host.querySelector('output')
  let n = 0
  const timer = setInterval(() => { out.textContent = String(++n) }, 1000)
  return () => { clearInterval(timer); host.replaceChildren() }
}

stage.querySelector('.ld-open').addEventListener('click', () => {
  teardown = mountContent(body)
  dlg.showModal()
})
const close = () => dlg.close()
stage.querySelector('.ld-close').addEventListener('click', close)
// close 事件覆盖 Esc、点关闭、dlg.close() 三种路径：清理只写一处
dlg.addEventListener('close', () => { if (teardown) { teardown(); teardown = null } })
dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
```

## 边界

- 清理必须挂在 `close` 事件上，而不是挂在「点关闭按钮」上：Esc 与点遮罩都会关抽屉，只在按钮里清理会漏掉另外两条路，留下仍在跑的计时器。
- 关上就卸载意味着**状态丢失**：用户在抽屉里滚到哪、输入了什么，下次打开都从头来。需要保留时，把状态存到抽屉之外。
- `@starting-style` 与 `allow-discrete` 需要 Chrome 117+ / Safari 17.5+；不支持的环境里抽屉直接出现，没有动画但功能完整。
- 工厂里要把「清理」和「创建」成对写：订阅、计时器、观察者、事件监听，凡是创建了的都要在返回的函数里关掉。漏一个就是泄漏，而且只有反复开关才会暴露。
- 打开时首次渲染的耗时会让用户感到「点了没反应」：内容很重时先显示骨架，再异步填充。
- `showModal()` 之后背景不可交互、焦点被锁在 dialog 内。需要非模态的侧栏（可边看边操作主页面）时用 `show()` 并自己处理 Esc。

## 备注

- 触发器与抽屉分离、触发器只负责「打开」，使同一个抽屉可以由多个入口打开（按钮、行点击、快捷键），而内容工厂可以接收「从哪个入口来」的参数。
