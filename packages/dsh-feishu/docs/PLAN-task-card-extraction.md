# 计划：把飞书任务卡抽成一个独立组件（侧边栏 / 关系画布共用）

> 用户口径（2026-11-15）：「关系的节点应该和侧边栏完全一致，用一个组件」「慢慢稳定的转移出一个独立组件，
> 抽取时相当于先 copy 一个，然后再关系里测试，然后替换侧边栏」。
> 本文件是这条路径的执行计划：每个阶段都能单独回滚，旧实现一直可用，直到最后一步才删。

## 0. 现状（代码事实）

| 位置 | 实现 | 规模 | 依赖 |
| --- | --- | --- | --- |
| 侧边栏任务卡 | `panel.html` 里的 `taskNode(t)` | 约 500 行 DOM，含 6 个弹出菜单 | 直接读 `app.*`、`toast`、`api`、`load`、`mountTaskMenu` |
| 关系画布节点 | `src/client/TaskNodeCard.js`（SVG） | 228 行，300×84 三行 | `layout.cardGeometry` 的几何 |
| 项目行卡片 | `src/client/cardParts.js` | 45 行 | 两边已经共用（唯一真正共用的东西） |

- 画布是 SVG + `viewBox`，整层再套 `translate(...) scale(k)`（`GraphView.js` 的 `transformOf`），
  所以 HTML 卡要跟着缩放，得放进 `<foreignObject>`（它在同一个 `<g>` 里，天然跟随）。
- `GRAPH_CARD_FIELDS.hidden` 现在明确不画：`due / people / docs / comments / reopen / suspensionNote / listName / trigger`。
  这就是「看着不一样」的直接原因。
- 数据面：画布用 `overviewView()` 的瘦快照，**没有** `due/end/start、schedule、members、docs、customFields、
  listName、meta.trigger、sessionPhase/Alive/Unread、reopenPending`。侧边栏用 `/api/tasks` 全量快照。
  → 想「完全一致」，光换渲染不够，宿主投影也要补（阶段 3）。
- `panel.html` 是经典 `<script>`（不是 module），但同源，可以用动态 `import()` 加载模块；
  已有 `/dsh-feishu/tasks/src/<file>.js` 白名单路由可复用（阶段 4 再加一条 `/panel/src/...`）。

## 1. 目标与非目标

**目标**
1. 一张卡（DOM）只有一份实现，侧边栏与画布都调它；字段、徽标、chip、动作完全一致。
2. 抽的过程可回滚：任何一步出问题，退回上一个 commit 就回到「能用」的状态。
3. 先 copy 后替换：新模块先和旧实现并存，画布先试用，侧边栏最后接。

**非目标（本轮不做）**
- 不把 `panel.html` 整体迁到 React（那是更大的事）。
- 不改卡片的信息架构（哪些字段该显示由现有卡片决定，先 1:1 搬运）。
- 不做虚拟滚动/大规模性能优化（阶段 2 只做 20/50/100 张卡的压测与阈值结论）。

## 2. 组件契约（先定，再写代码）

### 2.1 三层拆分

```
taskCardModel(task, ctx)  →  TaskCardModel     纯函数，不碰 DOM、不碰网络
taskCardView(model, deps) →  HTMLElement       纯 DOM 构造，不读 app / 不发请求
taskCardStyles(tokens)    →  CSS 字符串        只吃 --tc-* 变量，三处共用
```

- **model**：把原始 task + 上下文（当前会话 id、宿主能力位、缩略模式）压成一份「要画什么」的数据：
  每行有哪些 badge/chip、chip 的文案与 tone、动作区有哪些按钮、哪些块因为空数据不出现。
  所有「隐显」规则集中在 model 里，**渲染层不再判断业务**。
- **view**：只做 `h(tag, attrs, children)`。事件一律从 `deps.handlers` 取，缺哪个就不渲染哪个按钮
  （画布没有「同步/文档」就先不渲染，而不是渲染了点了报错）。
