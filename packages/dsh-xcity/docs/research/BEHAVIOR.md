# RESEARCH · 角色自己的动机与决策（BEHAVIOR）

> 任务：`task-2`（Lead 拆的 H2 前置调研）。作者：behavior-research。
> 纪律：**只调研，不改代码**（本轮唯一写入 = 本文件）。不重启进程、不跑全量构建、不碰前端。
> 每条结论给**文件路径+行号**或**外链**，并标注【证据】/【推测】。
> 取证时间：2026-11-28 00:20–00:50（外链为当日抓取；行号对应当前工作区磁盘状态）。
> 关系：本文是 [`PLAN-9H-THREE-RESIDENTS.md`](../PLAN-9H-THREE-RESIDENTS.md) H2「动机引擎」的取证稿，
> 编号 `B1…B6` 为建议的**流程号**（代码注释里请沿用同一套号，方便 review）。

---

## 0. 五条结论先行

| # | 结论 | 依据 |
|---|---|---|
| **C1** | 现有 `chooseLife` 不是「笨规则」，它是**效用函数的一个特例**（阶梯 = 权重差 3 倍以上的打分）。所以演进路径不是"推倒重写"，而是**把早退阶梯换成 argmax**，再用等价性测试钉住行为不回归 | §2.3、§3.4；`src/sim/life.ts:165-219`、`test/life-choice.test.js:5-6` |
| **C2** | 让"同需求不同选择"**主要不是靠调权重**。纯权重分化只在需求贴近阈值时生效（翻转条件见 §3.1），弱且不稳定。真正的分化来自三件更硬的东西：**硬规则**（不可协商的价值观）、**承诺**（带 dueTick 的约束）、**当天自述计划** | §3.1 的推演边界 + §2.6 BDI 的 commitment-as-filter |
| **C3** | 模型必须**低频、且输出结构化数据**。一天 1440 tick（`src/sim/life.ts:21`），3 居民逐 tick 调模型 = 4320 次/日；Generative Agents 正是"每步问一次模型"（§2.1 引文）。目标：**计划 1 次/人/日 = 3 次/日**，其余全是本地打分，调用量**不随 tick 增长** | §3.2；Generative Agents §4.3.1 原文 |
| **C4** | 「昨天的约定」要约束今天，约束必须落在**状态里**（`Agent.commitments[]`，绝对 `dueTick`），不能落在 prompt 里。prompt 只负责"让他说得出来"，不负责"让他去得了" | §3.3；`src/bridge/persona-prompt.ts:138-146` 只报事实 |
| **C5** | 推荐**中等档**，但落地顺序是 `B1→B2→B3→B4`（先结构等价重构，再加 traits，再加承诺），**低频 LLM 计划（B5）放最后**。理由：C2 说得很清楚——差异与约束都不需要模型；模型只在"选哪些承诺"上有增量价值 | §4 |

---

## 1. 现状：我们现在有什么（全部有证据）

| 能力 | 现状 | 证据 | 缺口 |
|---|---|---|---|
| 决策 | 固定优先级阶梯：饿(`<35`) > 夜睡(23:00–07:00) > 累(`<30`) > 社交(`<35`) > 上班(09–12/14–18) > 学习 | `src/sim/life.ts:41-43,165-219` | 性格/承诺/关系不进入选择；一旦有 ready 工单就整体让位（`:167`） |
| 内在状态 | energy/hunger/social，0–100，基线衰减 + 用途恢复；**每角色初值完全相同** | `src/sim/needs.ts:20-55,82-91`；`src/domain/types.ts:184` 的 `DEFAULT_NEEDS = {80,80,80}`；`src/sim/needs.ts:62-64` 缺省补全 | 无个体差异（`world/create.ts` 里 grep 不到 needs/traits） |
| 关系 | affinity 0–100，同屋聊天 +2，用于社交选谁 | `src/sim/relationships.ts:10-24,39-65`；`src/sim/life.ts:127-158` | 只有数值，没有"为什么熟"；不影响吃/睡/工作 |
| 心智状态 | 角色有 `needs`、`affinity`、`lastInitiatedSmsTick` 等**只增不改**的可选字段 | `src/domain/types.ts:239-262` | **没有 traits、没有 commitments、没有 plan** |
| 人设 | 只以**文本**形式进 system prompt（`persona` / `speechStyle` 来自内容库） | `src/bridge/types.ts:373-380`；`src/bridge/persona-prompt.ts:105-148` | 人设**不影响行为选择**：`sim/life.ts:13-18` 只 import needs/affinity/occupancy，不 import persona |
| 低模型调用的既有通道 | 心跳 20 tick（纯本地）、主动短信 ≤2/人/日 且间隔 ≥180 tick、聊天按需走会话 | `src/sim/heartbeat.ts:17,92-106`；`src/sim/initiative.ts:15-18,63-65` | 没有"每日一次计划"的钩子；没有"模型产出结构化约束"的通道 |
| 决策位置 | 每 tick 由 runtime 在 `step()` 前注入自派命令，且只补"没人管"的人 | `src/runtime/index.ts:294-303`；`src/sim/step.ts:417-462` | 决定必须是**纯函数 + 可重放**（`test/determinism.test.js:1-13` 逐字节比对） |
| 存档 | 整世界 `world.json` 原子覆盖；世界形状加字段即随档 | `src/store/worldStore.ts:8,44,113,162` | 加 `traits`/`commitments` **不需要新存储**（沿用 `affinity` 的加法，`types.ts:259-262`） |

**一句话**：缺口不是"缺一个 AI 大脑"，缺的是**（a）个体差异的参数、（b）跨天的约束状态、（c）一个低频生成这两者的入口**。

---

