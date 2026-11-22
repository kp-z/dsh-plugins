# 半小时计划：把城市真正跑起来

判据只有一条：**background.png 被请求**。它一被请求，就说明 Phaser 场景真的启动了，
人也才有地方站。

## 当前状态（2026-11-21 12:40）

| 层 | 状态 |
| --- | --- |
| 三人进城（林野/小满/老周） | ✅ presence、HUD、面板都是他们 |
| 面板报错 | ✅ 清零（market.rows/merchants、recap 时钟、relationship-map roles/communities） |
| scene_state 信封 | ✅ 被接受（形状：单条 + broadcast=false + scenes=[scene]） |
| cursor 链 | ✅ 逐条递增 + prev，前端不再判「链断裂」 |
| 场景快照 | ✅ 不再判「没覆盖这次切换」（按请求的 ?scene= 回，且 viewer presence.scene 对齐） |
| **场景启动** | ❌ 客户端拉了一次 /game/state/scene 就没下文；background.png 仍未请求 |

## 下一步（每块 ≤30 分钟）

1. **找出 boot 的最后一个条件**：场景快照已被接受，但 Phaser 仍不建。候选：需要 visual 包、
   需要 place_runtime 的 furniture、或需要一个「场景就绪」标记。用同样办法逼：补一处看一次 bg 计数。
2. **人物进场景**：bg 起来之后，让 character_generator 被请求（角色精灵）。
3. **三人分场景走动**：各自 station 变化 → scene_state 切换 → 画面跟着换。
4. **短信接线**：HUD 聊天流 + 手机短信端点接 Messenger。
5. **会话绑定投影**：角色面板显示「当前由哪个会话代表」。
6. **回归**：verify.mjs（前端 2401 文件逐字节）+ agent-world 测试 + slowvale 69 用例。

## 纪律

- 前端一个字节都不改；只动适配层与注入脚本。
- 每轮先读本文件与 PROGRESS，再写 5 行以内的一块。
- 判据量化：bg 请求数、canvas 尺寸、__svlog 错误数。
