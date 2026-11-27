# H1 情节记忆补丁 · 只读复核（R497）

> 复核人：episode-review（只读）。日期：2026-11-28。
> 复核对象：`packages/dsh-xcity` 的 R497 提交 **92b46e9 "feat(xcity): H1 情节记忆与写入（R497）"**。
> 偏差说明：任务卡写的是"当前未提交改动"，实际这四个文件在 HEAD 已提交且工作区干净
> （`git status --porcelain -- src/sim/memory.ts src/sim/activity.ts src/domain/types.ts test/memory.test.js` 无输出，
> 提交时间 2026-11-28 00:40:29）。本文按该提交复核，行号取自 HEAD 与工作区（两者一致）。
> 本文只写这一个文件；未改任何源码、未跑构建、未重启进程。行号均为 `file:line`。

## 0. 一句话结论

写入点是干净的（没有"标了 completed 却漏写记忆"的路径），**问题全在边界语义**：
失败/被打断的活零记忆，而"开工一下就被收工"的活会被记成"完成"；加上 `EPISODE_MAX=1200` 实际永不生效、
打分被关键词一票否决、以及两个本提交新增但全仓无人使用的概念，这个补丁还不能算可收。

---

## 1. 活动完成是否只有这两处出口？

**是，但"两处出口"不等于"不漏"。**

### 1.1 出口清点（证据）

`activity.status` 在整个 `src/` 里只有两处被赋终态：

| 出口 | 行号 | 写记忆 |
|---|---|---|
| `endActivity()` | `src/sim/activity.ts:74`（`activity.status = status`） | `src/sim/activity.ts:78`（`status === 'completed'` 才写） |
| `syncActivities()` 到点完成 | `src/sim/activity.ts:109`（`live.status = 'completed'`） | `src/sim/activity.ts:119` |

`grep "status = 'completed'"` 只命中 `src/sim/activity.ts:109`；`grep endActivity(` 的调用方共 5 处
（`step.ts:185`、`step.ts:373`、`activity.ts:33`、`activity.ts:104`，以及定义处 `activity.ts:62`），
全部落在上面两条出口里。**所以"标 completed 却没写记忆"的路径：没有。**
（`step.ts:545` 的 `status:'completed'` 是发出的事件字段，不是活动记录。）

一条记录也不会被重复记账：`endActivity` 先清 `agent.activityId`（`activity.ts:66`），
下一 tick `syncActivities` 的 `liveActivityOf` 就返回 null（`activity.ts:83-86`），到不了 `activity.ts:108`。

### 1.2 真正漏掉的四种"结束了但没记忆"（证据）

1. **任务失败**：`step.ts:373` 对 `taskFail` 传 `'interrupted'` → 不写记忆。
   触发源是 `src/index.ts:355-360`（settle 失败/超时 → `taskFail`）与 `step.ts:400-404`（`task.status = 'failed'`）。
   失败恰恰是最该被记住的一类事，现在完全没有痕迹。
2. **代次失配 / 被换人 / 重启**：`activity.ts:104`（`task.attemptId !== live.taskAttemptId || task.status !== 'in_progress'` → `interrupted`）。
   换人会把旧单退回 ready（`step.ts:352-361`），重启后 attempt 变了，都从这里静默打断。
3. **被新活动顶掉**：`startActivity` 入口无条件 `endActivity(world, agent, 'interrupted')`（`activity.ts:33`）。
   上一个活动还活着就被顶掉时，它不留下任何记忆。
4. **根本没建活动记录（比"漏写"更严重）**：模拟模式下"干活"从来不是 Activity。
   `scheduler.ts:175-189` 派单只写 `task.*` 与 `agent.carrying/targetStation/state`，**不设 `activityKind`**；
   `syncActivities` 的建记录桥要求 `agent.activityKind !== undefined`（`activity.ts:126`）；
   `interaction.ts:113-136` 完工只清 task/agent 字段，不调 `endActivity`。
   于是 `episodeOfActivity` 里 `byTask → salience 0.9`（`memory.ts:41,49`）那条分支，
   在默认（非 live）世界里只有 `src/index.ts:346-354` 的 live 工单执行路径能触发。
   【推】这意味着"小镇自己派的活干完了"不会进 episodes；要验证得跑一天非 live 世界看 `world.agents[].episodes` 里有没有工单条目。

### 1.3 反向偏差：被打断的被记成"完成"（证据）

