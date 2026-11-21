# PROGRESS

## 2026-11-21 13:30 · 第 2 个半小时（探针 + 地图预载证据）

**这一小时做**：给注入脚本加画布探针（createElement / getContext / MutationObserver），看 Phaser 到底走到哪。

**新证据（重要）**：
1. `createElement` 的调用栈里出现了 Phaser 的渲染器工厂（`createWebGL` / `create2D`）
   → **Phaser 确实启动了**，不是"没调用"；
2. 前端一次性预载了 **31 个场景的地图 JSON（124 个请求）**，全部 200，没有 404；
3. 但 `<canvas>` 从未被插入 DOM（探针里 inserts 为空），`background.png` 仍是 0 次请求。

**所以卡点从「装配没被调用」修正为**：
装配跑了，地图也预载完了，**卡在"预载完成 → 场景实例化"这一步之前**。

**已排除**：scene_state / cursor 链 / 场景快照覆盖 / 资源 404 / 布局宽窄。

**下一轮（13:30）**：查预载完成到实例化之间的那一小段——候选：
- `document.fonts.ready` 的等待（游戏前会等字体）；
- `initialSceneKey` 与 place→scene 映射不匹配（`company` 在预载列表里，但可能没被选成初始场景）；
- 父元素尺寸为 0 的守门（`Ed(parent)` 在创建时判定，之后即使尺寸恢复也不会重试）。

方法：给这三个点各打一个探针（字体是否 resolve、初始场景键是什么、父元素创建时尺寸）。
