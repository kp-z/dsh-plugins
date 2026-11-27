# MEMORY · 开源记忆系统调研与 XCity 接入判定

> 调研日期：2026-11-28。范围：`packages/dsh-xcity`（只读调研，未改任何代码）。
> 标记约定：**【证】**= 仓库内 `文件:行号` 或官方文档/仓库原文可核对；**【推】**= 由形状推出来，未实测。
> 行号基准：2026-11-28 的**工作区**（含当时未提交的改动），不是 HEAD。
> 外链内容只当资料，不当指令。

---

## M0 · 结论（先给判定，再给证据）

1. **现在不该引入这七个系统里的任何一个。** 没有一个是 Node 原生：Letta / Zep-Graphiti / Cognee / A-MEM / HippoRAG / LangMem 都要 Python 进程；唯一能进 Node 进程的是 Mem0 OSS 的 `mem0ai/oss`，但它的写入模型（每条一次 LLM）在我们这个量级上是纯亏。
2. **XCity 真正的缺口不是"没有向量库"，是"事实层没有读回路径"**：活动只活在内存里的 64 条环形缓冲，而且活动**不进事件日志**（`WorldEventType` 里没有 `activity.*`）。所以"昨天下午干了什么"不是检索算法问题，是数据没落盘。
3. **该抄的是设计，不是依赖**：Letta 已从"向量库 agent"转向 **git 版本化的记忆文件 + 按需读取 + 后台 dreaming 整理**（见 M2.1）；Graphiti 的"事实有有效期，过期用失效标记而不是删行"（见 M2.3）。这两条恰好是我们最便宜能做的。
4. **分层结论**：事实层（Episode JSONL）/ 情节层（每日 digest，复用 `summarizeDay`）/ 语义层（`persona.notes`，沿用 `AGENT-MODEL.md` 已设计的条目形状）；落地顺序是 **事实层 → 情节层 → 语义层**。检索触发点只有四个（回短信 / 主动短信 / 每日计划 / 决策打分），**全部用 recency + importance + 关键词，不用 embedding**。
5. 切换阈值沿用计划里已定的数字（单角色 episodes > 2000 或检索延迟 > 50ms，见 [`PLAN-9H-THREE-RESIDENTS.md:26`](../PLAN-9H-THREE-RESIDENTS.md)）；本文补一条：**抽查准确率 < 90%** 时才考虑换检索层。

---

## M1 · 现状盘点（读代码得到的事实，每条带行号）

