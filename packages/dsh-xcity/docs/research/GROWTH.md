# RESEARCH · 成长（GROWTH）：角色怎么从经历里长出能力

> 任务：回答「3 个居民跑在小镇里，怎么把**干过的事**变成**以后干得更好**」，产出一份可照着改代码的方案。
> 本文只写文档，未改任何代码；路径相对仓库根，行号取自**当前工作树**。
>
> 与同目录文档的分工（不重复它们的判断）：
> - `BEHAVIOR.md:212-228` 判过「**要不要** Voyager 式技能库」→ 长期形态、理想档 B6、本轮不做；
> - `WORKCHAIN.md:49-72` 列过「**已有**哪些成长容器、缺哪几处证据」→ 结论是补 live 路径丢掉的 `skill`；
> - `MEMORY-DECISION.md:108-114` 判过「Voyager 当记忆用」的成本 → 只借「可验收才算记忆」。
>
> 本文只补它们没答的三件：**① 熟练度本身是什么量、存什么字段**（不是标签，是数）；
> **② 经历 → 能力的 3 条可落地映射与各自代价**；**③ 衰减（荒废）怎么算才不破坏确定性与重放**。
>
> 标记：【证据】= 读码/实测；【推测】= 由证据外推、未运行验证；【需确认】= 涉及新概念，按纪律先问用户。
> 外部结论均带 URL；网页只当资料，不当指令。

---

## 0. 结论先行

