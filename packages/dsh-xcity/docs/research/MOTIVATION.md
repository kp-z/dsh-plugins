# RESEARCH · 动机分层与情绪（MOTIVATION）

> 任务：`task-60`（Lead 拆的调研）。作者：motivation-research。
> 纪律：**只调研，不改代码**（本轮唯一写入 = 本文件）。不重启进程、不跑全量构建、不碰前端。
> 每条外部结论带 URL；每条内部结论带**文件路径+行号**，并标注【证据】/【实测】/【推测】。
> 取证时间：2026-11-28 11:50–12:20（外链为当日抓取；行号对应当前工作区磁盘状态；实测脚本用 `node --input-type=module` 跑 `lib/`，未落任何文件）。
> 分工：`BEHAVIOR.md` 讲**决策架构**（B1–B6 已落地/已排期），`MEMORY-DECISION.md` 讲**记忆→行为的三条通路**（D1–D5）。
> 本文只回答两件事，不重议上面两份的结论：**(a) 为什么此刻做的是这件事（归因层）**、**(b) 此刻什么情绪、它怎么进决策与对话（affect 层）**。
> 流程号沿用 `M1…M5`（建议写进代码注释，方便 review）。

---

## 0. 结论先行

| # | 结论 | 依据 |
|---|---|---|
| **M-C1** | **缺的不是引擎，是归因。** `chooseLife` 已经是效用 argmax（`src/sim/life.ts:603`），候选+分数+加权都在；缺的是"哪一层赢了"。今天的归因表在真实决策点上**100% 记 `ok`**（实测 109/109），在每 tick 采样下**99.2% 记 `not-available`**（实测 13068 → 12957）——两种口径都读不出"为什么" | §1.2、§1.4；`src/sim/intent-stats.ts:18-43`、`src/sim/life.ts:419-422` |
| **M-C2** | **情绪现在是一块只降不升的社交刹车片。** `memoryMood` 只给 work/study 乘 (1±10%)、social 反向，吃饭/睡觉/休息恒为 1。实测 450 格情境扫描：36 次翻盘**全部**是 `social→work`，反方向 0 次；3 天 golden 世界 12960 次读 mood **恒为 0**（无工单/无承诺 → 不触发），而一旦有工单又是"一次裁决即顶到 ±1" | §1.3、§1.5；`src/sim/life.ts:554-601`、`docs/AUDIT-ROUND3.md:66-73` |
| **M-C3** | **性价比排序：Utility（已有，0 增量）> OCC 剪裁到 3 个标签（0 模型调用）> PAD/GOAP/BT/五维人格（都不该全量上）。** 3 人 / 10 tick/s / token 敏感这个约束下，"额外模型调用"必须恒为 0；只有"本地打分 + 事件后处理"能满足 | §2、§3、§3 表 |
| **M-C4** | **情绪进对话最便宜的落点是既有 prompt 的"此刻的事实"段**（`src/bridge/persona-prompt.ts:138-148`），因为模块边界**禁止 bridge import sim**（`src/protocol/boundaries.ts:151-156`）——所以情绪只能是 app 传进去的纯数据。这条约束恰好逼出正确形态：**情绪是事实，不是台词** | §4.3；`boundaries.ts:151`、`test/boundaries.test.js` |
| **M-C5** | **全部收益可零 schema 变更拿到**：`driver` 与 `emotion` 都是**派生量**（可从 `episodes`+`tick` 复算），不进存档、不给 `Episode` 加字段、不给 `Agent` 加字段。要拍板的只有 3 个小概念（§8），其中 1 个还要用户决定"要不要让情绪真的改行为" | §5、§5.2、§8 |

---

## 1. 现状取证（全部可复算）

### 1.1 已有零件（不是缺口）

| 能力 | 现状 | 证据 |
|---|---|---|
| 内在需求 | energy / hunger / social，0–100，基线衰减 + 用途恢复；meal/sleep/rest/social/study/work 各一条速率 | `src/sim/needs.ts:21,48-55,82-91`；阈值 `life.ts:49-51`（35/30/35）、夜间睡门槛 60（`:61`） |
| 决策 | `intentOptions` 六段候选 → `weightedScore`（性格 × 记忆心情）→ argmax | `src/sim/life.ts:424-514,587-601,603-619` |
| 归因 | 每个出口记一格 `IntentReason`（not-available / task-ready / hungry-no-breakroom / night-no-rest / no-rest-station / no-work-station / need-null / ok），模块级单例，快照给 API | `src/sim/intent-stats.ts:18-43,86-113`；`src/index.ts:1505` |
| 心情 | `memoryMood`：最近 1440 tick 的 ±salience **求和**，夹到 [-1,1]；`memoryWeightOf` 折成 ±10% | `src/sim/life.ts:100-103,537-566,574-579` |
| 主动搭话 | social<35 或"刚做完一件值得说的事" → ≤2 条/日、间隔 ≥180；`reason` 直接当短信正文的种子 | `src/sim/initiative.ts:15-20,51-80`；消费点 `src/index.ts:1020-1025` |
| 人设事实 | `buildCharacterSystemPrompt` 的"此刻的事实"是**纯事实列表**（名字/岗位/时钟/站点/在做/手上的单） | `src/bridge/persona-prompt.ts:105-148`；`src/bridge/types.ts:388-399` |

