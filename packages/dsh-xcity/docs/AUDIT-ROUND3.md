# 冗余审计（第三轮）：H19–H26 引入/改动的东西（只读报告）

- **口径**：行号与命中数全部按 `c736775`（H26 提交，`git status --porcelain -- packages/dsh-xcity/{src,test,tools}` 为空）。本轮**只新增本文件**，`src/test/tools` 一行未改。
- **方法**：`rg` 统计 + 逐条读代码；两处"行为对不对"的判定用 `node --input-type=module -e` 直接跑已构建的 `lib/`（不落文件、不改仓库），复现命令见 §9。
- **判定用词**（与上轮一致）：**死代码** / **重复**（同一份逻辑抄 N 遍）/ **两处同义**（两处各自成立但表达同一件事）/ **仅测试用** / **命名与语义不符**。凡"真没人用"与"只被测试用"分列，不混。
- 上轮（`docs/AUDIT-ROUND2.md`，H10–H17）的结论**仍然有效**，本轮只做三件事：复核它的执行情况、审 H19–H26 的新增面、给可执行的减法清单。

---

## 0. 一句话结论

**H19–H26 的减法（`tools/lib/cli.mjs`、删 `BUSY_GRACE_TICKS`、字面量收敛）真的做了，但"删一半"的地方比"没删"更危险：**

1. 一次工单裁决**写两条情节记忆**（`step.ts:289` 与 `:317`），单次完工就能把心情顶到 `+1`、单次失败顶到 `-1`（实测，§2）。这是本轮唯一一处**行为层面的重复**，也是最该先修的。
2. 上轮 16 条清单**完全执行 6 条**（#1/#4/#5/#6/#7/#14）、**部分执行 1 条**（#8）、**未执行 9 条**；其中 **`idle.ts` 那两条死代码、`due-passed` 死分支** 逐字未动，已连续两轮被报。另有一条上轮结论**已经过期**（`dueAppointmentOf` 现在有跨文件生产调用点，按旧结论删 `export` 会编译失败）。
3. `tools` 迁移：21 个脚本里 13 个已接 `cli.mjs`；13 个 `verify-*` 里 **`verify-fairness` 是唯一漏网的**（`arg` 与 `cli.mjs` 逐字相同）。
4. `BUSY_GRACE_TICKS` 删干净了 `src`，但**留下 3 处"两个 grace"的过期叙述**（`commitments.ts:155-159` 注释被空行截断、测试注释、research 文档）。

---

## 0.1 审计期间工作树被并发改动（读行号前先看这段）

本报告的行号按 `c736775` 采集。收尾复核时工作树已被**另一处改动**修改（**不是我改的**，我只写了本文件）：

```
 M  packages/dsh-xcity/src/sim/memory.ts                    (+20 行：isNoteworthy + pruneEpisodes 排序)
 M  packages/dsh-xcity/tools/verify-commitment-memory.mjs   (+4 行：windowStart 按天对齐)
 M  packages/dsh-xcity/docs/PLAN-9H-THREE-RESIDENTS.md
 M  packages/dsh-xcity/docs/VERIFY-CHECKLIST.md
?? packages/dsh-xcity/test/memory-prune-priority.test.js     （新增测试，不是我的）
```

1. `memory.ts` 的插入点在 `:132` 之前（`pruneEpisodes` 上方）→ **本报告里 ≥`:132` 的 memory.ts 行号已按改后换算**（`recordTaskEpisode` 242→**262**、`recordActivityEpisode` 275→**295**、`writeDayDigest` 318→**332**、`describeTrim` 228→**248**、`salience: 0.6` 262→**282**、`INTERRUPTED_MIN_TICKS` 267→**287**）。`memory.ts:57/66-69/112-131/121/125` 这些 **< :132 的引用不受影响**。
2. `verify-commitment-memory.mjs` 把 `windowStart` 改成按天对齐（`(floor(tick/DAY_TICKS) - 7) * DAY_TICKS`）；我引用的 `:43`（`DAY_TICKS` 镜像）与 `:69-101`（by-id 投影）不受影响，`rg -n 'DAY_TICKS = 1440' tools` 仍是 4 份。
3. **这次改动正好落在我 §5.7(a) 指出的那条判据上**：`memory.ts:141-145` 新增的 `isNoteworthy()` 与 `plan-prompt.ts:108-112` 的过滤**逐字相同**（`kind === 'task' || 以 守约：/没做完： 开头`）。于是"什么算正经事"现在有 **3 份**：`memory.ts`（逐字）、`plan-prompt.ts`（逐字）、`life.ts:512-517` 的 `moodPolarityOf`（前两档相同、第三档用 `工单` 前缀）。→ §5.7(a) 的结论更强、改起来更便宜：`memory.ts` 那份已经是现成的、可以由 `index.ts` 注入给 bridge 的实现。

---

## 1. ★ 发现 1：一次工单裁决写两条记忆（`step.ts:289` + `:317`）· **重复**

### 1.1 两条通路

```ts
// src/sim/step.ts:285-296（外部裁决落地）
const owner = task.owner === null ? undefined : world.agents.find((a) => a.id === task.owner)
if (owner !== undefined && owner.carrying === task.id) {
  const activity = liveActivityOf(world, owner)
  if (activity?.taskAttemptId !== undefined && activity.taskAttemptId === task.attemptId) {
    endActivity(world, owner, command.kind === 'taskComplete' ? 'completed' : 'interrupted')  // :289
  }
  ...
// src/sim/step.ts:315-318
if (task.owner !== null) {
  recordTaskEpisode(world, task.owner, task.title, true, world.tick)   // :317
}
```

`:289` 的 `endActivity` 会经 `activity.ts:101` → `recordActivityEpisode`（`memory.ts:295`）写一条；
`:317` 的 `recordTaskEpisode`（`memory.ts:262`）再写一条。**同一 tick、同一张单、两条文案几乎一样。**

### 1.2 实测（不是"看起来像"）

```
$ node --input-type=module -e '<构造一个持有 task-1 活动、正在干活的 agent，step 送 taskComplete>'
OK episodes: ["工单「盘点小镇」","工单「盘点小镇」做完了"]
mood after one completion: 1
FAIL episodes: ["没做完：工单「盘点小镇」","没做完：工单「盘点小镇」工具不够"]
mood after one failure: -1
```