- **styles**：只使用 `--tc-*`（line / surface / text-1/2/3 / accent / ok / warn / danger / radius / shadow）。
  侧边栏把 `--p-*` 映射进去，画布把 `--fo-*`（宿主令牌派生）映射进去 —— 两边观感一致，但都不写死颜色。

### 2.2 模式

| mode | 用途 | 差异 |
| --- | --- | --- |
| `list` | 侧边栏 | 全字段 + 全部动作 + 评论区 |
| `canvas` | 关系画布 | 全字段（本轮要求「完全一致」）+ 动作裁剪为：打开会话 / 聚焦 / 详情（其余不渲染） |

> 画布动作是否要照搬「完成 / 文档 / 同步 / 挂起」需要用户拍板：它们都会写飞书，
> 在画布上误点的代价高。**默认先裁剪**，需要时再开 `canvasFull` 开关。

### 2.3 字段清单（model 的输入面）

| 区块 | 字段 | 侧边栏来源 | 瘦快照现状 |
| --- | --- | --- | --- |
| 标题行 | priority / title / no | t.priority / t.title / t.no | 有 |
| 会话 | sessionId / sessionAlive / sessionPhase / sessionUnread | t.*、app.currentSessionId | 缺后三项 |
| 状态 | done / started / new / reopenPending / 已挂起 | t.* | 缺 new / reopenPending / 挂起原因 |
| 人 | members（负责人/关注人 + 头像） | t.members | 缺 |
| 标签 | listName / meta.trigger / customFields | t.* | 缺 |
| 时间 | start / end(due) / schedule / expectedAt + 未同步 | t.start/end、taskSchedule()、commitmentChip() | 只有 expectedAt/startedAt |
| 文档 | docs[]（url/title） | t.docs | 缺 |
| 工作区 | workspaceTitle/Path/Name + 写回状态 | t.* | 有 title/path |
| 关系 | 前置/后置/来源计数 + 预览 | relations | 有 |
| 动作 | 完成/重开、文档、同步、评论、挂起、更多 | handlers | 无 |

## 3. 阶段计划

每个阶段一个独立 PR/commit，**都能单独上线**。阶段 2 之后用户可以随时实机看效果。

### 阶段 0：契约与夹具（0.5 天，只写文档 + 测试数据）

- 产出：本文件 + `test/fixtures/tasks.mjs`（6 类：最简 / 全字段 / 挂起 / 重开待同步 / 无工作区 / 绑会话）
- 验收：字段清单与 panel.html 逐条核对；夹具能被 model 直接吃。

### 阶段 1：copy 出一份独立模块（1–2 天，**不动 panel.html**）

- 新建：
  - `src/card/taskCardModel.js`：`buildTaskCardModel(task, ctx)`
  - `src/card/taskCardView.js`：`renderTaskCard(model, deps)`（`deps.el` + `deps.handlers`）
  - `src/card/taskCardStyles.js`：`--tc-*` 卡片样式
  - `test/taskCardModel.mjs` / `test/taskCardView.mjs`
- 做法：从 `panel.html` 的 `taskNode()` **逐段搬运**，把 `app.*` 换成参数、`toast/api/load` 换成 handlers，
  行为先不改；遇到强耦合的（工作区菜单、文档菜单、评论）先在 model 里标记 `capability: false`，view 跳过。
- 关键测试：**对比测试** —— 同一夹具分别跑「新模块」与「panel.html 现有 `taskNode`（VM 抽取）」，
  断言结构等价（tag/class/文本序列相同；已知差异列白名单）。
- 验收：结构等价测试通过；panel.html 一行没改，线上行为不变。

### 阶段 2：关系画布试用（1.5–2 天，带开关）

- `GraphView` 加 `data-card-render="svg|dom"`（默认 `svg`；环境变量/URL 参数可切，便于实机对照）。
- DOM 模式：节点 `<g>` 里放 `<foreignObject x/y width height>`，里面挂 `renderTaskCard(model, deps)`；
  用 `useEffect` 挂载/更新（key = `node.id + revision`），卸载时清空。
