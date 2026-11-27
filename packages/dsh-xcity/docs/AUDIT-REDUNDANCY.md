# 冗余审计：H1–H8 九个轮次（只读报告）

> 本文件是**唯一**产物。审计期间没有修改 `src/` 或 `test/` 的任何文件。

- **代码快照**：`git rev-parse --short HEAD` = **`4112467`**（H9）。审计开始时是 `83c492e`，期间有一次并发提交，见 §9——**所有行号已按 `4112467` 复核**。
- **核验时间**：2026-11-28 03:17–03:25 CST（每条行号在 03:25 按 `4112467` 重新核过）。
- **方法**：`rg -w` 按词边界统计导出与调用点；`npx tsc -p tsconfig.json --noEmit --noUnusedLocals` 交叉验证"声明了但没人读"的符号。**没有一条来自"看着像冗余"**，每条都带命中数或调用点。
- **四类判定口径**（后面每条的"判定"只用这四个词）：
  - **死代码** = 生产路径无调用点，且删掉不改变任何可观察行为；
  - **仅测试用** = 生产零调用，但测试在用（删除要同时改测试）；
  - **内部化** = 只被**定义它的那个文件**使用，`export` 是多余的；
  - **同义** = 两处及以上实现同一件事，改动要同步改多处。

---

## 0. 一句话结论

九个轮次新增的模块**结构上是干净的**（纯函数 + 注入 + 边界都能对上）。冗余集中在三处，而且都不是"设计错了"，是"长完没回头剪"：

1. **死分支与过期文档**（§4）——最值得先动。`plan-prompt.ts` 里有一条永远进不去的 `due-passed` 分支，配着一段描述"以后要做"的 TODO，而那段功能其实已经做了；`state.ts` 里 H6 打的补丁让上一轮的 fast-path 变成空转。
2. **只被测试用 / 只被自己用的导出**（§2、§3）——六个 `export` 关键字是多余的，生产零影响，改起来最便宜。
3. **同义实现**（§5）——`1440` 有四种写法、`tick → HH:mm` 有三份、"投递载荷形状"在 adapters 里声明了五次。第五项是 H3/H5 两次 500 错误的**同一个根因**，收掉它的收益最大。

配置项那边结论是**反的**：`slowvale.characterModel` 与 `xcity.captainSessionId` **都真的在被读**，没有一个"未被读取的配置"。`characterModel` 的问题不是冗余，是**零测试覆盖**（§6）。

---

## 1. 死代码（`src/runtime`、`src/bridge`、`src/adapters`）

### A1 · `src/bridge/daily-plan.ts:30` + `:64-66` · 死代码

```ts
30:  /** 今天问过没有（测试与诊断用）。 */
     askedOn: (agentId: string) => number | null
64:  askedOn(agentId) {
      return asked.get(agentId) ?? null
    },
```

- **证据**：`rg -n 'askedOn' --glob '!lib/**' src test tools` 全仓 **2 条**，就是这两处（接口声明 + 实现）。测试一次都没调过。
- **补充证据**：`:29` 的注释写着"（测试与诊断用）"，但测试不用它——注释本身也是过期的。
- **建议动作**：**删**接口成员 + 实现（共 4 行）。`asked` 这个 Map（:36）仍然要用，只删读取口。

### A2 · `src/adapters/slowvale/server.ts:279-280` · 死代码

```ts
279:    const placeId = world.agents.find((agent) => agent.id === actorId)?.placeId ?? opts.place
280:    const hearers = world.agents.filter((agent) => agent.id !== actorId).map((agent) => agent.id)
281:    const beats: VisualBeat[] = lines.map((text) => sayBeat(text))
```

- **证据**：`rg -n 'hearers' src` = **1 条**（就是 :280 这行声明本身）。`placeId` 在 `flushSay` 内无二次出现（文件里另一个 `placeId` 在 :606，是另一处）。
- **交叉证据**：`npx tsc --noEmit --noUnusedLocals` 直接报 `server.ts(279,11) TS6133` 与 `(280,11) TS6133`。
- **成因**：H5 之前这两个值要喂给 `dialogue` 包的 `audience`；改用 `sayBeat`（`bubble.float_up`）之后不需要 audience 了，计算留在了原地。
- **建议动作**：**删**这两行。**顺带**把 :253 的注释"（visual 包，一拍 dialogue）"改成"一拍 bubble"——见 D3。

