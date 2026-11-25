# CoveTask AI 洞察与建议：六小时计划

创建：2026-11-25，Asia/Shanghai。目标：复用 DSH 能力，完善 React 洞察、今日洞察和建议；用可靠任务证据帮助用户纠偏、履约、主线和优先级管理，同时兼顾短期交付与长期投入。不是另造任务系统。

## 执行边界

- 沿用现有任务模型、organizeSuggestions 建议单、insight API、DSH LLM 与自动化，不另造调度器或模型框架。
- 事实与数值本地计算；AI 负责解释、归纳和建议；缺失数据明确标注，不能把推断当事实。
- 生成建议不等于执行。任务修改、排期与飞书写回沿用接受/确认链路。
- 新增核心领域概念先征求用户确认；无人值守时记录待确认，并继续不依赖该概念的工作。
- 尊重已有未提交修改；不覆盖、回滚或顺手提交。不发布、不 push、不改无关插件。
- 理论只作为分析视角（明确下一步、在制品限制、重要/紧急、目标与反馈复盘），不据此扩展领域实体或给用户贴人格标签。

## 六轮安排

1. H1 调研与复用：核实三处数据流、DSH/相关插件能力、真实测试基线；产出最小架构取舍和实施切片。
2. H2 任务证据：梳理已有履约、延期、关系、优先级、任务描述与时间字段，改善 AI 输入完整性、预算与来源；不另建任务库。
3. H3 今日洞察：基于可靠证据补强诊断，明确优点/风险/可执行下一步；复用用户可配置 prompt/playbook 与已有缓存/job。
4. H4 React 界面：接入既有今日洞察链路，统一统计、摘要、生成入口与 loading/empty/error 状态，不复制旧页面整块实现。
5. H5 建议与主动能力：复用现有建议接受/拒绝/撤销、范围和去重；接通可证据化建议。主动生成配置以现有能力能承载的最小方案为限，未确认的新策略仅提案。
6. H6 集成验收：相关测试、客户端构建、必要的现有 GUI 验证，修复回归并交付真实报告；不以计划结束冒充功能完成。

## 每轮协议

先读本计划及 git status，找首个未完成阶段，补上轮失败再推进；每轮先声明一个可验证切片。变更后亲自检查 diff 并跑相关测试；不为测试加正式代码特殊分支。更新进度、命令/结果、未验证项和下一步。若六阶段已完成只报告不扩范围。DSH 离线时定时投递可能合并，按阶段进度恢复，不假装每次都执行过。

## 进度

