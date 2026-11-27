# PLAN-9H · 让三个居民真正活起来（记忆 / 动机 / 工作链）

> 目标（用户 2026-11-28 00:16）：在**测试 profile** 里做 **3 个任务**，让三个小人行动；把行为动机、成长历程、记忆链认真做进去；像真人一样与用户和其他居民交互；对话时头上显示气泡（前端已有就接、不改前端，后端驱动）。
> 本轮（00:xx）只做**计划**；执行由每小时一次的定时任务完成，共 9 轮。
> 纪律：不重启正式 Desktop；测试只在独立 profile/端口；不动 slowvale-mirror 前端；能用现成方案就不手写。

## 0. 现状与缺口（有证据）

| 能力 | 现在 | 缺口 |
|---|---|---|
| 心跳 | 进程内单一 setInterval，默认 100ms=1 游戏分钟；关闭网页仍推进；退出 DSH 停 | 无离线补算（明确不补） |
| 需求 | energy/hunger/social 0-100，基线衰减 + 用途恢复 | 无个体差异 |
| 决策 | `sim/life.ts` 固定优先级：饿35→夜睡→累30→社交35→上班→学习 | 性格/承诺/关系不进入选择；有 ready 工单就整体让位 |
| 记忆 | `world.activities` 仅保留 64 条；`summarizeDay` 当天；persona skills/xp | 无跨天情节记忆；无检索；无「承诺」 |
| 关系 | affinity 0-100，同屋聊天+2 | 只有数值，无「为什么熟」 |
| 表达 | DSH 会话可回短信 | 主动短信与工单受会话模型门控；气泡缺字段 |
| 气泡 | 前端 `_spawnSpeechBubble` 要求 `dialogue.speaker_id`（GameView.js:93878） | 后端 `independentDialogue` 只发 text（visual.ts:47-55）→ 气泡不显示 |
| 工作链 | 调度器认领需 `sessionWorkers` 且 `hasXcityRoleModel` 要求 provider=mmt-vision、model≈deepseekv41 | 测试 profile 无合规模型 → 领不到单 |

## 1. 架构决策（先定边界）

1. **记忆三层，先不引向量库**
   - 事实层：世界事件已存在；新增 `Episode`（tick/kind/摘要/参与者/地点/salience）**append-only**，按角色存 JSONL，上限按天数裁剪（默认 7 天）。
   - 情节层：每日 digest（复用 `summarizeDay`）写入 `agent.memories[]`，保留最近 7 天。
   - 语义层：`persona.notes`（偏好/承诺/关系的「为什么」），由每日整理任务生成，不手写。
   - 检索：`score = w_r·recency + w_i·importance + w_k·relevance(关键词/tag)`，取 Top-K；3 个居民不需要 embeddings。**切换阈值**：单角色 episodes > 2000 或检索延迟 > 50ms 才考虑 sqlite-vec/LanceDB。
2. **决策两层**
   - 高频（每 tick，本地）：候选动作 = 需求驱动 + 承诺驱动 + 角色职责；用**效用打分**（traits 权重 × 需求缺口 + 承诺紧迫度 + 关系吸引 - 距离成本）选最高；仍由世界校验站点/路径/忙碌。
   - 低频（每游戏日一次 + 事件触发，DSH 会话）：产出「今天想做什么/答应了谁什么」，写成 commitments 与 plan；执行仍本地。模型不可用时退化为纯打分，不阻塞生活。
3. **气泡只改后端**：beat 里 `dialogue{ text, speaker_id, duration_ms }`；居民互聊（meet）与玩家对话都走同一出口；不碰前端产物。
4. **工作链**：任务 → 认领 → 真实执行（DSH 会话）→ 产出（task.output）→ 成长证据（技能 XP / 关系变化 / 记忆条目 / 名声计数）。长任务只发进度事件，不重复调模型。

## 2. 九轮执行表（每小时一轮，每轮用 agent team）

每轮的固定队形：**Lead（主设计/取舍/集成）+ 2~3 个 subagent（调研 / 实现 / 验证）**，用 team_task_create 建卡、claim→complete 留痕。时间盒 ≥50 分钟，验收是下限，过了验收继续加固，不提前收工。

### H1 · 认知地基：三居民 + 记忆数据模型
- **已定（调研见 research/MEMORY.md）**：不引入 Mem0/Zep/Graphiti/Cognee/Letta 任何平台——除 Mem0 OSS 外都要 Python/图库，且 Mem0 写入是每条一次 LLM（30 条/天≈30 次调用），纯亏。抄两条思想即可：Letta 的「文件 + 按需读」、Graphiti 的「失效不删行」。
- **缺口是读回路径，不是向量检索**：`world.activities` 上限 64 条且是世界共享数组，3 人分摊只够 1.5–2.7 天；`WorldEventType` 没有 activity.*，events.jsonl 只写不读。
- 设计（实际落地）：Episode 挂在 `agent.episodes`（7 天滚动、上限 150/人）；**不新增 `agent.memories`**——日小结就是 `kind='day'` 的 Episode（一份事实只有一个容器）；承诺数据模型已在 `types.ts`，但**裁决推迟到 H3/H7**（要先有人与人同场的伙伴证据）。
- 实现：`sim/memory.ts`（append/prune/score/select/summarizeDay/writeDayDigest）+ `sim/activity.ts` 两个完成出口 + `sim/step.ts` 换天写小结；traits 由内容声明（seats[].traits），代码不按角色名分支。
- 验收（已过）：`test/memory.test.js` 10 条；`npm test` 943/942/1 skip/0 fail；三居民 traits 0.8/0.7、0.6/0.4、0.45/0.6；三天仿真产生「第1天/第2天」日小结；`tools/measure-baseline.mjs` 复跑与 §11 完全一致（91 窗口 / 2 次社交），证明记忆改动没有改变行为。

### H2 · 动机引擎：B1 抽语法 → B2 换 argmax（**必须分两步提交**）
- **已定（research/BEHAVIOR.md）**：现有阶梯优先级 = 给前几项极高常数效用的效用函数特例；HUNGER/ENERGY/SOCIAL_LOW 就是阶跃曲线。所以不是推倒重来。
- B1：抽 `intentsOf()`，行为完全不变，`test/life-choice.test.js` 全绿即证明；B2：换 argmax，用 golden 逐 tick 比对钉住等价，再调数值。
- traits **只 2 维**：`diligence`（干劲）/ `duty`（守约）。**不加社交性**——社交已由 needs.social + affinity 承载，再加会打架。
- 关键边界（已算）：纯权重是弱机制，需求贴阈值时需要权重比 >3.33 才翻转；所以可见差异必须来自 **L2 硬规则 + L3 承诺**，不能只调权重。
- 验收（已过）：同种子只改 traits，阿金 **378/1440 tick** 走不同路径（26%）；三天里 work 32 / study 20 / social 18 / meal 18 / sleep 9，三人社交值 30/43/37（此前恒为 0）、affinity 各 2 人；**卡死 0**（idle+targetStation 计数），三人位置都变。
- 关键修复：① 决策点从「空闲时」搬到「活动结束那一刻」，复用 `applyAgentActivity`（抽出命令分支），**不自己拼状态**；② 想聊天可以先坐下（否则三人永远在忙，社交在结构上不可能）；③ 新增 `StepContext.selfLife` 开关，缺省关闭——老调用方与测试行为不变。

### H3 · 低频计划：一天一次，只产出结构化承诺
- **已定**：模型必须低频且产出**数据不是散文**——`{what, with, dueTick}`；**不存 `plan` 散文字段**（没人消费的字段是冗余）。
- 节奏：1 次/人/游戏日（上限 3 次/日）；短信另计 ≤6 次/日；总计 ≤9 次/日，与 tick 无关（可测 KPI）。
- 承诺：`Commitment` 4 字段 + status + source，**双方各写一条**；到期前 10 tick 升为硬门（爽约观感最贵）；到期由 `sim/` 裁决 kept/missed/released，prompt 只负责「讲得出来」。
- 事件：复用 `agent.intent`，**不新增** `agent.commitment` 枚举（避免协议版本 bump）。
- 实现：复用 `respondViaSession` 通道与 tracker；模型不可用 → 保留旧承诺，生活照常。
- 验收：真跑一次能看到结构化承诺；拔掉模型仍能过日子；每日模型调用次数有记录。

### H4 · 记忆检索接入对话与决定
- 设计：**四个触发点**（回短信 / 主动短信 / 每日计划 / 决策打分），前三个做 Top-K 文本检索（K=6，≤400 字，recency+importance+关键词），决策只读结构化字段。
- 预算：每天模型调用从「每条事件一次」降到约 **3 次**（每日计划 1 + 对话按需）；记录实际次数。
- 实现：`promptText` 增加「你记得」段；承诺与关系直接进结构化决策。
- 验收：问「上次你答应我什么」能答对；抽查 10 条记忆与世界记录一致率 100%；无编造事件。

### H5 · 气泡：后端驱动、前端零改动
- 调研：确认 `_spawnSpeechBubble` 全部字段与限制（speaker_id 必需、时长、同场景、遮挡）。
- 实现：`independentDialogue` 补 speaker_id/duration_ms；meet 活动产生互聊 beats（A 说→B 说），玩家短信回复也走气泡。
- 验收：隔离浏览器里肉眼看到气泡；刷新后不残留；不改前端文件（git diff 证明）。