- 必须解决（这是本阶段真正的风险，先做 spike）：
  1. **拖拽**：pointerdown 在 HTML 卡上要能触发节点拖动（把 drag 绑在卡根元素，stopPropagation 只拦内部按钮）。
  2. **点击**：卡内按钮不触发「打开任务」，卡空白处触发。
  3. **缩放**：`foreignObject` 跟随 `viewBox`；字号/行高用 px，与 SVG 卡视觉对齐。
  4. **文本**：禁止选中、禁止浏览器原生拖拽（`user-select:none; -webkit-user-drag:none`）。
  5. **性能**：20/50/100 张卡的首次渲染与刷新耗时，对比 SVG 版；超过阈值（比如 100 张 >300ms）就记结论、暂不切默认。
- 验收：离线预览（`scripts/render-runs-preview.mjs` 加「关系页 DOM 卡」一帧）+ 实机截图对比；
  用户确认「和侧边栏一致」后才进入下一步。

### 阶段 3：数据面补齐（0.5–1 天，可与阶段 2 并行）

- `overviewView()` 任务项补：`end`、`start`、`schedule`（下次时间/暂停）、`commitment`（含 unsynced）、
  `sessionAlive/sessionPhase/sessionUnread`、`reopenPending`、`suspensionReason`、
  `listName`、`meta.trigger`、`customFields`（最多 4）、`docs`（url+title）、`members`（姓名/头像/角色，最多 4）。
- **体积**：瘦快照只给展示所需的最小集；members/docs 截断并在字段名上标注；总体积在测试里卡上限。
- **revision**：新增「用户看得见」的字段要进哈希（due/start/schedule/commitment/会话态/挂起原因）。
- 验收：`overviewRoute` 断言新字段；改一个字段 revision 必须变；同一任务在画布与侧边栏的值逐项相等（测试）。

### 阶段 4：替换侧边栏（1–2 天）

- 新增只读路由 `/panel/src/card/<file>.js`（复用 `/tasks/src` 的白名单实现，注意与 `/tasks` 前缀区分）。
- `panel.html` 用 `import()` 加载共享模块，`taskNode(t)` 变薄壳：
  构建 `model`（数据来自 `/api/tasks` 全量快照）+ `handlers`（现有菜单/动作函数原样传进去）→ 调 `renderTaskCard`。
- 保留 `?card=legacy` 开关跑旧实现一两个版本，方便对照；旧函数改名 `taskNodeLegacy`，不删。
- 测试：`test/taskCard.mjs` 改为跑共享模块；新增静态断言「panel.html 里不再有第二份卡片结构」。
- 验收：面板现有全部前端测试绿；用户实机用一天，无回归后再删旧实现。

### 阶段 5：清理（0.5 天）

- 删除 `TaskNodeCard.js`（SVG 渲染器）与 `.fo-node-*` 里只服务它的样式；保留选中/聚焦/拖拽轮廓。
- 删除 `taskNodeLegacy` 与 `?card=legacy` 分支；扩展「无死规则」测试覆盖 `styles.js`。
- 更新 `docs/PLAN-relations-ui.md`、`README.md`、`CONTRACT.md`、计划记录。
- 验收：`npm test` 全绿；grep 不到 `GRAPH_CARD_FIELDS`；预览产物无回归。

## 4. 回滚点

| 阶段 | 回滚方式 | 影响面 |
| --- | --- | --- |
| 1 | 删新文件 | 无（panel.html 没动） |
| 2 | 开关切回 `svg` | 只影响画布 |
| 3 | 字段是纯增量；revision 变化只影响刷新频率 | 小 |
| 4 | `?card=legacy` 或 revert 一个 commit | 侧边栏 |
| 5 | revert | 需要旧代码还在 git 历史里（阶段 4 不删即可） |

## 5. 风险与对策

