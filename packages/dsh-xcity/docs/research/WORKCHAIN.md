# WORKCHAIN · 工单从「领到」到「留下成长证据」

> 只读调研，未改任何代码。所有路径相对 `/Users/demo/dsh-plugins`，行号取自当前工作树。
> 标记约定：**【证据】** = 代码/文档实测；**【推测】** = 由证据外推、未经运行验证；**【需确认】** = 涉及新概念，须先问用户。
>
> 阅读口径：行号取自**当前工作树**（`packages/dsh-xcity` 与 `slowvale-mirror` 都带一批未提交改动）。与本文相关的一处未提交改动恰好是 §3 的关键旁证：`independentTimeline` 已从旧的 `{kind:'independent',actorId,beats}` 迁到 `playback:{kind,tracks}`（工作树 `visual.ts:81-98`），而 `independentDialogue` **仍是旧形状**（`visual.ts:40-57`，与 HEAD 一致）。同一文件里一个函数用对了形状、另一个没跟上——所以问题不是"缺少字段"，是"整包不被认识"。

## 0. 一句话结论

工作链的**状态机是通的**，卡的是三个独立的门：**模型门控**（认领前）、**交付证据门控**（完成前）、**展示门控**（气泡与进度根本发不出去）。其中气泡那一处不是"少填一个字段"，而是**包形状本身就不属于前端认识的那一种**。

---

## 1. 工单的真实条件：ready → in_progress → completed

### 1.1 tick 内的固定顺序（决定了"谁能改状态"）

`src/sim/step.ts:447-537`：ingest → **external 裁决(456)** → **recomputeReady(483)** → **claimTasks(484)** → movement(487) → affinity(492-509) → idle(515) → **advanceWork(518)** → comms(523) → mailbox/heartbeat(526-527) → **recoverStalledTasks(537)** → syncActivities(541)。

**【证据】** `ready` 不是任何人写出来的：它是 `pending` 在依赖满足后的派生值，唯一实现点在 `src/sim/ready.ts:61-82`，判据 `src/sim/ready.ts:45-51`（依赖指向不存在的任务 ⇒ 永远不 ready，宁可卡死也不基于"消失的前置"判断）。

### 1.2 三道门，逐条

| 阶段 | 真实条件 | 证据 |
|---|---|---|
| pending → ready | 所有 `blockedBy` 都 `done` | `src/sim/ready.ts:45-51,66-79` |
| ready → in_progress（小镇自己派） | ① 有空闲角色：`state==='idle' && carrying===null`；② 该角色在 `sessionWorkers` 里（slowvale 开启时）；③ `owner` 为空或就是它；④ 存在能力包含 `task.requires` 且未满的站点 | `src/sim/scheduler.ts:87-89`、`:114-117`、`:127-137` |
| 同上（外部团队已指派） | `externalId!==null && owner!==null`：必须由 `owner` 本人领，不许换人；`live` 且未指派则小镇**不许自己挑人** | `src/sim/scheduler.ts:148-163` |
| in_progress → done（模拟） | `progress` 涨到 1；每 tick 推进 `1/estimateTicks`（无则 `DEFAULT_TASK_TICKS=250`） | `src/sim/interaction.ts:83,108-136`；`src/domain/constants.ts:50-53` |
| in_progress → done（**接 DSH 会话的本地单**） | 模拟**根本不推进**：`sessionWorkers!==undefined && externalId===null` 直接 `continue` —— 完成只有一条路：会话里的 `xcity_report` 通过交付文件校验后 `settle` | `src/sim/interaction.ts:97`；`src/adapters/slowvale/task-execution.ts:118-137` |
| 不变量回收 | `in_progress` 却"没人在去工位/没人在工位干"持续 20 tick ⇒ 退回 `ready`，**清 owner/station/attemptId**、保留 progress | `src/sim/recovery.ts:49,74-83,138+` |

完成走 DSH 时的实际链路：`taskExecution.report()`（同一 `attemptId`、同一 `startedTurn`、`delivery.active`）→ 校验 `.xcity-results/<digest>.md`（普通文件、硬链数 1、0<size≤1MB、SHA-256）→ `settle` → `runtime.enqueue(taskComplete)` → 下一 tick `applyExternalTasks` 落 `task.status='done'`、`task.output=summary+路径+SHA`（`src/index.ts:355-362`；`src/sim/step.ts:311-405`）。