- [x] H1（2026-11-25 01:00）：只读核对 React、诊断 API、建议单、DSH LLM 与调度复用能力。`node test/insightView.mjs && node test/insightDatasets.mjs && node test/insightWorkspace.mjs && node test/organizeSuggestions.mjs` 全通过（54 项洞察视图 + 数据集/工作区 + 37 项建议单）。H2 最小切片：先修正 AI 取材覆盖与截断声明；React 诊断接入按 H4 执行，不抢跑。
- [x] H2（2026-11-25 02:00）：诊断取材显式化与证据补强。取材只展开前 15 条时明确声明「共 N 条 / 还有 M 条未展开，不要对未展开任务下结论」；宿主 12000 字符截断改为按行截断并带标记；缓存签名补入优先级、最近延期时刻、关系边、用户 playbook/忽略词；单任务带前置/后继/来源/派生与未完成前置数，全局补关系概览与孤岛数。验证：`node --check index.js && node test/relations.mjs && node test/meta.mjs && node test/insightView.mjs && node test/insightDatasets.mjs` 全通过（13 组关系测试 + 54 项洞察视图）。未验证：未调真实模型，未跑需启动宿主的 smoke。
- [x] H3（2026-11-25 03:00）：诊断输出补 `strengths`（0-2 条、带证据、与 issues 同源同格式），提示词要求优缺点对称并禁止硬夸；`PROMPT_REV` 15→16 让旧缓存自动重算；早会模式不产出该字段。契约写进 `test/morningPrompt.mjs`（断言提示词必须包含 strengths 与对称规则）。验证：`node test/morningPrompt.mjs && node test/meta.mjs && node test/insightView.mjs` 通过。
- [x] H4（2026-11-25 03:00，代码完成，界面待实机验证）：`src/client/api.js` 增 `insight / insightDiagnose / insightAi` 三个方法；`InsightFeature.js` 顶部新增「AI 诊断」整行面板——挂载时只读已有结果（零模型成本），点按钮走后台 job 并每 2.5s 轮询（上限 60s），渲染 headline/summary/issues/strengths/advice/improve/履约/延期模式，问题与优点共用同一种行并可跳到任务；loading/running/empty/error/unsupported 六态齐全。样式追加 `fd-ai-*`，仍只用宿主令牌、零字面量颜色。验证：`pnpm run build:client` 成功；`dashboardStyles`/`cssComments`/`standaloneTokens`/`insightChartsPanel`/`insightDatasets`/`insightWorkspace` 全通过。未验证：未在 GUI 实机点开（需重载插件读新客户端包）。
- [x] H5（2026-11-25 04:00）：洞察 → 写回。`api.insightExport` 接既有 POST `/api/insight/export`；诊断行旁加「写评论」两段式交互（先确认再发，成功/失败/写入中都有就地状态），只把这条结论与证据写进该任务的飞书评论。风格与其他动作一致，样式新增 `fd-ai-acts/fd-ai-write`。主动生成只写提案、未实现。验证：`pnpm run build:client` 成功；`dashboardStyles`/`cssComments`/`standaloneTokens`/`insightView`/`morningPrompt`/`insightChartsPanel` 全通过。未验证：未真发飞书评论（需真实任务与 CLI），未在 GUI 点击。
- [x] H6（2026-11-25 05:00）：真浏览器验证并修掉两个只有实机才暴露的缺陷。
  - 缺陷 1：`aiPanel` 在 `panel()` 定义之前组装 → `Cannot access 'panel' before initialization`，切到洞察页整页白屏。已把面板组装移到 `panel()` 之后。
  - 缺陷 2：`setAiState` 的降级分支写成空函数（应为 `setAi`）→ 诊断永远停在「正在读取」。这正是照抄旧写法的坑：有 hooks 时 `ai` 是状态值而不是数组。
  - 缺陷 3：前端 api 白名单漏了 `insight/insightDiagnose/insightAi/insightExport` → 面板降级成「宿主不支持」。已补进 `OverviewPanel` 白名单（该类漏项此前也发生过：v0.22.0 漏 `health`）。
  - 体验修正（截图后发现）：分区标题与行标签重复（「要处理」两次）→ 行标签改显示严重度（严重/注意/提示）；诊断正文 767px 把整页图表推走 → 正文限高 300px 滚动，页脚按钮常驻。
  - 验证方式：`scripts/serve-tasks-page.mjs 8794 --snapshot /tmp/cove-overview.json --stats ... --insight /tmp/cove-insight.json` 起独立预览宿主（真实快照 + 一份诊断样本），在浏览器里切到洞察页实测：12 个面板正常、诊断面板渲染 headline/摘要/3 条问题+2 条优点/下一步/3 条改法/履约/延期模式、无 console 错误、正文可滚动、按钮可点。回归：`insightView`/`insightDatasets`/`insightWorkspace`/`insightChartsPanel`/`morningPrompt`/`dashboardStyles`/`cssComments`/`standaloneTokens`/`deadStyles`/`organizeSuggestions`/`organizeRoute`/`safety`/`meta` 全通过；`pnpm run build:client` 正常。
  - 预览脚本新增 `--insight <file>`（仅本地预览用，不参与宿主真实路由）。
  - 仍未验证：宿主内真实插件（需 disable→enable 或重启 DSH 才读新客户端包）；真实模型产出的字段质量；真实飞书评论写入。

## 起始状态与证据

- git status 成功。已有改动：README.md、DESIGN-ai-assistant.md、OrganizeDrawer.js、overviewPanel.mjs、pnpm-lock.yaml；另有无关未跟踪目录。上述内容不得覆盖。
- 已读 DESIGN-ai-assistant.md：现有 insight API、建议状态机、统一入口已有设计，主动推送尚属后续阶段。文档行号已落后于 index.js，需依实际实现核实。