### A3 · `src/bridge/plan-prompt.ts:306-313` · 死代码（不可达分支）

```ts
306:    if (dueTick <= input.nowTick) {
309:        code: 'due-passed',
```

- **证据（不可达证明）**：`dueTick` 只来自 `dueTickOf`（:297 → :198-211），而它的返回值是

  ```ts
  210:  return today > nowTick ? today : today + 1440
  ```

  两条路径都严格大于 `nowTick`（`today = floor(now/1440)*1440 ≤ now`，所以 `today+1440 ≥ now+1`）。因此 :306 恒为 `false`。
- **交叉证据**：`rg -n 'due-passed' src test` = 4 条，**全部在 `plan-prompt.ts` 内**（:119 类型、:222 文档、:309 生成、:334 TODO 提到它），测试里 0 条——没有任何测试能造出这个 code。
- **建议动作**：**删** `:306-313` 分支、`:119` 的 `| 'due-passed'`、以及 `:222` 文档里的"不晚于现在 → due-passed"。同一条链上的过期文档见 D1。

### A4 · `src/state.ts:414` · 死代码（H6 补丁后被包住）

```ts
414:      if (activeSessionId === sessionId && state.world !== null) return state.world
...
418:      if (state.world !== null) {     // ← H6 新增（commit 761722b，+9 行）
423:        return state.world
```

- **证据**：`:414` 命中时 `state.world !== null` 必然成立 → `:418` 的新分支同样命中 → 两条路径都 `return state.world`。而 `:414` 的短路只省下 `:418-423` 里那个 `if (activeSessionId === null)` 判断，该判断在 `activeSessionId === sessionId` 时恒为假。**可观察行为相同**。
- **证据（改动的来源）**：`git show 761722b -- src/state.ts` = 新增 9 行，无删除。上一轮的 fast-path 因此变成空转。
- **建议动作**：**删** `:414`。**或者**保留但在 :414 加一行注释写清"只是提前返回，H6 之后不再必要"——两者选一，不要留着不解释。

---

## 2. 仅测试用（生产零调用，删要连测试一起改）

| 编号 | 位置 | 符号 | 生产 | 测试 | 建议动作 |
|---|---|---|---|---|---|
| B1 | `src/adapters/slowvale/visual.ts:68` | `workBeat` | 0 | 2 | **删**（`import { workBeat }` 那半行一起删）。语义上已被 `actionBeat('work')` 覆盖。 |
| B2 | `src/adapters/slowvale/visual.ts:125` | `groupTimeline` | 0 | 2 | **删**。理由更强：文件头 `:19` 自己写着"这里只实现 independent"，而 `groupTimeline` 是一个没人调的 group 时间轴构造器——**代码和它头顶的宣称互相矛盾**（见 D2）。 |
| B3 | `src/sim/commitments.ts:123` | `keepCommitment` | **0** | 6 | **需要你决定，不是纯删除**。见下。 |

### B3 单独说：`keepCommitment` 是"没接线的第二类证据"

- **证据**：`rg -n -w 'keepCommitment' --glob '!lib/**' src` 只有 4 条，全是 `commitments.ts` 内的**文档注释（:10 / :118-122 / :144）与定义（:123）**，没有一条调用。
- **为什么这条重要**：`commitments.ts:142-148` 与 `:117-122` 把"显式说明我办到了"写成承诺的**第二类证据**，而 `settleCommitments` 的 kept 判据（:166）也依赖"已被显式标过 kept"。既然没人调用，这条通道在生产上是**关着的**——kept 只可能来自 `metInWindow`（episode.with / 同地点 meet 重叠）。H7 补 `episode.with`（task-12）之后，主通道能工作，所以世界不会坏；但文档描述的机制比实际存在的多一条。
- **建议动作（二选一，不要含糊）**：
  - 删 `:117-130` + 改 :118-122/:144 两段注释 → 承认"只有一类证据"；
  - 或者接线（谁调？玩家确认短信？角色自述？）——这属于**新增行为**，按"新增概念要确认"的规矩，得你先定性。

---

## 3. 内部化（只在本文件内使用，`export` 是多余的）

已确认：**去掉 `export` 不牵动任何测试**（0 个测试引用），是纯零风险的一类。

