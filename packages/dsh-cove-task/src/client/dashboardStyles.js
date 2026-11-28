/**
 * 仪表盘/洞察页的样式层（与总览的 `fo-` 完全隔离，类前缀 `fd-`）。
 *
 * 红线（与 `fo-` 那套同样严格）：
 * - **零字面量颜色**：没有任何 #hex / rgb() / hsl()，半透明一律
 *   `color-mix(in oklab, var(--dsw-alias-*) X%, transparent)`；
 * - **只引用宿主那 14 个 `--dsw-*` 令牌**，不自造调色板；
 * - 所有选择器都以 `.fd-` 类为根。
 *
 * 注入方式与 `styles.js` 一致：`injectStyles(doc)` 幂等（按 id 判断），无 document 时返回 false。
 */

export const STYLE_ID = 'dsh-cove-task-dashboard-style'

/** 半透明助手：宿主令牌 + 百分比 → color-mix，避免任何字面量颜色。 */
const g = (token, pct) => `color-mix(in oklab, var(--dsw-alias-${token}) ${pct}%, transparent)`

export const CSS = `
/* ============ 仪表盘根：auto-fit 网格填满主区（最后一列/行自动拉满） ============ */
.fd-page, .fd-today {
  --fd-line: ${g('border-l2', 55)};
  --fd-line-strong: ${g('border-l2', 80)};
  --fd-surface: ${g('bg-layer-1', 92)};
  --fd-surface-2: ${g('label-primary', 6)};
  --fd-sunken: ${g('label-primary', 4)};
  --fd-text: var(--dsw-alias-label-primary);
  --fd-dim: var(--dsw-alias-label-secondary);
  --fd-brand: var(--dsw-alias-brand-primary);
  --fd-ok: var(--dsw-alias-state-success-primary);
  --fd-warn: var(--dsw-alias-state-warn-primary);
  --fd-danger: var(--dsw-alias-state-error-primary);
  /* 同 styles.js：令牌缺失时退成次级文字色，而不是让描边/底色整块失效 */
  --fd-idle: var(--dsw-alias-state-idle-primary, var(--dsw-alias-label-secondary));
}
.fd-page {
  flex: 1 1 auto; min-height: 0; min-width: 0;
  /* 页面 = 「KPI 带 + 网格」两段式：KPI 那一条按内容定高（auto），
     其余面板在下面的网格里平分剩余高度。
     原来整页是一个 4 行等高的 grid，KPI 卡被拉到和图表卡一样高（约 250px），
     里面只有一排 70px 的小卡，下半截全是空 —— 用户口径「最上面这个卡片太高了」。 */
  display: flex;
  flex-direction: column;
  /* 页边距/卡间距走刻度（以前这一页是 12/12，运行页是 16-20-28/24，看板是 10/12） */
  gap: var(--fo-gap, 16px);
  padding: var(--fo-gutter, 14px);
  overflow: auto;
  color: var(--fd-text);
  /* 列数/行高都按「页面自己的宽度」判断（面板会被拖窄），所以这里当容器 */
  container-type: inline-size;
  container-name: fdpage;
}
.fd-grid {
  /* grow 但不 shrink：内容比一屏高时让整页滚动，而不是把面板压扁（压扁会裁内容） */
  flex: 1 0 auto; min-height: 0; min-width: 0;
  display: grid;
  /* 固定 4 列（不是 auto-fit）：宽屏下 auto-fit 会排出 5~6 列，卡片被挤到 240px，
     图例和项目名开始省略（实机截图里「已…」「阻…」）。窄了按容器查询降列。 */
  grid-template-columns: repeat(4, minmax(0, 1fr));
  /* 行高按内容（min-content）+ 卡片各自贴合内容（align-items: start）：
     原来 grid-auto-rows: 1fr 让每行平分视口高度，内容 100px 的卡片被撑到 600px，
     整页一半是空白 —— 用户口径「好多区域空白太多了」。 */
  grid-auto-rows: min-content;
  align-content: start;
  gap: var(--fo-gap, 16px);
}
@container fdpage (max-width: 1099px) {
  .fd-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@container fdpage (max-width: 819px) {
  .fd-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container fdpage (max-width: 539px) {
  .fd-grid { grid-template-columns: minmax(0, 1fr); }
}

.fd-top { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: var(--fo-gap, 16px); }
.fd-top > .fd-panel { min-width: 0; }

/* ============ 活跃日历（GitHub 贡献图：周列 × 7 行 + 月标 + 图例） ============ */
.fd-cal { display: flex; flex-direction: column; gap: 8px; min-height: 0; flex: 1 1 auto; }
/* 日历固定一栏（27 周 × 10px ≈ 340）：热力图不需要占满整卡，右边留给 AI 提示 */
.fd-cal-main { display: flex; gap: 18px; align-items: flex-start; flex-wrap: nowrap; min-height: 0; }
/* 卡片变窄时：日历让位（格子跟着缩），提示语始终在右边 —— 换行的是文字，不是这一行 */
.fd-cal-calendar { flex: 0 1 342px; min-width: 168px; display: flex; flex-direction: column; gap: 6px; }
.fd-cal-hints {
  /* 提示语有下限宽度：再窄就让日历缩，而不是把字挤成一列 */
  flex: 1 1 0; min-width: 140px; display: flex; flex-direction: column; gap: 6px;
  padding-left: 16px; border-left: 1px solid var(--fd-line); justify-content: center;
}
.fd-cal-hints-head { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--fd-dim); }
.fd-cal-ai {
  font-size: 9px; font-weight: 700; letter-spacing: .04em; padding: 1px 5px; border-radius: 5px;
  color: var(--fd-brand); background: color-mix(in oklab, var(--fd-brand) 16%, transparent);
}
.fd-cal-hints-list { margin: 0; padding-left: 14px; display: flex; flex-direction: column; gap: 4px; font-size: 11px; line-height: 1.45; color: var(--fd-text); }
.fd-cal-hints-list li { overflow-wrap: anywhere; word-break: break-word; }
.fd-cal-hints-list li::marker { color: var(--fd-dim); }
.fd-cal-scroll { overflow-x: auto; overflow-y: hidden; min-height: 0; scrollbar-width: thin; }
/* 两列：左边星期标签，右边月标 + 周网格；列数由 --fd-cal-weeks 决定，格子 1fr 撑满卡片宽度 */
.fd-cal-inner {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 6px; row-gap: 5px;
  align-items: start;
  width: 100%;
}
.fd-cal-months {
  grid-column: 2; grid-row: 1;
  display: grid;
  grid-template-columns: repeat(var(--fd-cal-weeks, 27), minmax(0, 1fr));
  column-gap: 2px;
  height: 13px; font-size: 9px; color: var(--fd-dim);
}
.fd-cal-month { grid-row: 1; white-space: nowrap; }
.fd-cal-dows { grid-column: 1; grid-row: 2; display: grid; grid-template-rows: repeat(7, minmax(0, 1fr)); gap: 3px; font-size: 9px; color: var(--fd-dim); }
.fd-cal-dows > span { display: flex; align-items: center; justify-content: flex-end; line-height: 1; }
.fd-cal-grid {
  grid-column: 2; grid-row: 2;
  display: grid;
  grid-template-columns: repeat(var(--fd-cal-weeks, 27), minmax(0, 1fr));
  column-gap: 2px;
  min-width: 0;
}
/* 一列 = 一周：7 个方格竖排，格子宽度由列宽决定、高度跟着宽度（aspect-ratio: 1） */
.fd-cal-week { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fd-cal-grid .fd-cal-cell { width: 100%; height: auto; aspect-ratio: 1; }
.fd-cal-cell {
  display: block; width: 12px; height: 12px; border-radius: 3px;
  background: color-mix(in oklab, var(--fd-text) 7%, transparent);
  outline: 1px solid transparent;
}
.fd-cal-cell[data-level="1"] { background: color-mix(in oklab, var(--fd-ok) 28%, transparent); }
.fd-cal-cell[data-level="2"] { background: color-mix(in oklab, var(--fd-ok) 48%, transparent); }
.fd-cal-cell[data-level="3"] { background: color-mix(in oklab, var(--fd-ok) 70%, transparent); }
.fd-cal-cell[data-level="4"] { background: var(--fd-ok); }
.fd-cal-cell.is-empty { background: transparent; }
.fd-cal-legend { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--fd-dim); }

/* ============ 面板：玻璃卡 + 头/体 ============ */
.fd-panel {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  /* 卡片 = 和运行/看板同一套玻璃：圆角、内边距、模糊都走刻度
     （以前这里是 14px 圆角 + 8px 模糊 + 55% 半透明底，比别处的卡更「糊」） */
  padding: var(--fo-card-pad, 16px); border-radius: var(--fo-radius-card, 20px);
  border: 1px solid var(--fd-line);
  background: var(--fd-surface);
  backdrop-filter: var(--fo-glass-blur);
  -webkit-backdrop-filter: var(--fo-glass-blur);
  /* 亮色里卡片和白底同色：靠描边 + 一层紧投影把边「立」出来 */
  box-shadow: var(--fo-card-shadow);
  overflow: hidden;
  animation: fd-rise 180ms cubic-bezier(.22, .61, .36, 1) backwards;
  animation-delay: calc(var(--fd-i, 0) * 24ms);
  transition: border-color 180ms cubic-bezier(.22, .61, .36, 1);
}
.fd-panel:hover { border-color: var(--fd-line-strong); }
/* KPI 带按内容定高：窄面板下 6 个小卡会折成两行，绝不能被父级 flex 压扁裁掉 */
.fd-page > .fd-panel, .fd-page > .fd-top { flex: 0 0 auto; }
.fd-panel[data-span="all"] { grid-column: 1 / -1; }
.fd-panel-head {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  margin-bottom: 10px; min-width: 0;
}
.fd-panel-title { font-size: 12px; font-weight: 600; letter-spacing: .02em; }
.fd-panel-hint { font-size: 11px; color: var(--fd-dim); }
.fd-panel-extra { margin-left: auto; font-size: 11px; color: var(--fd-dim); white-space: nowrap; }
.fd-panel-body { flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.fd-scroll { overflow: auto; min-height: 0; }

/* ============ 色调：一律走 --fd-tone，不许写死颜色 ============ */
.fd-tone-brand { --fd-tone: var(--fd-brand); }
.fd-tone-ok { --fd-tone: var(--fd-ok); }
.fd-tone-warn { --fd-tone: var(--fd-warn); }
.fd-tone-danger { --fd-tone: var(--fd-danger); }
.fd-tone-idle { --fd-tone: var(--fd-idle); }

/* ============ KPI 气泡行：圆形色圈 + 大数字 + 标签 + 细进度条 ============ */
.fd-kpis {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: 10px; align-content: start;
}
.fd-kpi {
  display: flex; align-items: center; gap: 10px; min-width: 0;
  padding: 8px 10px; border-radius: 12px;
  background: var(--fd-sunken);
  border: 1px solid var(--fd-line);
}
.fd-kpi-bubble {
  flex: 0 0 auto; width: 54px; height: 54px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 17px; font-weight: 600; letter-spacing: -.02em;
  font-variant-numeric: tabular-nums;
  color: var(--fd-tone, var(--fd-brand));
  /* 参考站是 rounded-full + border-2 + bg-<色>/20 + 同色光晕 */
  background: color-mix(in oklab, var(--fd-tone, var(--fd-brand)) 20%, transparent);
  border: 2px solid color-mix(in oklab, var(--fd-tone, var(--fd-brand)) 45%, transparent);
  box-shadow: 0 0 20px color-mix(in oklab, var(--fd-tone, var(--fd-brand)) 28%, transparent);
}
.fd-kpi-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
.fd-kpi-label { font-size: 11px; color: var(--fd-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fd-kpi-note { font-size: 10px; color: var(--fd-dim); }
.fd-bar {
  display: block; position: relative; height: 4px; border-radius: 999px; overflow: hidden;
  /* 进度条底槽：border-l1 在亮色下只有 ~1.4% 黑，等于没有槽 —— 用 label 8% */
  background: color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent);
}
.fd-bar > i {
  display: block; height: 100%; border-radius: inherit; width: 0;
  background: var(--fd-tone, var(--fd-brand));
  transition: width 260ms cubic-bezier(.22, .61, .36, 1);
}

/* ============ 状态 donut ============ */
.fd-donut { display: flex; align-items: center; gap: 14px; min-height: 0; }
.fd-donut-svg { flex: 0 0 auto; width: 132px; height: 132px; display: block; }
.fd-donut-track { fill: none; stroke: color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent); stroke-width: 12; }
.fd-donut-arc {
  fill: none; stroke-width: 12; stroke-linecap: butt;
  stroke: var(--fd-tone, var(--fd-idle));
  transition: stroke-dasharray 320ms cubic-bezier(.22, .61, .36, 1);
}
.fd-donut-center { fill: var(--fd-text); font-size: 20px; font-weight: 600; }
.fd-donut-caption { fill: var(--fd-dim); font-size: 10px; }
.fd-legend { display: flex; flex-direction: column; gap: 7px; min-width: 0; flex: 1 1 auto; }
.fd-legend-row { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 11px; }
.fd-legend-dot {
  flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--fd-tone, var(--fd-idle));
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--fd-tone, var(--fd-idle)) 22%, transparent);
}
.fd-legend-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-legend-value { margin-left: auto; color: var(--fd-dim); font-variant-numeric: tabular-nums; }
.fd-legend-pct { flex: 0 0 34px; text-align: right; font-variant-numeric: tabular-nums; }

/* ============ 横向条（项目分布 / 阻塞榜 / 关系概览） ============ */
.fd-list { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.fd-list-row { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 11px; }
.fd-list-label { flex: 0 0 84px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fd-dim); }
.fd-list-bar { flex: 1 1 auto; min-width: 24px; }
.fd-list-value { flex: 0 0 56px; text-align: right; font-variant-numeric: tabular-nums; }
.fd-list-meta { flex: 0 0 auto; font-size: 10px; color: var(--fd-dim); font-variant-numeric: tabular-nums; }
/* 叠加完成率：细条里再画一段更亮的 */
.fd-bar-split { display: block; position: relative; height: 8px; border-radius: 999px; overflow: hidden; background: color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent); }
.fd-bar-split > i { position: absolute; inset: 0 auto 0 0; background: color-mix(in oklab, var(--fd-tone, var(--fd-brand)) 55%, transparent); }
.fd-bar-split > b { position: absolute; inset: 0 auto 0 0; background: var(--fd-tone, var(--fd-brand)); border-radius: 999px; }

/* ============ 关系概览：四行 KV ============ */
.fd-kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
.fd-kv-item {
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
  padding: 8px 10px; border-radius: 12px;
  background: var(--fd-sunken); border: 1px solid var(--fd-line);
}
.fd-kv-label { font-size: 10px; color: var(--fd-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fd-kv-value { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--fd-tone, var(--fd-text)); }
.fd-kv-hint { font-size: 10px; color: var(--fd-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ============ 阻塞榜 / 最近动态：可点行 ============ */
.fd-item {
  display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%;
  padding: 6px 8px; border-radius: 9px; text-align: left;
  font: inherit; font-size: 11px; color: var(--fd-text);
  background: transparent; border: 1px solid transparent; cursor: pointer;
  transition: background-color 180ms cubic-bezier(.22, .61, .36, 1), border-color 180ms cubic-bezier(.22, .61, .36, 1);
}
.fd-item:hover { background: var(--fd-surface-2); border-color: var(--fd-line); }
.fd-item:focus-visible { outline: none; border-color: color-mix(in oklab, var(--fd-tone, var(--fd-brand)) 55%, transparent); }
.fd-item-rank {
  flex: 0 0 18px; height: 18px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-variant-numeric: tabular-nums;
  color: var(--fd-tone, var(--fd-brand));
  background: color-mix(in oklab, var(--fd-tone, var(--fd-brand)) 18%, transparent);
}
.fd-item-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; }
.fd-item-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-item-sub { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--fd-dim); }
.fd-item-badge {
  flex: 0 0 auto; font-size: 10px; padding: 1px 6px; border-radius: 999px;
  color: var(--fd-tone, var(--fd-dim));
  background: color-mix(in oklab, var(--fd-tone, var(--fd-dim)) 16%, transparent);
  border: 1px solid color-mix(in oklab, var(--fd-tone, var(--fd-dim)) 32%, transparent);
}
.fd-live-dot {
  flex: 0 0 6px; width: 6px; height: 6px; border-radius: 50%;
  background: var(--fd-ok);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--fd-ok) 22%, transparent);
}

/* ============ 最近动态：三列小清单 ============ */
/* 行高必须由内容决定（max-content）：原来 auto 行 + 列上的 min-height:0 会让行塌到 0，
   三行「最近完成」被压进 110px，标题和下一组的组名直接叠字（实机截图可见）。 */
/* 质量 / 周期：全宽卡要横向排（左图例、右分位），别把内容全挤在顶部 */
.fd-quality { flex-direction: row; align-items: center; gap: 32px; }
.fd-quality .fd-legend { flex: 1 1 auto; max-width: 420px; }
.fd-quality .fd-kv { flex: 1 1 auto; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; }

.fd-recent { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; grid-auto-rows: max-content; align-content: start; min-height: 0; }
.fd-recent-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; min-height: 0; }
.fd-recent-title { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--fd-dim); }
.fd-empty-line { font-size: 11px; color: var(--fd-dim); padding: 4px 0; }
/* 空态在卡片里垂直居中：卡片按行等高时，空态贴顶会让下半截看起来像没加载完 */
.fd-panel-body > .fd-empty-line:only-child { margin: auto; text-align: center; max-width: 320px; line-height: 1.6; }

/* ============ 空态 ============ */
.fd-empty {
  flex: 1 1 auto; grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 40px 20px; text-align: center; color: var(--fd-dim);
}
.fd-empty-title { font-size: 14px; font-weight: 600; color: var(--fd-text); }
.fd-empty-body { font-size: 12px; max-width: 420px; }

/* ============ 入场 ============ */
@keyframes fd-rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

/* ==========================================================================
   运行页（fr-）：气泡墙 / 运行概览 / 会话活跃度 / 运行时长 / 需要人看一眼
   与 fd- 同一套令牌约束：零字面量颜色 + 只引用宿主那 14 个 --dsw-* 令牌。
   ========================================================================== */
.fr-page {
  --fr-line: ${g('border-l1', 55)};
  --fr-line-strong: ${g('border-l2', 70)};
  --fr-surface: ${g('label-primary', 4)};
  --fr-surface-2: ${g('label-primary', 6)};
  --fr-sunken: ${g('bg-base', 60)};
  --fr-text: var(--dsw-alias-label-primary);
  --fr-dim: var(--dsw-alias-label-secondary);
  --fr-brand: var(--dsw-alias-brand-primary);
  --fr-ok: var(--dsw-alias-state-success-primary);
  --fr-warn: var(--dsw-alias-state-warn-primary);
  --fr-danger: var(--dsw-alias-state-error-primary);
  --fr-idle: var(--dsw-alias-state-idle-primary);
  flex: 1 1 auto; min-height: 0; min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  grid-auto-rows: 1fr;
  gap: 12px;
  padding: 12px;
  overflow: auto;
  color: var(--fr-text);
}

/* 面板 */
.fr-panel {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  padding: 14px; border-radius: 14px;
  border: 1px solid var(--fr-line);
  background: var(--fr-surface);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  overflow: hidden;
  animation: fr-rise 180ms cubic-bezier(.22, .61, .36, 1) backwards;
  animation-delay: calc(var(--fr-i, 0) * 24ms);
  transition: border-color 180ms cubic-bezier(.22, .61, .36, 1);
}
.fr-panel:hover { border-color: var(--fr-line-strong); }
.fr-panel[data-span="all"] { grid-column: 1 / -1; }
.fr-panel-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; min-width: 0; }
.fr-panel-title { font-size: 12px; font-weight: 600; letter-spacing: .02em; }
.fr-panel-hint { font-size: 11px; color: var(--fr-dim); }
.fr-panel-extra { margin-left: auto; font-size: 11px; color: var(--fr-dim); white-space: nowrap; }
.fr-panel-body { flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.fr-scroll { overflow: auto; min-height: 0; }

/* 色调 */
.fr-tone-success { --fr-tone: var(--fr-ok); }
.fr-tone-error { --fr-tone: var(--fr-danger); }
.fr-tone-warn { --fr-tone: var(--fr-warn); }
.fr-tone-idle { --fr-tone: var(--fr-idle); }
.fr-tone-brand { --fr-tone: var(--fr-brand); }

/* ============ 气泡群（复现参考图 AVAILABLE MODELS 那片星座式气泡） ============
   - 三档直径由组件内联 --fr-d 给（108 / 78 / 44，大 = 小的 2.45 倍 ≈ 参考图 2.5 倍）
   - 位置由 runsView.buildBubbleCloud 算好（确定性、两排交错、不重叠）
   - 活跃（运行中）= 半透明绿填充 + 亮绿边 + 外发光 + 呼吸；其余 = 深灰暗态 + 1px 浅白描边
   ============================================================================ */
.fr-cloud-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; min-height: 0; flex: 1 1 auto; overflow: auto; }
.fr-cloud-legend { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: center; font-size: 10px; color: var(--fr-dim); }
.fr-cloud-legend-item { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.fr-cloud-legend-dot { border-radius: 50%; background: color-mix(in oklab, var(--dsw-alias-label-primary) 10%, transparent); border: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 22%, transparent); }
.fr-cloud-legend-large { width: 14px; height: 14px; }
.fr-cloud-legend-medium { width: 10px; height: 10px; }
.fr-cloud-legend-small { width: 7px; height: 7px; }
.fr-cloud-legend-rule { color: color-mix(in oklab, var(--dsw-alias-label-secondary) 70%, transparent); }

.fr-cloud { position: relative; flex: 0 0 auto; margin: 0 auto; }

/* ============================================================================
 * 气泡墙（从参考项目 kp-z/open_adventure 直接搬：
 *   components/ClaudeModelBubbles.tsx 的 DASHBOARD_POSITIONS / LAYOUT
 *   + components/WaterLevel.tsx 的圆内水位）
 * 只把 Tailwind 类与字面量颜色换成我们的 fr- 类与宿主令牌，几何/动画时长/层级照抄。
 * ========================================================================== */
.fr-bubbles-wrap { display: flex; align-items: center; justify-content: center; padding: 2px 0 6px; }
/* 参考卡片：气泡上方的 eyebrow（text-[10px] uppercase tracking-widest）*/
.fr-bubbles-eyebrow {
  font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  color: color-mix(in oklab, var(--dsw-alias-label-secondary) 80%, transparent);
  margin-bottom: 6px;
}
/* 参考卡片底部两个小盒（Health Score / Status）：bg-white/5 + rounded-xl + p-3 */
.fr-bubbles-boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
.fr-bubbles-box {
  display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 12px;
  background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, transparent);
}
.fr-bubbles-box-label {
  font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: color-mix(in oklab, var(--dsw-alias-label-secondary) 80%, transparent);
}
.fr-bubbles-box-value { font-size: 20px; font-weight: 700; line-height: 1.1; color: var(--dsw-alias-label-primary); }
.fr-bubbles-box-value.is-brand { color: color-mix(in oklab, var(--dsw-alias-brand-primary) 90%, transparent); }
.fr-bubbles-box-value.is-ok { color: color-mix(in oklab, var(--dsw-alias-state-success-primary) 92%, transparent); }
/* 参考项目 dashboard-desktop：容器 h-24（96px），气泡在其中绝对定位 */
/* 参考项目这张卡在大屏只占 4 列里的 2 列（约 520px），气泡是在窄框里成簇的。
   我们这块面板是通的，所以给一个上限并居中，否则 8 个点会被摊到 1000+ px 上、失去「一簇」的感觉。 */
.fr-bubbles { position: relative; width: 100%; max-width: 560px; height: 96px; margin: 0 auto; }
.fr-bubble-slot { position: absolute; }
.fr-bubble-slot:hover { z-index: 20; }

/* 圆本体：rounded-full + border-2 + 从左上到右下的白色渐变（做出球面） */
.fr-bubble-orb {
  position: relative; display: block; width: 100%; height: 100%; padding: 0;
  border-radius: 999px; border: 2px solid transparent; overflow: visible;
  background:
    linear-gradient(to bottom right,
      color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent),
      color-mix(in oklab, var(--dsw-alias-label-primary) 4%, transparent),
      transparent);
  cursor: pointer; transition: transform .3s ease, box-shadow .3s ease, border-color .3s ease;
}
.fr-bubble-orb:hover, .fr-bubble-orb.is-hovered { transform: scale(1.1); }

/* 运行中（参考项目的 available 绿泡）：绿边 + 两圈外发光 + 内发光 + 顶部 1px 高光 */
.fr-bubble-orb.is-running {
  border-color: color-mix(in oklab, var(--dsw-alias-state-success-primary) 55%, transparent);
  box-shadow:
    0 0 20px color-mix(in oklab, var(--dsw-alias-state-success-primary) 42%, transparent),
    0 0 40px color-mix(in oklab, var(--dsw-alias-state-success-primary) 22%, transparent),
    inset 0 0 30px color-mix(in oklab, var(--dsw-alias-state-success-primary) 16%, transparent),
    inset 0 1px 0 color-mix(in oklab, var(--dsw-alias-label-primary) 40%, transparent);
  animation: fr-orb-breathe 2.4s ease-in-out infinite;
}
/* 挂起：暗态 + 一点点 warn 边（不抢绿色） */
.fr-bubble-orb.is-suspended {
  border-color: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 38%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in oklab, var(--dsw-alias-label-primary) 18%, transparent);
}
/* 未开始 / 等待中（参考项目的 unavailable 灰泡）：1px 浅白边 + 内侧高光 */
.fr-bubble-orb.is-idle {
  border-width: 1px;
  border-color: color-mix(in oklab, var(--dsw-alias-label-primary) 15%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in oklab, var(--dsw-alias-label-primary) 18%, transparent);
}

/* 球面高光：左上那团模糊白光（参考项目 top-[18%] left-[28%] w-[30%] h-[30%] blur-[3px]） */
.fr-orb-shine {
  position: absolute; top: 18%; left: 28%; width: 30%; height: 30%; border-radius: 999px;
  background: linear-gradient(to bottom right,
    color-mix(in oklab, var(--dsw-alias-label-primary) 72%, transparent),
    color-mix(in oklab, var(--dsw-alias-label-primary) 28%, transparent),
    transparent);
  filter: blur(2.5px); pointer-events: none;
}
/* 右下小亮点（参考项目 top-[12%] right-[22%] w-[18%] h-[18%] blur-[1px]） */
.fr-orb-spark {
  position: absolute; top: 12%; right: 22%; width: 18%; height: 18%; border-radius: 999px;
  background: color-mix(in oklab, var(--dsw-alias-label-primary) 30%, transparent);
  filter: blur(1px); pointer-events: none;
}

/* 圆内文字：参考项目 text-[8px] font-bold drop-shadow-lg leading-tight px-1 */
.fr-orb-label {
  position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center;
  padding: 0 4px; text-align: center; line-height: 1.15; font-weight: 700;
  font-size: var(--fr-orb-label, 8px);
  color: color-mix(in oklab, var(--dsw-alias-label-primary) 96%, transparent);
  text-shadow: 0 1px 3px color-mix(in oklab, var(--dsw-alias-bg-base) 80%, transparent);
  pointer-events: none; word-break: break-word;
}

/* 圆内水位（WaterLevel.tsx）：两层 SVG 铺满圆 */
.fr-water-svg { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 20; pointer-events: none; }
.fr-water-fill-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
/* 水位颜色按「剩余量」分档（参考项目：≥50% 绿 / ≥10% 黄 / 其余红） */
.fr-water-svg.fr-tone-ok .fr-water-liquid { fill: color-mix(in oklab, var(--dsw-alias-state-success-primary) 34%, transparent); }
.fr-water-svg.fr-tone-ok .fr-water-wave { stroke: color-mix(in oklab, var(--dsw-alias-state-success-primary) 95%, transparent); }
.fr-water-svg.fr-tone-warn .fr-water-liquid { fill: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 42%, transparent); }
.fr-water-svg.fr-tone-warn .fr-water-wave { stroke: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 80%, transparent); }
.fr-water-svg.fr-tone-low .fr-water-liquid { fill: color-mix(in oklab, var(--dsw-alias-state-error-primary) 42%, transparent); }
.fr-water-svg.fr-tone-low .fr-water-wave { stroke: color-mix(in oklab, var(--dsw-alias-state-error-primary) 80%, transparent); }

/* hover 浮层：参考项目的说明卡 + 小三角（气泡上方居中） */
.fr-orb-tip {
  position: absolute; left: 50%; bottom: 100%; z-index: 30;
  transform: translateX(-50%); margin-bottom: 8px;
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px; border-radius: 8px; white-space: nowrap;
  background: color-mix(in oklab, var(--dsw-alias-bg-overlay) 96%, transparent);
  border: 1px solid color-mix(in oklab, var(--dsw-alias-border-l1) 70%, transparent);
  box-shadow: 0 8px 24px color-mix(in oklab, var(--dsw-alias-bg-base) 70%, transparent);
  pointer-events: none;
}
.fr-orb-tip-name { font-weight: 700; font-size: 10px; color: var(--dsw-alias-label-primary); }
.fr-orb-tip-meta { font-size: 9px; color: var(--dsw-alias-label-secondary); }
.fr-orb-tip-hint { font-size: 8px; color: color-mix(in oklab, var(--dsw-alias-brand-primary) 85%, transparent); }

/* 漂浮：参考项目 @keyframes float 原样搬（-8/-4/-10px，横向 +3/-3/+2px） */
@keyframes fr-float {
  0%, 100% { transform: translateY(0) translateX(0); }
  25% { transform: translateY(-8px) translateX(3px); }
  50% { transform: translateY(-4px) translateX(-3px); }
  75% { transform: translateY(-10px) translateX(2px); }
}
@keyframes fr-orb-breathe {
  0%, 100% { box-shadow:
    0 0 20px color-mix(in oklab, var(--dsw-alias-state-success-primary) 42%, transparent),
    0 0 40px color-mix(in oklab, var(--dsw-alias-state-success-primary) 22%, transparent),
    inset 0 0 30px color-mix(in oklab, var(--dsw-alias-state-success-primary) 16%, transparent); }
  50% { box-shadow:
    0 0 28px color-mix(in oklab, var(--dsw-alias-state-success-primary) 55%, transparent),
    0 0 56px color-mix(in oklab, var(--dsw-alias-state-success-primary) 30%, transparent),
    inset 0 0 36px color-mix(in oklab, var(--dsw-alias-state-success-primary) 22%, transparent); }
}
.fr-bubble-item { position: absolute; }
.fr-bubble {
  position: relative;
  width: var(--fr-d, 78px); height: var(--fr-d, 78px);
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; font: inherit; cursor: pointer; overflow: hidden;
  /* 深灰暗态（非活跃）：半透明底 + 1px 极细浅白描边 + 浅灰字 */
  background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, transparent);
  border: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 10%, transparent);
  color: var(--dsw-alias-label-secondary);
  transition: transform 160ms cubic-bezier(.22, .61, .36, 1), border-color 160ms cubic-bezier(.22, .61, .36, 1), box-shadow 160ms cubic-bezier(.22, .61, .36, 1);
}
.fr-bubble:hover { transform: translateY(-2px) scale(1.03); border-color: color-mix(in oklab, var(--dsw-alias-label-primary) 22%, transparent); }
.fr-bubble:focus-visible { outline: none; border-color: color-mix(in oklab, var(--dsw-alias-state-success-primary) 70%, transparent); }
/* 活跃：半透明绿 + 亮绿边 + 外发光晕（blur 20~30）+ 中心略亮的球感 */
.fr-bubble.is-running {
  --fr-tone: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-label-primary);
  background:
    radial-gradient(circle at 50% 36%,
      color-mix(in oklab, var(--dsw-alias-state-success-primary) 30%, transparent),
      color-mix(in oklab, var(--dsw-alias-state-success-primary) 12%, transparent));
  border: 1px solid color-mix(in oklab, var(--dsw-alias-state-success-primary) 50%, transparent);
  box-shadow: 0 0 24px color-mix(in oklab, var(--dsw-alias-state-success-primary) 40%, transparent);
  animation: fr-breathe 2.4s ease-in-out infinite;
}
/* 挂起：仍是暗态，只给一点点 warn 边区分（不抢绿色） */
.fr-bubble.is-paused:not(.is-running) { border-color: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 35%, transparent); }
.fr-bubble.is-selected {
  border-color: color-mix(in oklab, var(--fr-tone, var(--dsw-alias-brand-primary)) 85%, transparent);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--fr-tone, var(--dsw-alias-brand-primary)) 22%, transparent);
}
.fr-bubble-num {
  font-size: 11px; font-weight: 600; line-height: 1.15;
  font-variant-numeric: tabular-nums; letter-spacing: -.01em;
  max-width: 78%; text-align: center; word-break: break-all;
}
/* 三档字号：小 11 / 中 12 / 大 13（参考图圆内文字 11~13px） */
.fr-bubble-medium .fr-bubble-num { font-size: 12px; }
.fr-bubble-large .fr-bubble-num { font-size: 13px; }
/* 「打开会话」：平时隐起，hover/focus 才出现在右下角（圆外不挂常驻小字） */
.fr-bubble-go {
  position: absolute; right: -2px; bottom: -2px;
  width: 18px; height: 18px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font: inherit; font-size: 10px; line-height: 1;
  color: var(--fr-text); background: var(--fr-surface-2); cursor: pointer;
  border: 1px solid var(--fr-line);
  opacity: 0; pointer-events: none;
  transition: opacity 140ms cubic-bezier(.22, .61, .36, 1);
}
.fr-bubble-item:hover .fr-bubble-go, .fr-bubble-item:focus-within .fr-bubble-go { opacity: 1; pointer-events: auto; }
.fr-bubble-go:disabled { opacity: .45; cursor: not-allowed; }

@keyframes fr-breathe {
  0%, 100% { box-shadow: 0 0 20px color-mix(in oklab, var(--fr-tone, var(--dsw-alias-state-success-primary)) 32%, transparent); }
  50% { box-shadow: 0 0 30px color-mix(in oklab, var(--fr-tone, var(--dsw-alias-state-success-primary)) 50%, transparent); }
}
@keyframes fr-rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

/* fr- 子树统一 border-box：水位条 16px / 圆球 64px 都要是「含边框的实数」 */
.fr-page, .fr-page * { box-sizing: border-box; }
/* 水位 hero：16px 的「空气泡水位」（参考站 h-4 那条） */
.fr-level { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.fr-level-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.fr-level-value { font-size: 11px; color: var(--fr-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* 顶部 KPI 行：圆球 + eyebrow + 数值 + 迷你水位条（adventure 首页形制） */
.fr-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; align-content: start; }
.fr-kpi {
  display: flex; align-items: center; gap: 12px; min-width: 0;
  padding: 10px 12px; border-radius: 14px;
  background: var(--fr-sunken); border: 1px solid var(--fr-line);
}
.fr-kpi-ball {
  flex: 0 0 auto; width: 64px; height: 64px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.02em;
  color: var(--fr-tone, var(--fr-brand));
  background: color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 20%, transparent);
  border: 2px solid color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 55%, transparent);
  box-shadow: 0 0 20px color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 28%, transparent);
}
.fr-kpi-ball.is-running { animation: fr-breathe 2.4s ease-in-out infinite; }
.fr-kpi-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
.fr-kpi-eyebrow {
  font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
  color: var(--fr-tone, var(--fr-brand));
}
.fr-kpi-label { font-size: 12px; font-weight: 600; color: var(--fr-text); }
.fr-kpi-hint { font-size: 10px; color: var(--fr-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ============ 空气泡水位条（复现 BaseView.tsx:87-97 的经验值条） ============ */
.fr-water {
  position: relative; width: 100%; height: 16px; border-radius: 999px; overflow: hidden;
  background: color-mix(in oklab, var(--dsw-alias-bg-base) 62%, transparent);
  border: 1px solid color-mix(in oklab, var(--dsw-alias-border-l1) 55%, transparent);
}
.fr-water-sm { height: 8px; }
.fr-water-fill {
  position: absolute; top: 0; bottom: 0; left: 0;
  width: var(--fr-water-pct, 0%); border-radius: 999px;
  /* 三段：左/中/右三个色标（中间那道换色相），与参考站 from-via-to 同构 */
  background: linear-gradient(90deg,
    color-mix(in oklab, var(--dsw-alias-brand-primary) 85%, transparent),
    color-mix(in oklab, var(--dsw-alias-state-warn-primary) 92%, transparent),
    color-mix(in oklab, var(--fr-tone, var(--dsw-alias-brand-primary)) 80%, transparent));
  /* 入场动画用 transform 缩放，**宽度本身只由 --fr-water-pct 决定**：
     把 var() 写进 @keyframes 的 width 里在 Chrome 上会解析成 fallback 0%，
     结果动画结束后水位条永远是空的（真机实测 0px，去掉动画才变回 50%）。 */
  transform-origin: left center;
  animation: fr-water-rise 1s cubic-bezier(.22, .61, .36, 1) both;
  animation-delay: .3s;
}
.fr-water-shine {
  position: absolute; inset: 0; border-radius: inherit;
  background: linear-gradient(90deg, transparent,
    color-mix(in oklab, var(--dsw-alias-label-primary) 30%, transparent), transparent);
  animation: fr-water-shine 2.4s ease-in-out infinite;
}
@keyframes fr-water-rise { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes fr-water-shine {
  0%, 100% { transform: translateX(-70%); opacity: .35; }
  50% { transform: translateX(70%); opacity: 1; }
}

/* ============ 执行历史风格列表：头像块 + 状态点 + 标题 + 编号·时间 + 详情 ============ */
.fr-rows { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.fr-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  min-width: 0; padding: 10px 12px; border-radius: 12px;
  background: var(--fr-surface-2); border: 1px solid transparent;
  transition: background-color 160ms cubic-bezier(.22, .61, .36, 1), border-color 160ms cubic-bezier(.22, .61, .36, 1);
}
.fr-row:hover { border-color: var(--fr-line); background: color-mix(in oklab, var(--dsw-alias-label-primary) 6%, transparent); }
.fr-avatar {
  position: relative; flex: 0 0 auto; width: 40px; height: 40px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--fr-tone, var(--fr-brand));
  background: color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 16%, transparent);
  border: 1px solid var(--fr-line);
}
.fr-avatar-glyph { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.fr-avatar-dot {
  position: absolute; right: -3px; bottom: -3px; width: 10px; height: 10px; border-radius: 50%;
  background: var(--fr-tone, var(--fr-idle));
  border: 2px solid var(--dsw-alias-bg-base);
}
.fr-avatar-dot.is-running { animation: fr-breathe 2.4s ease-in-out infinite; }
.fr-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.fr-row-title { font-size: 12px; color: var(--fr-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-row-meta { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--fr-dim); font-variant-numeric: tabular-nums; }
.fr-row-action {
  flex: 0 0 auto; font: inherit; font-size: 11px; cursor: pointer;
  padding: 4px 10px; border-radius: 8px;
  color: var(--fr-text); background: transparent;
  border: 1px solid var(--fr-line);
  transition: border-color 160ms cubic-bezier(.22, .61, .36, 1), background-color 160ms cubic-bezier(.22, .61, .36, 1);
}
.fr-row-action:hover { border-color: var(--fr-line-strong); background: var(--fr-surface); }

/* ============ 双列小块（活跃度 / 时长） ============ */
.fr-split { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; min-height: 0; }
.fr-split-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; min-height: 0; }
.fr-mini-head { font-size: 10px; color: var(--fr-dim); }
.fr-mini-list { display: flex; flex-direction: column; gap: 7px; min-height: 0; }
.fr-mini-row {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  padding: 4px 6px; border-radius: 8px;
  font: inherit; font-size: 11px; color: var(--fr-text); text-align: left;
  background: transparent; border: 1px solid transparent;
}
.fr-mini-row-btn { cursor: pointer; }
.fr-mini-row-btn:hover { background: var(--fr-surface-2); border-color: var(--fr-line); }
.fr-mini-label { flex: 0 0 88px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-mini-bar { flex: 1 1 auto; min-width: 32px; display: flex; }
.fr-mini-value { flex: 0 0 auto; font-size: 10px; color: var(--fr-dim); font-variant-numeric: tabular-nums; }

/* 横向条 */
.fr-list { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.fr-list-row { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 11px; }
.fr-list-label { flex: 0 0 62px; color: var(--fr-dim); white-space: nowrap; }
.fr-list-bar { flex: 1 1 auto; min-width: 24px; }
.fr-list-value { flex: 0 0 28px; text-align: right; font-variant-numeric: tabular-nums; }
.fr-list-meta { flex: 0 0 auto; font-size: 10px; color: var(--fr-dim); }
.fr-bar { display: block; position: relative; height: 6px; border-radius: 999px; overflow: hidden; background: color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent); }
.fr-bar > i { display: block; height: 100%; border-radius: inherit; background: var(--fr-tone, var(--fr-brand)); transition: width 260ms cubic-bezier(.22, .61, .36, 1); }

/* 可点行（时长 Top5 / 告警） */
.fr-item {
  display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%;
  padding: 6px 8px; border-radius: 9px; text-align: left;
  font: inherit; font-size: 11px; color: var(--fr-text);
  background: transparent; border: 1px solid transparent; cursor: pointer;
  transition: background-color 160ms cubic-bezier(.22, .61, .36, 1), border-color 160ms cubic-bezier(.22, .61, .36, 1);
}
.fr-item:hover { background: var(--fr-surface-2); border-color: var(--fr-line); }
.fr-item:focus-visible { outline: none; border-color: color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 55%, transparent); }
.fr-item-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; }
.fr-item-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-item-sub { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--fr-dim); }
.fr-item-bar { flex: 0 0 56px; }
.fr-item-value { flex: 0 0 auto; font-size: 10px; color: var(--fr-dim); font-variant-numeric: tabular-nums; }
.fr-item-badge {
  flex: 0 0 auto; font-size: 10px; padding: 1px 6px; border-radius: 999px;
  color: var(--fr-tone, var(--fr-dim));
  background: color-mix(in oklab, var(--fr-tone, var(--fr-dim)) 16%, transparent);
  border: 1px solid color-mix(in oklab, var(--fr-tone, var(--fr-dim)) 32%, transparent);
}
.fr-alert-list { display: flex; flex-direction: column; gap: 6px; min-height: 0; }

/* 空态 */
.fr-empty {
  grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 40px 20px; text-align: center; color: var(--fr-dim);
}
.fr-empty-title { font-size: 14px; font-weight: 600; color: var(--fr-text); }
.fr-empty-body { font-size: 12px; max-width: 420px; }
.fr-empty-line { font-size: 11px; color: var(--fr-dim); padding: 4px 0; }

/* ============ AI 诊断：小助手 + 一句话判断 + 结论卡 ============ */
/* 洞察卡的外观与其它卡片完全一致：不设专属边框/底色，只保留定位上下文。 */
.fd-panel[data-mod="ai"] { position: relative; }

/* 两栏：左=状态（上）+ 人物（下），右=判断与明细。 */
.fd-ins {
  display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: 18px 22px;
  min-height: 0; align-items: stretch;
}
.fd-ins-rail {
  display: flex; flex-direction: column; justify-content: space-between; gap: 16px;
  min-width: 0; padding-right: 18px; border-right: 1px solid var(--fd-line);
}
.fd-ins-main { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

.fd-ins-status { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.fd-ins-weather { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-size: 12px; color: var(--fd-text); }
.fd-ins-weather-icon { font-size: 15px; line-height: 1; }
.fd-ins-weather-word { font-weight: 600; }
.fd-ins-weather-note { font-size: 11px; color: var(--fd-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-ins-figure { display: flex; justify-content: center; align-items: flex-end; }
/* 3D 层：加载好之后盖在 SVG 上；没加载好就什么都不显示，SVG 继续当着 */
/* 动图自带透明通道：按原始比例摆，不加底色/外框/圆角，也不裁切。
   SVG 兜底与动图叠在同一格里，否则两者相加会把左栏撑高。 */
.fd-figure { display: grid; grid-template-areas: 'fig'; place-items: center; }
.fd-figure > .fd-bot { grid-area: fig; }
.fd-figure-img {
  grid-area: fig; display: block; width: 168px; max-width: 100%; height: auto;
  border: 0; border-radius: 0; background: none;
  pointer-events: none;
  /* 不用淡入：真实浏览器里 opacity 过渡会卡在 0（CSSTransition currentTime 恒为 0），
     结果就是「图加载了但看不见」。改成加载完直接显示，宁可少一个淡入。 */
  display: none;
}
.fd-figure[data-ready="1"] .fd-figure-img { display: block; }
.fd-figure[data-ready="1"] .fd-bot { display: none; }

/* SVG 兜底时居中；动图有透明底，这一层不需要任何底色、圆角或透视 */
.fd-ins-face { display: grid; place-items: center; }
.fd-ins-headline { font-size: 19px; font-weight: 650; letter-spacing: -.015em; line-height: 1.35; color: var(--fd-text); }
.fd-ins-summary { font-size: 12.5px; line-height: 1.75; color: var(--fd-dim); max-width: 72ch; }

/* ---- 下一步 / 要处理·做得对 / 脚注：结论卡的正文块 ---- */
.fd-ins-next {
  display: flex; flex-direction: column; gap: 4px; min-width: 0;
  padding: 9px 12px; border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--fd-brand) 26%, var(--fd-line));
  background: color-mix(in oklab, var(--fd-brand) 8%, transparent);
}
.fd-ins-next-tag { font-size: 10px; letter-spacing: .08em; color: var(--fd-brand); }
.fd-ins-next-text { margin: 0; font-size: 12.5px; line-height: 1.7; color: var(--fd-text); overflow-wrap: anywhere; }
.fd-ins-next > .fd-ai-jump { align-self: flex-start; }

/* ---- 长期结论：事实（灰）→ 假设 → if-then 动作；只在宽形态出现 ---- */
.fd-ins-longterm {
  display: flex; flex-direction: column; gap: 5px; min-width: 0;
  padding: 9px 12px; border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--fd-brand) 22%, var(--fd-line));
  background: color-mix(in oklab, var(--fd-brand) 5%, transparent);
}
.fd-ins-longterm-head { display: flex; align-items: center; gap: 6px; font-size: 10px; letter-spacing: .08em; color: var(--fd-dim); }
.fd-ins-longterm-head > b { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
.fd-ins-longterm-fact { margin: 0; font-size: 11px; color: var(--fd-dim); overflow-wrap: anywhere; }
.fd-ins-longterm-hyp { margin: 0; font-size: 12.5px; color: var(--fd-text); overflow-wrap: anywhere; }
.fd-ins-longterm-action { margin: 0; font-size: 12px; line-height: 1.6; color: var(--fd-brand); overflow-wrap: anywhere; }
.fd-ins-longterm-meta { margin: 0; font-size: 10.5px; color: var(--fd-dim); overflow-wrap: anywhere; }
.fd-ins-longterm-review { display: flex; align-items: center; gap: 8px; font-size: 10.5px; color: var(--fd-dim); }
/* ---- 侧栏头行 / 摘要 / 图表 / 脚注（从旧版恢复） ---- */
.fd-today-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fd-today-avatar { width: 22px; height: 22px; flex: none; border-radius: 50%; overflow: hidden; background: var(--fd-sunken); display: grid; place-items: center; }
.fd-today-weather { display: flex; align-items: center; gap: 4px; min-width: 0; font-size: 10.5px; color: var(--fd-dim); }
.fd-today-weather .fd-weather-scene { width: 18px; height: 18px; flex: none; }
.fd-today-weather-inline { gap: 3px; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fd-today-weather-inline .fd-weather-scene { width: 16px; height: 16px; }
.fd-today-avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.fd-today-title { font-size: 13px; font-weight: 600; color: var(--fd-text); border: 0; background: none; padding: 0; cursor: pointer; }
.fd-today-title.is-static { cursor: default; }
.fd-today-tabs { display: flex; align-items: center; gap: 2px; margin-left: auto; }
.fd-today-head-actions { display: flex; align-items: center; gap: 4px; }
.fd-today-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; min-width: 0; }
.fd-today-summary { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.fd-today-editor-wrap { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 96px; min-width: 0; }
.fd-today-md { flex: 1 1 auto; min-height: 0; max-height: 180px; overflow: auto; padding: 4px 6px; font-size: 12.5px; line-height: 1.6; color: var(--fd-text); cursor: text; }
.fd-today-md.is-hidden { visibility: hidden; }
.fd-today-md-empty { color: var(--fd-dim); }
.fd-md-p { margin: 0 0 6px; }
.fd-md-h { margin: 6px 0 4px; font-size: 13px; font-weight: 600; }
.fd-md-list { margin: 0 0 6px; padding-left: 16px; }
.fd-md-quote { margin: 0 0 6px; padding-left: 8px; border-left: 2px solid var(--fd-line); color: var(--fd-dim); }
.fd-md-pre { margin: 0 0 6px; padding: 6px 8px; background: var(--fd-sunken); border-radius: 6px; overflow: auto; font-size: 11px; }
.fd-md-code-inline { padding: 1px 4px; background: var(--fd-sunken); border-radius: 4px; font-size: 11px; }
.fd-md-link { color: var(--fd-brand); text-decoration: underline; }
.fd-md-hr { border: 0; border-top: 1px solid var(--fd-line); margin: 8px 0; }
.fd-today-editor { position: absolute; inset: 0; width: 100%; height: 100%; flex: 1 1 auto; min-height: 0; resize: none; box-sizing: border-box; padding: 8px 10px; opacity: 0; pointer-events: none;

  border-radius: 8px; border: 1px solid var(--fd-line); background: var(--fd-sunken); color: var(--fd-text);
  font: 12.5px/1.65 inherit; }
.fd-today-editor.is-editing { opacity: 1; pointer-events: auto; }
.fd-today-dash .fd-today-md { max-height: 140px; }
.fd-today-editor:focus-visible { outline: 2px solid color-mix(in oklab, var(--fd-brand) 40%, transparent); }
.fd-today-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.fd-today-note { margin: 0; font-size: 10.5px; color: var(--fd-dim); }
.fd-today-chart { min-width: 0; border: 1px solid var(--fd-line); border-radius: 10px; padding: 8px; }
.fd-today-foot { display: flex; justify-content: flex-end; margin-left: auto; }
.fd-today-fold-text { font-size: 11px; color: var(--fd-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.fd-today-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: stretch; gap: 12px; min-width: 0; }
.fd-today-split > * { min-width: 0; }
.fd-today-dash { gap: 12px; }
.fd-today-head-inline { align-items: center; margin-bottom: 0; }
.fd-today-head-inline .fd-ins-headline { flex: 1 1 auto; min-width: 0; }
.fd-today-dash .fd-today-editor { min-height: 84px; }
@container fdtoday (max-width: 560px) {
  .fd-today-body, .fd-today-split { grid-template-columns: minmax(0, 1fr); }
}
@container fdtoday (max-width: 640px) {
  .fd-today-dash .fd-ins { grid-template-columns: minmax(0, 1fr); }
  .fd-today-dash .fd-ins-rail { padding-right: 0; padding-bottom: 12px; border-right: 0; border-bottom: 1px solid var(--fd-line); }
}

/* ---- 总览右栏：问题 / 做得对 / 脚注 ---- */
.fd-ins-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; min-width: 0; }
.fd-ins-block { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.fd-ins-block-head { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--fd-dim); }
.fd-ins-block-head > b { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
.fd-ins-block-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--fd-dim); flex: none; }
.fd-ins-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.fd-ins-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: 6px; align-items: start; }
.fd-ins-mark { width: 16px; height: 16px; border-radius: 50%; font-size: 9.5px; display: grid; place-items: center;
  background: var(--fd-sunken); color: var(--fd-dim); }
.fd-tone-danger .fd-ins-mark { background: color-mix(in oklab, var(--fd-danger) 18%, transparent); color: var(--fd-danger); }
.fd-tone-warn .fd-ins-mark { background: color-mix(in oklab, var(--fd-warn) 18%, transparent); color: var(--fd-warn); }
.fd-tone-ok .fd-ins-mark { background: color-mix(in oklab, var(--fd-ok) 18%, transparent); color: var(--fd-ok); }
.fd-ins-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fd-ins-row-text { font-size: 12px; line-height: 1.6; color: var(--fd-text); overflow-wrap: anywhere; }
.fd-ins-row-ev { font-size: 10.5px; color: var(--fd-dim); overflow-wrap: anywhere; }
.fd-ins-acts { display: flex; align-items: center; gap: 4px; }
.fd-ins-foot { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--fd-line); }
.fd-ins-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.fd-ins-chip { font-size: 10.5px; color: var(--fd-dim); padding: 2px 8px; border-radius: 999px; background: var(--fd-sunken); }
.fd-ins-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 10.5px; color: var(--fd-dim); }
.fd-ins-meta-item { color: var(--fd-dim); }

/* ---- 按钮系统：次要 = 描边，主要 = 实心；浮起只给指针设备 ---- */
.fd-today .fd-ai-jump,
.fd-today .fd-ai-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: 24px; padding: 0 10px; border-radius: 7px;
  border: 1px solid var(--fd-line); background: transparent; color: var(--fd-dim);
  font: inherit; font-size: 11px; line-height: 1; white-space: nowrap; cursor: pointer;
  transition: background-color .14s ease, color .14s ease, border-color .14s ease, transform .14s ease;
}
.fd-today .fd-ai-btn {
  background: var(--fd-brand); border-color: transparent;
  color: var(--dsw-alias-bg-base); font-weight: 600;
}
.fd-today .fd-ai-jump:disabled,
.fd-today .fd-ai-btn:disabled { opacity: .5; cursor: not-allowed; }
.fd-today button:focus-visible { outline: 2px solid var(--fd-brand); outline-offset: 2px; }
@media (hover: hover) and (pointer: fine) {
  .fd-today .fd-ai-jump:hover { background: var(--fd-sunken); color: var(--fd-text); border-color: var(--fd-line-strong); }
  .fd-today .fd-ai-btn:hover { background: color-mix(in oklab, var(--fd-brand) 86%, var(--dsw-alias-bg-base)); }
}
.fd-today .fd-ai-jump:active,
.fd-today .fd-ai-btn:active { transform: translateY(1px); }

/* tabs = 分段控件：容器一块浅底，选中项浮起 */
.fd-today-tabs { display: flex; align-items: center; gap: 0; margin-left: auto; padding: 2px; border-radius: 8px; background: var(--fd-sunken); }
.fd-today-tabs .fd-ai-jump { height: 22px; padding: 0 9px; border: 0; border-radius: 6px; background: transparent; color: var(--fd-dim); }
.fd-today-tabs .fd-ai-jump[aria-pressed="true"] {
  background: var(--fd-surface); color: var(--fd-text); font-weight: 600;
  box-shadow: 0 1px 2px color-mix(in oklab, var(--fd-text) 14%, transparent);
}

/* ---- 推理链：事实 → 假设 → 反证 → 动作 → 验收 ---- */
.fd-ins-chain { position: relative; display: flex; flex-direction: column; gap: 6px; margin-top: 3px; padding-left: 15px; }
.fd-ins-chain::before { content: ''; position: absolute; left: 3px; top: 6px; bottom: 8px; width: 1px; background: var(--fd-line-strong); }
.fd-ins-chain-row { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 8px; align-items: start; }
.fd-ins-chain-row::before {
  content: ''; position: absolute; left: -15px; top: 4px; width: 6px; height: 6px;
  border-radius: 50%; background: var(--fd-surface); border: 1.5px solid var(--fd-brand); box-sizing: border-box;
}
.fd-ins-chain-row.is-action::before { background: var(--fd-brand); }
.fd-ins-chain-label { font-size: 10px; letter-spacing: .04em; color: var(--fd-dim); padding-top: 1px; }
.fd-ins-longterm-falsifier { margin: 0; font-size: 11.5px; line-height: 1.6; color: var(--fd-dim); overflow-wrap: anywhere; }
.fd-ins-longterm-metric { margin: 0; font-size: 11px; line-height: 1.6; color: var(--fd-dim); overflow-wrap: anywhere; }
.fd-ins-longterm .fd-ins-longterm-action { font-size: 12.5px; font-weight: 600; }
.fd-ins-headline { font-size: 20px; }

/* ---- 分区：记录 / 深度 / 关联任务 / 标签与操作 ---- */
.fd-zone { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 10px 12px;
  border: 1px solid var(--fd-line); border-radius: 10px; background: var(--fd-surface); }
.fd-zone-record { gap: 8px; }
.fd-zone-deep { gap: 8px; }
.fd-today-dash { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 16px; align-self: start; }
.fd-today-dash .fd-tic-insight-charts { min-height: 96px; }
.fd-today-dash .fd-today-editor-wrap { min-height: 76px; }
.fd-zone-tasks .fd-ins-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 16px; }
.fd-today-dash .fd-ins-longterm-fact,
.fd-today-dash .fd-ins-longterm-hyp,
.fd-today-dash .fd-ins-longterm-action,
.fd-today-dash .fd-ins-longterm-falsifier,
.fd-today-dash .fd-ins-longterm-metric { font-size: 11px; line-height: 1.5; }
.fd-today-dash .fd-today-chart { padding: 6px; }
.fd-today-dash .fd-ins-chain { gap: 2px; }
.fd-today-dash .fd-ins-chain-label { font-size: 9.5px; }
.fd-today-dash .fd-ins-longterm { gap: 3px; }
.fd-today-dash .fd-ins-longterm-head { font-size: 9.5px; }
.fd-today-dash .fd-ins-longterm-review { font-size: 10px; }
.fd-today-dash .fd-ins-next { padding: 7px 10px; }
.fd-today-dash .fd-ins-next-text { font-size: 12px; line-height: 1.55; }
.fd-today-dash .fd-mini-bars { height: 34px; }
.fd-today-dash .fd-ring { width: 52px; height: 52px; }
.fd-today-dash .fd-deep-body { gap: 8px 18px; }
.fd-today-dash .fd-deep-minis { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.fd-today-dash .fd-zone { gap: 6px; }
.fd-today-dash .fd-ins-chain-row p { line-height: 1.45; }
.fd-today-dash .fd-ins-longterm-fact { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.fd-today-dash .fd-task-row { padding-top: 3px; padding-bottom: 3px; }
.fd-report .fd-ins-headline { font-size: 18px; }
.fd-zone-tasks { gap: 6px; }
.fd-zone-foot { flex-direction: row; align-items: center; justify-content: space-between; gap: 10px; }
.fd-zone-foot .fd-ins-chips { flex: 1 1 auto; min-width: 0; }
.fd-zone-foot .fd-today-foot { margin-left: auto; flex: none; }
.fd-zone-head { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 10.5px; color: var(--fd-dim); }
.fd-zone-head > b { font-size: 11px; font-weight: 600; color: var(--fd-text); }
.fd-zone-empty { margin: 0; font-size: 11px; color: var(--fd-dim); }
.fd-ico { flex: none; width: 13px; height: 13px; color: var(--fd-dim); }
.fd-ico path { fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }

/* 深度：一张卡，内部是一个 grid（bento 机制：少轨道、同一 gap、按区域挂块），不画分割线 */
.fd-deep-body {
  display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  grid-template-areas: 'main side';
  gap: 10px 24px; align-items: start;
}
.fd-deep-main { grid-area: main; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.fd-deep-side { grid-area: side; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.fd-zone-deep .fd-ins-next,
.fd-zone-deep .fd-ins-longterm { border: 0; background: transparent; padding: 0; border-radius: 0; }
.fd-deep-minis { display: flex; flex-direction: column; gap: 10px; }
.fd-mini { margin: 0; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.fd-mini figcaption { display: flex; align-items: center; gap: 4px; font-size: 9.5px; letter-spacing: .04em; color: var(--fd-dim); }
.fd-mini-bars { display: flex; align-items: flex-end; gap: 3px; height: 46px; }
.fd-mini-col { flex: 1; display: flex; align-items: flex-end; gap: 1px; height: 100%; }
.fd-mini-col i { flex: 1; min-height: 1px; display: block; border-radius: 2px 2px 0 0; }
.fd-mini-col i.is-created { background: color-mix(in oklab, var(--fd-brand) 28%, transparent); }
.fd-mini-col i.is-done { background: var(--fd-brand); }
.fd-mini-note { margin: 0; font-size: 9.5px; color: var(--fd-dim); font-variant-numeric: tabular-nums; }
.fd-mini-ring { align-items: center; }
.fd-ring { --p: 0%; width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; position: relative;
  background: conic-gradient(var(--fd-brand) var(--p), var(--fd-sunken) 0); }
.fd-ring::after { content: ''; position: absolute; inset: 6px; border-radius: 50%; background: var(--fd-surface); }
.fd-ring b { position: relative; z-index: 1; font-size: 12px; font-variant-numeric: tabular-nums; }
.fd-mini-ring figcaption { justify-content: center; }

/* 天气：动画 + hover tooltip */
.fd-weather-card { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 8px 9px;
  border-radius: 10px; border: 1px solid var(--fd-line); background: var(--fd-surface); }
.fd-weather-row { display: flex; align-items: center; gap: 9px; min-width: 0; width: 100%; }
.fd-weather-updated { margin-left: auto; padding-left: 6px; font-size: 9.5px; color: var(--fd-dim); white-space: nowrap; }
.fd-weather-row .fd-weather-scene { width: 44px; height: 44px; flex: none; }
.fd-weather-scene { flex: none; width: 34px; height: 34px; color: var(--fd-dim); overflow: visible; }
.fd-weather-copy { display: flex; flex-direction: column; min-width: 0; }
.fd-weather-copy b { font-size: 11.5px; font-weight: 600; color: var(--fd-text); }
.fd-weather-copy span { font-size: 10px; color: var(--fd-dim); }
.fd-weather-tip { position: absolute; left: 0; top: calc(100% + 6px); z-index: 30; width: 230px;
  display: none; flex-direction: column; gap: 3px; padding: 8px 10px; border-radius: 9px;
  background: var(--fd-text); color: var(--dsw-alias-bg-base); font-size: 10.5px; line-height: 1.55;
  box-shadow: 0 8px 20px color-mix(in oklab, var(--fd-text) 28%, transparent); }
.fd-weather-tip b { font-size: 10.5px; }
.fd-weather-tip i { font-style: normal; opacity: .72; }
.fd-weather-card:hover .fd-weather-tip,
.fd-weather-card:focus-visible .fd-weather-tip { display: flex; }
.fd-weather-card:focus-visible { outline: 2px solid var(--fd-brand); outline-offset: 2px; }
.fd-w-sun { fill: color-mix(in oklab, var(--fd-warn) 24%, transparent); stroke: var(--fd-warn); stroke-width: 1.2; }
.fd-w-rays { transform-origin: 20px 20px; animation: fd-spin 24s linear infinite; stroke: var(--fd-warn); stroke-width: 1.2; fill: none; }
.fd-w-cloud { fill: color-mix(in oklab, var(--fd-dim) 18%, transparent); stroke: var(--fd-dim); stroke-width: 1; animation: fd-drift 6s ease-in-out infinite; }
.fd-w-drop { stroke: color-mix(in oklab, var(--fd-idle) 80%, transparent); stroke-width: 1.4; stroke-linecap: round; animation: fd-fall 1.2s linear infinite; }
.fd-w-drop:nth-of-type(2) { animation-delay: .3s; }
.fd-w-drop:nth-of-type(3) { animation-delay: .6s; }
.fd-w-bolt { fill: var(--fd-warn); stroke: none; animation: fd-flash 2.4s steps(1) infinite; }
@keyframes fd-spin { to { transform: rotate(360deg); } }
@keyframes fd-drift { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(2px); } }
@keyframes fd-fall { 0% { opacity: 0; transform: translateY(-2px); } 30% { opacity: 1; } 100% { opacity: 0; transform: translateY(4px); } }
@keyframes fd-flash {
  0% { opacity: 0; }
  82% { opacity: 0; }
  86% { opacity: 1; }
  90% { opacity: 1; }
  100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .fd-w-rays, .fd-w-cloud, .fd-w-drop, .fd-w-bolt { animation: none !important; }
  .fr-bubble.is-running, .fr-bubble-orb.is-running, .fr-kpi-ball.is-running, .fr-avatar-dot.is-running {
    animation: none !important; transition: none !important;
  }
  .fr-bubble.is-running::after { animation: none !important; }
}
@media (max-width: 640px) {
  .fd-deep-body { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'main' 'side'; }
}
@media (max-width: 560px) {
  .fd-deep-minis { grid-template-columns: minmax(0, 1fr); }
}

/* 天气与下方文字左对齐：去掉卡片内边距与描边，只留内容和 tooltip */
.fd-weather-card { border: 0; background: transparent; padding: 0; }

/* 左栏「今日结构」：ECharts 环图 + 图例（今天只画今天，和右侧趋势不重复） */
.fd-rail-chart { margin: 0; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.fd-rail-chart-box { height: 190px; min-width: 0; }
.fd-rail-chart-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 10px; font-size: 9.5px; color: var(--fd-dim); }
.fd-rail-chart-legend i { display: inline-block; width: 6px; height: 6px; border-radius: 2px; margin-right: 4px; vertical-align: middle; background: var(--fd-dim); }
.fd-rail-chart-legend i.fd-tone-ok { background: var(--fd-ok); }
.fd-rail-chart-legend i.fd-tone-brand { background: var(--fd-brand); }
.fd-rail-chart-legend i.fd-tone-danger { background: var(--fd-danger); }
.fd-rail-chart-legend i.fd-tone-idle { background: var(--fd-idle); opacity: .55; }
.fd-rail-flow { margin: 0; display: flex; flex-direction: column; gap: 2px; color: var(--fd-brand); min-width: 0; }
.fd-flow-box { height: 108px; min-width: 0; }
.fd-flow-box .fd-tic-chart-canvas { height: 100%; }
.fd-river-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 2px 8px; font-size: 9px; color: var(--fd-dim); }
.fd-river-legend span { display: flex; align-items: center; gap: 3px; max-width: 74px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-river-legend i { width: 6px; height: 6px; border-radius: 2px; flex: none; }
.fd-rail-flow-note { margin: 0; font-size: 9px; color: var(--fd-dim); text-align: center; }
.fd-rail-flow-empty { margin: 0; font-size: 9px; color: var(--fd-dim); }
.fd-rail-empty { margin: 0; font-size: 10px; color: var(--fd-dim); }

`

/** 幂等注入：宿主文档里已有同 id 的 <style> 就不重复插。 */
export function injectStyles(doc) {
  const d = doc && typeof doc.createElement === 'function' ? doc : (typeof document === 'undefined' ? null : document)
  if (!d || typeof d.getElementById !== 'function') return false
  if (d.getElementById(STYLE_ID)) return false
  const el = d.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  const host = d.head || d.documentElement
  if (!host) return false
  host.appendChild(el)
  return true
}

export default CSS
