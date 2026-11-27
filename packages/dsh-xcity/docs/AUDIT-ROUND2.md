# 冗余审计（第二轮）：H10–H17 八轮引入的东西（只读报告）

> 本文件是**唯一**产物。审计期间没有修改 `src/`、`test/`、`tools/` 的任何文件。

- **代码快照**：`git rev-parse --short HEAD` = **`a43f3ba`**（H17）。所有行号按这个快照核过。
- **核验时间**：2026-11-28 05:15–05:35 CST。
- **方法**：`rg -w` 按词边界统计导出与调用点；`tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters` 交叉验证"声明了没人读"；`git blame` 判定某一行是不是这八轮引入的。**没有一条来自"看着像冗余"**，每条都带命中数或调用点。
- **判定口径**（沿用上一轮 `docs/AUDIT-REDUNDANCY.md` 的四个词，另加一个）：
  - **死代码** = 生产路径无可达效果，删掉不改变任何可观察行为；
  - **被覆盖** = 分支存在、但它的结果被后面另一个条件完全决定（本轮新增一类，H11 那条只属于它）；
  - **仅测试用** = 生产零调用，但测试在用（删要连测试一起改）；
  - **内部化** = 只被定义它的那个文件（+ 测试）使用，`export` 是多余的；
  - **同义** = 两处及以上实现同一件事，改动要同步改多处。

---

## 0. 一句话结论

**这八轮新增的 TypeScript 代码在 `--noUnusedLocals` 下是干净的**：19 条命中**没有一条**来自 H10–H17（`git blame` 逐条溯源，见 §10）。也就是说本轮没有"声明了却没人读"的低级冗余。

冗余全在**语义层**，集中在三处：

1. **一条空转的分支**（§1）：H11 加的 `MISS_GRACE_TICKS=180` 把原有的 `BUSY_GRACE_TICKS=60` 完全盖住了。整个"忙碌宽限"连同 `isBusy()`、`currentActivityOf` 的这次调用，**改变不了任何一个可观察结果**。文档却还在花 4 段讲"两个 grace 别混"。
2. **同义实现没跟着长**（§4、§8）："一天 1440 tick"现在有 **10 个声明 / 3 个名字 / 5 行里 7 处裸字面量**；"tick → HH:mm" 3 份；"当天 00:00" 4 份；`tools/` 里那个 6 行的 `arg()` **逐字复制了 10 份**。这些都不是本轮新造的（1440 上一轮就点过 D1），但本轮不但没收敛，还**新增了 2 处**（`plan-prompt.ts:216`、`index.ts:460` 是 `day*1440` 的新写法）。
3. **两处 H15/H18 边界上的死判断**（§2）：`idle.ts:183` 的 `home === null ? null : …` 的前一个分支在 8 行前就已经 `continue` 掉了；`spreadHangout` 里 `index < 0` 永远不成立。

外加一条**文档与代码互相矛盾**（§3.4、§3.2）：`plan-prompt.ts` 自己写着"性格已经在 system prompt 里了，这里再描述一遍只会稀释指令"，而唯一的调用方 `index.ts:453-456` 正好把 role + traits 塞进了那个字段；文件末尾那条 TODO 描述的"以后要做"的功能，`:216` 其实已经做完了。

---

## 1. ★ H11 · `BUSY_GRACE_TICKS` 被 `MISS_GRACE_TICKS` 完全覆盖 · **被覆盖**

### 1.1 代码

```ts
// src/sim/commitments.ts
 25: export const BUSY_GRACE_TICKS = 60
 35: export const MISS_GRACE_TICKS = 180
...
178:      const graceEnd = row.dueTick + MISS_GRACE_TICKS
181:      const kept = rows.some(...) || metInWindow(world, pair[0], pair[1], from, Math.min(now, graceEnd))
184-188:  if (kept) { setStatus(…, 'kept'); settled.push(…); continue }
190:      // ② BUSY_GRACE_TICKS：人还在忙，先不定罪。
191:      if (now <= row.dueTick + BUSY_GRACE_TICKS && rows.some((item) => isBusy(world, item.owner))) continue
193:      // ③ MISS_GRACE_TICKS：没证据不等于失约，宽限用完才落 missed。
194:      if (now <= graceEnd) continue
196:      setStatus(world, row.id, 'missed')
```

### 1.2 证明（不是"看起来像"）

进入 `:191` 的唯一条件含 `now <= dueTick + 60`。一旦成立，就必然有 `now <= dueTick + 180`（`:178` 的 `graceEnd`），于是 **4 行后的 `:194` 会 `continue`**。两条 continue 的可观察结果完全相同（都停在 `open`，什么都不写）。

所以 `:191` 这个分支的**动作恒为空**；连带 `isBusy()`（`:247`）与它的唯一调用、以及 `import { currentActivityOf }`（`:16`）的这次使用，一起变成零效果。

**边界之外也不成立**：`now > dueTick+60` 时 `:191` 直接短路，落到 `:194` 再判一次，结论只由 `graceEnd` 决定。

### 1.3 测试为什么抓不到

```
test/commitments.test.js:17    BUSY_GRACE_TICKS,          ← import
test/commitments.test.js:184   assert.deepEqual(settleCommitments(world, 1301), [], '刚过到期，人在忙，先顺延')
test/commitments.test.js:186   settleCommitments(world, 1300 + BUSY_GRACE_TICKS)  → 期望 []
test/commitments.test.js:193   settleCommitments(world, 1300 + MISS_GRACE_TICKS)  → 期望 []
```

三条断言要的都是"`open` 不动"。**删掉 `:191` 后这三条依然全绿**——因为 1301、1360、1480 全 ≤ `dueTick+180`，`:194` 已经保证。这条测试测的是"宽限期内保持 open"，不是"忙碌宽限单独起作用"；名字里的 `BUSY_GRACE_TICKS` 给的是一种**它其实没有测到的保证**。

命中统计：`rg -n -w 'BUSY_GRACE_TICKS' src test` = **9 条**（`src` 5 条：定义 `:25`、注释 `:33`、注释 `:162`、分支 `:191`；`test` 4 条），**生产路径上真正区分行为的 0 条**。