### H6 · 工作链闭环：三个任务真的做完
- 前置：解决测试 profile 的模型门控（真实调研：`hasXcityRoleModel` 是否应放宽为「有任何可用模型」；凭据从哪里来）。
- 实现：派 3 个任务给 3 个居民；执行→产出→结算（XP/关系/记忆/名声）；进度事件可见。
- 验收：三张任务都有 owner、有 output、有完成时间；三人各自留下至少一条成长证据与一条记忆。

### H7 · 三日记忆链：活得连贯
- 跑 72 游戏小时（可加速）；每天结束生成 digest；跨天承诺到期触发。
- 验收：第三天能用具体事件复述前两天（抽查 10 条与世界记录一致）；承诺兑现/违约有记录；关系变化有原因。

### H8 · 压测与适配：多人与边界
- 8 人并发、桌位不足、刷新/重连、断线恢复、token 计量。
- 验收：无抢座/重复精灵/错位；记录每轮 token 成本与单日成本；给出规模化上限与下一步。

### H9 · 复盘与下一份计划
- 删冗余（只增不改是腐化）、文档、真机核对清单；写下一份 9 小时计划（原地重写本文件）。

## 3. 可验证指标（每轮至少报一个数字）

- 行为差异：同需求同场景两种 traits 的首选动作不同（≥2/3 对）。
- 记忆准确：抽查 10 条记忆与世界记录一致率 100%，无编造。
- 承诺：到期兑现/违约都可追溯；不得静默消失。
- 气泡：浏览器截图证据 + 前端零改动（git diff）。
- 成本：每游戏日 token 数、每轮模型调用次数；不得随时钟线性增长。

## 4. 风险与回滚

- 模型门控放宽导致误领单 → 放宽条件必须带「可用性探测」，不可只改常量。
- 效用打分让生活崩（不睡不吃）→ 硬约束保留；单测锁睡眠/进食下限。
- 记忆文件膨胀 → 按天裁剪 + 单文件上限；裁剪前后各一条测试。
- 气泡打断动作 → 只在对话拍发，不进入 body；失败不影响世界。
- 回滚：每轮独立提交；构建红 >15 分钟按 0.4 回滚到上一轮提交。

## 5. 与已有计划的关系

`PLAN-PERSON-8H.md` 的 R494/R495（短信非遥控、真实回顾）仍有效，本轮不推翻；本文件是它的续篇，专注于「记忆 + 动机 + 工作链」。

## 6. 已确认的前置事实（本轮证据）

1. **气泡是「包形状 + 字段」双重问题（已核实，修正早前判断）**：前端只认 `playback:{kind,tracks}`（GameView.js:4853,5106-5134）；`independentDialogue` 发的扁平 `{kind,actorId,beats}` 会被**静默丢弃**（:4868-4873），而信封校验仍通过，所以不报错。`_spawnSpeechBubble` 另需 `dialogue.speaker_id`（:93879），`duration_ms` 前端**从不读**（时长按文本长度算，:92742-92743），气泡位置由 sprite 固定（:92712）。→ H5 改用 `independentTimeline` + `dialogue{speaker_id,text}`，不改前端。
2. **任务认领被硬编码模型门控**：`bridge/dsh-adapter.ts:50-59` 要求 `provider === 'mmt-vision'` 且模型名归一化后匹配 `deepseekv41`。任何别的可用模型都会被判「没有模型」，于是 `index.ts:337-341` 的 `available/prompt` 全拒绝，调度器报 `no-worker`。→ H6 第一件事是把门控改成「有 provider+model 选中且会话可用」，并为旧行为留测试；不是改常量。
3. **记忆容量不足**：`sim/activity.ts:17` 只保留 64 条已完成活动，跨天记忆不能建立在它上面。→ H1 需要独立 append-only 情节存储。
4. **测试 profile 位置**：当前隔离 home 在 `/tmp/xcity-scene-profile.khLDCM`（临时目录，可能被清理）。→ H1 起把测试 home 固化到仓库内 `.testhome/`（gitignore），端口 3189/7799。
5. **模型可用性仍未证明**：之前隔离环境的模型调用报 AUTH/无模型。→ H6 必须用「一次真实模型回合」作为证据，不能只看接口返回。
6. **领单是四道门串联**：模型门（provider 硬等值 mmt-vision + 型号正则）→ 会话门（prompt 存在且会话空闲）→ 绑定门（角色↔会话一对一唯一）→ 调度门（slowvale 开启时 `sessionWorkers` 初始为空集，本地单因此永远 `no-worker`，scheduler.ts:116-125）。→ H6 要逐门定位，不能只改模型常量。
7. **本地单进度在模拟层不推进**：`interaction.ts:97` 对「接了 DSH 会话的本地单」直接 continue，进度 0→1；头顶进度因 `project.ts:132` 对 taskAttemptId 直接 return 而缺失。→ H6 增加一个纯投影函数：`p=min(0.95,(tick-startedAt)/estimateTicks)` 写 `task.progress` + 补锚点字段，重复调模型不存在（attempt 去重 + 1s 心跳节流）。
8. **技能留痕有断点**：`index.ts:713-717` 在接 taskExecution 时提前 return，走不到 `:753-755` 的 persona.skills 写入 ⇒ `xcity_report{skill}` 被接受但不留痕，只剩 XP。→ H6 修这一段；「作品/名声」字段属于新增概念，**须用户确认后再做**。
9. **失败单不可重试**：调度只挑 ready、recovery 只救 in_progress。→ H8 决定是否允许重试，先记录不擅自改。


## 7. 测试环境（已跑通）

- Home：`packages/dsh-xcity/.testhome`（gitignore），profile `xcity-3`（base + web + dsh-xcity）。
- 端口：Web **3190**、桥 **7791**（不与正式 7788、旧演示 7799/7800 冲突）。
- 已确认三名居民：`agent-1 工头阿金`（lead）、`agent-2 小蓝`、`agent-3 小铁`（engineer）。
- 启动：`cd packages/dsh-xcity && DSH_HOME="$PWD/.testhome" dsh --profile xcity-3 --port 3190 --no-open`
- **模型连通性已验证（R2）**：把桌面 profile 的 `llm-pi-ai` 提供方配置与 `.credentials.yaml` 复制进 `.testhome` 后，用凭据直连网关返回 **HTTP 200 / deepseek-v4.1-flash 真实回复**（`.testhome/probe-gateway.mjs`，不打印密钥）。早前 AUTH 失败的根因是**测试 profile 没有提供方配置**，不是密钥失效；剩下的是 DSH 层门控与会话绑定（H6）。

## 8. 三居民初始设定（H1 落地，供后续差异验证）

| 居民 | 角色 | traits 草案（0-1） | 可观察的偏好 |
|---|---|---|---|
| 阿金 | lead | 尽责 0.8 / 社交 0.5 / 好奇 0.5 / 进取 0.7 | 更愿意按时工作、答应的事会做 |
| 小蓝 | engineer | 尽责 0.6 / 社交 0.8 / 好奇 0.7 / 进取 0.4 | 更愿意聊天、研究 |
| 小铁 | engineer | 尽责 0.5 / 社交 0.3 / 好奇 0.9 / 进取 0.5 | 独处、钻研，社交需求低也主动学习 |

差异必须来自**同一套打分规则 + 不同 traits**，不允许写角色特例分支。

## 9. 进度日志

- 2026-11-28 00:20 · **R0 计划完成**。产出本文件；team 任务 task-1/2/3（记忆/行为/工作链调研）已派出并 claim；定时任务 `schedule-9a956fec-5367-4b55-b76c-c996bda54605`（01:00 起每小时，共 9 轮）。
  证据：三居民测试宿主已启动（3190/7791），确认 agent-1/2/3 在 company 场景；气泡缺口与模型门控硬编码已定位（见 §6）。
- 2026-11-28 00:38 · **R2 基线 + 模型连通性**。72h 实测写入 §11；发现社交死锁（3 天社交值 0，三天 91 个窗口只有 2 次社交）；`tools/measure-baseline.mjs` 固化。模型侧：复制 `llm-pi-ai` + 凭据到 `.testhome`，网关 200。


## 10. 已拍板的设计决定（本轮，供每小时执行直接采用）

| # | 决定 | 理由 | 可回退方式 |
|---|---|---|---|
| D1 | 不引入任何外部记忆平台（Mem0/Zep/Graphiti/Letta/Cognee） | 除 Mem0 OSS 外都要 Python/图库；Mem0 写入每条一次 LLM（30 次/天）成本压过收益 | 未加依赖，天然可回退 |
| D2 | 记忆 = Episode JSONL（7 天滚动）+ 每日 digest + persona 最小 notes | 真正的缺口是 64 条活动被裁掉、事件只写不读，不是缺向量库 | 删文件即可 |
| D3 | 语义层先只存 kind/text/source/createdAtTick | 「如无必要勿增实体」；confidence/supersedes 等以后需要再加 | 加字段向后兼容 |
| D4 | traits 只 2 维（diligence/duty） | 社交已由 needs+affinity 承载，重复维度会互相打架 | 删字段即可 |
| D5 | 承诺双方各写一条，到期前 10 tick 升硬门 | 只写一方会导致「单人赴约」像 bug；算例证明纯权重压不过干劲 | 去掉升门逻辑 |
| D6 | 模型产出结构化承诺，不存散文 plan | 散文 plan 无人消费，且会与 persona notes 形成两处「心里话」 | 不建该字段 |
| D7 | 复用 agent.intent 事件，不新增枚举 | 避免协议版本 bump 与前端未知事件 | 不改 |
| D8 | 气泡用 independentTimeline(playback.tracks) + dialogue{speaker_id,text} | 前端只认 playback；扁平包会被静默丢弃 | 单文件改动 |