| 编号 | 位置 | 符号 | 仅本文件内的使用点 |
|---|---|---|---|
| C1 | `src/sim/memory.ts:30` | `summarizeActivity` | `:83`（`episodeOfActivity` 内） |
| C2 | `src/sim/memory.ts:14` | `EPISODE_MAX` | `:94` |
| C3 | `src/sim/memory.ts:105` | `INTERRUPTED_MIN_TICKS` | `:121` |
| C4 | `src/sim/life.ts:177` | `intentOptions` | `:261`（`chooseLife` 内） |
| C5 | `src/adapters/slowvale/spawn.ts:21` | `xcitySessionId` | `:34` |
| C6 | `src/adapters/slowvale/visual.ts:43` | `actionBeat` | `:50`（walkBeat）、`:68`（workBeat） |

**建议动作**：这 6 个只去掉 `export` 关键字（或改 `function`/`const`），不动逻辑。

**例外（保留 `export`，理由要写下来）**：
- `visual.ts:93 walkPathOf`（本文件 `:113` 用 + 测试 4 处）、`ask-session.ts:36 textOfMessage`（本文件 `:93` 用 + 测试 4 处）：测试要用，去掉 export 就得改测试 import，收益不抵。
- `ask-session.ts:36 textOfMessage` 与 `session-events.ts:54 textOfBlocks` 的关系见 E4。

---

## 4. 过期 / 矛盾的文档（比死代码更贵：它让 review 失去依据）

| 编号 | 位置 | 现在写的是 | 实际情况 | 证据 |
|---|---|---|---|---|
| D1 | `src/bridge/plan-prompt.ts:333-334` | `// TODO(口径待定)：…如果哪天要求 06:30 也能安排"明天凌晨"，就在 dueTickOf 里按"早于现在则顺延一天"处理` | **已经这么做了**（`:210` `today + 1440`），并且 `test/plan-prompt.test.js:117` 有一条 `R500-5：已经过的时刻顺延到明天` 专门锁住这个行为 | `rg -n 'R500-5\|顺延' test/plan-prompt.test.js` = 2 条 |
| D2 | `src/adapters/slowvale/visual.ts:19` | "这里只实现 independent——一个人说一句话，够用了" | 文件里有 `groupTimeline`（:125）。**并且** `:32-38` 现在是一段**没有代码跟随的注释块**（R511 删掉 `independentDialogue` 后留下的空壳） | `rg -n '^export' visual.ts` 有 9 个导出，含 group 时间轴 |
| D3 | `src/adapters/slowvale/server.ts:253` | "让某个角色在场景里说一句话（visual 包，一拍 **dialogue**）" | 实际走 `sayBeat` → `bubble.float_up`（`:281`） | `:281` |
| D4 | `src/adapters/slowvale/respond-sms.ts:21-23` | 连续两条注释 `/** 宿主的会话投递。 */` `/** 已经真的把这条短信投进会话了… */` | 第一条是给 `prompt`（:25）的，被挤到了 `suggestedAction`（:23）头顶；`prompt` 自己没有注释 | 读 :21-30 即见 |

**建议动作**：D1/D2/D3/D4 全是纯注释改动，**风险和收益之比最好的一批**。

---

## 5. 同义实现（两处以上在实现同一件事）

### E1 · "一天 = 1440 tick" 四种写法 + "tick → 第几天" 两份

| 位置 | 写法 |
|---|---|
| `src/sim/memory.ts:10` | `export const DAY_TICKS = 1440` ← 本模块唯一该存在的一份 |
| `src/sim/life.ts:21` | `const MINUTES_PER_DAY = 1440`（**与 memory.ts 同一个模块**，可以直接 import） |
| `src/bridge/daily-plan.ts:12` | `const DAY_TICKS = 1440` |
| `src/bridge/plan-prompt.ts:27` | `const DAY_TICKS = 1440` |
| `src/bridge/memory-context.ts:31` | `const MINUTES_PER_DAY = 24 * 60`（注释自认"与 sim/memory.ts 的 DAY_TICKS 同值"） |
| 字面量 | `plan-prompt.ts:210`、`day-summary.ts:17`、`index.ts:442` |

