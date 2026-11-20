# PROGRESS

## 2026-11-20 23:30 · H3 完成（注入层扩展）

**这一小时做**：关系层 + 心情层两个 provider；不改 buildContext；37 个单测全绿。

**做了什么**：
- `model/relations.ts`：Relationship（家人/朋友/同事/邻居/陌生人 + 熟络度 + 上次见面）、
  Mood（体力/压力）、`describeRelationships` / `describeMood` / `closenessWord`
- `model/social-context.ts`：`relationshipProvider` / `moodProvider` / `socialProviders`
- 验收测试证明：buildContext **零改动**，节顺序 = 人 → 场合 → 处境 → 关系 → 心情

**关键决策**：
- 关系与心情**不写进 persona**：persona 是"他是谁"（不随玩家变），关系是"他此刻怎么看待你"。
  写进人格等于说"林野天生讨厌玩家"，换个玩家就错。
- 熟络度只用**三档词**（不熟/还行/很熟），不给模型数字——模型对形容词更稳。
- 心情阈值只留三条，避免在"有点累/比较累"之间反复横跳。

**卡点**：
- 真机联调（sessionController）在本会话里拿不到，硬编没有意义，推迟到能拿到宿主 ctx 的环境。
- 三个角色对同一世界的反应差异，目前只能靠 prompt 文本差异断言，**真人比对**要等能真跑模型。

**下一个小时（H4）**：短信入口。
- 世界侧：`Messenger`（线程存储 + 可达性判定 + 回执语义）
- 会话侧：`say(characterId)` 已就绪，接上即可
- 验收：手机发一句 → 线程里有"我发的"与"他回的"两条；他没活会话时懒开一个