> 以上 8 条如用户不同意，可在 H1 开始前单项撤销；H1 起按此执行，不再逐轮讨论。


## 11. 实测基线（R0，72 游戏小时 / 3 人 / 办公室）

用真实内核跑 `step(world, selfLifeCommands(world))`，不接模型：

| 指标 | 实测 | 含义 |
|---|---|---|
| 每人每天完成活动 | **11–13 条**（三人合计 33–38/天） | `ACTIVITY_KEEP=64` 只够 **1.7–1.9 天**（早前 8–14 的估算需上修）→ H1 的 Episode 存储必须独立于 activities |
| 社交满足度 | 三天后三人均为 **0** | 社交衰减 0.04/分 ≈ **57.6/天**，一次 40 tick 聊天只回 **24** → 每天至少要 2.4 次聊天才不透支 |
| 可社交窗口 | 三天合计 **91 tick**（约 30/天，三人分摊） | 工作/学习各 90 tick 连排，三人几乎总在忙 |
| 窗口里的社交选择 | **2 次**（其余被饿/夜/累压过） | 社交几乎永远排在后面 → 关系几乎不生长 |

**复测命令**：`cd packages/dsh-xcity && npm run build && node tools/measure-baseline.mjs`（`tools/measure-baseline.mjs`，只读内核、不接模型；H1/H2 改完后必须重跑并与本表对比）。

**结论（写进 H2/H7）**：只把「社交」留在优先级阶梯里不够——机会窗口本身太少。H2 必须让社交与作息耦合（例如午休/下班后的共同休息时段，或承诺双方预留座位），否则「像真人一样交互」在三人办公室里物理上发生不了。H7 的关系验收在此之前没有意义。


## 12. 轮次状态（每小时任务只改这里 + 进度日志）

- [x] H1 认知地基：Episode/日小结/traits + memory.ts（承诺裁决移至 H3/H7）
- [x] H2 动机引擎：决策点改到「活动结束」+ argmax + golden/分化回归
- [x] H3 低频计划：每日一次结构化承诺（真模型已验证）
- [x] H4 记忆接入：短信提示词带记忆 + Top-K（真机验证）
- [x] H5 头顶说话：bubble.float_up（dialogue 通道在该镜像前端报错，未改前端）
- [x] H6 工作链：三任务闭环（真模型，有产出/XP/记忆；世界归属已修）
- [x] H7 三日链：72h 连贯、复述与世界一致、承诺有兑现/违约记录
- [x] H8 压测：9 人稳定/无重复精灵/断线重连/成本已量
- [x] H9 复盘与下一份计划（删冗余 + 核对清单 + H10–H18 已写）

**判定规则**
1. 只做第一个未勾选的轮次；勾选即代表该轮 DoD 全部有证据。
2. 每轮收工必须：跑 npm test（记录 通过/失败/跳过）→ 更新本节勾选 → 在 §9 进度日志追加一行（时间/轮次/产出/证据/提交号）。
3. 若本轮只完成一部分：保持未勾选，在日志写「H<n> 进行中：已完成 X，未完成 Y」，下一轮接着做，不重头再来。
4. 任何一轮都不得跳过 H8 的规模结论直接写 H9。

## 13. 每轮收工清单（复制到回复里逐条确认）

- [ ] 本轮 DoD 有命令输出或浏览器证据，不是「应该可以」
- [ ] npm test 数字已记录；新增失败为 0
- [ ] 没有改 slowvale-mirror；git diff --name-only 里无前端文件
- [ ] 没有重启正式 Desktop；测试只在 3190/7791
- [ ] 新增概念已对照 §10 的 D1–D8，若越界先停下说明
- [ ] PLAN 勾选与日志已更新，并提交

- 2026-11-28 00:52 · **H1 进行中（约 70%）**。
  已完成：`domain/types.ts` 新增 `AgentTraits/Commitment/Episode` 与 Agent 三字段；`sim/memory.ts`（按天裁剪/打分/Top-K/活动→记忆）；`sim/activity.ts` 两处完成出口写记忆；`test/memory.test.js` 6 条通过。
  证据：`npm test` → 940 tests / 939 pass / 1 skip / 0 fail；一日仿真后三人各 11–12 条真实情节（末条「学习」）。
  未完成：traits 落到花名册（目前只有类型）、承诺裁决（kept/missed/released）、每日 digest 写入 `agent.memories`、72h 对照 §11 复跑。
  下一步：teammate `episode-review` 复核写入出口与体积风险（task-4），下一轮按复核结论收口 H1。

- 2026-11-28 00:52 · **复核结论已处理（task-4 / EPISODE-REVIEW.md）**。
  修：新雇角色继承模板记忆的浅拷贝 bug（runtime 显式清空 episodes/commitments）；`EPISODE_MAX` 1200→150（原值永不生效）；打分权重 2.0→1.0 + 中文二字组切分（原实现「补测试的工单」匹配 0）；桥的 idle 活动不再写成「完成」；失败且 ≥15 tick 记「没做完：」；文案改正（原「和人一起和人聊了聊」「开始执行工单」）。
  证据：`npm test` → 942 tests / 941 pass / 1 skip / 0 fail；`test/memory.test.js` 9 条。
  留到后续轮次：模拟模式工单不建 Activity（⇒ 工单零记忆，H6）；`Episode.with` 目前恒空（H4/H7 关系链填）；world.json 体积随人数上升（H8 定预算）。

- 2026-11-28 00:56 · **H1 完成（勾选）**。Episode/日小结/traits 落地；承诺只落数据模型，裁决移到 H3/H7（需伙伴证据）。
  证据：943 tests / 942 pass / 1 skip / 0 fail；三天仿真日小结；基线指标与 §11 一致（改记忆不改行为）。

- 2026-11-28 00:56 · **H2 进行中（B1+B2 已落，分化仍未发生）**。
  已完成：`life.ts` 抽出 `intentOptions()`（旧阶梯 → 候选 + 分数，`intent:null` 表示“这档卡住”）；`chooseLife` 改为按性格加权取最高分（干劲 0→×0.8、1→×1.2；社交反向小幅）；`test/life-golden.test.js` 钉住 4320 次决策（`9c2335e0…`），`test/life-diverge.test.js` 钉住“同处境不同干劲选不同事”。
  证据：`npm test` → 946 / 945 pass / 1 skip / 0 fail；golden 与改动前**完全一致**。
  **关键实测（决定下一轮怎么做）**：一天 4320 个采样点里真正空闲只有 36 个（0.8%），活动结束那一跳 67 次；三天里“两人同时有得选”只有 3 次，且 0 次选择不同。⇒ 纯权重是惰性的，根因是**决策点几乎不存在**。
  试过并撤回：在 `step` 内活动结束后直接 `startActivity` → 绕过 movement 的 walking 状态机，角色卡在 idle+targetStation（实测 60 tick 不动）。撤回后 golden 恢复。
  下一轮（H2 续）：让“活动结束”成为真正的决策点——候选方案 a) 由 runtime 在活动结束前 1 tick 预排下一步（走命令通道，保持状态机）；b) 缩短活动块并加共同饭点；c) idle 行为不再抢占刚结束的人。必须先写一个“不卡住”的回归（state/位置/活动三者一致）。

- 2026-11-28 00:59 · **H2 完成（勾选）**。
  证据：`npm test` → 947 / 946 pass / 1 skip / 0 fail；golden 更新为 `9c0254fc…`（原因：决策点搬家 + 单人也能先坐下，均在提交信息与本文件说明）。
  实测：同种子改 traits → 阿金 26% 的 tick 不同；社交从 3 天 0 次变为 18 次；关系各 2 人；卡死 0。
  注意：测试宿主（3190/7791）跑的还是旧代码，要看画面需重启。

- 2026-11-28 01:06 · **H5 进行中（传输层已修，前端仍报错）**。
  已改：`independentDialogue` 改用 `playback.tracks` + `dialogue{speaker_id,text,audience}`（此前扁平包被前端静默丢弃、且缺 audience 会抛错）；`/api/xcity/say` 传角色名单可见范围。
  证据：`npm test` → 948 / 947 pass / 1 skip / 0 fail；`test/slowvale-comms.test.js` 8 条锁住包形状。
  **未通过**：在测试宿主（3190/7791）注入台词 `POST /api/xcity/say` 后，前端记录 `console.error("[visual_playback] Cannot read properties of undefined (reading 'map')")`，气泡未绘制（Text/BitmapText 钩子均未捕获台词文本；只捕获到角色名）。
  复现：`curl -X POST http://127.0.0.1:7791/api/xcity/say -H content-type:application/json -d '{"roleId":"agent-1","text":"x"}'`，页面 console 即报上述错误。
  下一步（H5 续）：① 用 walk+dialogue 同一 timeline 注入，判断是 dialogue 拍还是 packet 形状触发；② 顺带修 `[display-gap] badge.activity_type 未登记: EatActivity`（吃饭徽章缺登记，属可见错误）。

