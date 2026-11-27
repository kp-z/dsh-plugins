# 每日计划（R500）在 DSH 的投递落点

> 只读调研，未改任何代码。行号对应 2026-11-28 的工作区快照。
> 结论先行：**投递不是难点，取回结果和时钟口径才是**。

## 0. 三条硬结论

1. **没有任何投递入口能同步拿到模型的字**。所有入口都只是 `sessionController.prompt(...)`（语义见 `src/bridge/types.ts:240-241`："成功返回 `{accepted:true}`"），返回的是"已受理"，不是回答。要拿计划，必须自己开一条「投递 → 认轮次 → 收 assistant 文本」的取回通道。
2. **挂点是 `onTick`**（`src/index.ts:387-400`），不是 sim、不是宿主定时器：它是全插件唯一按游戏时间推进的节拍器（`src/runtime/index.ts:425-437`），且 `runtime.advance()` 能确定性快进测试（`src/runtime/index.ts:443-449`）。
3. **世界是 10 倍速**：`tickMs` 默认 100（`src/config.ts:67,198`），1 tick = 1 游戏分钟（`src/sim/life.ts:10,21`），一天 1440 tick ⇒ **一天 144 秒真实时间，1 游戏小时 = 6 秒**（`src/adapters/slowvale/types.ts:51` 注释："约 2.4 分钟"）。模型一轮 30-45 秒 = 3-4.5 个游戏小时。这条决定了 due 的口径（见 §6-c），比"挂在哪个函数"重要得多。

## 1. 现有投递入口（前置条件 / 失败表现 / 回执）

| # | 入口 | 位置 | 前置条件 | 失败表现 | 回执怎么拿 |
|---|---|---|---|---|---|
| A | `respondViaSession`（玩家短信） | `src/adapters/slowvale/respond-sms.ts:42-68`，调用点 `src/index.ts:1230-1245` | 世界里有该 peer（`index.ts:1220`）；`characterOf → sessionOf` 都非 null（`respond-sms.ts:47-50`）；宿主有 `prompt`（`index.ts:1242`）。无模型门、无空闲门 | 抛错 → 取消 tracker（`respond-sms.ts:63-65`）→ `index.ts:1246-1248` warn 后 `return null`。**"没绑定"也返回 null**（`respond-sms.ts:48,50`），HTTP 层两种失败不可区分 | `smsReplies` tracker（`index.ts:1235`，`session-events.ts:89-151`）：`<xcity-reply>` 内的那句（`reply.ts:2-20`） |
| B | `deliverInitiative`（主动短信） | `src/adapters/slowvale/initiative-delivery.ts:32-60`，调用 `index.ts:832-852` | 同上的两个查找（`index.ts:835-837`）。**无模型门、无空闲门** | 返回 false + `onError` warn（`index.ts:848`），**不重试**——限频已在 sim 侧消耗（`src/sim/initiative.ts:76-77`） | tracker kind `'initiative'`（`index.ts:843`）；`acceptAction` 对 initiative 永远不认（`session-events.ts:146`） |
| C | `createTaskExecution`（工单） | `src/adapters/slowvale/task-execution.ts:18-143`，heartbeat 由 `onTick` 1 秒节流触发（`index.ts:388-391`） | `hasXcityRoleModel`（`index.ts:337` → `dsh-adapter.ts:50-59`）+ `isIdleSession`（`index.ts:338` → `dsh-adapter.ts:62-76`）+ 有 in_progress 且带 attemptId 的单 + 本代次未投过 + 交付文件不存在（`task-execution.ts:55-65`） | `onError` warn（`index.ts:363`），attempt 已记账 → 不再重投（`task-execution.ts:57-71`）；turn 结束没汇报 → 判失败结算（`task-execution.ts:107-116`） | `observe` 按 `source.rpcId === requestId` 认轮次（`task-execution.ts:94-102`）；真结果靠 `xcity_report` 工具 + 交付文件（`118-137`） |
| D | captain 对话（`say`） | `src/index.ts:996-1016` | `state.activeSessionId` 非空 + `prompt` 存在；**无模型门/空闲门** | `{ok:false, reason}`（`index.ts:1013-1015`） | `replyFor` promise + `sessionController.inspect` 轮询兜底（`index.ts:1043-1081`） |
| E | 成员对话（套壳） | `src/index.ts:1017-1041` | `agentTeams.sendMessage` + Lead 在线 | `{ok:false, reason}`（`index.ts:1039-1041`） | 成员会话自己的 `session/event`（`index.ts:817-818`） |
| F | teamsPort | `src/index.ts:613-645` | `subagents`/`agent_teams_*` 可用 | 见 `dsh-adapter.ts:225`（套壳路径不用 prompt） | feed（`dsh-adapter.ts:233-252`） |

