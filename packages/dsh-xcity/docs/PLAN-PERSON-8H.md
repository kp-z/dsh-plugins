# PLAN-PERSON-8H v4 —— 把 Agent 变成活人（第二轮）

> 上一轮（H1–H7）已完成：需求驱动的一天、当天记忆进短信、主动短信（sim 决策 + 投递模块）、学习结算、关系 affinity、独立桥真机验收。全量 922 条 / 921 通过 / 1 跳过。
> 本轮目标：把“像人”从**行为**推进到**生活**——先让真宿主能验，再收拾读模型/绑定，补上“家、等人的社交、跨天记忆、周末闲暇”。
> 创建：2026-11-27 07:05（Asia/Shanghai）。执行：每小时一次，读「执行指针」，只做当前小时。

## 执行指针

- **当前小时：H2**
- 上一轮：第一轮 H1–H7 已完成；第二轮 H1（真宿主+prompt 投递）已完成，AI 回信卡在凭据。
- 定时任务：`schedule-6225b704-f1d2-49ca-9f9f-f99b3bb36a4f`（每小时，投递到本会话）
- 推进规则：DoD 全过才改成下一小时；没做完下一轮继续，不跳。
- **不要重启正式桌面进程**；真机验收用独立 profile/独立桥。
- **不要问用户**；判断写进文档。

## 0. 执行协议（每次先读）

1. 只做当前小时；先花 5 分钟读该小时涉及的源码与测试。
2. 时间盒至少 45 分钟：读 5' → 实现 30' → 测试/仿真 15' → 加固/文档 10'。
3. DoD：
   - `npm run build` 通过；
   - 本小时测试通过，全量测试记录“总数/通过/跳过”；
   - 有仿真或真机证据（数字/日志/截图路径）；没有就写“未验 + 原因”；
   - 短信/手机/作息/关系/学习不被碰坏；
   - 注释带流程号（H1=R484、H2=R485、H3=R486、H4=R487、H5=R488、H6=R489、H7=R490、H8=R491）；
   - 进度日志、PROGRESS、执行指针三处更新；本小时文件单独提交。
4. 构建红超过 15 分钟：回滚本小时文件，记原因，指针不动。
5. 不新增“模式/开关”；不为了测试在生产路径加分支。

## 1. 人的五要素（现状）

| 要素 | 现在有什么 | 本轮补什么 |
|---|---|---|
| 身体 | 位置/场所/工位/状态/活动 | 家（睡觉的落点） |
| 内在 | 体力/饥饿/社交 + 需求驱动选择 | 周末/闲暇节奏 |
| 记忆 | 当天活动进短信（H3） | 跨天记忆（最近几天） |
| 关系 | affinity + 同屋聊天（H6） | 人到齐才算聊天 |
| 意愿 | 吃/睡/歇/社交/工作/学习 | 由记忆/关系进一步影响 |

判断标准：**不服务于“这个人”的字段/机制优先删；服务于人的优先补。** 工单是工具，不是人的本体。

## 2. 依赖图

```
H1 真宿主验收（没有它，后面都只是单测）
 └─ H2 活动读模型统一（先统一读入口）
     └─ H3 绑定统一（一个角色一个会话）
         ├─ H4 家/睡觉落点
         │   └─ H7 周末与闲暇
         ├─ H5 社交等人（人到齐才算）
         └─ H6 跨天记忆 → 进短信
             └─ H8 清理 + 下一份计划
```

## 3. H1 · 真宿主验收（流程号 R484）

### 目标
用一个**最小 profile**（不含不兼容的 agent-teams）起独立 DSH，真的发一条短信、收到一条主动短信；解决 H7 只验到桥、没验到 AI 的问题。

### 前置
- CLI：`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`；`dsh --version` = 0.2.2-rc.5。
- xcity-test 启动 15 分钟无端口，组合时报 `@nanmicoder/dsh-agent-teams` 不兼容——**不要再用它**。

