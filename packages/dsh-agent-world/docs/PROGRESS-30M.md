# PROGRESS

## 2026-11-21 20:30 · 第 16 个半小时（本计划最后一轮）

**这一小时做**：验证"单次切换后停住"能否让场景把贴图加载完。

**结果**：没有报错了（说明切换被接受、快照合规），但 `/assets/maps/**/*.png` 仍为 0，
`background.png` 仍未请求。页面没有错误块。

**这一小时读到的最关键一行**（资源监督器）：

```js
e(new As("asset_download", `场景资源加载无进展: scene=${m.sys.settings.key}`))
```

`m.sys.settings.key` 打出来是 `place:outdoor.sunset_beach` —— 说明 **Phaser 场景的 key 就是 place id**。
所以这条链已经全对了：`scene_state` 给 place id → 场景实例 key = place id → 场景启动 → preload 开始。

**剩下的唯一问题**：preload 里 `load.image(bg, …/background.png)` 没被排队。

---

# 16 轮总结（12:30 → 20:30）

**已经立住的（都有证据）**：
1. 三人进城：林野/小满/老周，名字/性格/家与工作地来自 dsh-slowvale 的角色模型；
2. 前端零改动：2401 个文件逐字节一致；
3. `scene_state` 信封形状正确（单条 + broadcast=false + scenes=[scene]）；
4. cursor 链（逐条 +1 + prev），不再"链断裂"；
5. `/game/state/scene` 按请求回包，viewer presence 与之一致；
6. **配置改用线上真实 `/api/config`（29 键）** —— 这是转折点；
7. `scene` 用 place id、资源键只在拓扑里；
8. `state` 分片（place_runtime / place_topology）与 `furniture` 信封已实现；
9. 画布稳定启动（2050×1608），UI/徽章/角色表素材正常加载（34+ 个）。

**唯一未解**：地图贴图（background/objects）不排队。争取下一个计划继续。

**教训**：
- 用**真数据**（线上 config）比推理快十倍；
- `visibilityState` 会让画布根本不建——调试前必须先确认窗口可见；
- `Hs()` 那种"静默兜底"会把错误藏住，两套 id 混用因此拖了很多轮。