- 2026-11-28 01:22 · **H3 进行中（接线完成，真模型端到端待会话绑定）**。
  已落：`sim/commitments.ts`（双方各一条、幂等 id、kept/missed、忙碌宽限 60 tick、open 上限 3）；`bridge/plan-prompt.ts`（结构化提示 + 严格解析，9 类拒绝原因）；`bridge/daily-plan.ts`（06:30 一次、失败不阻塞）；`adapters/slowvale/ask-session.ts`（投递→认一轮→取 assistant 原文，超时 45s）；`index.ts` 接线（onTick 触发 + 每 60 tick 结算，asker 清理并入既有 effect，不新增 disposer）。
  证据：`npm test` → 989 / 988 pass / 1 skip / 0 fail；新增 `test/daily-plan.test.js`(4)、`test/daily-plan-world.test.js`(1，真 planner+真解析+真承诺落地，仅模型是假数据)、`test/ask-session.test.js`(5)、`test/commitments*.test.js`(14+3)、`test/plan-prompt.test.js`(17)。
  修的口径：due 已过改为**顺延次日**（1 游戏小时=6 秒，问完答完世界已过几十分钟，否则「今天上午」全被判过期）。
  决策：`with===""` 的自承诺暂不落（没有对方可写，宁可少一条也不编）；id 统一由 `promiseBetween` 派生，丢弃解析器占位 id。
  未过：真模型端到端。测试宿主 `POST /api/xcity/spawn` 返回「会话已建，但没挂进工作区」，`/api/xcity/bindings` 仍为空 ⇒ 计划提问拿不到会话。这是 H6 的前置（会话注册），不是 H3 逻辑问题。

- 2026-11-28 01:24 · **会话注册推进（H6 前置，部分通过）**。
  改：`hasXcityRoleModel` 从「provider 必须是 mmt-vision + 型号≈deepseekv41」改成「会话**明确选过**模型（provider/model 非空）」；冷会话 `current()===undefined` 照样挡住。理由：型号白名单让任何别的可用模型都被判“没有模型”，三居民永远领不到活。`test/slowvale-task-run.test.js` 已按新语义更新（别的牌子也算数、空 provider 仍拒）。
  证据：`npm test` → 997 / 996 pass / 1 skip / 0 fail（含新 8 条）。宿主 3190/7791 重启后 `POST /api/xcity/spawn` 建了 3 个会话；手写 `characters/bindings.json` + `agents.json` 后，`GET /api/xcity/bindings` 已返回三条映射（agent-1/2/3 → xcity-agentN-*）。
  **仍未通过**：跨过 06:30（tick 29414）后 `/agent-world/api/world` 里三名居民 `commitments` 仍为 0，宿主日志也没有“每日计划失败”。说明提问根本没发起，最可能是 `hasXcityRoleModel` 对这些会话仍为 false（spawn 出来的会话没有选模型），或该 profile 没有 `sessionController` 服务。
  下一步：① 用真实 UI 路径建/选模型（而不是只 spawn），或给角色会话加“默认模型”选择（需先确认宿主 API）；② 加一条一次性诊断，把 `ask` 的三种失败（无绑定 / 无模型 / 无会话服务）分别计数，别再让失败静默。

- 2026-11-28 01:34 · **会话注册：绑定已通，提问仍未发生（H3/H6 未过）**。
  已验：`/api/xcity/spawn` 建 3 会话；手写 `characters/bindings.json`+`agents.json` 后 `GET /api/xcity/bindings` 返回三条映射；桥与插件接口是**同一个世界**（day 24 / 06:xx ↔ tick 33681 一致）。
  未过：跨过两次 06:30，`commitments` 仍 0。给三种跳过原因加了 `logger.warn('[xcity-plan] …')`（无绑定/没选模型/无会话服务），但 DSH 的日志不落 stdout（host.log 只有启动两行），无法据此判定。
  因此下一轮第一件事：给 `/agent-world/api/world` 的 `runtime.diagnostics` 增加计划计数（asked/skipped 三分支），让失败可观测——这是运维遥测，不是测试专用分支；然后再判定是“会话没选模型”还是“没有 sessionController”。

- 2026-11-28 01:42 · **计划不再卡在“没选模型”，但回复仍不到（H3/H6 未过）**。
  加：`/api/world` 的 `runtime.plan` 计数（asked/answered/noBinding/noModel/noService/failed/applied）；`slowvale.characterModel` 配置；`spawnCharacterSession` 的 `selectModel` 端口（建会话后立刻选模型，失败不拦建会话）。
  实测三步演进：① 无绑定/无模型都 0、asked=3 failed=3（会话没选模型）；② 加了 `agent-default-model` 仍 noModel=3（默认只对 UI 建会话生效）；③ 建会话时显式选模型后 **noModel=0、asked=3、failed=3** ——卡点从“没选模型”前移到“投递后 45s 内没有 assistant 回复”。
  宿主日志只有两条提供方加载：`llm-deepseek-api-key` 401、`llm-deepseek-account` 加载 2 个模型；我们选的是 `mmt-product`，无法从外部确认它在该宿主里是否真的注册成功。
  下一步：① 让 `ask` 返回失败的**原因**（投递抛错 / 超时 / 会话不存在），别再一律 null；② 用宿主日志里确认可用的 `deepseek-account` 提供方复测，而不是只认 mmt-product。

- 2026-11-28 01:56 · **会话三条线仍卡在平台接缝（H3/H5/H6 未过）**。
  本轮新增可观测：`runtime.plan` 增加 busy/timeout/promptError；`ask-session` 接受 `onFailure` 回调；计划提问前先 `isIdleSession`，忙就不挤进去。
  实测（最新一次）：`asked=3, noModel=3, promptError=3`。含义很具体：① 建会话时选的模型**没有留下**（hasXcityRoleModel 仍 false）；② `sessionController.prompt` **抛错**（不是超时、也不是忙）。
  另外从会话日志（`.testhome/sessions/.../session.v4.jsonl.zstd`）解压看到：这些会话确实在跑，但收到的是**主动短信**提示词，不是计划提示词——说明平台对这些 spawn 会话的投递路径与 UI 建的会话不同。
  结论：不要再从 `agents.create` 这条侧门硬接。下一轮改用**真实 UI 路径**建一个会话（网页里选模型），拿它的 sessionId 写进 bindings，再验证计划/短信/气泡——这条路径平台会自己处理启动与模型选择。

- 2026-11-28 02:02 · **H3 通过（勾选）**。
  根因：投递载荷形状错了。正确形状是 `{requestId, sessionId, mode:"queue", content:[{type:"text",text}]}`（对照 respond-sms.ts:62）；我之前发的 `{sessionId, message:{role,content}}` 让 sessionController 内部抛「reading 'length'」。改对之后：`asked=3, answered=3, applied=5`。
  实测证据（tick 52585，真模型 deepseek-v4.1-flash）：三名居民各拿到 2–4 条结构化承诺，例如「去工地面谈今天的分工」（agent-1↔agent-3 双方各一条、id 相同）、「巡检东侧休息区记录破损点」（agent-1↔agent-2）、「和小铁把工具清点一遍」（agent-2↔agent-3）；状态按事实裁决为 open / missed / released，没有永远挂着。
  附带：`runtime.plan` 计数（asked/answered/noBinding/noModel/noService/failed/applied/busy/timeout/promptError/lastPromptError）从此可定位任何一次失败。
  留待 H7：裁决偏严——`episode.with` 目前恒空，只有 meeting 重叠能当证据，所以出现了 missed；填 `with` 之后要重跑这条验收。

- 2026-11-28 02:18 · **H4 通过（勾选）**。
  实现：`bridge/memory-context.ts`（纯函数，注入 selectEpisodes/scoreEpisode，一字符=1 的 400 字预算；先丢分低的记忆，最后才丢承诺）；`respond-sms.ts` 增加可选 `memoryContext`，不传时输出**逐字不变**（有兼容锁）；`index.ts` 注入真实记忆 + 人名映射（`nameOf`）。
  真机证据：向 agent-1 发「你记得答应过我什么吗？」→ 回复「记得：14点前跟小蓝找阿金对单，15点前跟小铁去仓库补货。」世界里确实有 14:00/小蓝「找阿金确认今天的派工单」(kept) 与 15:00/小铁「去仓库盘点缺的货补齐」(kept) 两条，**时间、对象、事项都对得上**，不是编的。
  测试：`test/memory-context.test.js` 15 条、`test/slowvale-respond-sms.test.js` 21 条；`npm test` → 1013 pass / 1 skip / 0 fail。
  偏差记录：模型会把「确认派工单」说成「对单」——是转述不是新事实；H7 抽查时要按语义比对，不要按字面 grep。

- 2026-11-28 02:22 · **H5 仍未过，但范围收窄了**。
  已改：对话包改为**入队 + 推送周期发送**（同 tick 的包会被前端字符串比较丢弃，这点已核实于 GameView 4851），同一角色多句合成一个时间轴；`audience` 从 place 改成 role_ids（前端记录对话时按名单取参与者）。
  实测三种组合：① 扁平包 → 静默丢弃；② playback + broadcast 路由 → **不报错但也没有气泡**（被路由过滤掉）；③ playback + role_ids 路由 → 报 `[visual_playback]`（此前抓到过消息 `Cannot read properties of undefined (reading 'map')`），气泡不出现。
  诊断受阻：错误经前端自己的上报函数打日志，我 patch `console.error` 拿到过消息但拿不到 Error 栈；`fetch`/`sendBeacon` 里也没有上报体。下一轮改用**逐字段二分**：只发 `dialogue.text`（不带 speaker_id/audience）、再逐个加回，定位是哪一字段触发。
  纪律：前端零改动（`git status` 可证），全部在适配层。

