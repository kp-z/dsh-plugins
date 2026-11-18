# PLAN · 本地模式：把飞书 CLI 变成可选项

> 状态：**待 review，尚未改代码**
> 目标版本：dsh-cove-task v0.25
> 范围：不绑定飞书也能建任务、改任务、绑会话、排期、洞察；连接飞书后恢复同步。
> 明确不做：评论、文档、@人、子任务、附件（仅飞书可用）；本地任务推送回飞书（P2）。

---

## 1. 一句话

新增「本地模式」：飞书从**前提**变成**可选数据源**。

- 默认值仍是飞书模式 —— 老安装、老配置的行为不变（state.json 只多一个空的 `localTasks` 字段，旧版本不读它）。
- 用户在向导里选「先用本地」后，插件不再依赖 CLI：任务存在本地 state，面板/工具/排期/洞察照常工作。
- 连上飞书（授权成功）后切回飞书模式，拉取与合并恢复；现有的飞书任务继续以只读形式留在本地模式下，避免「任务突然消失」。

## 2. 非目标（这版不做）

| 不做 | 原因 |
| --- | --- |
| 评论 / 回复 / @人 | 纯飞书语义（出站账本、富文本、回执），本地没有可信的替代品 |
| 文档生成 / 绑定 / 读取 | 同上；本地任务只保留用户手填的链接文本 |
| 子任务 / 附件 | 只有飞书接口有 |
| 本地任务推送成飞书任务 | 需要 id 重映射（绑定/关系/排期/挂起都按 id 存），风险最高，放到 P2 |
| 飞书任务在本地模式下的「离线写队列」 | 会把「只读」变成半可用状态，语义不清；先不做 |
| 新增第三种 CLI 后端 | 不解决问题：问题在数据源，不在后端实现 |

## 3. 现状约束（读代码确认过）

1. **启动不依赖 CLI**：`apply()` 里的 `probeCli/checkAuth` 是 fire-and-forget，失败被 catch 掉，插件照常加载（index.js:12391、12591）。
2. **身份绑定飞书**：`task.id = raw.guid`，编号取飞书任务号（index.js:5061 附近的 `normalizeTask`）。
3. **写入绑定飞书**：21 个远端调用点（含读）直接调 `backend().actions/updateTask/complete/enrich`，见 §6 表。
4. **同步覆盖本地**：`state.tasks = kept.concat(localDone)`，本地未完成、未绑定的任务会在下一轮被冲掉（index.js:5289 / 5302）。
5. **空态绑定飞书**：面板空态写死「还没有任何任务 / 同步到飞书任务后…」（OverviewPanel.js:1330）。
6. **评论/文档/人员/清单**：全部经 backend，本地模式必须显式关闭，不能静默降级。
7. **本地能力已经存在**：会话绑定、DSH 自动化排期、工作区分组、关系、洞察、运行页都只读 `state`，不依赖飞书。

## 4. 关键设计决策

### D1 · 显式开关，不靠推断

`settings.taskMode: 'feishu' | 'local'`，默认 `'feishu'`。

- **不要**用 `state.auth.ok` 推断：网络抖动/授权过期会把用户瞬间切进本地模式。
- **不要**默认 `'local'`：老安装升级后行为变了，就是回退。
- 新装用户也默认飞书，但向导第 1 步提供「先用本地（不连接飞书）」；面板空态也提供该入口。

### D2 · 任务身份：origin + 前缀 id

- `task.origin = 'feishu' | 'local'`；缺省视为 `'feishu'`（老数据）。
- 本地 id：`local-<uuid短>`（`randomUUID().slice(0,8)`），**不复用飞书 guid 形态**。
- 本地任务 `no = 0`、`feishuTaskId = ''`、`tasklistGuid = ''`、`customFields = []`、`members = []`。
- 标题仍走 `decorateTitle/withTaskNo`：`no=0` 时天然不带 `T<n>-`，不会和飞书号撞车。
- **不发明 L1/L2 编号**：`resolveTaskRef` 已支持 guid/标题片段；本地任务靠标题定位即可，避免两套编号语义。

### D3 · 存储：内存一份、落盘两把 key（回退安全的关键）

`state.json`：

```json
{ "tasks": [飞书任务], "localTasks": [本地任务], "...": "其余不变" }
```

