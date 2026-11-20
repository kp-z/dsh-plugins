# PROGRESS

## 2026-11-20 22:15 · H2 完成

**这一小时做**：会话接缝 + 角色会话管理 + DSH 端口（发话/收话/超时）。

**做了什么**：
- `runtime/session-port.ts`：SessionPort 接缝；ScriptedPort（确定性替身，不调模型）；UnavailablePort（宿主没挂服务时给人话原因）
- `runtime/character-sessions.ts`：按角色开/说话/关；**只允许按 characterId 说话**，路由规则（primary→secondary，observer 不算）才有地方执行
- `runtime/dsh-port.ts`：真端口——`sessionController.prompt` 发话 + `session/event` 收话；按 sessionId 匹配回复；超时按失败；`attach` 接已有会话（不自己造）
- 24 个单测全绿（新增 6 个 DSH 端口用例：请求形状、跨会话不串、超时、attach、提取器）

**关键决策**：
- 端口**不自己创建会话**：建会话是宿主的事（模型/权限/计费），端口只 attach 已有会话。
- 同一角色 + 同频道重复开会议复用同一会话：否则同一个人的两段回答会落在两个上下文里。
- 回复提取器可替换：事件形状（`assistant/message` + content[].text）取自 agent-world 的 decode，**还没真机验证**，所以留了注入点。

**卡点 / 待验**：
- 真机事件形状需验证（H2.5 用宿主实跑一次，确认 type/content 结构）。
- 本包需要 @types/node（借用 dsh-agent-world/node_modules 的软链），正式安装时补 devDependency。

**下一个小时（H2.5 → 并入 H3）**：真机联调 + 注入层扩展。
1. 在宿主里起一个会话，attach 给林野，问一句，确认真回；
2. 加 relationship / mood 两个 provider；
3. 验收：三人同问，答得像三个人（人工比对 + 记录差异）。
