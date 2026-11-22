# PLAN · React 面板 UI 与 cove 对齐（保留 DSH 主题色）

> 用户口径：cove-task 的 React 界面（现挂在左侧栏的面板）整体页面风格，**除了主题色**，应该和
> cove 项目（kp-z/cove）一致；现在太丑，需要优化。
>
> 本文只讲**视觉壳与样式收敛**，不动数据流、不动功能交互、不动右侧栏那个 iframe（panel.html）。

## 落地进度（2026-11-22 第一刀）

已做（提交范围：`styles.js` / `dashboardStyles.js` / `runsExactStyles.js` / `OverviewPanel.js` + 测试断言）：

| 改动 | 从前 | 现在 |
| --- | --- | --- |
| 页面刻度 | 三页各写：gutter 10 / 12 / 16-20-28，gap 12 / 12 / 24 | 统一 `--fo-gutter` 14 / 20 / 24、`--fo-gap` 16 / 18 / 24（容器查询三档） |
| 卡片圆角 | 14 / 14 / 16 | 统一 `--fo-radius-card` 20 |
| 卡片内边距 | 14 / 20 | 统一 `--fo-card-pad` 16 / 18 / 20 |
| 卡片玻璃 | 洞察 55% 半透明 + 8px 模糊；运行 82% + 12px | 三页同一套：92% 表面 + border-l2 55% 描边 + 12px 模糊（见第二刀） |
| 品牌区 | logo + 两行字（名称 + 副标题） | logo + 一行名字（副标题降级成 title 提示） |

**有意没做的**（避免和更早的口径打架，也避免这轮变大）：

- **没加页头（PageHeader）**：`OverviewPanel.js:1316` 记着用户早前的口径「Header 不放页面名，
  在哪一页看 rail 的选中态就够了」。cove 的页头标题会和它冲突，加之前要用户点头。
- **没改 rail 表面**：用户早前定过「三块表面同层」（rail/右栏 = layer-1、中间 = bg-base）。
  cove 的 rail 比正文更暗，那属于主题色范畴，改不改单独确认。因此也没扩 `bg-sunken` 令牌。
- **没收编运行页的 45 处字面量颜色 / 看板的卡片字面量**：会在浅色主题下改观感，留到下一刀。

## 第二刀：亮色模式（2026-11-22）

用户口径：「主要是亮色模式」。根因不是配色审美，而是**三条假设在亮色下不成立**：

| 假设 | 亮色下的真相 | 后果 |
| --- | --- | --- |
| 提亮一层 = 更高的表面（`bg-layer-1/2/3`） | 三个令牌**全是纯白** | 次级面、悬停面、输入框底全部「不存在」 |
| `border-l1` 够当卡边 | 亮色下只有 ~2.6% 黑 | 白卡贴白底，没有边 |
| 品牌色是「偏亮的中间色」 | 品牌色是**底色的反色**（bluish-1000 近黑 / bluish-50 近白） | 品牌 30% 底 = 30% 黑的灰块；主按钮「品牌 62% + 底色 38%」= 中灰底压近黑字（≈2.8:1） |

改法（仍然只用宿主令牌）：

| 处 | 亮色下从 | 亮色下到 |
| --- | --- | --- |
| 次级面 / 悬停面 | layer-2（= 白，看不见） | label 5~6%（= 黑 5~6%） |
| 卡片描边 | border-l1 65%（≈2.6% 黑） | border-l2 55%（≈5.5% 黑） |
| 卡片投影 | 无 | `0 1px 2px` label 7% + `0 8px 24px -14px` label 12%（暗色里退成贴边高光） |
| 主按钮 | 品牌 62% + 底 38% + 近黑字（≈2.8:1） | 实心品牌底 + bg-base 文字（≈19:1） |
| 选中态 | 品牌 20~30%（一块 30% 黑的灰块） | 品牌 12% 底 / 24% 描边 |

补漏（同轮第二批，都是「亮色下等于不存在」的同类问题）：