## H1 调研结论与下一轮入口

- React 洞察目前只接历史指标，没有 AI 诊断入口：`src/client/InsightFeature.js:133–175`；客户端网络出口 `src/client/api.js:179–182`。H4 应复用工厂依赖注入，接既有 GET `/api/insight`、POST `/api/insight/diagnose`、GET `/api/insight/ai`（`index.js:11595–11631`）。读取已有诊断不触发额外模型调用。
- 后端已有后台 job 去重（`index.js:8541–8568`）、缓存及用户 prompt/playbook（`index.js:8572–8609`）、履约桶本地校验回填（`index.js:8718–8738`）。不新增另一套诊断引擎。
- 任务取材只展开过滤后的前 15 条（`index.js:8302`），返回数量却是全部 kept.length（`index.js:8376`）；模型调用又静默截至 12000 字符（`index.js:9059`）。H2 优先明确局部覆盖、预算截断及结论适用范围；保留已有数量字段兼容，不把总数误当成详细分析数。
- 诊断签名覆盖标题/状态/活动/预期/延期条数（`index.js:8525–8536`），但未完整覆盖描述/优先级/延期内容/配置。H2/H3 要核实缓存依赖，避免输入改变仍复用旧结论。
- 建议接受/拒绝/撤销沿用 `organizeSuggestions.js` 与 `index.js:6775–6989`；自由文本诊断不能直接转可写动作。
- DSH 模型直接复用 `index.js:9045–9070`，不读取额外凭据；定时复用 `dshSchedule.js:1–17,86` 及宿主 schedule 服务。该桥仍描述旧 selector，能力限制须对照实际服务核验，不能直接当当前宿主限制。
- 可借鉴但不直接依赖其他业务插件：Contract Butler 的内容哈希缓存/逐批校验（`src/aiWorkflow.ts:304–383`）与宿主 AI 适配（`src/hostAi.ts`）；broadcast 的轮次结束事件接线（`src/wiring.ts`）、去抖/静默时段（`src/turn.ts:74–99`）、配置默认值补全（`src/config.ts`）。这些不是共享任务服务或 CoveTask 配置，不直接套业务 schema。
- 验证范围：本轮只跑离线基线，未调用真实模型、未改任务、未验证浏览器效果、未构建/安装插件。正式代码尚未修改。

## H3 计划（下一轮入口）

- 诊断输出目前只有 issues（问题）/ advice（一句建议）/ improve（最多 3 条改进），缺「做得对的地方」。用户明确要「看到优点和缺陷」，H3 给结果加一个 `strengths`（≤2 条，同样要求证据），并在提示词里要求优缺点对称；不加新实体、不落任务。
- 输出字段是既有 `state.insight` 的扩展，UI（H4）直接渲染；旧缓存缺该字段时按空数组降级，不炸。
- 不改变「诊断零副作用」：strengths 只是解释性文本，不产生可接受动作。

## H5 计划（下一轮入口）

- 「洞察 → 建议」不做自由文本转可写动作：诊断结论只解释，不生成待接受条目。H5 只做两件复用型增量：面板加「写回评论」（复用既有 POST `/api/insight/export`）；把主动生成（定时/同步后自动诊断）写成明确提案，等用户确认后再实现，不擅自加配置项。
- 理由：主动推送涉及新增调度与配额语义，属于用户要求「先确认」的新概念；本轮无人值守只记录方案。

## 待确认

### 主动洞察提案（未实现，等用户点头）

- 触发点二选一，都复用现有能力：① 同步完成后（已有同步钩子）判断「今天还没诊断过」就跑一次；② 用 DSH 自动化定时（必须绑定会话，现状已支持），由用户在设置里开。
- 频率与配额：同一自然日 + 同一范围最多自动跑一次；手动点「重新诊断」不受此限。
- 结果来源标 `proactive`，进现有建议/洞察入口并显示未读角标；**仍然只生成、不写回**，任何任务修改都要用户点。
- 需要确认的点：默认关还是默认开；是否复用 `insightButtons` 里的「诊断」提示词；是否需要按范围（工作区/分类）分别生成。
- 未确认前的替代：用户每天手动点一次「跑一次诊断」，成本与自动相同（只差一次点击）。

