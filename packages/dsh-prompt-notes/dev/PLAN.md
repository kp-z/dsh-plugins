# @kpeace/dsh-prompt-notes 开发计划

> 这份文档由**定时任务**反复读取和更新。每次运行：先读本文件和 `DEVLOG.md`，再动手；结束前更新两者。
> 位置：`packages/dsh-prompt-notes/dev/`（不进 npm 包）。

## 0. 现状（v0.3.0，2026-11-20 晚，M1–M9 全部完成）

插件在右侧栏提供一本横向拟物便签簿。便签有 3 种：提示词 / 技能 / MCP；3 种作用域：全局 / 工作区 / 单个会话；「系统」页读出系统自带的注入内容。

- **M8、M9 已完成（2026-11-20 晚）**：包清单核对（21 个文件，解到 /tmp 后单独 `import` 成功）、README 中英重写并补齐 M2–M7 的功能、`preview.svg` 按简约后的外观重画、locale 简介对齐、`CHANGELOG.md`、版本 0.3.0；最终回归：单测 60、smoke 8、scope 24（+1 SKIP）、share 15、robust 8 全绿。最终报告见 `DEVLOG.md` 末条。
- 已验证（真实隔离实例，`node test/e2e/smoke.mjs` 7/7）：路由、提示词进入真实组装的 system prompt、技能进入真实 `skills.list`、MCP 经真实 `mcpManager` 连上测试桩并进入真实工具列表、总开关撤回、删除撤回。
- **已在真实会话里验证（M1，`node test/e2e/scope.mjs` 24 项通过 + 1 条 SKIP 说明）**：会话级 / 工作区级 prompt 与 skill 只对适用会话生效；面板状态相对观察者正确；会话级 MCP 随会话生死（活着才起进程）；重启后的冷会话恢复时 session 级 skill 提供方与 MCP 都会重新挂上。
- **M7 已完成（2026-11-20 上午）**：技能便签多了 `whenToUse`（可选）与调用策略（`invocation`：两者 / 仅模型 / 仅用户，默认两者且不进文件）；真实 `skills.list` 已验证带回来；编辑页只多了一个可选输入框与一个三选一的分段控件。单测 60。
- **M6 已完成（2026-11-20 上午）**：删除进回收站（最近 50 条 / 30 天，面板可撤销）；200 条便签时 `/state` 中位 3.6ms、真实 `assemble` 6.2ms；数据文件写坏不会崩（坏文件留备份，修好即恢复）；纸条不再是「按钮里套按钮」，页签支持方向键、弹层有焦点陷阱与 Esc；`prefers-reduced-motion` 有回归测试（它当场抓到漏掉的 `.pn-pin-shadow`）；中英文案 key 一致性 4 条测试、reduced-motion 1 条。单测 57。
- **M5 已完成（2026-11-20 上午）**：`GET /export` 导出一组 / 全部为 `{format:'@kpeace/dsh-prompt-notes',version:1}`；`POST /import/preview` 只算「会发生什么」（新建 / 重命名 / 覆盖 / 跳过 + 将被执行的 MCP 命令），`POST /import` 才写；冲突默认重命名；导入的 MCP 一律未钉住；面板里只加了一个图标入口。真实实例回环 15 项全绿（含「导入的提示词真的进了 assemble 结果」）。单测 50/50。
- **M4 已完成（2026-11-20 上午）**：助手有了 4 个工具（`note_list / note_create / note_update / note_delete`），真实会话里的工具数 40 → 44；助手建的 MCP 便签一律未钉住，且不能改 MCP 便签的启用 / 命令 / 作用域。校验与重名判定与 HTTP 端共用 `src/mutations.js`（从路由层抽出来的）。单测 41/41。
- **M3 已完成（2026-11-20 上午）**：外观做了一轮减法——去掉噪点纹理 / 胶带 / 回形针，纸条倾斜减半（0.55° → 0.24°），纸条投影 2 层 → 1 层，和纸胶带的锯齿改用一条素色左标，图章不再旋转、不再正片叠底；面板 ≤340px 时页签计数自动退场，中文 / 英文在 300 / 380 / 560px 都不横向溢出。删掉 4 组冗余文案（见 DEVLOG）。
- **M2 已完成（2026-11-20 凌晨）**：①MCP 只在存在适用的活动会话时才登记（会话关掉就撤进程，恢复会话再起）；②连上之后对不适用的活动 agent 调 `tools.restrict({deny})`，把 `mcp__<名>__*` 从它的工具列表里真正藏起来（真实实例里已验证：主人的 `/system` 看得到、另一个会话看不到）；③`tools.guard` 保留为调用时刻的兜底。单测 35/35，`node test/e2e/scope.mjs` 24 项通过 + 1 条 SKIP 说明。
- **仍未在真实系统里验证**：`tools.guard` 真正拒绝一次 MCP 工具调用（需要模型发出 tool call，e2e 不调模型；判定逻辑由单测覆盖）。现在这条的重要性降低了——工具已经不在列表里，模型想调也没有这个名字。
- 35 项单测，其中假 ctx 已复刻 Cordis 的「未声明依赖就取服务会抛错」约束（曾因此漏掉两个真实 bug，见 DEVLOG）。