- **"第几天"两份**：`memory.ts:16-18 dayOf` 与 `memory-context.ts:58-60 dayOfTick`，**函数体逐字相同，只有常量名不同**（后者注释自认"与 sim/memory.ts 的 dayOf 同口径"）。
- **"HH:mm"三份**：`day-summary.ts:16-21 hhmm`、`memory-context.ts:52-55 clockOf`、`plan-prompt.ts:49-52 clockOf`。后两者除常量名外**逐字相同**；三者语义完全一致。
- **判定**：同义。
- **建议动作（要分两半，不能一句话带过）**：
  - **一半可以真删**：`sim/life.ts:21` → 改成 `import { DAY_TICKS } from './memory.js'`（同模块，边界允许）。
  - **另一半不能靠 import 消掉**：`protocol/boundaries.ts:151-156` 规定 **bridge 只能 import protocol/domain/runtime**，所以 `bridge/*` 那三份**不能**去 import `sim/memory.ts`（`memory-context.ts:11-12` 的注释正是这么写的，它是对的）。bridge 侧只能收敛成**一份共享的私有实现**。
  - ⚠️ 收敛到哪个文件 = **新增一个共享位置**，按"新增概念要确认"，这条我不替你定。可选：`bridge/plan-prompt.ts` 导出 `clockOf/dayStartOf` 给同模块另两个文件用（不新增文件，但方向有点怪）／新建 `bridge/clock.ts`（干净，但是新实体）。

### E2 · `respond-sms.ts` 内两段 prompt 逐字重复

`initiativePromptText`（:82-95）与 `promptText`（:103-127）有三块**逐字相同**：

| 内容 | 行号 |
|---|---|
| `const day = dayLines.length === 0 ? [] : ['你今天到目前为止：', ...dayLines.map((line) => '- ' + line), '']` | `:83` 与 `:109` |
| 规则 1（`REPLY_OPEN…REPLY_CLOSE`，一句，不超过 30 字） | `:90` 与 `:119` |
| 规则 2（标记之外可以写详细说明） | `:91` 与 `:120` |
| 规则 4（必须是普通文本消息） | `:93` 与 `:125` |

- **判定**：同义。这是"给前端的回复格式约定"，两处漂移会让同一次对话的两个入口要求不一致。
- **建议动作**：抽两个**同文件私有**函数 `dayBlock(dayLines)` 与 `replyRules(extra)`（不新增模块，不动边界）。**注意**：拼接顺序必须与现在逐字一致，改完用 `test/initiative.test.js` + `test/slowvale-respond-sms.test.js` 锁。

### E3 · "投递载荷形状"在 `adapters/slowvale` 里声明了 5 次 ★收益最大

同一个结构 `{ requestId, sessionId, mode: 'queue', content: [{ type: 'text', text }] }`：

| 位置 | 角色 |
|---|---|
| `src/bridge/types.ts:224-230` | `BridgePromptRequest` —— **规范定义**（bridge 层） |
| `src/adapters/slowvale/respond-sms.ts:25-30` + 构造 `:71` | 短信回复 |
| `src/adapters/slowvale/ask-session.ts:13` + 构造 `:78-83` | 每日计划 |
| `src/adapters/slowvale/initiative-delivery.ts:18-23` + 构造 `:53` | 主动短信 |
| `src/adapters/slowvale/task-execution.ts:13` + 构造 `:67` | 工单执行 |

- **证据（这不是我猜的，是代码自己承认的）**：`ask-session.ts:10` 的注释写着 **"形状必须与已有短信通道一致（respond-sms.ts:62），否则 sessionController 内部会抛「reading 'length'」"**。也就是说，这五份的一致性**靠注释维持**。
- **代价已经付过**：H3/H5 记录里的 500 错误（"prompt 参数字段不全 → 500"，`respond-sms.ts:1-7` 的文件头也提到）就是这个根因。
- **为什么不能直接用规范的 `BridgePromptRequest`**：`protocol/boundaries.ts:174-183` 规定 adapters **只能 import protocol**，`bridge/types.ts` 不在允许清单里。所以这不是"写代码的人懒"，是边界决定的。
- **建议动作**：在**已存在**的 `src/adapters/slowvale/types.ts`（该文件已经导出 `MINUTES_PER_DAY`、`SLOWVALE_PROTOCOL_VERSION`，是 adapters 自己的契约文件）里加一个 `QueueTextPrompt` 类型，四处引用。**不新增文件、不改边界规则**。

### E4 · "assistant/message → 文本"三份（**建议保留，不要为了 DRY 改行为**）