## H7 视觉重构（2026-11-25 11:00，同日追加需求）

目标：把「AI 诊断」从一块信息面板做成洞察页的视觉锚点，并让整页节奏与它一致。

**形象取舍（查过 GitHub 开源方案）**

- DiceBear：代码 MIT，风格由各自作者授权（42 个 CC0，其余多为署名或免费商用）。但所有风格都是**固定配色的成品 SVG**，塞进宿主明暗两套令牌体系里既花又不可控；体积/依赖也不划算。
- boring-avatars（MIT）：几何头像，没有表情，无法表达「思考中 / 有风险」。
- Open Peeps（CC0）：手绘人物，表情固定，同样不能跟着状态变。
- 结论：**自绘「海湾小助手」**（`src/client/AiMascot.js`），内联 SVG、零网络依赖、每一笔都走 `--fd-*` 令牌，四种心情（待命 / 思考 / 开心 / 提醒）由数据决定。风格取向参考上面几家的「拟人 + 状态表情」，不使用其代码或素材。

**H7.1（同日第二轮反馈）**

- 改名：卡片标题「AI 诊断」→「洞察」；hint 改为「根据任务与对话给出的判断，不改任何任务」。
- 重排：判断 → 下一步 → 两栏结论 → 轻脚注。原来的「一条结论一张卡」共 12 张同质卡，视觉上分不出轻重；现在
  「要处理 / 做得对」两栏列表（序号/对勾 + 判断 + 依据 + 动作，左侧色条分区），「下一步」是唯一强调块，
  改法/履约/延期降到脚注（chips + 一行 meta）。去掉「展开全部」的状态与按钮——数据本身有上限（3/2/3），不需要它。
- 响应式：窄容器（≤819px）时三个刻度从右栏挪到下一行。
- 回归：`aiMascot`/`dashboardStyles`/`insightView`/`cssComments`/`standaloneTokens`/`deadStyles`/`meta` 全绿；空态与有结论态都在浏览器里看过结构。

**H7.8（卡片去掉标题，外观与其它卡片完全一致）**

- 去掉「洞察」标题：`panel()` 现在在 `title/hint/extra` 全空时**不渲染头部**，其它卡片行为不变；`aria-label` 仍给「洞察结论」，读屏不会读到空 section。
- 同时删掉上一轮为「贴顶」加的 `.fd-panel[data-mod="ai"]` 上内距/字号/头部下边距覆盖——卡片外壳回到全站统一的 `--fo-card-pad`。
- 实测：`hasHead=false`；padding 20/20、圆角 20 与其它卡片逐项相同；内容距卡片上沿 21px（就是统一内边距）；卡高 546 → 529。
- 回归 12 项全绿（含 `deadStyles`：没有留下无人引用的样式）。
**H7.7（去掉解释性副标题，标题贴顶）**

- 删掉卡片副标题「根据任务与对话给出的判断，不改任何任务」——这类“说明我们很小心”的话没人看，还占一行把标题挤下去；
  同步删掉上一轮加的脚注「数字来自本地任务数据…」和对应样式（同类冗余文案）。
- 标题贴顶：`.fd-panel[data-mod="ai"]` 上内边距 20px → **12px**、头部下边距 10 → 6px；实测标题距卡片上沿 **13px**，与左栏「状态」行、右栏判断行同在 117px 这一带。
- 验证：面板文本里已不含「不改任何任务」「采纳前请核对」；`dashboardStyles`/`aiMascot`/`morningPrompt`/`insightView`/`cssComments`/`packageFiles`/`deadStyles` 全绿（`deadStyles` 确认没有留下无人引用的样式）。
**H7.6（内容优化：本地数据 + 更实的建议）**

- 左栏「数据」换成**引擎本地口径**（`/api/insight` 的 `local`），不再展示模型自评的 focus/throughput/hygiene：
  今日完成 / 完成度（带细进度条）/ 今日活跃 / 停滞占比（`deviation` + 高中低）；下面一行是看板总数、在跑、未开始。
  老宿主没有 `local` 时退化到 `board` 的两个数字，不显示 0%。
