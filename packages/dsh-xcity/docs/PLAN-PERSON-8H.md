# PLAN-PERSON-8H v3 —— 把 Agent 变成活人

> 修订：2026-11-27 00:07（Asia/Shanghai）。v1 每小时只有一句验收、执行太快；v2 拆到文件/算法/测试/回滚；v3 修掉 v2 自相矛盾的地方（缺执行指针、eat/study 新 kind、恢复率没算账、H4/H5 接口空泛），并做了五轮评审。
> 目标：让小镇里的 agent 像一个真实的人——有内在状态、自己决定做什么、记得今天、会主动说话，并且真的在游戏里跑起来。

## 执行指针

- **当前小时：H4**
- 已完成：H1（需求模型）、H2（需求驱动的一天）、H3（今天记得什么）
- 定时任务：`schedule-6225b704-f1d2-49ca-9f9f-f99b3bb36a4f`（01:00 起每小时，投递到本会话）
- 推进规则：DoD 全过才把「当前小时」改成下一小时；没做完就下一轮继续，不跳。
- 本份计划覆盖 H1–H8；H8 完成后原地重写本文件，接下一份 8 小时。

## 0. 执行协议（每次运行先读这一节）

### 0.1 每次只做一小时
1. 读「执行指针」，只做当前小时；不要提前做下一小时。
2. 先花 5 分钟读该小时涉及的源码与测试，确认前置还在。
3. 时间盒：**至少 45 分钟**，标准切分：读代码 5' → 实现 30' → 测试/仿真 15' → 加固与文档 10'。验收通过后不要立刻停，按该小时的「加固清单」继续用剩余时间；**不要为赶时间跳过细节**。
4. 若 55 分钟还没做完：保留一个**可构建、测试可跑**的最小完整切片，不推进指针，把卡点、下一个动作、已改文件写进进度日志。

### 0.2 完成定义（DoD，逐条打勾才能推进指针）
- [ ] `npm run build` 退出 0。
- [ ] 本小时新增/修改的测试通过（测试名写进日志）。
- [ ] `npm test` 全量通过，记录“总数/通过/跳过”。
- [ ] 有仿真或真机证据（数字、日志、截图路径；没有就写“未验”与原因）。
- [ ] 本小时改动没有碰坏短信/手机/作息（跑相关旧测试）。
- [ ] 注释带流程号：H2=R478、H3=R479、H4=R480、H5=R481、H6=R482、H8=R483；没有新增“模式/开关”。
- [ ] 进度日志、PROGRESS、执行指针三处都更新。

### 0.3 证据格式
每次在进度日志写一行 + 块：
```
- 2026-11-27 02:00 · H2 完成
  测试：node --test test/life-choice.test.js（7 条全过）；npm test 881/880/1
  仿真：node tools/person-lab.mjs --hours 24 → 工作 41% / 吃饭 9% / 休息 12% / 社交 6%；切换 3.2 次/小时
  真机：未验（独立宿主未起）；原因：…
  改动：src/sim/life.ts、src/sim/needs.ts、tools/person-lab.mjs、test/life-choice.test.js
```

### 0.4 回滚
- 开工前记下 `git status --short` 与本小时预计改的文件。
- 只回滚**本小时的文件**（`git checkout -- <文件>` 或反向 patch），不要 `git checkout .`，工作区还有别的包的未提交改动。
- 构建红超过 15 分钟修不好：先回滚到可构建状态，把失败原因写进日志，指针不动。

### 0.5 提交
- DoD 全过之后，把**本小时改动的文件**用显式路径 `git add` 后提交，消息格式 `feat(xcity): Rxxx <一句话>`。
- 不碰工作区里其他包的未提交改动；不 amend 历史；不 push。
- 提交前先 `git diff --check`；提交后把 hash 写进进度日志，方便回滚。

### 0.6 硬约束
- **不要重启正式桌面进程**（Web 55308 / 桥 7788），会打断每小时投递；真机验收用独立 profile。
- **不要问用户**；用户在睡觉，所有判断写进文档。
- 不新增配置开关/模式；行为一律常开。
- 不为了测试在正式路径加分支；测试构造数据，不改生产语义。
- 1 tick = 1 游戏分钟，1440 tick = 1 天；时间一律从 `world.tick` 推，不另存时钟。

---

## 1. 人的五要素与判断标准