- **画布任务卡**（`.fo-node-dom` / `.fo-menu-scope` 的 `--tc-*` 映射）：`--tc-line` 从 border-l1
  （亮色 ≈2.6% 黑，卡边看不见）→ border-l2 55%；`--tc-sub` 从 bg-layer-2（亮色纯白，chip 没底）
  → label 5%；`--tc-select` 8% → 12%。
- **进度条 / 甜甜圈轨道**（`fd-`）：border-l1 30~40% → label 8%，否则亮色下只剩浮空的彩色段。
- **卡片 hover 投影**（`tc-`）：字面量 `rgba(17,24,39,.07)` → label 8%，暗色里退成贴边高光。

### 死代码清理（2026-11-22，与第二刀同批）

`src/card/taskCardStyles.js` 里每条颜色都写成 `var(--tc-x, var(--p-x))`，但 `--p-*` 是
`panel.html` 那套调色板，**React 面板里从没有任何地方定义它** —— 兜底永远解析不到。
那 150+ 处是纯死引用，删掉不改一个像素。

| 动作 | 结果 |
| --- | --- |
| 剥掉 `var(--tc-x, var(--p-y))` 兜底（含三层嵌套与字面量） | 152 处 → 0 |
| 松散的 `var(--p-*)`（7 处，带字面量兜底） | 全部换成对应 `--tc-*` |
| `.fo-node-dom` / `.fo-menu-scope` 两份令牌映射 | 合并成 `taskCardStyles` 里 `.tc-scope` 一处 |
| 卡片菜单的主题作用域 | `fo-menu-scope` → `tc-scope`（少一个只为变量存在的类） |

顺带修好一个真 bug：新建任务 dock 的 `.ftc-prio.tc-scope` 之前没有任何映射（`--p-*` 未定义，
`--tc-*` 也没有），chip 一直是继承色；现在它和卡片共用同一份映射。

新断言：「卡片用到的每个 `--tc-*` 都必须在 `.tc-scope` 映射里定义」——
批量替换时我写坏过 24 处（`var(--tc--tc-x))`），就是靠它兜住的。

配套：`deadStyles` / `overviewPanel` / `dashboardStyles` 里钉住旧数值的断言同步改口径；
「主按钮不得用 bg-base 文字」那条红线**反转**（原前提是品牌为中间色，实测是底色的反色）。

## 0. 先对齐两件事

**参照物**：`kp-z/cove` 的 App Shell。本轮把它的源码拉到 `.tmp/cove-ref`（sparse checkout
`code/frontend`）逐条比对，基准值以源码为准：

| 维度 | cove 的做法 | 出处 |
| --- | --- | --- |
| 骨架 | `MainLayout` = Sidebar + TopBar + Outlet | `shared/components/layout/MainLayout/index.tsx` |
| 侧栏 | 192 / 80 宽、h-12 头部、p-4 gap-2、项 44px / rounded-xl、激活蓝 30% 底 + 50% 描边、底部 p-4 上边框 | `Sidebar/*.tsx` |
| 侧栏表面 | 比正文**更暗**（#0a0b14 vs #0f111a）+ 右侧投影 + 品牌色径向光晕 | `Sidebar/index.tsx` |
| 顶栏 | h-12、`bg-white/[0.03]`、backdrop-blur-xl、inset 顶高光、左右渐变蒙层 | `TopBar/index.tsx` |
| 页面壳 | `PageShell` → `PageHeader`（`px-6 pt-6 pb-4`，h1 `text-2xl bold uppercase` + 副标题 + 右侧 actions）→ `PageContent`（`px-6 pt-4 pb-6`） | `PageShell/PageHeader/PageContent.tsx` |
| 卡片 | GlassCard：`bg-white/5` + `border-white/10` + blur-md + **圆角 24** + `p-6` + hover 抬升 4px/1.01；网格 gap-6 | `ui/cards/GlassCard.tsx`、`design-tokens.ts` |
| 字号 | 正文 14 / 次级 12 / 标题 24；`--radius` 10 为基底 | `index.css`、`design-tokens.ts` |