- `load()`：读 `tasks` + `localTasks`，**合并进内存的 `state.tasks`**，本地任务补 `origin='local'`，其余补 `'feishu'`；合并后 `delete state.localTasks`，避免 `/api/state` 里出现两份。
- `persistState()`：按 `origin` 拆回 `tasks` / `localTasks` 两个 key 再写盘。
- **必须同时修一处旧逻辑**：`load()` 的「本端口还没状态就继承上一个状态文件」条件是 `savedState.tasks.length === 0`（index.js:3244 附近）。只有本地任务时 `tasks` 也是空的，会被误判成新端口并继承旧文件、覆盖本地任务。条件要改成 `tasks.length === 0 && localTasks.length === 0`。
- 为什么不是单一 `tasks` 数组：**降级回旧版本时，旧代码只读 `tasks`，看不到也不会删掉 `localTasks`**，本地任务不会在降级后的第一轮同步里消失。
- 内存里只有一份 `state.tasks`，所以 100+ 处查找/统计/渲染不用改。
- `snapshot()` 不额外暴露 `localTasks`（避免 /api/state 重复一倍体积）。

### D4 · 写入按任务来源分流，不伪造 backend

- 本地任务：所有远端写 helper 在**最前面**短路，返回 `{ ok: true, localOnly: true }`，**由调用方继续完成本地状态变更**（保持现有「本地先写」的顺序）。
- 飞书任务：代码路径完全不动（包括 creation ledger、tasklist、评论账本）。
- 不新增「local backend」：backend 抽象一次请求就是整份快照（`listTasks`），硬塞本地任务会让 `checkAuth/清单/回执` 这些飞书专属语义变形；按任务来源分流更小、更可测。

### D5 · 本地模式下飞书任务只读

- 仍然显示（带「未连接」徽标），避免「切一下模式任务全没了」的惊吓。
- 用户主动写：返回明确错误「这是飞书任务；本地模式下只读，连接飞书后可编辑」，**不悄悄排队、不假装成功**。
- 后台自动化（归档自动完成、重开、自动开工、各类重试）：**静默跳过**飞书任务，不能每轮刷错误。
- 切回飞书模式后一切恢复；下一轮同步刷新快照。

### D6 · 同步管线按模式分支

`sync()` 同时承担「同步 + 到点开工 + 自动完成 + 指标」，所以不能在顶层 return。改成按阶段开关：

| 阶段 | 飞书模式 | 本地模式 |
| --- | --- | --- |
| CLI 检查 | 跑 | 跳过（不 spawn 子进程） |
| 任务同步 | 跑 | 跳过（保留现有任务） |
| 清单初始化 | 跑 | 跳过 |
| 预期/关系/挂起/工作区重试 | 跑 | 跳过飞书任务，仅本地 |
| 文档同步 / 评论协作 | 跑 | 跳过 |
| 归档自动完成 / 逾期归因 / 自动开工 | 跑 | **照常跑**（本地任务需要） |
| `state.lastSyncAt` | 更新 | 不更新（它表示「飞书同步于」） |

### D7 · UI：复用现有向导，React 面板只加轻量入口

- 右侧栏（panel.html）是唯一配置面：第 1 步加「先用本地」按钮 + 当前模式显示；不复制一套设置页。
- React 面板：
  - 空态按模式给两个入口：「新建任务」「连接飞书」。
  - 顶栏加模式徽标（本地 / 飞书），点击打开右侧栏向导。
  - 任务卡对本地任务显示「本地」标记；对本地模式下的飞书任务显示「未连接」。
  - 评论/文档按钮对本地任务置灰并提示「连接飞书后可用」（不隐藏，避免布局跳动）。
- **连接流程（不做隐式切换）**：
  1. 空态「连接飞书」→ 只打开右侧栏向导，**不改模式**；
  2. 向导里授权成功（`state.auth.ok===true` 且当前 `taskMode==='local'`）时，显示一个「切换到飞书任务」按钮；
  3. 点了才调 `POST /api/task-mode`。这样授权失败或半途放弃不会把用户卡在飞书模式、也不会让本地任务突然只读。
- **快照投影**：`overviewView()` 每条任务补 `origin`；顶层补 `mode: { task, connected, authDetail, cliFound }` 与 `priorityOptions`；`revision` 哈希必须包含 `mode` 和 `task.origin`，否则切模式后页面不会自己刷。
- 右侧栏旧面板（panel.html）的「同步状态」在本地模式显示「本地模式（未连接飞书）」，不显示上次同步时间。