### 设计/步骤
1. 用 CLI 生成一份最小 profile：`dsh --from-default-profile h7mini web`（在 `DSH_HOME=/tmp/dsh-h7` 下），只保留 base + web + dsh-xcity；用 `dsh plugin --profile h7mini add /Users/demo/dsh-plugins/packages/dsh-xcity` 链进来。
2. 给 profile 写 xcity 配置：独立 `stateDir`、bridge 端口 7799、web 端口 3189、`viewerRoleId: player`。
3. 启动：`DSH_HOME=/tmp/dsh-h7 dsh --profile h7mini web --port 3189`；确认 3189/7799 都监听。
4. 建一个角色会话并绑到 `agent-1`（用 xcity 的绑定 CLI/接口，别手改正式表）；发一条短信。
5. 记录：会话里的 prompt 是否带“你今天…”，回复是否写回「通讯」；等一条主动短信（社交 <35 或刚忙完），确认线程/未读。
6. 模型凭据：最小 home 没有 `.credentials.yaml` 时，**临时复制**一份（0600，验收后删除），不要打印内容。

### 验收
- 3189/7799 都活；世界不重建。
- 短信回复写回，且回复内容能对应当天活动（不是“在吗”）。
- 主动短信真的进「通讯」，未读正确。
- 失败项写清卡点（启动/模型/绑定哪一步），不假装。

### 风险
- 最小 profile 仍拉起不兼容 bundle；模型凭据缺失；端口被占。
- 回滚：只删 `/tmp/dsh-h7` 与最小 profile，不动 `~/.dsh/profiles` 的正式/测试 profile。

### 3.1 实测（2026-11-27 08:10）

**宿主起来了**（这是 H7 没做到的）：
```
DSH_HOME=/tmp/dsh-h7 dsh --profile h7mini --from-default-profile web --dump-config
DSH_HOME=/tmp/dsh-h7 dsh plugin --profile h7mini add /Users/demo/dsh-plugins/packages/dsh-xcity
DSH_HOME=/tmp/dsh-h7 dsh --profile h7mini --port 3189 --no-open
```
- 3189 / 7799 都在数秒内监听；没有 agent-teams 不兼容。
- 新建会话（session-48ba…），把 bindings.json/agents.json 写到 `/tmp/xcity-h7`，绑到 agent-1。
- 发短信「今天过得怎么样？」后，**会话里真的收到了 prompt**，含：
  - 「你在 xcity 小镇里，玩家刚给你发来一条短信」+ 玩家原话；
  - 「你今天到目前为止：00:00–07:11 在东侧休息区睡觉 / 07:26–08:16 在东侧休息区吃饭 / 现在在办公室座位 4学习」；
  - 回复格式要求 + 唯一投递编号。
- 约 10:11，**主动短信 prompt 也真的进了会话**（念头：今天有点想找人聊聊；同样带当天摘要与 `xcity-init:…:2051` 编号）。

**卡点**：模型请求失败「API 密钥无效 AUTH」——最小 `DSH_HOME` 里没有可用的账号令牌（复制 `.credentials.yaml` 也不够，refs 指向的环境变量不在 CLI 进程里）。因此：
- 短信 prompt 已到会话，但**没有 assistant 回复**，也就没有写回「通讯」；API 线程里只有玩家那条。
- 主动短信同样卡在模型，没有真正投递到手机。

**结论**：H1 的“宿主/绑定/prompt 投递”已验证；**“AI 回信文本”未验，卡在凭据，不是代码**。临时宿主已停，复制的凭据已删除；下次有可用模型凭据时，按上面三条命令重跑即可。

## 4. H2 · 活动读模型统一（R485）

### 目标
“我现在在做什么”只有一个读入口，减少 `agent.activity*` 与 `world.activities` 两套真相的漂移；**先统一读，不改写**。

### 设计/步骤
1. 新增 `sim/activity-view.ts`：`currentActivityOf(world, agent): Activity | null`（按 `agent.activityId` 找 active 记录；没有就回退老字段，并可选返回 mirror 差异）。
2. 把**读**的地方改成它：`needs.ts` 的活动恢复、`day-summary.ts` 的当前行、`project.ts` 的 active_activity、`relationships.ts` 的同屋判定。
3. 加不变量测试：`agent.activityId` 指向 active；老字段与 Activity 的 kind/purpose/skill 一致（允许暂时不一致的清单）。
4. 不改写入路径（movement/idle/step 还在写老字段），避免大爆炸。