### 1.3 测试 profile 为什么领不到：四个串联的门

1. **模型门**：`hasXcityRoleModel` 要求 `agent.model.current().provider === 'mmt-vision'` 且 model 规范化后匹配 `/^deepseekv?41$/`。**provider 是硬等值比较**，任何别的 provider（含只装了 base/web/xcity 的测试 profile）直接 false。【证据】`src/bridge/dsh-adapter.ts:50-59`
2. **会话门**：`available()` 还要求 `sessionController.prompt` 存在（`src/index.ts:337`）且 `isIdleSession`（`running===false`、无 `pendingInput`、队列空）——**正在干活的会话那一刻不算可用**。【证据】`src/bridge/dsh-adapter.ts:62-76`
3. **绑定门**：`sessionsByAgent` 要求"角色↔agent 槽↔会话"三者**一对一唯一**，任何歧义（同一角色多绑、同一会话多绑）直接跳过该角色。【证据】`src/adapters/slowvale/xcity.ts:79-91`
4. **调度门**：slowvale 开启时 `sessionWorkers` 是 heartbeats 采样出来的 `eligible` 集合，初始为**空集**；`claimTasks` 对本地单要求 `sessionWorkers.has(a.id)` ⇒ 空集时`free=[]` ⇒ 每张单 long-stall `no-worker`，**永远停在 ready**。模拟也不会替它推进（1.2 表最后第二行）。【证据】`src/sim/scheduler.ts:116-125`；`src/adapters/slowvale/task-execution.ts:22-23,138-140`；`src/index.ts:374`

**【证据，真机记录】** `docs/PROGRESS.md:11136`：外部 DSH 投了巡检工作，到 tick 2715 工单仍 `ready`、无人领取、进度 0，且没有模拟完工。`docs/PLAN-9H-THREE-RESIDENTS.md:18` 的记录与此一致（"测试 profile 无合规模型 → 领不到单"）。
**【证据】** 模型在测试 profile 不可用的独立旁证：`docs/PROGRESS.md:6156,6161`（web profile 没有 `mmt-vision` 的适配器）。

> 结论：**"领不到"不是调度器 bug，是四道门串联后的必然结果**。最窄的修法在 provider 判据（第 1 门）或绑定（第 3 门），而不是去动 `scheduler.ts`。【需确认】是否放宽 `hasXcityRoleModel` 属于产品决策（"只跑指定模型"是刻意的门），不在此文档擅自决定。

---

## 2. 「干完活」怎么留下可复用的成长证据

### 2.1 现有哪些容器（都已有，不必新增）

| 容器 | 内容 | 证据 |
|---|---|---|
| `persona.xp / level` | 完成一张单 +40 XP（`awardedTaskIds` 去重）；学习块 +1 XP | `src/persona/store.ts:85-99`；`src/index.ts:434-436`；`src/persona/study.ts:20-31` |
| `persona.skills` | 技能名数组（内容来自 `xcity_report.skill` 或学习活动） | `src/index.ts:753-755`；`src/index.ts:870-878` |
| `persona.taskIds / awardedTaskIds` | 干过/结算过的工单 | `src/index.ts:432`；`src/persona/types.ts:2-14` |
| `task.output` | `summary + .xcity-results/<digest>.md + SHA-256` | `src/adapters/slowvale/task-execution.ts:131-133`；`src/sim/step.ts:387` |
| `agent.affinity` | 同屋聊天 +2（与"干完活"无因果） | `src/domain/types.ts:259-260`；`src/sim/step.ts:506-508` |
| 落盘位置 | `<stateDir>/personas.json`、`<stateDir>/debug.jsonl` | `src/index.ts:86-88` |

### 2.2 缺口（这才是"只留一条日志"的真因）