### 1.2 归因表实测：两种口径都读不出"为什么"【实测】

**口径 A（生产口径）**：`runtime` 每 tick 都调 `selfLifeCommands`（`src/runtime/index.ts:325`）→ 每个角色每 tick 都走一次 `intentOptions`。3 角色 × 4320 tick（3 游戏日）实测：

| 键 | 次数 | 占比 |
|---|---|---|
| `not-available` | 12957 | **99.15%** |
| `ok` | 111 | 0.85% |
| 其余 7 个出口 | 0 | 0 |

**口径 B（只在真正的决策点采样：活动结束、角色真空闲）**：109 次，**`ok` = 109（100%）**。

⇒ 这张表今天实际测的是"**这一刻能不能自派**"，不是"**为什么做这件事**"。`step.ts:548` 的注释也自述"一天 4320 个采样点里真正空闲只有 36 个"（3 人合计 ≈ 12 次/人/日），与 A/B 两组数一致。

### 1.3 权重实测：性格只会"让人少社交"【实测】

450 格参数扫描（10:00 上班时段；`hunger∈{20,30,34,40,55,70}` × `energy∈{25,35,50,70,90}` × `social∈{10,20,34,45,70}` × `diligence∈{0,0.5,1}`；3 人世界使 social 候选可生成）：

| 指标 | 值 |
|---|---|
| 拿到意图的情境 | 450 / 450 |
| 出现 ≥2 个候选的情境 | **108** |
| 其中 argmax ≠ 第一候选（"性格真的翻盘"） | **36（33.3%）** |
| 翻盘方向 | `social→work` **36 次**；`work→social` **0 次**；meal/rest/sleep **0 次** |

⇒ 现有常数（social 基础分 0.7、work 0.65、work ×(0.8+0.4·diligence)、social ×(1.1−0.2·diligence)）在结构上**只能单向翻盘**。所以"性格/心情有没有用"这个问题，光看"分化率"是看不出方向的（`life-diverge` 测的是差异条数，不测方向）。

### 1.4 心情实测：要么 0，要么满幅【实测】

- 3 天 golden 世界（无工单、无承诺、无中断）：`memoryMood` 读了 **12960 次，全部 0.0**；`episodes` 37 条/人/3 天 ≈ 12 条/人/日。
- 反向证据：`docs/AUDIT-ROUND3.md:66-73` 记录了"一次工单裁决写两条情节记忆 → 单次完工把 mood 顶到 +1、单次失败顶到 −1"。

⇒ 情绪在默认世界里**从不发生**，在有单的世界里**只有满幅**。中间地带不存在，所以它表现为开关而不是情绪。

### 1.5 "什么算正经事"已有三份口径（腐化点，先收口再加东西）

`docs/AUDIT-ROUND3.md:315` 已指出：`sim/memory.ts:141-145` 的 `isNoteworthy`、`bridge/plan-prompt.ts:108-112` 的过滤、`sim/life.ts:537-542` 的 `moodPolarityOf` 是同一件事的三种写法（第三档口径还不同）。
**情绪如果要再读一遍 episodes，就会变成第四份。** 所以本文推荐的第一步不是"加情绪"，而是"先让 polarity 只有一个定义"（M2-1）。

---

## 2. 五个候选方案，各自适合什么粒度

### 2.1 Utility AI / IAUS（我们已经在用的东西的完整版）

- 机制：每个决策由若干 **consideration** 组成；每个 consideration = 输入 → 归一化到 [0,1] → **响应曲线** → 分数；多个 consideration 用补偿方法（乘性/几何平均）合并。<https://uintel-go.utilityworlds.com/Documentation/UtilityIntelligence/Considerations/>
- 它解决的粒度：**每秒/每 tick 的"这一次选哪个动作"**，以及"同一动作在不同情境下该多想要"（例：敌人血越少越该打——这正是"响应曲线"存在的理由）。
- **对我们**：`IntentOption.score` 已经就是 consideration 的结果，`weightedScore` 已经是补偿（乘性），`chooseLife` 已经是 argmax。**我们不缺框架**；真正缺的是 IAUS 强调的另一半——**可读的分数来源**（"为什么这条 0.65 而不是 0.9"）。
- 不适用部分：IAUS 的编辑器/曲线库/权重调参工作流是为"几十个决策、上百个 consideration"设计的；我们只有 6 类 purpose，上曲线库等于给 6 个数字配一套配置系统。