### 验收
- 全量测试通过；同一天的仿真分布与 H6 基线一致（±2%）。
- 新增不变量测试，能抓住“活动结束但老字段还在”的漂移。

### 风险
- project.ts 在适配层，读 WorldLike 不是 World；需要一个小适配（只读 activityId/activities）。
- 回滚：新文件 + 调用点。

## 5. H3 · 绑定统一（R486）

### 目标
一个角色 → 一个会话，只有一个解析入口；`boundAgentId` 与 `bindings.json` 不再各查各的。

### 设计/步骤
1. 新增 `adapters/slowvale/binding-view.ts`：`sessionForAgent(agentId, { bindings, agents })`、`characterForAgent`、`personaKeyOf(agent)`。
2. 替换 `index.ts` 里 SMS/主动短信/对话/任务执行三处重复查找；保留“显式绑定优先”的现有语义。
3. 测试：同一角色在两套表一致/不一致时的优先级；未知角色返回 null；不改磁盘。
4. 文档写清“谁写、谁读”，为下一轮合并存储做准备。

### 验收
- 短信、主动短信、任务执行仍找到同一个会话；全量测试通过。
- 没有新增写路径。

## 6. H4 · 家 / 睡觉的落点（R487）

### 目标
夜里不再睡茶水间/休息区，而是回“自己的落脚点”睡；这是一个人最基本的身体节奏。

### 设计/步骤
1. Agent 加 `home?: Vec2`（缺省 = hangout）；老档在 reconcile 补。
2. 协议加 `goHome` 命令（agentId、ticks、purpose=sleep）：ingest 设路径到 home、state walking；到点/到达后 state sleeping，活动记录 kind rest + purpose sleep。
3. `chooseLife` 夜里返回 `goHome` 意图，不再选 rest 站点。
4. needs：sleeping 恢复体力；到站后按 purpose 恢复。
5. 测试：夜里从工位回家、到家睡、早上醒；单角色/无 home 老档不崩；路径不可达时退回待命。
6. 仿真 24h：夜间睡眠比例与 H6 基线接近，位置在各自 home 附近。

### 验收
- 夜里不再全挤在 lounge；每人的 home 不同（或至少不在公共休息区）。
- 全量测试 + 24h 仿真通过。

## 7. H5 · 社交等人（R488）

### 目标
两个人约在同一屋，**人到齐才开始计时**；先到的人最多等 30 tick，等不到就走，不再独自把聊天耗完。

### 设计/步骤
1. meet 到站时：若同 district 没有第二个 talking/meet 的人，把 `activityUntil` 压到 `tick + 30`（等待窗口），状态仍是 talking。
2. 等待期间若有人到：把 `activityUntil` 恢复为 `tick + SOCIAL_TICKS`，双方正常结算 affinity。
3. 30 tick 没人：结束活动、回 idle/待命；不重复发命令。
4. 测试：错峰 10 tick 到达 → 聊天成功；错峰 60 tick → 先到的人离开；单人到场不产生 affinity。
5. 72h 仿真：affinity 事件/meet 比例上升（目标 >1.5）。

### 验收
- 错峰场景有测试；72h 的 meet/affinity 比例明显改善（记录数字）。

## 8. H6 · 跨天记忆（R489）

### 目标
角色不只记得“今天”，还知道“最近几天做过什么”；短信里能自然提到昨天/前天。

### 设计/步骤
1. Agent 加 `memories?: { day: number; lines: string[] }[]`（最多 7 天，随存档）。
2. 每天结束（`tick % 1440 === 1439`）用 `summarizeDay` 生成当天摘要，压入 memories；同一天不重复。
3. `promptText` 增加“最近几天”段（最多 3 天、总长 ≤200 字）；today 仍走 H3 的 dayContext。
4. 测试：跨天生成、只留 7 天、空记忆不编、prompt 长度；老档无 memories 正常。
5. 真机/仿真：连续 3 天，短信 prompt 里出现昨天的真实活动。

