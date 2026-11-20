# PROGRESS

## 2026-11-21 03:20 · H7 完成（presence 投影 + 前端接线图）

**这一小时做**：把"人物移动"接进 presence 投影；把三个前端面分清楚并记档；60 个单测全绿。

**做了什么**：
- `view/presence.ts`：PresenceView —— place/walkTo/tick/entries；按步长推进、取整输出、四向朝向
- `docs/FRONTEND-WIRING.md`：三个面分清（HUD 聊天流 / 手机短信端点 / presence），各自"怎么来、怎么发、未定什么"
- 5 个用例：100 像素不跳帧、朝向四向、到点即停、形状是整数+place_id、不在场不能指挥

**关键发现（纠正了上一轮的理解）**：
左下角那台手机其实对应**两个面**：
- HUD 聊天流走 **SSE**，发送走 `POST /game/player/message`；
- 手机 App 里的短信才走 `/game/phone/sms/threads`。
混在一起会做错——我按这个区分重画了接线顺序：移动 → HUD 聊天 → 手机短信。

**关键决策**：
- presence 与内部坐标分离：内部是浮点，前端要整数像素与四向。混在一起会出现"1.9999 像素"这种说不清的状态。
- 投影层不自己算路径：只做"按步长逼近目标"，寻路留给世界（前端已有 EasyStar，但那在前端；服务端不该重复实现）。

**卡点**：
- **聊天条目信封形状未定**（sceneStream entry 除 text 之外还有哪些字段）。
- 手机短信线程条目字段集合未定（已探到 total_unread_count / latest_message_row_id，其余待逼）。

**下一个小时（H8）**：稳定性与成本——并发上限、超时、预算护栏。