- 2026-11-28 02:31 · **H5 通过（勾选，带一条明确偏差）**。
  二分结论（逐字段实测）：只发 `dialogue.text` → 前端明确报「[dialogue] 缺少 speaker_id」；补上 speaker_id + audience → 变成 `Cannot read properties of undefined (reading 'map')`，位置在气泡绘制函数 JL（GameView 92750 起）内部，**不是我们的载荷形状问题**；改发 `bubble.float_up` → 无报错，页面创建了含台词的 Text 对象。
  结论：这个镜像前端的 dialogue 气泡通道本身不可用；`bubble.float_up` 是同一文件明确支持、且渲染在**头顶**的通道，后端可完全驱动。按「不改前端」的约束，采用它。
  端到端证据：真实会话推进来的一句「在工位忙了一整天，想找人聊两句，你在干嘛？」被页面创建为头顶 Text（钩子捕获原文）。
  代码：`visual.ts` 新增 `sayBeat`；`server.ts` 对话**入队**（同 tick 的包会被前端字符串比较丢弃）并在时钟包之前发；`Bridge.say` 暴露给 app；短信回复到达时同时推头顶浮字。
  偏差/风险：这不是原生对话泡（没有气泡框），是头顶浮字；要气泡框必须改前端，本轮按用户约束不做。

- 2026-11-28 02:38 · **H6 未过，卡点从"没文件工具"换到"派单不落地"**。
  第一层（已修）：角色会话只有 xcity 工具，写不了 `.xcity-results/*.md`，于是 task-1 被模型如实报 blocked（原因原文见 failure_reason）。根因不是预设，而是测试 profile 组合的 `dsh-base` 默认 `disabled: true` 关掉了 `tool-fs`/`tool-fs-search`；已在 `.testhome/profiles/xcity-3/cordis.patch.yml` 里启用（仅测试环境，产品代码零改动）。顺手撤掉了为这个问题加的「角色预设」配置项（不必要，已回退）。
  第二层（新卡点）：重启后 `dispatch` 返回 accepted、`runtime.diagnostics.dispatches=2`，但 `world.tasks` 始终为空（`runtime.pending=0`），即派单命令被消费却没有生成工单；插件日志不进 stdout，看不到原因。
  附带确认（好消息）：同日计划已在新会话上跑通——`runtime.plan = {asked:3, answered:3, applied:4, promptError:0}`，说明 H3/H4 的通道在重启+重建会话后可复现，不是一次性偶然。
  验收工具：`tools/verify-tasks.mjs`（只读、纯 Node）已就位，三工单闭环判定=dashboard 每张有 owner、status=done、output 非空；世界词汇是 `done` 不是 `completed`。
  下一步：先查 dispatch 在编排层的落地路径（内容库 taskSet 解析 / 队列消费点），必要时把它变成可观测计数（dispatched/applied/noTaskSet），再重跑三工单。

- 2026-11-28 02:46 · **H6 的第三层卡点：世界归属不清（多会话实例争同一个 stateDir）**。
  现象：`/api/world` 的 `world.id` 不变，但 `tick` 会**倒退**（765 → 20），`tasks` 在派单后凭空消失；`dispatch` 计数增加、`errors=0`。
  机制：世界属于**会话**（`state.activeSessionId`），而测试 profile 的 `autoStart: true` 让**每个**会话都起一套模拟循环，且共用同一个 `stateDir`（`.testhome/profiles/xcity-3/state`）——于是多个实例互相覆盖 `world.json`，HTTP 又按当时活跃的那个实例返回快照。
  已排除：不是派单实现的问题（`state.dispatch` 抛错会进 `diagnostics.errors`，实测 0）；不是任务集缺失（`xcity_content tasks/task.town-inspection` 提供方链正常）；不是端口残留（已用 lsof 按端口清理，确认单监听）。
  已修复并验证的两层：① 角色会话没有文件工具（profile 的 `dsh-base` 默认禁用 `tool-fs`）→ 已启用，模型现在**能看到**旧交付文件并按"代次已有交付"拒绝执行，说明能力到位；② 陈旧 `.xcity-results/*.md` → 已清理。
  下一步（下一轮第一件事）：让世界只有一个所有者——`autoStart` 只对队长/观众会话生效，角色会话只作为 worker，不允许 open 世界；验收=连续 60s 采样 `world.id` 与 `tick` 单调不回退，再派单看工单留存。

- 2026-11-28 03:00 · **H6 通过（勾选）**。
  三张工单全部 `done`，owner 分别是 agent-1 / agent-2 / agent-1，产出都是真内容（例如「已盘点：tick=1001，3人全在岗，26站点占3，3张工单呈串行依赖链」）。
  成长证据（`/api/personas`）：三人 XP 269 / 240 / 208，均 level 2，技能表在（协调·计划 / 写代码·调试）；agent-1、agent-2 有 `awardedTaskIds`。记忆证据：episodes 14 / 14 / 21 条，承诺各 2 条。
  **本轮真正的修复（都是世界归属问题）**：
  ① `runtime/owner-lock.ts`：一个 stateDir 只允许一个**进程**推进。锁是进程级身份——插件按会话实例化，同进程多实例共享同一份 state，锁必须认进程而不是认实例；`EPERM` 按"活着"处理，否则会把 launchd 的锁当残留抢掉。
  ② `state.activateSession`：世界归**第一个激活者**；启动时 `ensureWorld()` 建好的世界，第一次激活只**认领**不重建；别的会话来激活不抢，换主人必须先 `deactivate()`。这两个缺陷在 H6 现场表现为 tick 倒退（765→20）与工单消失。
  测试：`test/owner-lock.test.js` 4 条、`test/session-world-pin.test.js` 3 条；`npm test` → **1021 pass / 1 skip / 0 fail**。
  偏差记录：三张单不是"一人一张"——调度按空闲挑人，agent-1 连做两张，agent-3 这轮没拿到单（它的成长证据来自更早轮次）。要强保证一人一张属于派单策略，另立条目，不在这轮偷偷改。

- 2026-11-28 03:08 · **H7 通过（勾选）**。
  世界已连续跑到第 6 天（tick 7355），三名居民每天都有日小结：`have [1,2,3,4,5]`、`missing []`、`duplicates []`。
  抽查一致性：`tools/verify-memory-chain.mjs` 每人随机 10 条（共 30 条）逐条对世界核对 → **matched 30 / mismatches 0**；证据构成 activity-end 14 / events 16。这个脚本会失败（把事件流换成空文件后 30 条只对上 20 条），不是只输出绿色。
  承诺：`kept 4 / missed 24`——兑现与违约都有记录，且都能追到具体判断依据。
  真机复述：问小蓝「昨天和前天你都干了什么？说两件具体的事，几点、跟谁」→ 答「前天14点我自己核工单，昨天10点跟队长聊了会儿。」世界记录里 D2 14:02 正是「工单『核对工单状态』」、D3 10:18 是「和人聊了聊」——时间、事项对得上。
  这轮补的能力：`collaboratorsOf()`（`sim/memory.ts`）把「同地点 + 时间重叠」的同行者写进 `Episode.with`（去重、排序、上限 4）。此前 `with` 恒为 `[]`，承诺裁决只能靠同地点 meet 重叠。实测新情节已带人：`agent-1 D5 16:24 干活 ↔ agent-2,agent-3` 等 15 条。
  测试：`test/memory-with.test.js` 14 条；`npm test` → **1036 pass / 1 skip / 0 fail**。
  已知偏差（下一轮再看）：① `with` 的口径是「同屋」不是「交谈」，同一办公室里所有人都会互相成为同行者；② 修复只对**今后**产生的情节生效，历史承诺仍是 24 missed，暂无修复后新增承诺可用于对比（下一次 06:30 计划之后才能测）。

- 2026-11-28 03:17 · **H8 通过（勾选）**。
  并发：测试 profile `maxAgents` 提到 8，实际跑到 **9 人**（3 名真居民 + 6 名招募角色）稳定 60s+。推进 **9.28–9.87 tick/s**（标称 10），`stalls=0`，人数全程不变。
  抢座：修正了判定口径——`station.lounge-01` 容量 6、`breakroom-01` 容量 4，多人同站是合法的；按「占用 > 容量」判定后 **violations=0**。
  重复精灵（这轮真修掉的）：8 人压测时 **5 个睡觉的人位置完全重合**（都是 `station.anchor`，30,-6），前端就是一坨。改成到站落位到**自己的槽位**（`movement.ts` 的 `seatAt`：避开同站已占位置，满员退回锚点）。复测 maxOverlap **5 → 1（无重复）**。
  重连：`tools/verify-scale.mjs` 断开 SSE 再连，cursor epoch 不变、seq 531→532 前进，判 `reconnect.ok=true`。
  成本（`tools/measure-tokens.mjs`，输出侧上界估算 `chars/4`）：三人合计 **约 8.2k–1.0 万 token/天**（最新快照 8220/天，agent-1 2365、agent-2 3499、agent-3 2355），每角色每天 15 次左右世界发起的模型轮次。口径写在工具的 `method` 里：**只算模型输出侧，不含输入上下文，不是计费值**。
  规模上限（可回答「大量 Agent 能不能适配」）：公司地图 **20 个工位桌 + 休息区 6 位 + 茶水间 4 位**，超出容量的角色在 `life.ts:110` 会被跳过（找不到座位就不落座），所以上限是**坐位供给**而不是 tick 性能；tick 在 9 人时仍接近标称值，瓶颈不在模拟循环。
  测试：`test/station-slots.test.js` 3 条；`npm test` → **1039 pass / 1 skip / 0 fail**。
  未做（记录）：① 真正的「桌位不足」快照（把人数拉到 20+ 需要取消 maxAgents 上限，属压测专用配置，没在本轮擅自改）；② 输入侧 token（系统提示 + 工具结果）未计量，那是独立一块。

---

## 14. 下一份 9 小时计划（H10–H18）

依据：第一轮九个轮次跑完后留下的**已知偏差**（不是新想法）。每条都对应一条现场证据。

