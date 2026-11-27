# RESEARCH · 记忆如何驱动行为（MEMORY-DECISION）

> 任务：搞清楚"记得的事"怎样变成"今天的行为"，而不是只变成"聊天时说得出"。只写文档，不改代码。
> 与本目录其它文档的分工：`MEMORY.md` 讲**存储/检索系统要不要引入**，`BEHAVIOR.md` 讲**决策架构**；
> 本文只讲两者之间的那一段：**记忆的哪一部分、以什么粒度、进入决策的哪一步**。

---

## 0. 结论先行

| # | 结论 | 依据 |
|---|---|---|
| **D1** | 记忆影响行为只有三条通路，成本差三个数量级：**①检索进 prompt**（按轮花钱）、**②打分改行为**（每个 tick 都能用，0 模型调用）、**③状态化约束**（到期裁决，0 调用）。Generative Agents 走的是 ①，所以贵；我们的最小增量应该走 ②③ | §1、§2.4 |
| **D2** | Generative Agents 里"记忆影响当天计划"的真实机制是：**一天一次**，把最近记忆检索出来、压成**身份/近况**（learned traits、currently），再让所有 prompt 都读这份压缩结果。**不是**每个决策都去检索原始记忆 | §2.4；[plan.py 的 revise_identity](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/plan.py) |
| **D3** | 抄 GA 时有两个具体教训：**(a)** 它的逐小时排程 prompt 里**没有**检索结果，只有身份+daily_req+上一版排程；**(b)** 参考实现的 recency 用"节点序号"而非真实时长算，且按升序取幂，方向与论文相反——这段不能照抄 | §2.4、§2.2；[run_gpt_prompt.py](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/prompt_template/run_gpt_prompt.py)、[retrieve.py](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py) |
| **D4** | 我们的计划入口是**结构性空着的**：06:30 生成计划时，"今天发生了什么"取的是**当天 00:00 起**的活动（典型作息下刚睡醒，通常为空），`persona` 传的是空串——所以"昨天的记忆"和"我是谁"都没进计划 | §5.1；`src/index.ts:437-443`、`src/sim/day-summary.ts:63-66` |
| **D5** | 最小增量就三件：**memoryMood 打分（±10%，只调社交/工作）** + **日小结进计划 prompt** + **守住已有的承诺赴约**。反思树、向量库、给 Episode 加字段、多维情绪，都该拒绝 | §5.2–§5.5 |

---

## 1. 口径：什么叫"记忆参与决策"

把"记忆→行为"拆成三条互不替代的通路，成本与可验证性完全不同：

| 通路 | 机制 | 触发粒度 | 每 tick 模型调用 | 我们现在的落点 |
|---|---|---|---|---|
| **① 检索进 prompt** | 挑几条记忆拼进提示词，让模型自己权衡 | 每次调用（对话/短信/计划） | 0（但每次调用都变贵） | `bridge/memory-context.ts:125` 渲染 400 字；只接到短信（`src/index.ts:1367`）；计划 prompt 只接当天摘要（`src/index.ts:440`） |
| **② 打分改行为** | 记忆压成一个数值，进本地打分函数 | 每个 tick | **0** | **缺**：`sim/life.ts:211 intentOptions` 只看 needs 与 traits（`weightedScore` 在 `:302`），episodes 对决策零影响 |
| **③ 状态化约束** | 记忆变成带到期时间的约束，内核裁决 | 到期/临近 | **0** | **已有**：`Commitment` + `dueAppointmentOf`（`sim/life.ts:100`）+ 赴约候选（`:248`） |

三条通路的差别不是风格，是**是否可重放**：②③ 是纯函数，能进 golden 测试；① 的权重在模型脑子里，只能靠采样评估。
这也是为什么"让记忆影响决策"不能只做 ①——只做 ① 就会出现"聊天时会引用昨天，行动上照旧"（我们自己 H6 的现象：22 条承诺 0 次赴约）。

