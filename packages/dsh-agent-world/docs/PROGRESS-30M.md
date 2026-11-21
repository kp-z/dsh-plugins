# PROGRESS

## 2026-11-21 13:58 · 第 3 个半小时（找到真凶：页面不可见）

**结论（决定性）**：`document.visibilityState === 'hidden'` 时，前端**不会创建 Phaser 游戏**。
把 visibilityState 覆写成 visible 并派发 visibilitychange 之后，立刻出现：

- `canvas 2050x1608`（之前只有 38x38/24x24 的头像）
- `.phaser-canvas` 的子节点从 0 变成 1
- 控制台出现 `Texture key already in use: ...`（说明场景纹理在被注册）

**这意味着**：十几次「时好时坏、画布不挂」不是协议问题，是**浏览器窗口没在前台**。
之前那几次能看到 canvas，都是窗口恰好可见的时候。

**已修但不足够**：scene_state / cursor 链 / 场景快照覆盖 / installed_appliances——
这些让前端不再报错（有价值），但都不是画布不起来的根因。

**当前卡点（下一个 30 分钟）**：
画布起来了，但 `background.png` 仍是 0 次请求、`character_generator` 也是 0。
说明场景实例创建了但**没进入 preload 的地图加载**，或场景键没命中。
候选：
1. `initialSceneKey` 没给对（place → scene 的映射）；
2. 场景 preload 依赖 `visual` 包提示；
3. 我们注入的 auto-enter 与 visibility 覆写互相干扰，产生了两个 game 实例（纹理重复注册的证据）。

**纪律提醒**：后续所有"画布没起来"的验证，都必须先确认 `document.visibilityState === 'visible'`，
否则测的是浏览器行为，不是我们的代码。
