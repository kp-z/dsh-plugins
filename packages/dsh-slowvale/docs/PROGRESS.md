# PROGRESS

## 2026-11-20 21:40 · H1 完成（v2 修订）

**做了什么**：
- `model/character.ts`：角色数据模型（id/name/appearance/home/work/persona/createdAtTick）
- `model/context.ts`：ContextBundle + provider 机制（persona / channel / situation / memory 四层）
- 三个角色改成 Character（含家、工作地、外观），persona 只作为其中一个字段
- 11 个单测全绿（5 绑定不变量 + 5 解耦 + 1 persona prompt）

**为什么改**（用户提议）：角色与会话解耦，会话每次开口向世界要一份 bundle，
以后要加关系/心情/传闻，只加 provider，不动调用方。

**关键决策**：
- bundle 分节 + 每节带 source：可单测、可追溯"他当时看到了什么"。
- 角色本体不放"当前在哪/在干嘛/会话 id/记忆正文"——这些要么随 tick 变，要么属于绑定或检索结果。

**卡点**：无。

**下一个小时（H2）从哪开始**：会话接入——sessionController 创建/接管会话，
首条上下文用 `buildContext(...).text`；验"给林野开一个工作会话，要它回一句，且答得像林野"。
