# AI 助手：建议与洞察的收敛设计（全局入口 + 右侧边栏 + 统一建议模型）

> 一句话：把插件里散落的三处 AI 能力（关系整理建议 / 今日洞察 / AI 排期）收敛进**一个全局「建议」按钮 +
> 一块右侧边栏**，用**一个统一的「建议单」模型**承载「先出建议、人点了才落库」，为以后「主动推建议」铺路。
>
> 状态：**第一期已落地**（全局「建议」胶囊 + 右侧建议栏 + 统一建议单：关系建议与「预期完成」建议、接受即落库）。
> 后续分期（主动推送、洞察并入同一张单）仍按 §7 执行；改代码前先改这里。

## 0. 为什么现在必须收敛（现状盘点）

| 能力 | 今天的入口 | 今天的载体 | 问题 |
| --- | --- | --- | --- |
| 关系整理建议 | 关系页正文头部「建议」按钮（OverviewPanel.js L1208，仅 graph 可见） | .fo-body 第三列抽屉 OrganizeDrawer.js | 只能从关系页进；只有关系一种建议；不是真「侧边栏」，是 grid 列 |
| 今日洞察（早会/诊断/写入评论） | 老 iframe panel.html 的 insightCard（L3832 / 按钮 L8957） | 上一代整页面板 | 与 React 客户端脱节；新客户端「洞察」是纯数据看板 InsightFeature.js，没有 AI 按钮 |
| AI 排期 | 只有模型工具 cove_task_schedule / cove_plan_today | 后端 schedule.js + DSH 自动化 | 客户端零入口，用户看不到 |

**结论**：三块 AI 能力各自造了一套「生成 → 接受 → 写回」的模型和 UI，重复且割裂。收敛成一套，是这个插件后续所有 AI 功能的地基。

## 1. 目标与非目标

**目标**

1. 「建议」变成**全局按钮**（不随功能页走），点击打开**右侧边栏**。
2. 右侧边栏 = 插件 AI 能力的**唯一收口**：洞察卡在上、建议流在下。
3. 用**统一建议模型**承载所有「可接受/拒绝的动作」，当前只有关系（复用现状），以后接排期、里程碑等。
4. 打通「洞察 → 建议」：洞察卡的结论能**跳出**成一条可接受的建议。
5. 为**主动建议**预留：后台生成 + 未读角标 + 配额去重，落库仍必须人点。

**非目标**

- 不自动落库：任何建议被接受前**零副作用**（沿用现有「先出建议再落库」的铁律）。
- 不改 depends_on / derived_from 边语义；不改 schedule.js 的 spec；不改 DSH 自动化作为排期真相源。
- 不在这轮做多人共享 / 跨人资源平衡 / 自动依赖推导。
- 不重写老 panel.html（它继续只读共存；洞察卡在 React 侧**镜像**一份，见 §4.2）。

## 2. 概念模型：一条「建议」= 一个指向写路径的动作

现在 state.organizeSuggestions[batchId].items[] 里每条的 type 只有 relation（且其实只靠 kind 区分边类型）。
收敛后把它泛化成一个**判别式**：type 决定「这条建议落到哪条写路径」，payload 是该类型的参数。

```jsonc
// state.suggestions[batchId]（P2 起，取代/迁移 organizeSuggestions）
{
  "batchId": "sg-<scope>:<timeWindow>",          // 幂等键：scope + 时间窗，不含内容指纹
  "at": 1793700000000,
  "source": "on-demand | proactive | create | bind",   // 谁触发的（§5）
  "scope": { "workspace": "[DSH] 插件开发", "taskId": "<guid>" },
  "notes": "整体判断（≤120 字）",
  "items": [
    {
      "id": "sg-…:n",
      "type": "relation | schedule | milestone | stage | title",   // 判别式
      "confidence": 0.86,
      "evidence": "正文证据原文（引用具体片段）",
      "status": "pending | accepted | rejected | undone | dropped",
      "createdAt": 1793700000000,
      "payload": { /* 按 type 定 */ }
    }
  ]
}
```