1. **live 路径把 `skill` 丢了。**【证据】`src/index.ts:713-717` 在 `taskExecution !== null && 本地单` 时**提前 return**，于是 `src/index.ts:753-755` 那段"把 report.skill 加进 persona.skills"永远走不到。结果：接了真实会话的工单，`xcity_report {skill:'debugging'}` 被接受但**技能不留痕**，只剩 40 XP。
2. **作品没有索引，只有 SHA。**【证据】交付文件是内容寻址的（`.xcity-results/<sha 前 24 位>.md`，`task-execution.ts:59-65,168-187`），路径只写进 `task.output`；`persona` 里没有指向作品的字段，`xcity_status` 也不输出 persona（`src/tools/world.ts:63-73` 的输出清单里没有）。唯一读口是 HTTP `/api/personas`（`src/routes/api.ts:416-443`，注册于 `src/index.ts:1300-1305`）。
3. **失败即终局。**【证据】一轮结束没收到有效交付 ⇒ `taskFail` ⇒ `status='failed'`（`task-execution.ts:107-113`；`src/sim/step.ts:400-404`），而调度器只挑 `ready`（`scheduler.ts:105`），回收逻辑只救 `in_progress`（`recovery.ts:105`）。**一次忘调 `xcity_report` 就浪费掉那轮真实工作**，且没有任何"部分成果"落盘。

### 2.3 最小加法（都在既有容器内，不新增表）

- **① 把 live 路径的 skill 缺口补上**：让 `report` 分支在返回前复用 `src/index.ts:752-755` 那一段（同一函数内已有，不是新技术）。**这是本次调研里唯一零新概念、可立刻做的"成长证据"。**
- **② 让作品可被找到**：把交付文件的相对路径也写进 persona 侧已有的 `taskIds` 之外的落点——【需确认】"作品"是新概念（建议形如 `persona.artifacts[taskId]=path`），按纪律必须先问用户；替代方案是**不加字段**，只让 `xcity_status` 的工单板额外打印 `task.output` 里的路径（纯展示，零模型）。
- **③ 关系/名声**：`affinity` 已在，但没有"一起干完一张单"的因果；"名声"**在代码里不存在**（全仓无 reputation 字段）。【需确认】名声若要，先定它是什么（计数器？会影响什么？），否则就是为一个不存在的需求加实体。

---

## 3. 气泡：为什么现在发不出来，最小后端修法

### 3.1 前端的硬要求（逐字段）

`_spawnSpeechBubble(g)`（`slowvale-mirror/src/js/GameView.js:93878-93889`，调用点 `:93830` `beat.dialogue && this._spawnSpeechBubble(beat.dialogue)`）：

| 要求 | 行为 | 证据 |
|---|---|---|
| `dialogue.speaker_id` | **缺就 throw** `[dialogue] 缺少 speaker_id`（throw 会让整段 beat 失败，不只是不显示） | `GameView.js:93879` |
| 必须在场景里 | 无 `this.scene` ⇒ 静默 return | `:93880` |
| `dialogue.audience` | **必填**：`{kind:'place',place_id}` 或 `{kind:'role_ids',role_ids:[…]}`；缺 `audience` 直接 throw；place 还要等于 viewer 当前所在地点 | `:93138-93167`（`s5`/`r5`），调用 `:93883` |
| `isRoleBlocked(speaker_id)` | 为真 ⇒ 不显示 | `:93884`，deps 绑定 `:6807` |
| speaker 必须在同场景且已挂载 | `speaker_id===actorId ? this : this._getActor(speaker_id)`，没有 sprite/scene ⇒ 不显示 | `:93887-93888` |
| `dialogue.text` | 空值 throw `泡内容为空` | `:92751` |
| `dialogue.tone` | 可选，只认 `speech/sms/thought`（默认 speech） | `:92728-92736` |
| **位置** | **不需要**：泡固定在说话者 sprite 上方 `c.y - 48` | `:92712`(`Ap=48`)、`:92786` |
| **时长** | **不是字段**：`jL(text)=min(1200+120*len, 6000)` ms，由文字长度决定；`dialogue.duration_ms` **前端从不读** | `:92742-92743`、`:93878-93888` |

### 3.2 后端的两个独立缺陷

1. **包形状错了（致命，先于字段）**：`independentDialogue` 发的是 `{epoch,seq,tick_marker,kind:'independent',actorId,beats:[…]}`（`src/adapters/slowvale/visual.ts:40-57`）。前端只认 `playback:{kind:'independent',tracks:{[actorId]:beats}}`：`O()` 取的就是 `le.playback`（`GameView.js:4853`），`Eb()` 用 `Object.keys(playback.tracks)` + `end_states` + `actor_commit_states` + intros/exits 拼 actor 集合（`:5106-5134`）。`playback` 缺失 ⇒ 集合为空 ⇒ `pe.length===0` ⇒ `Q(seq); return`，**整包被静默丢弃**（`:4868-4873`）。信封校验只查 `epoch/seq/tick_marker`（`:2979`、`:3089-3093`），所以**错误形状能通过校验但什么也不发生**。
2. **字段缺失**：即使形状对了，`beat:{text}`（`src/adapters/slowvale/server.ts:262-268`）仍缺 `speaker_id` 与 `audience`，必然 throw。