读这张表得到一条设计约束：**A/B 是"发完就不管"，C 是"发完必须收"**。每日计划属于 C 类（要结构化结果），但 C 的取回方式（工具 + 落盘）对计划太重（见 §3）。

## 2. "每天 06:30 各问一次"挂在哪

| 候选 | 优点 | 缺点 |
|---|---|---|
| **A. `onTick`（推荐）** `index.ts:387-400` | 确定性（同 tick 同输入）；不新增定时器；世界暂停时 tick 不动，自然不会问（`runtime/index.ts:377-379`）；`advance()` 可快进 | 只在世界推进时触发（这本就是想要的） |
| B. sim 发事件（照 `agent.initiative`：`sim/step.ts:488-493` → `index.ts:887-895`） | 与 initiative 同构，事件可观测/可回放 | 要**新增事件类型**（新实体）；`sim/` 不许认识"模型侧计划"（边界见 `runtime/index.ts:13`）；tick 里做不了异步 |
| C. 宿主 `setInterval` | 与游戏时钟解耦 | 世界暂停仍会问；多一份生命周期（热重载泄漏是踩过的坑，见 `runtime/index.ts:18-22`）；不可确定性测试；还要自己算"游戏 06:30" |

**结论：A。** `onTick` 已经是"世界之外还有真相"的既定出口（`runtime/index.ts:70-78` 明确要求"同步返回，异步自己丢出去"），计划提问完全符合这个契约。

时间口径注意：06:30 = tick 390，**只有 1 个 tick（100ms）**。tick 单调 +1（`runtime/index.ts:378`），所以命中可靠；唯一漏掉的情况是读档/重开落在 390 之后——那天不问，也就没有承诺，不算违约，可接受。

## 3. 怎么把结构化结果拿回来

### 3.1 现有 session-events 能观察到什么

- **能**：`user/message` 的 blocks 就是投递原文（tracker 拿整串当键：`session-events.ts:100-110` 存、`:122-124` 匹配）；`assistant/message` 的 blocks 就是模型原文（`:139-148`）；`data.source.rpcId` 带我们投递的 requestId（`task-execution.ts:94-102` 用它做轮次配对，**比文本相等可靠**）。
- **不能**：现有 tracker 只回吐 `<xcity-reply>` 里那一句（`session-events.ts:141` → `reply.ts:8-20`），计划的 JSON 不在标记里；而且它只对 `track()` 登记过的会话有反应（`session-events.ts:112-113`）。**直接复用 = 拿不到 JSON。**

### 3.2 最小可行取回路径（推荐 B）

- **B（推荐）事件旁路**：在既有 `listen('session/event')` 回调（`index.ts:901-965`）里加一个 observer，位置必须在 `index.ts:908` 的类型过滤**之前**（否则看不到 `turn/end`，紧挨 `index.ts:906-907` 即可）。状态只需 `Map<sessionId, {requestId, turn, text, resolve}>`：`user/message` 用 `source.rpcId` 认轮次 → `assistant/message` 记本 turn 最后一段非空文本 → `turn/end` 且 turn 相等时 resolve。约 25-30 行，零定时器、零轮询、不依赖可选服务。
- A 轮询 `sessionController.inspect`：有现成先例（`index.ts:1043-1081`，700ms 间隔、按 `time` 过滤）。零新状态，但是轮询、依赖可选服务（`index.ts:153-156`）、与 100ms 节拍不合拍。
- C 落盘 + 工具（`task-execution` 的 `.xcity-results` + `xcity_report`）：最可靠，但**要给角色加一个工具** = 新实体，否决。

**纪律**：不要动 `session-events.ts` 的 tracker——它被 R473/R494 回归钉着（`test/session-events.test.js:62-104`），为一个新用途改它就是把短信路径一起置于风险中。

## 4. 失败降级：判定顺序（每一步都是"跳过"，没有一步抛到 tick）