**不搬的部分**：cove 的蓝色/紫色色相、字号字面量、`AnimatedShinyText`、framer-motion 与 Tailwind
依赖。颜色一律换回宿主的 14 个 `--dsw-alias-*`，这是我们现在就钉住的红线
（`test/standaloneTokens.mjs`、`test/deadStyles.mjs`）。

## 1. 现状诊断（问题都在哪）

### 1.1 三套页面语言并存

| | 看板（`fo-`） | 洞察（`fd-`） | 运行（`frx-`） | cove |
| --- | --- | --- | --- | --- |
| 页边距 | 10px | 12px | 16/20/28px | 24px |
| 卡间距 | 12px | 12px | 24px | 24px |
| 卡圆角 | 16px | 14px | 14px | 24 / 16 |
| 卡内边距 | 12/16 | 14 | 20 | 24 |
| 玻璃模糊 | 12 / 0 | 8 | 12 | 12 |
| 正文/次级字号 | 11/10 | 12/10 | 12/11 | 14/12 |
| 页面标题 | 无 | 无 | 卡内 `h2`「运行状态」 | PageHeader |
| 字面量颜色 | 0 | 0 | **45 处** | 规则禁止 |

证据：`styles.js:762`（`.fo-canvas-area` padding 10）、`dashboardStyles.js:20`（`.fd-page` padding 12）、
`dashboardStyles.js:138`（`.fd-panel` radius 14 / padding 14 / blur 8）、`runsExactStyles.js:23`（`.frx-page`
padding 16 20 28 / gap 24）、`runsExactStyles.js` `.frx-card` radius 14 / padding 20。

### 1.2 半径与字号没有刻度

- `styles.js`：radius 出现 5/6/7/8/9/10/12/14/16/999 ×9 档；font-size 8–20 共 10 档（含 8/9/10）。
- `card/taskCardStyles.js`：font-size 9/10/10.5/11/11.5/12/12.5 —— **半分字号**在中文界面里就是糊。
- `runsExactStyles.js`：45 处字面量色（`rgba(0,0,0,.85)`、`#3b82f6` 兜底），浅色主题下直接脏；
  `taskCardStyles.js` 还有 46 处，且回退到旧面板的 `--p-*` 调色板。
- 结论：**没有"层级刻度"**，每个组件自己发明数字；这是"看起来乱"的第一原因。

### 1.3 侧栏表面层级和 cove 反了

- 现在：`.fo-rail` = `--dsw-alias-bg-layer-1`（`styles.js:146`），正文 `.fo-main` = `bg-base` → 暗色下
  **rail 比正文亮**；而面板本身又嵌在 DSH 的 layer-1 左侧栏里，三块同亮，只剩 1px 线区分。
- cove：rail 比正文**更暗**，用投影代替描边，再用一层品牌色 5% 径向光晕收边。
- 另有 `.fo-brand` 是两行（标题 14 + 副标题 12），cove 是「logo + 单行 realm 名」；底部区只有 1 个
  「打开页面」，cove 是「设置 + 折叠」——折叠已经挪到 logo 上（用户口径），可保留。

### 1.4 没有页面壳，标题塞在卡片里

cove 有 `PageShell/PageHeader/PageContent` 三层；我们的三个功能页都直接从卡片开始，
`运行页` 的标题是卡内 `h2`（`RunsFeature.js:521`），`洞察页` 干脆没有标题。
结果：三页进入后没有"我在哪"的锚点，也没有统一的页级操作位。

## 2. 目标：四层收敛

### L0 令牌层（唯一刻度，落在 `styles.js` 顶部）

只用宿主令牌派生，明暗自动跟随：

```css
/* 层级刻度：只有 4 档，组件不许再写数字 */
--fo-radius-item: 12px;    /* rail 项 / 行 / 按钮 */
--fo-radius-panel: 16px;   /* 侧栏卡 / 抽屉 / 画布 */
--fo-radius-card: 20px;    /* 主内容卡（cove 24，窄面板收一档） */
--fo-radius-pill: 999px;

--fo-gutter: 16px;         /* 面板宽度 > 900px 时 24 */
--fo-gap: 16px;            /* > 1100px 时 20 */

--fo-type-display: 20px/600;  /* 页面标题 */
--fo-type-title: 15px/600;    /* 区块标题 */
--fo-type-body: 13px/400;
--fo-type-meta: 11px/500;

--fo-surface-rail: <bg-sunken | sidebar-fill>;
--fo-surface-main: <bg-base>;
--fo-surface-card: color-mix(layer-1 92%);
--fo-surface-card-2: color-mix(layer-2 88%);
--fo-motion-fast: 150ms;
--fo-motion-base: 220ms;
--fo-ease: cubic-bezier(.2,.8,.2,1);
```

