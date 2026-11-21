# PROGRESS

## 2026-11-21 12:55 · 第 1 个半小时（场景 boot 的边界）

**这一小时做**：追 Phaser 到底在哪一步停下。

**结论（有证据）**：
- 前端确实调用了游戏装配函数 `W5({parent: <stage 元素>, ...})` 那条路径的**上游**存在，
  但页面里 `.fishtank__stage > .phaser-canvas` 始终是空的（只有 `<!---->` 占位）；
- 没有任何 canvas 被创建，也没有 `phaser-canvas__error` 的 boot 失败块；
- 连 boot 前必跑的字体现就绪日志都没出现 → 说明**装配函数根本没被调用**，
  不是"调用后失败"。

**已排除**：
- 不是 scene_state 形状问题（已接受，无警告）；
- 不是 cursor 链问题（streamEvents 0）；
- 不是场景快照覆盖问题（sceneFetches 1，无重同步）；
- 不是 innerWidth/isWideLayout 导致 fishtank 段不可见（改 innerWidth 无效，段列表没变）。

**下一轮（13:00）**：给页面装一次性探针（注入脚本里加 MutationObserver + 给
HTMLCanvasElement.prototype.getContext 打日志），看是否有任何 canvas 被创建，
以及 `.phaser-canvas` 何时被填。若确认"装配函数没被调用"，下一步找它的调用门槛
（很可能要 place→scene 的映射表，即 `Vh()` 为空导致 scenes 列表里只有 undefined）。