| 要素 | 现在有什么 | 这轮要补 |
|---|---|---|
| 身体 | position / placeId / station / state / activity | 无 |
| 内在 | 体力/饥饿/社交（H1，尚未驱动选择） | 由需求决定去哪 |
| 记忆 | DSH 会话历史（对话） | 今天做过什么，进入回复 |
| 关系 | 短信线程（玩家） | 对玩家/对其他角色的熟悉度 |
| 意愿 | 09:00–12:00 / 14:00–18:00 去工位 | 由需求 + 记忆 + 关系决定 |

判断标准：**不服务于“这个人”的字段/机制优先删；服务于人的优先补。**
工单是工具；人可以为了工单工作，但模型不该以工单为中心。

### 1.1 基线（不许回归）
- 短信：回复按轮次写回（R473，只认 `source.kind === 'user'` 的插入才算另一个请求）；手机「通讯」字段形状（R474，preview/message_id/from_role_id）。
- 世界：`gameMode` 已删、开工会议与心跳自动开会已删（R475）；待命行为常开；上班时段自派（R476）；`needs`（R477）。
- 回归：`npm test` 873 条、872 通过、1 跳过；`npm run build` 通过。
- **不要动**：短信/手机字段形状；不要给正式进程加重启；不要恢复被删的模式开关。

## 2. 依赖图（顺序不能换）

```
H1 needs（已完成）
 └─ H2 选择器（吃/休息/社交/工作/学习）
     ├─ H3 当天记忆 → 进入回复
     │   └─ H4 主动发短信（需要记忆与社交）
     ├─ H5 学习/技能（复用选择器）
     ├─ H6 关系/互访（需要多角色与社交）
     └─ H7 独立宿主验收（需要前面全部）
         └─ H8 清理 + 下一份计划
```

---

## 3. H2 · 由需求决定去处（替换固定作息）

### 3.1 目标
把 H1 的三个量接进 “下一步做什么”：最缺什么就去做什么；有 ready 工单时仍然让给调度器；一天里工作、吃饭、休息、社交、学习都真实发生。

### 3.2 前置
H1 的 `sim/needs.ts`、`needsOf`、`Agent.needs`；`sim/life.ts` 现有 `selfLifeCommands`；`sim/step.ts` 的 `agentActivity` 分支；`sim/movement.ts` 到站处理。

### 3.3 设计
**不新增 activity kind / AgentState**。v2 里“eat 和 study 各加一个 kind”会把移动、到站、结束、前端映射四处都改一遍，收益不值；用现有两种活动承载，只加一个**用途标签** `activityPurpose`（只影响需求恢复与日志，不进状态机）：
- **吃饭** = `agentActivity rest`，目标站点是 `kind === 'breakroom'`，trigger 文本“去吃点东西”；
- **休息** = `agentActivity rest`，目标站点是歇脚点或非 breakroom 的 `rest` 站点；
- **社交** = `agentActivity meet`，目标站点是 `converse`；
- **学习** = `agentActivity work` + `skill: 'research'`，站点选 research/code，trigger 文本“想学点东西”（前端本来就按 skill=research 画 SkillStudyActivity）；
- **工作** = `agentActivity work` + 角色对应的 skill。

为了能指定“去哪个站点”，只给 `WorldCommand.agentActivity` 加一个可选字段：
```ts
stationId?: string
```
ingest 里：给了且站点存在、能力匹配、还有空位 → 用它；否则退回原来的能力搜索。
这不是新概念，只是把“选站”从 ingest 的默认行为变成调用方可选。

新增纯函数（`src/sim/life.ts`）：
```ts
export interface LifeIntent {
  kind: 'meal' | 'rest' | 'social' | 'work' | 'study'
  stationId: string | null
  skill?: 'code' | 'review' | 'research' | 'compute'
  ticks: number
  reason: string
}
export function chooseLife(world: World, agent: Agent): LifeIntent | null
```
优先级（已按实测调过）：
1. `hunger < 35` → meal（breakroom / 休息区）；
2. 23:00–07:00 → sleep（去 `rest` 站点；还没有“家”，先睡休息区，家留给下一份计划），除非有 ready 工单；
3. `energy < 30` → rest（rest 站点）；
4. `social < 35` → social（`converse`；没有第二个角色时不去，留给 H4）；
5. 上班时段 → work（本职能力优先，满员/太远就退到任意工位；有 ready 工单时让给调度器）；
6. 非上班时段且精力/饥饿尚可 → study（research/code 里挑最近的）；
7. 都不满足 → null（交给待命行为）。