## 5. 数据结构与迁移

### 新增字段

| 位置 | 字段 | 默认 | 说明 |
| --- | --- | --- | --- |
| settings | `taskMode` | `'feishu'` | `'local'` 时新建走本地、不同步 |
| state.json | `localTasks` | `[]` | 仅落盘；内存合并进 `state.tasks` |
| task | `origin` | `'feishu'` | 缺省按飞书任务处理 |
| overview 快照 | `mode` | — | `{ task, connected, authDetail, cliFound }`，客户端据此切空态 |
| SERVER_FEATURES | `'tasks.local'` | — | 新客户端识别宿主是否支持；旧宿主没有就退回旧 UI |

### 迁移

- **不需要迁移脚本**：
  - 老 `state.json` 没有 `localTasks` → 空数组；任务没有 `origin` → 按 `'feishu'`。
  - 老 `settings.json` 没有 `taskMode` → sanitize 补 `'feishu'`。
- 首次切到本地模式时，额外把 `state.json` 复制为 `state.json.bak-local-<yyyymmdd>`（只此一次，纯保险）。

### 不变量

1. `state.tasks` 里本地任务的 id 一定以 `local-` 开头且 `origin==='local'`；落盘时交叉校验，坏数据按前缀归类。
2. `localTasks` 里的任务不得出现在 `tasks`；反之亦然。
3. 飞书任务在本地模式下的状态变更只能来自「同步」；本地模式不产生任何远端写。

## 6. 写回点改造清单

> 行号以当前 HEAD（acef515 + 工作区未提交改动）为准；实现时以函数名为准。

| # | 函数（行） | 现状 | 本地任务 | 飞书任务 + 本地模式 |
| --- | --- | --- | --- | --- |
| 1 | `writeTaskStartTime` (3989) | set_task_time 成功后写 startTs | 直接写 startTs/start，返回 localOnly | 用户动作报错；后台跳过 |
| 2 | `ensureEtaField` (4025) | ensure_custom_field | 短路 | 报错/跳过 |
| 3 | `writeEtaToFeishu` (4050) | set_custom_field，失败挂 pending | 返回 `{ok:true, skipped:'local'}`，不挂 pending | 报错；不挂 pending |
| 4 | `writeDateColumn` (4071) | set_custom_field | 短路 | 报错 |
| 5 | `applyTaskCompletion` (8982) | backend().complete + 结束时间写回 | 跳过 complete，只写 done/status/endAt/completedAt | 报错（用户动作）；归档自动完成跳过 |
| 6 | `writeTaskReopen` (5918) | task_reopen | 立即清 reopenPending/reopenAwaitingList | 报错；后台跳过 |
| 7 | `renameTask` (7509) | updateTask 成功后改 title | 直接改 title + 会话名 | 报错 |
| 8 | `setTaskPriority` (9903) | ensure+set，失败回滚 | 直接改 priority/customFields | 报错 |
| 9 | `writeSuspensionField` (7641) | set_custom_field | 短路（挂起本来就在 `state.suspensions`） | 跳过，不标 fieldPending |
| 10 | `refreshTaskRelations` (6033) | task_dependencies 读 | 短路（关系只在本地） | 跳过 |
| 11 | `writeTaskRelations` (6056) | 读+写飞书原生依赖 | `relationSync={localOnly:true}` | 跳过，标 localOnly |
| 12 | `writeWorkspaceField` (9744) | set_custom_field | 只改本地 customFields，返回 localOnly | 跳过，不排重试 |
| 13 | `syncWorkspaceTitles` (9830) | 批量写 | 过滤掉本地任务 | 过滤 |
| 14 | `fillWorkspaceFields` (9871) | 批量写 | 过滤 | 过滤 |
| 15 | `ensureWorkspaceOptions` (9574) | ensure_custom_field | 过滤 | 跳过 |
| 16 | `repairTitleNumbers` (9618) | updateTask | 过滤（无编号可修） | 跳过 |
| 17 | `normalizeTaskTitles` (8828) | updateTask | 直接本地改名 | 跳过 |
| 18 | `applyOkrLabels` (10471) | set_custom_field | 写 task.objective/keyResult/customFields | 报错 |
| 19 | `syncTaskFields` (10018) | 双向字段同步 | 只写本地 | 报错 |
| 20 | `loadTaskDetail` (9319) | 读评论/子任务/附件 | 返回空 + `local:true` | 返回空 + `local:true`（本地模式） |
| 21 | 文档/评论相关（`pushDocField`、`bindTaskDoc`、`writeTaskComment`、`commentProgress`…） | backend | 明确不可用 | 明确不可用（本地模式） |