| 风险 | 征兆 | 对策 |
| --- | --- | --- |
| foreignObject 事件不灵（拖不动/点不中） | 画布上手感变差 | 阶段 2 第一天做 spike；不行就退回方案 B（保持 SVG，只补字段） |
| 卡片 CSS 污染全局 | 面板其它区域变形 | 全部选择器以 `.tc-` 开头 + `--tc-*` 变量；禁止裸标签选择器 |
| 两套实现漂移 | 改了一边忘了另一边 | 阶段 1 的对比测试 + 阶段 4 后删除旧实现 |
| 瘦快照变胖 | revision 轮询变慢 | members/docs 截断；体积断言 |
| 画布动作误写飞书 | 误点「完成」 | canvas mode 默认不渲染写操作 |
| 性能 | 100 张卡卡顿 | 压测阈值 + 保留 SVG 开关 |

## 6. 时间与交付

| 阶段 | 预估 | 交付物 |
| --- | --- | --- |
| 0 | 0.5 天 | 本文档 + 夹具 |
| 1 | 1–2 天 | `src/card/*` + 两个测试 + 等价性报告 |
| 2 | 1.5–2 天 | 画布 DOM 卡（开关）+ 对比截图 + 压测结论 |
| 3 | 0.5–1 天 | 瘦快照新字段 + revision + 测试 |
| 4 | 1–2 天 | 侧边栏接共享模块 + legacy 开关 |
| 5 | 0.5 天 | 删除旧实现 + 文档 |

合计约 **5–8 个工作日**；阶段 2 结束（约第 4 天）就能在实机上看到「两边一样」。

## 7. 进度（2026-11-15）

- **阶段 0 完成**：`test/fixtures/tasks.mjs` 覆盖最简 / 全字段 / 挂起 / 运行中 / 重开待同步 / 无工作区 6 类形态；
  字段契约写进 `CARD_CONSUMED_FIELDS`（模型源码里显式列出）。
- **阶段 1 第一片完成**（只 copy，`panel.html` 一行未改）：
  - `src/card/taskCardModel.js`：`buildTaskCardModel(task, ctx)` + 纯函数（`normPriority` / `shortDayText` / `scheduleNextText` / `etaShortText` / `toneForTask`）
  - `src/card/taskCardView.js`：`renderTaskCard(model, { el, task, handlers })`；没有 handler 的控件渲染成不可点，不假装能点
  - `src/card/taskCardStyles.js`：`.tc-scope` 作用域 + `--tc-* → --p-*` 回退 + 3 个 keyframes
  - 测试：`test/taskCardModel.mjs`（24）、`test/taskCardView.mjs`（13）、`test/taskCardStyles.mjs`（6）、`test/taskCardParity.mjs`（3）
  - 跑法：`npm run test:card`
- **阶段 1 第二片完成（2026-11-15 下午）**：
  - `src/card/taskCardMenus.js`：`mountCardMenu`（定位 + 外部点击/Esc/滚动关闭 + 焦点归还）、`buildPriorityMenu` / `openPriorityMenu`（P0-P3 + 清除）；
    菜单样式独立成 `TASK_MENU_STYLES`（`.tc-menu` 作用域，同套 `--tc-*` 令牌）
  - `test/taskCardEquivalence.mjs`：在 vm 里跑 panel 的 `taskNode()`（只抽渲染函数，其余打桩），和新 view 逐行对比
    head / meta / actions / docs 的文本序列；6 个夹具全绿 —— 顺带修出三处真差异：
    ① chips 顺序（清单/触发在时间之前）② 挂起/恢复在弹性空白之后 ③ 已完成任务不出挂起
  - `test/taskCardMenus.mjs`（8）验证菜单结构、点选、关闭、定位夹取
  - `npm run test:card` 现在 74 项
- **阶段 1 收口（2026-11-15 晚）**：
  - `src/card/taskCardMenus.js` 补齐通用件：`buildActionMenu`（文档/更多菜单）、`buildWorkspaceMenu`（空列表人话 + 当前项）、
    `buildTextPopover`（排期/预期/绑定文档共用的输入浮层：空值提示、清除、取消、Esc）
  - `src/card/taskCardComments.js`：`buildCommentsModel`（摘要/提示/每条的 status 与可提交性）+ `renderCardComments`；
    宿主给了 commentState 才建模型，画布不传就是 null
  - view 集成：`handlers.comments` 存在才把评论区挂到卡片 body（画布模式默认不挂）
  - 测试：menus 13 项、comments 13 项、view 集成 1 项；`npm run test:card` 共 **93 项**