规则：
- 有 `ready` 工单时不发任何自派命令（与现在一致）。
- 正在做事（`activityUntil` 未到 / `path` 非空 / 手上有单）不换主意。
- 同一个活动至少 45 tick、最多 120 tick；做完后需求已回补，避免立刻重复。
- 阈值带滞回：低于阈值触发，恢复到 70 以上才算“满足”，防止在阈值上抖动。
- 站点选不到（全被占）→ 返回 null，不要每 tick 重试轰炸；加一个 30 tick 的失败冷却。

恢复率（按 1440 min 一天算过账，见 3.3.1）：
| 活动 | 每分钟（叠加在基线上） | 一次典型时长 | 净效果 |
|---|---|---|---|
| meal | hunger +1.2、energy +0.05 | 50 tick | 补 ~56 饥饿 |
| sleep | energy +0.35、hunger −0.02 | 480 tick | 补 ~146 体力 |
| rest（小憩） | energy +0.35、hunger −0.02 | 60 tick | 补 ~18 体力 |
| social | social +0.6 | 40 tick | 补 ~22 社交 |
| work/study | energy −0.02、hunger −0.01、social −0.01 | 90 tick | 叠加在基线上 |

#### 3.3.1 一天的账（改数值前先算）
- 饥饿：基线 −0.075/min × 1440 = −108/天；两顿 ×56 = +112（略有富余）；实测 3 天平均 48–53，最低 5–16。
- 体力：基线 −0.045 × 1440 = −64.8；睡 8h 净 +146（会夹到 100）；工作额外 −0.02 × 480 = −9.6；实测平均 73–76。
- 社交：基线 −0.04 × 1440 = −57.6；一次 40 tick 聊天 +22 → 每天约 2 次才平衡；实测平均 39–43，略缺，正好推动 H4 主动发短信。
**改任何一个数值，先重算这张表，写进注释。**

### 3.4 步骤（流程号 R478）
0. 内容：办公室原版 24 把椅子没有“吃饭/睡觉”落点。补 `station.breakroom-01`（茶水间，4 座）与 `station.lounge-01`（东侧休息区，6 座），kind=`breakroom`、capabilities=`['rest']`；座点是**相对锚点**的偏移，且 raw slot 与 anchor+slot 都要在可走格上。
1. `src/protocol/wire/commands.ts`：`agentActivity` 增加可选 `stationId` 与 `purpose`；同步 `describeCommand`。
2. `src/sim/step.ts` 的 ingest：`stationId` 合法且空闲 → 用它；否则退回能力搜索。**已经在站点上（path 为空）就直接开始**，不要把命令丢掉。
3. 改 `src/sim/life.ts`：新增 `chooseLife`；`selfLifeCommands` 改为调用它并生成带 `stationId`/`purpose` 的命令。
4. 改 `src/sim/needs.ts`：`advanceNeeds` 按 `activityPurpose` 恢复（meal/sleep/rest/social/study/work），只在 `station !== null` 时生效（走路去吃饭不算吃过）。
5. 世界尺度：`WALK_SPEED` 0.18 → 0.9（1 tick=1 分钟下横穿办公室 6.5 小时 → 78 分钟）；`step` 里走路期间 `activityUntil = undefined`，到站后由 movement 起算。
6. `idle.ts`：清掉“idle 却挂着半截路径”的残留（否则选择器以为他在走，饿到 0 也不自派）；`paceGoal` 半径至少 3 步（不然 WALK_SPEED 提高后看不到走路）。
7. 新增 `tools/person-lab.mjs`（见 3.5）。
8. 新增 `test/life-choice.test.js`；更新受影响的旧测试（走路计时、非上班学习、站点 slot 审核）。
9. 构建 + 测试 + 24h/72h 仿真 + `npm test`。

### 3.5 仿真工具（后续小时复用）
`tools/person-lab.mjs`：
- 参数：`--hours 24`（**游戏小时**，1 小时 = 60 tick）、`--agents 1|8`、`--seed <name>`、`--json`。
- 做法：`createPluginState(resolveConfig(...))` + `createRuntime({ idleActionsEnabled: true, selfLifeEnabled: true })`，从 08:00 推进 N×60 tick。
- 输出：每个角色的活动 tick 占比、每小时“生活活动”切换次数（走路/到站不算）、需求 min/avg/max、站点占用峰值、异常（NaN/越界）。
- 退出码：有不变量违例就 1，便于以后每小时直接当验收命令。
- 验收用 `node tools/person-lab.mjs --hours 72`（三天，看稳态），单日看 `--hours 24`。