**写回之外还要改的过滤点**（后台循环，避免刷错误）：
`retryEtaWrites`、`retryWorkspaceWrites`、`retryTaskReopens`、`retryDocFields`、`syncWorkspaceTitles` 的入口、`applyArchivedSessions`、`autoStartNewTasks`、`reopenSessionTasks`、`pushTaskChanges`、`attributeOverdueTasks`（涉及飞书写回的部分）。

## 7. 创建路径

### 7.1 本地建任务（无会话）

新增 `localTasks.js`（纯函数 + 形状），index.js 里加 `createLocalTask(input)`：

- 输入：`title`（必填，≤60 字）、`description`、`priority`、`workspaceId`、`dueAt`（可选）。
- 生成：id `local-xxxx`、`origin='local'`、`no=0`、`createdAt`、`members/customFields/docs=[]`、`meta.workspace`（来自 workspaceId）。
- 关系/工作区：校验后写 `state.relations` / `state.workspaceLinks`，**不写 workspaceWrites、不排任何远端写**。
- 返回形状与现有创建一致：`{ok, taskId, title, workspace, relations}`。

### 7.2 从会话建任务（`createTaskFromSession`，6844）

在最前面加本地分支，位置在「关系校验 / 工作区推断」之后、「ensureManagedTasklist」之前：

- 复用：requestKey 校验（改为进程内 Map 去重，TTL 10 分钟，不落盘）、boundTask 校验、`updateRelations` 预检、creationWorkspace 推断。
- 跳过：`taskCreationLedger`、`ensureManagedTasklist`、`defaultsFromState`、`scope.createTask`、`task_get` 取号、改标题、加清单、关系写回、`queueWorkspaceWrite`。
- 保留：会话绑定语义（`sessionId`、`started`、`startedAt`、`linkSource`、`isNew`）、工作区绑定、关系落库、`persistState`、会话改名。
- 标题：`decorateTitle`（无编号），保留用户输入的表情。

### 7.3 删除本地任务（P0 必做，否则「能用」不成立）

新增 `deleteLocalTask(taskId)`（仅本地任务；飞书任务不提供）：

- 清理：`state.tasks`、`relations`（所有触及该 id 的边）、`bindings`、`suspensions`、`workspaceLinks`、`workspaceWrites`、`relationSync`、`schedules`（含对应 DSH 自动化的解绑提示）、`delayAttributions/delayAttempts`、`sessionSeen`（不清，按会话存）。
- 会话不删、只解绑（用户的会话内容不能因为删任务而消失）。
- 卡片菜单加「删除」+ 二次确认；HTTP `POST /api/tasks/delete`；`cove_task_create` 不涉及。

## 8. 同步改造（`applyTaskSync`，5225）

```text
if (taskMode === 'local') return { ok: true, skipped: 'local' }

... 拉取远端（不变）...

const localTasks = state.tasks.filter(t => t.origin === 'local')   // 原样保留
const merged = kept.concat(localTasks, localDone)
```

- 本地任务**不参与** `filterTasks`（采集关键词/截止过滤只管飞书任务）。
- `auditBindings(merged)` 覆盖本地任务（会话绑定仍然唯一）。
- 远端关系采纳循环只遍历 `kept`（已是），本地任务的原生依赖不存在。
- **跨来源关系**：只要一条边触及本地任务，就永远只落本地（飞书原生依赖里没有本地 id 可言）。`writeTaskRelations` 需要先过滤掉本地端点；有被过滤的边就把 `relationSync` 标成 `localOnly`，不能把 `local-xxx` 发给飞书接口报错。
- `state.tasks = merged`；`persistState` 拆分落盘。
- 模式切换竞态：`applyTaskSync` 捕获 `modeAtStart`，中途变化则像 `backendId` 一样返回 `stale`，不发布旧快照。

## 9. 工具与 HTTP 行为