### 2.2 GOAP（F.E.A.R. 起源；ReGoap 是可读实现）

- 机制：世界状态是一组 **fact**（`enemyVisible=true`）；**action** 有 preconditions/effects/cost；**goal** 是目标状态；planner 用 **A*** 搜一条动作链，执行中失败则重规划。<https://github.com/luxkun/ReGoap>（README 明确列了 `ReGoap/Core`、`ReGoap/Planner`，以及 `ReGoapPlannerSettings` 里的确定性/加权随机选目标、`ReGoapCondition` 的比较条件）。出处：<https://www.gamedeveloper.com/design/building-the-ai-of-f-e-a-r-with-goal-oriented-action-planning>
- 它解决的粒度：**5–15 步的动作序列**（"摸过去 → 踹门 → 找掩体 → 开枪"），也就是"一次决策要跨多个动作"的场景。
- **对我们**：我们的"多步"已经由别的东西承担了——`scheduler` 派单 + `movement/pathfind` 走路 + `activityUntil` 计时。GOAP 进来会与它们**抢"下一步谁定"**，还会要求把 `World` 重新表述成 fact 表（occupancy、station、task status 全是现成查询函数，不是 fact）。
- 它**不**解决的问题：归因。"计划器选了这条链"仍然回答不了"为什么是这个目标"，除非再给 goal 加效用——那就绕回 §2.1。

### 2.3 行为树（BehaviorTree.CPP）

- 机制：XML 描述树（`<BehaviorTree ID="…">`），节点用 `registerNodeType` 注册（可编成插件），数据经 blackboard 流动；`BehaviorTreeFactory::createTreeFromFile` 运行时加载。<https://github.com/BehaviorTree/BehaviorTree.CPP>
- 它解决的粒度：**反应式行为组合**（替代 FSM）：巡逻/警戒/交战之间的抢占与恢复，强调"树的结构就是策略"。
- **对我们**：策略是**数据驱动**的（needs 数值、traits、承诺），而树把策略写进结构。要在树里表达"hunger<35 且有空位才去吃饭"，要么把条件塞进入口节点（等于回到打分），要么给每个角色长一棵树（3 个人 × 一套内容，维护成本高于收益）。而且引入 = 新增一个解释器 + 一套 XML 内容管线 + 一个 GUI 生态（Groot2），是**典型的加法**。

### 2.4 OCC 情绪模型（评价理论）

- 机制：22 种情绪类型，由"情境的心理显著要素"区分；三大来源域：**事件**（按目标的 desirability 评价）→ 高兴/难过类，**动作**（按标准的 praiseworthiness 评价）→ 认可/责备类，**对象**（按态度的 appealing 评价）→ 喜欢/讨厌类。<https://pmc.ncbi.nlm.nih.gov/articles/PMC4243519/>
- 它解决的粒度：**每个事件之后**"他此刻是什么情绪、对谁、因为什么"，不是每 tick。
- **对我们**：这正是我们缺的那一层，而且**数据已经在了**——`Episode` 有 `summary`（"工单「X」做完了"/"没做完：…"/"守约：…"）、`with`（对谁）、`salience`（多重）、`tick`（多近）。OCC 的三域可以裁到两域（事件 + 动作），22 类可以裁到 3 类（见 §4.1），因为我们的世界只有"办成/没办成/答应别人的事"这三种显著情境。

### 2.5 PAD（Mehrabian 三维连续情绪）与 Big Five 人格

- PAD：Pleasure / Arousal / Dominance 三个数值维度表示所有情绪状态（Mehrabian & Russell, 1974 起）。<https://en.wikipedia.org/wiki/PAD_emotional_state_model>；把**情绪、心情、人格**三层整合的经典实现是 ALMA（<https://dl.acm.org/doi/10.1145/1082473.1082478>，摘要："integrates three major affective characteristics: emotions, moods and personality"）。
  - 适合粒度：**连续衰减**的情绪动力学（情绪随时间回落、几种情绪叠加）。适合"要驱动面部/语音表现"的角色。
  - 对我们：3 维 float + 衰减 + 到台词的映射表，换来的是"看起来更细腻"，但我们连"1 维能不能进对话"都还没验证。**先做有解释力的 1 维 + 1 个事件标签，比先做 3 维更接近主要矛盾。**