- 两条都是正向（`memoryMood` 的 `'工单'` 前缀判据在 `life.ts:515`），salience `0.9`（`memory.ts:121`）+ `0.6`（`memory.ts:282`）= 1.5 → 封顶 **+1**。
- 失败侧同理：`0.5 + 0.5` → **-1**。
- 后果 1（心情）：`life.ts:519-526` 明写"按求和…几件重要的坏事才压得住"，`memory.ts` 头注释也写"若把日常也算正向，心情恒为 +1，加权退化成常数偏置"。**现在一次事件就把它变成常数偏置**——`MEMORY_MOOD_WEIGHT = 0.1` 的 ±10% 对当天剩余时间恒为满幅。
- 后果 2（计划名额）：`plan-prompt.ts:108-122` 的"正经事优先 + 按 summary 去重"**挡不住**这一对——两条 summary 差一个后缀（`工单「X」` vs `工单「X」做完了`），去重键（`:121` 用 `episode.summary`）不同 → 一张单吃掉 `MAX_PLAN_MEMORIES = 5` 里的 2 个名额。
- 现有测试抓不到：`test/task-episode.test.js:60` 断言 `episodes.length === 1`，但它的世界 `activities: []`、agent 没有 `activityId`，**走的正是"没有 live 活动"的分支**，`:289` 进不去。

### 1.3 `recordTaskEpisode` 的存在前提已经过期（**命名与语义不符**）

`memory.ts:255-257`：

> 为什么单独一条通路：工单不是"活动"——它是外部（会话/团队）裁决的，`applyExternalTasks` **只改 task 状态、不产生 Activity**。

这句话现在是**错的**：`applyExternalTasks` 从 `step.ts:285-296` 起就会结束对应活动。所以 `recordTaskEpisode` 从"补一条每条工单都缺的记忆"退化成"**给已经写过一条的工单再写一条**"。

### 1.4 建议动作（二选一，别两边都留）

| 选项 | 改法 | 代价 | 我的倾向 |
|---|---|---|---|
| A | `step.ts:315-318` 前加"本次裁决是否已由活动侧写过"的判据（`activity?.taskAttemptId === task.attemptId` 时跳过 `recordTaskEpisode`） | 0 新字段、0 新参数；失败原因（`command.reason`）会丢 | **推荐**（先止血，文案损失可接受——`送入作业` 的失败原因在 task.failureReason 里） |
| B | 给 `endActivity` 加"不写记忆"的口径，把工单类活动的记忆唯一出口留在 `recordTaskEpisode` | 多一个参数（小概念）；文案统一成"做完了 / 没做完：+原因" | 更好读，但要动 `activity.ts` 的签名 |

**不要**选 C（在 `memoryMood`/`planMemories` 里去重）：那是拿下游补上游的洞，两处都要改，而且"同一件事写两条"这个事实还在存档里。

### 1.5 同一处还有一处判据冲突（**两处同义 + 语义不符**）

`activity.ts:125-129`：

```ts
if (live?.taskAttemptId !== undefined) {
  const task = world.tasks.find((row) => row.id === agent.carrying)
  if (task?.attemptId !== live.taskAttemptId || task.status !== 'in_progress') endActivity(world, agent, 'interrupted')
```

任务"做完了"（`status === 'done'`）也走 `interrupted`。纯模拟完工（`interaction.ts:113-135` 把 `task.status` 设成 `done`，**不结束活动**）随后由本行收尾，实测：

```
task.status = done
episodes = [{"k":"work","s":"没做完：工单「盘点小镇」","w":0.5}]
```

**一件做完的工单在记忆里写"没做完"**。是否在生产路径可达取决于该任务活动是否带 `taskAttemptId`（只有 `index.ts:371` 那条投递路径会带），所以判 **风险中**，不是零——但判据本身该按 `task.status === 'done' | 'failed'` 分两种状态，而不是一律 `interrupted`。

---

## 2. ★ 发现 2：上一轮清单的执行情况（`AUDIT-ROUND2.md` §12 的 16 条）

| 上轮 # | 项目 | 现状 | 证据（本轮行号） |
|---|---|---|---|
| 1 | 删被 `MISS_GRACE` 覆盖的分支 | **已执行** | `rg -n 'BUSY_GRACE' src` = 1 条（`:190` 只剩历史说明）；`rg -n 'isBusy\|currentActivityOf'` 在 commitments.ts 已无 |
| 2 | `idle.ts` 不可达三元 | **未执行** | `idle.ts:183` 仍是 `home === null ? null : idleSlotAt(...)`，`:173` 已 `continue` |
| 3 | `idle.ts` 不可达守卫 | **未执行** | `idle.ts:92` `if (index < 0) return base`；`:84` 已排除 `base === null`，`agent` 必在 `sharing` 里 |
| 4 | `plan-prompt.ts` 用 `DAY_TICKS` 替字面量 | **已执行** | `rg -n '1440' src/bridge/plan-prompt.ts` = 2 条，只剩 `:14` 注释与 `:38` 定义 |
| 5 | `index.ts` 用 `DAY_TICKS` | **已执行** | `rg -c '1440' src/index.ts` = 0；`:450` 是 `day * DAY_TICKS` |
| 6 | `createTurnCost()` 去自传默认值 | **已执行** | `index.ts:394` `createTurnCost()` |
| 7 | sim 内改用 `DAY_TICKS` | **已执行** | `rg -n '1440' src/sim/life.ts` = 2 条：`:10` 注释 + `:79` `MEMORY_MOOD_WINDOW`（语义独立，上轮 §11 已判保留）；`initiative.ts`/`day-summary.ts` 的 1440 只剩注释 |
| 8 | tools 常量改 import | **部分/改判** | `measure-tokens` 已无 1440；`measure-snapshot.mjs:17`、`verify-memory-chain.mjs:50` 仍在，且 H21 又**新增第 4 份**（`verify-commitment-memory.mjs:43`） |
| 9 | `plan-prompt` 死分支 `due-passed` | **未执行** | `:208` 类型、`:311` 文档、`:395-402` 分支、`:423` TODO 全在；`dueTickOf:299` 恒 `> nowTick` |
| 10 | persona 两处矛盾 | **未执行** | `plan-prompt.ts:133`（"不下性格判断"）vs `index.ts:455-458`（塞 role+traits） |
| 11 | `loadToday` 提到循环外 | **未执行** | `scheduler.ts` 仍有 2 处调用（`:139`、`:237`） |
| 12 | `owner-lock` 测试补可区分断言 | **未执行** | `test/owner-lock.test.js:42-43` 仍写 `.owner.lock.tmp` 后断言缓存 |
| 13 | 去 5 个 `export` | **未执行** | `memory.ts:15/54/63/287` 等仍在 |
| 14 | `tools/lib/cli.mjs` | **已执行** | 文件在（63 行），13 个脚本 import（§4） |
| 15 | `owner-lock.ts:85`（现 `:95`）不可达 | **未执行** | `acquireOwnerLock` 有 `byDir` 缓存（`:48-56`），`:95` 的 `pid === process.pid` 只能靠 pid 复用命中 |
| 16 | bridge 侧 1440 收敛 | **未执行** | `bridge/daily-plan.ts:12`、`plan-prompt.ts:38`、`memory-context.ts:31` 三份仍在 |