**各 type 的 payload 与写路径**（写路径全部复用现状，见 DESIGN-task-organize-suggestions.md §4.3、DESIGN-ai-scheduling.md §7）：

| type | payload（摘要） | 接受时走 | 备注 |
| --- | --- | --- | --- |
| relation | { kind:'depends_on'|'derived_from'|'temporal', from, to } | setTaskRelations（走 organizeAccept 现有链路） | 现状唯一实现，直接迁移 |
| schedule | { spec }（或 { when } 自然语言） | cove_task_schedule → DSH 自动化 | 已完整，缺客户端入口 |
| milestone / stage | { name, taskIds } / { taskId, milestone, step } | ensure_custom_field / set_custom_field | 依赖 §6 字段级 pending 表 |
| title（示例） | { taskId, title } | suggestTaskTitle 已有链路 | 只示意「可扩展」，本轮不做 |

**接受 = 一个 dispatch 函数**，按 type 路由到对应写路径；拒绝/撤销/状态机、逐条成功失败汇报、undo 全部复用同一套（现状 OrganizeDrawer 已有 accept/reject/undo）。

## 3. 布局：右侧边栏成为根级第四区

今天 .fo-root 是 rail | body，.fo-body 内部再塞 DetailPanel / OrganizeDrawer（第三 grid 列）。
收敛后把「AI 侧栏」提升为**根级区域**，与功能页解耦（styles.js 里 .fo-body 的 grid 逻辑迁到根级）：

```
.fo-root[data-ai="1"] { grid-template-columns: <rail> minmax(0,1fr) clamp(300px, 26%, 380px); }
```

```
┌──────────┬──────────────────────────┬─────────────────────────────┐
│  rail    │  .fo-main（功能页）        │  .fo-ai（右侧边栏）           │
│  ├ 品牌   │  运行 / 洞察 / 关系        │  ┌ 💡 今日洞察（洞察卡）──┐   │
│  ├ 运行   │  …                       │  │ 结论 + 诊断/早会/写回   │   │
│  ├ 洞察   │                          │  └───────────────────────┘   │
│  ├ 关系   │                          │  ┌ ✨ 建议（跳出建议）────┐   │
│  └ [✨建议]│                          │  │ 关系/排期/里程碑 逐条    │   │
│          │                          │  │ [接受][拒绝]           │   │
│          │                          │  └───────────────────────┘   │
│          │                          │  已处理 · 设置                 │
└──────────┴──────────────────────────┴─────────────────────────────┘
```

要点：

- 侧栏**独立于** DetailPanel：data-ai 与 data-detail 各自控制一列，可同时开（正文 | 详情 | AI 侧栏）。
- 侧栏内部**上下两段**：洞察卡（固定在上）+ 建议流（可滚动），两段各自有头部，不强绑。
- 窄屏优先级照现状：先压详情栏，再压 AI 侧栏，rail 最后收（复用 @container fopanel 断点）。

## 4. 右侧边栏的两块内容

### 4.1 建议流（把 OrganizeDrawer 泛化）

把 OrganizeDrawer.js 改成「统一建议流」：渲染按 type 分发到不同的 item 卡片模板（关系沿用现有 fo-org-*，排期/里程碑新增模板），
但**外壳（标题/计数/全部接受/全部拒绝/撤销/关闭）共用一份**。接受/拒绝/撤销回调签名不变，宿主按 type 路由。

### 4.2 洞察卡（从 panel.html 镜像进 React）