| 工具 | 本地模式 + 本地任务 | 本地模式 + 飞书任务 |
| --- | --- | --- |
| `cove_tasks` | 正常（本地任务） | 正常（只读展示） |
| `cove_task_detail` | 正常，评论/子任务/附件返回空 + 说明 | 正常，同上 |
| `cove_sync` | `{ok:true, skipped:'local'}`，文案「本地模式：未连接飞书」 | 同左 |
| `cove_task_create` | 本地创建 | 本地创建 |
| `cove_task_comment` / `cove_comment_reply` | 明确错误「本地任务没有飞书评论」 | 明确错误 |
| `cove_task_mentions` | 明确错误 | 明确错误 |
| `cove_task_doc` / `cove_doc_read` | 明确错误 | 明确错误 |
| `cove_task_report` | 完成本地任务；`summary` 改为 warning（不写评论） | 报错 |
| 洞察「写入评论」(`exportInsight`) | 明确错误「本地模式不写评论」 | 同左 |
| `cove_task_eta` / `schedule` / `suspend` / `relations` / `plan_today` / `insight` | 正常 | 只读/报错（见 §6） |

HTTP：
- `POST /api/task-mode`（新）：切换模式，返回 snapshot；切到飞书时触发 `probeCli + checkAuth + sync`（fire-and-forget）。
- `POST /api/tasks/create`（新）：本地建任务。
- `POST /api/tasks/delete`（新）：删除本地任务。
- `GET /api/overview`：新增 `mode`、`priorityOptions`、每条任务的 `origin`。
- `GET /api/health`：本地模式不探测 CLI，`cli: null`，加 `mode`。

### 9.1 文案与默认值（容易漏，单独列）

- 工具描述里「飞书任务」→「任务（本地或飞书）」：`cove_tasks`、`cove_task_detail`、`cove_task_create`、`cove_sync`。
- `label(task)`：本地任务返回「本地」而不是「T?」（index.js:7455）。
- `autoStartPrompt` 默认值写着「你有一条来自飞书的任务」。改为中性措辞，并把当前默认加进 `LEGACY_AUTO_START_PROMPTS`，只迁移仍是默认值的用户。
- 系统提示段 `feishu:task-context` → `cove:task-context`，文案改成「任务上下文」（本地任务也适用）。
- 失败文案统一：本地任务「本地任务不支持 X」；本地模式下的飞书任务「本地模式下只读，连接飞书后可编辑」。
- `README.md / README.zh.md / CONTRACT.md`：加「本地模式」章节、`taskMode` 契约、新的工具行为表。

### 9.2 打包

- 新增 `localTasks.js` 必须加进 `package.json` 的 `files`，否则安装后宿主 import 失败（`test/packageFiles.mjs` 会抓到）。
- 无新增客户端构建文件时不动 tsdown；新客户端源文件按 `src/client` 既有规则直出。

## 10. 测试计划

新增（都走 `test/isolatedHome.mjs` + 假 ctx，不碰真 CLI）：

1. `test/localModeStore.mjs`：`localTasks.js` 纯函数 —— id/标题/形状、split/merge 幂等、坏数据归类。
2. `test/localModeCRUD.mjs`：建 → 改标题 → 优先级 → 预期 → 开始时间 → 完成 → 重开 → 挂起/恢复 → 工作区绑定 → 关系 → 删除；全程断言 **零 backend 调用**（用会抛错的假 CLI 证明没 spawn）。
3. `test/localModeSync.mjs`：state 里同时有飞书任务和本地任务；用假 CLI 返回 2 条远端任务跑 `sync`；断言本地任务保留、远端更新、关系/绑定不断、`localTasks` 落盘正确。
4. `test/localModeTools.mjs`：17 个工具在本地模式下的返回；评论/文档工具必须报明确错误，不能 ENOENT。
5. `test/localModeCompat.mjs`：老 state（无 origin/localTasks）+ 老 settings（无 taskMode）加载后按飞书模式工作；模拟「降级」只读 `tasks` 不丢 `localTasks`。
6. `test/localModePanel.mjs`：空态/模式徽标/创建表单的纯视图断言（仿 `test/overviewPanel.mjs`）。

回归：
- 现有 110 个 JS 测试 + 7 个 Python 测试必须全绿；重点 `smoke`（真飞书）默认仍是飞书模式，不应变化。
- 设置面板回归（`setupPanelRegression`）、`client.mjs`（客户端契约）、`meta/packageFiles`（新增文件打包）。
- `test/offline.mjs` 会把新文件纳入，确认没有真 CLI 依赖。

## 11. 实施顺序（每步都可单独 review）