### 1.4 建议动作（要选一个，不能含糊）

- **推荐：删** `commitments.ts:190-191` + `:25` + `:247-249`（`isBusy`）+ `:16` 那半个 import，并把 `:21-24`、`:33`、`:162` 三段"两个 grace 别混"的注释改成一句"只有一个宽限：没证据 ≠ 失约"。同时把 `test/commitments.test.js:17` 的 import 与 `:186` 的表达式改成 `dueTick + 60`（或直接删掉那条断言——它已经被 `:193` 覆盖）。**行为零变化。**
- **或者：让忙碌宽限有独立效果**（例如"人还在忙时连证据窗口都不开，等他不忙了再扫一遍"）。那是**新增语义**，按"新增概念要确认"的规矩得你先定性。

> 这条我倾向删：注释把这 60 写成一个设计决定（"人腾不出手 ≠ 失约"），但它对结果没有任何影响。留着的成本不是 2 行代码，是下一个人会以为"忙碌会被特殊对待"然后据此推理。

---

## 2. H15 · `idle.ts` 两处死判断

### 2.1 `src/sim/idle.ts:183` · **死代码**（不可达三元）

```ts
172:    const home = spreadHangout(world, agent)
173:    if (home === null) {
...
181:      continue                       // ← home 为 null 的路径在这里就出去了
182:    }
183:    const slot = home === null ? null : idleSlotAt(behaviors, world.seed, agent.id, world.tick)
```

`:173` 的守卫 + `continue` 已经把 `home === null` 从 `:183` 的类型域里排除（TS 在这里把 `home` 收窄成 `{x,z}`）。`:183` 的 `?` 真分支**永远进不去**。

- **证据**：`rg -n 'home === null' src/sim/idle.ts` = **2 条**（`:173`、`:183`），中间没有可以重新赋 `null` 给 `home` 的语句（`home` 是 `const`，全文件 `rg -n 'home =' ` 只有 `:172`）。
- **建议动作**：**删**成 `const slot = idleSlotAt(behaviors, world.seed, agent.id, world.tick)`。零风险，行为不变（`idleSlotAt` 本身返回 `IdleSlot | null`，`:189/:220` 的 `slot !== null` 判断照旧有效）。

### 2.2 `src/sim/idle.ts:92` · **死代码**（不可达守卫）

```ts
 80: function spreadHangout(world: World, agent: Agent): { x: number; z: number } | null {
 81:   const base = agent.hangout
 84:   if (base === null) return null
 87:   const sharing = world.agents.filter(
 88:     (row) => row.hangout != null && row.hangout.x === base.x && row.hangout.z === base.z,
 89:   )
 90:   if (sharing.length <= 1) return base
 91:   const index = sharing.map((row) => row.id).sort().indexOf(agent.id)
 92:   if (index < 0) return base
```

`sharing` 的过滤条件里，`agent` 必然满足（`:84` 已排除 `base === null`，而 `base` 就是 `agent.hangout`），所以 `agent.id` 一定在 `sharing` 里 → `index >= 0` 恒成立。

- **证据**：`:81` 的 `base` 取自 `agent.hangout`；`:88` 只比 `hangout` 的坐标，不比 `id`。`rg -n 'index < 0' src/sim/idle.ts` = 1 条（就是这个 `:92`）。
- **建议动作**：**删** `:92`。（`world.nav === null` 那条 `:96-97` 的 fallback 是**真的能进**，不要一起删。）

---

## 3. H12 / H13 / H14 · `scheduler.ts`、`plan-prompt.ts`、`index.ts`

### 3.1 `src/sim/scheduler.ts:237` · **同义**（每个 task 重算一次全表）

```ts
103: function dayStartOf(tick: number): number { ... }
118: function loadToday(world: World, dayStart: number): Map<string, number> { ...遍历 world.tasks... }
139:   const load = loadToday(world, dayStartOf(world.tick))        // ← ① idleAgentsByFairness 里算一次
181:   for (const task of ready) {
237:     const load = loadToday(world, dayStartOf(world.tick))      // ← ② 每张单再算一次
```

- **证据**：`rg -n -w 'loadToday' src/sim/scheduler.ts` = **5 条**：注释 `:102`、注释 `:166`、定义 `:118`、调用 `:139`、调用 `:237`。`world.tasks` 全表扫描 + 一次 Map 分配，**每张 ready 单一次**，算出的是同一批数据（`dayStartOf(world.tick)` 在循环内是常量）。
- **为什么不能直接提到循环外**：`:269-274` 会改 `task.owner`，所以本批已经派出去的单必须计入下一张的负载——**但只有"本批新增的几张"变了**，其余历史负载不变。
- **建议动作**：**低优先，保留代码形状**，改成"循环外算一次，派出一张就 `load.set(agent.id, ±1)` 增量维护"。收益只在 `ready` 单多时可见（现在一次派 3 张，省不下什么），**但它同时消掉 `loadToday` 的第二处调用**，让"今天经手几张"只有一个口径。若不动，至少把 `:237` 的注释写清"必须重算，因为 `:269-274` 改了 owner"。

### 3.2 `src/bridge/plan-prompt.ts:216` · **同义**（同文件两套写法）

```ts
 27: const DAY_TICKS = 1440
...
212:   const today = dayStartOf(nowTick) + hours * 60 + minutes
216:   return today > nowTick ? today : today + 1440      // ← 隔壁 56 行处就有 DAY_TICKS
```

- **证据**：`rg -n '1440' src/bridge/plan-prompt.ts` = **2 条**（`:27` 定义、`:216` 字面量）。
- **建议动作**：`:216` 改成 `today + DAY_TICKS`。零风险。

### 3.3 `src/bridge/plan-prompt.ts:339-340` · **过期文档**（TODO 描述的功能已经实现）