`session-events.ts:77-86` 把 **每一次 `tool/result`** 映射成 `activity:'idle'`，
`step.ts:180-186` 收到 `agentActivity idle` 就 `endActivity(world, agent, 'completed')`。
玩家命令的护栏（`step.ts:176-179`，要求 `trigger.kind === 'player'`）对这类命令不生效。
结论：live 模式下一次 turn 里工具返回一次就写一条"完成"的记忆——不管活有没有干完。
【推】这是 episodes 数量最大的真实来源，远超任务卡假设的"11–13 条/人/天"（那是生活活动的量）。

---

## 2. interrupted 不写记忆：会不会"干了 40 分钟像没发生"？

**会，而且比 40 分钟更糟——是"干了两小时、最后失败了"完全不记得。**
判断：这是可感知的观感缺陷（玩家问"你昨天不是修那个 bug 吗"，角色答不出来），不是洁癖问题。

最小建议（不新增概念，只改一个判断）：

- `src/sim/activity.ts:78` 的闸门从 `status === 'completed'` 改成
  `status === 'completed' || world.tick - activity.startedAt >= MIN_RECORD_TICKS`，`MIN_RECORD_TICKS ≈ 15`
  （15 分钟以上才算"发生过"；40 分钟当然记）。
- `salience` 不要再给 0.9：`memory.ts:49` 里按 `byTask ? 0.5 : 0.2` 给低权重，让它进得了记忆、但排不过真正完成的事。
- `summary` 加前缀（`memory.ts:36`）：`'没做完：' + what`。**不要**为此给 `Episode` 加 `status` 字段——
  新增概念要先问用户；现有字段足够表达。
- 需要用户拍板的一点：这个改法会让 `activity.ts:33`（被新活动顶掉）也进记忆。
  如果觉得"顶掉"不该记，闸门要带上 `status === 'interrupted' && activity.startedAt + N <= world.tick && 不是被 startActivity 顶掉`，
  那就要多一个参数——建议先按上面简单版，别为 1% 的情况加参数。

---

## 3. episodes 塞进 world.agents：体积与写入频率会不会失控？

### 3.1 实测（不是估算）

- 一份真实 8 人世界 `.xcity/world.json`：**40,473 B**，agents 8 / places 6 / stations 26；
  `world.agents` 字段合计仅 **3,553 B**（单人 compact 424 B）——也就是说 agents 目前几乎不占空间，episodes 会成为主体。
- `world.json` 是 **2 空格 pretty-print**（`src/store/worldStore.ts:112-114`）。
- 单条 Episode pretty-print 实测 **207 B**（compact 123 B）。测量方式：
  `JSON.stringify({world:{agents:[{episodes:[...]}]}},null,2)`，90 条 = 21,984 B，0 条 = 106 B。
- 写入频率：`checkpointEveryTicks` 默认 100（`src/config.ts:95`），`tickMs` 默认 100（`src/config.ts:67`）
  ⇒ **每 ~10 秒整份重写一次 world.json**（`src/runtime/index.ts:383-389` → `worldStore.ts:155-170` 临时文件 + fsync + rename）。

### 3.2 估算表（11–13 条/人/天 × 7 天）

| 人数 | 条/人 | 增量 | world.json | 每次 checkpoint 重写 |
|---|---|---|---|---|
| 3 | 77–91 | 16.0–18.8 KB/人 ⇒ 48–57 KB | ~88–97 KB | ~10 KB/s |
| 8 | 77–91 | ⇒ 128–151 KB | ~168–191 KB | ~17 KB/s |
| 8（撞 `EPISODE_MAX=1200`） | 1200 | 248 KB/人 ⇒ **1.99 MB** | ~2.0 MB | **~200 KB/s + 每 10 秒一次 fsync** |

对照：同目录 `events.jsonl` 已经 76 MB（`ls -l`：76,026,426 B），但它是追加写；**world.json 才是被高频全量重写的那份**。

### 3.3 阈值建议

1. **`EPISODE_MAX = 1200`（`memory.ts:14`）现在等于没有上限**：7 天裁剪下要 >171 条/人/天才会撞到，
   与注释"防止异常世界把存档撑大"相反。建议降到 **150**（= 7 天 × 21 条/天 的 1.5 倍余量，封顶 ~31 KB/人）。
2. 加**字节预算**而不是条数：单角色 episodes 合计 > **64 KB** 或天数 > 7 时降到 5 天。
   条数阈值挡不住长 summary（`summarizeActivity` 直接抄 `trigger.text`，长度不受控，`memory.ts:33-34`）。
3. 运维红线：会话 `world.json` > **512 KB** 就该报警（= 8 人 7 天满额的回退线）。
4. 结构性选项（需要用户决定，不在本补丁范围内）：`docs/research/MEMORY.md:178` 原设计是
   `episodes/<agentId>.jsonl` 按天裁剪、append-only，明确写了"**不写进 world.json**（那是整世界快照，不该被历史撑大）"。
   本补丁把它塞进 `world.agents[].episodes`（`types.ts:296`），且代码注释（`memory.ts:2-5`）没有说明为什么推翻。
   要么改文档、要么改实现，不能两边都留着。