### 3.6 测试矩阵
| 用例 | 断言 |
|---|---|
| 饥饿优先 | hunger=10、energy=90 → meal，stationId 是 breakroom |
| 体力优先 | energy=10、hunger=90 → rest，不是 breakroom |
| 社交优先 | social=10、其余满 → social（有第二个角色时） |
| 有工单让位 | ready 工单存在 → 自派为空 |
| 做事中不换 | activityUntil 未到 → 不发新命令 |
| 吃饭恢复 | meal 50 tick 后 hunger 明显上升，且不超过 100 |
| 睡觉恢复 | 同样 50 tick，purpose=sleep 涨 energy、**不涨** hunger |
| 站点被占 | stationId 被占 → 退回能力搜索或 null，不报错 |
| 上班/下班 | 10:00 无需求→work；20:00→study 或 null |
| 不抖动 | 24h 内状态切换 ≤6 次/小时 |

### 3.7 加固清单与实测（2026-11-27 01:20）
- [x] 站点不够时不每 tick 轰炸：选择器返回 null 时不发命令、不打日志；代价是“饿了没座位就站着”，实测 8 人时休息位 10 个，不再排队。
- [x] 抢 `capacity=1` 站点：`occupancyOf` 已把 `targetStation` 算占用（breakroom 峰值 4、lounge 峰值 6，未超容量）。
- [x] 整夜 work/study：72h 分布 sleep 32–33%，夜里没有 work/study。
- [x] 日志能看出原因：命令 `trigger.text` 写“饿了，去吃点东西 / 夜深了，去睡一觉 / 到了上班的点…”；`activityPurpose` 可区分 meal/sleep/rest/social/study/work。
- [x] 抖动：生活活动切换 **0.8–1.0 次/小时**（上限 6）。
- [x] 需求：72h 平均 e 73–76、h 48–53、s 39–43；最低 h 5–16、s 7–18（不再到 0）。
- 已知取舍：吃饭暂时显示成 RestActivity（复用 rest 动作）；夜里睡在休息区（没有“家”），留给下一份计划。
- 实测命令：`node tools/person-lab.mjs --hours 72`；24h 结果：work 12.5–31.3%、study 25–37.5%、sleep 28–33%、meal 3.5–6.1%、social 0–2.8%、walking 5.6–15%、idle <1%。
- 7 天稳定：无 NaN/越界；hunger 最低 0–1（醒前最饿）、均值 45–50；休息区峰值 6/6；切换仍 0.9–1.0/h。
- 单角色 72h：不报错；social 降到 0（没有第二个人，也没主动短信）——留给 H4 主动发短信。

### 3.8 风险与回滚
- 风险：活动抖动、整天空转、站点死锁、meal 与 rest 站点选错。
- 回滚文件：`src/sim/life.ts`、`src/sim/needs.ts`、`src/sim/step.ts`、`src/protocol/wire/commands.ts`、`tools/person-lab.mjs`、`test/life-choice.test.js`。

---

## 4. H3 · 今天记得什么（经历进入回复，流程号 R479）

### 4.1 目标
角色回短信时知道自己“今天做了什么、现在在做什么”，不再只靠会话里的聊天记录；记忆来自世界事实，不编。

### 4.2 设计
新增纯函数 `src/sim/day-summary.ts`：
```ts
export function summarizeDay(world: World, agentId: string, nowTick: number): string[]
```
- 取"今天"的活动：`startedAt` 在今天，**或跨 midnight 但 `endedAt` 落在今天**（昨晚的觉算今天凌晨，起点夹到 00:00）；
- 最多 5 条已完成/进行中，格式“09:20–10:40 在 <站点名> 工作”，不出现内部 id；
- 当前活动单独一条“现在在…”，没有就“现在闲着”；
- 没有记录时返回空数组（prompt 里写“今天还没做什么”，不编）。
- **activities 是环形缓冲（会裁剪）**：裁剪掉了就少说，不补造；摘要只读还在世界里的记录。

接线：
- `respond-sms.ts` 的 `promptText(content, dayLines?)` 增加一段“你今天到目前为止：…”，只在有内容时加；
- `respondViaSession` 的 deps 加 `dayContext`，`index.ts` 注入 `(peerRoleId) => summarizeDay(world, peerRoleId, world.tick)`（world 从 state 取；取不到就返回空数组）；
- 不把 DSH 内部工具调用/思考写进摘要。