## 1. 铁律（违反即停手并记入 DEVLOG）

1. **只在隔离实例里测试**：`scripts/e2e.sh`（`DSH_HOME=/tmp/pn-test-home`，端口 48990）。**绝不**触碰 `~/.dsh`、`desktop` / `web` profile，**绝不**占用或停止端口 52559（用户正在用的 DSH）。
2. **不要用 `plugin_manager` 工具**——它操作的是当前正在运行的用户 profile。装插件只用 `scripts/e2e.sh run plugin --profile web add …`。
3. **只改 `packages/dsh-prompt-notes/`**。仓库里别的包（@kpeace/dsh-cove-task、@kpeace/dsh-spellbook、dsh-feishu…）有用户的未提交改动，一个字也不要动；`pnpm-lock.yaml` 也不碰。
4. **不 git commit / push / 切分支 / stash / reset**。成果留在工作区，用 `DEVLOG.md` 记录。
5. **不要向用户提问**。拿不准就选更保守的做法，把理由写进 DEVLOG。
6. 测试用到的临时文件放 `/tmp`，用完删；每次运行结束前 `scripts/e2e.sh stop`。
7. 不读、不打印任何令牌 / 密钥；测试 URL 里的 token 只用于隔离实例，不写进文档。
8. 当前模型若不能看图，不要尝试截图判断观感——用 DOM 度量（尺寸、溢出、`getComputedStyle`、对比度计算）代替，并在 DEVLOG 里注明「观感未经人眼确认」。

## 2. 每次运行流程

1. `date` 记下开始时间。读本文件、`DEVLOG.md` 最后 3 条。
2. 基线：`npm test`、`npm run check` 必须先绿；起隔离实例 `scripts/e2e.sh start`（首次需要 `setup`），`node test/e2e/smoke.mjs` 必须先绿。基线不绿 → 先修，这是本次第一件事。
3. 取清单里**第一个未完成的里程碑**（见 §4）。按「设计 → 开发 → 测试 → 验收」走完；每步产出写进 DEVLOG。
4. **用满时间但别超时**：每次运行目标 60–80 分钟。已过 65 分钟就不要开新的子项，收尾。
5. 收尾：更新 §4 的勾选与 §5 缺陷表；追加 DEVLOG 条目；`npm test`、`npm run check`、e2e 全绿；`node demo/build.mjs`（若改了前端）；`scripts/e2e.sh stop`；清理 `/tmp` 里自己建的东西。
6. 全部里程碑完成后：本计划不再有新工作——只做回归 + 把 DEVLOG 的「最终报告」写完整，之后的运行直接回复「已完成，无新工作」并结束。

## 3. 设计原则

- **少文字**：能用图形 / 状态 / 悬停提示表达的，不要写成句子；一个提示最多一行；没人会读的文案直接删（「如无必要，勿增实体」）。新增任何文案前先问：删掉它用户会迷路吗？
- **简约**：用户对当前外观的评价是「挺好，可以稍微再简约一点」。方向是**减法**——收敛纹理、倾斜幅度、装饰（胶带 / 回形针等）、字体种类；不要加新装饰。保留：图钉 = 开关、图章 = 作用域、纸色 = 类型。
- **拟物但克制**：纸、图钉、图章是插画，用字面色；「桌面」用主题 token（`--dsw-alias-*`），明暗主题都要读得清。纸上文字对比度 ≥ 4.5。
- **安全默认**：MCP 便签默认未钉住；任何「导入 / 助手创建」的 MCP 便签一律未钉住；写接口保留自定义头 + 拒绝跨站。
- 所有新增的用户可见文字必须中英文齐全。