| 位置 | 分隔符 | 输入 | 特点 |
|---|---|---|---|
| `src/bridge/decode.ts:46` `extractAssistantReply` | `'\n\n'` | `data.message.content` | 还要求 `role === 'assistant'`，无文本返回 `null` |
| `src/adapters/slowvale/session-events.ts:54` `textOfBlocks` | `'\n\n'` | `blocks[]` | 过滤空文本块 |
| `src/adapters/slowvale/ask-session.ts:36` `textOfMessage` | `''` | `data` 或 `data.message.content` | 接受 `content` 为字符串 |

- **判定**：同义，**但三份的差异是行为差异，不是风格差异**（`''` vs `'\n\n'`；是否要求 `role === 'assistant'`）。合并会改掉某一处收到的文本形状。
- **位置差异**：`decode.ts`（bridge）与另外两处（adapters）之间**边界禁止互相 import**，这份重复是结构性的。
- **建议动作**：**保留**。真要收，只能收到 `protocol/`，那要改 `BOUNDARY_RULES`——代价大于收益。写这份报告就是为了别让下一个人第三次发现它然后再花一轮去"统一"。

---

## 6. 配置项：两个都真的在被读，没有一个"未被读取"

### F1 · `slowvale.characterModel` —— 被读 1 次，声明 4 次，测试 0 次

- **声明**：`config.ts:46`（类型）、`:65`（默认值）、`:199`（zod schema）、`:263`（resolve）。**读取**：`index.ts:1305` —— `model: resolved.slowvale.characterModel.provider === '' ? undefined : resolved.slowvale.characterModel`。
- **判定**：**不是死配置**。它的作用是给 spawn 出来的角色会话显式选模型，否则 `hasXcityRoleModel`（`dsh-adapter.ts:56`）挡住自主开工与每日计划（H3 的 `noModel=3` 就是这个）。
- **真正的问题**：`rg -n 'characterModel' test tools web` = **0 条**。字段改名 / 删掉 / 把 `provider === ''` 的空串约定改错，**没有任何测试会红**。
- **建议动作**：**保留字段**；补 1 条 `resolveConfig({ slowvale: { characterModel: {...} } })` 的断言（已有 `test/captain-session-config.test.js` 可以先例）。这条不是冗余清理，是"给这 4:1 的接线比买一份保险"。

### F2 · `xcity.captainSessionId` —— 使用密集，有测试，无冗余

- **使用点**：`index.ts:562/604/606/680/686/695-699/724/1470`、`config.ts:174/227-229`、`bridge/teams.ts:146/288`。
- **测试**：`test/captain-session-config.test.js`（含"不配置时必须保持旧值"、"空白不许变成空 id"）。
- **判定**：无冗余，**不动**。

### F3 · `src/runtime/plan-stats.ts`（28 行）—— 薄，但保留

- **证据**：`createPlanStats` 1 个调用点（`index.ts:386`），10 个计数 + 1 条最近错误原文（共 11 个字段）在 `index.ts` 里自增（:391-458），唯一出口 `index.ts:1441` `plan: () => ({ ...planStats })`；测试 0 条。
- **判定**：它只是给一组计数器找了个类型家。删掉会把 11 个字段的类型声明塞回 `index.ts`（那才是真的臃肿）。
- **建议动作**：**保留**，不动。

### F4 · `src/index.ts:355` —— 同一道门加了两次（**判定：死代码，一行**）

```ts
354:      if (typeof sessionControllerService?.prompt !== 'function' || !hasXcityRoleModel(ctx, sessionId)) return false
355:      return await isIdleSession(ctx, sessionId, signal) && hasXcityRoleModel(ctx, sessionId)
```

- **证据**：`:354` 已经确保 `hasXcityRoleModel === true`，`:355` 的第二次调用恒为 `true`，只是多一次服务查询 + 属性探测。
- **建议动作**：**删** `:355` 的 `&& hasXcityRoleModel(ctx, sessionId)`。

### F5 · `DailyPlanDeps` 的 `day` 参数在唯一实现里被忽略

- `daily-plan.ts:55` 调 `deps.parse(text, agent.id, day)`、`:53` 调 `deps.promptFor(agent.id, day)`；而唯一实现 `index.ts:445` 是 `parse: (text, agentId) => …`（**不收 day**），`:433` 的 `day` 只用在 `world === null` 的兜底 `day * 1440`。
- **判定**：同义（`day` 有两个来源：`daily-plan` 算的、世界里读的 `world.tick`）。
- **建议动作**：**低优先**。要么把 `day` 从 `parse` 签名里去掉，要么在实现里用上它。不要两边都留着不用。