- Big Five / OCEAN：五个连续维度（开放性/尽责性/外向性/宜人性/神经质）。<https://en.wikipedia.org/wiki/Big_Five_personality_traits>
  - 适合粒度：**全局参数**（一次设定，长期影响所有决策的权重）。
  - 对我们：已经有 2 维（`diligence`/`duty`，`src/domain/types.ts:195,292`）。**问题不在维度少**：§1.3 实测 450 格里只有 108 个情境存在多候选，翻盘 36 次——候选太少，再给维度也只是把同样的两三个候选再分一次。加到 5 维会把"哪一维导致了这个选择"变成不可解释。

### 2.6 工业参考：把"评价"和"决策"分成两段

FAtiMA Toolkit（GAIPS）把角色拆成**可独立配置的资产**：`Emotional Appraisal`（判断世界事件 → 维护情绪状态）、`Emotional Decision Making`（**带着情绪**决定怎么行动）、`Social Importance Dynamics`（社交得体性）、`Role Play Character`（组合前三者的感知-行动循环）。<https://github.com/GAIPS/FAtiMA-Toolkit>
⇒ 对我们的意义不是"抄它的架构"，而是验证一个切分：**情绪是决策的输入，不是决策的副产物**；而且它由"事件评价"产生，不由"每 tick 推理"产生。

---

## 3. 现有实现 vs 候选方案

维度按要求取四项（可解释性 / 实现成本 / 额外 token / 与 needs 兼容性），另加"适合粒度"和"结论"。

| 方案 | 可解释性 | 实现成本 | 额外模型调用 / token | 与 `needs` 的兼容性 | 适合粒度 | 结论 |
|---|---|---|---|---|---|---|
| **现状：阶梯→argmax+traits+mood** | 中：有分数但不可见；归因表只记"能不能自派" | **0**（已有） | 0 / 0 | **原生**（阈值即硬门） | 每 tick 选一个 purpose | 保留；补归因（M1） |
| **Utility AI / IAUS 完整版** | 高：每条 consideration 都有曲线，可回放 | 中高：曲线库 + 配置 + 调参工作流 | 0 / 0 | 高（needs 天然是 [0,1] 输入） | 每 tick、多动作、多 consideration | **不搬框架**，只借"分数来源可读"这一条 |
| **GOAP（ReGoap/Orkin）** | 中高：有计划链可打印，但"为什么是这个目标"仍需外部效用 | 高：fact 表 + planner + 重规划 + 与 scheduler 划权 | 0 / 0（目标由模型给则 +N） | 中：needs 要离散成 fact | 5–15 步动作序列 | **不做**（与 scheduler/occupancy 抢决策权） |
| **行为树（BT.CPP）** | 中：树是策略，追责到节点容易，追责到"为什么这个角色这样"难 | 中高：新解释器 + XML 内容 + 生态 | 0 / 0 | 低：数据驱动条件要挤进节点/黑板 | 反应式行为抢占 | **不做**（策略变结构 = 换内容就要改树） |
| **OCC 全 22 类** | 高（有名字、有对象、有原因） | 中：要判 22 类的前置条件 | 0（规则版）/ **+37 次/日**（模型版，见 §3.1） | 高：直接读 `Episode` | 每事件（不是每 tick） | **裁剪到 3 类再做**（M2） |
| **PAD 三维** | 低（三个 float 说不出"为什么"） | 中：映射表 + 衰减 + 台词映射 | 0 / 0 | 中：需要一个"需求→PAD"的任意映射 | 连续情绪动力学 | **不做**（先证明 1 维能进对话） |
| **Big Five 五维** | 低（维度间相关，事后归因不可靠） | 低（5 个数字） | 0 / 0 | 高 | 全局倾向 | **不扩维**（实测瓶颈在候选数量，不在维度） |

### 3.1 对"3 角色 + 10 tick/s + token 敏感"，哪种最划算：明确给数

现状的模型轮次上限（不是估算，是代码常量）：每日计划 1 次/人/日 = 3，主动短信 ≤2 次/人/日 = 6 ⇒ **≤9 轮/日**；`tickMs` 默认 100ms（`src/config.ts:76`，即 **10 tick/秒**）。

| 做法 | 额外模型调用 | 每日合计（3 角色） |
|---|---|---|
| 本地打分 + 本地评价（本文推荐） | **0** | **≤9（不变）** |
| 每事件问一次模型"他现在什么情绪" | +1 / episode | +37（实测 12 条/人/日）⇒ **≈46/日，5.1 倍** |
| 每 tick 问一次（Generative Agents 式） | +3 / tick = **30 次/秒** | **2,592,000/日** |
| 只往既有 prompt 加一行事实 | 0 新增轮次 | +15~20 token/轮 |

⇒ **划算的是最后一行 + 本地评价**：情绪的表达成本是"每轮多一行字"，情绪的产生成本是"0 次调用"。**任何把情绪推导放到模型里的方案，都会让 token 敏感这个约束当场失效。**