### 4.2.1 步骤（R479）
1. 新增 `src/sim/day-summary.ts`（纯函数，见上）。
2. 修 `src/sim/activity.ts`：活动记录要**到站后**才采纳（`targetStation === null`），否则 stationId=null、startedAt=出发时刻，摘要会出现“08:00–09:43 学习”这种没有地点的条目。
3. `respond-sms.ts`：`promptText` 支持 `dayLines`；`respondViaSession` 从 `deps.dayContext` 取摘要并拼进投递文本。
4. `index.ts`：给 responder 注入 `dayContext`（`state.currentWorld()`）。
5. 新增 `test/day-summary.test.js`；构建 + 全量测试。

### 4.3 测试矩阵
| 用例 | 断言 |
|---|---|
| 空世界 | 返回 []，prompt 不出现“你今天：” |
| 当天 3 条活动 | 3 行、按时间排序、含站点名 |
| 跨天 | 只取当天，不混昨天的 |
| 当前活动 | 有“现在在…”一行 |
| 截断 | 最多 5 条，总长 ≤300 字 |
| 不泄露 id | 不含 `agent-`/`station.`/`task-` |

### 4.4 加固清单与实测（2026-11-27 02:05）
- [x] 时间用 tick 推（`hhmm(tick % 1440)`），与前端时钟同一套，不碰 `Date.now`。
- [x] 摘要预算：实测 5 行 109 字（上限 300）；prompt 总长约 351 字，仍在可接受范围。
- [x] 不泄露内部 id：测试断言不含 `agent-`/`station.`/`task-`。
- [x] 跨午夜：08:30 的真实仿真里能看到「00:00–07:35 在东侧休息区睡觉」+「现在在东侧休息区吃饭」。
- [x] 空世界：`summarizeDay` 返回 `[]`，prompt 不加“你今天…”段。
- [x] 摘要失败不拖垮短信：`dayContext` 抛错时退回“无摘要”，短信照常投递（有测试）。
- [ ] 真实会话发短信核对：正式进程仍是旧构建，留 H7 独立宿主统一验（不假装验过）。
- 已知限制：活动记录是环形缓冲，裁掉的就少说；玩家指令的 trigger.text 可能不含“吃/睡/学/聊”，退回 kind 标签。

### 4.5 风险与回滚
- 风险：摘要编造、时间窗错、prompt 过长。
- 回滚：`src/sim/day-summary.ts`、`src/adapters/slowvale/respond-sms.ts`、`src/index.ts`、对应测试。

---

## 5. H4 · 主动找玩家（自己发起短信，流程号 R480）

### 5.1 目标
社交需求低、或刚做完值得说的事时，角色会主动给玩家发一条短信；有节制、不打扰。

### 5.2 设计（决定在 sim，发送在 app，世界只经 step 改）
- 世界字段（历史，随存档）：`Agent.lastInitiatedSmsTick?: number`、`Agent.initiatedSmsDay?: number`、`Agent.initiatedSmsCount?: number`（最多 2 条/天）。
- 纯函数 `src/sim/initiative.ts`：
  ```ts
  export function advanceInitiative(world: World): { agentId: string; reason: string }[]
  ```
  - 条件：游戏时间 07:00–23:00；`social < 35` 或刚完成“值得说”的活动（工单/学习完成）；
    距上次 ≥180 tick（3 游戏小时）；当天 ≤2 条；不在忙/对话/暂停。
  - 命中就在**同一 tick** 写回 `lastInitiatedSmsTick` / 当天计数，并返回意图；不重复命中。
  - 新月（`floor(tick/1440)` 变了）重置当天计数。
- `sim/step.ts` 在 needs 之后调用 `advanceInitiative`，把意图转成 `agent.initiative` 事件（新增事件类型）。
- app 层（`index.ts`）：`hub.subscribe(events => …)` 看到 `agent.initiative` → 给角色会话投一条主动短信提示。
  - prompt 文本 = 主动短信指令 + `\n\n主动短信编号：xcity-init:<sessionId>:<tick>`（文本唯一，tracker 按文本登记）。
  - `createSmsReplyTracker` 扩展 `kind: 'player-sms' | 'initiative'`（默认 player-sms），`track` 记下 kind，`observe` 返回 `{reply: {peerRoleId, text, kind}}`。
  - 收到 initiative 回复 → `appendIncoming`；player-sms 路径行为不变。