## 2. 八种方案逐条判定

### 2.1 Generative Agents（Stanford，记忆流 + 反思 + 计划）

**结论**：它的**决策循环是"每一步问模型"**，代价模型不适合我们；我们只取它的三件**结构**：检索打分（recency+importance+relevance）、反思阈值、计划的**递归分解粒度**。

**证据**
- 检索：recency 是按"距上次被检索过了多少游戏小时"的指数衰减，**衰减因子 0.995**；三个分数 min-max 到 [0,1] 后求和 — <https://ar5iv.labs.arxiv.org/html/2304.03442>（§4.1.2）
- importance：直接让模型打 1–10 的整数（"1 = 刷牙，10 = 分手/录取"），同一篇里给了 prompt 原文
- 反思：最近感知事件的 importance **累计 > 150** 才触发，实测**每天 2–3 次**（§4.2）
- 计划：先一日 agenda，再递归分解成**小时块**，再分解成 **5–15 分钟块**，存回记忆流（§4.3.2）
- 决策循环原文："at each time step, they perceive the world … We prompt the language model with these observations to decide whether the agent should continue with their existing plan, or react."（§4.3.1）

**我们怎么用**
1. 检索公式直接照抄（`w_r·recency + w_i·importance + w_k·relevance`，见 PLAN-9H §1.1），**3 个居民不需要 embedding**。
2. "递归分解到分钟块"对我们没有意义——我们的 tick 已经是 1 游戏分钟（`src/sim/life.ts:21`），分解粒度已经到底。所以它们的 plan 层次在我们这里压缩成**两层**：日计划（模型，低频）→ 具体 purpose（规则，每 tick）。**这是减法，不是省略**。
3. 反思阈值 150 的**思想**值得抄：不要每件事都反思，攒够了再反思一次（对应我们"每天一次 digest"，`src/sim/day-summary.ts:63-87`）。

**不适用在哪**
- 每步调模型：25 个角色能跑，是因为研究者按天计费；我们 1 tick = 1 游戏分钟、真实时间 100ms/tick 且要 7×24 挂着，不可行（§3.2 算过：3 人 = 4320 次/日）。
- 它的记忆流是**自然语言条目**，检索靠 embedding；我们连向量库都不该建（PLAN-9H §1.1 已定）。抄**打分公式**可以，抄**存储形态**不行。
- 【推测】它那套"反思"用来生成**行为倾向**（"Klaus 热爱研究"）效果很好，但需要每条都过模型打分；3 个居民、7 天，收益不抵成本。

---

### 2.2 Concordia（DeepMind）

**结论**：它是"**回合制 + Game Master 裁决 + 实体=组件拼装**"的框架，**每个 action 都是一次 LLM 调用**（GM 也要调）。对我们的价值不在运行时，而在**分层形状**，以及**它自己留的确定性后门 ScriptedAct**。

**证据**
- README：「Entities describe their intended actions in natural language, and the GM translates these into appropriate outcomes」；「For each `run_loop` call … the engine requests player entity actions and asks game master entities to provide observations and resolve those actions」— <https://github.com/google-deepmind/concordia>
- 组件文档：`concat_act_component.py`「combines the outputs of other components … into a single prompt for the language model. This is the standard way to generate an action」（= 每个动作一条 prompt）；**同时**有 `scripted_act.py`「For situations where you need deterministic behavior … a predefined sequence of actions」— <https://github.com/google-deepmind/concordia/blob/main/concordia/components/README.md>
- 实体是组件拼装（memory / observation / instructions / plan / question_of_recent_memories），Prefab 只是模板（同 README）
- 论文：Tech Report <https://arxiv.org/abs/2312.03664>；Design Pattern <https://arxiv.org/abs/2507.08892>

**我们怎么用**
1. **抄"组件可替换"的边界，不抄框架**：把"决定"拆成 `候选集 → 打分 → 硬门` 三段（对应 Concordia 的 component 边界），每段可单测，和 `sim/step.ts` 的六段式风格一致（`src/sim/step.ts:1-38`）。
2. **`ScriptedAct` 是"同一架构里保留确定性路径"的存在证明**——这正是我们"高频规则"要的形态；对外可以说：不是我们偷懒，业界主流生成式模拟器也有确定性分支。
3. GM 的"**裁决者与行为者分离**"值得借一个概念：承诺到期该不该算违约，由**世界**判（`sim/`），不由模型自述。这与"世界不伪造能力"（`docs/AGENT-MODEL.md:32-37`）同源。

**不适用在哪**
- **每动作一次 LLM** 的架构对我们不可承受（同 §3.2 的账）。
- Python + 依赖 LLM API + 回合制仿真循环，与我们的 TypeScript 定步长内核（`step()` 无 `dt`，`src/sim/step.ts:19-24`）不是一类东西；**移植**是负收益。
- 【推测】它的 GM 用 LLM 判"动作是否物理可行"；我们的可行性由 nav 网格与站点容量硬判（`src/sim/pathfind.ts`、`src/sim/life.ts:97-118`），不需要模型。

---

### 2.3 Utility AI（效用打分）

**结论**：**这是我们中等档该用的东西**，因为它天生满足两个约束：（a）同一份需求输入 + 不同权重 ⇒ 不同选择；（b）打分是纯函数、可解释、可单测、零模型调用。