### 2.1 **一条上轮结论已经过期，照抄会编译失败**

`AUDIT-ROUND2.md:306` 判 `dueAppointmentOf`（当时 `life.ts:109`）"内部化 / 去 `export`"，理由是"生产调用点在本文件 `:257`"。
现在它**有跨文件生产调用点**：`src/sim/activity.ts:17`（`import { dueAppointmentOf } from './life.js'`）+ `:141`（"赴约临近就提前收手"）。

`rg -n 'dueAppointmentOf' src` = 2 处调用（`life.ts:445`、`activity.ts:141`）+ 1 定义 `life.ts:139`。
→ **必须保留 `export`**。同一张表里 `memoryMood`/`memoryWeightOf` 的"去 export"仍然成立（`life.ts:529`/`:549`，生产调用只在本文件）。

### 2.2 `BUSY_GRACE` 删了 `src`，但留下 3 处过期叙述（**死文档**）

| 位置 | 现状 | 建议 |
|---|---|---|
| `src/sim/commitments.ts:155-159` | `:155` "**两个宽限**都用完"；`:157` "**两个 grace**，理由不同，别混："；`:158` 是一个**真空行**（把 JSDoc 段落截断），`:159` 只剩 `MISS_GRACE` 一条 | 改成一个宽限的叙述，把 `:158` 的空行补 ` *` |
| `test/commitments-world.test.js:37` | 注释仍写"先走忙碌宽限（`BUSY_GRACE_TICKS=60`），再走失约宽限"；`:32` 测试名仍是"两个宽限都过了" | 改成"宽限用完" |
| `docs/research/MEMORY-DECISION.md:191` | "已经区分了'没证据'和'人忙着'，**保持这个区分**，不要合并" —— 这条建议现在与代码相反 | 删或加"（已合并，见 R2 §1）" |

`rg -n 'BUSY_GRACE' --glob '!node_modules' .` = 6 条：`src` 1 条（历史说明，**应该留**）、`test` 2 条、`docs` 3 条。

---

## 3. `src/sim/intent-stats.ts` + `life.ts` 的 `attributed()` 包装

### 3.1 结构判定：**保形正确，两处需要说明**

- `attributed()` 定义 `life.ts:398-401`，调用 **11 处**（`rg -c 'attributed\(' src/sim/life.ts` = 12，减去定义 1）：`:404 :405 :417 :419 :427 :428 :434 :479 :481 :486 :488`。
  → 任务卡写"10 处 return"，实际是 **11 处**（卡片数字需更新）。
