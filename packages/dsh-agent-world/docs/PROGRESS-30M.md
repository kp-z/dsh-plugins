# PROGRESS

## 2026-11-21 16:00 · 第 7 个半小时（场景真的开始加载了，但加载器空转）

**新证据**：
- `/game/state/scene` 这次请求的是 `scene=restaurant`（说明切换后确实又拉了一次）；
- 报错变成了 `[phaser_asset_load] 场景资源加载无进展: scene=convenience_store`——
  **场景实例已经被启动了**，它在尝试加载贴图；
- 但探针记录里 `/assets/maps/**/*.png` 仍然是 0，连 `Image.src` 都没被赋值过。

**结论**：不是"没启动场景"，而是**场景 preload 一个文件都没加**。
Phaser 的 loader 启动了、文件列表为空、于是超时报"无进展"。

**下一轮（16:00）**：查"preload 为什么加不进文件"。候选：
1. 场景实例拿到的 mapData 为空（host 用 `createSceneInstance({mapKey, mapData})` 传，mapKey 可能是 `company` 但 mapData 键不同）；
2. 贴图不是逐张加的，而是从 `layers.json`/`objects.json` 描述的图集（atlas）来——如果图集路径拼法不对，会静默跳过；
3. `maxParallelDownloads` 或 loader 配置导致队列没启动。

方法：hook `fetch`/`createImageBitmap`/`Image` 全覆盖，并在场景报错那一刻 dump 最近的 net 探针记录。
