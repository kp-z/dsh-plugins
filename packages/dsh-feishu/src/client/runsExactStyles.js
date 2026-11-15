/**
 * 运行页「照抄参考项目」的样式表（<style id="dsh-feishu-runs-exact-style">）。
 *
 * ⚠️ 这一份**故意不遵守**「只用 14 个宿主令牌 / 零字面量颜色」那条红线。
 *
 * 原因：用户口径是「整个风格都不对……卡片的颜色估计要和参考项目完全一致」，而参考项目
 * （kp-z/open_adventure 的 `pages/Dashboard.tsx` + `components/GlassCard` + `ClaudeModelBubbles`
 * + `WaterLevel`）是一套固定的深色玻璃拟态皮肤：`bg-white/5`、`border-white/10`、
 * `rounded-2xl`、`backdrop-blur-md`、绿泡 `rgba(34,197,94,.4)` 光晕……
 * 用令牌调出来的永远是「像」，不是「一样」。所以这一张表按 Tailwind 的**原始取值**逐条抄下来，
 * 并且：
 *   1. 所有选择器都以 `.frx-` 开头（不会污染宿主，也不会和令牌版 `fr-` 混掉）；
 *   2. 只被运行页使用，其它页面继续走令牌；
 *   3. 独立的 style id，卸载时整块移除。
 *
 * 换句话说：**红线收敛到「不污染宿主」**，颜色保真优先（用户口径优先于我们的内部约定）。
 */

export const STYLE_ID = 'dsh-feishu-runs-exact-style'

