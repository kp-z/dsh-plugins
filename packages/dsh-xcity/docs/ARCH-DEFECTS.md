# 服务端设计缺陷（对照前端能力清单）

> 依据：packages/dsh-xcity/src 的实现 与 docs/FRONTEND-SURFACE.md 的盘点是同一份事实。
> 只列**结构性缺陷**：能通过加一个字段解决的，不在这里。

## 1. 领域模型是"办公室团队模拟器"，前端是"城市生活模拟器"

| 我们 | 前端 |
| --- | --- |
| DistrictKind 4 种（engineering/meeting/infra/commons） | 32 张地图、8 种店铺、住宅/海滩/泳池/武道馆… |
| StationKind 6 种（desk/meeting/server/mailroom/lab/breakroom） | target 249 个交互点、pose 433 个姿势点 |
| 没有 place/scene 概念 | 场所是一等公民（place_id / scene / room） |

适配层只能拿工位冒充场所：`placeId = agent.station ?? 默认place`（project.ts:183）。
所有角色共享一个坐标网，所谓"去办公室"只是同一张网格上的一个角落。
**前面「出不了广场」正是这条裂缝**：不是寻路坏了，是"广场"在我们的世界里根本不存在。

## 2. 活动没有身份，只有状态

- 我们：`AgentState` 7 个值 + `activityKind` 字符串 + `activityUntil` 时间戳。
- 前端：61 个 Activity 类，渲染需要 `active_activity: {activity_type, subkind}` + 进度 + 生命周期。

少的不只是字段：活动没有 id、没有开始/结束、没有 interrupted/completed 的边界，
所以徽章、进度条、日志里的 phase 全都产生不出来。`work` 只能表现成"在工位站着"。

## 3. 事件模型没有叙事结构，只能降级成公告

我们的事件是 13 种扁平类型 + 500 条环形缓冲（`EVENT_RING_SIZE`）。
前端日志要的是 card / aggregate / entry / decision / phase，且**条目内容不可变**、带游标。

现实后果已经发生：`logs.ts` 只能说 `kind:'standalone'` 的 `system_notice`——
"某某做了决定"，没有任何上下文。而且 500 条之后历史直接消失，翻不回去。

## 4. 经济 / 物品 / 技能 / 健康：一个都没有

`project.ts` 里 `money: 128000`、`attributes: {sources:[],totals:{},rows:[]}` 全是常量（:259-293）。
前端有 115 种金钱流水、12 类物品、11 种技能、健康/体力/心情/醉度等级。

也就是说：资产、背包、属性三个面板是**空壳**。角色不会疲劳、不会花钱、不会买东西——
"生活模拟"只剩走动和发短信。

## 5. 时钟与天气是装饰

clock 由 tick 线性推（起点 startDate），weather 恒为 `'clear'`（:322/:367），季节没有。
前端的时段 7 段、天气 5 种、季节枚举都没有驱动源，NPC 作息不随它们变化。

## 6. 身份系统散落在四处

同一个"人"有五个 id：`sessionId`、`characterId`、`agentId`、`roleId`、短信 `thread:<role>`。
映射散在 bindings.json、agents.json、adapter 的 `role_id = agent_id`、以及各处字符串前缀里。
没有单一注册表 —— 于是"这条会话是谁"要写三段兜底（session-events.ts:actorForSession），
单写者冲突、绑定错人这类问题每次都要满仓找映射。

## 7. 失败是静默的

`sim/step.ts` 里大量 `break` / `return false`：找不到工位、路径为空、指令没匹配——
对外全部表现为"什么都没发生"。没有拒绝原因、没有诊断字段。
我们连续三轮卡在"人不动"，根因都藏在这些静默分支里。

## 8. 快照全量构建 + 世界生命周期与浏览器假设打架

`projectSnapshot` 每次请求全量重建；SSE 没有增量协议。
更麻烦的是"每个会话一个世界"与"浏览器看一个世界"两个假设并存：
`activateSession` 会 save + 重建世界（state.ts:376-381），表现为 tick 归零、位置回弹。
我们遇到过两次"世界冻住/角色回弹"，都是这条设计冲突的症状。

---

## 建议的修复顺序（按"解锁什么"排，不按"看起来优雅"排）

1. **活动身份化**：把 `activityKind+activityUntil` 换成 `{id, type, subkind, startedAt, endsAt}`。
   立刻解锁：头顶徽章、进度条、日志 phase、活动中断语义。
2. **场所成为一等公民**：agent 带 `placeId`，坐标相对场所；跨场所 = 换 place + 重算 nav。
   解锁：32 张地图、真实"去某地"、场景内事件。
3. **事件升级为 entry**：card/aggregate + 不可变条目 + 游标。解锁：真实日志、回顾、跨天历史。
4. **身份注册表**：一个 registry 管齐 5 个 id。解锁：绑定/会话/线程不再各写一套兜底。
5. **命令拒绝可见**：每条被丢弃的命令带上 reason。解锁：以后排查不用靠猜。

**不要现在做的**：经济/物品/技能整套系统。它需要"场所 + 活动"先成立，
否则只是又一批硬编码常量（现在 money 就是这么来的）。