- 结构保证成立："ok 与 gap 互斥"由 `options.some(intent !== null)` 一处决定，不靠调用方自觉。**保留**。
- **但有 4 处 gap 实参不可达**（**命名与语义不符**）：`:419`、`:428`、`:481`、`:488` 传进去的数组字面量里 `intent` 一定是对象 → `some()` 恒真 → 那 4 个字符串永远只是"占位"。
  ``:434` 是 `intent: station === null ? null : {...}`，gap 可达，**不能删**。
  建议：**不改代码**（改成可选参数会让签名多一个分支），只在 `:398` 的注释里补一句"有意图的出口传 gap 只为对称，不会被记"。零风险、免误解。

### 3.2 `no-social-station` 恒为 0 · **死出口（有意保留，注释已声明）**

`rg -n 'no-social-station' src test tools` = 3 条：`intent-stats.ts:37`（类型）、`:57`（常量表）、`verify-intent.mjs:60`（镜像表）。**没有任何 `attributed('no-social-station', …)`**。
`intent-stats.ts:29-36` 已写明"这一格恒为 0 是预期"，所以它不是漏接线，是**已知的空格**。
→ 建议：**不动**（删了要同步改 3 处 + 快照形状）。但要知道：`verify-intent` 每次都会打印一行恒 0，读报告的人会当成 bug 去查——可以在 `verify-intent.mjs:60` 那行加注释"恒 0 是预期"。

### 3.3 `reset()` · **仅测试用**（且文档承诺的用法不存在）

`intent-stats.ts:76` 的注释是"归零（**测试与环境切换用**）"。
`rg -n '\.reset\(' src --glob '*.ts'` = **0 条** → 生产路径没有任何"环境切换时归零"。
实际用法只有 `test/intent-stats.test.js:56`（每个用例前重置单例）、`:96`（测 reset 本身）。
→ 建议：**保留**，把注释里的"环境切换用"删掉（它不存在；世界重建靠 `verify-intent.mjs` 的 `delta` 口径，见该文件 `:15-17`）。

### 3.4 第三份"进程内累计计数 + 下发 `/api/world`"（**两处同义**，但这次有消费方）

`planStats`（`runtime/plan-stats.ts`，`index.ts:390` 建、`:1493` 下发）、`turnCost`（`turn-cost.ts`，`:394`/`:1495`）、`intentStats`（`index.ts:41/1497`）三者形状同构（`xxx: () => ({ ...snapshot() })`）。
消费面差异（`rg` 命中，`web/` 全 0）：

| 观测 | src 命中（写点+类型+下发） | web 读 | test | tools 读 |
|---|---|---|---|---|
| `planStats` | 13 | 0 | 0 | **0** |
| `turnCost` | 6 | 0 | 0 | 1（`measure-tokens`） |
| `intentStats` | 7 | 0 | 3 | **9**（`verify-intent.mjs`） |

→ 判定：**三者里只有新的 `intentStats` 有验证闭环**。这不构成"删 planStats"的理由（上轮 §11 已判它给 `curl`/诊断用），但构成一条纪律：**下一个同类观测必须自带一个读它的工具**，否则就是第四个"只写不读"的字段。

---

## 4. `tools/lib/cli.mjs` 与 13 个脚本的迁移结果

### 4.1 迁移面（先给数）

- `tools/*.mjs` 共 **21** 个；`import { … } from './lib/cli.mjs'` 的 **13** 个：`measure-snapshot`、`measure-tokens`、`verify-{commitment-memory,commitments,cost,intent,kept-rate,memory-chain,plan-memory,scale,tasks,unseated,with}`。
- `cli.mjs` 8 个导出**全部有用户**（口径：在 13 个 import 了 cli.mjs 的文件里数符号，`rg -l "from './lib/cli.mjs'" tools/*.mjs | xargs rg -l '\b<符号>\b'`）：
  `arg` **13**、`baseUrl` 9、`getJson` 9、`emit` 4、`fail` 2、`failVerify` 9、`sleep` 5、`percentile` 3。→ **没有死导出**，这一点做得干净。
  （注：全仓库`rg -l 'arg'` 会数到 19 个文件——多出来的 6 个是**本地副本**，见 §4.2/§4.3。别拿那个数当使用量。）

### 4.2 ★ `verify-fairness.mjs` 是唯一漏网的 HTTP 核对脚本 · **重复**

| 位置 | 与 `cli.mjs` 的关系 | 证据 |
|---|---|---|
| `verify-fairness.mjs:23-29` `arg()` | **逐字相同**（去掉分号后 `md5 8afde65e` 两边一致） | `norm(a)===norm(b) → True` |
| `verify-fairness.mjs:55` `sleep` | 逐字相同 | 同上 |
| `verify-fairness.mjs:49-53` `getJson()` | **唯一差异**：闭包 `REQUEST_MS` 而不是收参数 `(url, timeoutMs)` | `cli.mjs:30` 是 `(url, timeoutMs)` |
| `verify-fairness.mjs:58` `VERIFY FAIL` 字面量 | `cli.mjs:49` `failVerify` 已有 | `rg -c 'VERIFY FAIL' tools/*.mjs` → 只有 fair 1 条 |

→ 建议动作：`import { arg, failVerify, getJson, sleep } from './lib/cli.mjs'`，`getJson(url, REQUEST_MS)` 调用点改一下。**删 30 行，零行为变化**（这是 cli.mjs 的收尾，不是新实体）。

### 4.3 另外 **2** 处 `arg()` 副本（离线脚本，可留）

`verify-bridge.mjs:20-26`、`person-lab.mjs:17-23` —— 两段与 `cli.mjs:17-22` 逐字相同（各 7 行）。
（`rg -n 'function arg\(' tools/*.mjs` = **3** 条：上面 2 条 + `verify-fairness.mjs:23`，见 §4.2。`aw-*`/`smoke-e2e` 用的是另一套 `args` 解析，不算副本；`measure-baseline.mjs` 根本没有 `arg`，它的 `1440` 在 `:19 :26 :38`。）
两者都 import `../lib/*.js`（已构建内核），**可以**改成 `import { arg } from './lib/cli.mjs'`——cli.mjs 只依赖 `process.argv`，没有副作用。
→ 建议：低优先，一起改（每文件 1 行 import，删 14 行）。

### 4.4 内核常量镜像：从 3 份变成 4 份，但**这次是有意的**

`rg -n 'DAY_TICKS = 1440'` 在 tools 里有 4 份：`measure-snapshot.mjs:17`、`verify-memory-chain.mjs:50`、`verify-kept-rate.mjs:57`、**`verify-commitment-memory.mjs:43`（H21 新增）**。
判 **保留**，理由是**分层**而不是懒：

- `verify-*`：镜像常量是**独立性要求**——`verify-intent.mjs:22-24` 把 `available()` 的六个条件"照着抄一遍当独立口径"，`verify-with.mjs:19` 明写"镜像常量"。核对脚本 import 内核常量，等于让"核对的尺"跟"被核的对象"同源。
- `measure-*`：`measure-snapshot.mjs:2-3` 的定位是"只读 `world.json`，不碰内核"，所以它的 `DAY_TICKS`/`BUDGET_BYTES` 也是镜像。
→ 结论：**不建议把 tools 的常量改成 import**（上轮 §12 #8 的一半建议，本轮改判）。真正该做的是**在 `cli.mjs` 头注释里写明"内核常量不属于本文件"**——它已经写了（`:12-13`），够了。

---

## 5. 逐条审计（按任务卡的对象顺序）

### 5.1 `life.ts` 的 `waitOption` / `pickStation` / `freeStation` 拆分

**判定：拆分本身没有冗余（`freeStation` 是 `pickStation` 的真委托，`:205-212`），但同一函数体里重写了一遍 `districtOfPeer`（**重复**）。**

```ts
// life.ts:221-225（已有）
function districtOfPeer(world: World, peer: Agent): string | null { … }

// life.ts:277-280（`socialStationId` 内部又写了一遍）
const districtOf = (row: typeof peer): string | null => {
  const id = row.station ?? row.targetStation
  return id === null ? null : world.stations.find((item) => item.id === id)?.district ?? null
}
```

- 证据：`rg -n 'districtOfPeer|const districtOf = ' src/sim/life.ts` = `:221`（定义）、`:250`（调用）、`:277`（**重写**）。两段逐行同义，`typeof peer` 与 `Agent` 是同一个类型。
- 建议动作：`:277-280` 删成一个 `const district = districtOfPeer(world, peer)`（`:281` 已经叫这个名字，改 1 行）。零风险。
- 顺带：一次"抢不到座"决策里 `pickStation` 会跑两遍（`:411` 的 `freeStation` 落空 → `:417` 的 `waitOption` 再扫一遍同样的 `capabilities+filter`，只多一个 vacancy 条件）。**判可接受**：两遍都是 O(站点数)，清晰度值这个钱，不要合并成一个返回 `{station, free}` 的函数（那才是加法）。

### 5.2 `waitSpot`（`life.ts:328-344`）与 `spreadHangout`（`idle.ts:80-98`）与 `paceGoal`（`idle-behavior.ts:132-150`）

**判定：三份"绕锚点取一个可走点"，其中 `waitSpot` 与 `paceGoal` 是同一段循环（**重复**），`spreadHangout` 是另一件事（**保留**）。**

| | 起点方向 | 半径 | 失败 |
|---|---|---|---|
| `paceGoal` `:142-148` | `rng.int(6)` → 6 个 60° 扇区 | `radius*(0.5+0.5*sqrt(rng.next()))` | 返回 `home` |
| `waitSpot` `:335-342` | `rng.next()*2π` → 同样 6 个 60° 扇区 | `2+rng.next()*4`（固定） | 返回 `null` |
| `spreadHangout` `:93-97` | 黄金角 137.508°×排序下标 | `1.1+1.1*sqrt(index)` | 返回 `base` |

- `waitSpot` vs `paceGoal`：**循环骨架逐行同义**（`for attempt<6` + `angle = start + attempt*π/3` + `cos/sin` + `isWalkable` 试探），差异只有"半径怎么抽"和"失败返回什么"。`life.ts:20` 已经 import 了 `idleSlotAt`，同模块取一个 `ringPoint(rng, home, radius, walkable): {x,z}|null` 不需要新文件。
- `spreadHangout` **不要合并**：它的语义是"多人共用同一个歇脚点时才错开，一个人时保持原语义"，而且 `base === null` 必须返回 null（`idle.ts:82-84` 的注释解释了这与 R69 静默卡死的关系）。
- 建议动作：**收益约 6 行，倾向不动**（把"半径抽样"参数化会引入一个回调参数，属于加法）。记为"已知的三份同形，各自口径有据"。

### 5.3 `idle.ts`：两处死代码（上轮已报，仍未执行）+ 一处同义谓词

| 位置 | 判定 | 证据 | 建议 |
|---|---|---|---|
| `idle.ts:183` | **死代码** | `:173-182` 的 `if (home === null) { … continue }` 已把 null 排除；`home` 是 `const`，全文件只有 `:172` 一次赋值 | 删成 `const slot = idleSlotAt(behaviors, world.seed, agent.id, world.tick)` |
| `idle.ts:92` | **死代码** | `sharing` 的过滤条件只比 `hangout` 坐标（`:87-89`），`base` 就是 `agent.hangout`（`:81`）→ `agent.id` 必在 `sharing` 里 → `index >= 0` | 删 `:92`（`:96-97` 那条 `nav === null` 的 fallback **真能进**，别一起删） |
| `idle.ts:157` | **两处同义** | `:142` 定义了 `const ambientWalking = agent.state === 'walking' && agent.targetStation === null`，`:157` 又把同一串字面量写了一遍 | 用 `ambientWalking` 替换（`:157` 在定义之后，可用） |

### 5.4 `memory.ts` / `commitments.ts`：Episode 字面量 4 份、`spanOf` 3 份

**(a) Episode 的字段组装写了 4 遍（**重复**）**：`memory.ts:122-130`（`episodeOfActivity`）、`:275-283`（`recordTaskEpisode`）、`:338-346`（`writeDayDigest`）、`commitments.ts:235-243`（`recordSettledEpisodes`）。四处都是 `{ tick, day: dayOf(tick), kind, summary, with, placeId, salience }`，只有 `kind/with/salience` 不同。
→ 建议：**不动**。抽一个 `makeEpisode(agent, {...})` 省 4×4 行，但会把"每条记忆的语义"藏进一个工厂的默认值里；这四处的差异正是要读的东西。记入保留清单。

**(b) `spanOf` 3 份（**重复**）**：`memory.ts:66-69`、`commitments.ts:322-327`、`tools/verify-commitments.mjs:109-113`。
内核那两份的差别只有一处兜底：`memory.ts:67` 是 `… : activity.endsAt ?? endedAt`，`commitments.ts:324` 没有那个 `?? endedAt`。
`Activity.endsAt` 是必填（`domain/types.ts:339`），所以**类型上没问题**；风险只在"老存档/外部写入缺 `endsAt`"时 `Math.max(start, undefined) = NaN` → 证据窗口恒不成立 → 偏向判 missed。
→ 建议：低优先，把 `commitments.ts:322-327` 删掉、从 `memory.ts` 导出 `spanOf`（同层依赖已存在：`commitments.ts:17` 已经在 import `memory.js`）。**注意这是"导出内部化"的反向动作**，与 §2 表格里"去导出"的方向相反，先确认真要做。

**(c) `recordSettledEpisodes` 的位置与调用点**
任务卡把它写在 `memory.ts`，实际在 **`commitments.ts:218-245`（私有）**，调用 3 处：`:137`（`keepCommitment`）、`:183`（kept）、`:197`（missed）。
- `:183`/`:197` 在 `settleCommitments` 里，每次裁决只走一条，**幂等靠状态机**（`:209-210` 注释），正确。
- `:137` 所在的 `keepCommitment`（`:129`）**生产 0 调用**（`rg -n -w 'keepCommitment' src` = `:10` 注释、`:129` 定义、`:135` 注释；测试 6 条）。上轮 §11 已判"产品决策挂起，保留，不要再当新发现报"。本轮的补充只有一句：**若最终决定删 `keepCommitment`，`:137` 这条调用点跟着走，`recordSettledEpisodes` 的入参就没必要留 3 个形态。**

**(d) `trimToSnapshotBudget` / `SNAPSHOT_BUDGET_BYTES`：唯一口径，判**保留**（与上轮 §5.3 一致，本轮复核未变）**
两个写盘点共用一份：`runtime/index.ts:185`、`state.ts:351`；`describeTrim` 的措辞只有一处（`memory.ts:248`）。

### 5.5 `activity.ts` 的 `activityKeepFor` + `dueAppointmentOf` import

- `activityKeepFor`（`:37-39`）**只有一个生产调用点** `:185`（环形裁剪），测试 `test/activity-ring.test.js:53-56` 钉住 4 个数。**保留**：`max(64, 24×人数)` 是两段语义（下限 vs 扩容），`types.ts:511` 的注释也指向它。
- `activity.ts:17` 的 `import { dueAppointmentOf } from './life.js'` **不是冗余**：它支撑 `:135-144` 的"赴约临近就提前收手"，与 `life.ts:445` 的"该不该去"是两个不同的决定（怎么收手 / 去哪里）。依赖方向也干净（`life.ts` 不 import `activity.ts`，无环；`:16` 的注释已声明）。
- 真正的问题在 `:127`（见 §1.5）。

### 5.6 `runtime/turn-cost.ts`、`runtime/owner-lock.ts`

**turn-cost**
- `index.ts:394` 已改成 `createTurnCost()`（上轮 #6 执行）→ `TurnCostOptions.warnInputChars`（`:48-51`）现在**只有测试在用**（`test/turn-cost.test.js:34`、`:47` 传 100）。`resolveWarnInputChars` 的 3 个非法值分支（`:71`）也因此只有测试覆盖。
  → 判 **仅测试用**，但**保留**：这是"把阈值调低来测"的唯一手段，删了测试得跑 12 万字符。记入保留清单。
- `DEFAULT_WARN_INPUT_CHARS`（`:21`）是测试与生产的共同锚点（`test/turn-cost.test.js:73-78`）。保留。

**owner-lock**
- `:65` `mkdirSync(stateDir, { recursive: true })`（R526）：**保留，不是重复**。它不是"和 `worldStore` 抢着建目录"——`worldStore` 的 `mkdir` 在**写**的时候才发生（`store/worldStore.ts:156/180/194/201`），而 `acquireOwnerLock` 在 `index.ts:331` 的插件初始化时就要 `openSync(…, 'wx')`。顺序不同，谁也不能替谁。删了会复现 `owner-lock.ts:59-63` 描述的那次"静默退让"。
- `:39-47` **两段相邻的 JSDoc 挂在同一个函数上**（**死文档**）：`:39-42` 说的是"拿锁…持有者已死时接管一次"（那是 `acquireOnce` 的行为），`:43-47` 说的是进程内缓存；只有后者是 `acquireOwnerLock` 的注释，前者是重构残留。`rg -n '/\*\*' src/runtime/owner-lock.ts` = 5 段，`:39` 那段没有对应实体。
  → 建议：把 `:39-42` 并进 `acquireOnce`（`:58`）之上或直接删（`:58-63` 已有更详细的现场说明）。零风险。
- `:95` `if (pid === process.pid) return { owned: true, ownerPid: pid, release: noop }`：上轮 #15 未执行；`byDir` 缓存（`:48-56`）之后只能靠 pid 复用命中。**保留待定**（它有 `release: noop` 的副作用：命中的锁文件永远不会被删）。

### 5.7 `bridge/plan-prompt.ts` 的 `planMemories`

**(a) "正经事优先"的判据与 `life.ts` 的 `moodPolarityOf` 是同一件事的两种写法（**两处同义 → 收尾时变成三处**）**

```ts
// plan-prompt.ts:108-112
const noteworthy = candidates.filter((episode) =>
  episode.kind === 'task' || episode.summary.startsWith('守约：') || episode.summary.startsWith('没做完：'))

// life.ts:512-517
if (episode.summary.startsWith('没做完：')) return -1
if (episode.summary.startsWith('守约：')) return 1
if (episode.summary.startsWith('工单')) return 1
```

- 前两档一致，第三档**口径不同**：`life` 认"summary 以 `工单` 开头"，`plan` 认 `kind === 'task'`。
- **审计收尾时同行的人又加了第三份**：`memory.ts:141-145` 的 `isNoteworthy()`（修剪时"琐事先丢"）与上面 `plan-prompt` 那段**逐字相同**（见 §0.1）。所以现在两份逐字 + 一份分叉（`life.ts`）。
- 分叉是**真实可达**的：活动带 `task` 触发时 `episodeOfActivity` 写 `kind = activity.purpose ?? activity.kind`（`memory.ts:125`），summary 是 `工单「X」`（`memory.ts:57`）——对 `moodPolarityOf` 是正向，对 `planMemories` **不是正经事**。也就是 §1 那对的第二条（kind `work`、summary `工单「X」`）**进不了计划的优先档**，而它偏偏是 salience 0.9 的那条。
- 为什么当初各写一份：`plan-prompt.ts:80` 写明"bridge 不许值 import 模拟内核"，所以不能直接复用。
- 建议动作（**不新增实体，用已有注入口**）：`planMemories` 已经从外面注入 `selectEpisodes`（`:81-85`）——把"哪些算正经事"也做成注入的回调，`index.ts:464` 那侧接 `memory.ts` 的 `isNoteworthy`（它现在**必须**从 `memory.ts` 导出了，否则只能继续各写一份）。这样 bridge 仍然不认识内核，判据只剩一份 + `life.ts` 那档语义不同的极性判断。
  → 若不想动，至少把 `:106-107` 的注释改成"与 `life.ts` 的 `moodPolarityOf` 同族但第三档口径不同"，否则下一个人会以为两处等价。

**(b) 注释里的 3 与实际 5（**命名与语义不符 / 死文档**）**
`:106` 写"日常琐事…只在**不够 3 条**时补"，`:30` 是 `MAX_PLAN_MEMORIES = 5`，`:125` 的 `break` 也按 5。→ 改 `:106` 的 "3" 为 `MAX_PLAN_MEMORIES`。

**(c) `k: MAX_PLAN_MEMORIES * 4`（`:115`）· 无解释的魔数**
第二次 `selectEpisodes` 取 4 倍只为了"去重后还剩够"。`rg -n 'MAX_PLAN_MEMORIES \* 4'` = 1 条，注释（`:101-107`）没提这个 4。
→ 建议：加半句注释（"按 4 倍取是因为去重会丢掉重复文案，留余量"），或改成 `MAX_PLAN_MEMORIES + 8` 这类有理由的表达。**不改行为**。

**(d) 两次 `selectEpisodes` 的第二次在"活多"时是白跑**
`noteworthy` 若凑满 5 条唯一文案，`:119-126` 的循环在 `picked.length >= 5` 就 `break`，`:115` 那次对全量候选的排序**一点没用上**。代价是一次 `O(n log n)`（人均 44–68 条），可忽略。→ **不动**，只记录。

---

## 6. 判为「保留」的（写下来，防止下一轮被当冗余砍掉）

| 位置 | 看起来像冗余 | 为什么不是 |
|---|---|---|
| `owner-lock.ts:65` `mkdirSync` | 和 `worldStore` 的 4 处 `mkdir` 重复 | 时序不同：锁在**插件初始化**（`index.ts:331`），存档在**写盘**；删了复现 R526 的静默退让 |
| `activity.ts:17` import `dueAppointmentOf` | 同一判据两处调用 | 一个回答"该不该去"（`life.ts:445`），一个回答"手上的活要不要提前收"（`:135-144`）；无环 |
| `tools` 的 `DAY_TICKS` 镜像 ×4 | 内核常量抄 4 遍 | `verify-*` 的独立性要求（`verify-with.mjs:19`、`verify-intent.mjs:22-24`）；`measure-*` 定位是"不碰内核"（`measure-snapshot.mjs:2`） |
| `planMemories` 的去重循环（`:117-127`） | 与 `selectEpisodes` 的 Top-K 重复"挑" | 去重键是 `summary`（跨天同一件事），`selectEpisodes` 只排序不去重 |
| `attributed()` 包装（`:398`） | 每个 return 套一层 | 它把"ok/gap 互斥"变成结构保证；拆掉就退回"调用方自觉" |
| `trimToSnapshotBudget` 两个调用点 | 两个写盘点各裁一次 | 同一份裁剪 + 同一句 `describeTrim`（`memory.ts:246` 注释：措辞只有一处） |
| `turn-cost` 的 `options` | 生产 0 传参 | 测试靠它把阈值降到 100（`test/turn-cost.test.js:34/47`） |
| `intent-stats.no-social-station` | 恒 0 的键 | `intent-stats.ts:29-36` 已声明"恒 0 是预期"，删了要动快照形状 + `verify-intent` |
| `verify-commitments`/`verify-kept-rate`/`verify-commitment-memory` 三份 by-id 投影 | 三份近逐字的 25 行 | 见 §7：合并会把 3 个退出码揉成一个，且它们是"同一份数据的三个不同断言" |
| `memory.ts` 的 4 处 Episode 字面量 | 可抽工厂 | 抽了会把每条记忆的语义藏进默认值；差异（`kind/with/salience`）正是要读的 |

---

## 7. 建议合并的脚本（单独一节）

先把重叠**量化**（`rg` + 逐字比对，全部按 `c736775`）：

| 重叠物 | 份数 | 位置 | 是否逐字 |
|---|---|---|---|
| "承诺按 id 收成一条约定"（双方两行 → 一个裁决单位） | **3** | `verify-commitments.mjs:145-177`、`verify-kept-rate.mjs:103-135`、`verify-commitment-memory.mjs:69-101` | 前两份**近乎逐字**（连 `merged/parties/statuses` 变量名都一样，只差 `to`/`due` 改名） |
| "证据地平线 `horizonOf`" | **2** | `verify-with.mjs:95-101`、`verify-kept-rate.mjs:92-98` | **逐字相同**（连注释"某 agent 的活动环还看得见的最早 tick"都一样） |
| "同地点 + 时间重叠" | **3** | `verify-commitments.mjs:126-138` `meetHit`、`verify-kept-rate.mjs:183-199` `coPresent+meetOverlap`、`verify-with.mjs:89-91` `overlaps` | 同义不同形（都带窗口裁剪） |
| kept/missed 分布 | **3** | `verify-commitments`（distribution）、`verify-kept-rate`（counts/keptRate）、`verify-memory-chain.mjs:262-277`（`kept>=1 && missed>=1`） | memory-chain 那条是 kept-rate 的**真子集** |

### 逐对结论（含"能不能少一个入口"）

| 候选合并 | 断言是否同一件 | 合并后能少入口吗 | 代价 | 结论 |
|---|---|---|---|---|
| `verify-commitments` + `verify-kept-rate` | **不是**：一个是"裁决对不对"（抽样找证据），一个是"兑现率是多少、为什么没成" | **能少 1 个**（`--rate` 开关或默认两段输出） | ① 退出码语义不同（前者 `suspicious` 空，后者"算得出来"即可，阈值要显式 `--target`）；② 取样口径不同（随机抽样 vs 全窗统计）；③ 两份 40 行的表头文档要揉成一份 | **不做**。它是本轮最像"该合并"的一对，但合并后**只是把两份文件装进一个文件**，重复的 by-id 投影一行也没少 |
| `verify-commitments` + `verify-commitment-memory` | **不是**：前者核"裁决的证据对不对"，后者核"裁决有没有写进双方各自的记忆" | **能少 1 个** | 前者已有 4 条判定，合进去变 6 条；失败卡点要分两段（现在是 `suspicious` / `memory-missing` 两个词） | **不做** |
| `verify-memory-chain` 的 `[3]`（`:262-277`）并入 `verify-kept-rate` | 是（kept/missed 至少各一条） | **不少**（memory-chain 还有 [1] 日小结、[2] 抽查要留） | 删了要改 H7 的验收口径（`verify-memory-chain.mjs:15` 是照着验收卡写的） | **不删**，只在 kept-rate 文档里注明"这条也在 memory-chain 报" |
| 抽出 `tools/lib/evidence.mjs`（by-id 投影 + horizonOf + 同地点重叠，约 45 行） | — | 不少入口 | **新增 1 个文件 + 1 个概念**（`cli.mjs:12-13` 明确把"世界快照的领域形状"排除在外，抽它等于改这条边界）；且会消掉"三份独立重算"的复核价值——它们互相验算的前提是**各写一遍** | **不做**（若你要收敛，这是唯一值得评估的一条，但它是加法不是减法） |

**一句话**：`verify-*` 这一层的"重复"是**设计成本**，不是债。合并能少 1~2 个入口，但一行重复逻辑都消不掉，还会把 3 个独立退出码揉成 1 个（上轮 §8 已明确不建议）。真正该收敛的是 §4 的**迁移漏项**（`verify-fairness`），那是"同一段代码抄两份"，删得掉。

---

## 8. 删除 / 合并清单（风险从低到高）

| # | 风险 | 动作 | 位置 | 一句话理由 |
|---|---|---|---|---|
| 1 | **零** | 删 `idle.ts` 不可达三元 | `src/sim/idle.ts:183` | `:173` 已 `continue`，`home` 是 `const`；上轮 #2，未执行 |
| 2 | **零** | 删 `idle.ts` 不可达守卫 | `src/sim/idle.ts:92` | `agent` 必在 `sharing` 里（`:81/:87-89`）；上轮 #3，未执行 |
| 3 | **零** | `verify-fairness` 接 `cli.mjs` | `tools/verify-fairness.mjs:23-29/49-55/58` | `arg`/`sleep` 逐字相同、`getJson` 只差收参数；删 30 行，行为不变 |
| 4 | **零** | `idle.ts:157` 用 `ambientWalking` | `src/sim/idle.ts:157` | 与 `:142` 是同一串字面量 |
| 5 | **零** | `life.ts:277-280` 用 `districtOfPeer` | `src/sim/life.ts:277-280` | 同一文件里重写了一遍（`:221`），逐行同义 |
| 6 | **零** | 删 `owner-lock` 孤儿 JSDoc | `src/runtime/owner-lock.ts:39-42` | 两段 JSDoc 挂同一函数，前一段描述的是 `acquireOnce`（`:58-63` 已有更详细的） |
| 7 | **零** | 改 3 处"两个 grace"叙述 + 补 `:158` 的 ` *` | `src/sim/commitments.ts:155-159`、`test/commitments-world.test.js:32/37`、`docs/research/MEMORY-DECISION.md:191` | `BUSY_GRACE` 已删，叙述还在教人"有两个" |
| 8 | **零** | 注释纠正 | `plan-prompt.ts:106`（3→`MAX_PLAN_MEMORIES`）、`:115` 魔数 4 加解释；`intent-stats.ts:76`（删"环境切换用"）；`memory.ts:255-257`（`applyExternalTasks` 现在会结束活动） | 都是"文档承诺了代码里没有的事" |
| 9 | **零** | 补注释/改判 | `src/sim/life.ts:398`（4 处 gap 不可达）；`tools/verify-intent.mjs:60`（恒 0 是预期） | 免得下一个人把它当 bug 查 |
| 10 | 低 | 删 `plan-prompt.ts` 死分支 + `due-passed` 类型/文档/TODO | `src/bridge/plan-prompt.ts:395-402`、`:208`、`:311`、`:423` | `dueTickOf:299` 恒 `> nowTick`；上轮 #9（再上轮 #6）未执行，**已连报三轮** |
| 11 | 低 | **修双写记忆**（选 A 或 B） | `src/sim/step.ts:315-318`（+ `activity.ts:85-103` 若选 B） | 一次裁决两条记忆，心情单次封顶 ±1（§1 实测） |
| 12 | 低 | `activity.ts:127` 按 `task.status` 分 `completed`/`interrupted` | `src/sim/activity.ts:125-129` | 做完的单写"没做完"（§1.5 实测） |
| 13 | 低 | `person-lab`/`verify-bridge` 的 `arg()` 接 `cli.mjs` | `tools/person-lab.mjs:17-23`、`tools/verify-bridge.mjs:20-26` | 逐字相同，删 14 行 |
| 14 | 低 | `loadToday` 提到循环外 + 增量维护 | `src/sim/scheduler.ts:237` | 每张 ready 单一次全表扫描；上轮 #11，未执行 |
| 15 | 中 | persona 两处矛盾二选一 | `src/bridge/plan-prompt.ts:133` **或** `src/index.ts:455-458` | 注释说"不下性格判断"，实现塞了 role+traits；上轮 #10，未执行 |
| 16 | 中 | 把"正经事"判据做成 `planMemories` 的注入参数（判据在 `memory.ts` 已有一份） | `src/bridge/plan-prompt.ts:108-112` + `src/index.ts:464` | 收尾时变成 **3 份**（`memory.ts:141-145` 与 plan-prompt 逐字相同，`life.ts:512-517` 第三档口径不同）；§5.7、§0.1 |
| 17 | 中 | `commitments.ts` 用 `memory.ts` 的 `spanOf` | `src/sim/commitments.ts:322-327` | 两份只差一个 `?? endedAt` 兜底；**反向导出**，先确认真要做 |
| 18 | 中 | 去 5 个 `export`（要连测试 import 一起改） | `memory.ts:15/54/63/287`、`life.ts:529/549` | 生产调用点全在本文件；**`dueAppointmentOf` 不在其列**（§2.1 已过期） |
| 19 | 中 | `verify-*` 合并/抽 `evidence.mjs` | §7 | **不建议**；只记录"能少 1~2 个入口、但一行重复逻辑都不少" |

**如果只做三件事**：#1、#2（零风险，且已连续两轮被报）、#11（本轮唯一有行为后果的重复）。#11 做掉之后再谈 #12——它们在同一条记忆通路上，顺序反了要改两遍。

---

## 9. 附录：复现命令（全部只读，不落文件）

```bash
cd packages/dsh-xcity

# 1) 一次完工写两条记忆（§1.2）—— 用已构建的 lib/，不写仓库
node --input-type=module -e "import { step } from './lib/sim/step.js';
import { memoryMood } from './lib/sim/life.js';
…构造 agent(activityId:'act-1', activityPurpose:'work') + task(attemptId:'attempt-1')，
activities 里放一条 taskAttemptId 匹配的 active 活动…
step(w, [{ kind:'taskComplete', taskId:'task-1', attemptId:'attempt-1', output:'ok' }]);
console.log(w.agents[0].episodes.map(e=>e.summary));"
# → ["工单「盘点小镇」","工单「盘点小镇」做完了"]

# 2) 纯模拟完工写成"没做完"（§1.5）
node --input-type=module -e "import { syncActivities } from './lib/sim/activity.js';
…task.status='done' + 一条 taskAttemptId 匹配的 active 活动…; syncActivities(w);
console.log(w.agents[0].episodes.map(e=>e.summary));"
# → ["没做完：工单「盘点小镇」"]

# 3) 计数复核
rg -c 'attributed\(' src/sim/life.ts                       # 12（1 定义 + 11 调用）
rg -n 'districtOfPeer|const districtOf = ' src/sim/life.ts # 定义/调用/重写
rg -n 'function spanOf' src test tools                     # 3 份
rg -n 'horizonOf' tools/verify-*.mjs                        # 2 份（逐字相同）
rg -l "lib/cli.mjs" tools/*.mjs | wc -l                    # 13
rg -n 'DAY_TICKS = 1440' tools                              # 4 份镜像
rg -n '\.reset\(' src --glob '*.ts'                        # 0（reset 仅测试用）
```

### 卡片与代码的三处不一致（免得下一轮继续按错误的描述找）

1. 「10 处 `return`」→ 实际 **11 处**（`life.ts:404/405/417/419/427/428/434/479/481/486/488`）。
2. 「`src/sim/memory.ts` 的 `recordSettledEpisodes`」→ 实际在 **`src/sim/commitments.ts:218`**（私有，3 个调用点）。
3. 「`recordTaskEpisode`」的行号已漂移：`AUDIT-ROUND2.md:301` 写 `memory.ts:238`，现在是 **`:262`**（`memory.ts` 这八轮有增行，且审计期间又被并发改动 +20 行，见 §0.1）。读上轮 §6 那张表时，**行号一律以本轮的为准**，其中 `dueAppointmentOf` 那条结论本身也已失效（§2.1）。
