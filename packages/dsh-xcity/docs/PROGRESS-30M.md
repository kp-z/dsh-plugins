# PROGRESS

## 2026-11-22 14:15 · 找到「无进展」的确切机制

**探针**：包一层 `Object.assign`，抓资源监督器写进错误的 `sceneAssets`（队列快照）。

**拿到的事实**（关键）：
```json
[{"key":"convenience_store_bg","src":"","state":10},
 {"key":"convenience_store_fg","src":"","state":10},
 {"key":"convenience_store_object_obj_0.png","src":"","state":10}, ...]
```

- **队列里确实有 bg/fg/14 个物件**（数量完全对得上 objects.json 的 14 条）；
- 但每一条的 `src` 都是空串，且从未发起任何请求；
- 也就是说：**preload 把文件排进队列了，但 `load.start()` 从没被调用**。

**推论**：preload 之后场景被中途关掉了（转场被后一次 `scene.start` 打断），
所以 loader 只有队列、没有启动 → 30 秒后监督器报"无进展"。

**已排除**：不是资源路径错、不是 404、不是 id 混用、不是配置缺失。
这些都在之前几轮修好并且有证据。

**下一刀**：让转场"只发生一次且不再打断"——具体是在切换后**暂停世界推送**
（停掉 scene_state 的周期性重发），给 loader 一个干净的启动窗口。
如果那时 bg 被请求，就证明是"打断"；否则要查 host 是否在 `scene.start` 后立刻 `stop`。