**证据**
- 定义："available decisions are scored using some mathematical formulas, and the agent selects a course of action from among the best-scoring options" — Game AI Pro 3, Ch.13 <https://gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf>
- Game AI Pro Ch.9「An Introduction to Utility Theory」把"比较多个方案的相对好坏"作为核心 <http://gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf>
- 响应曲线（线性/二次/逻辑）用来把"原始值"映射成"效用"，避免一刀切阈值 <https://www.gdcvault.com/play/1021848/Building-a-Better-Centaur-AI>（GDC 2015 Dave Mark / Mike Lewis；本条为二手引用、未读原文 → 仅"曲线形状选择"这部分标【推测】）
- **现有代码已是一个效用特例**：阶梯里"先判饿、再判夜、再判累"等价于给这几项**远高于其他项的常数效用**；`HUNGER_LOW/ENERGY_LOW/SOCIAL_LOW` 就是阶跃响应曲线（`src/sim/life.ts:41-43`）

**我们怎么用**（流程号 **B2**）

```
u(need) = clamp((T_need − v_need) / T_need, 0, 1)        // 只在低于阈值时 > 0；T 沿用现常量 35/30/35

score(meal)   = w_hunger    · u(hunger) · 3
score(rest)   = w_energy    · u(energy) · 3
score(social) = w_social    · u(social) · 2 + 0.3 · affinity(best_target)/100
score(work)   = w_diligence · workWindow · 2
score(study)  = w_diligence · (1 − workWindow) · 1.5

硬门（不进打分，B2 保留）：u(hunger) > 0.43（即 hunger<20）→ meal 独占；
                          isNightMinute → sleep 独占
承诺项（B4）：score += w_duty · urgency(dueTick − now) · 2.5
```

- `workWindow` 直接复用 `isWorkMinute`（`src/sim/life.ts:68-71`），不新造时间概念。
- 打分结果**必须写进 `trigger.text`**（现有字段，`src/domain/types.ts:287`），像现在 `life.ts:177` 的 `reason` 一样——这样日志/日记能解释"他为什么去吃饭"，不需要额外加"解释"字段。

**不适用在哪**
- Utility AI 的老问题是**参数难调、行为看起来"抖"**（相邻 tick 分数接近就反复横跳）。对策：加滞回——已在做的事给 +0.2 惯性分；`available()` 已经挡住"正在做的事"（`src/sim/life.ts:80-89`），所以抖动风险主要出现在"刚空闲的同一 tick 选不同的两件事"，用**上次 purpose 加分**即可。
- 它**不解决"昨天的约定"**——承诺必须作为额外项注入打分（§3.3），Utility AI 本身没有时间维度的义务概念。

---

### 2.4 GOAP（Goal-Oriented Action Planning）

**结论**：GOAP 是"**给定目标 + 动作前置/效果 → A\* 搜出动作序列**"。我们**现在不该引入**：它解决"多步、有前置依赖、环境可规划"，而我们的日常选择是**单步**（去哪、干什么），多步部分已由**工单/调度器**承担（`src/sim/scheduler.ts`、`src/sim/ready.ts`）。

**证据**
- F.E.A.R.：每个动作拆成**对象 / 前置条件 / 效果**，用 A\* 在动作空间里搜 — <https://www.gamedeveloper.com/design/building-the-ai-of-f-e-a-r-with-goal-oriented-action-planning>；原始 GDC 2006 讲稿 <https://web.archive.org/web/20140912184601/http://alumni.media.mit.edu/~jorkin/gdc2006_orkin_jeff_fear.pdf>（Orkin）
- 同文：GOAP 的价值在"动作的组合爆炸可以用搜索摊掉"，代价是"规划结果难解释、对世界状态的建模要求高"

**我们怎么用**（只借两个概念，不引引擎）
1. **动作三要素**的写法值得照抄到 `LifeIntent` 上：现在它有 `purpose/stationId/ticks/reason`（`src/sim/life.ts:55-62`），缺"**需要什么前置**"。B4 的承诺项会需要前置判断（"对方是否也答应了"），用 `requires` 表达比散在 if 里好。
2. **"世界状态是显式事实"**这条纪律我们已经有了（`World` 是唯一真相，`src/domain/types.ts:444-489`），继续保持。

**不适用在哪**
- 【证据】我们的"多步"不是行为层的问题：一张单从 `ready` 到 `done` 由**调度器 + 活动 + 外部裁决**推进（`src/sim/step.ts:311-407,481-484`）。再叠一个 GOAP 规划器 = 两个规划器抢同一件事。
- GOAP 需要**可枚举的世界状态谓词**；我们的状态是数值 + 实体引用，改成谓词集是**大改**，违背"平滑演进"。
- A\* 在动作空间搜索的代价是**每决策一次**；1440 tick/日 × 3 人 = 4320 次/日，单步 argmax 是 O(6)，GOAP 是 O(|actions|^depth)，纯浪费。

---

### 2.5 HTN（Hierarchical Task Network）

**结论**：HTN 是"**复合任务按方法分解成子任务，直到原子任务**"。对我们目前**唯一有价值的形态**是"**一天的骨架**"：日计划 = 几个复合任务（上午干活/中午吃饭/下午开会），每个复合任务在规则层分解成原子 purpose。**不要引入 HTN 规划器**，只借层次本身。

**证据**
- HTN 定义与递归细化："HTN models are based on decomposing compound tasks to subtasks until primitive tasks" — <https://ojs.aaai.org/index.php/ICAPS/article/view/13892>
- 经典框架：Erol / Hendler / Nau 1994 <https://cs.umd.edu/~nau/papers/erol1994umcp.pdf>；SHOP2 综述 <https://arxiv.org/pdf/1106.4869.pdf>
- SHOP/SHOP2 的关键性质：「plans for tasks in the same order that they will be executed」— <https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/1580/1479>。**顺序即执行顺序**，比偏序规划简单，也更像"剧本"。

