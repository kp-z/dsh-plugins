# PROGRESS

## 2026-11-21 15:00 · 第 5 个半小时（场景切换确实发生了，但前端不跟）

**这一小时做**：网络探针 + 让 snapshot.scene 跟着 viewer 的真实位置走。

**实证**：
- 采样两次得到 `scene=home_public` → `scene=restaurant`（约 6 秒一次切换），**服务端切换是真的**；
- 但浏览器里 `/assets/maps/**/*.png` 请求数仍是 **0**；
- `/game/state/scene` 只被请求了 **1 次**（加载时 scene=company），后续切换**没有**再触发请求。

**结论**：前端对 `scene_state` 信封的处理只覆盖首次；后续切换不触发场景数据拉取，
也不会启动场景。也就是说 **scene_state 只是个"通知"，真正驱动场景数据的是 `state` 分片**
（part: place_runtime / place_topology / role_core …）。

**下一轮（15:00）**：实现 `state` 信封推送，从 `place_runtime` 开始。
形状已知（前端 Ix 校验器）：
`{ part: 'place_runtime', operation: 'replace', key: <place_id>, payload: {...} }`
（keyed part，key 必须是非空字符串；非 keyed part 的 key 必须是 null）

**注意**：`scene_state` / cursor 链 / 场景键对齐 这些已经修好的东西不能回退——
它们让前端从"报错"变成"安静"，安静才能看出"它不跟"。