### 验收
- 单测覆盖生成/裁剪/prompt；不泄露内部 id；不重复同一天。

## 9. H7 · 周末与闲暇（R490）

### 目标
周末不上班；没有紧迫需求时，允许“闲着/散步/发呆”，而不是永远在学习。

### 设计/步骤
1. `isWeekend(tick)`（周六/周日）；`chooseLife` 的 work 分支只在工作日生效。
2. 非工作时段、需求都 >70 时，用确定性规则（agent id + day）让一部分人返回 null（交给待命行为/闲暇），不再一律 study。
3. 测试：周六 10:00 不 work；周三 10:00 work；高需求时仍 study；闲暇比例可解释。
4. 24h/72h 仿真：周末 work 占比显著下降，idle/待命上升，需求不崩。

### 验收
- 周末/工作日行为有测试；分布变化有数字；不出现“整天空转”。

## 10. H8 · 清理、收尾与下一份计划（R491）

1. 复查 H2/H3 留下的镜像与绑定：能删的读路径删掉，不能删的写进下一份计划（第一步）。
2. 证据表：live/teams、mailbox、travel 的“谁在用/删了影响什么”（上一轮已查：都有真实使用，见归档）。
3. **原地重写本文件**：下一份 8 小时 H1–H8，重置指针与进度日志；保持文件名不变。
4. 确认定时任务仍指向本文件；PROGRESS/ARCH 更新。

## 11. 上一轮归档（H1–H7，2026-11-27）

- H1 需求模型（R477）：体力/饥饿/社交，随 tick 衰减，睡觉/工作/交谈改变。
- H2 需求驱动的一天（R478）：chooseLife；补茶水间/休息区；修走路计时、站点直达、WALK_SPEED；投影吃饭/睡觉/小憩。
- H3 今天记得什么（R479）：day-summary 进短信 prompt；活动改为到站才采纳；跨午夜。
- H4 主动找玩家（R480）：sim 决策 + 限频；agent.initiative；投递模块；tracker kind；带当天经历。
- H5 学习与技能（R481）：Activity purpose/skill、activitySkill；awardStudyXp；SkillStudyActivity。
- H6 关系（R482）：affinity；同屋聊天 +2；中点选房；同屋空位回退。
- H7 真机（R483）：DSH 最小 profile 起不来（agent-teams 不兼容），用独立桥验到：夜里睡觉、早上学习/吃饭/干活、位置变化、徽章、手机线程/未读/气泡；AI 回信与主动投递未验。
- 提交：`c55c417`…`c760d8e`（32 个提交，见 git log）。
- 清理证据（H8 本轮查）：`live`/agent-teams 仍由 index 的 syncSubagents、外部工单使用；mailbox 由 heartbeat/sendMessages 使用；travel 有 city-travel 测试与 beginTravel；活动镜像被 movement/idle/project/needs 使用——都**不删**，只在 H2/H3 统一读入口。

## 12. 评审记录（两遍）

1. **可执行性**：每段都有前置/步骤/测试/验收；H1 是最不确定的，放在最前，失败只影响“未验”，不拖后面的代码小时。
2. **依赖与冗余**：H2/H3 是读模型清理，不能和 H4–H7 的行为改动混在一小时；H4 依赖 H2 的 activity 视图；H5 依赖 H6 的 affinity 结算；H6 复用 H3 的 day-summary；顺序无断点。

## 13. 进度日志

- 2026-11-27 08:10 · **H1 完成（宿主/prompt 投递；AI 回信未验）**。用 CLI 建最小 profile `h7mini`（base+web+dsh-xcity，无 agent-teams），3189/7799 数秒内起来；新建会话并绑到 agent-1 后，短信 prompt 与主动短信 prompt 都**真的进了会话**，且带 H3 当天摘要（睡觉/吃饭/学习）与唯一编号。
  卡点：最小 `DSH_HOME` 里模型请求「API 密钥无效 AUTH」，没有 assistant 回复，因此没有写回「通讯」；复制凭据不够（refs 指向 CLI 进程没有的环境变量）。临时宿主已停、凭据副本已删。
