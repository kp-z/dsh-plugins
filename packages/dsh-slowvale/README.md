# dsh-slowvale

把 Slow Vale 的城市接到 DSH：**角色有 persona，能绑定多个 DSH 会话，会话之间可以对话。**

## 当前进度（H1）

模型层已落地，会话接入在 H2：

```
src/model/persona.ts    人设结构 + prompt 组装（性格 / 说话方式 / 场合 / 处境）
src/model/binding.ts    角色 ↔ 会话 绑定表（多对多、可回放、三条不变量）
src/content/characters.ts  三个初始角色（林野 / 小满 / 老周）
```

## 三条设计判断

1. **会话是嘴，角色是人**：一个会话只能代表一个人；一个人可以有多张嘴（工作号/私人号/旁观号）。
2. **绑定是表不是字段**：append-only + unboundAtTick，任何时刻"谁代表谁"都可回放。
3. **会话之间的对话过世界**：A 说 → 世界记录 → 世界按在场/关系投递给 B，不直连。

## 跑测试

```bash
npm test
```