```ts
339:// TODO(口径待定)：目前 HH:mm 一律解释成"今天"。如果哪天要求 06:30 也能安排"明天凌晨",
340:// 就在 dueTickOf 里按"早于现在则顺延一天"处理，并把测试里 due-passed 那条改成"等于现在"。
```

`:216` **现在就是** `today > nowTick ? today : today + 1440` —— 即"早于现在则顺延一天"。TODO 要求做的事已经做完了，它却还写着"以后再做"。

- **证据**：`rg -n '顺延一天|due-passed' src/bridge/plan-prompt.ts test` → 文档 `:231`、`:339-340`；`:119`（类型）、`:312-319`（生成分支）。测试 0 条。
- **建议动作**：**删**这两行 TODO（连同 `:312-319` 那条不可达的 `due-passed` 分支——上一轮 A3 已经判过，**仍未执行**，见 §10）。

### 3.4 `src/index.ts:453-456` · **同义 + 与设计说明矛盾**（plan prompt 里的 persona）

```ts
// src/bridge/plan-prompt.ts:60-63
 * 只说事实（现在几点、今天做过什么、认识谁），不下性格判断——性格已经在 system prompt 里了，
 * 这里再描述一遍只会稀释指令。

// src/index.ts:451-456（唯一的 buildPlanPrompt 调用点）
        // R516：persona 一直是空串，模型每次都读到空的「## 你是谁」。先用角色+性格顶上，
        // 不新造字段——traits 是我们已经有的东西。
        persona: agent === undefined ? '' : '角色：' + agent.role + '；干活劲头 ' + String(...) + '/100' + '；责任心 ' + ...
```

- **事实**：`Agent` 类型没有 `persona` 字段（`rg -n 'persona' src/domain/types.ts` = 0），真实人设文本在内容库 `RosterSeat.persona`（`src/content/kinds.ts:287`，`packs/default.ts:325/`… 共 8 个席位都写了），而它只被 `buildCharacterSystemPrompt`（`index.ts:1851`）消费。所以 `:453` 的注释"先用角色+性格顶上"是对的、也是唯一可行的（不新造字段）。
- **问题**：顶上去的内容正是 `plan-prompt.ts:62` 明说"不要"的东西（性格、角色），而且 `role` + `traits` 在**同一个角色的 system prompt 里已经有一份**。两处措辞各写一遍 = 同义；将来改 `traits` 的口径（比如加第三维）只改了这边或只改了那边，都不会报错。
- **建议动作（二选一，别两边都留着不说）**：
  - 让 `:453-456` 只输出**不含性格**的一句（例如"角色：engineer"），把整段"干活劲头/责任心"删掉——与 `plan-prompt.ts:62` 对齐；
  - 或者改 `plan-prompt.ts:62` 的注释，承认"计划提示词里会重复一次性格加权"。
  两者都不新增实体。

### 3.5 `src/index.ts:460` · **同义**（字面量）

```ts
460:        nowTick: world?.tick ?? day * 1440,
```

- **证据**：`rg -n '1440' src/index.ts` = **1 条**（就是这行）；`src/sim/memory.ts:11` 已 `export const DAY_TICKS = 1440`。
- **建议动作**：import `DAY_TICKS` 后写 `day * DAY_TICKS`。上一轮 §5 点过同一处（当时是 `:442`），**仍未执行**。

---

## 4. 全局同义：「一天」这个数写在 10 个地方

`rg -n '(DAY_TICKS|MINUTES_PER_DAY|TICKS_PER_DAY)\s*=' src tools -g '*.ts' -g '*.mjs'`：

| # | 位置 | 名字 | 值 |
|---|---|---|---|
| 1 | `src/sim/memory.ts:11` | `DAY_TICKS`（**export**） | 1440 |
| 2 | `src/sim/life.ts:21` | `MINUTES_PER_DAY` | 1440 |
| 3 | `src/sim/initiative.ts:12` | `MINUTES_PER_DAY` | 1440 |
| 4 | `src/bridge/daily-plan.ts:12` | `DAY_TICKS` | 1440 |
| 5 | `src/bridge/plan-prompt.ts:27` | `DAY_TICKS` | 1440 |
| 6 | `src/bridge/memory-context.ts:31` | `MINUTES_PER_DAY` | `24 * 60` |
| 7 | `src/adapters/slowvale/types.ts:53` | `MINUTES_PER_DAY`（**export**） | 1440 |
| 8 | `tools/measure-snapshot.mjs:16` | `DAY_TICKS` | 1440 |
| 9 | `tools/measure-tokens.mjs:30` | `TICKS_PER_DAY` | 1440 |
| 10 | `tools/verify-memory-chain.mjs:56` | `DAY_TICKS` | 1440 |

外加 `src/sim/life.ts:57` 的 `MEMORY_MOOD_WINDOW = 1440`（值同、语义是"记忆窗口"，本身合理）。

**裸字面量**（tick 语义，不含 adapters 里那些"每天 1440 分钟"）：

```
src/sim/day-summary.ts:17   ((Math.floor(tick) % 1440) + 1440) % 1440     ← 一行 3 个
src/sim/day-summary.ts:64   Math.floor(nowTick / 1440)
src/sim/day-summary.ts:65   day * 1440
src/bridge/plan-prompt.ts:216
src/index.ts:460
```