- 右栏：
  「下一步」文本里若点名了 `T<号>`，右侧给一个「打开 T…」按钮直达任务（不新增字段，只做识别与跳转）；
  脚注补一行来源说明：数字来自本地任务数据、判断由模型生成、采纳前核对；
  `improve` 仍是 chips，`要处理/做得对` 仍是带证据的行。
- 提示词（`PROMPT_REV` 16→17）：advice 必须点名 T 号 + 写清「做什么 / 到什么算完成 / 什么时候」，
  「提高效率、加强沟通、注意风险」这类换个项目也成立的话判为空话；improve 每条必须能对上一条任务或一个数字，宁少勿凑。
- 契约测试：`test/morningPrompt.mjs` 新增断言（点名 T 号 / 换个项目也成立 / 等于没给建议 / 必须能对上证据 / 宁少勿凑 + rev≥17）。
- 预览宿主新增 `--local <file>`，用宿主真实 `local` 验证左栏（避免拿假数据自证）。
- 验证：浏览器里左栏读到「今日完成 6 条 · 完成度 60% · 今日活跃 10 条 · 停滞占比 0% · 低」，看板行「共 64 条 / 在跑 6 / 未开始 0」；下一步出现「打开 T520368」；旧刻度样式已删除（gauges=0）。
  回归：`dashboardStyles`/`aiMascot`/`morningPrompt`/`insightView`/`cssComments`/`packageFiles` 全绿。
**H7.5（回退 3D，动图去背景）**

- 用户判断：3D 太重 / 加载不出来 → 撤掉 `model-viewer`（1MB）与 `zkp-folio.glb`，删除 `AiFigure3D.js`、对应路由与 `data-mode` 样式；assets 从 1.5MB 回到 **240KB**（只剩动图）。
- 背景问题定位：那张 webp **自带 alpha**（VP8X 0x10 已置），所以圆底与缺角全是我加的样式——`.fd-ins-face` 的径向渐变 + 40px 圆角、以及 `img` 的 `border-radius: inherit` 裁切。
- 修法：去掉渐变、圆角、透视与轨道环；`img` 按原始比例（309×382 → 168×208）直接摆，`border/radius/background` 全部清零；SVG 兜底与动图放进同一个 grid 区域叠起来，避免两者相加把左栏撑高。
- 另一个真问题：淡入用的 opacity 过渡在真实浏览器里卡在 0（`CSSTransition currentTime` 恒为 0，图片加载完却看不见）→ 去掉过渡，改为 `display` 切换，加载完直接显示。
- 验证：`img` 168×208、`display:block`、`border-radius:0`、面层 `background-image:none`；图片底边、左栏底边、右栏底边都在同一像素（608）；无残留类名与路由；`dashboardStyles`/`aiMascot`/`packageFiles`/`insightView`/`cssComments` 全绿。
**H7.4（形象：主页 folio 里的 KP hero 模型，已回退）**

- 用户口径「主页用到的那个 hero 模型」→ 定位到站点首页 3D 小镇场景：`bg/folio/index.html` → `assets/index-*.js` → 加载 `zkp/zkp-folio.glb`。
- 模型事实：171KB、**1 套骨骼 / 60 个关节**、1 张 512 贴图、无内建动画片段（主页由代码驱动骨骼）。比之前的 hero-character（1MB、无骨骼）小一个数量级，且是「带骨骼绑定」的那只。
- 落地：`assets/models/zkp-folio.glb` + `assets/vendor/model-viewer.min.js`（BSD-3，许可证头保留），路由 `/tasks/assets/zkp-folio.glb`（`model/gltf-binary`）与 `/tasks/assets/model-viewer.js`；客户端 `src/client/AiFigure3D.js` 负责按需注入与挂载。
- 降级链：先显示 profile 动图（242KB）→ 3D 就绪后淡入覆盖；减少动效 / 无 WebGL / 加载失败 → 保持动图，不弹错；3D 层 `pointer-events: none`。
- 踩坑与修法（都写进代码注释）：
  1. `loading="lazy"` + `reveal="auto"` 在卡片的滚动容器里**根本不发请求**（实测 glb 零请求）→ 改 `eager` + `manual`；
  2. 用 `useEffect` 挂载会在状态切换（诊断中/有结论）时被卸载 → 改成稳定的 **ref 回调**挂载，并幂等（已有节点就跳过）；
  3. ref 函数每次 render 换引用会 `null→node` 抖动，把 3D 反复摘掉 → 用 `useRef` 固定同一个回调；
  4. `attachHeroModel` 里必须自己触发 `loadViewer()`（effect 删掉后没人注入查看器，元素一直未注册）。
