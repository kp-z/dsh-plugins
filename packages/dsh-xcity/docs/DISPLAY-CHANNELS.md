# 显示通道对齐（前端 5 条 ↔ 后端）

前端（`slowvale-mirror/src/js/GameView.js`）只认**一拍（beat）**里的字段来决定怎么画。
字段存在与否就是通道选择器——没有第二条路。这份文档是**契约**：后端发什么、前端画成什么、
什么场合该用哪条。

| # | 通道 | 一拍里的形状 | 前端渲染 | 有名字 | 该用在哪 | 不该用在哪 |
|---|---|---|---|---|---|---|
| 1 | 飘字 | `bubble: { text, float_up: true }` | `_spawnFloatText` | ❌ | 「嗯」「！」「……」这类**非语言**反馈、数值变化 | 对话（看不出谁在说） |
| 2 | 说话泡 | `dialogue: { speaker_id, text, tone: 'speech' }` | `_spawnSpeechBubble` → `JL(actor,text,tone)` | ✅ | **面对面说话**：会议室、工位闲聊、开会 | 跨场景/异步 |
| 3 | 内心独白 | `dialogue: { speaker_id, text, tone: 'thought' }` | 同上，气泡外观不同（`thoughtBubble`） | ✅ | 自我嘀咕、做决定时的心理活动 | 说给别人听的话 |
| 4 | 短信 | `dialogue: { …, tone: 'sms' }` + 世界侧 `sms.send` 写线程 | `speechBubble` 样式 + 手机线程界面 | ✅ | 玩家↔角色异步消息（发消息、回信、未读） | 面对面聊天 |
| 5 | 状态/动作 | `body: { action, … }`、`role_public_status`、`activity` | `_applySceneAnim` / 状态标签 | — | 「正在干活」「在睡觉」这类**状态** | 说话 |

## 硬约束（前端会抛错的地方）

- `dialogue` **必须带 `speaker_id`**，否则 `[dialogue] 缺少 speaker_id`；
- `dialogue` **必须带 `audience`**，否则 `[dialogue] 缺少 audience`。两种形状：
  `{kind:'place', place_id}`（同场景可见，我们默认用这个）或 `{kind:'role_ids', role_ids:[...]}`（只给名单内）；
  god 视角（无 currentRoleId）只放行 `place`，`role_ids` 直接判否；
- `tone` 只能是 `speech` / `thought` / `sms`，其它值抛 `[SpeechBubble] 未知 tone`；
- `text` 为空或全空白 → `[SpeechBubble] 泡内容为空`；
- 说话泡只能挂在**已挂载 sprite** 的 actor 上（`[SpeechBubble] … 尚未挂载`），所以一拍必须在
  角色已经出现在场景里之后才发；同 tick 发的包会被 `tick_marker` 水位丢弃（见 R506 的入队+周期性发）。

## 后端现状

| 通道 | 后端位置 | 状态 |
|---|---|---|
| 1 飘字 | `visual.ts: floatTextBeat` | ✅ 保留，给非语言反馈 |
| 2 说话泡 | `visual.ts: sayBeat` + `server.ts: flushSay` | ✅ R538：改用 dialogue 拍，带 speaker_id |
| 3 独白 | `sayBeat(text, speakerId, 'thought')` | ✅ 可用，按需调用 |
| 4 短信 | `sms.ts` + `routes.ts: /game/player/message` + `server.ts: pushPhoneIfChanged` | ✅ R537：**按周期**推手机信号（原来只在玩家发消息时推，导致收不到异步回复） |
| 5 状态 | `server.ts: pushActivityChanges / role_public_status` | ✅ 已有 |

## 一条经验

之前"说话"走的是 #1，因为 #2 试过报 `Cannot read properties of undefined (reading 'map')`。
现在查明：那次是**拍里没有 speaker_id**（前端`JL` 之前就抛），不是通道坏了。
教训：**前端报错的堆栈指向渲染函数，不等于通道不可用**——先按契约把字段补齐再判断。