- **判定**：**同义**。上一轮 §5 D1 已经点过（当时"四种写法"），H13/H14 之后变成 **10 个声明 + 7 处裸字面量**，**新增了 `plan-prompt.ts:216` 与 `index.ts:460` 两处**——即这八轮在这个方向上**没有收敛，只有扩散**。
- **建议动作（分三档，边界决定能做什么）**：
  - **可以真删**：`sim/life.ts:21`、`sim/initiative.ts:12`、`sim/day-summary.ts:17/64/65`、`src/index.ts:460` → 一律 import `sim/memory.ts` 的 `DAY_TICKS`（同模块/上层，边界允许；`scheduler.ts:102` 的注释与 `commitments.ts:17` 的 import 已经是这个做法的先例）。
  - **不能靠 import 消掉**：`protocol/boundaries.ts` 规定 bridge 只能 import protocol/domain/runtime，所以 `bridge/` 那三份（#4/#5/#6）**只能收敛成 bridge 侧的一份共享私有实现**。放哪（`plan-prompt.ts` 导出 / 新建 `bridge/clock.ts`）= **新增一个共享位置**，按"新增概念要确认"，这条我不替你定。上一轮 §5 的结论同样适用。
  - **tools 侧可以直接 import**：`tools/measure-baseline.mjs`、`aw-lab.mjs`、`person-lab.mjs`、`verify-bridge.mjs` **已经在 import `../lib/*.js`**（`rg -l "from '\.\./lib/" tools/*.mjs` = **4 个文件**：`measure-baseline`、`aw-lab`、`person-lab`、`verify-bridge`）。所以 `measure-snapshot.mjs:16/20`、`measure-tokens.mjs:30`、`verify-memory-chain.mjs:56` 的"注释保证与 memory.ts 一致"是**可以避免的**——直接 `import { DAY_TICKS, SNAPSHOT_BUDGET_BYTES } from '../lib/sim/memory.js'`、`import { ACTIVITY_KEEP } from '../lib/sim/activity.js'`（两个都真的 export，已核）。

### 4.1 `tick → HH:mm` 三份 · **同义**

| 位置 | 名字 | 备注 |
|---|---|---|
| `src/sim/day-summary.ts:16-21` | `hhmm` | 私有 |
| `src/bridge/memory-context.ts:52-55` | `clockOf` | 私有，注释自认"与 `bridge/plan-prompt.ts` 同口径" |
| `src/bridge/plan-prompt.ts:49-52` | `clockOf` | 私有 |

后两份**逐字相同**（只有常量名不同）；第一份语义相同。`rg -n "padStart\(2, '0'\)" src -g '*.ts'` 命中同样这 3 个函数体。建议动作同 §4 第二档（bridge 两份收成一份；`sim/day-summary.ts` 那份不动，它已在 sim 内）。

### 4.2 「当天 00:00」四份 · **同义**

```
src/sim/memory.ts:40      dayOf(tick) = floor(max(0,tick)/DAY_TICKS) + 1     （第几天，1 起）
src/bridge/memory-context.ts:58  dayOfTick(tick) = floor(max(0,tick)/MINUTES_PER_DAY) + 1   ← 与上面函数体逐字相同
src/bridge/memory-context.ts:59 dayOfTick(tick) = floor(max(0,tick)/MINUTES_PER_DAY) + 1   ← 与上面逐字相同
src/sim/scheduler.ts:103  dayStartOf(tick) = floor(max(0,tick)/DAY_TICKS) * DAY_TICKS
src/bridge/plan-prompt.ts:55     dayStartOf(tick) = ...                          ← 与上面逐字相同
```

- **证据**：`rg -n 'dayStartOf' src` = 5 条（`plan-prompt.ts:55/212`、`scheduler.ts:103/139/237`）；`rg -n -w 'dayOf|dayOfTick' src` 命中 `memory.ts:40`、`memory-context.ts:59`。
- **判定**：**同义**（跨边界，两份实现）。**建议动作**：同 §4（bridge 侧收一份；sim 侧 `dayStartOf` 只是 `dayOf` 的另一种表达，可保留——它表达的是"起点"而不是"第几天"，语义不同，不算冗余）。

---

## 5. H17 · `turn-cost.ts` 与存档预算

### 5.1 `src/index.ts:393` · **未被读取的参数**（options 只有测试在用）

```ts
// src/runtime/turn-cost.ts
 48: export interface TurnCostOptions {
 49:   /** 单轮输入字符数超过它才提示；缺省用 `DEFAULT_WARN_INPUT_CHARS`。 */
 50:   warnInputChars?: number
 51: }
 69: function resolveWarnInputChars(value: number | undefined): number { ... }

// src/index.ts:393（唯一生产调用点）
  const turnCost = createTurnCost({ warnInputChars: DEFAULT_WARN_INPUT_CHARS })
```

- **证据**：`rg -n 'warnInputChars' src` = **6 条**，全部在 `turn-cost.ts` 内 + `index.ts:393` / `:1054`（`:1054` 读的是返回值，不是选项）。`rg -n 'warnInputChars' src/config.ts` = **0 条** —— 没有任何配置项接到它上面。
- **所以**：`index.ts:393` 把模块自己的默认值又传了回去，**等价于 `createTurnCost()`**；`TurnCostOptions` 与 `resolveWarnInputChars` 的归一逻辑（非法值退回默认）**只被 `test/turn-cost.test.js:34/47` 用到**。判定：**仅测试用**的接口。
- **建议动作**：`index.ts:393` 改成 `createTurnCost()`（顺手删掉那半个 import）。**不要删** `TurnCostOptions`——它是"以后要接配置"的入口，删了下次还得加回来；但要知道**现在没有人在用它**。

### 5.2 `src/routes/api.ts:362` · **未被读取的字段**（下发到前端，前端 0 读）

```ts
 45:  turnCost?: () => Record<string, unknown>          // ApiDeps 可选依赖
362:      ...(deps.turnCost === undefined ? {} : { turnCost: deps.turnCost() }),   // 塞进 /api/world 的 runtime
```

- **证据**：`rg -c 'turnCost' web src/client` = **0**（前端一处都没读；`web/` 里的 `state.plan` 是场景计划，同名不同物）。生产侧 3 个点：`index.ts:393` 建、`:1489` `turnCost: () => ({...turnCost.snapshot()})` 注入、`:1051` 观察。
- **判定**：**未被读取的字段**（对前端而言）。它仍对**人**有用（`/api/world` 直接 curl 就能看），所以**不是死代码**。
- **建议动作**：**保留**，写下来是为了防止下一轮有人以为"接了前端"。（上一轮 F3 对 `planStats` 给的也是这个结论，两个字段现在的处境完全一样。）

### 5.3 `src/sim/memory.ts:156/180/224` · **保留**（两个写盘点共用一份裁剪）