结论：**40 KB → 190 KB 本身不致命，致命的是"每 10 秒 fsync 重写"乘以"上限失效"**。
按 3.3 的第 1、2 条改，风险可控；不改，`EPISODE_MAX` 是个假保险。

---

## 4. 打分公式有没有偏置／不确定性？

### 4.1 权重失衡（实测数字）

`score = recency(0–1) + salience(0.3/0.6/0.9) + relevance×2(0–2)`（`memory.ts:99`）。
用已构建的 `lib/sim/memory.js` 跑（未构建，只是 import 现成产物）：

| 情形 | 分数 |
|---|---|
| 刚完成工单，无 query | 1.900 |
| 7 天前的"吃了顿饭"，无 query | 0.890 |
| 7 天前的"吃了顿饭"，query="吃" | **2.890** |
| 刚完成工单，query="吃" | 1.900 |

单 token 命中就 +2.0，大于 recency+salience 的上限 1.9 ⇒ **公式实际是"关键词命中优先"**。
如果设计意图是"近因优先、关键词只是加分"，把 `×2` 降到 `×0.6~0.8` 即可；如果意图就是关键词优先，那就在注释里说清楚，
别让 `memory.ts:86` 那句"近因 + 重要性 + 关键词命中"读起来像三者并列。

### 4.2 中文切分与注释不符（最大的不确定性来源）

`memory.ts:77` 注释写"中文按字、英文按词都行"，实际 `tokensOf`（`memory.ts:82-84`）只按非字母数字切分：
**中文整串不切**。实测：query `"补测试的工单"` 对 summary `"完成了工单「补测试」"` 命中 0（分数 1.900，毫无加成），
query `"补测试"` 命中 1（3.900）。也就是说召回质量完全取决于 query 措辞，长一句就漏。
反向还有：单字 query（"吃"、"人"）靠 `haystack.includes`（`memory.ts:96`）可以命中几乎所有条目。
`haystack` 还把 `episode.kind` 拼进去了（`memory.ts:93`），于是 query "work" 命中全部工作条目。

最小改法（不引入依赖）：query 先按字拆 unigram、再补 bigram，命中按长度加权；
同时把 `relevance` 权重降到 0.6，避免单字通杀。

### 4.3 其它（都小，但都是"承诺了没做到"）

- `with: []` 永远是空数组（`memory.ts:47`）：`Episode` 声明了"和谁"（`types.ts:225`），但没有任何地方填，`Activity` 上也没有参与者列表。要么删字段，要么先补数据源。
- `salience` 注释是 0–1 连续（`types.ts:227`），实现只有三档 0.3/0.6/0.9（`memory.ts:49`）；睡觉和吃饭同权重，而"睡了一觉"（`memory.ts:23`）在 Top-6 里几乎不携带信息。
- `AgentTraits` 注释说"只进打分权重"（`types.ts:195`），但 `scoreEpisode` 没有任何 traits 入参——概念与实现对不上（见 §5）。
- 确定性没问题：同分按 tick 降序兜底（`memory.ts:108`），`ageDays` 用 `Math.max(0,…)` 兜住未来 tick（`memory.ts:88`）。【推】同 tick 时靠 V8 稳定排序，仍确定。

---

## 5. 有没有违反"不新增无必要概念"／破坏老存档？

### 5.1 新增了两个纯死概念（证据：全仓 grep 只命中定义）

- `AgentTraits`（`src/domain/types.ts:196-201`）+ `Agent.traits`（`types.ts:292`）：**零读写**。
- `Commitment` / `CommitmentStatus`（`types.ts:203-216`）+ `Agent.commitments`（`types.ts:294`）：**零读写**。
- 注释还在承诺没实现的能力（"到期由内核裁决，不靠 prompt 记性"，`types.ts:205`）。
- 结论：违反"如无必要，勿增实体"。要么本轮删掉，要么明确"下一轮 M2 才用"并写进计划文档——不要以"反正是可选的"为理由先合。

### 5.2 注释错位（证据）

`types.ts:194` 的 `/** 角色：一个真实 subagent 在小镇里的投影。 */` 后面紧接 `types.ts:195` 的新 JSDoc，
于是这句注释挂到了 `AgentTraits` 上；真正的 `Agent`（`types.ts:231`）没有文档注释了。

### 5.3 老存档：兼容性没问题（证据）

