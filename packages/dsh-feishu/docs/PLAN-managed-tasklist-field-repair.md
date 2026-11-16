# 计划：受管清单字段漂移的兼容与修复（重名 · 历史 text 类型）

> 触发（2026-11-16 12:08）：同步连续 `partial`，面板 `lastError` 每 5 分钟刷新一次
> 「字段重名且没有可用类型」+「受管清单字段未就绪，暂停字段写回：预期完成」。
> 用户口径：「同步和投递任务一直在报错」。
> 本方案要求：旧清单零手工也能回到 `ready`；删除字段只发生在「空值重复项」且必须人确认。

## 0. 现象与证据（真实数据）

| 证据 | 值 |
| --- | --- |
| `syncHistory` 最近 100 次 | 99 `partial` / 1 `failed`（11-15 20:14 → 11-16 12:08） |
| 失败阶段 | `清单与字段初始化`、`预期时间重试` |
| 11:43 前的错误 | `字段「触发条件/自动开工/优先级」已存在但类型是 text，不是 single_select` |
| 11:43 后的错误 | `字段重名且没有可用类型，拒绝创建/写入` ×2（开始时间、结束时间） |
| 认证 / 任务 / 评论 | 正常：23 条任务同步成功，评论 74 条无失败 |
| `managedTasklist.status` | `failed`，`errors` 两条 |

飞书清单实际字段（`lark-cli task custom_fields list`）：

| 字段 | 份数 | 类型 | 有值 guid |
| --- | --- | --- | --- |
| 开始时间 | 2 | text | `1194e1f7…`（20 条任务） |
| 结束时间 | 2 | text | 无 |
| 预期完成 | 2 | text | 无 |

## 1. 根因（按代码路径）

1. **初始化硬失败**：`ensureManagedTasklist` 用 `allow_duplicates: true` 批量 ensure（index.js:3378）。
   同名字段能容忍，但 `开始时间/结束时间` 在 schema 里只收 `datetime`（tasklistSchema.js:17–18 旧值），
   两份重复项都是 `text` → `usable` 为空 → `字段重名且没有可用类型`（larkTasklist.js:196–207）。
2. **预期完成走另一条路**：`ensureEtaField` / `writeEtaToFeishu` 没有传 `allow_duplicates`
   （index.js:4031 / 4056）→ `字段重名，拒绝创建/写入`；失败分支把 `etaMissing` 写进缓存
   （index.js:4036），之后每轮直接回放「同名但类型不符，未重建」（index.js:4029）。
3. **写回闸门放大影响**：`managedTasklist.status !== ready` 时 `managedFieldWriteBlocked`
   拦住受管字段写入（index.js:2933–2951）。所以「预期完成/开始时间」的写回、绑定开工的时间投影、
   建议面板的落地都跟着报同一句。
4. **重名从哪来**：历史版本在「字段创建回执不明」时重试，两次 POST 都落地；现在的
   `fieldCreationIntents` 只防新增，不清理存量。
5. **为什么一直刷**：`autoSync=true` / `syncIntervalMinutes=5`，每轮都重跑同一初始化并覆盖 `lastError`。

## 2. 目标与非目标

**目标**

1. 旧清单（重复字段 + 历史 text 列）不改数据也能 `ready`，任务同步与字段写回不再被冻住。
2. 同一份重名集合，`ensure` 与 `write` 永远选同一个字段（确定性，不来回横跳）。
3. 不静默删数据；重复字段的清理必须是「空值 + 预览 + 明确确认 + 留痕」。
4. 报错可行动：说清是哪个字段、哪份 GUID、有没有数据、下一步点哪里。
5. 错误不空转：同一句失败不在 `lastError` 里无限堆叠。

**非目标（本轮不做）**

- 不把历史 text 日期列迁移成 datetime（收益低、要重写 20 条值、不可回滚）。
- 不自动删除任何「有值」的字段；不自动重命名用户字段。
- 不改 Task v2 字段契约本身，不改评论/文档链路。

## 3. 设计

### 3.1 字段能力表：schema 只增不改

日期列接受旧文本，新增清单仍建 datetime：

```js
{ key: 'startCol', name: '开始时间', type: 'datetime', accepts: ['datetime', 'text'] }
{ key: 'endCol',   name: '结束时间', type: 'datetime', accepts: ['datetime', 'text'] }
```

**理由**：插件只把日期投影成 `YYYY-MM-DD` 写入，不反向解析该列；原生开始/结束时间另走
`set_task_time`。text 列能存同样的值，迁移没有增量收益，却要新建字段、搬 20 条值、删旧列。

### 3.2 统一的 canonical resolver（消除四处重复）