- `rg -n -w 'trimToSnapshotBudget' src` = **2 个生产调用点**：`runtime/index.ts:185`（`trimBeforeSave`，被 `flush` / `flushSync` 调用）与 `state.ts:351`（切会话前存盘）。`describeTrim` 同样 2 处。
- **判定**：**不是冗余，是刻意的单点**——`runtime/index.ts:180-183` 的注释写明"两个写盘点共用它，各写一遍的话改一处忘一处"。**保留**。
- ⚠️ 但有一处小缝：`runtime/index.ts:186` 写 `persist?.log?.(…)`，而 `trimBeforeSave` 的两个调用点都在 `if (persist === undefined) return` 之后（`:190/:217`），所以那个 `?.` 的保护是多余的。**可选**：改成 `persist.log?.(…)`。零风险，但不值得单独跑一趟。

### 5.4 `src/sim/memory.ts:156` `snapshotBytes` · **内部化**

- `rg -n -w 'snapshotBytes' src test tools` = 6 条：`memory.ts` 内 3 处使用（`:182/:208/:215`）+ 定义 + `test/snapshot-budget.test.js` 13 条。**生产零外部调用**。
- **判定**：**内部化**（去掉 `export`）或承认它是"测试锚点"。注意 `tools/measure-snapshot.mjs:44` **没有**复用它（它量的是紧凑 JSON + 真实文件字节，见 `:74-78`），两者口径不同且都写了理由（`memory.ts:25-30` / `measure-snapshot.mjs:149-163`）——**这个差异是正确的，不要"统一"**。

---

## 6. H10 / H16 · `memory.ts` / `life.ts` 的导出面

`rg -n -w '<name>' src test tools` 的分布：

| 符号 | 生产调用点 | 测试 | 判定 | 建议 |
|---|---|---|---|---|
| `collaboratorsOf` (`memory.ts:90`) | **仅本文件** `:283` | `test/memory-with.test.js` 21 条 | 内部化 | 去 `export` 或认作测试锚点 |
| `recordTaskEpisode` (`memory.ts:238`) | `sim/step.ts:317`、`:325` | 0 | **正常** | 不动 |
| `snapshotBytes` (`memory.ts:156`) | 仅本文件 | 13 条 | 内部化 | 见 §5.4 |
| `trimToSnapshotBudget` / `describeTrim` | 2 个写盘点 | 8 / 0 | **正常** | 不动 |
| `memoryMood` (`life.ts:332`) | 本文件 `:385` | 15 条 | 内部化 | 去 `export` |
| `memoryWeightOf` (`life.ts:352`) | 本文件 `:369` | 6 条 | 内部化 | 去 `export` |
| `dueAppointmentOf` (`life.ts:109`) | 本文件 `:257` | 3 条 | 内部化 | 去 `export` |
| `APPOINTMENT_WINDOW` / `MEMORY_MOOD_WINDOW` / `MEMORY_MOOD_WEIGHT` | 本文件 | 3 / 3 / 6 | 口径锚点 | **保留 export**（测试在断言这些数） |
| `spreadHangout` (`idle.ts:80`) | 本文件 `:172` | 0 | 已是私有 | 不动（本轮修的 H15，判为正确形状） |

- **注意区分**：这 5 个函数（`collaboratorsOf`/`snapshotBytes`/`memoryMood`/`memoryWeightOf`/`dueAppointmentOf`）**不是"真的没人用"**——它们都在生产路径上被调用，只是**调用点在本文件内**。所以"去 export"是纯收口，**代价是测试的 import 会断**（这 5 个都在 `test/` 里被直接 import 断言）。
- **建议动作**：**先不动**。理由：收益是 5 个关键字，成本是改 5 个测试文件的 import 路径（`lib/sim/memory.js` 里没有它就是 `undefined`，测试会 TypeError 而不是干净失败）。如果要收，一次收干净：给它们加 `export` 的替身？——那反而**新增实体**（违背"如无必要勿增实体"）。所以：**记为"已知的宽松导出面"，不是待办**。

---

## 7. H14 · `src/runtime/owner-lock.ts`：两套"我是不是主人"

```ts
 48: const byDir = new Map<string, OwnerLock>()
 50: export function acquireOwnerLock(stateDir: string): OwnerLock {
 51:   const cached = byDir.get(stateDir)
 52:   if (cached !== undefined) return cached        // ← 第一套：进程内 Map
 58: function acquireOnce(stateDir: string): OwnerLock {
 85:       if (pid === process.pid) return { owned: true, ownerPid: pid, release: noop }   // ← 第二套：文件里的 pid
```

### 7.1 `:85` 在唯一的调用点上不可达

- **证据**：`rg -n -w 'acquireOwnerLock' src` = **2 条**：定义 `owner-lock.ts:50`、调用 `index.ts:330`（`acquireOwnerLock(resolve(resolved.stateDir))` —— 参数已经 `resolve` 归一）。
- **推理**：同一个进程里，`byDir` 的键就是 `resolve(stateDir)`。第一次调用若成功，缓存立刻写入，第二次直接命中 `:52`，**根本不会再进 `acquireOnce`**；第一次若失败（`EEXIST` 且别人活着），`pid === process.pid` 也不成立。**所以 `:85` 只有在"同一个目录用两种拼法传入"时才可能命中**，而唯一的生产调用点做了归一。
- **判定**：**死代码**（在当前调用面下不可达），但它是对"拼法不同"的防御。**建议动作**：**保留**，并在 `:85` 上补一行注释写清"只在 stateDir 没归一化时可达；生产调用点 `index.ts:330` 已 `resolve`"。——上一轮 G2 说的是"有一处语义不一致"，就是这一处，**别当成新发现**。

### 7.2 `test/owner-lock.test.js:38-43` 测的不是它名字说的那件事

```js
test('R509：release 之后别人能拿到', () => {
  const lock = acquireOwnerLock(d)
  lock.release()
  writeFileSync(join(d, '.owner.lock.tmp'), '')
  assert.equal(acquireOwnerLock(d).owned, true)      // ← 命中 byDir 缓存，没碰文件系统
})
```