- 失败/空回复：清登记，不重试；限频已经消耗，3 小时后再试；记录原因。
- 为什么不让 app 直接改世界字段：D41 要求所有世界变更经 step；把“决定 + 限频”放进 sim，app 只负责 IO。

### 5.3 测试矩阵
| 用例 | 断言 |
|---|---|
| 社交低、白天、间隔够 | 触发一次并写回限频字段 |
| 23:30 / 06:00 | 不触发 |
| 当天第 3 条 | 不触发 |
| 跨天 | 计数重置，可再触发 |
| 正在工作/对话 | 不触发 |
| 重复 tick | 不重复触发 |
| 事件载荷 | `agent.initiative` 含 agentId/reason/tick |
| 空回复 | 不写线程、不重试（app 侧） |

### 5.4 加固清单
- 确认不会和“玩家发的短信”回执串线（tracker 分类型）。
- 重启后限频字段来自存档，不会立刻重复。
- 真机/会话日志里看到主动短信的 prompt 与回复。

### 5.5 风险与回滚
- 风险：刷屏、串线、会话忙时堆积。
- 回滚：`src/sim/initiative.ts`、`src/index.ts`、`src/domain/types.ts`、测试。

---

## 6. H5 · 学习与技能（流程号 R481）

### 6.1 目标
“学习”是真实活动：在 research/code 站点花时间，技能成长，并影响之后的选择。

### 6.2 设计
- 复用 H2 的 `study`：`agentActivity work + skill: 'research'`（code 技能同理），在 research/code 站点；到站后状态 working。
- **不新增“每技能等级”概念**：persona 现有 `skills: string[]`（会不会）与 `xp`（熟练度总量）已经够表达“学习有积累”。要等级是下一份计划的事。
- 事件：`sim/step.ts` 在 `syncActivities` 返回完成活动时发 `agent.state`，载荷目前只有 `{agentId, activityId, status}`；补上 `kind`/`skill`（活动对象上已有）。
- app 层（`index.ts`）：
  - `const hub = createEventHub()` 之后 `hub.subscribe(events => …)`；
  - 看到 `status === 'completed'` 且 `kind === 'work'`、`skill === 'research'|'code'` → 取该 agent 的 persona（`persona.list()` 里找，找不到就 upsert），`skills` 并集加入该技能，`addXp(1)`；
  - XP 规则：**一次完成的学习块 = 1 XP**（块长 45–120 tick）；不做“每分钟折算”，避免重复计。
- 选站仍按角色能力（sim 不认识 persona）；“技能反过来影响选择”留给下一份计划，写进 H8 的下一份计划，不在这里硬接。

### 6.3 测试矩阵
| 用例 | 断言 |
|---|---|
| study 完成事件 | 带 kind/skill/agentId |
| app 层 XP | 一次完成 → persona.xp +1、skills 含 research |
| 重复事件 | 同一 activityId 只记一次 XP |
| 无 persona 存储 | 不报错，跳过 |
| 时间窗 | 20:00 可学习，23:30 不学习（睡觉优先） |

### 6.4 加固清单
- 学习时长与 XP 的关系写进文档，不让“1 小时 = 1 级”。
- 面板/日志能看到“在学什么”（前端 activityTypeOf 已有 SkillStudyActivity）。

### 6.5 风险与回滚
- 风险：事件重复计 XP、persona 写失败、sim 越界。
- 回滚：`sim/activity.ts`、`index.ts`、`protocol` 事件载荷、测试。

---

## 7. H6 · 人和人的关系（流程号 R482）

### 7.1 目标
两个角色会互相拜访/聊天；关系值随互动变化；单角色世界正常退化。

### 7.2 设计
- 世界字段：`Agent.affinity?: Record<string, number>`（对每个认识的 agent 0–100，缺省 50；历史，随存档）。
- `chooseLife` 的 social 分支：
  1. 先看有没有人**已经在去/在**一个还有空位的 `converse` 站点（`activityKind === 'meet'` 且 `targetStation` 非空、`occupancyOf < capacity`）→ 直接加入同一个站点；
  2. 没有就选 affinity 最高的空闲角色，挑一个空闲的 converse 座位（办公室是一人一座，不要求同站容量 ≥2；两人坐同屋不同椅也算聊天，H6 用 district 判定"同屋"）；
  3. 没有第二个角色 → 不生成 social（留给 H4 主动发短信）。