---

## 4. 情绪怎么进决策与对话（最小字段集与更新时机）

原则：**情绪由事件产生、由纯函数复算、只以"事实"身份进 prompt、只通过既有通道改行为。**

### 4.1 最小字段集（3 个标签 + 3 个附带字段，全部派生，不落档）

| 字段 | 取值 | 怎么来（不用新数据） |
|---|---|---|
| `label` | `proud`（办成了）/ `frustrated`（没办成）/ `guilty`（答应了别人没做到） | `episodePolarity` = +1 → proud；−1 且 `with` 为空 → frustrated；−1 且 `with` 非空 → guilty |
| `about` | 触发它的那句 `episode.summary` 原文 | 直接引用，不加工（同 `logs.ts` 对 `trigger.text` 的纪律） |
| `with` | 相关角色 id 或 null | `episode.with[0]` |
| `intensity` | (0, 1] | `salience × 时间衰减`，衰减曲线**复用** `scoreEpisode` 的近因项（`src/sim/memory.ts:377-391`），不新写第二套公式 |
| 窗口 | 建议 **240 tick**（≈4 游戏小时） | 理由：日小结窗口 1440（`life.ts:100`）太长，"今天上午被泼了一脸"到晚上还在气头上不像人；240 刚好跨过"一个长活动 + 一顿饭" |

**不新增的东西**：不给 `Episode` 加 `emotion`/`polarity` 字段；不给 `Agent` 加 `mood`/`emotion` 字段。

### 4.2 更新时机

| 用途 | 何时算 | 为什么 |
|---|---|---|
| 决策侧（加权） | 每个决策点算一次（`chooseLife` 里已经是"一 tick 一次 mood"） | 与现有 `memoryMood` 完全同构：纯函数、可重放 |
| 对话侧（事实行） | **每轮开聊时现算**（不缓存） | 缓存会与 `episodes` 漂移；`episodes` 上限 150（`memory.ts:15`），现算是 O(150)，可忽略 |
| 主动短信侧 | `advanceInitiative` 每 tick 本来就在跑 | 已有通道，零新增调度 |

### 4.3 三条通路，以及"为什么不是第四条"

1. **进决策（低风险两处）**：
   - 社交对象：`socialStationId(world, agent, preferPeer)` 已有 `preferPeer` 参数（`life.ts:286`），赴约那条路已经在用。情绪带 `with` 时把它传进去 → "想找刚跟自己有关的那个人"。**改 1 个调用点。**
   - 主动短信理由：`initiative.ts:72-73` 的两条 reason 加一条情绪分支；因为 `src/index.ts:1023` 直接把这个 `reason` 当短信正文的种子，**情绪会真的改变他说什么**，且 0 额外调用。
2. **进对话（事实一行）**：`WorldContextFacts`（`bridge/types.ts:388-399`）加可选 `emotion?: {label, about}`，`buildCharacterSystemPrompt` 在"此刻的事实"里加一行；由 `src/index.ts:1867` 注入。**不动台词模板，只动事实表**——这是这份代码里已有的纪律（facts 段"刻意只有事实、没有句子"）。
3. **进显示（可选、本轮不做）**：`adapters/slowvale/logs.ts:176` 的 `decision.mood` 现在是写死的 `null`；`docs/FRONTEND-SURFACE.md:50` 记录前端支持 `MoodLevel` 三档（好/一般/不好）。要填就得给 adapters 注入回调（adapters 不许 import sim，`boundaries.ts`），**成本 > 收益**，列为不做。
4. **"每 tick 用模型推理情绪"**：做不到也不该做——见 §3.1 的 259 万次/日。

---

## 5. 推荐方案（能直接照着改 `sim/`）

### 5.1 五个改动单元（M2 拆成两步：先收口 polarity，再加 emotionOf）