**我们怎么用**
- B5（低频计划）里，模型的产出**不要写成一段散文**，而是 3–5 个**带时段的复合任务**：`{from, to, purpose, with?}`。规则层把 `{from,to}` 与 `isWorkMinute` 之类对齐。这样"计划"与"执行"之间只有一张小表，没有第二套解释器。
- 已有的 `WORK_WINDOWS`（`src/sim/life.ts:24-27`）就是**写在代码里的 HTN 方法**（"工作日 ⇒ 上午干活 + 下午干活"）。承认它，比再造一套层次更诚实。

**不适用在哪**
- HTN 要求**分解方法完备**（人写的 recipe 覆盖所有情况）；我们连"家"、"周末"都还没有（`src/sim/life.ts:180` 注释明说"还没有家，先睡休息区"）。先补实体，再谈分解。
- 真正的 HTN 规划器（SHOP2 类）是**符号规划**，输入是 PDDL 风味的状态；我们的状态是 0–100 连续量，硬套会在"阈值"上打转（`src/sim/needs.ts:20-55` 的曲线比谓词丰富）。

---

### 2.6 BDI（Belief–Desire–Intention）

**结论**：**BDI 的"承诺"是我们最该抄的那一件**，而且只要抄一个字段 + 一条策略，不需要 BDI 解释器。理由：它精确回答了 Q3——承诺是**对"往哪走"的过滤**，不是"多想一层"。

**证据**
- Rao & Georgeff, *BDI Agents: From Theory to Practice*（ICMAS 1995）：「A commitment embodies the balance between the reactivity and goal-directedness of an agent-oriented system」— <https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf>
- 同一篇的三档承诺策略（抓取原文）：**盲目承诺**（blindly-committed，拒绝任何与承诺冲突的信念/愿望变化，"fanatical"）；**单一心思**（single-minded，允许信念变化并据此**放弃**承诺）；**开放心思**（open-minded，信念与愿望都可变）
- 【证据】承诺同时绑定**目的**（想达成什么）与**手段**（用哪种方式），因此"违约"是可判定状态，不是语气问题（同文 §Commitment）

**我们怎么用**（流程号 **B4**，本文最核心的一条）

```ts
// B4：承诺是可判定的世界状态，不是 prompt 里的一句话
interface Commitment {
  id: string
  with: string | null      // 对方 agent id；单人承诺为 null
  what: 'meal' | 'meet' | 'work' | 'visit'
  dueTick: number          // 绝对 tick（跨天天然成立）
  createdAtTick: number
  status: 'pending' | 'kept' | 'missed' | 'released'
  source: 'plan' | 'dialogue' | 'player'
}
```

- 策略取 **单一心思 + 到期降级**（不是盲目承诺）：被更硬的需求（吃饭/夜睡）打断时 `status='released'` 并**记事件**；过了 `dueTick` 还没做则 `'missed'`。这就是"有性格但不僵死"。
- 承诺进打分的**唯一入口**是 §2.3 那一项 `w_duty · urgency · 2.5`；**不许**写成 if 分支插进阶梯（否则又回到硬编码）。

**不适用在哪**
- 完整 BDI 要实现信念修正、意图栈、重考虑策略；我们**没有多步意图栈**（意图就是当前活动 `Activity`，`src/domain/types.ts:277-300`）。上完整 BDI = 为新概念付两次钱。
- BDI 不告诉你**数值**该怎么给（承诺该多重要）；那是调参，靠验收指标（§5 D4）兜。

---

### 2.7 Behavior Tree（行为树）

**结论**：行为树 = "**分层 + 优先级 + 可被更高优先级打断**"。**我们的 `chooseLife` 已经是它的一个退化形态**，所以这条路不是升级，而是**换一种语法表达同一件事**——收益是"可读性/可组合"，成本是"多一层解释器"。

**证据**
- Halo 2（Isla, GDC 2005）：行为树（行为 DAG），**prioritized-list** 是最常用的决策方式——"marching down a prioritized list of children; the first one that can run does, and higher-priority siblings can interrupt the winner on subsequent ticks"；优先级不固定时用 **impulse**（自由触发器 + 指向完整行为）与 **behavior tagging**（位向量快速判相关）— <https://web.archive.org/web/20050317083753/http:/www.gamasutra.com/gdc2005/features/20050311/isla_pfv.htm>
- 同一讲稿的定位："We are not making a single choice. We are finding a discrete set of best options"（转述见 GDC 2008 Halo 3 讲稿 <https://aarmstrong.org/files/gdc2008/Building%20a%20Better%20Battle%20HALO%203%20AI%20Objectives.pdf>）

**我们怎么用**
- **只抄 impulse 的思想**：`chooseLife` 里"饿了就打断一切"（`src/sim/life.ts:172-178`）就是天然的 impulse。B3 引入 traits 后，把"哪些需求可以打断承诺"写成**一张小表**（谁可以打断谁），而不是散落在 if 里——这就是 behavior tagging 的极简版。
- **不引入节点类型**（Sequence/Selector/Decorator）：`LifePurpose` 六个值 + 打分已经覆盖表达力，加节点类型只会让"为什么选这个"多一层间接。

**不适用在哪**
- 行为树的强项是**长时间运行、可中断、带状态的复合行为**（巡逻→发现敌人→追击→返回巡逻）。我们最长的一段行为是 `SLEEP_TICKS=480`（`src/sim/life.ts:48`），且由 `activityUntil` 一个字段表达完了（`src/domain/types.ts:245-246`）。**没有可中断的复合行为可表达**，树就是空转。
- 【推测】一旦引入行为树，团队里会出现"在树里加节点"的路径依赖，而模拟内核的红线是"同一件事只有一处实现"（`docs/AGENT-MODEL.md:32-37`）。这是腐化入口。

---

### 2.8 Voyager 式技能积累