把「重名时选哪个」收敛成一个纯函数，所有 ensure / set 共用：

```
resolveField(matches, { kind, accepted })
  → 1) 过滤 TYPES 且 accepted 包含该类型
    2) 0 个 → 失败「字段重名且没有可用类型」
    3) ≥2 个 → 按 guid 字典序取第一个（保证跨轮稳定）
    4) 返回 { target, duplicates, warning }
```

- 现状：`ensure_custom_field`（larkTasklist.js:196–207）和 `set_custom_field`（:268–278）各写一遍，
  日期与 eta 两条路径又各自决定要不要带 `allow_duplicates` —— 这正是这次漏掉的根因。
- 目标：**任何写受管字段的路径，都必须带 `accepted_types` + `allow_duplicates`，且走同一个 resolver**。
- 单测锁死：同一批重名，ensure 与 set 选中的 guid 必须相同。

### 3.3 写入用 GUID 钉住（阶段 2，性能 + 防漂移）

初始化成功后，把 canonical GUID 写进 `state.managedTasklist.fields[].guid`（已有）。
后续写回优先用 `field_guid` 而不是 name：

- 好处：不再每次 `set_custom_field` 都拉一遍完整字段分页（当前每次写都 GET 一次），也彻底绕开重名歧义。
- 失效处理：GUID 写失败（字段被删/换）→ 清掉该 guid，退回按名解析并重新 ensure 一次，**不盲目重试删除**。
- 类型安全：按 guid 写入时省略 `expected_type`，由后端按实际字段类型编码（larkTasklist.js:286–304 已支持）。

### 3.4 状态机与写回闸门

| 状态 | 含义 | 闸门 |
| --- | --- | --- |
| `uninitialized` | 还没检查 | 拦（正常） |
| `checking` | 正在检查 | 拦 |
| `ready` | 每个字段都有可用 canonical；warnings 允许存在 | 放行 |
| `unknown` | 有创建回执不明字段 | 只拦这些字段 |
| `failed` | 有字段无可用 canonical | 只拦这些字段 |

- `errors` 只保留「真正不可写」的字段；重复字段的提示进 `warnings`，不再把整体判死。
- 成功后清 `etaMissing` / `etaSyncError` / ready 相关的粘滞缓存，避免「昨天失败、今天还拦」。
- `lastError` 做去重：同一组错误连续出现时只保留一条 + 首次时间，不无限拼接。

### 3.5 重复字段的修复动作（人确认，非自动）

新增只读 `audit` + 受控 `repair`：

**audit（只读）**

对每个字段名分组，输出：

```json
{
  "name": "开始时间",
  "canonical": { "guid": "1194e1f7…", "type": "text", "values": 20 },
  "duplicates": [{ "guid": "2334a107…", "type": "text", "values": 0 }]
}
```

值计数来源：最近一次任务同步的 `state.tasks[].customFields`；若 `lastSyncAt` 超过 10 分钟，
先跑一次只读任务同步再审计（不跑 AI 阶段）。

**repair（需 `confirm: true`）**

删除条件（全部满足才删）：

1. 不是 canonical；
2. 值计数为 0；
3. 没有 `unknownDelivery`（删除回执明确）；
4. `confirm === true`，且请求里回传 audit 看到的 guid 集合（防审计后被换）。

流程：audit → 预览 → 确认 → 逐个 `delete_custom_field`（larkTasklist.js:250）→
重跑 `ensureManagedTasklist({force:true})` → 清理字段缓存 → 回写 `state.fieldRepairLog`
（保留最近 20 条：时间 / 清单 / 字段 / guid / 类型 / 值数 / 动作）。

**拒绝删除的情况**：canonical 本身为空、数据却在非 canonical 上 —— 只提示「数据在非规范字段，
需人工迁移」，不删、不猜。

### 3.6 面板与文案

- 设置页「受管任务清单」组（panel.html:3558）里，字段行增加：
  `重复 ×N`、`有值 N`、`规范 GUID`，以及一个 `整理重复字段` 按钮（仅当存在空重复项时可用）。
- 按钮先调 audit 展示预览，再二次确认才 repair；结果就地刷新检查状态。
- 错误文案带处理动作：`字段「开始时间」有 2 份定义且都不是可写类型；请点「整理重复字段」`。
- 同步历史里同一错误折叠，不把同一句重复 5 遍当 5 个错误。

## 4. 变更清单

