# 计划：关系图自动布局 + 可编辑连线（下一阶段）

> 用户口径（2026-11-15）：关系图里的节点能不能自动整理相互位置；整体架构优化、用现成的工具；
> 线的颜色要有区分；节点之间可以拖动；最好能人工拖动线的指向关系。先出计划。

## 0. 现状（代码事实）

| 位置 | 事实 |
| --- | --- |
| `src/overview/layout.js`（680 行） | 自己写的布局：按 `depends_on` 深度分列、列内排序、超长折列；`edgePath()` 只有正交折线；节点等高（84–260）。 |
| `src/client/GraphView.js`（828 行） | 视口缩放/平移、节点拖动（吸附 40px、落 store.nodePos）、聚焦、键盘走位、边 hover 高亮。 |
| 边的颜色 | `depends_on` 品牌蓝实线；`derived_from` 与 `temporal` **都是 idle 灰**，只靠透明度区分——「颜色区分」目前不成立。 |
| 手动连线 | 只有面板的「添加/管理关联」菜单（走 `/api/overview/relations` → `writeRelationManually`，add/remove 三种 kind 都支持）；**画布上不能连、不能改指向**。 |
| 自动整理 | 没有。位置只来自初始布局 + 手动拖动，没有「重新排布」。 |

## 1. 目标（对应用户五条）

1. **自动整理**：一键把整张图重新排整齐（分列/分层、少交叉），且尊重手动拖过的位置。
2. **架构优化**：布局换成成熟算法库；GraphView 拆成布局/路由/交互/渲染四块，单文件回到 300 行以内。
3. **线的颜色区分**：三种关系三种颜色 + 三种线型，图例同步；hover/选中提亮。
4. **节点拖动**：保留现有「跟手 + 吸附 + 落盘」，并补：拖动时不抖动、拖完不自动重排。
5. **人工拖线的指向**：画布上从节点端口拖到另一个节点建立关系；拖边的端点可以改指向；边可选中删除。

## 2. 选型（现成工具）

| 方案 | 体积/许可 | 适配度 | 结论 |
| --- | --- | --- | --- |
| **dagre-d3-es 7.x**（dagre 的 ESM 维护分支） | 约 120KB min / MIT | 分层（Sugiyama）：rank / order / 坐标一次算完；rankdir、nodesep 可调；同步、可离线 | **推荐**：与「左→右依赖方向」语义一致，纯函数可测 |
| elkjs（Eclipse Layout Kernel） | 约 1.5MB / **EPL-2.0** | 最强：正交边、端口、层级；异步、可 Worker | 备选：许可与体积都重，除非 dagre 的边太丑再换 |
| cytoscape 3.x（+ fcose） | 约 400KB / MIT | 整套图交互（拖拽/连线/布局），但 canvas 渲染 | 不采用：会换掉刚统一的 DOM 卡片（foreignObject） |
| d3-force | 约 30KB / ISC | 力导向，适合无方向聚类 | 可作为「按项目聚类」的辅助，不作主布局 |

落地：按仓库约定 **vendor**（`src/vendor/dagre/` 入库 → 构建同步 `lib/vendor/`，同 agent-world 的 three），
不新增线上安装依赖；LICENSE 一起入库。

## 3. 架构拆分

```
src/graph/
  engine.js        布局适配器：nodes/edges/options → { positions, bounds }（纯函数）
  engineDagre.js   dagre 实现（LR、分列、等高、rank 对齐）
  routing.js       边路由：正交折线 / 圆角折线 / 端口进出（纯函数）
  interaction.js   交互状态机：拖动 / 平移 / 端口连线 / 端点改指向（纯函数 + 事件适配）
  palette.js       边与节点的颜色/线型令牌
src/client/
  GraphView.js     只做组合：<Canvas><EdgeLayer/><NodeLayer/><ConnectLayer/></Canvas>
  GraphEdges.js    边的渲染 + hover/选中 + 端点抓手
  GraphNodes.js    节点渲染（现有 foreignObject 卡片）
  GraphConnect.js  连线中的临时线、端口、落点高亮
src/overview/layout.js  保留卡片几何/节点描述/高度估算；删除自写排布（P5）
```

约束：布局与路由是纯函数；交互状态机可离线跑；渲染层只消费它们。

## 4. 交互设计