### 3.3 最小后端修法（前端零改动）

```ts
// server.ts pushSay：形状改用已有的 independentTimeline（visual.ts:81-98，前端认的那一种）
const packet = independentTimeline({
  epoch: cursor.epoch, seq: envelopeSeq, tickMarker, actorId,
  beats: [{
    dialogue: {
      speaker_id: actorId,                              // GameView.js:93879
      text,
      tone: 'speech',                                   // 可选，默认 speech
      audience: { kind: 'place', place_id: placeIdOf(actorId) }, // :93142-93145，
                                                         // placeId 直接取 world.agents[].placeId（project.ts:167 已在用它当 location.place_id）
    },
  }],
})
```

- 只需 **1 个函数替换 + 3 个字段**；`independentDialogue` 可以删（`visual.ts:40-57` 目前只有 `server.ts:262` 一个调用点）。【证据】`grep pushSay` 仅 `server.ts:255,470`，入口是调试接口 `POST /api/xcity/say`（`server.ts:459-475`）。
- `role_ids` 也可用作 audience，但**place 更省**：不用维护名单，且与"同场景才看得见"的语义一致。
- **不需要**发送位置、不需要 `duration_ms`（前端按文字长度自己定），也不需要 `end_states`/commit。
- **不要**改成 `kind:'group'`：group 要求 participants ≥2 且每个 participant 都出现在某个 step（`GameView.js:5138-5150`），单人说话会被 throw。
- 一处要留意：visual 包**不按 route.role_ids 过滤**（只有 `scene_state` 才过滤，`GameView.js:5258-5261`；visual 走 `:3089-3093`），所以"谁能看见"实际由 `audience` 决定，路由不必改。

> 【推测】`docs/PLAN-9H-THREE-RESIDENTS.md:30,62` 里"补 speaker_id/duration_ms 即可"的判断是不足的：**只补字段仍不会显示**，因为形状不对；而 `duration_ms` 是无效字段。

---

## 4. 跨多小时的长任务：怎么表达进度且不重复调模型

### 4.1 现状：两个进度通道都被掐断

1. **工单进度（0..1）**：接 DSH 的本地单不推进（`interaction.ts:97`），所以 `task.progress` 从 0 直接跳到 1；而 `task.changed` 的 10% 里程碑只在 `advanceWork.progressed` 有值时才会发（`src/sim/emit.ts:115-126`）⇒ **板子上长时间 0%**。
2. **头顶活动进度**：前端按锚点字段自己插值（`project.ts:112-141` 注释明说 `progress = clamp((elapsed + now-anchor)/duration)`），但 **`taskAttemptId !== undefined` 时直接 return，不返回 `duration_seconds`/`progress_elapsed_seconds`/`progress_anchor_game_time`**（`src/adapters/slowvale/project.ts:130-140`）⇒ DSH 工单头顶**根本没有进度条**。
3. **时间尺度**：1 tick = 1 游戏分钟，默认 100ms/tick（`constants.ts:17`、`project.ts:133`）；内容里 `estimateTicks` 已经是 900/1800/600 这种量级（`src/content/packs/default.ts:422-428`）= 15/30/10 游戏小时 ≈ 90/180/60 秒真实时间。【证据】

### 4.2 不重复调模型的证据（现状其实已经做到了）

- 每个 `attemptId` 只 prompt 一次：`attempts.has(attempt)` 就跳过（`task-execution.ts:48,56`）；`requestId` 由 `world.id+createdAt+attempt` 派生，宿主按它去重（`:57-59`）。
- 心跳节流 1s：`nextTaskHeartbeat = Date.now()+1000`（`src/index.ts:388-391`）。
- 因此长任务**不需要**周期性唤醒模型；缺的只是"把已经知道的时间变成画面"。

### 4.3 最小方案（零新增实体、零额外模型调用）

**一个推导函数，两处消费**（避免第二处真相）：

