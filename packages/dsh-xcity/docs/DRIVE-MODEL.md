# 怎么用后端驱动这个前端（驱动模型）

> 全部结论来自 bundle 里的真实代码，不是猜的。目标：**不改前端**，只发数据。

## 一、一个角色能做什么动作

前端有一张写死的动作表（GameView 里的 nL），beat 的 body.action 只能取这些值：

```
pool walk run phone pickup gift read push_cart work farm_work workout
jog basketball fishing eat eat_drink idle sit sleep bark happy traveling
wash bathe soak attack hurt faint punch stab
```

其中和"去上班"直接相关的三个：

| 动作 | 参数 | 说明 |
| --- | --- | --- |
| walk / run | 路径点 | 走过去，路径由后端给 |
| work | 工位 | 在工位上干活（有循环动画） |
| idle | — | 站着待命 |

其它有用的：phone（掏手机，需要 phone_phase）、pickup（捡东西，需要 at/item_id）、
gift（送东西，需要 receiver_actor_id/item_id）、sit/sleep/eat（生活动作）、
attack/hurt（受击表现）。

## 二、一条 beat 长什么样

```json
{
  "beat_type": "transition",        // 可选：场景切换
  "body": { "action": "work" },     // 动作（从上面那张表里取）
  "dialogue": { "text": "开始干活了" },  // 头顶气泡（说话）
  "bubble": { "icon": "…", "text": "…", "float_up": true },
  "toast": { "text": "…", "importance": "key" },   // 屏幕提示
  "scene_anim": {},                 // 场景级动画（开关灯之类）
  "duration_ms": 1500               // 这一拍持续多久；不给用默认
}
```

## 三、怎么把 beat 发给前端

信封：kind = visual，payload 里必须带 epoch / seq / tick_marker，
**payload.tick_marker 必须与信封一致**（不一致前端直接丢弃）。

两种时间轴：

- independent：一个角色 → { actorId, beats: [beat…] }
- group：多人同框 → { participants: [...], steps: [{ tracks: { actorId: beat } }] }

```json
{
  "epoch": "epoch-w1", "seq": 7, "tick_marker": "tick-42",
  "kind": "independent", "actorId": "agent-1",
  "beats": [{ "dialogue": { "text": "来了" } }, { "body": { "action": "walk" }, "duration_ms": 3000 }]
}
```

## 四、"发短信让他去办公室工作"要串起来的东西

```
短信 → 绑定会话（DSH）→ 模型回一句 → 后端把「去办公室工作」翻译成世界动作
     → 世界把 agent 的 station 指到工位、路径算好（sim/movement）
     → 适配层按位移发 visual 包（walk → 到达 → work）
     → 前端照 beat 播动画
```

对应到代码：

| 环节 | 位置 | 现状 |
| --- | --- | --- |
| 收短信 | POST /game/player/message → SmsStore | ✅ 已实现 |
| 进会话 | respondSms → sessionController.prompt | ✅ 已实现（端口已接） |
| 世界动作 | sim/scheduler + sim/movement | ✅ 内核有，测试过 |
| 发 beat | adapters/slowvale/visual.ts | ⚠️ 只实现了 dialogue 一种 |
| 场景可见 | 前端 Phaser 挂载 | ❌ 地图贴图仍未加载（background.png 0 次请求） |

## 五、当前唯一的硬阻塞

beat 发得再对，**地图没画出来就什么都看不见**。已确认的事实：

- Phaser 场景实例建了、preload 跑了（UI 素材 39 个加载成功）；
- 地图贴图（background.png / objects/*.png）**一次都没请求**；
- 探头抓到 preload 队列里有 bg/fg/14 个物件，但每条的 src 是空串，
  说明 load.start() 没被调用（场景在 preload 之后被停掉了）。

所以下一步不是继续加动作，而是先把"第一帧地图"弄出来。