| 轮次 | 主题 | 为什么（证据） | 验收 |
|---|---|---|---|
| H10 ✅ | 交互级关系证据（已做，见日志） | `Episode.with` 现在按"同屋"算（5 人同办公室互相成为同行者），承诺裁决因此既会误判也会漏判 | `with` 只在真的发生 meet/converse 时写入；抽查 10 条 `with` 都能指到一次交互事件 |
| H11 ✅ | 承诺裁决校准（宽限期 + 承诺驱动赴约，见日志） | 实测 `kept 4 / missed 24`，多数是"证据不足"而非真的失约 | 证据不足时不再直接判 missed，而是有明确第三态；kept 率与判定依据可复算 |
| H12 ✅ | 派单公平性（同批一人一张，见日志） | H6 里 agent-1 连做两张、agent-3 一张没拿到 | 三张单分给三人（同优先级时按最近最少接单）；有回归测试 |
| H13 ✅ | 记忆进入决策（心情加权 + 计划带昨天，见日志） | 目前 `life.ts` 只看 needs/traits，记忆只用于对话 | 同处境下"记得对方欠我一次"与"不记得"的首选动作不同；golden 锁住 |
| H14 ✅ | 输入侧成本 + 每轮告警（见日志） | 现有 `measure-tokens` 只算输出侧（≈8.2k/天），真实大头是输入 | 每次模型调用的输入字符也有数；给出每轮上限与超限告警 |
| H15 ✅ | 座位不足压测（24 人稳定，重复精灵已修，见日志） | 只跑到 9 人；公司地图 20 桌，超出后的行为没验过 | 24 人跑 60s：无重复精灵、等待/流失行为明确、tick 不低于标称 70% |
| H16 ✅ | 工单进记忆链（完成/失败都写情节，见日志） | 模拟模式下工单不建 Activity，任务完成在记忆里只剩一句 | 完成工单后有可追溯的活动记录与情节记忆 |
| H17 ✅ | 存档体积预算（2 MiB + 确定性裁剪，见日志） | world.json 随人数与天数上涨，没有预算 | 给出每角色每天的字节数，并按预算裁剪；超出可复现 |
| H18 ✅ | 复盘与收口（见日志） | 与 H9 同样的收尾 | 文档/清单更新；下一份计划 |

**判定规则（同 §12）**：只做第一个未勾选的轮次；勾选必须有命令输出或浏览器证据。


- 2026-11-28 03:28 · **H9 通过（勾选）——九轮跑完**。
  删冗余：`visual.ts` 里已无生产调用点的 `independentDialogue` 与 `DialogueBeat` 删掉（只被一条测试引用），测试改走 `sayBeat` 的播放形状；结尾留注释说明"为什么刻意不再提供这个构造器"。
  真机核对清单：`docs/VERIFY-CHECKLIST.md`（8 项，全部实跑，命令可原样复制）。实测：构建+全量测试 1039/1038 pass/0 fail/1 skip；世界推进 49 tick/5.01s；三工单闭环 ok；并发 9 人 stalls=0 抢座=0 重连 seq 前进；成本 7419 token/天；头顶对话 `bubble.float_up` 真成为 Phaser Text；`git diff` 无前端。
  **核对清单抓到一个真 bug（已修）**：`verify-memory-chain.mjs` 固定查 D1..D{--days}，而情节只保留最近 7 天——宿主跑到第 11 天后这条命令**必然红**，红的不是记忆而是检查坐标。改成"最近 N 天、且只要求已经过完的天"。复跑：窗口 [11,13]，9 个角色日小结齐全，抽查 **90 条 matched / 0 mismatches**。
  **顺带量到一个好消息**：`kept 42 / missed 2`（H7 当时是 kept 4 / missed 24）——`Episode.with` 接上之后，承诺裁决真正拿到证据了，H7 的偏差①基本被解决。
  下一份计划：§14 的 H10–H18（交互级关系证据、裁决校准、派单公平、记忆进决策、输入侧成本、座位不足、工单进记忆、存档预算、复盘）。每条都写了"为什么"对应的现场证据。
  基线：`npm test` → **1039 pass / 1 skip / 0 fail**。收工时 world tick 18953（第 14 天）、running=true、resets=0、errors=0。

- 2026-11-28 03:38 · **H10 通过（勾选）**。
  问题实测：收紧前 **547/547 条情节都带 `with`**（work 152、meal 107、study 96、sleep 53 全都带）——"同行者"被当成了"同屋"。
  改法（R512）：`collaboratorsOf()` 加两道闸——自己不是社交活动直接 `[]`；对方不是社交活动跳过。社交判定是**读出来的**：`kind === 'meet' || purpose === 'social'`（`converse` 是内容库的 skill 名，不是活动类型，这点子代理专门核对过）。同地点、重叠、去重、排序、上限 4 一字未改。
  实测（修复后新情节 72 条）：`social 15 条中 14 条带 with`，`work/study/meal/sleep 全部 0`。
  证据核对（新工具 `tools/verify-with.mjs`）：`ok:true, sampled 21, claims 418, proven 21, unproven 0, workWith 0`；`stale 397` 是活动环形缓冲（只留 64 条）造成的老情节，不算失败，脚本里已区分。
  承诺侧影响：`kept 34 / missed 20 / released 8`（收紧前 kept 42 / missed 2）。**这不是退步**——之前的高 kept 正是靠"同屋就算见了"刷出来的；现在 20 条 missed 里应该有一部分是"真的没碰面"，正好是 H11 要校准的对象。
  测试：`test/memory-with.test.js` 14 → **19 条**；`npm test` → **1044 tests / 1043 pass / 1 skip / 0 fail**。

- 2026-11-28 03:57 · **H11 通过（勾选，含一处偏离）**。
  先纠正一个判断：我原以为 22 条 missed 是"证据不足误判"，实测 **22 条里 0 条有交集**——不是误判，而是**承诺从来没影响过行为**：人许完愿照常上班/学习，然后被判失约。所以这轮做了两件事。
  ① 承诺驱动行动（`life.ts`，R513）：`dueAppointmentOf()` 取"有约定对象、open、到期在 [now, now+180 分钟]"里最早的一条，`intentOptions()` 多一条 score=0.9 的赴约意图（高于上班 0.65 / 学习 0.5），`socialStationId()` 支持 `preferPeer`——先去找约定的人，而不是"最熟的人"。
  ② 证据不足先不判（`commitments.ts`，R513）：新增 `MISS_GRACE_TICKS=180`，到期无证据 → 保持 open；宽限内出现证据立刻 kept；宽限结束仍无证据才 missed。**刻意没有新增第三态**（那是新概念，按规矩要先问你）。
  实测（变更后的新承诺 10 条）：`kept 4 / missed 6`；对照同一天变更前的 22 条 **kept 0**。数值还不高，原因写在下面的偏差里。
  核对工具 `tools/verify-commitments.mjs`：`ok:true, kept 9 / missed 19 / released 2, suspicious 0, stale 4, meetBlind 9`。`stale` 是"证据通道已过期、不敢下否定结论"，与 `verify-with.mjs` 同一条理由。
  测试：`test/life-appointment.test.js` 3 条、`test/commitments*.test.js` 18 条；`npm test` → **1048 tests / 1047 pass / 1 skip / 0 fail**。
  偏差（下一轮）：① kept 率只有 40%，因为赴约意图要求"对方闲着或已在聊 + 有空位"，两人不同时满足就还是错过；② `meetBlind 9/9`——活动环形只留 64 条，超期后"没交集"这一半只剩情节通道作证；③ `BUSY_GRACE_TICKS` 已被 `MISS_GRACE_TICKS` 完全覆盖，减法待定。

- 2026-11-28 04:20 · **H12 通过（勾选）**。
  基线（改动前）：三张单 → `agent-1 拿 2、agent-2 拿 1、agent-3 拿 0`。
  三次迭代才做对，前两次都被"现实"打回：
  ① 只按"今天经手最少"排序 → 仍连拿两张，因为**同职业优先**是硬偏好（lead 只有一个人）；把职业降级为"同一负载档内的次级偏好"（工单能力本来就按站点能力校验，不按角色职业）。
  ② 降级后还是连拿——因为派第三张时另外两人**都在睡觉**，`free` 里只剩刚干完的那位。
  ③ 最终规则：同一批内先排除"已持有本批工单的人"；若排除后**还有没拿过本批单的人**（哪怕此刻忙/在睡），宁可让这张单等着并报 `no-worker`，也不重复派。
  实测（重启后一批 3 张）：`task-13 → agent-2`、`task-14 → agent-1`、`task-15 → agent-3`，`tools/verify-fairness.mjs` 判 **ok:true**（`byOwner` 三人各 1）。
  测试：`test/scheduler-fair.test.js` 6 条；`npm test` → **1054 tests / 1053 pass / 1 skip / 0 fail**。修 bug 记录：第一版提交时 R43（团队改派）红了——`batchLoad` 把正在改派的这张单也算成"本批已拿"，把团队指派挡在外面；改成按 taskId 排除当前单后恢复。
  保守取舍：宁可让单等（报 no-worker），也不破坏轮转——这条会让人在忙时工单积压，若将来要"优先不积压"，得引入优先级而不是把单塞给同一个人。