- 定义"投影进度"：`p(t) = min(0.95, (world.tick - live.startedAt) / (task.estimateTicks ?? DEFAULT_TASK_TICKS))`。数据全在手上：起点的 `Activity.startedAt`（`src/sim/activity.ts:29-49`；DSH 单的 `endsAt=startedAt`，因为 `taskAttemptId` 走的是另一条分支，`activity.ts:47`），和 `task.estimateTicks`。
- 消费点 A（板子）：在 `interaction.ts:97` 那条 `continue` 之前，用该投影写 `task.progress`（**封顶 0.95，绝不到 1**）。状态仍是 `in_progress`，完成只认 `settle`；`emit.ts:115-126` 现成的里程碑逻辑就会每 10% 发一条 `task.changed`，前端进度条自然动。
- 消费点 B（头顶）：`project.ts:132` 那条提前 return 改成给 DSH 单也算 `duration_seconds`（= 投影用的分母 ×60）与 `progress_anchor_game_time = gameTimeAt(startDate, startedAt)`——**前端自己插值，不需要任何推送**（`project.ts:115-117` 注释）。

【推测/风险】A 与 B 必须共用同一个分母函数，否则板子与头顶会给出两个进度；且封顶值要 <1，否则"100% 但还在忙"会重演 `interaction.ts:94-96` 记录过的那类自相矛盾。**"长任务说话"（里程碑处冒一句气泡）属于新增表达**：文字从哪来必须先定（内容库/任务标题），按"人设是内容"的红线不许写在代码里，【需确认】。

---

## 5. 仍未确定

1. `hasXcityRoleModel` 的 provider 硬等值是否应放宽（换成"任意可用 provider"或可配置）。这是产品决策，会让"指定模型"这条红线松动。【需确认】
2. 测试 profile 里 `mmt-vision` 到底是不是**唯一**障碍：本轮没有可用的测试 profile 运行环境，无法验证"换成合规模型后能否领到"。目前只有 `docs/PROGRESS.md:11136` 的"仍 ready"与文档记录，属**文档证据**而非本轮实测。
3. `xcity_report` 要求 `delivery.turn === delivery.startedTurn`（`task-execution.ts:123`）——**一次工单必须在一个 turn 内汇报**。长任务若被模型拆成多轮，汇报会被拒；这条是否需要按 `attempt` 放宽，未定（会牵动"防串轮"的原始理由）。
4. 一轮结束未交付即 `failed`（不可重试）是否合理：目前失败单不会被任何阶段救回，是否应允许"退回 ready 重试"未定。
5. 气泡的 `audience` 用 `place` 还是 `role_ids`：place 更省，但前提是 `world.agents[].placeId` 与前端 `location.place_id` 完全一致（`project.ts:167` 用同一字段投影，**看起来一致，未在真机验证**）。
6. persona 是否需要"作品"字段（`artifacts`）——属新增概念，未与用户确认。

---

## 6. 证据索引（本文档引用到的位置）

- 调度/依赖：`src/sim/ready.ts:45-51,61-82`、`src/sim/scheduler.ts:87-89,104-193`、`src/sim/interaction.ts:83,97-136`、`src/sim/recovery.ts:49,74-83,138+`、`src/sim/step.ts:447-537`
- DSH 执行：`src/adapters/slowvale/task-execution.ts:18-143,145-187`、`src/bridge/dsh-adapter.ts:50-76`、`src/adapters/slowvale/xcity.ts:79-91`、`src/index.ts:332-401,707-775,856-884`
- 成长：`src/persona/store.ts:43-103`、`src/persona/study.ts:20-31`、`src/persona/types.ts:1-16`、`src/routes/api.ts:416-443`、`src/index.ts:1300-1305`
- 气泡：`src/adapters/slowvale/visual.ts:40-98`、`src/adapters/slowvale/server.ts:255-306,459-475`、`slowvale-mirror/src/js/GameView.js:2979,3089-3093,4845-4878,5106-5134,92712,92728-92776,93138-93167,93830,93878-93889`
- 进度：`src/adapters/slowvale/project.ts:100-146`、`src/sim/emit.ts:47-50,115-126`、`src/domain/constants.ts:17,44-70`、`src/content/packs/default.ts:422-428`
- 历史记录：`docs/PROGRESS.md:6156,6161,11136`、`docs/PLAN-9H-THREE-RESIDENTS.md:16-18,30,61-63`