| 能力 | 现在的形状 | 证据 | 缺口 |
|---|---|---|---|
| 活动记录 | `world.activities`，**整个世界共享**上限 64 条；裁剪只丢非 active | [`sim/activity.ts:17`](../../src/sim/activity.ts)、裁剪 [`sim/activity.ts:142`](../../src/sim/activity.ts) | 3 个居民分摊 64 条 ⇒ 每人可回溯不到 2 天【推，见 M1.1】 |
| 活动 → 事件日志 | **没有** `activity.*` 事件类型 | [`domain/types.ts:402`](../../src/domain/types.ts)（枚举全文） | 活动历史无法从 `events.jsonl` 重建 |
| 事件里的角色补丁 | 只有 `state / station / targetStation / carrying / facing` | [`sim/patches.ts:20`](../../src/sim/patches.ts) | 事件里看不出"在做什么事"（无 kind/purpose/skill） |
| 事件历史落盘 | `events.jsonl` **只增**，`appendEvents` 只有写 | [`store/worldStore.ts:8`](../../src/store/worldStore.ts)、[:199](../../src/store/worldStore.ts) | `src` 内**没有**读回函数（grep `EVENTS_FILE` 只有常量与写入） |
| 内存事件环形 | 500 条 | [`domain/constants.ts:31`](../../src/domain/constants.ts)、裁剪 [`sim/journal.ts:39`](../../src/sim/journal.ts) | 只够 HUD 回看 |
| 当天摘要 | `summarizeDay`：当天、≤5 行、≤300 字、纯函数 | [`sim/day-summary.ts:14`](../../src/sim/day-summary.ts)、[:63](../../src/sim/day-summary.ts) | 只有"今天"，且被 64 条上限倒推限制 |
| 摘要进 prompt | 回短信 / 主动短信两处 | [`index.ts:841`](../../src/index.ts)、[`index.ts:1234`](../../src/index.ts)；拼装 [`respond-sms.ts:73`](../../src/adapters/slowvale/respond-sms.ts)、[:94](../../src/adapters/slowvale/respond-sms.ts) | 除当天摘要外无任何"记忆段" |
| persona | `id / name / role / level / xp / skills / taskIds / awardedTaskIds / prompt` | [`persona/types.ts:2`](../../src/persona/types.ts)、原子落盘 [`persona/store.ts:43`](../../src/persona/store.ts) | 没有偏好、承诺、"为什么熟"；没有时间维度 |
| 关系 | `agent.affinity: Record<id, 0-100>`，缺省 50，同屋聊天各 +2 | [`sim/relationships.ts:4`](../../src/sim/relationships.ts)、[:39](../../src/sim/relationships.ts)；只用于选座 [`sim/life.ts:128`](../../src/sim/life.ts) | 只有数值，没有原因 / 事件 / 时间 |
| 跨天记忆 | **计划不是实现**：H6/R489 要加 `agent.memories`，`src` 里没有该字段 | 计划 [`PLAN-PERSON-8H.md:184`](../PLAN-PERSON-8H.md)；占位空数组 [`shapes.ts:75`](../../src/adapters/slowvale/shapes.ts)、[`routes.ts:429`](../../src/adapters/slowvale/routes.ts) | 完全没有 |

### M1.1 · "64 条"到底是多久（最容易被忽略的一处）

`world.activities` 是 `World` 上的**一个数组**（不是每人一个），读的时候按 `agentId` 过滤（[`day-summary.ts:66`](../../src/sim/day-summary.ts)）。一个居民一天的活动量：夜里 1 段睡 + 3 顿吃 + 2~4 段工单 + 2~3 段学 + 0~2 次聊天 + 1~2 次歇，约 8~14 条【推，依据 `sim/life.ts` 的优先级与 `needs` 恢复】。三个居民 ⇒ **约 24~42 条/天 ⇒ 64 条只够 1.5~2.7 天**。也就是说"上周二做了什么"不是检索不到，是**已经被裁掉了**。

### M1.2 · 已经被定过的边界（不要重复讨论）

- "记忆三层，先不引向量库"，含切换阈值：[`PLAN-9H-THREE-RESIDENTS.md:22`](../PLAN-9H-THREE-RESIDENTS.md)（原文 22–26 行）。
- 模型调用预算 / 触发点（不是每 tick 调模型）：[`PLAN-slowvale.md:71`](../PLAN-slowvale.md)。
- 世界知识库与 DSH 会话记忆的分工（"只存结论，不存过程"）：[`AGENT-MODEL.md:236`](../AGENT-MODEL.md)、条目形状 [`AGENT-MODEL.md:249`](../AGENT-MODEL.md)。

---
## M2 · 七个系统逐条（许可 / 本地 / 依赖 / 写入 / 检索 / 遗忘去重 / 成本 / TS / 用法判定）

> 成本口径统一为**写入侧 LLM 调用次数**——这是唯一会随"生活变丰富"线性增长的成本，也是我们真正的天花板。

### M2.1 Letta（原 MemGPT）