- 完成时（**sim 侧**，`sim/activity.ts` 结束 meet 活动那一段）：找出同一站点、也在 meet 的其他角色，双方 `social += 恢复率`、`affinity += 2`（封顶 100），写一条 decision 日志。
- 避免互等：超过 30 tick 还没到目标站点 → 放弃，回 idle；不要每 tick 重发。

### 7.3 测试矩阵
| 用例 | 断言 |
|---|---|
| 两角色社交低 | 出现一次互访，affinity 上升 |
| 单角色 | 不生成 social，不报错 |
| 站点容量 1 | 不选它，避免互堵 |
| 重复互动 | affinity 不超过 100 |
| 存档 | affinity 读写一致 |

### 7.4 加固清单
- 关系值变化进日志（谁和谁、为什么）。
- 两人同时找对方不会无限互等（超时放弃）。

### 7.5 风险与回滚
- 风险：互等死锁、affinity 无限增长、单角色回归。
- 回滚：`sim/life.ts`、`sim/activity.ts`、`domain/types.ts`、测试。

---

## 8. H7 · 独立宿主真机验收（不重启正式进程）

### 8.1 目标
用独立 DSH profile 加载新构建，在真实浏览器里看到“活人”的一天；正式进程重启留给用户。

### 8.2 步骤
0. **15 分钟决策点**：15 分钟内起不来独立宿主，就转 8.3 的桥直连方案，不把整小时耗在环境上。
1. 建隔离 profile（参考 xcity-feed-test）：独立 `stateDir`、Web 与桥用 3189/7799 这类非正式端口；不指向正式存档/会话。启动前用 `lsof -iTCP:3189 -iTCP:7799` 确认端口没被占。
2. 启动独立宿主，加载当前 `lib`；浏览器打开独立桥地址。启动命令先查 `docs/PROGRESS.md` 里的 xcity-feed-test 记录；没有就按 DSH 的 profile 机制做，不猜参数。
3. 核对清单（逐项记录）：
   - 世界正常、不重建；
   - 10 分钟观察：按需求/作息移动，不是站着；
   - 发一条短信：回复引用当天活动；「通讯」正常显示；
   - 等一条主动短信（或确认触发条件），线程与未读正确；
   - 快照/日志/SSE 证据。
4. 写“正式进程重启后 5 分钟核对清单”到 PROGRESS（明确这是用户要做的事）。

### 8.3 失败回退
- 独立宿主起不来：退化为“用新构建起独立桥 + 真实前端”，只验手机/活动；无法验的项写“未验 + 原因”，不假装验过。

---

## 9. H8 · 清理、收尾与下一份计划（流程号 R483）

### 9.1 目标
按“是否服务于这个人”清理模型；把下一份 8 小时计划接上。

### 9.2 步骤
1. 证据表：对 agent-teams/live、纸条邮箱、多场所 travel 逐项写“现在还有谁在用 / 删了影响什么”；
   有真实使用就留，没有就删；删一项就同步测试与文档。
2. 活动镜像（`agent.activity*` vs `world.activities`）与绑定（`boundAgentId` vs `bindings.json`）不在本小时硬做：
   写进下一份计划，并给出第一步（先统一读入口，再改写入）。
3. 更新 PROGRESS/COMMS/ARCH 中失效概念。
4. **原地重写 `PLAN-PERSON-8H.md`**（保持文件名）：下一份 8 小时 H1–H8，重置指针与进度日志；不新建带序号文件。
5. 确认定时任务仍指向本文件。

---

## 10. H1 归档（已完成，不再占小时）

- 2026-11-26 23:57：`Agent.needs`（0–100，100=满足）+ `DEFAULT_NEEDS`；`sim/needs.ts`（BASE_DECAY + STATE_RATE）在 `step` emit 前推进；新建角色 rng ±8，老档 reconcile 补默认。
- 证据：`test/needs.test.js` 6 条；全量 873/872/1；build 通过。行为未变（固定钟点），H2 接选择器。
- 24h 仿真：饥饿到 0、体力低，正好证明 H2 必须接“吃/休息”。

## 11. 评审记录（五遍）