---

## 2. Generative Agents（Park et al. 2023）逐层拆

论文：[Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442)（UIST '23）。
参考实现：[joonspk-research/generative_agents](https://github.com/joonspk-research/generative_agents)。

### 2.1 memory stream（写入）

- 每条观察以**自然语言**存进 memory stream，附一个 LLM 打的重要性分（poignancy）。反思（reflection）同样作为记忆写回，所以"想法"和"看到的事"在检索时是平权的。
  → [论文 §4.1](https://arxiv.org/pdf/2304.03442)
- **对我们**：我们的 `Episode` 等价物已经有了（类型在 `src/domain/types.ts:218`，写入在 `src/sim/memory.ts:86 episodeOfActivity`），差别是 salience 只用规则算（0.9/0.6/0.3/0.2），没有 LLM 打分。**这不是缺口**，是省钱：3 个居民不需要为每件事付一次评分调用。

### 2.2 retrieval（检索打分）

- 论文口径：`score = α_recency·recency + α_importance·importance + α_relevance·relevance`，三项各自 min-max 归一到 [0,1]，α 全取 1；recency 是指数衰减，衰减因子 0.995（按沙盒小时）；relevance 用 embedding 余弦。
  → [论文 PDF](https://arxiv.org/pdf/2304.03442)
- **参考实现与论文有两处不一致**（读码所得，未跑实验复现）：
  1. `scratch.py` 里 `recency_decay = 0.99`，`recency_w/relevance_w/importance_w` 全 1；但 `retrieve.py` 的 `new_retrieve` 又乘了一组 `gw = [0.5, 3, 2]`（relevance 3、importance 2、recency 0.5），旁边注释写着 `[1,1,1] tends to work decently`。
     → [scratch.py](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/memory_structures/scratch.py)、[retrieve.py](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py)
  2. `extract_recency` 是 `decay ** i`，i 取 1..N，而 `nodes` 按 `last_accessed` **升序**排——于是**越旧的节点 recency 越高**，与论文"越近越高"方向相反。同样在 `retrieve.py`。
  - 结论：**权重别抄博客、别抄代码**（网上流传的 0.5/3/2 就是这段代码，不是论文）；recency 一定要按"距今真实时长"算。
- **对我们**：`sim/memory.ts:212 scoreEpisode` = recency（1/(1+ageDays)）+ salience + relevance，权重 1:1:1，和论文口径一致且是纯函数。**不动**。

### 2.3 reflection（反思）

- 触发条件是**累计重要性阈值**（实现里 150），不是固定时间表；论文说实测"大约一天 2–3 次"。反思先生成 3 个高层问题，再各生成洞察，写回 memory stream。
  → [论文 PDF](https://arxiv.org/pdf/2304.03442)
- 论文 ablation 的价值点：没有反思时，角色被问到"该给朋友送什么"只能承认不知道；有反思记忆时能给出具体建议——即**反思的作用是"跨事件综合"，不是"多记几条"**。
  → [论文 HTML](https://arxiv.org/html/2304.03442)
- **失败模式**：每次反思至少 2 次模型调用；反思是自然语言，会继承模型的腔调与臆测。
  → 论文自述"最常见错误"：检索不到相关记忆、给记忆加戏（fabricated embellishments）、继承过度正式的说话方式：[论文 HTML](https://arxiv.org/html/2304.03442)
- **对我们**：不做。我们的"跨事件综合"已经有更便宜的形式——`summarizeDay` 的日小结（`sim/memory.ts:149`，纯函数、数次数）。它给不出"他喜欢什么"，但那是记忆检索段（memory-context）该回答的问题，不需要每天多烧两次模型。

### 2.4 plan（记忆怎么具体影响当天计划）— 本节是本文重点

代码事实（`plan.py`）：

1. **新的一天**走 `_long_term_planning(persona, "New day")` → `revise_identity(persona)`：用两个 focal point 去检索 —— `"<name>'s plan for <date>."` 与 `"Important recent events for <name>'s life."`（`new_retrieve`，每个 focal point 30 条）。检索结果拼成 statements，分别生成 **plan_note**（"今天该记住什么，尽量具体到时间地点"）和 **thought_note**（"这几天的心情"），再用它们改写 `currently`。
   → [plan.py: revise_identity](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/plan.py)
2. 这些改写后的字段进 `get_str_iss()`（identity stable set）：Name / Age / **Innate traits** / **Learned traits** / **Currently** / Lifestyle / Daily plan requirement / 日期。这份 ISS 是**几乎每个 prompt 的公共前缀**。
   → [scratch.py: get_str_iss](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/memory_structures/scratch.py)
3. **当天日程本身**：`generate_first_daily_plan`（broad strokes 4–6 条）与 `generate_hourly_schedule`（逐小时填）。逐小时那个 prompt 只有 ISS、daily_req、以及"已经排好的上一版 schedule"——**没有检索结果**。
   → [plan.py: generate_hourly_schedule / _long_term_planning](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/plan.py)、[run_gpt_prompt.py: run_gpt_prompt_generate_hourly_schedule](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/prompt_template/run_gpt_prompt.py)
4. **还有个坑**：`"New day"` 分支里 `persona.scratch.daily_req = persona.scratch.daily_req` 原样保留，代码里留着 TODO 注释——意思是"昨天的日计划不会因为今天的记忆/反思而重排"。
   → [plan.py](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/plan.py)
5. 具体动作（`_determine_action`）会把一小时的块**再拆**成更细的动作，每拆一次问一次模型；观察到新事件时也会触发 re-planning。
   → [plan.py: _determine_action](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/plan.py)

**一句话总结**：GA 的记忆→计划是一条 **"一天一次检索 → 压成身份/近况 → 所有 prompt 读压缩结果"** 的路，中间那段（逐小时排程）不再检索。
所以"记忆驱动行为"的关键不是检索得多勤，而是**压缩后的那段东西有没有进入决策的输入端**。我们当前恰好相反：`memory-context` 压得很克制，但它只进了短信，进不了 `intentOptions`，也进不了每日计划。

---

## 3. 其它可参考方案

### 3.1 Letta / MemGPT —— 分层记忆 + 常驻块

- 记忆分三层：**core memory（memory blocks）常驻上下文、无需检索**；**archival memory** 是向量库，只能由 agent 显式 `archival_memory_search` 取回；**conversation history** 满了自动外移。文档明确两件事：archival **不会**因为上下文溢出自动填充；blocks 与 archival **互不连通**（"Common Misconceptions" 一节逐条驳了这三个误解）。
  → [Memory Types in Letta（官方 md 原文）](https://github.com/letta-ai/skills/blob/main/letta/agent-development/references/memory-architecture.md)、[Memory blocks 文档](https://docs.letta.com/v1-sdk/memory/memory-blocks)、[Archival memory 文档](https://docs.letta.com/v1-sdk/memory/archival-memory)
- 记忆怎么进决策：**靠"什么在上下文里"**，加上 agent 用工具（`memory_insert/replace/rethink`）**自己改写**记忆。决策没有独立打分环节。
  → [论文 MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560)
- 成本：每轮都可能是多步 tool-calling；记忆写入质量取决于模型自觉（文档明说 archival 要显式 add）；两套记忆（block/archival）容易各说一套。
- **对我们**：架构思想可借，实现不要。我们已经有一个"常驻块"的等价物——`memory-context.ts:28` 的 400 字硬预算 + 承诺优先。**不要**让角色自己编辑记忆：那会破坏 `determinism.test.js` 的"同输入同输出"。

### 3.2 Reflexion —— 跨"尝试"的反思记忆

- 机制：把**反思文本**存进 episodic memory buffer，用来"induce better decision-making in **subsequent trials**"；论文把自己的 policy 直接参数化为"memory encoding + LLM 参数"。反馈可以是标量、自由文本、外部或自评。
  → [Reflexion 论文](https://arxiv.org/abs/2303.11366)
- **粒度是关键**：它只在**下一次尝试**生效（HumanEval 里是一道题重做），不改变一次尝试内部的动作。我们对应的是"这个工单没做完 → 明天换个做法"，不是"这一 tick 去哪"。
- 成本：每个 trial 一次反思调用；靠明确成败信号（测试通过/失败）。
- 失败模式：反思是**未经验证的自然语言**，错了会一直错；论文没有给记忆的衰减/去重机制（未核实，正文未见）。
- **对我们**：这正是 `memoryMood` 的合法性来源——把"最近几次没做完"压成负分，改变下一次选活/找人的偏好；但我们的信号比它硬：工单完成与否、承诺 kept/missed 都是内核事实。

### 3.3 Voyager —— 技能库（可执行产物当记忆）

- 机制：skill library 是**向量库**，key 是"程序描述的 embedding"，value 是**可执行程序**；面对新任务时，先用模型生成解题建议 + 环境反馈拼成 query，取 **top-5** 技能作为上下文。
  → [Voyager 论文](https://arxiv.org/abs/2305.16291)、[Voyager HTML §2.2 Skill Library](https://arxiv.org/html/2305.16291v2)
- 为什么它敢让记忆自动增长：**每次写入都经过验证**（自动课程 + 代码执行 + self-verification），库里的东西是"能跑过的"。
  → 同上（摘要里三个组件的描述）
- 失败模式：没有验证器时，技能库会积累"看起来对"的错误程序；依赖可执行环境。
- **对我们**：形态上可借（"作品/产物"作为记忆，而不是"日志"），机制不可抄——我们没有代码执行验证器。要抄就抄一句：**只有能被验收的产物才配进长期记忆**（这正是 `promiseBetween`/`settleCommitments` 对承诺做的事）。

### 3.4 ACT-R —— 激活值记忆（"想不起来"是特性）

- 激活公式：`A_i = B_i + SA_i + ε`；`B_i = ln Σ t_k^{-d}`（对每次呈现的时间衰减幂律求和，即**频率 + 近因**）；`SA_i` 是上下文扩散；**低于检索阈值就真的取不出来**，且检索概率/延迟都是激活的函数。
  → [ACT-R 基础激活（Springer 章节 PDF）](https://link.springer.com/content/pdf/10.1007/978-3-030-31846-8_6.pdf)、[ACT-R 近似方法比较（含公式 1）](https://link.springer.com/article/10.1007/s42113-018-0015-3)
- 决策含义：记忆不是"Top-K 一定有货"，而是**"这次想不想得起来"本身参与行为**（想不起来就按习惯/需求走）。
- 失败模式：参数（d、阈值）敏感，需要数据调；公式漂亮但难校准。
- **对我们**：反向教训。我们的 `selectEpisodes` 永远返回 K 条（`sim/memory.ts:229`），没有"想不起来"这个状态，也没有"被用过几次"的强化。这是**刻意简化**（不做 accessCount 字段），可以接受；但别对外把它说成"认知架构"，它只是一个预算内的召回器。

### 3.5 附：AI Town —— "TS 版 GA"的真实成本

- 它是 GA 的 TypeScript 复刻，但栈是 Convex（数据库+向量检索）+ embedding 模型 + LLM；官方定位是"可部署的 starter kit"。
  → [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town)
- 结论：**"TS 能写"不等于"我们能接"**。它需要一整套后端与 embedding 管道；我们的插件是进程内的纯函数世界，接进来就是第二个真相来源。

---

## 4. 对照表

| 方案 | 记忆怎么进决策 | 触发粒度 | 每 tick 模型调用 | 新增依赖 | 主要失败模式 | 我们的取舍 |
|---|---|---|---|---|---|---|
| **Generative Agents** | 检索→prompt；一天一次压成 identity/currently | 每天 1 次检索 + 每动作 1 次拆解 | 高（动作级） | embedding + LLM | 检索不到、给记忆加戏；排程不吃检索 | 借"一天一次压缩"，不借"每步检索" |
| **Letta / MemGPT** | 常驻 core blocks + agent 自调工具改记忆 | 每轮 | 中（tool loop） | 向量库/DB | 忘写、写坏、两套记忆不一致 | 只借"常驻块=预算内固定段" |
| **Reflexion** | 反思文本 → 下一次尝试 | 每个 trial/episode | 低（1 次/回合） | 无 | 反思未被验证、会一直错 | 借"跨次反思"，信号用我们的 kept/missed |
| **Voyager** | 技能库 top-5 进 prompt | 每个新任务 | 中 | 向量库 + 代码执行器 | 无验证器时库会腐化 | 只借"可验收才算记忆" |
| **ACT-R** | 激活值决定能否取出 | 每次检索 | 0 | 无 | 参数敏感、难校准 | 借"频率+近因"直觉，不引入阈值/频率字段 |
| **我们（现状）** | ① 只进短信；②不存在；③承诺赴约 | 每条短信 / 到期 | 0（决策侧） | 无 | **记忆只影响说话，不影响行为** | 补 ②，修 ① 的计划入口 |

---

## 5. 对我们这个插件的取舍建议（最小增量）

### 5.1 现状盘点（全部有行号）

| 能力 | 现状 | 证据 |
|---|---|---|
| 情节记忆 | `Episode{tick,day,kind,summary,with,placeId,salience}`，每人 ≤150 条、保留 7 天 | `src/domain/types.ts:218-228`、`src/sim/memory.ts:14,108` |
| 写入 | 活动完成/中断（≥15 min）各写一条；salience 规则算 | `src/sim/memory.ts:86-105,130-144` |
| 归并 | 换天写一条 `kind='day'` 的日小结（"第N天：干活×3…"） | `src/sim/memory.ts:149-183` |
| 召回 | `scoreEpisode` = 近因+salience+关键词；`selectEpisodes` 取 Top-K | `src/sim/memory.ts:212-237` |
| 召回→对话 | 400 字预算，只接短信回复 | `src/bridge/memory-context.ts:28,125`、`src/index.ts:1367` |
| 召回→计划 | 只喂**当天**活动摘要（`summarizeDay` 从 00:00 起算） | `src/index.ts:437-443`、`src/sim/day-summary.ts:63-66` |
| 计划本身 | 每天 06:30 问一次，产出 ≤2 条结构化承诺 | `src/bridge/daily-plan.ts:11,40-63`、`src/bridge/plan-prompt.ts:67` |
| 记忆→行为 | **零**：`intentOptions` 只看 needs + traits + 赴约 | `src/sim/life.ts:211-288,302-313` |
| 承诺→行为 | 到期前 `APPOINTMENT_WINDOW=180` 内生成赴约候选（score 0.9） | `src/sim/life.ts:92-116,248-263` |

三个可以直接说出口的缺口：

1. **06:30 时"今天"是空的**：`summarizeDay` 的窗口是当天 00:00 起（`day-summary.ts:64-65`），而典型作息 23:00–07:00 在睡（`life.ts:74-77,227-231`）——所以计划 prompt 的"今天已经发生的事"通常是空的，"昨天"从来没进过计划。
2. **`persona` 传的是空串**：`src/index.ts:439`，于是 `buildPlanPrompt` 的"## 你是谁"是空的；计划只能靠"认识谁"来写。
3. **episodes 进不了决策**：`intentOptions` 连 `episodes` 都没 import（`life.ts:13-18`）。

### 5.2 建议一：`memoryMood`（走通路②，0 模型调用）

- 形态：`memoryMood(agent, nowTick): number ∈ [-1,1]`，只看最近 1440 tick；在 `weightedScore`（`life.ts:302`）里作为**乘子**，幅度 ≤ ±10%，只作用 `work/study` 与 `social`，**不碰** `meal/sleep/rest` 三个硬分支（`life.ts:218-240`）。
- 两个必须注意的点（否则这个函数会名不副实）：
  1. **"爽约"其实不在 episodes 里**。承诺的 missed 只存在 `agent.commitments`（`types.ts:205-215`），`memory.ts` 从不把失约写成情节。所以按 task-23 的字面口径（只读 episodes）只能拿到"没做完"，拿不到"爽约"。两条路二选一：**接受这个口径**（那就别在注释/文档里声称 mood 反映"爽约"），或者**同一次改动里顺带读 commitments**（`status==='missed'` 且 `dueTick` 在窗口内；只加读、不加字段，用 `dueTick` 近似时点，类型里没有 settledAt）。我倾向后者。
  2. **别重复计数**：`kind==='day'` 是日小结，不是事件；把它算成一次"完成"会让每天都在涨分。
- 判定口径（写进注释，供 review）：`summary` 以"没做完："开头 = 负（`memory.ts:34` 的中断前缀）；`with` 非空且是社交 = 正；完成工单 = 正；**其余中性**。别用"关键词猜情绪"。
- 为什么幅度是 10% 而不是 30%：`weightedScore` 里 traits 已经把 work 拉成 0.8–1.2（`life.ts:306`），再加一个大权重会让"记忆"盖过"性格"，而 BEHAVIOR.md 的 C2 结论是——**可见差异靠硬规则与承诺，不靠调权重**。

### 5.3 建议二：让"昨天"进每日计划（走通路①的正确位置，0 额外调用）

- 依据：GA 的记忆影响计划是**一天一次、压缩后**（`revise_identity` → learned traits/currently → 所有 prompt）；Reflexion 也证明"反思在下一轮才生效"。我们对应的一次就是 06:30 那次计划。
- 最小改法（本卡只记录，不改代码）：
  1. `plan-prompt.ts` 的 `PlanPromptInput` 增一个可选 `yesterday?: string`（日小结那一行），非空才输出「## 昨天」段，放在「今天已经发生的事」之前；
  2. `index.ts:437-443` 的 `promptFor` 里从 `agent.episodes` 取 `kind==='day' && day===今天-1` 的那条 `summary` 传进去；取不到就不传（不编）；
  3. 顺手把 `persona` 传成内容库里的人设（`src/index.ts:439` 现在是 `''`）——这不是"新概念"，是把已有字段接上。
- 成本：每角色每天多一行 token；模型调用次数**不变**（仍然 1 次/人/天）。
- 验收方式（可复算）：计划 prompt 里出现「昨天：第N天：…」；`planStats` 的 `answered/applied` 不下降；`daily-plan.test.js` 的"不传就不出现"断言锁住兼容。

### 5.4 建议三：守住承诺这条路，不要再扩

- 赴约候选（`life.ts:248-263`，score 0.9）已经是全系统"最硬的记忆改行为"：它压过社交（0.7）、上班（0.65）、学习（0.5）。
- **不要**把承诺也做成 `weightedScore` 的乘子/加项——那会和 0.9 的候选重复计权，还会和"饿/困"的硬分支抢位置。承诺的正确形态是**候选 + 到期裁决**，不是权重。
- `MISS_GRACE_TICKS`（`commitments.ts:35`）与 `BUSY_GRACE_TICKS`（`:25`）已经区分了"没证据"和"人忙着"，保持这个区分，不要合并成一个 grace。

### 5.5 明确「不做」（写下来，避免下一轮被 AI 说服）

- **不做反思树 / 每天多次模型反思**：GA 的反思阈值触发≈2–3 次/天/人，我们是 3 个居民——每天多 6–9 次调用，换来的是"他喜欢什么"这类只在对话里有用的信息，而这条已经由 `memory-context` 的检索回答。
- **不建向量库 / 不装 embedding**：与 `MEMORY.md` M4.5 的判定一致；触发条件（单角色 episodes>2000 或检索延迟>50ms）未到。
- **不给 Episode 加字段**（accessCount / emotion / importanceScore）：`kind + summary + with + salience` 已够支撑 §5.2 的判定；ACT-R 的频率项收益（更准的召回）远小于"多一个永不回填的老档字段"的成本。
- **不做多维情绪**：一个 [-1,1] 标量足够改变首选；PAD 三维情绪要配一整套映射与阈值，属于"完备而臃肿"。
- **不把 episodes 全量塞 prompt**：400 字预算 + Top-6（`memory-context.ts:28`）已经验证可用；GA 那种"Top-30 进上下文"要配大窗口。
- **不让角色自己改记忆**（Letta 式 `memory_insert`）：会破坏纯函数可重放（`test/determinism.test.js`）。

### 5.6 可验证指标（三条，都能在测试里复算）

1. **分化**：同处境、同 traits、只有 episodes 不同 → `chooseLife` 首选不同（`test/life-memory.test.js` 直接断言）。
2. **边界**：`memoryMood` 值域 [-1,1]，乘子落在 [0.9,1.1]；`life-golden` 与 `life-diverge` 不红（硬需求分支未被改动）。
3. **计划入口**：计划 prompt 含「昨天」段且内容等于前一日 `kind='day'` 的 summary；不传时输出与现在逐字相同。

---

## 6. 未核实 / 边界（别把推测当已知）

- **GA 参考实现的 recency 方向问题**：读码所得（`extract_recency` + 升序 `nodes`），未跑实验验证对最终行为的影响；论文口径与代码不一致处以论文为准。
- **论文与代码的权重差异**：论文写 α 全 1、decay 0.995/小时；代码是 `gw=[0.5,3,2]`、`recency_decay=0.99`。两者都给了链接，结论是"别把任一当成唯一真理"。
- **Reflexion 的记忆容量/去重**：正文未见明确说明，标未核实。
- **Letta 文档页**是 JS 渲染（抓下来是空壳），本文引用的是官方仓库里的 markdown 原文与搜索摘要，链接都给了。
- **"06:30 计划时今天摘要为空"**是**典型作息下的推断**（23:00–07:00 睡 + 摘要从 00:00 起算），不是逐帧实测；如果某天角色凌晨还醒着，摘要可能有内容。

---

## 附录 · 外链清单

1. Generative Agents 论文（UIST '23）：https://arxiv.org/abs/2304.03442 ；PDF：https://arxiv.org/pdf/2304.03442 ；HTML：https://arxiv.org/html/2304.03442
2. Generative Agents 参考实现：https://github.com/joonspk-research/generative_agents （`cognitive_modules/retrieve.py`、`plan.py`、`memory_structures/scratch.py`、`prompt_template/run_gpt_prompt.py`）
3. MemGPT：https://arxiv.org/abs/2310.08560
4. Letta 记忆类型（官方 md）：https://github.com/letta-ai/skills/blob/main/letta/agent-development/references/memory-architecture.md
5. Letta Memory blocks：https://docs.letta.com/v1-sdk/memory/memory-blocks ；Archival memory：https://docs.letta.com/v1-sdk/memory/archival-memory
6. Reflexion：https://arxiv.org/abs/2303.11366
7. Voyager：https://arxiv.org/abs/2305.16291 ；HTML（§2.2 Skill Library）：https://arxiv.org/html/2305.16291v2
8. ACT-R 基础激活：https://link.springer.com/content/pdf/10.1007/978-3-030-31846-8_6.pdf ；近似方法比较：https://link.springer.com/article/10.1007/s42113-018-0015-3
9. AI Town（TS 复刻，需 Convex+embedding）：https://github.com/a16z-infra/ai-town
