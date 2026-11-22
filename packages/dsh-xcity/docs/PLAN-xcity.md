# xcity 推进计划（每小时一轮）

> 每轮只做**一件事**，做完就要有一条可验证的判据；判据不成立就写清为什么，不留"应该好了"。

## 现在的真实状态（每轮开头先复核这些）

| 项 | 状态 | 复核方式 |
| --- | --- | --- |
| 插件跑在 DSH 进程里 | ✅ | /agent-world/api/world 返回 200；7788 的监听进程是 DeepSeek Harness |
| 左侧栏 tab | ✅ | DSH 窗口左侧有 xcity 图标，点开是小镇 |
| 三人各有一条会话且在 xcity 工作区 | ✅ | curl /api/xcity/bindings；~/.dsh/storages/workspace.json 的 sessionIds |
| 短信线程层 | ✅ | curl /api/game/phone/sms/threads |
| 短信→会话 | ✅ | respondSms 已接，发短信后对应会话里出现消息 |
| **地图渲染** | ❌ | background.png 仍 0 次请求 |
| walk/work beat | ❌ | 只实现了 dialogue 一种 |

## 里程碑（按顺序，不要跳）

### M1 第一帧地图画出来（当前）

判据：Network 里出现 /assets/maps/<key>/background.png 且 200。

已知事实：
- 首场景**不是地图场景**：关掉推送时 preload 只排了 33 个 UI 素材，地图贴图一条都没排；
- 有推送时，后续场景的 preload 排了 bg/fg/14 物件，但 src 全是空串 → load.start 没被调用；
- 依据：Gd(placeId) 走 vO 分支（不加载地图），Gd(assetKey) 走 $d 分支（地图场景）。

当前假设：scene_state / snapshot.scene 要用**资源键**（company），而不是 place id。

### M2 walk / work 两类 beat

判据：发一条 beat 后，角色在画面上从 A 走到 B，到达后进入 work 动画。

形状（来自 bundle 的 nL 动作表）：
```
{ "body": { "action": "walk", ... }, "duration_ms": 3000 }
{ "body": { "action": "work" }, "duration_ms": 60000 }
```

### M3 短信 → 世界动作

判据：在游戏里给角色发“去办公室工作”，角色真的走过去并进入 work；同一条命令在对应 DSH 会话里能看到记录。

### M4 Agent 之间交流

判据：两个角色同框（group 时间轴）互相说话，气泡出现在两个人头上。

## 每轮纪律

1. 先读 docs/PLAN-xcity.md、docs/DRIVE-MODEL.md、docs/INSTALL.md、docs/PROGRESS.md；
2. 一轮只推进一个里程碑的一个子步骤；
3. 改动前先写判据，改完立刻验；判据不成立要写“为什么”，不要换措辞掩饰；
4. **绝不修改 slowvale-mirror/site/**（2401 个文件必须逐字节一致，跑 scripts/verify.mjs）；
5. 每轮结束把结论、证据、下一步写回 docs/PROGRESS.md 并 commit；
6. 涉及插件代码改动时，改完把 lib 同步到三个 profile（npm 链接指向 workspace，无需重装）；
7. 需要重启 App 才能生效的变化，**先写进文档并在回复里明确标注**，不要反复让用户重启。
