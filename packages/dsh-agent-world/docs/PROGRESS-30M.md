# PROGRESS

## 2026-11-21 14:28 · 第 4 个半小时（scene 键对齐 + 可见性开关）

**这一小时做**：
1. `debug.ts` 加 `forceVisible`（仅本机调试；后台窗口里前端不建游戏）；
2. **scene id 统一成「场景资源键」**——这是真 bug。

**关键发现**：前端有两套 id，我们一直混用：
- `presence.location.place_id` = `place:*`（世界语义）
- `snapshot.scene` / `presence.scene` / `place_topology.places[].scene` / `scene_state.payload.scene`
  = **地图资源键**（company、home_public…），前端拿它去 `/assets/maps/<key>/` 找图，
  也拿它当 Phaser 的初始场景键。

混用的后果非常具体：画布建了，但**一张地图贴图都不请求**。

**现在的状态**：
- 画布 2050×1608 ✅（forceVisible 后稳定复现）
- 前端认了 `scene=company` ✅（之前报的是 `scene=place:office.tech_company_1`）
- 但开始报 `[phaser_asset_load] 场景资源加载无进展: scene=company`，
  且 `/assets/maps/**/*.png` 请求数仍是 0——加载器启动了但没有任何文件进来。

**下一轮（14:30）**：查"加载器启动但没文件"的原因。
候选：
1. 场景的 preload 里文件列表为空（依赖 objects.json 里的清单，我们给的 objects.json 是真实文件，应该能读出清单）；
2. 贴图 URL 拼法与我们静态服务不匹配（但文件确实在磁盘上）；
3. Phaser 的 loader 因为没有 `load.start()` 而空转，超时后报"无进展"。

方法：hook `XMLHttpRequest` 与 `Image` 的 src 赋值，记录所有 `/assets/maps/` 请求与状态。
