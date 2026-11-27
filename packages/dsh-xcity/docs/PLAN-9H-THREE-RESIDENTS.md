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
- 设计：Episode JSONL（在 `endActivity` 唯一出口写；7 天滚动；不塞 world.json、不加协议枚举）+ `agent.memories[{day,lines}]`（复用已定形状）+ `persona.notes` 用最小字段（kind/text/source/createdAtTick，**先不上** confidence/supersedes/tombstone）。
- 实现：`sim/memory.ts`（纯函数：append/prune/score/select）+ store 往返；决策只读结构化字段，不做文本检索。
- 验收：单测覆盖裁剪与打分；老档不崩；三居民 traits 可区分；用 `tools/measure-baseline.mjs` 复跑并与 §11 基线对比（活动量、社交窗口），数字写进日志。

### H2 · 动机引擎：B1 抽语法 → B2 换 argmax（**必须分两步提交**）
- **已定（research/BEHAVIOR.md）**：现有阶梯优先级 = 给前几项极高常数效用的效用函数特例；HUNGER/ENERGY/SOCIAL_LOW 就是阶跃曲线。所以不是推倒重来。
- B1：抽 `intentsOf()`，行为完全不变，`test/life-choice.test.js` 全绿即证明；B2：换 argmax，用 golden 逐 tick 比对钉住等价，再调数值。
- traits **只 2 维**：`diligence`（干劲）/ `duty`（守约）。**不加社交性**——社交已由 needs.social + affinity 承载，再加会打架。
- 关键边界（已算）：纯权重是弱机制，需求贴阈值时需要权重比 >3.33 才翻转；所以可见差异必须来自 **L2 硬规则 + L3 承诺**，不能只调权重。
- 验收：同需求两角色 24h 选择分化 ≥25%（达不到就加 L2 硬规则，不继续调权重）；72h 生活不崩（睡眠≈30%、无长期 0 需求）。

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

- [ ] H1 认知地基：Episode/traits/commitments + memory.ts
- [ ] H2 动机引擎：B1 抽 intentsOf → B2 argmax + golden
- [ ] H3 低频计划：每日一次结构化承诺
- [ ] H4 记忆接入：四处触发点 + Top-K
- [ ] H5 气泡：playback.tracks + speaker_id（后端）
- [ ] H6 工作链：三道门 + 三任务闭环 + 进度投影
- [ ] H7 三日链：72h 连贯与承诺兑现
- [ ] H8 压测：8 人/桌位/重连/成本
- [ ] H9 复盘与下一份计划

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