**硬约束**：不再新增字面量颜色；`--fo-*` 只允许出现上面这些 + 已有的语义色/icon 槽。

### L0.1 令牌扩表（**本轮未采纳**：rail 表面不改，就不需要 bg-sunken；下面留作改用例）

宿主的令牌其实比我们放行的那 14 个多得多（从 DSH 包里抽的真实清单里有
`bg-sunken` / `bg-elevated` / `bg-layer-3` / `border-l3` / `border-l4` / `bg-overlay` …）。
本轮只需要多要**一个**：`--dsw-alias-bg-sunken`，用来做「比正文更暗的 rail」；
浅色主题不用它（浅色三层都是白，rail 用 `--dsw-specific-sidebar-fill` 保持白底 + 投影分层）。

扩表要同步改三处，缺一即红：

1. `src/client/styles.js` 里开始引用 `--dsw-alias-bg-sunken`；
2. `tasks.html` 的亮/暗两套兜底值 —— **已经有了**（亮 `#f9fafb` / 暗 `#101113`），`standaloneTokens` 不用改；
3. 放行名单要 +1：`test/overviewPanel.mjs:3240` 现在断言 `used.length === 14`，改成 15；
   `test/dashboardStyles.mjs` 的 `HOST_TOKENS` 如果 `fd-` 也要用 sunken 再加。

**明确不扩的**：`bg-elevated` / `bg-layer-3` / `border-l3` —— 面板只有 4 层表面，多要就是给以后乱用开口子。

### L1 壳层（一个 `AppShell`）

- **rail**：`background: --fo-surface-rail`（暗色用 `bg-sunken`，浅色用
  `--dsw-specific-sidebar-fill`），去掉 1px 分隔线，改 `0 8px 32px` 投影 + 一层品牌色 4% 径向光晕。
- **品牌头**：保留 48px + 折叠按钮挂 logo；文字压成一行 13px/600，副标题降级为 `title` 提示
  （cove 的视觉重心是 logo，不是两行字）。
- **顶栏**：保持 48px / 同底色（已与 cove 对齐），只把渐变色从 `brand 2%` 收到 1% 并统一到
  `--fo-grad-head`，避免三页各自调。
- **页面壳（本轮只做刻度，**不新增页头**）**：三页各自仍是自己的根（`.fd-page` / `.frx-page` /
  `.fo-canvas-area`），但页边距、卡间距、卡内边距全部取同一组 `--fo-gutter` / `--fo-gap` /
  `--fo-card-pad`。页头（标题 + 副标题 + actions）等用户确认后再加 —— 它和「Header 不放页面名」
  的旧口径冲突，不能自己拍。

### L2 组件层（五个原语，替换散装写法）

| 原语 | 规格 | 替换 |
| --- | --- | --- |
| `Card` | radius-card / padding 16（窄）→ 20（宽）/ 1px `--fo-line` / blur 12 / hover 抬 2px | `.fd-panel`、`.frx-card`、`.fo-graph` |
| `Stat` | label 11 + value 22 tabular + hint 11 | `.fd-kpi`、`.frx-kpi` |
| `Row` | 36 高 / radius-item / hover `label1 5%` | `.fo-row`、`.frx-queue-*` |
| `Badge` | 20 高 / pill / 11px | `.frx-badge`、`.fo-tag`、`.tc-prio` |
| `Empty` | 居中，标题 15 + 说明 12 + 一个动作 | `.fd-empty`、`.frx-page[data-empty]` |

### L3 页面层（只换壳，不动数据与交互）