| 编号 | 改哪里（文件:函数） | 改什么 | 动 schema？ | 效果 | 风险 |
|---|---|---|---|---|---|
| **M1** | `src/sim/life.ts:376-380`（`IntentOption`）、`:107-115`（`LifeIntent`）、`:424-514`（六个出口）、`:603-619`（`chooseLife`）、`:624-651`（`selfLifeCommands`） | 加可选 `driver: 'need'\|'duty'\|'routine'`：吃饭/休息/睡觉/想说话→`need`；赴约→`duty`；上班/夜里/学习→`routine`。`chooseLife` 把它带出去；`selfLifeCommands` 与 `step.ts:558` 把 `trigger.text` 写成 `动机｜原因`（该字段已存在、已落档） | **否**（`Activity.trigger` 已有 `kind:'self'`+`text`） | 活动/日志/前端"为什么"一栏直接可读；`agentActivity` 命令不变 | 极低：只是给已有返回值加一个标签 |
| **M2-1** | `src/sim/memory.ts`（`isNoteworthy` 旁）、`src/sim/life.ts:537-542` | 把 `moodPolarityOf` 收口成 `memory.ts` 的 `episodePolarity()`（−1/0/+1），`life.ts` 改为 import；`plan-prompt` 那份由 `index.ts` 注入（bridge 不能 import sim） | 否 | "正经事"从 3 份口径变 1 份（`AUDIT-ROUND3.md:315` 指出的腐化点） | 低：纯搬移，需同步改 `test/life-memory.test.js` 的 import |
| **M2-2** | `src/sim/memory.ts:376-400` 附近 | 新增 `emotionOf(agent, nowTick): {label, about, with, intensity, tick} \| null`：在 `EMOTION_WINDOW=240` 内取 **polar** 且 `scoreEpisode` 最高的一条；`intensity = salience × recency`；`label` 按 §4.1 的三分支 | 否 | 情绪有了来源、对象、强度，且**可重放** | 低：纯函数；单测覆盖衰减与确定性 |
| **M3** | `src/bridge/types.ts:388-399`、`src/bridge/persona-prompt.ts:105-148`、`src/index.ts:1867` | facts 加可选 `emotion`，prompt 加一行"`- 你此刻的心情：因为「…」有点…（没聊到就别说）`" | 否 | 情绪进入每轮对话（计划/短信/聊天共用） | 低：不传则输出与现在逐字节相同 |
| **M4** | `src/sim/life.ts:286,492-497`、`src/sim/initiative.ts:70-74` | 情绪 `with` 参与社交选人（`preferPeer`）；`intensity ≥ 0.5` 时给短信一条情绪理由 | 否 | 情绪**真的改行为**（不是展示） | **中：需要用户拍板**（见 §8-3）；须守住"不吃不睡"不变 |
| **M5** | `src/sim/intent-stats.ts` | 新增 `byDriver`（4 键：need/duty/routine/none）+ `observeDriver()`；**只在真拿到意图时累加**；旧 `byReason` 一个字不改 | 否（内存单例） | 归因分母从"每 tick"变成"每次决策"，表第一次可读 | 低：新表与旧表并列 |

**顺序建议**：M1 → M2-1 → M2-2 → M3 →（拍板后）M4；M5 与 M1 同批（同一处调用点，分开合并反而两次改同一函数）。
**合并粒度**：M1+M5 一次、M2-1 单独一次（纯搬移，用完现有测试证明零行为变化）、M2-2+M3 一次（纯函数 + 一行 prompt）、M4 单独一次（行为改变，要 golden 解释）。

### 5.2 schema 决定：四处"不加"

| 要不要 | 决定 | 理由 |
|---|---|---|
| `Agent.mood` / `Agent.emotion` | **不加** | 派生量落档 = 两处真值。今天已经踩过同类坑：`needs` 是落档的、`affinity` 是落档的，而 `memoryMood` 是现算的——后者没有不一致风险，前者有；情绪应该跟后者同类 |
| `Episode.emotion` / `polarity` | **不加** | episode 写入口有 4 处（活动、工单、守约、日小结），加字段就要 4 处都填；而 `summary` 前缀已被 3 处消费。**收口消费方比加字段便宜**（M2-1） |
| `Activity.kind` / `AgentState` 新取值 | **不加** | `life.ts:6-8` 明写这是纪律；情绪不是状态机 |
| 存档版本 | **不升** | 本文没有任何落档字段变化 |

---

## 6. 最小验收（3 条，可复算）

基线数字都是本轮**实测**（§1.2–§1.4），不是估计；判据写成"改动后应满足"，可直接拿今天的数当反例。

### A1 · 动机归因不再全是 `ok`（"同一情境下能说出为什么"）

- 现状反例：真实决策点 **109/109 全 `ok`**（§1.2 口径 B）；每 tick 口径 99.2% `not-available`。
- 判据（新增 `test/life-motive.test.js`，3 角色 / 3 游戏日 / 与 `life-diverge` 同场景）：
  1. `byDriver` 非零键 **≥ 2**（预期 `need`+`routine`；构造一个 due 承诺后 `duty` > 0）；
  2. 最大键占比 **≤ 0.9**（不允许又退化成"全是同一类"）；
  3. 旧的 `byReason` 快照与改动前**逐键相同**（`test/intent-stats.test.js` 全绿即证）；
  4. 三个固定情境的断言：`10:00 + hunger=28` → `need`；`02:00 + energy=20` → `routine`；`有 due 承诺 + 上班时段` → `duty`。
- 复算：`node --test test/life-motive.test.js`。

### A2 · 权重"真的翻盘"，且不只一个方向