**结论**：Voyager 的"**技能库 = 可执行代码 + 按描述检索 + 组合复用**"是**长期**该有的形态，但它要求"技能是可执行片段"。**落地的正确形态**不是让模型写代码，而是：**模型低频提议"新活动模板"，规则执行；技能 = 带前置条件的 Activity 模板 + 结算证据**。

**证据**
- 三个组件：自动课程（automatic curriculum）、**ever-growing skill library of executable code for storing and retrieving complex behaviors**、带环境反馈/执行错误的迭代提示 — <https://arxiv.org/abs/2305.16291>
- 摘要原文：技能是"temporally extended, interpretable, and compositional"，能**在新世界复用**；效果是 3.3× 独有物品、解锁科技树快 15.3×（同上）
- 我们已有的"技能"雏形是 `persona.skills: string[]`（`src/persona/types.ts:8`），学习结算只加"会不会"与总 XP（`src/persona/study.ts:20-31`），**没有任何"技能怎么被用起来"的路径**

**我们怎么用**（理想档才做，流程号 **B6**）
1. 把 `persona.skills` 从"字符串数组"升级为"**能影响打分的标签**"：某角色 `skills` 含 `research`，则 `score(study)` 加权、`score(work)` 的站点偏好偏移。这是**最小可用的"技能影响行为"**，一行乘法，不新增实体。
2. 技能检索不要 embedding：`skills` 是短标签集（现在最多 4–5 个，`src/persona/study.ts:28`），精确匹配就够。
3. "可执行"我们**已经有了**：`WorldCommand`（`src/protocol/wire/commands.ts`）+ `agentActivity` 就是"可执行的行为片段"。所以"技能库"= **模板化的 WorldCommand 集合**，不需要代码执行沙箱。

**不适用在哪**
- Voyager 的增量来自**开放世界 + 程序合成 + 环境反馈**；我们没有代码执行沙箱，也**不该有**（世界不伪造能力，`docs/AGENT-MODEL.md:33-34`）。让模型写 TS 塞进 `step()` 会直接破坏"决定性/可重放"（`test/determinism.test.js:1-13`）。
- 3 个居民、7 天记忆上限的规模下，技能库的**检索收益 ≈ 0**：人少到"谁擅长什么"用 4 个标签就够。

---

## 3. 四个问题

### 3.1 Q1 · 同需求的两个角色如何做出不同选择

**结论**：分三层，按"可靠度"排序（也是推荐落地顺序）：

| 层 | 机制 | 差异化强度 | 证据 |
|---|---|---|---|
| L1 权重 | traits 乘在各自的 drive 上 | **弱**（只在需求贴近阈值时翻转） | §2.3；翻转条件见下 |
| L2 硬规则 | 每个人不可协商的偏好（"绝不在 21 点后干活""午饭必须坐着吃"） | 中（稳定、可解释） | §2.7 impulse / behavior tagging |
| L3 承诺 + 当日计划 | 带 `dueTick` 的义务，别人没有 | **强**（能压过工作，且跨天） | §2.6 BDI |

**L1 的翻转条件（推演，可用来定参）**
`w_diligence · 2 < w_need · u · gain`，取 `gain=3`：
- `u=0.20`（如 hunger=28）⇒ 需要 `w_need/w_diligence > 3.33`
- `u=0.43`（如 hunger=20，硬门边缘）⇒ 需要 `w_need/w_diligence > 1.55`

⇒ **traits 权重区间应取 0.5–2.0（跨度 4 倍）**：低于此分化几乎不发生，高于此生活崩（饿着不去吃）。

**算例（推演，不是实测）**：10:00，两人 needs 完全相同 `{hunger:28, energy:26, social:30}`

| | w_hunger | w_energy | w_social | w_diligence | meal | rest | social | work | 结果 |
|---|---|---|---|---|---|---|---|---|---|
| 阿金 | 1.0 | 1.2 | 0.5 | 1.3 | 0.60 | 0.48 | 0.14 | **2.60** | 干活 |
| 小周 | 1.0 | 0.7 | 1.3 | 0.5 | 0.60 | 0.28 | 0.37 | **1.00** | 干活 |
| 小周（hunger=20） | 1.0 | 0.7 | 1.3 | 0.5 | **1.29** | 0.28 | 0.37 | 1.00 | **吃饭** |

**这张表本身就是结论**：纯权重两行都是"干活"，只有需求被压到硬门边缘才翻转。所以：
- L1 **必须有**（否则 traits 完全没作用），但**不能只靠 L1**（用户会看到"两个人都一样"）。
- 真正的可见差异要靠 **L2/L3**：阿金"中午必须离开工位吃饭"（硬规则），小周"答应了 12 点见人"（承诺）。这两个都是**状态/配置**，不需要模型。

**验收**：§5 D1/D2。

---

### 3.2 Q2 · 如何低频用模型做计划、高频用规则执行

**结论**：三层频率，边界用**"输出的可执行性"**划，不是用"频率"划。

| 层 | 频率 | 谁执行 | 产出 | 现有证据 |
|---|---|---|---|---|
| 高频（每 tick） | 1440/日 | `chooseLife` 打分（纯函数、无 IO） | 一条 `agentActivity` 命令 | `src/sim/life.ts:165-219`；`src/runtime/index.ts:294-303` |
| 中频（事件/阈值） | 几十次/日 | 心跳、主动短信、需求衰减 | `agent.intent` / `agent.initiative` 事件（不调模型） | `src/sim/heartbeat.ts:17,92-106`；`src/sim/initiative.ts:15-18` |
| 低频（每游戏日 + 事件触发） | **1 次/人/日** | DSH 会话（模型） | **结构化的 commitments / 当日骨架**，不是散文 | 拟新增，B5 |

