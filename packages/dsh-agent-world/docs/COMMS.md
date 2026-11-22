# 沟通层（短信 / 对话）——协议与现状

> 2026-11-22。所有结论都来自 bundle 里的真实调用点，不是推测。

## 一、三层通道

| 通道 | 触发 | 数据 | 展示 |
|---|---|---|---|
| 手机短信 | `GET /game/phone/sms/threads`、`/game/phone/sms/thread` | `{threads:[{thread_id, peer_name, last_message, last_sent_at, unread_count}], unread_total}` | 手机面板 |
| 发送 | `POST /game/player/message` `{role_id, content}` | 同一条线程追加 | 气泡 / 手机 |
| 当面对话 | `POST /game/player/interaction` → `GET /game/player/conversation` | `{messages, suggestions, topics, ...}` | 头顶气泡 `bubble_panel` |
| **角色之间** | **SSE `visual` 包里的 beat** | `beat.dialogue` / `beat.bubble` | `_spawnSpeechBubble(beat.dialogue)` |

关键一行（GameView 的 SceneActor）：

```js
g.dialogue && this._spawnSpeechBubble(g.dialogue), g.toast && ...
```

也就是说：**角色之间的对话不是接口，是视觉时间轴上的一拍**。谁说话、说什么，都写在 `visual` 包的 beat 里，前端只负责把气泡冒出来。

## 二、我们现在的状态

| 项 | 状态 |
|---|---|
| 短信线程存储（世界侧、收下即回执、按行号单调递增） | ✅ 已实现 `sms.ts` |
| `GET /game/phone/sms/threads` / `thread` | ✅ 返回真实线程 |
| `POST /game/player/message` | ✅ 落库并返回追加后的线程 |
| 对方回复 | ❌ 需要 `SmsResponder`（接会话后才有） |
| `visual` 包 | ❌ 一次都没发过 → 所以**没有任何气泡**，也没有角色之间对话 |
| `/game/player/conversation` | ⚠️ 仍是固定空数组 |

## 三、下一步的最小闭环

1. **发 `visual` 包**：把「谁在什么时候说了一句什么」变成一拍的 beat；
2. 气泡一旦出现，"角色之间在说话"就有了可见证据；
3. 再把 beat 的来源接到会话（角色 ↔ 会话绑定后，模型说的话就是 beat.dialogue）。