洞察卡的结论是「洞察 → 建议」的桥：把 panel.html 的 insightCard（早会同步/诊断/写入评论 + 结论区）镜像进 React，
复用后端已有的 insight 状态与 /api/insight/*（index.js insightLocal L7262、insightContext L7495、insightJob L7743）。

「跳出建议」的机制：

- 洞察卡诊断结果里凡是**可执行结论**（如「今天先做 T3」「T9 该排每周一」），渲染时附带一个
  「加到建议」动作，把它物化成一条 type:'schedule'（或 relation）的 pending 建议落到 feed 底部；
- 用户点「接受」才真正写回，诊断本身仍零副作用；
- 这样「AI 说一句」和「人确认一条」用同一条建议流闭环，而不是两套互不相通的入口。

### 4.3 全局按钮

推荐落点：**rail 底部固定区**（紧邻「打开任务页」），sparkle 图标 + 「建议」标签 + **未读角标**。
理由：真正全局（运行/洞察/关系都可见）、与现有 footer 模式一致、不挤占各功能页 header 的上下文按钮。
备选：正文头部 .fo-head-actions 对**所有功能页**都渲染（今天只对 graph 渲染，去掉 activeFeatureId === 'graph' 条件）。

角标 = 主动建议的未读计数（§5），点击清零；无主动建议时不显示角标，按钮仍是「打开侧栏」的入口。

## 5. 主动建议（以后会主动给用户建议）

沿用现有 organizeBatchId（scope + 时间窗）的幂等与 in-flight 去重（index.js organizeScope L6218）：

| 项 | 设计 |
| --- | --- |
| 触发 | 同步后 / 低频（每日一次）对「无关系且未整理」的任务后台跑，复用 insightJob 的「HTTP 立刻返回、后台跑、面板轮询」模式 |
| 配额 | 同 scope 的 batch 在 N 小时内不重复；单次最多 M 条；全局条数上限（超出淘汰最旧） |
| 安全 | 只对**零副作用**的 type 开自动（relation 先开，schedule 需预览才开）；落库永远要人点 |
| 通知 | source:'proactive' 的未读计数 → 全局按钮角标 + 侧栏顶部「N 条新建议」 |
| 失败 | 失败即无建议 + warning，不半写状态；不阻塞同步与自动开工 |

## 6. 状态与迁移（P2 关键）

- 新键 state.suggestions，**三处显式代码**都要改（照 organizeSuggestions 的先例）：
  DEFAULT_STATE（index.js L559）、载入后防御式规范化（index.js L3206）、面板快照导出。
- **兼容**：P1 先不动 organizeSuggestions，只把 UI 搬进侧栏；P2 引入 state.suggestions 并做迁移
  （旧 organizeSuggestions 读进来合并进新键，旧键保留只读直到下次大版本）。
- 字段级 pending/retry 表（DESIGN-task-organize-suggestions.md §9.7）在接 milestone/stage 前必须先补，否则远端写失败会静默丢。

## 7. 分阶段落地

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| P1 外壳 | 全局「建议」按钮（rail footer）+ 根级 .fo-ai 侧栏 + 把 OrganizeDrawer 搬进侧栏（内容仍是关系建议，零后端改动） | 关系建议可从任意功能页打开 |
| P2 收敛 | state.suggestions + 迁移；洞察卡镜像进侧栏顶部；「加到建议」桥；统一建议流按 type 分发 | 洞察与建议同屏、可跳出 |
| P3 主动+多类型 | 后台主动生成 + 未读角标；新增 schedule 建议（接 cove_task_schedule）；字段级 pending 表 | 主动推建议；排期有了客户端入口 |

## 8. 待定问题

1. 全局按钮落点：rail footer（推荐）还是正文头部对所有页渲染？要不要保留关系页 header 里的快捷入口？
2. 侧栏与「洞察」功能页的关系：洞察页继续做**全量看板**，侧栏洞察卡只做**摘要+诊断+跳出建议**，两者共存——还是干脆把洞察页合并进侧栏？
3. 主动建议的默认配额与「哪些 type 允许无人值守生成」。
4. 命名：按钮叫「建议」还是「AI 助手 / 建议中心」？（用户口径一直叫「建议」，暂沿用）
5. 洞察卡是「镜像复制」进 React，还是逐步把 panel.html 里这块迁走、面板瘦身？