| 阶段 | 内容 | 依赖 | 风险 |
| --- | --- | --- | --- |
| P0-a | `localTasks.js`（含 package.json files）+ settings/load/persist 拆分 + origin 迁移 + 继承误判修复 | 无 | 低（不改飞书路径） |
| P0-b | 21 个远端调用点 + 后台循环过滤（飞书任务只读） | P0-a | 中（逐个函数，需测试钉住飞书路径不变） |
| P0-c | 本地创建 / 从会话创建 / 删除 | P0-a/b | 中 |
| P0-d | 同步管线按模式分支 + 合并保留 + revision/mode | P0-a | 中（必须先于任何本地任务产生） |
| P0-e | React 空态/徽标/创建表单/置灰 + panel.html 模式入口 | P0-a/c | 中 |
| P0-f | 工具文案与错误 + 默认提示词迁移 + README/CONTRACT | 全部 | 低 |

> 建议：P0-a～P0-d 先在**同一分支**落地，UI 未接之前 `taskMode` 只能通过设置文件改，用户无感；P0-e 才真正暴露入口。发布前跑完整 `pnpm test` + 真机（真飞书）smoke。

## 12. 兼容与回退

| 场景 | 行为 |
| --- | --- |
| 老 state / 老 settings | 按飞书模式，等同现状；无迁移脚本 |
| 老客户端 + 新宿主 | 多出的字段被忽略；空态文案旧但可用（仅当用户手动切 local 才看得到） |
| 新客户端 + 老宿主 | `overview.mode` 不存在 → 客户端沿用旧空态，不渲染新入口 |
| 降级回旧版本 | 旧代码只读 `tasks`，`localTasks` 保留不删；升级回来本地任务还在 |
| 飞书授权失效 | 仍是飞书模式，报现有错误；用户可手动切本地 |
| 切本地时正在同步 | `applyTaskSync` 捕获模式变化 → stale，不发布旧快照 |

**红线**：
- 飞书模式下，所有现有代码路径不得改变（用现有测试 + 新增「假 CLI 调用序列」断言钉住）。
- 任何本地分支不得调用 `backend()`、`resolveCli`、`runCommand`、`taskCreationLedger`。
- 不得改 `backendFor` / CLI 安装授权逻辑。

## 13. 自审：我担心的地方

1. **UI 工作量被低估**：空态+创建表单+徽标+置灰按钮，实际可能比宿主改造还久。建议 P0-e 先做「空态 + 新建 + 徽标」，创建表单用最简字段（标题/优先级/工作区），截止时间放 P1。
2. **本地模式下飞书任务只读**是产品取舍：如果用户希望「有 CLI 就还能改」，那就要做离线写队列；这版明确不做，需你确认。
3. **21 个远端调用点的逐个改**容易漏：用「本地任务 id 前缀 + 一个 `assertNoRemote(task)` 测试钩子」兜底（测试里给 backend 装一个会抛错的桩，任何漏网调用直接失败）。
4. **删除本地任务**要清 8 张表，漏一张就会出现幽灵（关系图上的空节点、排期指向不存在的任务）。测试里逐表断言。
5. **面板/独立页两套渲染**共用同一份 api，不会漂；但 `panel.html` 是旧代码，只加最小入口，不重构。
6. **仓库当前有 22 个未提交条目**（v0.24 后续改动）。开工前应先提交/切 worktree，别把这次改动混进未提交的 WIP。

## 14. 需要你拍板的 4 个点

1. 新模式默认值：**飞书（零回退）**，向导给「先用本地」；还是新装默认本地？
2. 本地模式下飞书任务：**只读 + 徽标**（本文方案）/ 隐藏 / 有 CLI 仍可编辑？
3. 本地任务编号：**不编号（no=0）** / L1、L2 本地号？
4. 评论、文档按钮对本地任务：**置灰 + 提示** / 直接隐藏？

## 15. 验收标准

- 全新 `DSH_HOME`、不装任何 CLI：插件能加载，向导可选「先用本地」，能建任务、绑会话、开工、排期、看洞察、改状态、删除。
- 同一份数据切到飞书模式并授权：远端任务出现，本地任务仍在；再切回本地，飞书任务以只读出现。
- 降级到改动前的版本运行：`tasks` 原样，`localTasks` 未被读取或删除。
- 现有测试全绿，真飞书 smoke 不回归。