## 4. 里程碑（按顺序做，做完打勾）

每项的验收 = 单测 + 隔离实例里的真实检查（能自动化的写进 `test/e2e/`）。

- [x] **M1 真实会话里的作用域验证**（最高优先级）— 2026-11-20 完成，见 DEVLOG
  - 设计：在隔离实例里创建真实会话（浏览器里点「新对话」，从 URL / 会话列表拿 id），工作区靠「用不同 cwd 启动实例」或在会话里切换目录。`scripts/e2e.sh start` 增加 `PN_TEST_CWD`（启动前 `cd`）。
  - 开发：把真实会话的检查写进 `test/e2e/scope.mjs`：①会话级提示词只在该会话的 `/system?session=` 里出现；②工作区提示词按会话 cwd 出现 / 不出现；③会话级 skill 只在该会话的 `skills.list` 里（验证 `agent.ctx.inject(['skills'])` 真能挂上，日志无 “without inject”）；④`tools.guard`：对不适用的会话，调用 `mcp__<名>__*` 被拒（找到不调模型也能触发工具调用的办法；若必须调模型就放弃并在 DEVLOG 说明，改为验证 guard 的返回值逻辑）。
  - 验收：`scope.mjs` 全绿；发现的真实 bug 全部修掉并补单测。
- [x] **M2 MCP 精细化**（2026-11-20 完成，见 DEVLOG）：①只在存在「适用的活动会话」时才登记工作区 / 会话级 MCP；②连接成功后对不适用的 agent 用 `tools.restrict({deny})` 把工具从列表里藏起来（注意：`restrict` 要求工具名已存在且只能在 `agent.ctx` 上用；连接状态变化要重算）；③保留 `guard` 作为兜底。验收：真实实例里不适用的会话工具列表里看不到 `mcp__<名>__*`（`/system` 的 `tools.mcpCount` 随观察者变化）。**已达标**：`scope.mjs` 里主人的 `mcp[].tools ≥ 1`、另一个会话 `tools.mcpCount = 0`。
  - 进展（2026-11-20）：①已实现——`mcpWanted` 判定 + 在现有 poll tick 里比对「活动会话签名」变化（不依赖未文档化的销毁事件），单测与真实实例的三态（活 → 冷 → 恢复）都验证过。剩下的②是 `tools.restrict`：必须等连接成功拿到工具名之后才能跑，并且要随连接状态 / 会话 / cwd 变化重算。
  - 预研（2026-11-20，M1 之后）：①的名字 ↔ 便签是 1:1（`conflict()` 已保证 MCP 名全库唯一），所以「该不该登记」只看那一张便签的 scope，**不需要引用计数**：global 总是登记；workspace 看「有没有活动 agent 的 cwd 在 target 之内」；session 看「该 id 在 `agents.list()` 里」。检查点别依赖未文档化的销毁事件（`agent-lifecycle.md` 里只有 `agent/created` 一类创建事件），直接在现有 2 秒 `store.poll()` 的 tick 里多跑一次 `reconcileMcp` —— 幂等、自愈、不新增定时器。`svc.agents` / `svc.workingDirectory` 缺席时（假 ctx）退化为「总是登记」，保持 v0.2 行为。②必须排在①之后：①让「没有活动会话」的 MCP 根本不启动，②只处理「两个会话都活着但只有一个适用」的残余。
- [x] **M3 外观简约 + 文字精简**（2026-11-20 完成，见 DEVLOG）：
  - 设计：先在 `demo/` 里做 2 个减法方案（如 A = 现状去掉胶带 / 回形针 / 噪点纹理、倾斜减半；B = 在 A 基础上再收敛字体与图章），写进 DEVLOG 对比；自己选一个并说明理由（用户不在场，不要等待）。
  - 开发：实现所选方案；盘点 `client.js` 的 `STR` 里所有文案，逐条判断能否删 / 改成图标 + `title`；编辑页的提示条（`skillHint`、`mcpScopeHint`、`budgetNote`…）能删则删。
  - 验收：对比度全部 ≥ 4.5；380 / 300 / 560px 无溢出；中英文标签栏都放得下；`demo.html` 重新构建；DEVLOG 里记录删了哪些文案。