- **阶段 1 完成标准已满足**：模型/视图/样式/菜单/评论齐了，且与 panel 的 6 类夹具逐行等价；`panel.html` 仍未改一行。
- **下一步（阶段 2）**：GraphView 的 `foreignObject` spike —— 先只做「一张卡 + 拖拽 + 缩放 + 点击」，用开关默认关；
  spike 通过再批量接节点，然后跑 20/50/100 张卡的压测。

### 阶段 2 spike（2026-11-15，开关默认仍走 SVG）

- `src/card/graphCardDom.js`：`projectGraphNode`（布局节点 → 任务投影 + 状态/关系计数徽标）、`graphCardSignature`（只有看得见的内容变了才重建）、
  `buildGraphCardDom`（同一份 taskCardView，动作裁剪为打开会话/聚焦）。
- `GraphView`：新增 `resolveCardRender`；`?card=dom` 或 `props.cardRender='dom'` 时节点渲染
  `<foreignObject><div class="fo-node-dom tc-scope">`，用 ref 挂载并靠签名复用；SVG 分支保持默认。
- `styles.js`：新增 `.fo-node-fo` / `.fo-node-dom`，并在 `.fo-node-dom` 上把宿主令牌映射成 `--tc-*`
  （卡片样式表不需要改一行）；卡片撑满节点框用内联样式，避免破坏「选择器都以 .fo- 为根」的红线。
- 测试：`test/graphCardDom.mjs`（9 项，含「GraphView 确实接了 foreignObject 分支」的静态断言）。
- **已知限制（spike 阶段）**：
  1. 节点尺寸仍是固定 300×84，卡片内容（chips 换行）会裁切；真正一致需要 layout 支持按卡片高度重排（阶段 2 正式版再做）。
  2. 拖拽/点击/缩放在实机 `foreignObject` 里的手感尚未人工验证，只做了结构断言。
- 实机对照：装好后在宿主地址后加 `?card=dom`，关系页节点即走 DOM 卡；去掉参数回到 SVG。

### 阶段 3：数据面补齐（2026-11-15）

- `overviewView()` 的任务项新增（瘦快照不塞整份 state，只补卡片要画的）：
  `start / end / due / listName / trigger / customFields / docs / members / schedule / commitment /
  delayAttribution / suspensionActive / suspensionReason / reopenPending / reopenError /
  sessionAlive / sessionPhase / sessionUnread`。
  members / docs / customFields 各截断 8 条；头像只下发 http(s) 链接。
- revision 哈希补进卡片上看得见的项：`priority / start / end / schedule.nextText /
  commitment.expectedAt / commitment.syncState / sessionAlive / sessionUnread / listName / docs.length / members.length`。
- 画布 DOM 卡接完整任务：`OverviewPanel → GraphFeature → GraphView` 新增 `taskById` 索引，
  `buildGraphCardDom` 以完整任务为底、节点只覆盖布局字段（标题/优先级/会话/工作区/完成态），
  鸭子签名也带上文档/成员/预期等字段（变了才重建）。
- 测试：`overviewRoute` 新增 6 条（卡片字段、头像过滤、会话态、绑定文档后 docs 进快照、revision 必变）；
  `graphCardDom` 加到 10 条。`npm run test:card` 共 103 项。

### 阶段 2 正式版：DOM 卡转正（2026-11-15）

- **去掉临时开关**：`?card=dom` / `props.cardRender` / `resolveCardRender` 全部删除；
  关系画布的任务节点**一律**用 `foreignObject` 挂面板那张卡。ghost 仍用轻量 SVG 虚线框。
- **节点高度动态**：`layout.estimateCardHeight(task)` 按卡片内容（chips / 徽标 / 文档行 / 动作行）估高，
  **同一张图统一取最大值**（等高）并夹在 84–200；摆位与画布高度都改用这个高度，ghost 跟着等高。