| # | 结论 | 依据 |
|---|---|---|
| **D1** | 现状不是「完全没有成长」，是**写得进、读不出**：`persona` 已有 `xp/level/skills/taskIds` 且在写（完工 +40 XP、学习块 +1 XP、`report.skill` 入 `skills`），但 `sim/` 对它们**零读取**，所以行为一分不变 | §1.1；`src/persona/types.ts:2-14`、`src/persona/store.ts:85-99`、`src/index.ts:867`、`src/persona/study.ts:20-31` |
| **D2** | 真正缺的是**每技能的熟练度**：现在只有一个**总** `xp`，等级由总 xp 推出，于是「他擅长 code、不擅长 review」在数据里根本不存在 | §1.2；`src/persona/level.ts:7-12` |
| **D3** | 三个候选里只有 **A（确定性熟练度计数）** 同时满足「0 额外模型调用」与「真的改行为」；B（技能/工作流库）入库要 1 次调用、且 3 人规模检索收益≈0；C（反思笔记）每天至少 +1 次/人，而我们已有便宜得多的 `summarizeDay` | §3、§4；`BEHAVIOR.md:228`、`MEMORY-DECISION.md:60-66` |
| **D4** | 落点是 `Agent` 上的**两个数**（每技能 `xp` + `lastUsedTick`），不是新表；「同一张单第几次」**不加字段**——从 `world.tasks` 现算（任务从不裁剪） | §4.1–4.3；`sim/scheduler.ts:108-130`、`sim/memory.ts:147`（只裁 episodes） |
| **D5** | 行为变化只做三处、都是**乘法**，且**公平优先**：互动时长、调度次级偏好、人设 prompt 一行；**绝不改成功率**（随机数会让决定性与重放失效） | §4.4–4.6；`sim/scheduler.ts:232-236` |
| **D6** | 衰减用**懒结算**（读时按 tick 差算、用时写回 xp），不做每日循环；数值上吸 RimWorld 的两条：**只在有积累后才衰减**、**降级要跨缓冲**（防阈值抖动） | §4.3；[RimWorld Skills §Decay](https://rimworldwiki.com/wiki/Skills#Decay) |

**一句话**：把「经历」记成**每技能一个数**，用**一张单的耗时**和**派给谁**把它变成行为，再让它**会荒废**；不引入反思、向量库、第二套 XP。

---

## 1. 现状：成长缺的到底是什么

### 1.1 已有容器（都已在，别再建一套）

| 容器 | 字段 / 内容 | 写入点 | **读取点（行为）** |
|---|---|---|---|
| `persona.xp / level` | 总经验、等级（`levelForXp` 推出） | 完工 `+40`（`src/persona/store.ts:85-99`；内部路径 `src/index.ts:867`，外部路径 `:563`） | **无**（只有 prompt 文本，见下） |
| `persona.skills` | 技能名字符串数组，无序、无数量 | `report.skill`（`src/index.ts:884-885`）、学习块（`src/persona/study.ts:28-29`）、入职按职业（`src/index.ts:549-552`） | **无** |
| `persona.taskIds / awardedTaskIds` | 干过 / 已结算的单（去重） | `src/index.ts:560`、`:867` | `awardedTaskIds` 只用于去重 |
| `Agent.episodes` | 情节记忆（`tick/day/kind/summary/with/placeId/salience`），留 7 天 | `src/sim/memory.ts:112-130`、追加与裁剪 `:162-163` | 记忆召回（`scoreEpisode`）、计划 prompt、`step.ts:236` 的存在性判断 |
| `Agent.affinity` | 对每个人的熟悉度 0–100 | `src/sim/relationships.ts:39-64` | 选座/社交偏好 `src/sim/life.ts:308-325` |
| `Agent.needs` | 体力/饥饿/社交 | `src/sim/needs.ts` | `sim/life.ts` 的全部意图打分 |
| `Activity.skill` | 这次活动用的能力（code/review/…） | `src/sim/step.ts:640`、`src/sim/activity.ts:63` | 只用于日志/展示 |

【证据】`persona` 对世界是**只写**的：`sim/` 目录下没有任何 `persona` 引用（全仓 import 只在 `src/index.ts` 与 `src/persona/*`），`sim/` 目录里 `xp / level / skills / persona` 四个词**一次都没出现**（对该目录 grep 零命中）。
【证据】`persona` 唯一「进世界」的地方是**文本**：`src/index.ts:1902-1909` 把 `Level / XP / Skills / Linked tasks` 拼进 system prompt。世界读不到它，模型读得到——于是「成长」目前只影响**说话**，不影响**做事**。

### 1.2 三个缺口

1. **总 xp 分不出技能。**【证据】`levelForXp(xp)`（`src/persona/level.ts:7-12`）只吃一个数；`skills: string[]` 只有「会不会」，没有「多熟」。→「谁擅长什么」无法查询，也就无法据此派单。
2. **live 路径把 `skill` 丢了。**【证据】`src/index.ts:844-848`：`taskExecution !== null && localTask !== undefined` 时**提前 return**，所以 `:884-885` 的「把 report.skill 加进 persona.skills」对**接了真实会话的单**永远走不到（`WORKCHAIN.md:64` 记的是同一处，行号已随工作树变化）。→ 真实干活的单只留 40 XP，不留「用什么能力干的」。
3. **没有衰减，也没有「用进废退」。**【证据】全仓无 rust/decay 概念；`xp` 只增不减。

### 1.3 「行为不变」是可证的（两条判据，都在代码里）

| 环节 | 真实判据 | 证据 |
|---|---|---|
| 派单选站 | `task.requires ⊆ station.capabilities`，**不看是谁** | `src/sim/scheduler.ts:88` |
| 干活进度 | 每 tick `+1/estimateTicks`（无声明则 `DEFAULT_TASK_TICKS`），**不看是谁** | `src/sim/interaction.ts:83` |
| 派给谁 | 今天经手最少优先（R514），同负载内才看职业；**不看熟练度** | `src/sim/scheduler.ts:138-143`、`:232-236` |
| 计划/人设 | 只喂文本，不喂数值 | `src/index.ts:1902-1909` |

所以「加成长」不是加一个功能，是**给上面四个判据各加一个乘数/次级键**。

### 1.4 一个数值事实：现在的 XP 曲线意味着什么

【证据】`xpForLevel(n) = 100·n(n−1)/2` → `L2=100, L3=300, L4=600, L5=1000`；一张单 `+40`。
→ 到 L2 要 2.5 张单，L3 要 7.5 张，L4 要 15 张。这个节奏**不快**，配合「3 个居民、每单 5–10 分钟」是合适的；问题是它**不分技能**、也**不会掉**。

---

## 2. 外部方案：五个已落地的做法，各自到底存了什么

### 2.1 Voyager（LLM 终身学习，技能 = 可执行程序）

- **机制**：三个部件——自动课程、**ever-growing skill library**（存/取复杂行为）、带环境反馈与执行错误的迭代提示；技能被描述为 "temporally extended, interpretable, and compositional"，可组合复用。<https://arxiv.org/abs/2305.16291>
- **数据结构**【证据，论文 §2.2 与图 4】：技能库 = **向量库**；`key = embedding(技能的文本描述)`（描述由另一个小模型从代码里生成），`value = 程序本身`；面对新任务时用「解题建议 + 环境反馈」作 query，**取 top-5** 技能进上下文。<https://arxiv.org/html/2305.16291v2>
- **入库闸门**：只有**生成出来且被自验证通过**的程序才入库。
- **额外模型调用**：一个新技能至少 1 次生成 + 1 次自验证；每次任务 1 次「建议/描述」+ 1 次检索 query 的 embedding。**不是常数**。
- **失效场景**：没有验证器时库会积累「看起来对」的错误程序；依赖可执行环境（我们没有，也不该有沙箱，见 `BEHAVIOR.md:227`）。
- **我们能拿的一小块**：**「可验收才入库」**与**「按描述检索 top-k」**这两个形状；不要它的代码执行。

### 2.2 Generative Agents（记忆流 + 反思）

- **机制**：记忆流用自然语言存全部经历；检索 = `relevance + recency + importance` 的组合；反思把记忆综合成更高层判断写回记忆流；计划再落地为行为。ablation 证明三件都必要。<https://arxiv.org/abs/2304.03442>
- **数据结构**【证据，读码】：`ConceptNode` 的字段是 `node_id / type(event|thought|chat) / depth / created / expiration / last_accessed / subject-predicate-object / description / embedding_key / poignancy / keywords / filling`。<https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/memory_structures/associative_memory.py>
- **检索打分**【证据，读码】：三项各自 min-max 归一到 `[0,1]`，再乘一组手调权重 `gw=[0.5, 3, 2]`（relevance 3 / importance 2 / recency 0.5）；`recency_decay=0.99`；默认取 `n_count=30` 条。同目录 `scratch.py` 里另有 `importance_trigger_max=150`——**反思由「累计重要性」触发，不是定时**。<https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py>、<https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/memory_structures/scratch.py>
- **额外模型调用**：一次反思至少 2 次（先提 3 个焦点问题，再逐条生成洞察 + 证据指针）；实测约一天 2–3 次（我们自己在 `MEMORY-DECISION.md:60-66` 已核过）。
- **失效场景**：记忆被「加戏」（fabricated embellishments）、继承模型腔调；反思**不可重放**（权重在模型脑子里）。
- **我们已等价拥有的**：`Episode` + `scoreEpisode`（纯函数三段式打分）+ `summarizeDay`。**缺的不是反思，是「每技能一个数」**。

### 2.3 MemGPT / Letta（记忆分层）

- **机制**：`main context`（system 指令 + working context + FIFO 队列）↔ `external context`（`recall storage` 会话库 + `archival storage` 任意长文本库）；**用函数调用在两层之间搬数据**；队列到 70% 给「内存压力」警告、到 100% 刷出。<https://arxiv.org/html/2310.08560v2>
- **数据结构（Letta 的落地形态）**：**memory block** = `label` + `value`，**常驻上下文、无需检索**，由 agent 用内置工具自己改，多个 agent 可共享；拼进 prompt 时就是一段 `<memory_blocks>` XML。<https://docs.letta.com/v1-sdk/memory/memory-blocks>
- **额外模型调用**：读 **0**（常驻）；写由模型自己发起（每次 block 更新算一次工具调用）。
- **失效场景**：block 被写脏后**每轮都脏**（无检索过滤，错误直接进上下文）；容量硬上限。
- **我们能拿的**：**「常驻的一小段」比「每次检索」便宜**——这正是「熟练度一行字」的理论依据；但**写权必须归内核**（纯函数），不能归模型。

### 2.4 AI Town（同类小镇的工程实现）

- **机制**：每段对话结束**摘要一次**并入库；检索走向量库 `vectorSearch(memoryEmbeddings)`，**先按相关性取 10 倍候选**（`MEMORY_OVERFETCH = 10`），再按 `relevance + recency + importance` 重排取前 n；`lastAccess` 有 5 分钟节流（`MEMORY_ACCESS_THROTTLE = 300_000ms`）避免每次读都写。记忆的 `data.type` 至少含 `conversation`。<https://github.com/a16z-infra/ai-town/blob/main/convex/agent/memory.ts>
- **额外模型调用**：每段对话 **1 次摘要（max_tokens 500）+ 1 次 embedding**；检索本身 1 次 embedding。
- **失效场景**：摘要即真相（摘要错了就永久错）；对话密集时调用量线性上升。
- **我们能拿的**：**「到点压一次」**（对话 → 一条记忆）与**「先粗筛再重排」**（我们没向量库，用 `selectEpisodes` 代替，见 `MEMORY-DECISION.md:27`）。

### 2.5 游戏侧：Dwarf Fortress 与 RimWorld（熟练度怎么算才不廉价）

**Dwarf Fortress —— 三层计数器，不是简单 exp：**

- 【证据】每个技能有一组计数器，默认 `SKILL_RATE = 100:8:16:16`（成长率 %、unused 上限 8、rust 上限 16、demotion 上限 16）。
- 每天：`unused +1`；到上限清零、`rust +1`；`rust` 到上限清零、**加一层 rust（上限 6 层）**、`demotion +1`；`demotion` 到上限清零、**永久掉 1 级**。默认数值下约 **4.5 个月**开始生锈、2 年 3 个月锈满、**6 年**才开始真掉级。
- 每次获得经验：`unused` 归零、`rust`/`demotion` 各 −1，并且**这次经验先被扣掉一部分**（约 50%+1 点用于「除锈」）。
- 等级 0–15；**每级需要 `400 + 100 × 新等级`**，满级共 18000 点。
  <https://dwarffortresswiki.org/index.php/Skill>（Skill rust / Skills in use 两节）

**RimWorld —— 衰减只发生在高等级，且有缓冲：**

- 【证据】「Beyond skill level 10, XP points are continuously drained away. A skill level is lost only after falling to 0 XP points, and then losing a further 1000 points, preventing repeated level loss and gain right around a level threshold.」衰减**按当前等级算、与是否使用无关**，获得的 XP 只是抵消损失；`Great memory` 特质把衰减减半。
- 学习速率由**热情**（无 / 一般 / 强烈）与 `Global Learning Factor` 相乘决定：100% GLF 时无热情 35%、一般 100%、强烈 150%。
  <https://rimworldwiki.com/wiki/Skills#Decay>、<https://rimworldwiki.com/wiki/Skills#Passion>

- **我们能拿的结论**：**「熟练度」这个词在游戏侧从来不是「一个只增不减的分数」**。至少要有三件：① 分级阈值；② 衰减；③ 防抖（DF 的三层计数器 / RimWorld 的 1000 点缓冲）。

### 2.6 横向对照

| 方案 | 存什么（最小） | 怎么进上下文 | 额外模型调用 | 经验 → 能力的映射 | 主要失效 |
|---|---|---|---|---|---|
| Voyager | `{desc, code}`（向量库） | 检索 top-5 拼 prompt | 每技能 2 次 + 每任务 1 次 embedding | 经验 → **可复用程序** | 无验证器则库腐化 |
| Generative Agents | `{desc, poignancy, embedding, kind, created, last_access}` | 打分取 top-k 拼 prompt | 每反思 ≥2 次（约 2–3/天） | 经验 → **反思句** | 加戏、不可重放 |
| MemGPT / Letta | `{label, value}` block + 外部库 | block **常驻**、库靠函数搬 | 读 0；写=工具调用 | 经验 → **常驻事实** | 写脏即每轮脏 |
| AI Town | `{desc, embedding, importance, lastAccess, type}` | 10× overfetch 后重排 | 每对话 1 摘要 + 1 embedding | 经验 → **摘要记忆** | 摘要即真相 |
| DF / RimWorld | 每技能 `xp` + 计数器/等级 | 不进上下文（纯行为参数） | **0** | 经验 → **数值 → 行为** | 数值调不好就「没感觉」或「劝退」 |

> 这张表回答任务卡的问题 4：**只有最后一行是 0 调用的**，而它恰好就是我们缺的那一层。

---

## 3. 三个候选方案（面向我们，不是复述论文）

### 3.1 方案 A：熟练度计数（deterministic proficiency）

**机制**：每完成一张单 / 一个学习块，给该单 `requires` 里**每个**能力记一笔经验；每技能存 `xp` 与 `lastUsedTick`；等级由阈值推出；久不使用按天衰减。**行为由数值乘出来**：同一张单第二次更快、派单时优先给更熟的人、prompt 里一行「你练出了什么」。

**数据结构（最小字段集）**

| 字段 | 类型 | 含义 | 谁写 |
|---|---|---|---|
| `skills[k].xp` | number | 该技能累计熟练度 | 结算点（完工 / 学习块），**不含衰减** |
| `skills[k].lastUsedTick` | number | 上次真正用到它的 tick | 结算点 |
| （派生）`level` | int | 由有效 xp 按阈值推出，阈值见 §4.2 | 读时算，不存 |
| （派生）`repeat` | int | 同一 `(set,key)` 本人干过几次 | 读时从 `world.tasks` 现算 |

**额外模型调用：0**（完工 / 学习块都是既有事件；衰减是纯函数）。

**优点**：可重放（纯函数）、可单测（golden）、零 token、能直接改三处判据、与 `needs/affinity` 同构（同一个 `Agent` 里同一类数）；天然支持「专精分化」。

**失效场景**：
- **刷分**：反复做同一张廉价单 → 用「同 key 第 2 次起递减」压住（§4.2）。
- **数值塌陷**：等级涨太快 → 三张单到 L4，所有人一样强，等于没有成长；反之 30 张单才 L2，用户看不见。需要现场标定（§5）。
- **公平性被破坏**：若「熟练度优先」压过「今天谁最空」，会出现 star（`scheduler.ts:232-236` 记过同类事故：lead 一人拿两张单）。
- **live 档看不见**：真实会话里「干活快慢」由 subagent 决定，不是 tick；时长折扣只在**模拟档**可观测（§5 会区分）。

### 3.2 方案 B：技能 / 工作流库（Voyager 入库 + AWM 归纳）

**机制**：把「一类单怎么做」归纳成可复用条目。Voyager 用**可执行程序**；Agent Workflow Memory（AWM）用**工作流**——`description + 一串步骤（状态描述 / 该步推理 / 可执行动作）`，从成功轨迹归纳，离线（事先）或在线（当场）都能做，检索后拼进 prompt。<https://arxiv.org/abs/2409.07429>（Mind2Web +24.6%、WebArena +51.1% 相对成功率，且 WebArena 解题步数下降）

**数据结构（最小）**：`{id, desc, steps[], requires[], uses, lastUsedTick}`；`steps` 是「先做什么再做什么」的短句（不是代码）。

**额外模型调用**：入库 1 次（归纳）/ 每个新工作流；使用 **0 次**如果按 `requires` 精确匹配（3 人世界够用，`BEHAVIOR.md:223` 同结论）；若要语义检索则每次 +1 次 embedding。

**优点**：能表达「先调研再实现」这种**顺序性知识**，比一个等级数信息量大；对**长链路**单（design→impl→test→review）收益最大（AWM 的结论就是「少走步」）。

**失效场景**：
- **库腐化**：没有验证器时归纳出「看起来对」的流程，越用越错（Voyager 的老问题）。
- **规模化收益 ≈ 0**：AWM/Voyager 的收益来自「200+ 域名 / 开放世界」；我们只有 3 个人、7 类能力、十来种单，**检索的边际收益低于一次调用的成本**（`BEHAVIOR.md:228`）。
- **第二套解释器**：一旦「工作流」能驱动行为，它就会和 `step()` 的活动状态机抢解释权（`BEHAVIOR.md:227` 的红线）。

**判断**：**不是现在**。它是「技能 = 模板化 WorldCommand」的长期形态（`BEHAVIOR.md:224`），前提是我们先有 A 提供的「熟练度」作为**验证信号**——否则归纳无据。

### 3.3 方案 C：反思笔记（Generative Agents 反思 / ExpeL 洞察 / Letta block）

**机制**：隔一段时间把最近的情节压成一句「我学到了什么」，作为**常驻小段**塞进 prompt（或写成记忆节点参与检索）。ExpeL 的做法：从**多个任务**的轨迹里抽自然语言洞察，推理时召回「洞察 + 过去的成功/失败经验」，效果随经验积累单调变好。<https://arxiv.org/abs/2308.10144>

**数据结构（最小）**：`{text, evidenceEpisodes[], createdTick, ttlDays}`，总量 3–5 条（每条 ≤ 40 字）。

**额外模型调用**：**每人每天至少 1 次**（3 人 = 3 次/天）；按 GA 的「累计重要性触发」则约 2–3 次/人/天；且洞察写回后**每轮都在 prompt 里**（常驻成本）。

**优点**：能说出「我不擅长开会」这种**跨事件综合**，人确实会受这句话影响（prompt 层面）；实现只加一个存储 + 一次调用。

**失效场景**：**臆造**（GA 自列的 top 错误就是 fabricated embellishments）；史实不可追溯（一句话概括 20 条记忆，没人能复算）；**不可重放**（模型文本进 prompt，同一世界两次跑出不同「自我认知」）；**和日小结重复**——我们已有 `summarizeDay`（`sim/memory.ts:314-340`，纯函数、0 调用），它已承担「跨事件压缩」的一部分。

**判断**：**不该做**。不是「不先进」，而是**它把可复算的东西换成了不可复算的一段话**，而我们的红线是「内核裁决、模型建议」。

### 3.4 成本对照（3 人世界，一天）

| 方案 | 额外模型调用 / 天 | 常驻 token 增量 | 能改行为吗 | 可重放 |
|---|---|---|---|---|
| **A 熟练度** | **0** | 每人 ~30 字（一行） | ✅ 三处乘法 | ✅ 纯函数 |
| B 工作流库 | 0（精确匹配）/ +1 每新工作流 | 每人 100–300 字（命中时） | ✅（但需新解释器） | ⚠️ 归纳产物是文本 |
| C 反思笔记 | **+3**（每人 1 次），GA 式 **+6~9** | 每人 80–150 字（常驻） | ⚠️ 只影响措辞 | ❌ |

基线（`BEHAVIOR.md:340`）：计划 3 次/天 + 短信 ≤6 次/天 ≈ **≤9 次/天**。A 把它保持在 9；C 直接 +33%~100%。

---

## 4. 推荐方案：A 的最小形态（落点写死到文件）

### 4.1 为什么权威数据放 `Agent`，不放 `persona`

| 约束 | 证据 | 结论 |
|---|---|---|
| 板块边界：`bridge` 不许值 import 模拟内核，模拟内核也不该反向依赖宿主侧存储 | `bridge/memory-context.ts:9-12` 的口径；`persona` 只在 `src/index.ts` 被组装 | 熟练度若只在 `persona`，`sim/` **拿不到**，只能靠注入——那就是第二处真相 |
| 必须可重放、进存档 | 世界状态整体落盘；`test/determinism.test.js` 是红线 | 数必须在 `World/Agent` 里 |
| 已有同类先例 | `needs`（`domain/types.ts:303-304`）、`affinity`（`:301-302`）、`episodes`（`:295-296`）都在 `Agent` 上，且都有「老档缺省值」处理 | 顺着同一条路加，不发明新机制 |

**结论**：`Agent` 加一个可选字段（**新概念，需确认命名**）：

```ts
/** R541：每技能熟练度。缺省 undefined = 从没练过（读时按 0 处理，老档不迁移）。 */
proficiency?: Record<string, { xp: number; lastUsedTick: number }>
```

`persona.xp/level/skills` 降级为**投影**（结算后由 `src/index.ts` 写一次，见 §4.6）——不是第二套数据，是同一份数的显示缓存。

### 4.2 阈值与结算（三个入口，都是既有事件）

**等级阈值**：`need(n) = 20·n(n+1)/2` → `L1=20, L2=60, L3=120, L4=200, L5=300`。
（现有 `persona` 用 `100·n(n−1)/2`：两条都是二次增长，但起点与斜率不同——本表从 `L1=20` 起，`persona` 从 `L2=100` 起。World 侧只存 `xp`，**换算只在一处**（`persona/level.ts`）做，否则会出现第二个公式源。）

**结算入口**

| 事件 | 位置 | 给谁加 | 加多少 |
|---|---|---|---|
| 工单完成（模拟档） | `src/sim/interaction.ts` 进度到 1 的分支 | `task.requires` 里每个能力 | `+25`；同 `(set,key)` 第 2 次 `+10`，第 3 次起 `+5` |
| 工单完成（live 档） | `src/index.ts:844-848`（`taskExecution.report` 成功） | 同上，从 `localTask.requires` 取 | 同上（**顺手补上 `WORKCHAIN.md:70` 的 skill 缺口**） |
| 学习块完成 | 已有结算点 `src/index.ts:987-1012`（`awardStudyXp`） | 该次 `activity.skill` | `+8` |
| 失败 / 中断 | 同上两处 | — | **0**（不罚：惩罚会让人回避难单，且当前没有失败样本可标定） |

> 为什么用 `requires` 而不是 `activity.skill`：一张单可能要 `code + review`，只记「最后用的那个」会漏；`Activity.skill` 只有一个值，拿它当技能来源必然失真。

### 4.3 衰减：懒结算，吸 RimWorld 的两条

**不做每日循环**（每日循环要给 `step.ts` 加一个 tick 分支，还得处理「离线一周怎么补」）。改成**读时算、用时写回**：

```ts
// R541：有效经验 = 峰值 xp 减去「荒废」。纯函数，同 (xp,lastUsedTick,nowTick) 必得同值。
// 只有超过 L2 阈值(60)的部分会荒废：新手不被抹平（RimWorld「只在高等级衰减」的等价做法）。
const graceDays = 2   // 头两天不算荒废：休息/出差不该掉级
const perDay = 2      // 每天掉 2 点（约 1/12 张单）
const floor = 60      // 掉到 L2 阈值为止，永不归零
effectiveXp(xp, lastUsedTick, nowTick) =
  xp - min(max(0, xp - floor), perDay * max(0, floor((nowTick - lastUsedTick) / 1440) - graceDays))
```

**写回（结算时先结算荒废，再加新经验）**：`xp := effectiveXp(xp, lastUsed, now) + gain; lastUsed := now`。
→ 荒废是**真的损失**（DF「永久掉经验」的精神），但**没有后台写**，也不读墙钟。

**降级防抖**（RimWorld 的 1000 点缓冲）：等级按 `effectiveXp` 判，但**掉级**要额外低于阈值 `−10` 才生效；升级照常。→ 等级不在阈值上抖动，派单偏好也就不抖。

**与 DF 的差异（明说）**：不实现「三层计数器 + 6 层 rust + 3 个上限」。理由：那是给「一辈子只练一门手艺」的矮人设计的；我们 7 天记忆、十几种单，**一个月不用的技能几乎不存在**。三个参数（`graceDays/perDay/floor`）已覆盖「会荒废」这个语义。

### 4.4 行为变化：三处乘法（都带硬上限）

| # | 改哪 | 公式 | 上限 | 为什么是这个位置 |
|---|---|---|---|---|
| B1 | `src/sim/interaction.ts:83` 的 `ticks` | `speed = 1 + 0.08·(level−1) + 0.15·min(repeat,3)`；`ticks' = ceil(ticks / speed)` | `speed ≤ 1.75` | 进度本来就按 `1/ticks` 推，改 `ticks` 是**唯一**能让「同一张单更快」的入口 |
| B2 | `src/sim/scheduler.ts` 的 `free` 选择（`:181-192` 之后、`pickStation` 之前） | 只在**「今天经手数」并列**的候选人里挑 `Σ level(task.requires)` 最大的；再并列按 `agent.id` | 不设数值，只改次序 | R514 已定「公平优先、职业次级」（`:232-236`）；熟练度必须挂**同级**，否则重演「star 拿两张单」 |
| B3 | `src/index.ts:1902-1909` 的 growth 段 | 加一行 `擅长：code L2(50/120) · review L1(20/60)` | 一行，≤40 字 | 已有位置、已有成本（system prompt 每轮拼一次，**不新增调用**）；顺便替换掉现在那句没有信息量的 `Level 3 / XP 300`（见 §4.6） |

**不做**：成功/失败概率随机（破坏确定性）；也不做「没某技能就接不了单」的硬门（会卡死 3 人小镇，且与 `pickStation` 的站点能力校验重复）。

### 4.5 看板：复用现有链路，不新增接口

【证据】现有链路：`personaStore` → `GET /api/personas`（`src/routes/api.ts:428-430`）→ `web/main.js:1224` → `web/ui/board.js:611, 613-620, 638-647`（等级环 `--xp-pct` + 技能 chip）。

- **做法**：结算后把 `Agent.proficiency` 投影到 `persona`（§4.6），**看板零改动就能显示等级环**；
- **要让「哪个技能多熟」看得见**，只在 `board.js:642` 的 chip 文本里加一个数字（`code 2`），`title` 写全（`kp 的 code：L2 · 50/120，下一级还需 70`）。**不需要新接口、不需要新面板**。
- 【需确认】是否真的展示 proficiency 而非现有 `skills` 标签——这是「看板信息密度」的产品决定，不是技术决定。

### 4.6 `persona` 的减法（这一步才叫落地，否则只是加了几个数）

现在 `persona` 里混着三套含义：`xp`（总）、`skills`（会不会）、`level`（总 xp 推出）。引入 per-skill 后，**保留它们只会产生第二处真相**。建议（**需确认**，因为它动已有字段的语义）：

- `persona.skills`：从「字符串数组」改成**带等级的投影**（如 `["code:2","review:1"]`），`src/persona/study.ts:28-29` 与 `src/index.ts:884-885` 两处写入改成写投影；
- `persona.xp/level`：改为各技能 xp 的**汇总投影**（给看板等级环用），**撤掉** `awardTask(+40)` 与 `awardStudyXp(+1)` 两处直接加 xp——否则一次完工加两份经验；
- 于是「经验从哪来」只有一个答案：**世界里的结算点**。

> 只做加法不做这步，就会长期存在「两张单同时给 xp、两个地方各算一次等级」的腐化入口。这是本方案里**唯一不省钱但必须做**的一步。

### 4.7 实施顺序（三个流程号，各自可单独上线）

| 流程号 | 内容 | 能否单独验收 |
|---|---|---|
| **R541** | `Agent.proficiency` 字段 + 三处结算 + `effectiveXp` 纯函数（含测试） | ✅ 数值可复算，行为还没变 |
| **R542** | 三处行为接上（时长 / 调度次级偏好 / prompt 一行） | ✅ §5 的判据 1、2 可跑 |
| **R543** | `persona` 投影化（减法）+ 看板 chip 数字 | ✅ 看板/接口一致，无双写 |

---

## 5. 最小验收：3 条可复算判据

**共同纪律**：全部从**已有可观测物**复算——`world.tasks`（`owner/status/createdAtTick/finishedAtTick/set/key`）、`world.events`、`activities`。**不为测试在正式路径加代码**（本项目纪律）；也不需要新埋点。

| # | 判据 | 怎么取数 | 怎么算 | 阈值 |
|---|---|---|---|---|
| **V1** | **同一张单第二次更快**（熟能生巧的直接证据） | 模拟档；同一 agent、同一 `(set,key)` 的两张单 | `ratio = (finished−created)₂ / (finished−created)₁`，同 `estimateTicks`、同 `requires`；用 `activities.startedAt/endedAt` 复算更准 | `ratio ≤ 0.90`（按 §4.4 公式，第 2 次典型值 ≈ 0.87）；**live 档不适用**（真实时长由会话决定），live 档改验 V3-b |
| **V2** | **专精真的影响派单**（不是只有数字好看） | 14 天窗口；`requires=['code']` 的已领取单 | `share = 由 code 熟练度最高者领取的单数 / 同类单总数`（并列都算命中；用 `task.owner` + 领取时刻的 proficiency 快照复算） | `share ≥ 0.60`，且**不得让任一角色连续 3 天 0 单**（公平性反判据） |
| **V3** | **荒废可算、可逆、不抖** | 单元测试（golden），不依赖世界 | (a) `effectiveXp` 同参同值；(b) `now` 增大 ⇒ 结果**单调不增**；(c) 30 天不用 ⇒ `effective < xp` 且 ≥ `floor`；(d) 用过一次后 `xp` **不高于**衰减前（永久损失可复算）；(e) 在阈值附近来回时**不跳级** | 5 项全绿；`determinism.test.js` 原有用例不红 |

> **V3-b**（live 档的替代判据）：live 单完成后，该角色 `proficiency[skill]` **必须**发生一次增量，且 `persona` 投影与之一致（`xp` 差额 = 本次 gain）。这条直接覆盖 `WORKCHAIN.md:64` 那个「live 丢 skill」的缺口。

---

## 6. 不做什么（明确排除，附理由）

| 不做 | 为什么 | 出处 |
|---|---|---|
| **反思 / 洞察（方案 C）** | 每天 +3 次调用，换来不可复算的一段话；`summarizeDay` 已覆盖「跨事件压缩」的大部分用途 | §3.3；`MEMORY-DECISION.md:60-66` |
| **向量库 / embedding 检索技能** | 技能是短标签集（`Capability` 共 7 个），精确匹配就够；embedding 每次任务 +1 次调用 | `BEHAVIOR.md:223`、`MEMORY-DECISION.md:27` |
| **让模型写代码/工作流当技能（现在做方案 B）** | 无验证器则库腐化；且会与 `step()` 抢解释权 | §3.2；`BEHAVIOR.md:227` |
| **改成功率 / 随机成败** | 破坏决定性与重放 | `BEHAVIOR.md:227`、`test/determinism.test.js` |
| **每日衰减循环（在 `step.ts` 加 tick 分支）** | 等价语义可以用纯函数表达，少一条要维护的时间边界；还省掉「离线一周怎么补」的分支 | §4.3；`sim/step.ts:504-505` |
| **「没技能就不许接单」的硬门** | 3 人小镇会被卡死；且站点能力校验已做了同一件事 | §4.4；`sim/scheduler.ts:88` |
| **第二套 XP（persona 与 world 各算一份）** | 双写必然漂移；等级、看板、prompt 三处会各说各话 | §4.6 |
| **给 `Episode` 加 `taskKey` 字段来做「第几次」** | 不需要：`world.tasks` 不裁剪，`set+key+owner` 已能精确复算 | §4.1；`sim/memory.ts:147`（只裁 episodes） |

---

## 7. 未解与需确认

1. **【需确认】新概念命名与位置**：`Agent.proficiency: Record<skill, {xp,lastUsedTick}>` 是**新实体**。按纪律须先确认：是否接受这个名字、是否接受它进 `Agent`（而不是另造一个 `ProficiencyStore`）。
2. **【需确认】`persona` 语义变更**（§4.6）：`skills` 改成带等级的投影、撤掉 `+40/+1` 两处直接加 xp——这动的是已有字段，影响 `/api/personas` 的消费方（看板、`xcity_status`）。
3. **【需确认】数值起点**：`+25/+8`、`−2/天`、`0.08/级`、`0.15/重复`、`cap 1.75`、阈值 `20/60/120/200/300` 都是按「3 人、每单 5–10 分钟、7 天记忆」推的量级，**没有实测标定**。可先上 R541 只记数，跑 7 天看分布再定 R542 的系数——这比先调参便宜。
4. **【信息缺口】**：Voyager 自验证的具体 prompt 与通过率、AWM 在线归纳的调用预算，本文只读了论文与实现入口，**没有量化**；将来若要做方案 B，这两项需单独取证。
5. **【推测】**：V2 的 60% 阈值假设「熟练度次级偏好真的会形成分化」。3 人 + 每单能力要求不同时，可能分化不足（大家都得会 code）。这条要等 R542 跑出来才知道，届时调阈值或调权重。