**三条硬规矩**
1. **模型只产出数据**：`{what, with, dueTick, from, to}`。产出散文 = 执行时还得再问一次模型 ⇒ 又变高频。这是 Concordia "每动作一 prompt"（§2.2）反过来教我们的事。
2. **模型缺席必须能过日子**：降级到纯打分 + 昨天剩下的承诺。仓库里已有这个模式：内容缺失时 `idleBehaviors` 传空数组如实退化（`src/runtime/index.ts:308-321`），人设缺失则 fail-loud（`src/bridge/persona-prompt.ts:113-124`）。**计划缺失属于前者**（退化），不属于后者（不报错）。
3. **调用量与 tick 无关**（这是可测的 KPI，见 D5）：计划 3 次/日（3 居民）+ 主动短信 ≤2/人/日 = 上限 **9 次/日**，不随 1440 tick 增长。

**为什么必须这样**：1 tick = 1 游戏分钟（`src/sim/life.ts:21`），真实时间 100ms/tick（PLAN-9H §0 "默认 100ms = 1 游戏分钟"）。逐 tick 调模型 = **每秒 10 次/人**，3 人 30 次/秒。Generative Agents 是"每步一次"（§2.1 引文），但它没有这个约束。**这是我们不能照抄它的根本原因**。

---

### 3.3 Q3 · 如何让「昨天的约定」约束今天

**结论**：**四件事，缺一不可**——(1) 承诺是带**绝对 tick** 的状态；(2) 承诺只能通过打分项影响选择；(3) 到期由**世界**裁判（kept/missed/released），不由模型自述；(4) 承诺同时进 prompt，但 prompt **不是**约束的执行者。

**证据/理由**
- 跨天天然成立：`dueTick` 是绝对 tick，`minuteOfDay(tick)` 只用于"今天几点"（`src/sim/life.ts:64-77`）；"天"只在摘要里出现（`src/sim/day-summary.ts:64-65`）。**不需要新的日历概念**。
- 存档：`Agent` 上已有的可选字段就是先例（`affinity` 0–100 `src/domain/types.ts:259-260`、`lastInitiatedSmsTick` `:253-258`）；整世界落 `world.json`（`src/store/worldStore.ts:8,44`）。加 `commitments?` **不升存档版本**（与 `needs` 同款加法，`:183-184,261-262`）。
- prompt 只报事实：`buildCharacterSystemPrompt` 的"此刻的事实"段（`src/bridge/persona-prompt.ts:138-146`）**刻意只有事实、没有句子**（`src/bridge/types.ts:382-388` 注释写明）。承诺属于事实，可以加一行；但"他会不会去"不能靠这行字。
- 判罚在 `sim/`：与"世界不伪造能力"同一条纪律（`docs/AGENT-MODEL.md:32-37`）；也与 `recovery.ts` 的口径一致——"状态说他在去工位才是调度器自己的承诺"（`src/sim/recovery.ts:72`）。

**算例（推演）**：第 1 天 18:40 阿金答应小周"明天中午一起吃饭" → `{with:'agent-2', what:'meal', dueTick: day2*1440+720}`

| 时刻 | urgency | 承诺项（w_duty=0.9, ×2.5） | work（w_diligence=1.3, ×2） | 结果 |
|---|---|---|---|---|
| 11:00 | 0（还没进入窗口） | 0 | 2.60 | 干活 |
| 11:40 | 0.67 | **1.51** | 2.60 | 干活 |
| 11:58 | 0.97 | **2.18** | 2.60 | 干活 |
| 12:00（到点） | 1.0 | **2.25** | 2.60 | 干活 ❌ |

**这个算例暴露一个真问题**：`w_duty·2.5` 压不过 `w_diligence·2`。要么把 `gain` 提到 4，要么承诺项在 `u>0.8` 时**直接进硬门**（"到点了，无论如何先赴约"）。我建议**后者**：到点前 10 tick 内承诺升为硬门（与"饿"同级），因为"爽约"在观感上是最贵的错误。**这一条必须用户拍板**（§6 第 3 条）。

**双人承诺要写两条**（发起方 + 接受方各一条）。否则"只有一个人去赴约"看起来像 bug。这是本文发现的**唯一必须成对写入**的地方，B4 要写进注释。

---

### 3.4 Q4 · 与现有 `sim/life.ts` 固定优先级如何平滑演进

**结论**：**六步，每步可独立合并、独立验收**；核心手法是"先做**等价重构**（B1/B2），再换骨头"。

| 步骤 | 做什么 | 影响面 | 等价性/护栏 |
|---|---|---|---|
| **B1** | 把 `chooseLife` 的 6 段早退抽成 `intentsOf(world, agent): LifeIntent[]`（候选全集，按现有阶梯顺序返回）；`chooseLife` = 第一个"可执行"项 | `src/sim/life.ts` 内 | **行为完全不变**：`test/life-choice.test.js` 10 条全绿即是证明（`:5-6` 明写"守优先级"） |
| **B2** | 引入 `scoreIntent`，`chooseLife` = argmax；权重取常量且**复现阶梯**（相邻层权重差不小于 3 倍） | `src/sim/life.ts` | **黄金测试**：同 seed 跑 1 游戏日，逐 tick 记录 `purpose`，B1 与 B2 结果逐 tick 相同（照 `test/determinism.test.js:11-13` 的"逐字节比对"手法） |
| **B3** | `Agent.traits`（**只 2 维**：`diligence` / `duty`），值来自内容库花名册（人设是内容，`src/bridge/persona-prompt.ts:5-9`） | `domain/types.ts` +1 可选字段；内容 schema +2 数字 | 权重乘子 ∈ `[0.5, 2.0]`；硬门不动；D2 全绿 |
| **B4** | `Agent.commitments[]` + 打分项 + 到期裁判（kept/missed/released）+ 事件 | `domain/types.ts` +1 可选字段；`sim/` 新增一个小模块 | 到期裁判是**纯函数**，在 `src/sim/step.ts:559-570` 的段序里**加一段**（不重排现有段） |
| **B5** | 每日一次计划（模型）→ 只写 commitments，不存散文 plan | `bridge` 侧一条通道 | 模型缺席 ⇒ 跳过；D5 计量 |
| **B6** | `persona.skills` 影响打分（技能积累闭环） | `persona` 只读 | 理想档；不在本轮 |