- 验证（浏览器实测）：`customElements.get("model-viewer")` 有值、`model-viewer.loaded === true`、`data-mode=3d`、canvas 336×336 且不透明像素 12%（不是空白）、glb 与查看器均 200；点「重新判断」切到分析态后 3D 仍在（ref 重挂生效）。
- 包体：assets 1.5MB（模型 167KB + 查看器 1.0MB），动图 242KB 保留作降级。
**H7.3（版式：左状态 / 左下人物 / 右信息）**

- 用户口径：人物放左下、其他信息放右侧、左上一块放状态信息。
- 结构：`.fd-ins` 两栏（236px + 1fr）。左栏 `.fd-ins-rail` 纵向 `space-between`：上=`.fd-ins-status`（更新时间点 + 专注/节奏/收尾三条刻度 + 任务/问题/优点计数），下=`.fd-ins-figure`（168px 头像，底边与右栏底部对齐）；右栏 `.fd-ins-main`：判断 → 下一步 → 要处理/做得对两栏 → 脚注。
- 窄容器（≤819px）自动改上下：状态与头像并排在上、信息在下。
- 头像加载：`img` 的 `ref` 里补判 `complete`，缓存命中也能点亮（React `onLoad` 会漏），失败则摘掉 img 让 SVG 顶上。
- 验证（浏览器实测）：状态块 (121,237) 217×149、头像 (440,262) 168×168 底边 608 = 右栏底边；`data-ready=1`、`img opacity 1`；无 console 错误；`dashboardStyles`/`aiMascot` 通过。
**H7.2（形象：用户自己的动图头像）**

- 用户口径「用 profile 里的 kp 的那个 gif」→ 实际是 blog-cn 仓库 `img/cdn/avatar/20210718003707.webp`：animated WebP，55 帧、242KB，就是 profile 页那张头像。
- 落地：`assets/img/kp-avatar.webp` + 静态路由 `/tasks/assets/kp-avatar.webp`（`image/webp`，浏览器自己播）；`img.fd-figure-img` 覆盖在 SVG 小助手之上，`onLoad` 打 `data-ready` 藏掉 SVG，`onError` 摘掉 img 保留 SVG。
- 竖构图 309×382 → `object-fit: contain`，不裁脸。
- 之前那版 three/model-viewer 方案已整体回退：删除 `assets/vendor`、`assets/models`、`src/client/AiFigure.js` 与对应路由，包体从 +2.0MB 降到 +240KB。
- 验证：路由 200 / `image/webp` / 242072 字节；浏览器 `naturalWidth 309`、`data-ready=1`、SVG 透明、无 console 错误；`dashboardStyles`/`aiMascot` 通过。

**（已回退）H7.2-3D 记录**：曾用 hero-character.glb + model-viewer（BSD-3）实现 3D 人物，`model-viewer.loaded === true` 验证可用，但包体 +2.0MB 且用户改用动图，故移除。