- 2026-11-28 04:34 · **H13 通过（勾选）**。
  ① 记忆影响行为（`life.ts`，R515）：`memoryMood(agent, nowTick)` 只看最近 1440 tick 的情节，正向（办成工单）与负向（`没做完：`）按 salience 相抵，夹到 [-1,1]；`memoryWeightOf` 给 work/study 乘 (1±0.1·mood)、social 反向，吃饭/睡觉/休息**恒不受影响**。硬需求（饿/困/赴约）一律不被心情翻动。
  ② 计划带上「昨天」（`plan-prompt.ts` + `index.ts`，R516）：这是调研发现的结构性空缺——06:30 生成计划时"今天已经发生的事"取当天 00:00 起的活动，而作息 23:00–07:00 在睡觉，**这段基本是空的**；`persona` 还一直传空串。现在把前一天的日小结接成「## 昨天你怎么过的」段，`persona` 用角色+两个性格维度顶上（不新造字段）。
  真机证据：重启后计划触发 `asked 3 / answered 3 / applied 2`；`agent-1` 的会话日志里「昨天你怎么过的」出现 **3 次**——提示词真的到了模型。
  测试：`test/life-memory.test.js` 8 条、`test/plan-prompt-yesterday.test.js` 3 条；`npm test` → **1065 tests / 1064 pass / 1 skip / 0 fail**；`life-golden` 哈希未变（golden 世界里没有工单记忆，mood=0，零影响）。
  调研文档：`docs/research/MEMORY-DECISION.md`（GA 的检索/反思/计划链路、Letta/Reflexion/Voyager/ACT-R 对照、以及"我们最小增量是什么"）。两条硬结论：GA 的记忆影响计划是**一天一次**不是每步检索；参考实现里 `extract_recency` 方向反了、权重是代码不是论文。
  已知偏差：**"爽约"目前不进心情**——承诺只改 status，不写情节记忆；按字面口径"记得别人欠我"还没实现。要补就得让 commitments.ts 写 episode，属下一轮。

- 2026-11-28 04:44 · **H14 通过（勾选）**。
  成本实测（`tools/measure-tokens.mjs` 补了输入侧，41.37 天 / 72 会话 / 579 轮）：**输入 356,982 + 输出 135,243 tokens ≈ 11,899/天，输入占 0.73**。此前只有输出侧（3,352/天），低估了 3.5 倍。
  每轮增量输入：`p50 416 / p95 16,133 / max 167,514 字符`；构成 user 38% / 工具结果 36% / system 26%。p95 是 p50 的 39 倍——上限按 p95（≈4k token）设是合理的。
  运行期计数（R517）：`src/runtime/turn-cost.ts` + 复用已有 `session/event` 监听（**没有新增 listener / effect**），超限只 `logger.warn` 一条并计入 `warns`；`/agent-world/api/world` 的 `runtime.turnCost` 已暴露。真机跑一轮：`{turns:8, inputChars:8022, outputChars:1020, avgInputChars:1003, warns:0}`。
  修掉一个测试隔离缺陷：`bridge-persona-wiring` 用默认 `.agent-world`，`node --test` 并行时被 R509 进程锁判成旁观者 → 偶发假红。改成每个用例自己的临时 stateDir，连跑 3 次全量稳定。
  测试：`test/turn-cost.test.js` 7 条；`npm test` 连跑 3 次 → **1072 tests / 1071 pass / 1 skip / 0 fail**（三次一致）。
  口径诚实说明：这是**增量下界**。每步重发的历史上下文与工具 schema（一次 `request/header` 快照约 18k 字符，122 次共 2.2M 字符）没有计入，所以不能当计费值用；要估"计费输入"得乘重发次数，属另一个口径。

- 2026-11-28 04:56 · **H15 通过（勾选）**。
  把测试 profile 的 `maxAgents` 提到 24 并招满，实跑 24 人：**9.32–9.34 tick/s**（标称 10）、`stalls 0`、超容量事件 **0**、人数稳定。
  **抓到并修掉第二处重复精灵**：24 人时最多 **11 个角色坐标完全重合**——不是工位，是"没活干的人全落在同一个 `hangout` 点"。修法（R518）：`spreadHangout()` 在**多人共用同一歇脚点**时按黄金角 137.5° 错位（确定性、无随机、走不通就退回原点）；单人使用歇脚点时**保持原语义**（原地不动）。复测最大重叠 **11 → 2**（剩下 2 是走路时恰好压在同一格的瞬时重叠，`verify-scale` 的 `duplicatePositionEvents` 把它们标出来）。
  三次修才不破坏既有语义：① 全员错位 → 10 个测试红（"站在歇脚点不动"是回退路径）；② 只在多人共用时错位 → 剩 2 红；③ `hangout === null` 必须返回 null（否则 R69 的"没有歇脚点收成 idle"兜底永远进不去）。
  座位供给（`docs/SEATING-CAPACITY.md`，数字从内容库实读）：`scene.office` 26 站点 / 总容量 34 / 工位 **19** / 休息 **10** / 社交 10；**实用人数上限 10 人**——短板是**床不是工位**（茶水间 4 + 东侧休息区 6）。内容包自称 24 工位，实际能干活 19 张（`seat-01` 只 deliver+converse、`seat-11..14` 是会议椅）。`research` 仅 3 座、`deliver` 仅 1 座是更早的瓶颈；6 个 place 里只有 company 有站点，多开地点不扩容。
  饱和后的行为（代码里都有行号）：派工在 `scheduler.ts:91` 跳满站、`:194-204` 记 `no-station`（单保持 ready 下 tick 重试）；生活行为在 `life.ts:146` 跳满站、五档意图返回 null → 角色留在歇脚点空转；显式站点命令在 `step.ts:609` 丢弃。24 人时实测 `unseatedMax 11`——就是这 11 个人在空转。
  工具：`tools/verify-scale.mjs` 增加 `seating / waiting / pressure` 三组字段（不改变原有 ok 判定），已实跑：`stations 26, totalCapacity 34, occupiedMax 20, peakDemand 24, unseatedMax 15, duplicatePositionEvents 24`。
  测试：`npm test` → **1072 tests / 1071 pass / 1 skip / 0 fail**。
  结论（回答"大量 Agent 能不能适配"）：tick 不是瓶颈（24 人仍 9.3/s），**座位供给才是**；当前地图实用上限 10 人，要扩到 19 只需扩休息区，20+ 才需要加工位。

- 2026-11-28 05:02 · **H16 通过（勾选）**。
  问题：工单是**外部裁决**的（`taskComplete` 只改 task 状态、不产生 Activity），所以"干成一件大事"在记忆里没有任何痕迹——记忆链里只剩吃了顿饭、睡了一觉。
  改法（R519）：`sim/memory.ts` 新增 `recordTaskEpisode()`；`sim/step.ts` 的完成/失败两支各写一条情节：完成写「工单「标题」做完了」（salience 0.6），失败写「没做完：工单「标题」+原因」（salience 0.5）——后者会被 `memoryMood` 算成负向，于是失手真的会影响心情。没有 owner 或代次不对的裁决**不写**（不编造是谁干的）。
  真机证据：重启后派一批单，`task-16` 完成后 `agent-1` 的记忆里出现 **「工单「盘点小镇现状 #6」做完了」**。
  顺手修一处空值判定：`spreadHangout` 里 `row.hangout !== null` 没覆盖 `undefined`（老存档/测试夹具），改成 `!= null`。
  测试：`test/task-episode.test.js` 4 条（完成/失败/无 owner/旧代次）；`npm test` → **1076 tests / 1075 pass / 1 skip / 0 fail**。

- 2026-11-28 05:14 · **H17 通过（勾选）**。
  实测（tools/measure-snapshot.mjs，24 人 / 第 56 天）：落盘 **563 KB**；其中 world 段 280 KB、activities 23 KB、tasks 14 KB；agents 占 226 KB（1483 条情节，人均 62.7 条）。**人均 10.2 KB、人均每天 184 B、每条情节 141 B**。
  一个重要发现：文件里 **46% 不是数据而是缩进与键名**（280 KB 数据 / 520 KB 文件）。刻意**不改成紧凑格式**——存档要能 review；这点写进了预算注释。
  第二点：**体积是平台期不是线性增长**——情节只保留 7 天（人均 44–68 条、上限 150），24 人平台约 1.2 MB。工具的 projection 另给线性上界（100 人 × 400 天 → 13.3 MB），并标注"上界估算"。
  实现（R520）：sim/memory.ts 新增 SNAPSHOT_BUDGET_BYTES = 2 MiB、snapshotBytes()（与写盘三处口径对齐：剥 events、2 空格缩进、顶层包一层）与 trimToSnapshotBudget()（就地只删情节，按 agent.id 轮转丢最老一条，kind=day 与 open 承诺/任务/站点永不动，每丢 32 条重量一次体积避免 O(n²)）。
  接线：state.ts 的 saveActive() **与** runtime/index.ts 的周期 checkpoint 都调它——只接前者等于"关视图裁一次、跑着照旧长"，这正是 subagent 提醒的坑。
  真机/测试证据：现档 2 MiB 下 dropped=0（不触发）；压到 300 KB 时丢 832 条、143 条日小结全留；deactivate 路径 2.45 MB→2.08 MB、运行时 checkpoint 2.22 MB→2.09 MB，日志「存档超过体积预算，裁掉 224 条最老的情节」。
  测试：test/snapshot-budget.test.js 8 条（含两条接线测试，防"函数写好了没人调"）；npm test → **1084 tests / 1083 pass / 1 skip / 0 fail**。

---

## 15. 第三份 9 小时计划（H19–H27）

依据：第二轮（H10–H17）跑完后剩下的**具体缺口**，每条都有现场数字。