```
tick（世界未 paused —— paused 时 onTick 根本不触发）
 1. agent → character → session：用 sessionsByAgent(bindings, agentMap)
    （src/adapters/slowvale/xcity.ts:79-91，严格 1:1，歧义就放弃）；没有 → 静默跳过
 2. sessionControllerService.prompt 是函数（同 index.ts:1242 的判法）；没有 → 跳过
 3. hasXcityRoleModel(ctx, sessionId)（dsh-adapter.ts:50-59，与 taskExecution 同一条
    "自主开工"门槛 index.ts:337）—— 决策点，见下
 4. 投递 mode 'queue'，requestId 里带 world.id + day + agentId
 5. 抛错 → log，当天不再问（asked 已置位，daily-plan.ts:47-48）
 6. 等 ≤45s：超时 → 丢弃，不写任何承诺
 7. 到达时 dayOf(now) ≠ 请求时的 day → 丢弃（已经跑到第二天了）
 8. parsePlan → 0 条 → 不 apply（daily-plan.ts:56）；rejected 的原因要进日志
    （plan-prompt.ts:121-134 已带中文原因）
 9. 逐条 promiseBetween（幂等）；一条失败不影响其它条
```

第 3 步是**决策点**：加上它，测试 profile（没选 `mmt-vision` + `deepseekv41`）永远不问——这正是 WORKCHAIN.md 里"领不到活"的同一个门（`index.ts:337`）。我倾向保留（一条规则胜过两条），但必须让日志说清"今天为什么没问"。若 lead 认为"想一想今天"不算自主开工，去掉第 3 步即可，其余不变。

第 6 步的 45 秒不是随手写的：6 秒/游戏小时 ⇒ 45 秒 = 7.5 游戏小时，再长就等于"问完今天已经过完了"（见 §6-c）。

## 5. 最小实现

### 5.1 文件与签名（三个已存在，一个新建）

| 文件 | 现状 | 用到的导出 |
|---|---|---|
| `src/bridge/plan-prompt.ts` | 已有 | `buildPlanPrompt(input: PlanPromptInput): string`（`:67`）；`parsePlan(text, input: PlanParseInput): PlanParseResult`（`:225`） |
| `src/sim/commitments.ts` | 已有 | `promiseBetween(world, a, b, {what, dueTick, source})`（`:70`）；`settleCommitments(world, nowTick): Settlement[]`（`:150`，幂等 `:157`） |
| `src/bridge/daily-plan.ts` | 已有，**未接线**（`grep -rn createDailyPlanner src` 只命中自身 `:35`） | `createDailyPlanner(deps): { tick(agents, tick), askedOn, stop }`（`:35`）；`PLAN_MINUTE`（`:11`） |
| `src/adapters/slowvale/ask-session.ts` | **唯一新增模块**（~50 行，纯依赖注入、可单测） | `createSessionAsker({ prompt, timeoutMs, now, onError })` → `{ ask(requestId, sessionId, text): Promise<string \| null>; observe(sessionId, type, data, blocks): void; stop(): void }` |

为什么值得单独一个文件：`respond-sms.ts:1-7` 已经写下了这条教训——"这段逻辑原来内联在 index.ts 的桥配置里，出错时只能靠重启 + 手点"。计划投递比短信更容易出错（认轮次、超时、跨天丢弃），内联在组合根等于没法验证。
若 lead 要求零新文件，这 30 行就内联进 `index.ts` 的 `listen` 回调，代价是不可单测 + 组合根继续长胖——**这是本次唯一的"新增实体"，需要 lead 点头**。

### 5.2 `src/index.ts` 的插入点（共 5 处，都是加减几行）

1. **构造**（`index.ts:364-365` 附近，`taskExecution` 之后）：`createSessionAsker({...})` + `createDailyPlanner({ ask, promptFor, parse, apply, log })`；`ask` = 用 `sessionsByAgent` 查 session，再调 `asker.ask('xcity-plan:' + world.id + ':' + day + ':' + agentId, sessionId, text)`。
2. **`onTick`**（`index.ts:387` 内，现有两段心跳之前）：
   ```ts
   const world = state.currentWorld()
   if (world !== null) {
     for (const row of settleCommitments(world, tick)) debugLog('commitment', row) // 结算，幂等
     planner?.tick(world.agents, tick)                                              // 06:30 提问
   }
   ```
   两行都是同步纯函数 + 一个不 await 的 promise，满足 `onTick` 契约（`runtime/index.ts:70-78`）。