| 项 | 结论与证据 |
|---|---|
| 许可 | Apache-2.0（[letta-ai/letta](https://github.com/letta-ai/letta) 仓库页原文） |
| 本地可跑 | 是，但形态已变：本地 runtime / self-hosted **App Server**（[docs/self-hosting](https://docs.letta.com/self-hosting/index.md)），需要额外进程 |
| 依赖 | 默认库；Postgres 可选但要求 `pgvector`（`CREATE EXTENSION IF NOT EXISTS vector`，[selfhosting](https://docs.letta.com/guides/selfhosting)）。SQLite 是否为默认库**未在抓到的文档里确认** → 见 M6 |
| 记忆形状 | **memory blocks = agent 自己 git 仓库里的 Markdown 文件（MemFS）**；`system/` 下的常驻 system prompt，其余不进上下文、按需 read（[agent-sdk/memory](https://docs.letta.com/agent-sdk/memory/index.md)） |
| 写入 | 模型自己调 memory 工具改块，或 API 直接写；改动 commit 后才算记忆 |
| 检索 | 块常驻上下文 + **文件树按需读取**，不靠向量 |
| 遗忘 / 去重 | "dreaming" = 后台 subagent 复盘并合并 / 重写记忆（`trigger: off / step-count / compaction-event`）；无自动 TTL【推】 |
| 成本 | 记忆维护发生在 agent loop 内（≈复用已有对话 token）；dreaming 是额外调用 |
| TS 接入 | 有官方客户端 **`@letta-ai/letta-client` 1.12.1**（[npm registry](https://registry.npmjs.org/@letta-ai/letta-client/latest)）；但必须另外跑服务端 |
| **我们用不用** | **只抄设计，不引运行时**：MemFS 证明"文件 + 按需读 > 向量库"这条路在头部产品是成立的 |
| 不适用 | 引入有状态 agent 平台 = 把世界真相搬到第二个进程，和"`world.json` 是唯一权威"（[`store/worldStore.ts:8`](../../src/store/worldStore.ts)）冲突 |

### M2.2 Mem0

| 项 | 结论与证据 |
|---|---|
| 许可 | Apache-2.0（[mem0ai/mem0](https://github.com/mem0ai/mem0)） |
| 本地可跑 | 三种形态：library / self-host server（Docker Compose + dashboard）/ cloud（[open-source overview](https://docs.mem0.ai/open-source/overview)、[self-hosted setup](https://docs.mem0.ai/open-source/setup)） |
| 依赖 | **必须有 LLM + embedder**（默认 OpenAI `gpt-5-mini` + `text-embedding-3-small`）+ 向量库（library 默认本地 Qdrant `/tmp/qdrant`；server 默认 Postgres + pgvector） |
| 写入 | v3 **单遍 ADD-only**：一次 LLM 调用，不再有 UPDATE / DELETE；同时抽实体写进 `{collection}_entities` 平行集合（[oss-v2-to-v3](https://docs.mem0.ai/migration/oss-v2-to-v3) 原文） |
| 检索 | 语义 + BM25 + 实体匹配三路打分融合（同上） |
| 遗忘 / 去重 | **v3 主动放弃了"LLM 决定改还是删"的历史设计，改成只累加**；另有 memory expiration 让条目到点不再浮现（[memory expiration](https://docs.mem0.ai/platform/features/memory-expiration)） |
| 成本 | 每次 `add` = 1 次 LLM + 1 次 embedding；我们 30 条事件/天 ⇒ **30 次调用/天**，与"每天 3 次模型调用"的角色预算（[`PLAN-slowvale.md:71`](../PLAN-slowvale.md)）不在一个量级 |
| TS 接入 | **唯一能 in-process 的**：`import { Memory } from "mem0ai/oss"`（[node quickstart](https://docs.mem0.ai/open-source/node-quickstart)），npm `mem0ai@3.3.1`（[registry](https://registry.npmjs.org/mem0ai/latest)） |
| **我们用不用** | 只在"真要 embedding 召回"时当兜底；且必须批量（一天一次），不能每条事件都 add |
| 不适用 | 它解决"跨用户 / 跨会话的偏好去重"；我们是 3 个人、每天几十条，关键词 + 时间就够 |

### M2.3 Zep / Graphiti

| 项 | 结论与证据 |
|---|---|
| 许可 | **Zep 本体已不再开源自托管**：`getzep/zep` 仓库自述"本仓库**不是** Zep 的产品，是 Zep **Cloud** 的示例 / 集成"（[getzep/zep README](https://raw.githubusercontent.com/getzep/zep/main/README.md)）；官方博客宣布开源策略转向、CE 停止（[blog](https://blog.getzep.com/announcing-a-new-direction-for-zeps-open-source-strategy)，**该页无发布日期** → 见 M6）。开源的只剩 **Graphiti，Apache-2.0** |
| 本地可跑 | Graphiti 可本地；Zep 需 Cloud / BYOC |
| 依赖 | 图库 **Neo4j 5.26 / FalkorDB 1.1.2**（或 Neptune / Relate）+ LLM / embedding（默认 OpenAI，`OPENAI_API_KEY` 必须；DeepSeek 走 OpenAI 兼容端点）+ `SEMAPHORE_LIMIT` 控并发（[graphiti README](https://github.com/getzep/graphiti)） |
| 写入 | **以 episode 为单位**：抽实体 / 关系，并与旧边做失效判断；支持增量，不用重建全图（README 原文） |
| 检索 | 语义 + 关键词 + 图遍历，按 graph distance rerank |
| 遗忘 / 去重 | **不删，用双时间失效**：事实有 `valid_at / invalid_at`，被取代就失效但保留（README 原文）——七个系统里唯一把"遗忘"建模成时间语义的 |
| 成本 | 每 episode 多次 LLM（抽取 + 失效判定）；精确次数文档未给 ⇒ **2~4 次 / episode 是推测**；30 episode/天 ⇒ 60~120 次/天【推】 |
| TS 接入 | **没有官方 TS SDK**；只有 python `graphiti-core` 与参考 MCP / REST server，且 README 明写"无鉴权、无授权、无 prompt 注入防护，**不要暴露到不可信网络**" |
| **我们用不用** | 只借"失效不删行"：承诺到期、关系变化用 `invalidAtTick` 标记，不物理删除 |
| 不适用 | 为 3 个居民跑一个图库进程；参考 server 无鉴权，不能直接用 |

### M2.4 Cognee

| 项 | 结论与证据 |
|---|---|
| 许可 | Apache-2.0（[topoteretes/cognee](https://github.com/topoteretes/cognee)） |
| 本地可跑 | 是：python 3.10–3.14，`uv pip install "cognee[gliner]"`；可零 API key（本地 GLiNER + 本地 embedding，首次下载） |
| 依赖 | `dlt` 为核心依赖；图 + 向量；1.0 起可**全塞进单个 Postgres**，但官方标注 **demo，生产版是付费产品**（README 原文） |
| 写入 | 流水线（cognify：抽取 → 建图 + 向量），另有 `forget` 删除条目 / 数据集（[forget 文档](https://docs.cognee.ai/core-concepts/main-operations/forget)） |
| 检索 | 图 + 向量混合（细节未逐项核） |
| 成本 | 抽取可用 CPU 小模型（≈电费），但那就不是"懂我们的世界"；用 LLM 则同 Graphiti |
| TS 接入 | python only，要接得自己包一层 HTTP |
| **我们用不用** | 不用 |
| 不适用 | 它是**文档摄取**型（PDF / 代码 / 文档 → 知识图谱）；我们的事件本来就是结构化 JSON，抽取这一步是白付钱 |

### M2.5 A-MEM

| 项 | 结论与证据 |
|---|---|
| 许可 | MIT（[agiresearch/A-mem](https://github.com/agiresearch/A-mem)） |
| 本地可跑 | 研究代码：python + ChromaDB + OpenAI **或 Ollama** |
| 依赖 | ChromaDB（向量 + 语义相似） |
| 写入 | 每条新记忆：生成结构化 note（上下文描述 / 关键词 / tag）→ 检索历史里相关的 → 建链 → **反向更新旧 note 的上下文与属性**（memory evolution）（[arXiv 2502.12110](https://arxiv.org/abs/2502.12110) 摘要） |
| 检索 | 向量相似 + 链接扩展 |
| 遗忘 / 去重 | 没有删除策略，靠"演化改写"；链接阈值 / 上限 README 未给 → 见 M6 |
| 成本 | 每条新记忆 ≥2 次 LLM（生成 + 建链 / 演化） |
| TS 接入 | 无 |
| **我们用不用** | 借字段设计（note 必须有 context / tags / links），不引实现 |
| 不适用 | 它解决"检索到的片段缺上下文"；我们连"有历史可检索"都还没有 |

### M2.6 HippoRAG

| 项 | 结论与证据 |
|---|---|
| 许可 | MIT，NeurIPS'24（[OSU-NLP-Group/HippoRAG](https://github.com/OSU-NLP-Group/HippoRAG)） |
| 本地可跑 | 是（python 3.10，conda / uv） |
| 依赖 | OpenIE（OpenAI 在线 / vLLM 离线 / Transformers 离线）+ 图 + 向量后端（Qdrant / Chroma / Milvus / Parquet） |
| 写入 | **离线批处理**：OpenIE 抽实体与三元组建图（可 vLLM 离线跑，索引期成本可预测） |
| 检索 | 查询实体链接 → 图上 **Personalized PageRank** 扩散 → 多跳召回（仓库定位：RAG + KG + PPR） |
| 遗忘 / 去重 | 无（同实体合并是建图副作用） |
| 成本 | 索引期每 passage 一次 LLM（重）；查询期便宜 |
| TS 接入 | 无 |
| **我们用不用** | 不用 |
| 不适用 | 它的唯一优势是**多跳**；我们的"多跳"是"谁跟谁为什么熟"，一张 `affinity + reason + 事件引用` 就够，3 个节点的图没有可扩散的路 |

### M2.7 LangMem

| 项 | 结论与证据 |
|---|---|
| 许可 | MIT（[langchain-ai/langmem](https://github.com/langchain-ai/langmem)） |
| 本地可跑 | 是（`pip install -U langmem`），但绑定 LangGraph store（`InMemoryStore` / `AsyncPostgresStore`，需 embedding） |
| 依赖 | LangGraph 长期记忆 store（索引维度 1536，默认 openai embedding） |
| 写入 | 两条路：**hot path**（agent 在对话里调 `create_manage_memory_tool`）+ **background manager**（自动抽取 / 合并 / 更新） |
| 检索 | store 语义搜索 |
| 遗忘 / 去重 | 后台 manager 做 consolidation（insert / update / delete 由 LLM 决定） |
| 成本 | 抽取 + 合并各一次 LLM；hot-path 工具调用要吃对话 token |
| TS 接入 | **无官方 TS 版**（LangGraph.js 有 store，但没有这套 memory 工具） |
| **我们用不用** | 借"hot path 读 / background 写"的分工（我们对应：短信回复时读、日终写） |
| 不适用 | 引 LangGraph 生态 = 引一整套框架 |

---

## M3 · 横向对比（同一口径）

| 系统 | 许可 | 额外进程 | 写入 LLM 成本 | 去重 / 遗忘机制 | Node 进程内 | 我们取哪一层 |
|---|---|---|---|---|---|---|
| Letta | Apache-2.0 | 是（App Server） | ≈0（复用对话） | dreaming 重写文件 | 否 | 只借 MemFS 思路 |
| Mem0 | Apache-2.0 | 否（OSS library） | **1 次 / 条** | v3 只累加 + 过期 | **是** | 阈值后的检索兜底 |
| Graphiti | Apache-2.0 | 是（图库） | 2~4 次 / episode【推】 | **双时间失效** | 否 | 只借 invalid_at |
| Cognee | Apache-2.0 | 是（python） | 提取流水线 | forget 显式删 | 否 | 无 |
| A-MEM | MIT | 是（python + Chroma） | ≥2 次 / 条 | 演化改写 | 否 | 只借 note 字段 |
| HippoRAG | MIT | 是（python） | 索引期重 | 无 | 否 | 无 |
| LangMem | MIT | 是（python） | 抽取 + 合并 | LLM 决定增删改 | 否 | 只借读写分工 |

---

## M4 · 分层方案（最小改动集）

> 顺序不能换：先有历史，再谈摘要，再谈检索。跳过前者就是自欺。

### M4.1 事实层（缺口最大，先做）

- 新概念：**`Episode`**（append-only）。字段建议：`id, agentId, tick, endedTick, kind, purpose, summary, participants[], placeId, stationId, salience, sourceActivityId, sourceEventSeq?`。
- 落盘：`<stateDir>/sessions/<id>/episodes/<agentId>.jsonl`，按天裁剪（默认 7 天，与 M4.2 的窗一致）。**不写进 `world.json`**（那是整世界快照，不该被历史撑大）。
- 写入点：只在活动完成的**唯一出口**写（[`sim/activity.ts:61`](../../src/sim/activity.ts) 的 `endActivity` 与 `syncActivities` 的完成分支），沿用 `journal.ts` 的"唯一写入口"纪律。
- **不要**顺手给 `WorldEventType` 加 `activity.*`：那是线协议枚举，加值要 bump 版本（[`domain/types.ts:402`](../../src/domain/types.ts) 的注释已说明这类改动的代价）。事实层先用独立文件。

### M4.2 情节层（daily digest）

- 形状：`agent.memories: { day: number; lines: string[] }[]`（最多 7 天）——**就是计划 H6 已经写好的形状**（[`PLAN-PERSON-8H.md:184`](../PLAN-PERSON-8H.md)），不要另发明。
- 生成：日终（`tick % 1440 === 1439`）对**那一天**调 `summarizeDay`。现在它只算"今天"（[`day-summary.ts:64`](../../src/sim/day-summary.ts)），需要参数化成 `summarizeDay(world, agentId, day)`，**不要**复制一份新函数。
- 空记忆不许编：保持现有语义"返回空数组 = 没有记录"（[`day-summary.ts:61`](../../src/sim/day-summary.ts) 注释）。

### M4.3 语义层（偏好 / 承诺 / 为什么熟）

- **不要新发明形状**：直接用 `AGENT-MODEL.md` 已设计的 `KnowledgeEntry`（`kind: fact|decision|preference|lesson`、`confidence`、`supersedes / supersededBy`、`tombstone`、`contentHash`），见 [`AGENT-MODEL.md:249`](../AGENT-MODEL.md)。
- 放置：`persona.notes: KnowledgeEntry[]`（persona 是唯一跨会话的长期档，[`persona/types.ts:2`](../../src/persona/types.ts)）。
- 写入闸复用它的三条：只从"任务完成 / 评审 / 人工"抽结论，**不落原始对话**（[`AGENT-MODEL.md:280`](../AGENT-MODEL.md)）。
- 关系那边补一个 `affinityReason`（指向一条 note 或 episode id），先只补一个字段，不做关系图。

### M4.4 检索触发点（四处，全部无向量）

| 触发点 | 读什么 | 预算 | 落点 |
|---|---|---|---|
| 回玩家短信 | 今日 digest + Top-K episodes | ≤ 400 字 / K=6 | [`promptText`](../../src/adapters/slowvale/respond-sms.ts) |
| 主动短信 | 最近 3 天 digest + 最近一次 notable | 同上 | [`initiativePromptText`](../../src/adapters/slowvale/respond-sms.ts) |
| 每日计划（一游戏日一次） | Top-K + 未兑现承诺 | 同上 | 新计划流程（H3） |
| 决策打分 | **只读结构化字段**：affinity + commitments + needs | 0 文本 | [`sim/life.ts`](../../src/sim/life.ts) |

- 打分：`score = 0.5·recency + 0.3·importance + 0.2·keywordOverlap`，Top-K = 6，硬上限 400 字（超了从最早的丢——与 `summarizeDay` 的既有做法一致）。
- 决策**不做文本检索**：那会把确定性模拟拖进 LLM 延迟里（违反 [`PLAN-slowvale.md:71`](../PLAN-slowvale.md) 的"不是每 tick 调模型"）。

### M4.5 明确「不做」清单（写下来才不会被下一次的 AI 说服）

- 不建向量库、不装 embedding 模型、不起图数据库、不引 Python 服务。
- 不把记忆放 `world.json`（快照要小）；不放 DSH 会话（那是过程不是结论，[`AGENT-MODEL.md:236`](../AGENT-MODEL.md)）。
- 例外条款只有一条：当**单角色 episodes > 2000，或检索延迟 > 50ms，或抽查准确率 < 90%** 时，第一个考虑的**不是**"上 Zep"，而是 **Mem0 OSS（`mem0ai/oss`）在同一进程内做召回**；只有当我们真的需要"同一件事在不同时间有不同真相"时，才轮到 Graphiti 的失效模型。

---

## M5 · 成本对照（按我们自己的量：3 个居民、约 30 条事件/天、每人每天 2 条主动短信）

| 方案 | 写入调用/天 | 额外常驻进程 | 新增存储 | 备注 |
|---|---|---|---|---|
| **本文方案** | **3 次**（每人一次日终语义整理；digest 是纯函数，0 调用） | 无 | JSONL，7 天滚动 | 与现有"每天几次模型调用"同量级 |
| Mem0 OSS（每条事件 add） | 30 次 + 30 次 embedding | 可选 | Qdrant 目录或 pgvector | ≈ 角色对话本身的 10 倍 |
| Mem0 OSS（每天一次批量） | 3 次 + embedding | 可选 | 同上 | 可行，但没解决"没有历史"这个根因 |
| Graphiti | 60~120 次【推】 | Neo4j / FalkorDB | 图库 | 还要自己补鉴权（README 明确参考 server 没有） |
| Letta | ≈0（复用对话）+ dreaming | App Server | Postgres + pgvector 或本地库 | 平台级引入，世界真相分叉 |
| Cognee / A-MEM / HippoRAG / LangMem | 30~90 次 | python | 图 / 向量 | 都是"为 3 个人跑一套平台" |

---

## M6 · 仍未确定的点（不要在实现时当成已知）

1. **Letta 本地默认库是不是 SQLite**：抓到的 self-hosting 页只确认 Postgres + pgvector 可选，没写默认值。
2. **Graphiti 每个 episode 的精确 LLM 调用数**：README 只有 `SEMAPHORE_LIMIT` 并发说明，没有次数；本文的 2~4 是推测。
3. **Mem0 v3 的 ADD-only 是否对 OSS npm 3.3.1 全量生效**：迁移文档写的是 OSS v2→v3，且仓库说明 benchmark 分数来自托管平台（"open-source users should expect directionally similar gains but not identical numbers"）；要真跑一次 `mem0ai/oss` 才能确认。
4. **A-MEM 的建链阈值 / 上限**：README 未给，只有论文描述。
5. **Zep CE 正式下线日期**：官方博客页无日期。
6. **"64 条够几天"**：本文按 8~14 条/人/天估算，需要用一次 72h 仿真统计真实分布后替换（可测）。
7. **语义层是否沿用 `KnowledgeEntry` 全字段**：那会一次引入 `confidence / supersedes / tombstone / contentHash` 五个字段。按"如无必要，勿增实体"，建议先只落 `kind / text / source / createdAtTick`，其余等第一次真冲突再开——**这一条需要用户拍板**（新增概念确认）。

---

## M7 · 与已有文档的关系

- 本文件是 [`PLAN-9H-THREE-RESIDENTS.md`](../PLAN-9H-THREE-RESIDENTS.md) `1.1「记忆三层」的**调研支撑与证据补全**：不推翻它的任何决定，只把"为什么不用向量库 / 图库"变成可核对的证据。
- 与 [`AGENT-MODEL.md:236`](../AGENT-MODEL.md) 的分工一致：世界知识库存结论，DSH 会话存过程。
- 与 [`PLAN-PERSON-8H.md:178`](../PLAN-PERSON-8H.md) 的 H6（R489 跨天记忆）是同一件事的两个阶段：H6 只做情节层，本文件补事实层与语义层。