`:43` 拿回来的是**同一个缓存对象**（`owned: true`、`release: noop`），它既没有重读文件、也不证明"锁文件已被释放、别人能建"。`:42` 写一个 `.owner.lock.tmp` 更是完全无关（没有任何代码读这个文件）。

- **判定**：**同义测试**（断言的是缓存，名字说的是文件系统）。
- **建议动作**：**补一条**能区分的断言（例如 `assert.equal(existsSync(join(d,'.owner.lock')), false)` 之后再 acquire），或把测试改成直接调两次 `acquireOnce` 的路径。**不要删这条**——删了连"进程内可重入"都没人守。

---

## 8. `tools/*.mjs` 里重复的「读世界 + 轮询 + JSON 输出」骨架

各验证脚本都是"独立可跑、不引依赖"的一次性工具，风格一致是刻意的（`verify-tasks.mjs:15` 的注释：`// [0] 参数：手写解析，不引依赖`）。但**"不引依赖"被理解成了"不共享代码"**，于是：

| 骨架 | 份数 | 位置（`rg` 证据） |
|---|---|---|
| `function arg(name, fallback)` 6 行 | **10** | `rg -c 'function arg\(name, fallback\)' tools/*.mjs` = 10；**逐字相同，只有分号风格 2 种**（`md5` 校验：5 份 `120bbc…`、5 份 `693879…`） |
| `const base = String(arg('base', …)).replace(/\/+$/, '')` | **7** | `measure-tokens`、`verify-{tasks,scale,memory-chain,commitments,with,fairness}` |
| `const REQUEST_MS = …` + `AbortSignal.timeout(REQUEST_MS)` | **7** | 同上 7 个文件 |
| "快照：世界只有 base 这一个出口；失败也要给明确 reason" + `let fetchError = null` | **4** | `verify-with.mjs:41-43`、`verify-commitments.mjs:63-65`、`verify-memory-chain.mjs:90-92`、`verify-scale.mjs:65`（注释逐字相同） |
| `async function getJson(url)` | **2** | `verify-tasks.mjs:37-41`、`verify-fairness.mjs:49-53`（函数体逐字相同） |
| `const sleep = (ms) => …` + `while (true) { … sleep(Math.min(POLL_MS, left)) }` 轮询 | **3** | `verify-tasks.mjs:43-61`、`verify-fairness.mjs:55/70-89`、`verify-scale.mjs:53`（前两者的循环体逐行对应） |
| `GET /agent-world/api/personas` 拿技能/计数（`try/catch` 里"没开不算失败"） | **2** | `verify-tasks.mjs:80-87`、`verify-fairness.mjs:116-125` |
| 离线世界启动六行（`resolveConfig({autoStart:false,…})` → `createPluginState(config,{initialAgents:'all'})` → `ensureWorld` → `world.tick = 8*60` → `createRuntime({service,tickMs:100,idleActionsEnabled:true,selfLifeEnabled:true})`） | **2** | `person-lab.mjs:29-44`、`verify-bridge.mjs:33-38` |
| 内核常量重声明（`DAY_TICKS`/`SNAPSHOT_BUDGET_BYTES`/`ACTIVITY_KEEP`） | **3 + 3 处注释保证** | `measure-snapshot.mjs:16/20`、`measure-tokens.mjs:30`、`verify-memory-chain.mjs:56`；`verify-with.mjs:17`、`verify-commitments.mjs:22`、`measure-snapshot.mjs:162` 用注释声明"与 src 一致" |

- **判定**：**同义**（同一件事写 N 遍，一致性靠人眼）。
- **代价已经付过一次**：`measure-snapshot.mjs:18` 的注释"与 `src/sim/memory.ts` 的 `SNAPSHOT_BUDGET_BYTES` 保持一致"——这句话本身就是"会漂"的自白。
- **建议动作（分两半）**：
  - **可以直接做的一小半**：把上面"内核常量重声明"那 3 个文件改成 `import`（`tools` 里已有 4 个文件在 import `../lib/*.js`，先例充分）。**这不是新增实体，是删掉 3 个副本。**
  - **需要你先定的一半**：`arg()` / `base` / `getJson` 收成 `tools/lib/cli.mjs`（约 30 行，覆盖 10 个脚本）。**这是新增一个模块**，按"新增概念要确认"的规矩我不替你定。选项：(a) 建 `tools/lib/cli.mjs`；(b) 保持现状，接受 10 份复制（这些脚本不进产品、不发布，重复的代价只在"改 `arg()` 要改 10 处"）；(c) 折中——只把 `verify-*` 那 7 个脚本收敛，`aw-*`（依赖前端调试）各自保留。
  - **明确不建议**：为了 DRY 把验证脚本合并成一个大脚本。它们的价值在于"一个命令验证一件事"，合并会把 3 个独立退出码揉成一个。

---

## 9. 上一轮清单（H1–H9）的执行情况

`docs/AUDIT-REDUNDANCY.md` §10 的 15 条，按当前 `a43f3ba` 复核：