- 素材来自用户自己的仓库 `kp-z/blog-cn`：`models/generated/hero-character.glb`（Tripo 生成、1.0MB、1.67 万面、无骨骼动画）。查看器用同仓库的 model-viewer（BSD-3-Clause，文件头许可证原样保留，见 `assets/vendor/model-viewer.min.js`）。
- 落地：`assets/models/*.glb`+`assets/vendor/model-viewer.min.js` 进包（`package.json files: assets`），由插件静态路由 `/tasks/assets/*` 出（glb 用 `model/gltf-binary`），客户端 `src/client/AiFigure.js` 按需注入。**不连外网**。
- 降级链：减少动效 / 无 WebGL / 脚本或模型加载失败 → 原地保留 SVG 小助手，不弹错、不阻塞；3D 层 `pointer-events: none`，不抢卡片按钮。加载成功给宿主打 `data-ready="1"`，SVG 淡出。
- 旋转：`auto-rotate 18deg/s`（模型本身无动画，运动来自相机环绕）。
- 代价：包体 +2.0MB（模型 1.0MB + 查看器 1.0MB）。替代方案：`bay-dolphin.glb` 只有 43KB，风格更贴「海湾」，换一个常量即可。
- 验证：浏览器实测 `customElements.get('model-viewer')` 有值、`model-viewer.loaded === true`、canvas 存在、`data-ready=1`、无 console 错误；`assets` 路由 200。回归 `aiMascot`/`dashboardStyles`/`packageFiles`/`insightView`/`cssComments`/`standaloneTokens` 全绿。
- 未验证：宿主内实机（需重载插件）；暗色主题下模型的环境光未单独目测。

**结构**

- 位置：整页**第一行**（放在 `.fd-page` 这一层，位于日历/指标那一行之前）。它是这一页的结论，不该排在数据面板后面；页面本身是纵向 flex + 统一 gap，位置调整不需要额外间距规则。
- 英雄区：小人 + 一句判断（headline）+ 理由（summary）+ 专注/节奏/收尾三个小指标 + 动作（展开全部 / 重新诊断）。
- 结论区：一条结论一张卡。下一步单独一张宽卡（品牌色底），其余按「要处理 / 做得对 / 可以改的做法 / 履约与延期」分组；卡片带标签、依据、跳转与写评论。
- 表情与结论对齐：有 `level=bad` 的问题 → 提醒（皱眉 + 警示色天线）；只有好的一面 → 开心（弯眼笑）；其余待命；分析中 → 思考（虚线转圈 + 气泡 + 天线快闪）。
- 密度：默认只露前两排，底部渐隐 + 「展开全部 N 条」；展开后不限高。
- 整页一致性：所有面板标题前统一加品牌色小点；`fd-item` / `fd-kv-item` / `fd-ai-card` 圆角统一到 10/12px；AI 卡用 `data-mod="ai"` 单独加一层极淡品牌晕，不改变其他卡的玻璃质感。

**验证**

- `node test/aiMascot.mjs`（新增，6 项）：四种心情都渲染、未知心情退回待命、开心必须是弯眼且不再有圆眼、只有提醒态有皱眉、每张脸结构齐全、可访问名说明身份。
- 真浏览器（独立预览宿主 + 两份诊断样本）：12 张卡 4 列排布、收起 240px / 展开 591px、同排卡片等高、无横向溢出、无 console 错误；「重新诊断」点击后进入思考态；「写评论」两段确认正常。
- 回归：`dashboardStyles`/`cssComments`/`standaloneTokens`/`deadStyles`/`insightView`/`insightDatasets`/`insightWorkspace`/`insightChartsPanel`/`morningPrompt`/`meta`/`safety` 全通过；`pnpm run build:client` 正常。
- 未验证：宿主内实机（需重载插件）；暗色主题未单独截图（样式只用宿主令牌，但没在暗色下目测）。

**修掉的同源缺陷**：`useState` 的 setter 兜底写成空函数（第二次犯），导致「展开/收起」「写评论确认」静默失效；已改为直接使用解构出的 setter，并写进注释说明判定口径。

### 交付后待用户决定

1. 是否开启「主动洞察」（按上面提案），以及默认开关与频率。
2. 是否把诊断结论进一步提升为**可接受的结构化建议**（例如「给 T5 设周五预期」）。当前只做解释与写回评论，是因为自由文本转写回风险高；要做需要先定「哪种结论可结构化 + 由哪条既有写路径执行」。
3. 宿主内实机验收：重载插件后看一眼洞察页顶部面板是否符合预期。

- 如需新增主线/实践等独立领域实体、自动写回授权策略或主动通知默认策略，先提出方案，未经确认不实施。优先用现有分组、关系、任务和配置表达。