| 文件 | 改动 | 风险 |
| --- | --- | --- |
| `tasklistSchema.js` | 日期列 `accepts: ['datetime','text']` | 低（只是放宽） |
| `index.js` | 日期写回 / eta ensure / eta set 带 `accepted_types + allow_duplicates` | 低 |
| `index.js` | audit / repair / 路由 / 快照字段 / 状态清理 | 中（repair 有删除） |
| `larkTasklist.js` | 抽出 canonical resolver，ensure/set 共用 | 中（协议层） |
| `panel.html` | 字段行展示 + 整理按钮 + 预览确认 | 低 |
| `test/*.mjs` | 重名选同字段、空重复才删、有值不删、未知回执不删 | — |
| `CONTRACT.md` | 补「重名字段处理」与「repair 只删空值」两条契约 | 低 |

## 5. 实施顺序（每步可独立回滚）

| 阶段 | 内容 | 产出 | 回滚 |
| --- | --- | --- | --- |
| 0 | 只读 audit（无 UI，先做脚本/路由） | 看清重复项与值分布 | 删路由即可 |
| 1 | 兼容读写（**已落地，随 3f9f956 提交**） | 同步恢复到 `ready` | revert 该提交里的 5 个文件 |
| 2 | canonical resolver + GUID 钉住 | 写入稳定、少一次 GET | revert 单文件 |
| 3 | repair 动作 + 面板按钮 | 清掉 3 个空重复字段 | 只影响已删的空字段（有留痕） |
| 4 | 文案/历史去重/面板诊断 | 不再刷屏 | 纯展示 |
| 5 | 真机验证 + 观察 24h | 验收数据 | — |

**阶段 1 已提交内容（3f9f956，5 个文件，测试全绿）**

- `tasklistSchema.js:17–18` 日期列接受 text；
- `index.js:4077` 日期写回 `accepted_types + allow_duplicates`；
- `index.js:4031 / 4056` eta ensure/set 容忍重名；
- `test/larkTasklist.mjs:175` 新增「重名选同一字段」「无可用类型仍失败」；
- `test/tasklistSchema.mjs`、`test/pr3Compatibility.mjs` 断言同步。

## 6. 测试计划

**单测 / 协议层**

1. schema：日期列 `accepts` 含 text；字段数仍为 12。
2. larkTasklist：两份 text 重名 + `accepted ['datetime','text']` → ensure 与 set 都选 guid 字典序第一个；
   两份都不被接受 → 失败且零写入。
3. eta 路径：重名 text 字段能 ensure + set，不再产生 `etaMissing`。
4. 闸门：一个字段失败不拦其它字段的写回；`unknown` 只拦对应字段。
5. repair：只删「非 canonical + 0 值」；有值/未知回执/审计后 guid 变化 → 拒绝；删除后重跑 ensure。

**真机**

1. 重新链接插件 + 重载，观察下一轮同步：`syncHistory.status === 'success'`，`managedTasklist.errors === []`。
2. `expectedAt` 待同步的 5 条在 1–2 轮内清空（`etaSyncPending=false`）。
3. audit 预览应正好列出：`2334a107…`、`a44b2c25…`、`822c792e…` 三个空重复项。
4. 确认后 repair：字段数从 15 → 12，再检查仍 `ready`，20 条开始时间值不变。
5. 24 小时内不再出现同一条 `lastError`。

## 7. 风险与回滚

| 风险 | 处理 |
| --- | --- |
| 放宽成 text 后，飞书侧按日期筛选能力弱 | 可接受（该列是投影）；新清单仍是 datetime |
| repair 误删有值字段 | 只删 0 值 + canonical 之外 + 审计后 guid 校验 + 留痕；有值一律不删 |
| GUID 钉住后字段被手工删除 | 写失败 → 清 guid → 按名解析 → 重新 ensure，不盲目建 |
| `ready + warnings` 掩盖真实失败 | `errors` 仍展示；只有 `unknownDelivery` 才升级为红 |
| 删除不可逆 | 删除前把完整字段清单（含 guid/type）写入 `fieldRepairLog`；必要时人工按名重建 |

## 8. 待拍板

1. 是否执行 repair，删掉 3 个空的重复字段？（推荐：是；不删也能跑，只是每轮带 warning）
2. 历史 text 日期列是否迁移成 datetime？（推荐：否）
3. 同一错误连续出现时，`lastError` 是否只留首条 + 累计次数？（推荐：是）

## 9. 验收标准

- 同步连续 3 轮 `success`，`managedTasklist.status === 'ready'`，`errors` 为空。
- 任务字段写回（开始/结束/预期完成）不再返回「字段重名」或「字段未就绪」。
- 面板字段区能区分「重复 / 有值 / 规范项」，repair 预览与实际删除一致。
- 20 条开始时间、任务数量、评论记录在修复前后完全一致。