### 4.1 自动整理
- 图头工具条加「自动排布」：只重排**没有手动位置**的节点；手动拖过的保持（nodePos 优先）。
- 「全部重排」二次确认：清掉这张图的手动位置再排。
- 增删关系后**不自动重排**，只在图头提示「布局已过期 · 重新排布」。
- dagre 参数：rankdir=LR、ranksep=80、nodesep=24、edgesep=12；节点尺寸取实际卡片高度。

### 4.2 边的颜色与线型

| kind | 颜色 | 线型 | 语义 |
| --- | --- | --- | --- |
| depends_on | 品牌蓝 | 实线 2.5 + 箭头 | 必须等它完成 |
| derived_from | 紫 #8b5cf6（--fo-edge-derived） | 长虚线 6 4 | 由它派生 |
| temporal | 中性灰（idle） | 点线 2 4 + 更淡 | 时间先后，不阻塞 |

hover / 选中：线宽 +1、透明度 1、箭头同色；**只亮相邻边**（现在整图全亮）；图例同令牌；窄面板折行。

### 4.3 手动连线
1. 节点 hover/选中出现 4 个连接端口（8px 圆点）。
2. 从端口拖出虚线跟随指针，目标节点高亮。
3. 松手弹「关系类型」菜单（前置 / 来源 / 时间先后），默认前置；Esc 取消。
4. 提交 `POST /api/overview/relations { action:'add', taskId, otherId, kind }`（已有接口）。
5. 失败只 toast、不乐观改图；成功等 revision 轮询刷新。

方向文案（避免搞反）：
- 「A 必须先完成」→ depends_on，to=A、from=B
- 「A 由 B 派生」→ derived_from
- 「A 排在 B 之后（只是时间）」→ temporal

### 4.4 改指向 / 删除
- 边 hover 在目标端出现抓手；拖到另一个节点 = 同 kind 改 to：「先 remove 旧边 + add 新边」，任一失败回滚。
- 点击选中边 → Delete 删除，或右键「断开这条关系」。
- 每次操作可撤销一步（内存栈，刷新即失效）。

## 5. 数据与接口
- 读：`/api/overview`（relations 已有 from/to/kind）+ revision 轮询。
- 写：`POST /api/overview/relations` → `writeRelationManually`（add/remove），无需新接口。
- 位置：沿用 `store.nodePos`；自动布局只排没有记录的节点。
- 数据模型不变（仍三种 kind）。

## 6. 阶段与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **P0（0.5–1 天）** | vendor dagre + engine 适配器 + 离线对比 | 同批任务新旧布局的交叉/列数/边界对比；不支持变高时退回等高 |
| **P1（1–2 天）** | 接引擎 + 自动排布/全部重排；位置保留；GraphView 拆 Canvas/EdgeLayer/NodeLayer | 确定性、无重叠、边界、100 节点 <50ms；拖动不触发重排 |
| **P2（0.5–1 天）** | 三种边色/线型 + 图例 + 只亮相邻 | 亮暗对比度检查；图例与画布同令牌 |
| **P3（1–2 天）** | 端口拖拽连线 + 类型菜单 + 回滚；边删除 | 状态机单测；route 测试 add/remove |
| **P4（1–2 天）** | 端点抓手改指向（remove+add+回滚）、一步撤销 | 状态机单测；半失败时数据与图一致 |
| **P5（0.5 天）** | 删旧深度分列代码/测试/样式，文档收口 | deadStyles 零孤儿；全量测试绿 |

合计约 **5–7 个工作日**：P1 后能自动排布，P2 后能看到颜色，P3/P4 是人工连线与改指向。

## 7. 风险与对策

| 风险 | 对策 |
| --- | --- |
| dagre 不支持每节点不同高度 | 本来就同图等高；将来要变高再上 ELK/自定义 rank 堆叠 |
| 打乱手动位置 | 只排无记录节点；全部重排二次确认 |
| 连线手势与平移/拖动打架 | 端口只在 hover 出现；按下即进入 connect 状态屏蔽 pan；状态机单测 |
| 改指向两次写只成功一半 | add 成功再 remove；失败反向回滚并提示 |
| 边太多看花 | 三种颜色 + 选中节点时其余边降透明 + hover 只亮相邻 |
| 体积/许可 | dagre-d3-es MIT 约 120KB；vendor 入库并附 LICENSE |

## 8. 不在这一轮
- 边自动避障（A* 绕节点）：先正交 + 圆角；
- 多人协同编辑；
- 用 cytoscape 重写画布（会破坏统一 DOM 卡片）。