- [x] **M4 助手工具**（2026-11-20 完成，见 DEVLOG）：`note_list` / `note_create` / `note_update` / `note_delete`（`ctx.tools.register`，schema 严格；复用 `parseNoteInput`、`conflict`；助手创建的便签 `kind:'mcp'` 强制 `enabled:false`；`note_update` 不能把 MCP 改成启用；删除 / 更新有数量与长度上限）。验收：单测 + 真实实例里 `/system` 的工具数增加（工具定义里 `description` 要写清楚「不能启用 MCP」）。
- [x] **M5 分享（导入 / 导出）**（2026-11-20 完成，见 DEVLOG）：导出一张 / 一组 / 全部为 JSON（`format: '@kpeace/dsh-prompt-notes'`、`version`）；导入先**预览**再确认；冲突策略（同 id / 同 skill 名 / 同 MCP 名 → 跳过 / 重命名 / 覆盖，默认重命名）；导入的 MCP 一律未钉住并在预览里显示将执行的命令；校验与大小上限；UI 入口克制（一个菜单项，不加新页签）。验收：单测（含恶意输入）+ e2e 导出再导入回环。
- [x] **M6 稳健性与无障碍**（2026-11-20 完成，见 DEVLOG）：①软删除 + 撤销（保留最近 N 条，文件里 `trash` 区，30 天或 50 条）；②200 条便签的渲染与接口性能（度量并记录）；③数据文件损坏 / 手改写坏在**真实实例**里的恢复行为；④键盘可达（标签页方向键、弹层焦点陷阱、Esc）、嵌套交互元素（纸条 `role=button` 里含图钉按钮）的处理；⑤`prefers-reduced-motion`；⑥中英文文案 key 一致性单测。
- [x] **M7 技能字段补全**（2026-11-20 完成，见 DEVLOG）：`whenToUse`（写进 `SkillCandidate`）、调用策略（模型可调用 / 用户可调用，对应 `invocation`）；编辑页只加必要的控件（遵守少文字原则）。验收：真实 `skills.list` 能看到字段。
- [x] **M8 打包与文档**（2026-11-20 完成，见 DEVLOG）：`npm pack --dry-run` 文件清单核对（不含 `dev/`、`demo/`、`test/`、`scripts/`；含 `src/`、`docs/`、`locale/`）；README 中英同步；`docs/preview.svg` 与新外观一致；`CHANGELOG.md`；版本号 0.3.0；locale 的 `meta.description` 与实际一致。
- [x] **M9 最终回归与报告**（2026-11-20 完成，见 DEVLOG 末条「最终报告」）：全量单测 + e2e（smoke + scope）+ demo 构建；DEVLOG 写「最终报告」：做了什么、真实验证了什么、还有什么没验证、已知局限、给用户的安装 / 升级步骤（**升级 Host 需重启 DSH**）。

## 5. 缺陷与待办池

发现的、没排进里程碑的问题记在这里（修了就划掉）：

