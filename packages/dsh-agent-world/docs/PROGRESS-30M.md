# PROGRESS

## 2026-11-21 15:30 · 第 6 个半小时（state 分片 + scene_by_place）

**这一小时做**：
1. 实现了 `state` 分片推送（`place_runtime`、`place_topology`）与 `furniture` 信封；
2. 发现并修掉一个**硬配置缺口**：`/config.scene_by_place` 我们一直给的是 `{}`。

**为什么 scene_by_place 关键**：前端 `$1(scene, config.scene_by_place)` 用它做
**场景 → 地点**的反查；查到 0 个就抛 `场景 gym 对应 0 个地点，无法反查`，
整份场景快照被判失败。之前这个错误被别的错误盖住了，现在浮出来。

**修法**：`scene-key.ts` 导出 `sceneByPlace`（place → 资源键），`/config` 直接用。
修完后该 warn 消失。

**现状**：
- 画布 2050×1608 ✅
- `/game/state/scene` 接受 ✅
- state 分片被接受、无警告 ✅
- `/assets/maps/**/*.png` 请求数仍是 **0** ❌

**下一轮（15:30）**：既然反查通了，查"谁负责第一次 `scene.start(key)`"。
候选：
1. `place_topology.places` 必须包含**该场景对应的所有地点**（我们只有 8 个，且都指向同几个场景）；
2. 需要 `place_counts`/`story_flags` 之类 part 先到位；
3. 场景启动依赖 `visual` 包（kind=visual）到达。