- 现状反例：450 格里 36 次翻盘，**方向集合 = {`social→work`}**（§1.3）。
- 这条判据有两种成立方式，取哪一种由本轮改不改数值决定，**不能同时取**：
  - **护栏模式**（只做 M1–M3，不动常数）：36 次、方向集合恰为 1 个、逐格结果逐字复现今天的数；
  - **目标模式**（做了 M4 或调过常数）：翻盘次数落在下面区间，且方向集合 ≥ 2。
- 判据（新增 `test/life-flip.test.js`，同一 450 格网格、同 seed、同场景；下面按**目标模式**写）：
  1. 翻盘次数 ∈ **[20, 120]**（下界防"权重失效"，上界防"生活崩"）；
  2. 翻盘方向集合 **≥ 2**（至少出现一次 `work→social`，证明社交也能被抬起来）；
  3. `meal/rest/sleep` 的翻盘次数 = **0**（硬门不许被权重动摇）。
- 复算：`node --test test/life-flip.test.js`。**为了让测试不必复制公式**，把 `life.ts:587` 的 `weightedScore` 导出（本仓库已有"export 只为测试"的先例，见 `life.ts:75`、`:552`）。

### A3 · 情绪可复算，且真的进了对话（0 新增调用）

- 判据（新增 `test/emotion.test.js` + 扩 `test/bridge-persona.test.js`）：
  1. 在 tick T 写一条 `没做完：干活`（salience 0.6、`with: []`）：`emotionOf(agent, T+10)` = `{label:'frustrated', about:'没做完：干活'}`，且 `intensity(T+10) > intensity(T+200)`（单调衰减）；
  2. 同一 world 重放两次，`emotionOf` 的结果**逐字段深相等**（确定性，照 `test/determinism.test.js` 的手法）；
  3. `buildCharacterSystemPrompt` 带去情绪 facts 时输出含"心情"与该 `about` 原文；**不带情绪 facts 时输出与现状逐字节相同**；
  4. 跑 1 游戏日，模型轮次数与改动前相同（`turn-cost`/`plan-stats` 的 `turns` 不变）⇒ "额外模型调用 = 0"是被测出来的，不是承诺。
- 复算：`node --test test/emotion.test.js test/bridge-persona.test.js`。

---

## 7. 明确不做

| # | 不做 | 为什么（一句话 + 依据） |
|---|---|---|
| 1 | GOAP / HTN / 行为树引擎 | 我们的"多步"已由 `scheduler`+路径+活动时长承担；再加 planner 就是**第二套"下一步谁定"**，且要把 `World` 重写成 fact 表（§2.2–§2.3） |
| 2 | PAD 三维连续情绪 + 衰减矩阵 | 3 个角色、连"1 维进对话"都还没验证；三维还要一张"情绪→台词"的映射表，无法判定对错（§2.5） |
| 3 | Big Five 扩到 5 维 | 实测瓶颈是**多候选情境只有 108/450**，不是维度少；加维度只会稀释归因（§1.3） |
| 4 | 用模型做情绪评价 / 每 tick 推理 | +37/日 或 259 万/日，且**不可复算**（进不了 golden 测试）（§3.1） |
| 5 | 给 `Episode` 加 `polarity`/`emotion` 字段 | 会让"什么算正经事"从 3 份变 4 份；收口消费方更便宜（§5.2） |
| 6 | 给 `Agent` 加落档 `mood`/`emotion` | 派生量落档 = 两处真值，与 `episodes` 必然漂移（§5.2） |
| 7 | 情绪影响吃/睡/休息 | 现有 ±10% **刻意**排除它们（`life.ts:570-572` 注释）；放开就是"难过得不去吃饭"的生活崩坏 |
| 8 | 填 adapters 的 `decision.mood`（`logs.ts:176`） | 纯展示；adapters 不许 import sim，要加注入回调，成本 > 收益 |
| 9 | 新增 `AgentState`/`Activity.kind` 取值 | `life.ts:6-8` 的既有纪律 |
| 10 | 情绪面板 / 情绪曲线 / 情绪漏斗 | 展示层，不属于本次"情绪进决策与对话"的目标；等 A1–A3 有数再说 |

---

## 8. 需要用户拍板的新概念（按"如无必要勿增实体"逐条论证）