- **事件接线收成纯函数**：`graphCardHandlers(node, { hostReady, onOpenSession, onFocusTask })`，
  没会话 / 宿主不可用就不给 open（不再渲染一个点了没反应的按钮）。
- 测试调整：overviewPanel 里针对 SVG 卡片内部（标题 / 徽标 / 动作列 / 三行几何）的断言
  改为「节点是 foreignObject + .fo-node-dom + ref 挂载」，内容与接线由 graphCardDom 单测覆盖；
  overviewLayout 的等高/行距断言改成按实际 node.h 计算。
- 结果：`test:card` 105 项、overviewPanel 239、overviewLayout 25、offline 97 JS 文件全绿。

### 阶段 4：侧边栏接共享卡片（2026-11-15）

- `panel.html`：原 `taskNode()` 改名 `taskNodeLegacy()` 保留兜底；新 `taskNode()` 调
  `sharedCard.buildTaskCardModel + renderTaskCard`，共享模块用动态 `import()` 从
  `/dsh-feishu/panel/src/card/*.js` 加载（index.js 新增该只读路由，白名单同 `/tasks/src`）。
- 面板专属行为通过注入保留：优先级菜单、双击改名、会话胶囊点击 + 悬停提示、排期/预期/工作区菜单、
  完成/文档/同步/更多、文档打开/改名/解绑；评论按钮与挂起控件用
  `extraActions`（before/after spacer）和 `extraBody` 挂回卡片，`_cardComments` 缓存口径不变。
- 兜底：模块没加载好、或 URL 带 `?card=legacy` 时走 `taskNodeLegacy`；模块到达后会重新 `load({quiet:true})` 刷一次。
- 测试：taskCard / cardCommentsPanel / taskCardParity 的对照目标改为 `taskNodeLegacy`；
  overviewRoute 新增「面板能取到 src/card 模块、非模块路径被拒」三条；`offline`（97 JS 文件）全绿。
- 已知取舍：共享卡片的会话胶囊暂时没有面板原来的悬停浮层细节（click 行为一致）；标题双击改名已接。

## 8. review 记录 + 阶段 5（2026-11-15 晚）

### review 结论（抽取后的代码）

- **重复消除**：关系画布的 SVG 重画（`TaskNodeCard.js`）与面板 legacy 卡都已删除，全仓只剩一份卡片实现
  （`taskCardModel / taskCardView / taskCardStyles`），项目行仍共用 `cardParts`。
- **发现并修掉的真问题**：
  1. 共享卡片的成员头像没有「图片加载失败退回首字/人形」的兜底（legacy 有）——已补进 view；
  2. 会话胶囊的悬停提示、标题双击改名在共享卡片里没有入口——view 补了 `sessionTip / renameTitle` 两个 handler；
  3. 文档 ✎/✕、chip 菜单、优先级菜单都需要「锚点元素」，view 的 handler 统一补了第三个参数；
  4. 面板评论/挂起控件没地方挂——view 加了 `extraActions(slot) / extraBody` 两个扩展位。
- **可接受的取舍**：面板是经典脚本，共享模块用动态 import，模块到达前先画「只有标题」的占位再静默重渲染；
  卡片高度是估算（同一张图等高，夹在 84–260），实机偏差可再调常量。

### 阶段 5：删旧实现（已完成）

- 删除 `src/client/TaskNodeCard.js`、GraphView 里的 SVG 卡片分支（ghost 也改用同一张卡 + 虚线容器）、
  `styles.js` 里 `.fo-node-bg/title/badge/sess/action/prio/no` 等 SVG 卡片样式。
- 删除 `panel.html` 的 `taskNodeLegacy` 与只服务它的 `priorityChip / scheduleChip / commitmentChip /
  docChipNode / relationPreviewNode / toneForTask / shortDayText / docAddNode`，以及 `?card=legacy` 开关；
  模块未就绪时用「只有标题」的占位。