### F6 · `PlanPromptInput.persona` 在生产里恒为空串 → prompt 里有一个空标题

- **证据**：`buildPlanPrompt` 只有一个生产调用点 `index.ts:437-443`，其中 `:439 persona: ''`。而 `plan-prompt.ts:84-85` 会无条件输出 `'## 你是谁'` + `input.persona` → **模型每次都会读到一个空的小节标题**。
- **测试对照**：`test/plan-prompt.test.js:11` 传的是真实 persona（`'你在仓库当班，说话短…'`），所以测试覆盖不到生产这条空路径。
- **判定**：同义/死内容（"拼了一段没人填的内容"）。
- **建议动作（二选一，我给不出"哪个更好"的结论，因为它是 prompt 质量问题不是代码问题）**：
  - 空串时**整段不输出**（与 `memory-context.ts:85` "某一段没有内容就整段不出现"的既有口径一致）——最小、最安全；
  - 或者接真实来源：`index.ts:1757 createSeatResolver` 已经能给出 `seat.persona`（`buildCharacterSystemPrompt`，:1803）。但那是完整 system prompt，塞进计划提示词会明显加长——**加长不等于变好**，所以我倾向第一条。

---

## 7. 判为"保留"的（写下来，防止下一轮被当冗余砍掉）

| 位置 | 看起来像冗余 | 为什么不是 |
|---|---|---|
| `src/sim/movement.ts:44 advanceMovement` vs `src/sim/travel.ts:79 arriveTravelers` | 两套"到达"机制 | `travel.ts:1-13` 写明理由：换场所 = 换整张底图，没有跨图路径，"出行"必须是有耗时的过程（`TRAVEL_TICKS`），不能假装是一条 path。两者作用于不同 state（`walking` vs `traveling`）。 |
| `src/bridge/memory-context.ts:43-48` 注入 `selectEpisodes`/`scoreEpisode` | 注入的是已有函数，像绕路 | `boundaries.ts:151-156` 禁止 bridge import sim，注入是**唯一合法**做法；且注入同一份打分正是它文件头 :8-12 声明的目的（防止聊天与计划挑出不同条目）。 |
| `OPEN_MAX:20`/`BUSY_GRACE_TICKS:22`/`SETTLED_KEEP_DAYS:24`、`MEMORY_RECALL_K:24`/`MEMORY_OPEN_COMMITMENTS:26`/`MEMORY_CONTEXT_MAX_CHARS:28`、`MAX_PLAN_ITEMS:19`、`PLAN_MINUTE:11`、`EPISODE_KEEP_DAYS:12`、`EPISODE_WITH_MAX:39` | 只有测试读的 `export` | 它们是**被测试钉住的口径锚点**（测试断言"3 条上限""400 字""2 条计划"）。删了测试就失去依据。**保留 export**，但要意识到"生产读它的地方只有它自己的默认参数/内部判断"。 |
| `src/runtime/owner-lock.ts` 双层缓存 | `byDir` 进程级 Map（:48-56）+ 文件 pid 判定（:85） | 见 G2，**不是死代码，但有一处语义不一致**。 |

---

## 8. 范围外但顺手可见（不属于这九轮，**不计入删除清单**）

写在这里是因为下次有人扫到同一处会省一轮。