**为什么 B1/B2 必须分开**：`step()` 的六段顺序是语义的一部分（`src/sim/step.ts:1-18`），而 `chooseLife` 是"每 tick 都会跑、结果进存档"的函数。一次改结构 + 一次改数值，一旦回归**无法归因**是哪一次造成的。**分开就能用黄金测试把结构变更钉住**。

**不许动的东西**（否则不叫平滑演进）
- `step()` 签名与六段顺序（`src/sim/step.ts:417-421`）。
- `available()` 的"只安排没人管的人"语义（`src/sim/life.ts:80-89`）。
- "有 ready 工单就整体让位"（`:167`）——这是调度器优先，属于**既有设计**，不是缺陷。
- 不新增 `AgentState` / `Activity.kind`（`src/sim/life.ts:6-8` 明写这是纪律）。

---

## 4. 三档方案与推荐

| | **最小档**（B1+B2+traits） | **中等档**（+ B3 完整 + B4 承诺 + B5 计划） | **理想档**（+ B6 技能 + HTN 骨架） |
|---|---|---|---|
| 改什么 | `life.ts` 重构为打分；`Agent.traits` 2 维；内容 schema +2 数字 | 再加 `commitments[]`、到期裁判、每日一次计划 | 再加技能影响打分、模型产出"当日骨架"、多步分解 |
| 新增实体 | 1（`traits`） | 2（`traits`、`Commitment`） | 3（+ 技能模板/骨架） |
| 模型调用/日 | 0（不变） | 3（计划）+ ≤6（短信）= **≤9** | ≤9（同左，不因技能增长） |
| 新存储 | 无（`world.json` 自带） | 无 | 无 |
| 能回答的问题 | Q1（弱）、Q4 | Q1（强）、Q2、Q3、Q4 | + 长期成长 |
| 主要风险 | 分化不明显 → 用户觉得"没变化" | 承诺压不过工作（§3.3 算例）→ 需硬门；双人承诺漏写 | 技能/骨架引入第二套解释器 → 腐化 |
| 建议工时 | 0.5 轮 | 2 轮 | ≥3 轮，且本轮不做 |

**推荐：中等档，但按 B1→B2→B3→B4 顺序落地，B5 最后**。

**理由（三条）**
1. **主要矛盾是 Q1+Q3，两者都不需要模型**：L2 硬规则 + L3 承诺是**状态与参数**问题（§3.1 表）。把模型放在第一位，会把"看起来有性格"变成"看起来像在聊天"。
2. **最小档会失败在"看得见"**：§3.1 的算例显示纯权重分化只发生在需求贴阈值时；用户第一眼看到的是"两个人还是都去上班"。中等档的承诺能制造**可解释的差异**（"他答应了人，所以他走了"），这正是产品要的。
3. **中等档的增量成本是三张卡片、不是三层框架**：1 个可选字段 + 1 个小模块 + 1 个打分项 + 1 条低频通道。不新增存储、不新增进程、不新增状态机。**减法上也是安全的**：任何一项不好用，删掉一个字段就回到最小档。

**明确不做**（本轮及可见的下一轮）
- GOAP / HTN 规划器 / 行为树引擎 / 完整 BDI（§2.4–2.7 的不适用）。
- 向量库 / embedding 检索（PLAN-9H §1.1 已定；技能是短标签集）。
- 让模型写代码当技能（§2.8 不适用）。

---

## 5. 可验证的验收指标

| # | 指标 | 判据 | 怎么测 |
|---|---|---|---|
| **D1** | 分化率 | 固定 seed、72 游戏小时，两人 needs 差距 ≤5 的同一 tick 中，`purpose` 不同的比例 **≥ 25%**；同 seed 重放 **100% 一致** | 新增 `test/life-divergence.test.js`（照 `test/determinism.test.js:22-39` 的 makeWorld/run 写法） |
| **D2** | 不退化 | `node --test test/life-choice.test.js` 10 条全绿；硬门（hunger<20 吃饭、夜间睡觉）在 traits 取极值 0.5/2.0 时仍成立 | 现有测试 + 参数化 4 组极值 |
| **D3** | 生活不崩 | 72h 内每角色：sleep 占比 25–40%、meal ≥2 次/日、needs 不出现连续 >6h 低于 15 | 跑 72h，聚合 `world.activities`（环形只留 64 条，`src/sim/activity.ts:17` ⇒ 先确认容量或按 tick 采样） |
| **D4** | 承诺可追溯 | 抽查 10 条承诺：status 与当日活动记录一致率 **100%**；无静默消失（每条最终必为 kept/missed/released 之一） | 构造 3 条跨天承诺，跑 2 天，比对承诺事件与 `Activity` |
| **D5** | 成本 | 模型调用 ≤9 次/游戏日；**与 tick 数无关**（跑 24h 与 72h，单日次数差异 ≤10%） | 计数日志（正式计量随 H8 压测补） |
| **D6** | 演进安全 | B2 黄金测试：1 游戏日逐 tick `purpose` 序列与 B1 完全一致（0 处差异） | 新增 `test/life-equivalence.test.js`：先存 B1 快照，再跑 B2 比对 |
| **D7** | 可解释 | 每条自派活动 `trigger.text` 非空，且包含**得分最高的那一项的数值**（如"打工 2.60 > 吃饭 1.29"） | 读 `world.activities[].trigger.text`（`src/domain/types.ts:287`） |