export const CSS = `
/* ---------- 页面骨架（Dashboard.tsx 的 space-y-8 + 4 列网格） ---------- */
.frx-page {
  container-type: inline-size;
  container-name: frxpage;
  display: flex; flex-direction: column; gap: 24px;
  /* 运行页比一屏高（气泡卡 + 三个统计卡 + 历史 + 动作卡），必须自己能滚：
     宿主给功能页的容器是 .fo-feature-host（flex:1 + min-height:0，本身不滚），
     所以滚动要落在这一层 —— 否则内容直接被裁掉，看起来就是「页面无法滚动」。 */
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* 侧边栏（rail）与卡片之间要留出呼吸位：左右各 20px + 上下 16/28px，
     否则卡片会贴着 rail 的边线，看起来像「挤在一起」。 */
  padding: 16px 20px 28px;
  color: var(--frx-text);

  /* 表面/文字/描边一律**从宿主令牌派生**：亮色深色自动跟着变，不需要我自己判断主题
     （上一版把文字色写死成浅灰，亮色模式下就是「浅灰字压白底」——用户实测反馈的问题）。
     只有气泡的品牌绿/蓝光晕保留参考项目的原始色值：那是语义色，亮暗两种模式下都成立。 */
  --frx-text: var(--dsw-alias-label-primary);
  --frx-text-strong: color-mix(in oklab, var(--dsw-alias-label-primary) 94%, transparent);
  --frx-text-dim: color-mix(in oklab, var(--dsw-alias-label-secondary) 92%, transparent);
  --frx-text-faint: color-mix(in oklab, var(--dsw-alias-label-secondary) 75%, transparent);
  --frx-surface: color-mix(in oklab, var(--dsw-alias-bg-layer-1) 82%, transparent);
  --frx-surface-hover: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 92%, transparent);
  --frx-border: color-mix(in oklab, var(--dsw-alias-border-l1) 62%, transparent);
  --frx-border-hover: var(--dsw-alias-border-l2);
  --frx-inner: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 70%, transparent);
  --frx-orb-bg-1: color-mix(in oklab, var(--dsw-alias-label-primary) 9%, transparent);
  --frx-orb-bg-2: color-mix(in oklab, var(--dsw-alias-label-primary) 4%, transparent);
  --frx-orb-dim-border: color-mix(in oklab, var(--dsw-alias-label-secondary) 40%, transparent);
  --frx-avatar-border: color-mix(in oklab, var(--dsw-alias-border-l1) 80%, transparent);
  --frx-avatar-bg: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 60%, transparent);
  --frx-avatar-ring: var(--dsw-alias-bg-base);
  --frx-tip-bg: var(--dsw-alias-bg-overlay);
  --frx-tip-fg: var(--dsw-alias-label-primary);
  --frx-tip-meta: var(--dsw-alias-label-secondary);
  --frx-shadow: 0 1px 2px color-mix(in oklab, var(--dsw-alias-bg-base) 22%, transparent), 0 10px 22px -16px color-mix(in oklab, var(--dsw-alias-bg-base) 60%, transparent);
  --frx-scrollbar: color-mix(in oklab, var(--dsw-alias-label-secondary) 30%, transparent);
  /* 参考项目的行高是 clamp(...) 让行随视口长；但用户口径是「三行一样高」——
     行高由内容决定时跨行永远不可能相等（实测 329 / 360 / 334），所以这里改成固定值。 */
  --frx-row-h: 344px;
}
.frx-subtitle { margin: 0; font-size: 12px; line-height: 1.5; color: var(--frx-text-dim); }

/* ---------- 卡片（GlassCard：bg-white/5 + backdrop-blur-md + border-white/10 + rounded-2xl + p-6 + shadow-xl） ---------- */
/* 整页 4 列网格（用户口径：最起码 2×4）。固定列数，不用 auto-fit —— 否则面板一宽就排成
   N 列、跨列卡被挤到下一行。各卡片用 .is-spanN 决定占几列。 */
.frx-grid {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px; align-items: stretch;
  height: auto;
  /* 三行**等高**（用户口径：第一/二/三行应该一样高）。用固定行高而不是 auto：
     行高由内容决定时永远不可能跨行相等（329 / 360 / 334 就是这么来的）。
     窄面板（≤980px，见下方容器查询）落回 auto —— 那时卡片会被重排成 5 行，固定高会裁内容。 */
  grid-auto-rows: var(--frx-row-h);
}
.frx-grid.is-tight { height: auto; }
.frx-card {
  position: relative; overflow: hidden; display: flex; flex-direction: column;
  padding: 20px; border-radius: 14px; cursor: default;
  background: var(--frx-surface);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  border: 1px solid var(--frx-border);
  box-shadow: var(--frx-shadow);
  transition: border-color .3s ease, transform .3s ease;
}
.frx-card:hover { border-color: var(--frx-border-hover); }
.frx-card.is-span2 { grid-column: span 2; }
.frx-card.is-span4 { grid-column: span 4; }
.frx-card.is-half-row { height: calc((var(--frx-row-h) - 24px) / 2); }
/* 参考项目卡片内那层 hover 才出现的蓝紫渐变 */
.frx-card-glow {
  position: absolute; inset: 0; pointer-events: none; opacity: 0;
  background: linear-gradient(to bottom right, rgba(59, 130, 246, 0.05), rgba(168, 85, 247, 0.05));
  transition: opacity .3s ease;
}
.frx-card:hover .frx-card-glow { opacity: 1; }
.frx-card-inner { position: relative; z-index: 10; display: flex; flex-direction: column; height: 100%; min-height: 0; }

/* ---------- 卡片头（图标块 + 标题 + 版本 / 设置按钮） ---------- */
.frx-card-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 24px; gap: 12px; }
.frx-card-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.frx-icon {
  width: 48px; height: 48px; border-radius: 12px; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
}
.frx-icon.is-ok { background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.5); color: #22c55e; }
.frx-icon.is-idle { background: rgba(156, 163, 175, 0.15); border: 1px solid rgba(156, 163, 175, 0.4); color: #9ca3af; }
.frx-icon.is-brand { background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.5); color: #60a5fa; }
.frx-card-title { margin: 0; font-size: 15px; font-weight: 700; color: #f9fafb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.frx-card-sub { margin: 0; font-size: 12px; font-weight: 500; }
.frx-card-sub.is-ok { color: #22c55e; }
.frx-card-sub.is-idle { color: var(--frx-text-dim); }

/* ---------- KPI 胶囊（状态卡头部） ---------- */
.frx-kpis { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
.frx-kpi {
  display: inline-flex; align-items: center; gap: 7px;
  height: 30px; padding: 0 11px; border-radius: 999px;
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 62%, transparent);
  border: 1px solid var(--frx-border);
}
.frx-kpi[data-tone="warn"] { border-color: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 45%, transparent); }
.frx-kpi-icon {
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 7px;
  color: var(--frx-text-dim);
  background: color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent);
}
.frx-kpi[data-tone="warn"] .frx-kpi-icon { color: var(--dsw-alias-state-warn-primary); }
.frx-kpi b { font-size: 15px; font-weight: 700; color: var(--frx-text-strong); font-variant-numeric: tabular-nums; }
.frx-kpi-label { font-size: 11px; color: var(--frx-text-dim); }



/* ---------- 事件流里的状态点（最近动态卡） ---------- */
.frx-avatar-dot {
  position: absolute; right: -2px; bottom: -2px; width: 12px; height: 12px; border-radius: 999px;
  border: 2px solid var(--frx-avatar-ring); background: #6b7280;
}
.frx-avatar-dot.is-running { background: #3b82f6; }   /* 运行中=蓝 */
.frx-avatar-dot.is-blocked { background: #f59e0b; }   /* 阻塞/报错=黄 */
.frx-avatar-dot.is-done { background: #22c55e; }      /* 完成=绿 */
.frx-avatar-dot.is-suspended { background: #f59e0b; }

/* ---------- 「运行中」的三点动画 ----------
   用户口径：运行中的状态不要写字（「运行中***」），改成一个个… 的动画。
   三个点按 0 / .18s / .36s 依次亮起，1.2s 循环；文字只在 aria-label / title 上。 */
.frx-dots { display: inline-flex; align-items: center; gap: 3px; vertical-align: middle; }
.frx-dots-dot {
  width: 4px; height: 4px; border-radius: 999px;
  background: currentColor; opacity: .25;
  animation: frx-dots 1.2s ease-in-out infinite;
}
.frx-dots-dot:nth-child(2) { animation-delay: .18s; }
.frx-dots-dot:nth-child(3) { animation-delay: .36s; }
@keyframes frx-dots {
  0%, 100% { opacity: .25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-1px); }
}
@media (prefers-reduced-motion: reduce) {
  .frx-dots-dot { animation: none; opacity: .65; }
}

/* ---------- 气泡 hover：放大 1.1（对齐参考项目的 hover:scale-110） ----------
   作用在插槽上而不是 SVG 上：插槽是定位锚点，缩放后徽标也跟着走、不会脱开。
   用 transform 而不是改 width/height，避免每帧触发布局。 */
.frx-orb-slot { transition: transform 180ms cubic-bezier(.22, .61, .36, 1); transform-origin: 50% 50%; }
.frx-orb-slot:hover { transform: scale(1.1); z-index: 30; }
@media (prefers-reduced-motion: reduce) {
  .frx-orb-slot, .frx-orb-slot:hover { transition: none; transform: none; }
}

/* ---------- 状态徽标（咬住泡的右下角） ----------
   用户 review 后定的形态（P2）：小胶囊 + 图标/三点，位置固定在泡的右下角咬边，不会变成
   「夹在两泡之间的黑横条」。颜色 = 状态色玻璃（底 22% 状态色 + 深底、描边 55% 状态色）。 */
.frx-badge {
  position: absolute;
  /* 用户口径「和气泡的相对位置太低了，高一点」：改成锚定**右上角**（原来 bottom 锚定会随
     气泡槽高度浮动、看起来吊在泡的右下角）。 */
  left: calc(100% - 20px);
  top: -6px;
  z-index: 40;
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--frx-badge-c, #3b82f6) 22%, rgba(10, 12, 16, 0.94));
  border: 1px solid color-mix(in srgb, var(--frx-badge-c, #3b82f6) 55%, rgba(255, 255, 255, 0.12));
  color: color-mix(in srgb, var(--frx-badge-c, #3b82f6) 78%, #ffffff);
  box-shadow: 0 4px 12px -4px rgba(0, 0, 0, 0.85), 0 0 10px -2px color-mix(in srgb, var(--frx-badge-c, #3b82f6) 45%, transparent);
  pointer-events: none;
}
.frx-badge-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
/* 徽标里的线性图标（Lucide 图标集，11px） */
.frx-badge svg { display: block; }

/* ---------- 「运行中」的三点动画 ---------- */
.frx-dots { display: inline-flex; align-items: center; gap: 3px; vertical-align: middle; }
.frx-dots-dot {
  width: 4px; height: 4px; border-radius: 999px;
  background: currentColor; opacity: .25;
  animation: frx-dots 1.2s ease-in-out infinite;
}
.frx-dots-dot:nth-child(2) { animation-delay: .18s; }
.frx-dots-dot:nth-child(3) { animation-delay: .36s; }
@keyframes frx-dots {
  0%, 100% { opacity: .25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-1px); }
}
@media (prefers-reduced-motion: reduce) {
  .frx-dots-dot { animation: none; opacity: .65; }
}

/* ---------- 气泡群（ClaudeModelBubbles dashboard-desktop） ---------- */
.frx-bubbles-label {
  margin: 0 0 12px; font-size: 10px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--frx-text-dim);
}
.frx-bubbles { position: relative; width: 100%; max-width: 520px; height: 116px; margin: 4px auto 0; }
.frx-orb-slot { position: absolute; }
.frx-orb-slot:hover { z-index: 20; }
/* 圆本体：rounded-full + overflow-hidden + border-2 + bg-gradient-to-br from-white/8 via-white/4 to-transparent */
.frx-orb {
  position: relative; display: block; width: 100%; height: 100%; padding: 0; cursor: pointer;
  /* 强制正圆：宿主可能对 button 有通用圆角/尺寸样式，这里用 !important 钉死，
     否则实机上会出现「不是圆的」（用户实测反馈）。 */
  border-radius: 50% !important; aspect-ratio: 1 / 1; overflow: hidden; border: 2px solid transparent;
  background: linear-gradient(to bottom right, var(--frx-orb-bg-1), var(--frx-orb-bg-2), rgba(255, 255, 255, 0));
  transition: transform .3s ease, border-color .3s ease, box-shadow .3s ease;
}
.frx-orb:hover { transform: scale(1.1); }
/* 可用 / 运行中：绿边 .4 + 20px/40px 光晕 + 30px 内发光 + 顶部 1px 白线 */
.frx-orb.is-ok {
  border-color: rgba(34, 197, 94, 0.4);
  box-shadow:
    0 0 20px rgba(34, 197, 94, 0.4),
    0 0 40px rgba(34, 197, 94, 0.2),
    inset 0 0 30px rgba(34, 197, 94, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
/* 当前 / 正在跑：蓝边 .6 + 25px/50px 光晕 + 35px 内发光 */
.frx-orb.is-current {
  border-color: rgba(59, 130, 246, 0.6);
  box-shadow:
    0 0 25px rgba(59, 130, 246, 0.6),
    0 0 50px rgba(59, 130, 246, 0.3),
    inset 0 0 35px rgba(59, 130, 246, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
/* 不可用 / 未开始：1px 白 15% + 轻微投影 */
.frx-orb.is-dim {
  border-width: 1px;
  border-color: var(--frx-orb-dim-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
/* 交互层（透明 button）：不画任何形状，只给焦点环，避免宿主 button 样式影响圆的形状 */
.frx-orb-hit:focus-visible { outline: 2px solid color-mix(in oklab, var(--dsw-alias-brand-primary) 70%, transparent); outline-offset: 2px; }
/* 水位（WaterLevel.tsx）：两层 SVG，填充 + 波浪线，都被圆形裁剪 */
.frx-water { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.frx-water.is-fill { z-index: 20; }
.frx-water.is-wave { z-index: 21; }
.frx-water-liquid { fill: rgba(34, 197, 94, 0.2); transition: fill 1s ease-out; }
.frx-water-wave { stroke: rgba(34, 197, 94, 0.6); transition: stroke 1s ease-out; }
/* hover 浮层（bg-black/95 + rounded-lg + 小三角） */
.frx-orb-tip {
  /* 浮层放在气泡**下方**：卡片本身 overflow:hidden（玻璃效果需要它），
     放上方会被卡片顶边裁掉（用户实测「hover 被 hidden 了」）。 */
  position: absolute; left: 50%; top: 100%; z-index: 60; transform: translateX(-50%); /* 内联会覆盖这条做左右自适应 */
  margin-top: 8px; display: flex; flex-direction: column; gap: 3px;
  max-width: 240px;
  padding: 8px 12px; border-radius: 8px; white-space: nowrap;
  background: var(--frx-tip-bg); border: 1px solid var(--frx-border);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}
.frx-orb-tip-name { font-size: 11px; font-weight: 700; color: var(--frx-tip-fg); overflow: hidden; text-overflow: ellipsis; }
.frx-orb-tip-meta { font-size: 9px; color: var(--frx-tip-meta); }
.frx-orb-tip-hint { font-size: 8px; color: #4ade80; }

/* 漂浮：参考项目 @keyframes float 原样（-8/-4/-10px，+3/-3/+2px） */
@keyframes frx-float {
  0%, 100% { transform: translateY(0) translateX(0); }
  25% { transform: translateY(-8px) translateX(3px); }
  50% { transform: translateY(-4px) translateX(-3px); }
  75% { transform: translateY(-10px) translateX(2px); }
}

/* ---------- 开工顺序：横向条形图（条长 = 等了多久） ---------- */
.frx-rank { display: flex; flex-direction: column; gap: 9px; }
.frx-rank-row {
  display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 9px;
  font: inherit; color: inherit; width: 100%; text-align: left;
  background: none; border: none; padding: 0; margin: 0; cursor: pointer;
}
.frx-rank-p {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 18px; border-radius: 6px; font-size: 9px; font-weight: 700;
  background: color-mix(in oklab, var(--dsw-alias-label-secondary) 14%, transparent);
  color: var(--frx-text-dim);
}
.frx-rank-p[data-p="P0"] { background: rgba(239, 68, 68, 0.16); color: #fca5a5; }
.frx-rank-p[data-p="P1"] { background: rgba(245, 158, 11, 0.16); color: #fcd34d; }
.frx-rank-p[data-p="P2"] { background: rgba(59, 130, 246, 0.16); color: #93c5fd; }
.frx-rank-main { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.frx-rank-title { font-size: 12px; color: var(--frx-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frx-rank-track { height: 5px; border-radius: 999px; background: var(--frx-inner); overflow: hidden; }
.frx-rank-track > i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(to right, rgba(59, 130, 246, 0.85), rgba(59, 130, 246, 0.28)); }
.frx-rank-wait { font-size: 11px; color: var(--frx-text-dim); font-variant-numeric: tabular-nums; }
.frx-rank-row:hover .frx-rank-title { color: var(--frx-text-strong); }

/* ---------- 快到期：时间轴（逾期区 / 今天 / 未来） ---------- */
.frx-due { position: relative; display: flex; flex-direction: column; gap: 6px; }
.frx-due-axis { position: relative; display: flex; justify-content: space-between; height: 12px; font-size: 9px; color: var(--frx-text-faint); }
.frx-due-axis .frx-due-today { position: absolute; top: 0; transform: translateX(-50%); color: var(--dsw-alias-state-warn-primary); }
.frx-due-bands { position: relative; height: 3px; border-radius: 999px; background: var(--frx-inner); overflow: hidden; }
.frx-due-bands > i { position: absolute; top: 0; bottom: 0; display: block; }
.frx-due-bands .is-over { left: 0; background: rgba(239, 68, 68, 0.55); }
.frx-due-bands .is-future { background: rgba(34, 197, 94, 0.45); }
.frx-due-row {
  display: grid; grid-template-columns: minmax(0, 1fr) 64px auto; align-items: center; gap: 8px;
  font: inherit; color: inherit; width: 100%; text-align: left;
  background: none; border: none; padding: 0; margin: 0; cursor: pointer; height: 20px;
}
.frx-due-title { font-size: 11px; color: var(--frx-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frx-due-track { position: relative; display: block; height: 8px; }
.frx-due-bar { position: absolute; top: 3px; height: 2px; border-radius: 999px; background: rgba(148, 163, 184, 0.55); }
.frx-due-dot { position: absolute; top: 1px; width: 6px; height: 6px; margin-left: -3px; border-radius: 999px; background: #22c55e; }
.frx-due-row[data-bucket="overdue"] .frx-due-dot { background: #ef4444; }
.frx-due-row[data-bucket="overdue"] .frx-due-when { color: #fca5a5; }
.frx-due-row[data-bucket="today"] .frx-due-dot { background: #f59e0b; }
.frx-due-row[data-bucket="today"] .frx-due-when { color: #fcd34d; }
.frx-due-when { font-size: 10px; color: var(--frx-text-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
.frx-due-unset { margin: 8px 0 0; font-size: 10px; color: var(--frx-text-faint); display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.frx-due-unset-label { flex: 0 0 auto; }
.frx-due-unset-chip {
  max-width: 100%; font: inherit; font-size: 10px; padding: 1px 6px; border-radius: 6px; cursor: pointer;
  color: var(--frx-text-dim); background: var(--frx-inner); border: 1px solid var(--frx-border);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.frx-due-unset-chip:hover { color: var(--frx-text-strong); border-color: var(--frx-border-hover); }

/* ---------- 最近动态：24 根柱子 + 3 条事件 ---------- */
.frx-cols { display: flex; align-items: flex-end; gap: 2px; height: 62px; padding: 0 1px; }
.frx-col { flex: 1 1 0; min-width: 2px; border-radius: 2px 2px 0 0; background: linear-gradient(to top, rgba(59, 130, 246, 0.9), rgba(59, 130, 246, 0.45)); }
.frx-col[data-empty="1"] { background: var(--frx-inner); }
.frx-cols-axis { display: flex; justify-content: space-between; margin-top: 4px; font-size: 9px; color: var(--frx-text-faint); }
.frx-events { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
.frx-event {
  display: grid; grid-template-columns: 8px minmax(0, 1fr) auto auto; align-items: center; gap: 8px;
  font: inherit; color: inherit; width: 100%; text-align: left;
  background: none; border: none; padding: 0; margin: 0; cursor: pointer;
}
.frx-event-text { font-size: 11px; color: var(--frx-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frx-event-kind { font-size: 10px; color: var(--frx-text-dim); }
.frx-event-ago { font-size: 10px; color: var(--frx-text-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.frx-event:hover .frx-event-text { color: var(--frx-text-strong); }

/* ---------- 系统健康：环形图 + 状态行 + 计时覆盖 ---------- */
.frx-health { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 16px; align-items: center; }
.frx-health-ring { position: relative; width: 84px; height: 84px; flex: 0 0 auto; }
.frx-health-ring-text {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 700; color: var(--frx-text-strong); font-variant-numeric: tabular-nums;
}
.frx-health-rows { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.frx-health-row { display: grid; grid-template-columns: 8px 64px minmax(0, 1fr); align-items: center; gap: 8px; }
.frx-health-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--frx-inner); }
.frx-health-dot.is-ok { background: #22c55e; }
.frx-health-dot.is-warn { background: #f59e0b; }
.frx-health-label { font-size: 11px; color: var(--frx-text-dim); }
.frx-health-value { font-size: 11px; color: var(--frx-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frx-health-cover { grid-column: 1 / -1; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; margin-top: 4px; }
.frx-health-cover-text { font-size: 10px; color: var(--frx-text-faint); }
.frx-health-cover-track { height: 4px; border-radius: 999px; background: var(--frx-inner); overflow: hidden; }
.frx-health-cover-track > i { display: block; height: 100%; border-radius: 999px; background: rgba(34, 197, 94, 0.7); }
.frx-health-cover-value { font-size: 10px; color: var(--frx-text-dim); font-variant-numeric: tabular-nums; }
/* ---------- 运行历史：表格 + 时长微条形 ---------- */
.frx-hist { display: flex; flex-direction: column; gap: 2px; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
.frx-hist-cols, .frx-hist-row {
  display: grid; grid-template-columns: minmax(0, 1fr) 88px 56px 168px 88px;
  align-items: center; gap: 12px;
}
.frx-hist-cols { padding: 0 8px 4px; font-size: 9px; color: var(--frx-text-faint); }
.frx-hist-row {
  font: inherit; color: inherit; text-align: left; width: 100%;
  background: none; border: 0; border-radius: 8px; padding: 5px 8px; cursor: pointer;
  transition: background-color .18s ease;
}
.frx-hist-row:hover { background: var(--frx-surface-hover); }
.frx-hist-main { display: flex; align-items: center; gap: 8px; min-width: 0; }
.frx-hist-no { flex: 0 0 auto; font-size: 10px; color: var(--frx-text-faint); font-variant-numeric: tabular-nums; }
.frx-hist-title { font-size: 12px; color: var(--frx-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frx-hist-state { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--frx-text-dim); }
.frx-hist-state .frx-avatar-dot { position: static; width: 7px; height: 7px; border: 0; flex: 0 0 auto; }
.frx-hist-turn { font-size: 11px; color: var(--frx-text-dim); font-variant-numeric: tabular-nums; }
.frx-hist-elapsed { display: flex; align-items: center; gap: 8px; min-width: 0; }
.frx-hist-bar { flex: 1 1 auto; height: 4px; border-radius: 999px; background: var(--frx-inner); overflow: hidden; }
.frx-hist-bar > i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(to right, rgba(59, 130, 246, 0.9), rgba(59, 130, 246, 0.35)); }
.frx-hist-dur { flex: 0 0 auto; min-width: 52px; text-align: right; font-size: 10px; color: var(--frx-text-dim); font-variant-numeric: tabular-nums; }
.frx-hist-ago { font-size: 10px; color: var(--frx-text-faint); text-align: right; font-variant-numeric: tabular-nums; }

/* ---------- 键盘焦点 ----------
   卡片里的行都是 button，但取消了默认边框/背景，没有焦点环就完全看不出选到哪。
   只在 focus-visible 画（鼠标点击不会留一圈）。 */
.frx-page :where(button):focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
  border-radius: 8px;
}

/* ---------- 细滚动条 ---------- */

/* ---------- 窄屏：参考项目的 md/lg 断点 ---------- */
@container frxpage (max-width: 1100px) {
  .frx-grid { height: auto; }
}
/* 窄面板降成 2 列（跨列卡最多占满一行） */
@container frxpage (max-width: 980px) {
  .frx-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: auto; }
  .frx-card.is-span4 { grid-column: span 2; }
}
/* 更窄：单列 */
@container frxpage (max-width: 640px) {
  .frx-grid { grid-template-columns: minmax(0, 1fr); }
  .frx-card.is-span2, .frx-card.is-span4 { grid-column: span 1; }
}

/* ---------- 减少动效 ---------- */
@media (prefers-reduced-motion: reduce) {
  .frx-orb-slot { animation: none !important; }
  .frx-orb { transition: none !important; }
  .frx-orb:hover { transform: none !important; }
}`

/** 注入这张表（幂等；卸载时由调用方按 STYLE_ID 移除）。 */
export function injectExactStyles(doc) {
  const d = doc || (typeof document === 'undefined' ? null : document)
  if (!d || typeof d.createElement !== 'function') return null
  const old = d.getElementById(STYLE_ID)
  if (old) old.remove()
  const node = d.createElement('style')
  node.id = STYLE_ID
  node.textContent = CSS
  const head = d.head || d.documentElement
  if (head) head.appendChild(node)
  return node
}