- **H1 · `src/sim/index.ts` 桶文件**：32 行 `export`（约 40 个符号），实际经它取用的只有 **5 个** —— `planTeamSync`、`startActivity`（`index.ts:38`）、`step`、`StepResult`、`selfLifeCommands`（`runtime/index.ts:33-34`）、`planTeamSync`（`test/team-sync.test.js:10`）。证据：`rg -n "from '.*sim/index\.js'"` = 4 条。H1–H8 往这个桶里加过 4 行（`:11-12` movement、`:41` summarizeDay、`:44-45` life），都没人经桶取。
- **H2 · `adapters/slowvale` 内写死 `1440`**：`project.ts:24` import 了 `MINUTES_PER_DAY` 并在 `:58-59` 用了，同一文件 `:101-102` 又写死 `1440`；`logs.ts:67` 同样写死。**同文件两套写法**。
- **H3 · `logs.ts:66-79 timeOfTick` 与 `project.ts:99-108 gameTimeAt`**：同一套 `dayIndex/minuteOfDay/日期` 换算的两份实现，只有返回值不同（完整 ISO vs 截断）。同属 adapters，可合并。
- **H4 · `tsc --noUnusedLocals` 报出的 18 条**（运行于 03:22，行号以当时为准）：

  ```
  src/adapters/slowvale/routes.ts(121,7)   ITEM_CATEGORIES
  src/adapters/slowvale/routes.ts(132,7)   PHONE_APPS
  src/adapters/slowvale/server.ts(21,1)    randomUUID
  src/adapters/slowvale/server.ts(29,85)   projectScene
  src/adapters/slowvale/server.ts(279,11)  placeId      ← 本报告 A2
  src/adapters/slowvale/server.ts(280,11)  hearers      ← 本报告 A2
  src/bridge/teams.ts(38,68)               CharacterBridge
  src/content/load-files.ts(43,1)          CONTENT_SCHEMA_VERSION
  src/content/packs/default.ts(36,10)      box
  src/content/packs/pixel.ts(135,7)        FLOOR_TILE
  src/index.ts(14,1)                       homedir
  src/index.ts(21,3)                       createSessionTransport
  src/routes/events.ts(23,1)               http
  src/routes/index.ts(8,1)                 fileURLToPath
  src/store/worldStore.ts(33,68)           writeFileSync
  src/world/create.ts(18,1)                MAX_AGENTS
  src/world/hangouts.ts(100,7)             MAX_CANDIDATES
  src/world/reconcile.ts(157,9)            savedDistricts
  ```

  → 这 18 条能存活的唯一原因是 **`tsconfig.base.json` 没开 `noUnusedLocals`**（我读过：`strict`/`exactOptionalPropertyTypes`/`noUncheckedIndexedAccess` 都开了，唯独没有它）。

---

## 9. 审计期间发生的并发改动（重要，请先读这段再看行号）

审计窗口内（03:21–03:23）工作树被**另一处改动**修改，共享文件系统下我能看到：

```
 M packages/dsh-xcity/docs/PLAN-9H-THREE-RESIDENTS.md
 M packages/dsh-xcity/src/adapters/slowvale/server.ts
 M packages/dsh-xcity/src/adapters/slowvale/visual.ts
 M packages/dsh-xcity/test/slowvale-comms.test.js
```

改动内容（现已是提交 `4112467 refactor(xcity): H9 删掉无用的 dialogue 构造；写下 H10–H18 计划`）：`visual.ts` 删掉了 `independentDialogue` + `DialogueBeat`（-34 行），`server.ts` 同步去掉那半行 import，`test/slowvale-comms.test.js` 同步改。

**对我结论的三点影响**：

1. 我最初统计到 `independentDialogue` **生产 0 调用、只有测试用**（`server.ts:32` import 了却从不使用），准备列为"仅测试用"。**那条已被 H9 解决**，因此**不计入删除清单**。
2. **但 H9 没扫干净**：它留下了 `visual.ts:32-38` 那段**没有代码跟随的注释块**（本报告 D2 后半），以及 `server.ts:253` 仍写着"一拍 dialogue"（D3）。这两条在删除清单第 3 条里——**都是 H9 的收尾，加起来 7 行注释**。
3. 行号以 `4112467` 为准，已在 03:25 复核（`server.ts:279-280`、`visual.ts:68/125`、`state.ts:414`、`plan-prompt.ts:306/333` 均未漂）。若你之后又改这几个文件，行号会再漂。

---

## 10. 建议删除清单（风险从低到高，每条一行）