## 9. P0 结果（2026-11-15 21:xx）

- 引擎：`src/graph/engine.js`（dagre-d3-es，`layoutGraph({nodes,edges}) → {positions,bounds,order}`）；
  纯函数、输入先排序（同数据同结果）、自环/未知端点/重复边忽略、空输入安全。
- 依赖：`dagre-d3-es@^7.0.14` 作为普通依赖（**没有 vendor**：它依赖 lodash-es，整树 2.6MB，打包时 tree-shake 更划算）。
- 测试：`test/graphEngine.mjs` 7 项（确定性 / LR 方向 / 不重叠 / 边界 / 坏输入 / 100 节点 <50ms / ranksep 生效）。
- 对比（`scripts/compare-graph-layout.mjs`，同一批任务旧深度分列 vs 新 dagre）：

| 场景 | 布局 | 宽 | 高 | 列数 | 交叉 | 总边长 |
| --- | --- | --- | --- | --- | --- | --- |
| 链式 10 | 旧 | 3544 | 164 | 10 | 0 | 3204 |
| 链式 10 | 新 | 3784 | 188 | 10 | 0 | 3420 |
| 扇出 1→9 | 旧 | 1052 | 716 | 3（折列） | 0 | 5416 |
| 扇出 1→9 | 新 | 744 | 1372 | 2 | 0 | 4735 |
| 跨项目 14 | 旧 | 1052 | 716 | 3（折列） | 2 | 5831 |
| 跨项目 14 | 新 | 3024 | 484 | 8 | 0 | 6125 |

**结论**：dagre 在交叉数上更好（14 节点场景 2 → 0），依赖方向清楚；但**没有「长列折行」**——扇出 9 个兄弟会排成一根很高的列。
所以 P1 必须补一层 **rank 折行**（沿用旧代码的思路：一列超过 N 个就拆成多根物理列，下游 rank 相应右移），
否则大扇出会比现在更难用。P1 验收里加：扇出 1→9 的高度不超过 800、宽度不超过 1400。


### P0/P1 进展（2026-11-15 22:xx）

- **rank 折行**已补进引擎：`maxRankRows=5`（卡片约 105–124px 时一列约 750px），超过就拆成多根物理列，
  后面的 rank 整体右移；折完再做一次 **rank 垂直中心对齐**（否则「1 父 + 20 子」的父节点会掉到画布最下面）。
- 最终对比（同一批任务，dagre + 折行 vs 旧深度分列）：

| 场景 | 布局 | 宽 | 高 | 列数 | 交叉 |
| --- | --- | --- | --- | --- | --- |
| 链式 10 | 旧 | 3544 | 164 | 10 | 0 |
| 链式 10 | 新 | 3784 | 188 | 10 | 0 |
| 扇出 1→9 | 旧 | 1052 | 716 | 3（折列） | 0 |
| 扇出 1→9 | 新 | 1084 | **780** | 3 | 0 |
| 跨项目 14 | 旧 | 1052 | 716 | 3 | 2 |
| 跨项目 14 | 新 | 3024 | 484 | 8 | **0** |

- 测试：`test/graphEngine.mjs` 9 项（含「20 兄弟 + maxRankRows=6 → 4 列、高度被压住」与「maxRankRows=0 不折」）。
- 还差 P1 剩下两件：GraphView 切到新引擎（保留 nodePos 覆盖）+ 图头「自动排布 / 全部重排」按钮。

### P1（引擎接管坐标）完成（2026-11-15 23:15）

- `src/graph/relayout.js`：`relayoutGraph(graph)` / `relayoutScope(scope)`——结构仍来自 layoutScope，
  坐标换成 dagre；多图纵向堆叠时重算 `top`，`bands` 保持 `[]`。