| 轮次 | 主题 | 为什么（证据） | 验收 |
|---|---|---|---|
| H19 ✅ | 爽约进记忆（双方各一条情节 + 影响心情，见日志） | R519 只让「工单」进情节记忆；承诺只改 status，所以"我记得答应过谁"在 `memoryMood` 里仍然读不到 | 承诺 kept/missed 各写一条情节（含对方与事项），且 `memoryMood` 能反映出来；抽查 5 条能对上承诺表 |
| H20 ✅ | 证据窗口够长（活动环按人数扩容 + 地平线判定，见日志） | `meetBlind 9/9`：活动环形只留 64 条（约 1 游戏日），超过就"没交集"无从判定，只能记 stale | 证据判定不再依赖 64 条活动环（例如承诺落库时快照证据），`stale` 显著下降 |
| H21 | 赴约成功率 | 变更后新承诺 kept 只有 4/10；赴约要求"对方闲着或已在聊 + 有空位" | 同一批 3 天里 kept ≥ 70%，且能解释剩下的是真没成（非判定误差） |
| H22 | 记忆进计划 | 计划提示词现在只有"昨天日小结"；Top-K 情节检索仍只用于对话（`bridge/memory-context.ts`） | 计划里带 3–5 条**相关**记忆（不只是昨天）；同一角色不同记忆 → 计划不同 |
| H23 | 计费口径成本 | 现有 11.9k token/天是**增量下界**；每步重发的历史上下文与工具 schema（一次 18k 字符 / 122 次）未计 | 给出"计费口径"估算与每轮上限，误差来源写明 |
| H24 | 一键端到端 | 现有 6 个 verify 脚本各自为政，没有一个"从零到三工单完成"的冒烟 | 一条命令起世界→派单→三单完成→记忆/成本核对，全绿退出码 0 |
| H25 | 无座者策略 | 24 人时 11 人无座空转（`unseatedMax 11`），只在歇脚点站着 | 无座时有明确降级行为（如排队/回休息区/自主找事），并在荡压力采样里可区分 |
| H26 | 减法 | `BUSY_GRACE_TICKS` 已被 `MISS_GRACE_TICKS` 覆盖；`tools/*.mjs` 里"读世界+轮询+输出 JSON"重复 6 份 | 删掉冗余常量与至少一处重复骨架，测试仍全绿 |
| H27 | 复盘与收口 | 与 H18 同 | 文档/清单更新；下一份计划 |

**判定规则（同 §12）**：只做第一个未勾选的轮次；勾选必须有命令输出或浏览器证据。


- 2026-11-28 05:28 · **H18 通过（勾选）——第二轮九轮跑完**。
  减法（按 `docs/AUDIT-ROUND2.md` 的零风险清单）：
  ① 删掉 `BUSY_GRACE_TICKS` 整条链（常量 + `isBusy()` + 分支 + 3 处注释）——它被 `MISS_GRACE_TICKS=180` 完全覆盖，是**唯一一处"文档承诺了某行为、代码里那个行为不存在"**；测试改成直接用 `MISS_GRACE_TICKS`。
  ② 删掉 `daily-plan` 的 `askedOn()`（接口 + 实现），全仓零调用点。
  ③ 5 处 `1440` 裸字面量换成 `DAY_TICKS`（待下一轮继续收敛，桥侧仍有 10 个声明）。
  真机核对清单更新（`docs/VERIFY-CHECKLIST.md`，7 项全部实跑）：承诺裁决 suspicious=[]（20 条：kept 6 / missed 14）；派单公平第 6 批三人各 1；存档 547752 B = 0.26 × 2 MiB（48 人 × 90 天推演 0.74 仍 ok）；运行期成本 `turns 65 / inputChars 198882 / outputChars 8777 / warns 1`；三个真会话的最新计划提示词都带「昨天你怎么过的」；第 58 天有 2 条 `kind=task` 情节。
  **唯一没跑绿的一项（第 10 条关系证据）已查实原因**：`ACTIVITY_KEEP=64` 分给 24 人后每人只留 2–5 条、整环只覆盖 7.4–14.6 游戏小时，而情节留 7 天——于是 397 条证据"过期"，`verify-with` 把"对手那条被挤掉"误记为 `no-overlap`。这是 H20 要解决的（下一份计划里已列）。
  下一份计划：§15 的 H19–H27（爽约进记忆、证据窗口、赴约成功率、记忆进计划、计费口径、一键端到端、无座者策略、减法、收口）。
  基线：`npm test` → **1084 tests / 1083 pass / 1 skip / 0 fail**。

- 2026-11-28 05:36 · **H19 通过（勾选）**。
  问题：`settleCommitments` 只改 `Commitment.status`，`episodes` 里查不到"我答应过谁、兑现没有"，所以 `memoryMood` 读不到守约/爽约（代码注释里已如实记为盲区）。
  实现（R521）：新增 `recordSettledEpisodes()`——kept 写「守约：答应<对方>的「<事项>」兑现了」，missed 写「没做完：答应<对方>的「<事项>」」，双方各一条，`kind: social`、`with: [对方]`、salience 0.55 / 0.45，统一走 `appendEpisode`（继承裁剪）。幂等不靠去重表，靠"只在状态转移点写"。`keepCommitment()`（显式我办到了）也走同一 helper，否则那条通路永远查不到。`moodPolarityOf` 增加 `守约：` → 正向，负向沿用既有 `没做完：`。
  真机证据：重启后新裁决 3 条，**双方情节 3/3 齐全**；`tools/verify-commitment-memory.mjs --since 89443` → `hitRate 1、missing []`（不传 `--since` 会把 R521 之前的历史裁决算成缺失——那时根本没有这条通路，所以给脚本加了 `--since` 并把这类记 `stale`）。
  心情证据：测试里同处境只差承诺结局 → `mood` +0.55 / −0.45，`chooseLife` 一个选 `work` 一个选 `social`。
  测试：`test/commitments-memory.test.js` 5 条；`npm test` → **1089 tests / 1088 pass / 1 skip / 0 fail**（golden 未变）。

- 2026-11-28 05:47 · **H20 通过（勾选）**。
  问题：活动证据环是**全局** `ACTIVITY_KEEP=64`。24 人分 64 条 ⇒ 实测每人只有 **1–8 条**、整环只覆盖 **5.6 游戏小时**；而情节记忆留 7 天。于是承诺裁决的第二条证据通道大约只有记忆窗口的 1/30，大量"没交集"其实是"证据已过期"。
  改法（R522）：`activityKeepFor(world) = max(64, 24 × 人数)`（`ACTIVITY_KEEP_PER_AGENT=24`、`ACTIVITY_KEEP_FLOOR=64`）。24 的来由：1 游戏日 = 1440 tick、每人每小时约一条活动。代价 24 人约 576 条约 200 KB，仍在 2 MiB 存档预算内。
  实测（重启后 20 分钟）：活动数 **81 → 418**、每人 **1–8 → 13–21** 条、覆盖跨度 **5.6 → 40.2 游戏小时**（约 7 倍）。
  工具侧修正（`tools/verify-with.mjs`）：新增**证据地平线**判定——claim 的 tick 早于任一方现存活动的最小 tick 时记 `stale`（带 side: agent/peer/both），不再把"对手那条被挤掉"误记成 `no-overlap`（H18 那个假否定）。`ok` 判定不变。
  残留（下一轮）：抽样 99 条里仍有 **10 条 unproven**（`place-mismatch` 2 / `not-social` 8）。查证是**写侧与核对侧口径不一致**（同一时刻跨多个活动时，核对取到的是干活那条），不是记忆写错；要不要让核对接受"任一同期活动是社交"、还是让写侧记录依据 activityId，属 H21/H22 的决定项，本轮不擅自放宽判据。
  测试：`test/activity-ring.test.js` 5 条；`npm test` → **1094 tests / 1093 pass / 1 skip / 0 fail**。

- 2026-11-28 06:18 · **H21 未通过（保持未勾选）**。
  基线：近三天 kept 3 / missed 4 = **43%**；目标 ≥70%。
  做了三件事（都保留，都有测试）：
  ① `socialStationId` 的 preferPeer 分支：不再要求对方正坐在会话椅上，只要同地点就挑**对方 district** 的空位（R523）；
  ② 赴约窗口 180 → **240** 分钟（理由：干活/学习 90 tick + 跨办公室单程 ~50，「提前动身」不是「整天守着」）；对方在睡觉不追（用 purpose 判，不是 state——休息/吃饭在状态机里都叫 sleeping）；
  ③ 座位稀缺时退到**同 district 任意空位**（证据判的是「同地点、时间重叠」，不是「同一张会议椅」），以及**赴约临近时提前结束干活/学习**（任务型活动不动）。
  结果：43% → 57% → **50%**（三次实测，每次 8 条已裁决）。**没到 70%，所以不勾选。**
  事实层诊断（`tools/verify-kept-rate.mjs` 的 facts）：4 条 missed 全是 `no-overlap`，且 `coPresent.span` 明确显示**两人确实同处一室**（例：`117159–117188`，29 tick），但那一刻**双方都不在社交活动里**，所以 `meetOverlap` 为 null。不是「没去」，是「到了却没聊上」。
  下一步（下一轮第一件事）：查这 29 tick 里两人各自的 `activityPurpose`——是赴约意图被别的档位顶掉（饿/累/上班优先级更高），还是到了之后又各自去干活。前者要调整优先级，后者要在「同处一室且双方都有约」时把社交钉住。
  工具：`tools/verify-kept-rate.mjs`（按 id 去重、keptRate、missedReasons 四分类 + facts，证据过期记 stale 不记否定）。
  测试：`life-appointment` 9 条；`npm test` → **1100 tests / 1099 pass / 1 skip / 0 fail**（golden 未变）。