| 状态 | 问题 | 发现于 |
|---|---|---|
| 待做 | 会话级 skill 提供方的 `invalidators` 清理依赖 `signal.abort`，长跑进程是否累积未验证 | v0.2 |
| 待做 | 分屏窗格里拿不到会话 cwd，工作区便签显示「在别处生效」（服务端按会话解析 cwd 可兜底，需真实验证） | v0.2 |
| 已修 | ~~`Slip` 是 `role=button`，内含图钉按钮（嵌套交互元素）~~ → M6：纸面才是按钮，图钉是兄弟节点 | v0.2 |
| 待验证 | 工作区便签的 target 用「符号链接路径」（如 macOS 的 `/tmp/x`）而会话 cwd 是物理路径（`/private/tmp/x`）时不适用；`normalizePath` 是纯字符串 `resolve()`，不做 realpath。面板的 target 来自 `viewer.cwd`，正常路径下两者一致，故未改动 | M1 |
| 待验证 | `apply` 里对「加载时已经活着的 agent」的一次性 sweep 依赖 `svc.agents` 已就绪（它由另一个 `ctx.inject` 填入）。插件热重载 + 会话正在跑时可能漏挂；重启后由 `agent/created`（含恢复）补上，故 e2e 未暴露 | M1 |
| 待验证 | `/system` 对每个观察者有 3 秒缓存；写完便签立刻读可能看到旧结果（e2e 用轮询容忍）。是否要按 store.revision 失效待定 | M1 |
| 已知局限 | `tools.restrict` 在 2 秒的 tick 里对齐：MCP 刚连上、或会话刚切换 cwd 的那 ≤2 秒里，不适用会话的工具列表里仍会短暂看到 `mcp__*`（调用仍被 guard 拒绝）。要不要在 `mcpManager` 连接事件上立刻对齐待定 | M2 |
| 已知局限 | 如果同一台机器上别的插件也注册了同前缀的工具名，`mcpOwnerOf` 只能按名字前缀猜归属（MCP 名全局唯一把概率降得很低） | M2 |
| 已修 | ~~`note_delete` 的工具描述写「Permanent」，但 M6 起删除是软删除~~ → 描述改为「进回收站、用户可撤销、助手不能恢复」，并加单测钉住 | M8 |
| 已修 | ~~`e2e.sh start` 用管道接输出会永远不返回~~：`&` 把整条 `&&` 链放进了后台子 shell，它一直拿着调用方的管道 → 改成 `( … exec … ) < /dev/null >> LOG &` | M9 |
| 待做 | `tools.guard` 的拒绝分支缺少「真实模型工具调用」的验证（只有单测） | M1 |
| 待做 | 注册表按 `modelInvocable` 过滤「模型看到的技能目录」这一层没有单独断言 | M7 |

## 6. 测试环境速查

```sh
cd packages/dsh-prompt-notes
scripts/e2e.sh setup      # 首次：装 dsh-better-sidebar + 本插件（链接安装）
scripts/e2e.sh start      # 启动隔离实例，打印带 token 的 URL（端口 48990）
scripts/e2e.sh stop       # 改了 Host 半体（index.js / src/*.js）后：stop → start
scripts/e2e.sh clean      # 删除整个测试 HOME（想从零开始时）
node test/e2e/smoke.mjs   # 真实冒烟（自动取 URL）
node test/e2e/scope.mjs   # 真实会话里的作用域（会自己建会话；默认含一次重启，PN_SCOPE_RESTART=0 跳过）
node test/e2e/share.mjs   # 真实环境回环：导出 → 删掉 → 预览 → 导入 → 导入的提示词进入 assemble
node test/e2e/robust.mjs  # 200 条便签的接口/组装耗时 + 数据文件写坏后的恢复（会直接改测试 HOME 里的 notes.json）
npm test && npm run check # 单测 + 语法
node demo/build.mjs       # 重建 demo/demo.html
```

- 只改 `client.js` → 刷新页面即可；改了 Host 半体 → 必须重启隔离实例。
- 用浏览器工具打开隔离实例：`scripts/e2e.sh url` 取 URL（含一次性 token），用完记得关标签页。
- MCP 测试桩：`test/fixtures/echo-mcp.mjs`（`command: node`，`args: [绝对路径]`）。
- 真实系统读数的入口：`GET /@kpeace/dsh-prompt-notes/system?session=<id>`（真实 `assemble` / `skills.list` / `mcpManager.list`）。
- 分享的入口：`GET /@kpeace/dsh-prompt-notes/export`、`POST /@kpeace/dsh-prompt-notes/import/preview`、`POST /@kpeace/dsh-prompt-notes/import`。
- 查 DSH 内部 API：源码在 `$DSH_INSTALL_DIR/../` 下的 asar 里，普通 `grep` 进不去；用 `ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" 脚本.cjs` 读（脚本里直接 `fs.readFileSync` asar 路径）。
- Cordis 约束：`ctx.<服务>` 必须在声明过依赖的 fiber 链上访问，可选依赖用嵌套 `ctx.inject([...], cb)`，`agent.ctx` 是另一棵树，要 `agent.ctx.inject([...], cb)`。