| 上轮 # | 位置 | 状态 | 证据 |
|---|---|---|---|
| 1 | `server.ts:279-280`（`placeId`/`hearers`） | **已删** | `tsc --noUnusedLocals` 不再报这两条 |
| 2 | `daily-plan.ts:30/64-66` `askedOn` | **正在执行**（未提交） | 快照 `a43f3ba` 上两条都还在；**审计期间工作树**里已被另一处改动删掉（`git status` 见 §9.1） |
| 3 | 注释收尾（`visual.ts`/`server.ts:253`） | 未复核（不在本轮范围） | — |
| 4 | `index.ts:355` 重复 `hasXcityRoleModel` | **已删** | 现在是 `:357-358`：`if (… || !hasXcityRoleModel(…)) return false` + `return await isIdleSession(…)`，第二次调用没了 |
| 5 | 去 6 个 `export`（`memory.ts:14/30/105`、`life.ts:177`…） | **未执行** | `memory.ts:15` `export const EPISODE_MAX`、`:54` `export function summarizeActivity`、`:263` `export const INTERRUPTED_MIN_TICKS`、`life.ts:220` `export function intentOptions` 全部还在 |
| 6 | `plan-prompt.ts:306-313` 死分支 `due-passed` | **未执行** | 现在是 `:312-319`，分支与 `:119` 的 `'due-passed'`、`:228` 的文档、`:339-340` 的 TODO 都还在 |
| 8 | `state.ts:414` fast-path | **未执行** | 现在是 `:428` `if (activeSessionId === sessionId && state.world !== null) return state.world` |
| 9 | `life.ts:21` 改用 `DAY_TICKS` | **未执行** | `life.ts:21` 仍是 `const MINUTES_PER_DAY = 1440` |
| 12 | `keepCommitment` 二选一 | **未执行**（仍 0 调用） | `rg -n -w 'keepCommitment' src` = 3 条（`:10` 注释、`:136` 定义、`:157` 注释），测试 6 条 |
| 14 | bridge 侧 1440/`clockOf` 合一 | **未执行**，且**反向增长** | 本轮新增 `plan-prompt.ts:216`、`index.ts:460` 两处字面量（§3.2、§3.5） |
| 15 | `characterModel` 补 1 条 config 测试 | 未复核 | 不在本轮范围 |

未列出的 **#7**（`respond-sms` 两段 prompt 重复）、**#10**（`visual` 两个仅测试用构造器）、**#11**（载荷类型统一）、**#13**（`commitments.ts:166` kept 预判）**不在本轮范围**，未复核——它们与 H10–H17 的新代码没有交集。

### 9.1 审计期间的并发改动（读行号前先看这段）

本轮审计的读代码窗口里，工作树被**另一处改动**修改（未提交，与本报告无关，我没有碰它）：

```
 M packages/dsh-xcity/src/bridge/daily-plan.ts      ← 正在执行上轮 #2（删 askedOn）
 M packages/dsh-xcity/docs/PLAN-9H-THREE-RESIDENTS.md
 M packages/dsh-xcity/docs/VERIFY-CHECKLIST.md
```

对结论的影响：

1. §9 的 **#2** 是按"快照 `a43f3ba` = 未执行"记的；工作树里它正被删除。**不影响任何行号**——被删的是 `daily-plan.ts:26-32` 与 `:61-66`，而本报告引用的 `daily-plan.ts:12`（`DAY_TICKS`）在它们之前。
2. 本报告其余行号全部按 `a43f3ba` 核过，且 `src/` 里除 `daily-plan.ts` 外**无其它未提交改动**（`git status --porcelain -- src/ test/ tools/` 只有上面这一条）。
3. `docs/AUDIT-ROUND2.md` 是本轮唯一新增文件（`??`）。

> 结论：上轮 15 条里**至少 6 条明显未执行**（#5/#6/#8/#9/#12/#14），其中 #14（1440 收敛）不但没做，这八轮还**又加了两处**。这不是"这轮新发现的冗余"，是"上一轮的决定没落地"——**先做已决定的，比再写一份新清单更省钱**。

---

## 10. `tsc --noUnusedLocals` 的 19 条：没有一条来自 H10–H17

`./node_modules/.bin/tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters`（05:22）：

```
src/adapters/slowvale/routes.ts(121,7)      ITEM_CATEGORIES
src/adapters/slowvale/routes.ts(132,7)      PHONE_APPS
src/adapters/slowvale/server.ts(21,1)       randomUUID
src/adapters/slowvale/server.ts(29,85)      projectScene
src/adapters/slowvale/server.ts(273,21)     world
src/bridge/dsh-adapter.ts(462,3)            options
src/bridge/teams.ts(38,68)                  CharacterBridge
src/content/load-files.ts(43,1)             CONTENT_SCHEMA_VERSION
src/content/packs/default.ts(36,10)         box
src/content/packs/pixel.ts(135,7)           FLOOR_TILE
src/index.ts(14,1)                          homedir
src/index.ts(21,3)                          createSessionTransport
src/routes/events.ts(23,1)                  http
src/routes/index.ts(8,1)                    fileURLToPath
src/sim/recovery.ts(74,35)                  world
src/store/worldStore.ts(33,68)              writeFileSync
src/world/create.ts(18,1)                   MAX_AGENTS
src/world/hangouts.ts(100,7)                MAX_CANDIDATES
src/world/reconcile.ts(157,9)               savedDistricts
```

- 上一轮列了 18 条，现在 19 条：**-2**（`placeId`/`hearers` 已修）、**+3**（`server.ts:273`、`dsh-adapter.ts:462`、`recovery.ts:74` —— 上轮清单漏了它们）。
- **`git blame` 溯源**（这是"不是本轮引入"的证据）：
  - `server.ts:273` → `79b67141`（H5，11-28）
  - `dsh-adapter.ts:462` → `7a828227`（10-15）
  - `recovery.ts:74` → `64937877`（10-19）
  - 其余 16 条全部早于 `ef9345c`（H10）。
- **判定**：**范围外**（不属于 H10–H17），但既然顺手跑了就记下来：它们能存活的唯一原因是 `tsconfig.base.json` 没开 `noUnusedLocals`（见上轮 §8 H4，本轮复核仍如此）。
- **这条本身就是本轮最值得说的结论**：八轮新增的 TS 代码在编译器下是干净的——**冗余不在声明层，在语义层**。

---

## 11. 判为「保留」的（写下来，防止下一轮被当冗余砍掉）