- 测试收口：删除 `taskNodeCard.mjs` / `taskCardEquivalence.mjs` / `taskCardParity.mjs`（两份实现都没有了，对照失效）；
  `taskCard.mjs` 改为「面板桥」测试（model 上下文 / handler 接线 / 扩展位）；`taskActivityPanel` 改为 model 级口径；
  `avatarTip / suspensionPanel / liveActivityPanel / cardCommentsPanel` 的静态断言改指 `src/card`。
- 结果：`test:card` 83 项、offline 94 个 JS 文件全绿；已构建并装进 profile（备份 `20261115-180816`）。
- 剩余：实机确认侧边栏/关系页观感（需要重启），再决定是否清掉 `styles.js` 里最后一批无引用变量。

### 阶段 5 收尾：无引用 CSS 清理（2026-11-15 18:48）

- 用脚本把 `styles.js` 的类名与源码逐一对照（`src/client` 除 styles.js / `src/overview` / `src/card`），
  删掉 14 个没人引用的类对应的规则/选择器：
  `fo-caret / fo-nav-caret / fo-crumb(-title/-sub) / fo-graph-caret / fo-graph-name / fo-graph-summary /
  fo-graph-toggle / fo-guide / fo-logo-color(s) / fo-rail-badge / fo-canvas-card`。
  其中 `.fo-root[data-rail="0"]` 那条是逗号选择器组，只删了 caret/角标两个分句，保留文字隐藏的两条。
- 变量：删掉 SVG 卡片遗留的 4 个 `--fo-prio-p0..p3`（卡片里的优先级改由共享组件上色，画布已不再引用）。
- 新增红线测试 `test/deadStyles.mjs`：类名必须能在源码里找到（动态拼接的类走白名单），`--fo-*` 定义必须有引用
  （`--fo-deco-${N}` 这类按前缀认）。现在 `styles.js` 是 180 个类 / 29 个变量，零孤儿。
- 同步更新 overviewPanel 里对已删规则的断言；`deadStyles` 进主 `test` 链。
- 结果：build 通过；test:card 83 项、deadStyles、overviewPanel/Route、client、previewRender、offline、meta、smoke 等全绿；
  已装进 profile（备份 `20261115-184851`）。

### 事故复盘：装进 profile 后「海湾页打不开 / 侧边栏报错」（2026-11-15 23:xx）

三个独立问题叠在一起，全部已修：

1. **独立海湾页打不开**：`GraphView` 改成 `../card/graphCardDom.js` 后，独立页的模块 URL 变成
   `/tasks/card/...`，但路由只放行 `/tasks/(src|overview)` → 404 → 整页空白。
   - 修：路由放行 `card`；`package.json` 的 `files` 白名单补 `src/card`、`src/graph`
     （安装时按 files 打包，漏了目录同样 404）。
   - 防回归：`test/overviewRoute.mjs` 断言 `/tasks/card/*.js` 200；新增 `test/packageFiles.mjs`
     扫描相对 import，要求 `src/<dir>` 必须在 files 里。
2. **侧边栏整页 ReferenceError**：阶段 5 删 legacy 卡时把 `PRIORITY_OPTIONS / PRIORITY_LABEL`
   一起删了，但 `normPriority / prioRank / openPriorityMenu` 还在用。
   - 修：补回两个常量；新增 `test/panelPriority.mjs` 直接跑 `normPriority / sortPanelTasks`。
3. **共享卡片在真实 DOM 里 TypeError**：`taskCardView` 的默认 `el()` 把字符串子节点直接
   `appendChild('feishu')`，测试的桩 DOM 不校验所以没发现。
   - 修：字符串先 `createTextNode`；`test/taskCardView.mjs` 增加严格 DOM（appendChild 只收 Node）的用例。

验证：侧边栏（cdp 打开 /panel）无 console 错误、任务卡正常渲染；独立海湾页 + 关系页（cdp 点「关系」）
无错误、DOM 卡片渲染出来。宿主内嵌的「海湾」tab 走的是打包好的 client bundle，需要再重启一次才会加载新 bundle。