1. **第一遍（完整性）**：v1 每小时只有一句验收，H1 已完成后仍占一整小时；缺仿真工具、回滚、证据模板、时间盒。→ H1 改归档；补 `person-lab`、DoD、回滚、证据格式。
2. **第二遍（依赖与语义）**：eat/study 是否新增状态没定；H3 的 world→bridge 注入点没写；H4 限频状态没定；H5 XP 写入路径没定；H6 配对死锁没考虑；H7 有重启正式进程的风险。→ 逐项补设计（eat/study 不新增 AgentState；dayContext 端口；lastInitiatedSmsTick；事件→persona；converse 容量与超时；H7 改独立 profile）。
3. **第三遍（可执行与冗余）**：删掉重复的“验收”段落；每小时统一“目标/前置/设计/步骤/测试矩阵/加固/风险/回滚”；补时间预算与 R 编号；确认依赖顺序不可交换；确认定时提示与计划一致。
4. **第四遍（v2→v3，实际挑出的硬伤）**：
   - v2 没有「执行指针」，定时任务读不到当前小时 → 补在第 6 行；
   - v2 让 eat/study 各加一个 activity kind，又说“不新增状态”，且 activityKind 不在结束重置的判据里 → 改成 `stationId` + 现有 rest/work，不加 kind；
   - 恢复率没算一天的账（hunger +0.3/min 吃一顿要 3 小时）→ 补 3.3.1 的收支表；
   - H4 只写“tracker 类型不同”没写接口 → 补 `kind` 参数与 onTick 位置；
   - H5 误以为 persona 有“每技能等级”（实际只有 skills 列表 + xp）→ 改成 skills 并集 + XP；
   - H6 没写“加入已有 meet”，两人会各挑一个站点 → 补配对规则；
   - H7 没写环境超时 → 补 15 分钟决策点；
   - H4 初版让 app 直接改世界限频字段，违反“世界只经 step 改” → 改成 sim 决策 + 事件，app 只负责投递。

5. **第五遍（v3 内部一致性）**：
   - 夜里“回歇脚点睡觉”写成了 rest 命令，但歇脚点不是站点、命令无法指定 → 改成去 `rest` 站点睡，并注明“还没有家”；
   - 把 H4 的限频写回从 app 改回 sim（D41：世界只经 step 改），app 只负责投递与回写短信线程；
   - 补 §1.1 基线与 §0.5 提交规则，保证每小时从可构建、可回滚的状态开始；
   - 复核执行指针、R 编号、定时提示与文件路径一致。

## 12. 进度日志

- 2026-11-26 23:57 · H1 完成（见第 10 节证据）。
- 2026-11-27 00:07 · 计划 v3：五轮评审；修掉缺指针、eat/study 新 kind、恢复率没算账、H4/H5 接口空泛、H6 配对、H7 超时、夜里睡歇脚点（非站点）、H4 app 改世界（改回 sim 决策 + 事件）；补基线、提交规则。基线提交 `bb1efc2`。下一小时 H2。
- 2026-11-27 01:25 · **H2 完成**。`chooseLife` 按“饿 > 夜里睡 > 累 > 社交 > 上班 > 学习”选择；活动用 `purpose` 标签区分 meal/sleep/rest/social/study/work，只影响需求恢复（不新增 kind/状态）；命令带 `stationId` 指定茶水间/休息区；办公室补 4 座茶水间 + 6 座东侧休息区。
  修正：走路期间不再起算活动时长（远端通勤不再半路耗光）；已在站点上直接开始（不再空转 90 tick）；`WALK_SPEED` 0.18→0.9；idle 残留路径清理；pace 半径至少 3 步。
  证据：`test/life-choice.test.js` 11 条；全量 885 条，884 通过、1 跳过；`person-lab --hours 72`：sleep 32–33%、work 15–23%、study 15–21%、meal 5.6–6.2%、social 4.6–5.6%、walking 3–20%、idle <1%、切换 0.8–1.0/h；需求均值 e 73–76 / h 48–53 / s 39–43。投影：meal→EatActivity/eat、sleep→SleepActivity/sleep、rest→RestActivity/sit（不再是“吃饭画成睡觉”）。
- 2026-11-27 02:05 · **H3 完成**。新增 `sim/day-summary.ts`：当天 + 跨午夜活动（起点夹到 00:00），最多 5 行、≤300 字、无内部 id；短信 prompt 注入“你今天到目前为止：…”；活动记录改为**到站后**才采纳（修 stationId=null / startedAt=出发时刻）。
  证据：`test/day-summary.test.js` 11 条；全量 896 条，895 通过、1 跳过；真实仿真 08:30 →「00:00–07:35 在东侧休息区睡觉」「现在在东侧休息区吃饭」；5 行摘要 109 字，prompt 351 字。真机发短信核对留 H7。