| 位置 | 看起来像冗余 | 为什么不是 |
|---|---|---|
| `memory.ts:180` `trimToSnapshotBudget` 两个调用点（`runtime/index.ts:185`、`state.ts:351`） | 同一件事两个写盘点 | `runtime/index.ts:180-183` 明确写了"共用一份，各写一遍会改一处忘一处"——**它就是消冗余的产物** |
| `memory.ts:156 snapshotBytes`（量 world 段）vs `measure-snapshot.mjs:74 fileBytes`（量整个文件） | 两个"存档体积" | 口径**故意不同**：预算管 world 段（外壳固定 ~5 KB，`memory.ts:29-30`），工具报真实落盘字节。两个都写了理由，**不要合并** |
| `life.ts:57 MEMORY_MOOD_WINDOW = 1440` | 和 `DAY_TICKS` 同值 | 它表达的是"记忆窗口 = 一天"，不是"一天多少 tick"；改一天长度时它该跟着变，但**现在是独立语义** |
| `idle.ts:96-97` `world.nav === null` 的 fallback | 像防御性冗余 | `nav` 在无场景内容时真的为 `null`（`aw-lab` 的纯模拟路径），**真能进** |
| `commitments.ts:136 keepCommitment` | 生产 0 调用 | 这是**产品决策挂起**（上轮 B3/#12），不是遗漏。**保留等待定性**，不要第三次当新发现报上来 |
| `index.ts:1489` `turnCost` 下发到 `/api/world` | 前端 0 读 | 对 `curl`/诊断有人用（同 `planStats`）。**保留** |
| `memory.ts` 那 5 个"只被本文件+测试用"的 export | `export` 多余 | 收口要同时改 5 个测试文件的 import；**收益 5 个关键字，成本一趟测试改动**。记为"已知宽松面"，不是待办（§6） |
| `scheduler.ts:118 loadToday` 按"交工那天"记账 | 口径粗 | `scheduler.ts:26-28` 自己写明了代价与理由（没有"领取时刻"字段）。**保留口径，只优化重算**（§3.1） |

---

## 12. 建议删除清单（风险从低到高，每条一行）

| # | 风险 | 动作 | 位置 | 一句话理由 |
|---|---|---|---|---|
| 1 | **零** | 删被完全覆盖的分支 + 连带符号 | `src/sim/commitments.ts:190-191` + `:25` + `:247-249` + `:16` 的 import + 注释 `:21-24/:33/:162` | `MISS_GRACE=180` 完全盖住 `BUSY_GRACE=60`，`:194` 已 `continue`；行为零变化，3 条现有断言照绿 |
| 2 | **零** | 删不可达三元 | `src/sim/idle.ts:183` | `:173` 的 `if (home === null) … continue` 已把该分支排除 |
| 3 | **零** | 删不可达守卫 | `src/sim/idle.ts:92` | `agent` 必在 `sharing` 里，`index < 0` 恒假 |
| 4 | **零** | 用同文件常量替换字面量 | `src/bridge/plan-prompt.ts:216` → `today + DAY_TICKS` | `:27` 已有 `DAY_TICKS`，同一文件两套写法 |
| 5 | **零** | 用 `DAY_TICKS` 替换字面量 | `src/index.ts:460` | `rg '1440' src/index.ts` 仅此 1 条；`memory.ts:11` 已 export |
| 6 | **零** | 去掉自传默认值 | `src/index.ts:393` → `createTurnCost()` | 传的就是模块自己的默认值；`warnInputChars` 无配置来源 |
| 7 | **零** | sim 内改用 `DAY_TICKS` | `src/sim/life.ts:21`、`src/sim/initiative.ts:12`、`src/sim/day-summary.ts:17/64/65` | 同模块/同层可 import；`scheduler.ts:102` 是既有先例 |
| 8 | **零** | tools 改 import 内核常量 | `tools/measure-snapshot.mjs:16/20`、`measure-tokens.mjs:30`、`verify-memory-chain.mjs:56` | 5 个 tools 已在 import `../lib/*.js`；删的是副本，不加实体 |
| 9 | 低 | 删不可达分支 + 过期 TODO | `src/bridge/plan-prompt.ts:312-319` + `:119` `'due-passed'` + `:228` 文档 + `:339-340` TODO | `dueTickOf:216` 保证 `dueTick > now`，分支恒假，测试 0 条（上轮 #6，未执行） |
| 10 | 低 | 改文档使其与代码一致 | `src/bridge/plan-prompt.ts:62-63` **或** `src/index.ts:451-456` | 注释写"性格已在 system prompt"，实现却塞了 role+traits；二选一，别两边都留着 |
| 11 | 低 | 提高 `loadToday` 到循环外 + 增量维护 | `src/sim/scheduler.ts:237`（配合 `:139`） | 每个 ready 单一次全表扫描，`dayStartOf` 在循环内是常量；顺带消掉第二处调用 |
| 12 | 低 | 补一条能区分的断言 | `test/owner-lock.test.js:38-43` | 现在断言的是 `byDir` 缓存 `owned:true`，没验证"锁文件已释放" |
| 13 | 中 | 去 5 个 `export`（要连测试 import 一起改） | `memory.ts:90/156`、`life.ts:109/332/352` | 生产调用点全在本文件内；**收益小、成本是一趟测试改动**，倾向不动 |
| 14 | 中 | 选一个：建 `tools/lib/cli.mjs` 收 `arg()`/`base`/`getJson`（10/7/2 份），或明确接受复制 | `tools/*.mjs`（清单见 §8） | **新增一个模块 = 新概念，需你拍板**；折中方案是只收 `verify-*` 那 7 个 |
| 15 | 中 | 选一个：删 `owner-lock.ts:85`，或补注释说明"仅在 stateDir 未归一化时可达" | `src/runtime/owner-lock.ts:85` | 唯一生产调用点 `index.ts:330` 已 `resolve`，叠加 `byDir` 缓存后不可达 |
| 16 | 中 | 定口径：bridge 侧 1440/`clockOf`/`dayStartOf` 收成一份（放哪里要你定） | `bridge/daily-plan.ts:12`、`plan-prompt.ts:27/49/55/216`、`memory-context.ts:31/52/58` | 边界禁止 bridge import sim；收敛点 = 新位置（上轮 #14，未执行且**反向增长**） |

**如果只做一件事**：第 1 条。它是本轮唯一一处"文档承诺了某种行为、代码里那个行为不存在"的地方，而且删完能顺手把 4 段解释"两个 grace 别混"的注释一起收掉——净减少 10 行左右，可观察行为零变化。