| # | 风险 | 动作 | 位置 | 一句话理由 |
|---|---|---|---|---|
| 1 | 零 | 删两行未读局部 | `server.ts:279-280` | `tsc --noUnusedLocals` 已判 TS6133；`hearers` 全仓只此一处 |
| 2 | 零 | 删 4 行未调用方法 | `daily-plan.ts:30` + `:64-66` | `askedOn` 全仓仅 2 条命中，测试也没用 |
| 3 | 零 | 改 4 处注释 | `plan-prompt.ts:333-334`、`visual.ts:19`+`:32-38`、`server.ts:253`、`respond-sms.ts:21` | 纯文档；D1 的 TODO 描述的功能已经实现了 |
| 4 | 零 | 删重复条件 | `index.ts:355` 的 `&& hasXcityRoleModel(...)` | :354 已保证为真 |
| 5 | 零 | 改 6 个关键字 | `memory.ts:14/30/105`、`life.ts:177`、`spawn.ts:21`、`visual.ts:43` 去掉 `export` | 均只被本文件用，0 个测试引用 |
| 6 | 低 | 删死分支 | `plan-prompt.ts:306-313` + `:119` 类型 + `:222` 文档 | `dueTickOf` 保证 `dueTick > now`，`due-passed` 不可达且无测试 |
| 7 | 低 | 抽两个同文件私有函数 | `respond-sms.ts:83/109`、`90-91/119-120`、`93/125` | 逐字重复；改完用现有两个测试文件锁 |
| 8 | 低 | 删 fast-path | `state.ts:414` | H6 的 :418-423 已把它完全包住，行为等价 |
| 9 | 低 | `life.ts:21` 改用 `memory.ts` 的 `DAY_TICKS` | `sim/life.ts:21` | 同模块可 import，边界允许 |
| 10 | 低 | 删两个仅测试用的构造器 | `visual.ts:68 workBeat`、`:125 groupTimeline`（连测试 import 一起改） | 生产 0 调用；groupTimeline 还与文件头 :19 自相矛盾 |
| 11 | 中 | 统一载荷类型 | 在既有 `adapters/slowvale/types.ts` 加 `QueueTextPrompt`，改 4 处 | 五份靠注释维持一致，H3/H5 的 500 就是它 |
| 12 | 中 | 二选一：删 `keepCommitment` 或接线 | `commitments.ts:117-130` + `:118-122`/`:144` 注释 | 生产零调用，"第二类证据"通道是关着的——**需要你定性** |
| 13 | 中 | 删 `:166` 的 kept 预判 | `commitments.ts:166` | 两个写 kept 的入口都写全 id 的所有行，且 :157 已跳过非 open；**但它在防御存档半写**，需你确认存档一致性假设 |
| 14 | 中 | bridge 侧 1440/clockOf 三合为一 | `daily-plan.ts:12`、`plan-prompt.ts:27/49`、`memory-context.ts:31/52/58` | **收敛点算新实体，需你拍板放哪** |
| 15 | 中 | 补 1 条 config 测试 | `config.ts:46/65/199/263`（`characterModel`） | 4 处声明 : 1 次读取 : 0 条测试 |
| 16 | 中 | 决定空 persona 怎么办 | `index.ts:439` + `plan-prompt.ts:84-85` | 模型每次都读到一个空的「## 你是谁」；最小改法是空串时整段不输出 |
| 17 | 中高 | 统一 `owner-lock` 的两套"我是主人" | `owner-lock.ts:85` 的 `release: noop` vs `:68-74` 会 unlink | 命中时锁文件永不清理；**涉及锁语义，必须真机复验再改** |
| 18 | 高（防复发，非删除） | 清 H4 的 18 条 + 打开 `noUnusedLocals` | `tsconfig.base.json` | 不打开的话第 1 条这类问题下轮还会长回来；会牵连其他包，需你决定范围 |

---

## 11. 怎么验（给动完手的人）

1. **死本地**：`cd packages/dsh-xcity && npx tsc -p tsconfig.json --noEmit --noUnusedLocals` —— 现在是 18 条，目标是 0 条（或明确豁免）。
2. **行为不变**：清单第 1–10 条都是"行为等价"类，动完跑 `npm test`（当前全量基线**我没有跑**——见下）。
3. **E1/E2 的同义收敛**：删之前先跑一次，删之后再跑，**测试数必须一致**；`test/plan-prompt.test.js:203` 已有一条确定性断言（同输入两次输出相同），能兜住重构。

> **诚实交代两个限制**：
> 1. 我**没有跑 `npm test`**。`npm test` = `npm run build` + `node --test`，而 `build` 会写 `lib/`——审计期间有另一个 agent 正在改 `src/`，我去重建 `lib/` 会跟他抢。所以我给的是**静态证据**（rg 命中 + `tsc --noEmit`），没有全量测试数字。要基线数字请让一个不并发的窗口跑一次。
> 2. 本报告**没有改动任何 `src/`/`test/` 文件**，也没有新建除本文件以外的文件。