- `OverviewPanel` 的 `drawing` 改成 `relayoutScope(layoutScope(...))`（测试可注入 relayout）。
- 画布 header 原有的「重新布局」按钮现在语义正确：清掉该图手动位置 → 回到引擎布局。
- **浏览器模块问题**：独立海湾页用浏览器 ESM 直接加载 src/*.js，裸模块名解析不了。
  解决：`scripts/build-vendor-dagre.mjs` 把 dagre + graphlib（含 lodash）打成单文件
  `src/vendor/dagre.js`（261KB，MIT），engine 改为相对 import；路由放行 `/tasks/(graph|vendor)`。
- 打包体积：client.iife.js 578KB → 643KB（+65KB，含 dagre）。
- 测试：`graphRelayout.mjs` 3 项；`overviewRoute` 增加 graph/vendor 路由断言；全量绿。
- 实机验证（无头 Chrome + 临时 server）：独立海湾页 3 节点链式图正常、关系页 3 张 DOM 卡、无 console 错误。
- 待重启：宿主内嵌 tab 与侧边栏都走启动时的 bundle / 刚装的 index.js，重启后生效。

### 事故修复：画布上的卡片完全没样式（2026-11-15 23:20）

- 现象：关系页的卡片挤成一团（头像变大图、没有边框/尺寸），因为共享卡片的样式表从来没注入宿主页——
  `TASK_CARD_STYLES` 只存在于模块里，面板靠 panel.html 的旧 CSS 才看着正常；画布只有 `.tc-scope` 类名，
  没有任何规则，也没有 `--tc-*` 令牌映射。
- 修复：
  1. `taskCardStyles.js` 增 `ensureTaskCardStyles(doc)`（按 id 只插一次）；
  2. `GraphView` 模块加载时调用（宿主页 / 独立页共用）；
  3. `styles.js` 给 `.fo-node-dom` 定义全部 `--tc-*` 令牌（映射到 14 个宿主令牌 + color-mix），
     并让 `.fo-node-dom > *` 撑满高度、裁掉溢出。
- 验证：无头 Chrome 实测卡片 304×126、9px 圆角、有边框/底色、0 console 错误；截图见仓库根
  `graph-card-fixed.png`；新增 `taskCardStyles` 注入幂等测试与 GraphView 注入断言。

### 再次修卡片外观：chip 变成「灰色占位条」（2026-11-15 23:25）

- 现象：画布卡片上的 chip 全变成没有文字的浅灰圆角条，看起来像骨架占位。
- 根因：`--tc-sub` 被映射成了 `--dsw-alias-label-secondary`（**文字色**），而卡片里 `--tc-sub`
  是当 **浅色底** 用的（`.chip` 的 background）→ 浅灰字压浅灰底，文字等于隐形。
- 修复：`--tc-sub` 改成 `color-mix(in oklab, label-primary 9%, transparent)`（浅色底）。
  无头 Chrome 加了一段对比度审计：卡片内所有文本与有效背景的对比度 < 2.2 的全部列出来，现在为空。
- 同时把卡片宽度 300 → **340**（用户口径：画布上太窄）。
- 更新 `overviewLayout` / `overviewPanel` 里写死的 300 断言；全量绿，已重装（备份 `20261115-232547`）。

### 为什么画布卡片和侧边栏「不一样」：整体缩放（2026-11-15 23:32）

- 真因：画布 SVG 用 `width/height: 100%` + `viewBox` + `preserveAspectRatio="xMidYMid meet"`，
  浏览器为了塞下整张图会**整体缩放**，卡片 340px 被缩到 ~135px、12.5px 字号缩成 ~5px —— 所以字小、比例怪、
  看起来像另一个组件。侧边栏是原生 DOM，永远 1:1。
- 修复：画布改成 **1:1 渲染**（SVG 宽高 = layout 宽高、xMinYMin），缩放交给工具条/滚轮；
  「适应画布」按钮真正实现 fit（不放大、居中）；容器 `overflow: auto` 兜底。
- 同时把面板卡片也套进 `.tc-scope` 并映射 `--tc-*` → 面板调色板：两边现在加载**同一份 taskCardStyles**。
- 仍然「不可能完全一样」的三处（有意）：画布卡片宽度固定 340 / 面板随栏宽；画布只有「打开会话·聚焦」两个动作，
  面板有完成/文档/同步/评论/挂起；画布用宿主主题令牌，面板用 iframe 自己的亮暗调色板。

### 画布卡片收口（2026-11-15 23:45）

- 按用户口径去掉画布卡片的动作行（不再有「打开会话 / 聚焦」）：`GRAPH_CARD_ACTIONS = []`，
  点击节点 = 聚焦，Enter/Space = 打开会话；`estimateCardHeight` 不再预留 34px 动作行（卡片 190 → 156）。
- 统一卡片样式：面板 bridge 也注入共享 `taskCardStyles`（`.tc-scope` 规则与画布同一份）；
  两边 token 语义对齐：sub 都用宿主/面板的 layer-2 底色，text-3 都用 secondary。
- 侧边栏保留「完成/文档/同步/评论/挂起」那一排（它是管理面），画布只读。
