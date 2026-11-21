# PROGRESS

## 2026-11-21 18:00 · 第 11 个半小时（场景注册表是好的）

**查了什么**：`chrome.fishtank.boot_failed` 的触发链 + 场景注册表。

**结论（三条硬事实）**：
1. `Gd(sceneKey)` 会用 `js[Hs(key)]` 查静态注册表；**`company` 确实在里面**
   （注册表 32 个键：world_map/home_public/…/company/park/beach），所以场景构造不会抛；
2. `Hs()` 的归一化规则是：`js[key]` → 直接用；否则把 key 当 **place id** 去 `Tr[key].scene_asset`；
   所以**两套 id 混用的雷还埋在这儿**——一旦某个值不是注册键，就会被当成 place id 再去查一次；
3. Image 构造 0 次、`createElement('img')` 0 次，但 `src` setter 被调用 67 次（都是 DOM 里的 <img>）。

**所以**：Phaser 的 loader 确实一个文件都没加。场景实例建出来了，但没被"启动"到 preload。

**下一轮（18:00）**：查 Phaser **场景启动**这一环。
前端 `scenes: Ae.map(Gd)` 只是把实例交给 Phaser；Phaser 只自动启动 `active` 的场景。
如果 host 依赖 `initialSceneKey` 之外的方式启动（例如 transition 里调 `scene.start`），
那我们要做的就是**让首次 transition 被识别**。

方法：在 bundle 里找 `scene.start(` / `sceneManager.start` 的调用，看它的前置条件。