---

## 6. 需要用户拍板的新概念（按"如无必要勿增实体"逐条论证）

| # | 新概念 | 为什么需要 | 能不能不加 | 建议 |
|---|---|---|---|---|
| 1 | `Agent.traits` | 个体差异的唯一来源（§3.1 L1） | 不能：`needs` 全员相同（`types.ts:184`） | **2 维**（`diligence` 干劲 / `duty` 守约）。**不加"社交性"**——社交已由 `needs.social` + `affinity` 承载，再加一维会与它打架 |
| 2 | `Commitment` | "昨天的约定约束今天"的唯一可存形态（§3.3） | 不能：`Activity` 是**已发生/正在发生**，承诺是**未发生**，复用会把语义搞混 | 4 字段 + status + source（§2.6）；**必须成对写入**（双方各一条） |
| 3 | 承诺到点升硬门 | §3.3 算例证明打分压不过工作 | 可以不加，但需把 gain 提到 4（会连带影响其他项） | **建议加**：`dueTick−10` 内承诺与"饿"同级。这是产品判断（"爽约"最贵），请确认 |
| 4 | 每日一次 plan 文本 | 用户要"角色有自己的打算" | **不加**：只存 commitments，不存 plan 散文 | 建议**不存** plan 文本。模型产出直接就是 commitments；没人消费的 plan 字段 = 冗余（与 PLAN-9H §1.1 的 `persona.notes` 合并考虑，避免两处"心里话"） |
| 5 | 新事件类型 `agent.commitment` | 面板/日志要能看见"他为什么走了" | 可以复用 `agent.intent`（`src/domain/types.ts:413`）的载荷 | 若面板不需要单独渲染，**复用 `agent.intent` 更省**（删枚举取值要 bump 协议版本，`:399-401` 注释已提醒） |

---

## 7. 仍未确定 / 我标为推测的部分

1. **【推测】D1 的 25% 分化率是否可达**。§3.1 的算例只验证"单 tick 会翻转"，没验证 24h 累计分布。25% 是**拍的目标**，B3 落地后需实测再定；若达不到，正解是加 L2 硬规则而不是继续调权重。
2. **【推测】承诺项 gain 的取值**（2.5 vs 4）。算例只证明"2.5 不够"，没算 `w_duty` 分布后的效果。
3. **【未验证】模型返回结构化承诺的稳定性**。B5 依赖模型输出 `{what, with, dueTick}` 的 JSON；失败率、是否需要一次修复重试——本轮没跑真模型（纪律：不重启；测试 profile 模型门控未解，PLAN-9H §6.2）。
4. **【未验证】"远处的人约不到"**：`socialStationId` 用中点选房间（`src/sim/life.ts:148-157`）；承诺跨房间时是否会出现"两人在两端等"——需一次定向实验。
5. **【信息缺口】Voyager 的技能检索细节**：只读了摘要（技能库按描述检索、可组合、可跨世界复用），**没读实现**；理想档真要做得再取一次原文。
6. **【信息缺口】行为树的现代理论**（Colledanchise & Ögren 2018）只间接引用、未读原文；不影响结论（我们用它做的判定是"表达力已够，不必引入"）。

---

## 附录 · 外链清单（按引用顺序）

- Generative Agents: Interactive Simulacra of Human Behavior — <https://ar5iv.labs.arxiv.org/html/2304.03442>（arXiv:2304.03442）
- Concordia 仓库 — <https://github.com/google-deepmind/concordia>；组件教程 <https://github.com/google-deepmind/concordia/blob/main/concordia/components/README.md>；技术报告 <https://arxiv.org/abs/2312.03664>；设计模式 <https://arxiv.org/abs/2507.08892>
- Game AI Pro 3, Ch.13 Choosing Effective Utility-Based Considerations — <https://gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf>
- Game AI Pro, Ch.9 An Introduction to Utility Theory — <http://gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf>
- Dave Mark / Mike Lewis, GDC 2015 "Building a Better Centaur: AI at Massive Scale" — <https://www.gdcvault.com/play/1021848/Building-a-Better-Centaur-AI>
- Jeff Orkin, GDC 2006 "Three States and a Plan: The A.I. of F.E.A.R." — <https://web.archive.org/web/20140912184601/http://alumni.media.mit.edu/~jorkin/gdc2006_orkin_jeff_fear.pdf>；通俗版 <https://www.gamedeveloper.com/design/building-the-ai-of-f-e-a-r-with-goal-oriented-action-planning>
- HTN 定义 — <https://ojs.aaai.org/index.php/ICAPS/article/view/13892>；Erol/Hendler/Nau 1994 <https://cs.umd.edu/~nau/papers/erol1994umcp.pdf>；SHOP <https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/1580/1479>；SHOP2 <https://arxiv.org/pdf/1106.4869.pdf>
- Rao & Georgeff, ICMAS 1995 "BDI Agents: From Theory to Practice" — <https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf>
- Damian Isla, GDC 2005 "Handling Complexity in the Halo 2 AI" — <https://web.archive.org/web/20050317083753/http:/www.gamasutra.com/gdc2005/features/20050311/isla_pfv.htm>
- Voyager: An Open-Ended Embodied Agent with LLMs — <https://arxiv.org/abs/2305.16291>