- **运行**：`PageHeader("运行")` + KPI 带 + 气泡墙卡 + 历史卡 + 动作卡；删掉卡内「运行状态」h2。
- **洞察**：`PageHeader("洞察")` + KPI 带 + 4 列面板网格（窄了降 3/2/1 列，现有容器查询保留）。
- **看板**：`PageHeader("看板 · <范围>")` + 范围树 + 画布卡；画布卡内边距跟着 `--fo-gap`。

### L4 收口

- 把 `runsExactStyles.js` / `taskCardStyles.js` 的 91 处字面量收编成令牌；`--p-*` 回退全部删掉。
- 合并重复规则：`fd-` / `frx-` 里和 L2 重复的卡片骨架删除，各自只留**专属图形**
  （气泡墙的 SVG、日历热力图、donut）。
- 新增两条测试：
  1. `noLiteralColor`：`src/client/**` 的 CSS 里 `#hex / rgb( / rgba(` 必须为 0（现有测试只管 `fd-`）；
  2. `pageShell`：三个功能页都必须渲染 `fo-page-head` 且带标题，gutter/gap 只来自令牌。

## 3. 分阶段（每步独立可验收、可回滚）

| 阶段 | 内容 | 改动面 | 验收 |
| --- | --- | --- | --- |
| **P0** | L0 令牌 + `bg-sunken` 扩表（14→15）+ `fo-page` 壳；**只套看板页**做试点 | `styles.js` + `GraphFeature` 少量 + `test/overviewPanel.mjs` | 看板页 gutter/标题/卡圆角全走令牌；明暗两套肉眼一致 |
| **P1** | 运行页套壳；`frx-` 45 处字面量换令牌 | `runsExactStyles.js` + `RunsFeature.js` 页头 | 浅色主题下运行页不再发脏；标题上提到页头 |
| **P2** | 洞察页套壳；`fd-` 面板并入 `Card` | `dashboardStyles.js` + `InsightFeature.js` | 三页 gutter/gap/radius/字号完全一致 |
| **P3** | rail 下沉 + 品牌头一行 + 顶部条/底部区对齐 | `styles.js` + `OverviewPanel.js:1470-1598` | rail 与正文有明确层差；折叠态 80px 仍正常 |
| **P4** | 清理 + 新测试 + 明暗截图核对 | 样式模块 + `test/` | 下列测试全绿 |

预计 **3.5 人日**（P0 0.5 / P1 1 / P2 1 / P3 0.5 / P4 0.5）。

## 4. 验收清单

- 视觉：明/暗各一套；三页页边距、卡间距、圆角、字号一一对应；rail 有层差；无字面量颜色。
- 工程：`overviewPanel.mjs` 的令牌数断言同步到 15；`pnpm --filter @kpeace/dsh-cove-task test:card`、`test:css`、`test:client`、
  `node test/standaloneTokens.mjs`、`node test/deadStyles.mjs`、`node test/dashboardStyles.mjs` 全绿。
- 结构：`grep -c 'padding: 1[0-9]px' src/client` 的页面级命中降到 0（只剩令牌定义处）。

## 5. 明确不做（做减法）

- 不引入 Tailwind / framer-motion / lucide / shadcn；不搬 cove 的蓝紫与 ShinyText。
- 不重写 `panel.html`（右侧栏 iframe 是上一代页面），两边会短暂不一致，本轮不追。
- 不新增页面、不改任务数据/同步/会话逻辑、不做主题切换器。
- 不为"更漂亮"加装饰性动画：只保留 cove 的 hover 抬升与 220ms 过渡。

## 6. 风险与取舍（要用户点头的两处）

1. **运行页收编会改观感**：`frx-` 当时是"照参考项目原值"复刻的，换成令牌后细节会变（但 45 处字面量
   在浅色主题下本来就是错的）。P1 先出对比再决定是否全收。
2. **24px 内边距在窄面板偏肥**：所以卡片内边距用容器查询两档（16 / 20），不直接照搬 cove 的
   `p-6`。如果用户希望"更像 cove"，把宽档提到 24 即可，只改一个变量。