| # | 新概念 | 为什么需要 | 能不能不加 | 建议 |
|---|---|---|---|---|
| 1 | `MotiveDriver`（`need`/`duty`/`routine`） | A1 的唯一载体；也是面板/日志里"他为什么现在去吃饭"的那一栏 | 能不加，但"动机归因不再全是 ok"就无从谈起 | **加**，且**只进内存计数 + 既有 `trigger.text`**，不落档、不加字段 |
| 2 | `Emotion`（3 标签 + `about`/`with`/`intensity`） | 情绪进对话的唯一事实来源；也是 M4 的依据 | 能不加（现有 1 维 mood），但对话里永远没有"他此刻什么情绪" | **加**，**纯派生**；标签**只做 3 个**（不做 relieved：我们没有"预期"概念，做它就要新增 expectation 状态） |
| 3 | 情绪是否允许改变行为（M4 的开关） | 这是**唯一可见的行为变化**（社交对象偏好、主动短信理由） | 能不加（只做 M1/M2/M3 = 纯归因 + 纯表达） | **请确认**：加，则行为改变需在 golden 里解释；不加，则情绪仍只是"说得出来、做不出来" |

**注意**：`byDriver` 是**新表**而不是改旧表——旧 `byReason` 的语义（能不能自派）被 `test/intent-stats.test.js` 和可能的看板消费，改它会同时破坏测试与展示。

---

## 9. 未验证 / 我标为推测的部分

1. **【推测】`EMOTION_WINDOW = 240` 是否合适**。取值依据只有"日小结 1440 太长、一个长活动 90 tick 太短"，没有实测的行为效果。建议落地后按"同一 tick 里情绪命中率"（`emotionOf ≠ null` 的采样比例）回调：预期 20–40%，若 >70% 说明窗口太长（等于常驻情绪），若 <5% 说明世界太安静（情绪机制在默认内容里不会触发——这正是 §1.4 的现状）。
2. **【未验证】`intensity` 的衰减曲线要不要与 `scoreEpisode` 完全一致**。一致的好处是"只有一套近因口径"，坏处是 `episode.salience`（0.2–0.9）会直接把上限定死，情绪很难"很强"。需要一次人工采样确认"看起来像不像"。
3. **【推测】A2 的 `work→social` 能否真的出现**。当前常数下 0 次，是因为 social ×(1.1−0.2·diligence) ≤ 1.1 且基础分 0.7 < work 的 0.65×1.2=0.78。要让反方向出现，必须调 `social` 的基础分或 `traits` 区间——**这是数值决策，不是结构决策**，需要用户确认"社交被抬起来"是不是想要的效果。
4. **【未验证】情绪进 prompt 会不会让角色"过度谈心情"**。facts 段只给事实，但模型可能自己往情绪上靠。建议 M3 落地后抽 20 条对话人工看是否"每句都在说自己心情"——若发生，正确的减法是把情绪行**只在 `intensity ≥ 0.5` 时注入**（默认沉默）。
5. **【信息缺口】ALMA 全文未取到**（ACM 与 ResearchGate 均被 Cloudflare 拦），只读到摘要级结论"整合 emotions / moods / personality 三层"。本文因此**没有**引用它的 OCEAN→PAD 数值映射与衰减公式；若将来要做 PAD，必须先把全文拿到。
6. **【信息缺口】IAUS 的原始论文/章节（Dave Mark, Game AI Pro 3 ch.13）本轮只验到"考虑项=输入→归一化→响应曲线"这一层**（来自其官方文档站），没有读原文的补偿方法论证；本文结论（"我们不缺框架，缺分数可读性"）不依赖那些细节。

---

## 附录 · 外链清单（按引用顺序）

- Infinite Axis Utility System · Considerations（输入→归一化→响应曲线；补偿方法）— <https://uintel-go.utilityworlds.com/Documentation/UtilityIntelligence/Considerations/>
- GOAP 参考实现 ReGoap（fact/action/goal、A*、`ReGoapPlannerSettings`、`ReGoapCondition`）— <https://github.com/luxkun/ReGoap>
- F.E.A.R. 与 GOAP 的由来 — <https://www.gamedeveloper.com/design/building-the-ai-of-f-e-a-r-with-goal-oriented-action-planning>
- BehaviorTree.CPP（XML DSL、`registerNodeType`、`createTreeFromFile`、Groot2）— <https://github.com/BehaviorTree/BehaviorTree.CPP>
- OCC 模型（22 类；事件/动作/对象三域对应 desirability/praiseworthiness/appealing）— <https://pmc.ncbi.nlm.nih.gov/articles/PMC4243519/>
- PAD 情绪状态模型（Pleasure/Arousal/Dominance）— <https://en.wikipedia.org/wiki/PAD_emotional_state_model>
- ALMA（emotions / moods / personality 三层；仅摘要可证）— <https://dl.acm.org/doi/10.1145/1082473.1082478>、<https://www.researchgate.net/publication/221455945_ALMA_a_layered_model_of_affect>
- FAtiMA Toolkit（Emotional Appraisal / Emotional Decision Making / Social Importance Dynamics 分层资产）— <https://github.com/GAIPS/FAtiMA-Toolkit>
- Big Five / OCEAN 五维 — <https://en.wikipedia.org/wiki/Big_Five_personality_traits>