- `episodes` / `traits` / `commitments` 都是可选字段（`types.ts:291-296`），代码用 `?? []` / `?? ''` 兜底（`memory.ts:62`、`memory.ts:31`）。
- 读档路径不整对象重建：`reconcile.ts:267/275/313` 都是 `{ ...agent, … }` 展开，不丢未知字段；`state.ts:176-284` 只校验场景/内容，不校验 agent 字段。
- 测试覆盖了这条：`test/memory.test.js:16-21`（老档没有 episodes 也能开始记）。
- 只读地跑了一次单测（**没有**执行 `npm run build`，直接 `node --test test/memory.test.js` 用的是 00:39 已构建的 `lib/`）：
  `tests 6 / pass 6 / fail 0`。

### 5.4 一个真 bug：新雇的人继承别人的一周记忆（证据）

`src/runtime/index.ts:257-268` 造新角色是 `{ ...template, id, name, role, state, station, targetStation, carrying, path, boundAgentId }`，
浅拷贝把 `template.episodes` **和 `template.commitments` 一起带过来**。
`appendEpisode` 会换新数组（`memory.ts:62-63`），所以两人不会互写，但新雇的人一出生就记得别人的一周。
修法一行：在 hire 那段同 `path` 一起显式清 `episodes: undefined, commitments: undefined`（`traits` 可继承，那本来就是模板属性）。

### 5.5 文案 bug（实测）

`summarizeActivity`（`memory.ts:30-37`）：`meet` 的 purpose 由 `step.ts:240` 设成 `'social'`，
而 `PURPOSE_TEXT.social = '和人聊了聊'`、`who = '和人一起'`，实测输出 **`"和人一起和人聊了聊"`**。
同一函数对工单活动输出 `"开始执行工单「补测试」"`（future tense）——记忆里的已完成事件读起来像还没发生。

---

## 6. 建议清单（按该不该在合并前做）

| 级别 | 事项 | 位置 |
|---|---|---|
| P0 | interrupted 达到时长门槛也记账（闸门 + 低 salience + "没做完："），否则失败/被打断的活永久消失 | `activity.ts:78`、`memory.ts:36,49` |
| P0 | `EPISODE_MAX` 1200 → 150（再加一条字节预算），否则这个上限没有保护作用 | `memory.ts:14` |
| P1 | 删 `AgentTraits`/`Commitment`，或写明"下一轮才用"；修 `types.ts:194` 注释错位 | `types.ts:194-216,291-294` |
| P1 | 新雇角色清 `episodes`/`commitments`，别继承别人的记忆 | `runtime/index.ts:257-268` |
| P1 | relevance 权重 ×2 → ×0.6~0.8，或明确写"关键词优先"；中文按 unigram+bigram 切 | `memory.ts:82-99,77` |
| P2 | `summarizeActivity`：meet 拼接重复；工单文案用"完成了…" | `memory.ts:30-37` |
| P2 | `syncActivities` 112-121 与 `endActivity` 66-79 重复清字段，可让 sync 直接调 endActivity，少一处真相 | `activity.ts:66-79,107-121` |
| P2（设计） | 模拟模式工单干活压根不建 Activity；要让"干活"进记忆，应在 `scheduler.ts:175-189` 起一张正式活动，而不是在 memory 里加第二套判断 | `scheduler.ts:175-189`、`interaction.ts:113-136` |
| P2（文档） | 与 `docs/research/MEMORY.md:178`「不写进 world.json」的决定冲突：改文档或改实现 | `MEMORY.md:178` |

## 7. 复核范围与未验证项

- 已做：`git show 92b46e9` 全量 diff；`src/` 内 grep（`endActivity`/`status = 'completed'`/`interrupted`/`activityKind`/`taskAttemptId`/`episodes`/`traits`/`commitments`）；读 `activity.ts`/`memory.ts`/`interaction.ts`/`idle.ts`/`scheduler.ts`/`movement.ts`/`runtime/index.ts`/`worldStore.ts`/`state.ts`/`reconcile.ts` 相关段；只读 fs 统计 `.xcity/world.json` 与 `lib/` 产物；`node --test test/memory.test.js`。
- 未做（按纪律）：任何构建（`npm run build`/`npm test` 会构建）、全量测试、启动/重启进程、改源码。
- 未验证（标【推】的地方）：live 世界一天真实的 episodes 条数；sim 模式工单是否真的零记忆——两者都要跑一次长仿真+读 `world.agents[].episodes` 才能定论。
- 体积数字来自真实存档与构造样本（207 B/条），不是估算；写入频率来自默认配置（100 tick × 100 ms），改过 `persistEveryTicks` 的部署要按比例重算。