3. **事件旁路**（`index.ts:906` 紧前）：`asker.observe(sessionId, event.type, event.data, blocks)`——纯旁路，不消费事件，不改 908 之后任何逻辑。
4. **清理**：照 `index.ts:365` 的写法 `ctx.effect(() => () => { planner.stop(); asker.stop() }, 'xcity: daily plan')`。
5. **不改 `daily-plan.ts`**：它已覆盖"一天一次 / 失败不落承诺 / stop"（`test/daily-plan.test.js:22-60`）。

### 5.3 明确不新增

- **不新增领域类型/字段**：状态全用 `Commitment`/`CommitmentStatus`（`src/domain/types.ts:202-215`），`Agent.commitments` 已有（`:294`）。
- **不新增世界事件类型**（不发 `agent.plan`/`agent.commitment`）。要观测就写日志，不扩事件流。
- **不新增工具**（不加 `xcity_plan`，不要求角色写文件）。
- **不新增定时器**：节拍只有 `runtime` 一个（`runtime/index.ts:425-437`）。
- **不新增存档文件**：承诺随 `world.json`；不建 `plan.json`/`commitments.json`。
- **不新增配置开关**（不要 `planEnabled`）：要关就停世界（`autoStart`）或让 `slowvale.enabled` 关掉绑定。
- **不改前端**；**不改 `session-events.ts` 的 tracker**。
- **不重复实现时钟**：`daily-plan.ts:12` 又写了一遍 `DAY_TICKS = 1440`，而 `sim/life.ts:21`、`sim/memory.ts:10` 已有；建议改成 import（`sim/life.ts:64-66` 的 `minuteOfDay` 也行）——纯减法，可选。

## 6. 已知缺口 / 待 lead 决策

**(a) 自承诺（`with: ''`）无处落。** `parsePlan` 明确允许"我一个人做"（`plan-prompt.ts:258-262, 311-320`），而 `promiseBetween` 拒绝 `a === b`（`commitments.ts:73`）且要求两个 agent 都存在（`:75-77`）。接线必须选：① 空 `with` 的条目直接丢弃（0 行，但模型"一个人也要做完"的话就白说）；② 在 `commitments.ts` 补 `promiseSelf(world, agentId, input)`（约 6 行 + 单测）。推荐 ②，但这属于"新增函数"，要 lead 定。

**(b) id 双轨。** `parsePlan` 产出 `'plan-<agent>-<dueTick>-<i>'`（`plan-prompt.ts:313`），`promiseBetween` 自己生成 `'cmt-<day>-<pair>-<hash>'`（`commitments.ts:32-35`）。落地时**以 `promiseBetween` 的 id 为准**，`parsePlan.id` 不进世界，否则同一条承诺两套 id。

**(c) 10 倍速 × 模型时延 = due 口径问题（最值得先定）。** 06:30 问、答案 45 秒后到 = 游戏时间 08:15。任何"今天上午"的 due 都会被 `parsePlan` 判 `due-passed` 丢掉（`plan-prompt.ts:302-309`），而且失败是**静默的**（只进 rejected）。三条路：① 把"今天"改成"从到达时刻起 24h 内"（`plan-prompt.ts:326-328` 已留 TODO）；② 提前问（治不了根，10 倍速是时间本身）；③ 接受上午没计划。**建议 ①**，但那是 task-6 的口径，别在接线里偷偷改。

**(d) 承诺证据缺口（跨任务）。** `settleCommitments` 认两类证据：① `episode.with` 含对方——但 `episodeOfActivity` 恒写 `with: []`（`src/sim/memory.ts:49`），这条**永远不成立**；② 两人同地点各有 `meet` 活动且时间重叠（`commitments.ts:242-254`）——这条成立，`sim/relationships.ts:40-51` 是同一判据的既有实现。所以接线后没约到人的承诺基本都会 `missed`，只有显式 `keepCommitment` 能救。上线前要么补 `with` 的写入，要么先只演示 `keepCommitment` 路径。

**(e) 三个角色同时问 = 三个 turn 并发。** `mode 'queue'` 排在宿主队列里，第二个可能几十分钟后才跑（= 游戏时间几十小时，答案直接作废）。最小兜底：同一 tick 只发起一个（`planner.tick` 返回"本 tick 发起数"），或加 `isIdleSession` 门（代价：忙就不问）。不建议现在做并发控制，但要接受"另外两个今天可能没计划"。
