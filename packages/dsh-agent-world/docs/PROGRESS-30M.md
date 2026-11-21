# PROGRESS

## 2026-11-21 19:00 · 第 13 个半小时（Phaser 只自动启动第一个场景）

**读到的 Phaser 内部逻辑**：
```js
for (p = 0; p < f.length; p++) this._pending.push({ key: "default", scene: f[p], autoStart: p === 0 });
...
(d.autoStart || b.sys.settings.active) && this._start.push(f)
```
**只有第一个场景会 autoStart**；其余必须显式 `scene.start()`。

**推论**：既然我们的第一个场景是 `company`（committedScene 命中了 `initialSceneKey`），
它应该被自动启动、执行 preload、请求 `/assets/maps/company/background.png`。
但实际一次请求都没有 → **preload 在执行到 `load.image(...)` 之前就中断了**。

**preload 的开头是**：
```js
preload() {
  this.preloadCommonAssets(), i9(this),
  g === "farm" && (B_(this), tO(this), nO(this)),
  this.textures.exists(...) || this.load.image(..., ni(`${this.mapBase}/background.png`))
  ...
}
```
所以中断点在 `preloadCommonAssets()` 或 `i9(this)`——**在加载地图贴图之前**。

**下一轮（19:00）**：读 `preloadCommonAssets` 与 `i9`，看它们依赖什么。
这两个函数很可能要求"通用素材"（角色帧、气泡、UI 图集）先注册，
缺一个就抛，导致整个 preload 中断——这与我们在 HUD 里遇到过的
`character_generator` / `portrait_generator` 缺失是同一类问题。
