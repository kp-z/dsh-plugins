/**
 * 飞书任务总览 · 样式（唯一来源）
 *
 * 风格取自参考项目 Claude Manager（kp-z/Claudeadventure，Figma Make 导出的 React+Tailwind 应用）：
 * **深色玻璃卡片** —— `bg-white/5` + `border-white/10` + `backdrop-blur-md` + 大圆角 + 大内边距 +
 * hover 上浮 + 品牌色→透明渐变淡入 + 紧凑字号。换算规则见
 * `docs/STYLE-borrowed-claude-manager.md`（那份文档是口径，本文件是落地）。
 *
 * 三条硬约束（我们的测试在钉，不许放宽）：
 * 1. **零字面量颜色**：参考项目的玻璃感靠 `rgba(255,255,255,.05)` 这类字面量，这里一律换成
 *    `color-mix(in oklab, <宿主令牌> X%, transparent)` —— 同样的透明度分层，明暗两套仍跟着宿主走。
 * 2. 令牌仍限定在那 14 个 `--dsw-*`（测试会断言「去重后恰好 14 个」，少一个多一个都红）。
 * 3. 类名唯一前缀 `fo-`，由入口注入一次（injectStyles 幂等）。
 *
 * 层级用**透明度**而不是灰阶：面板底 `bg-base` → 卡片 `bg-layer-1 92%` → 次级卡 `bg-layer-2 88%`。
 * 项目分色（--fo-deco-N）与状态光晕（--fo-glow-*）都是品牌/状态令牌的 color-mix 变体，
 * 属于「图形装饰」，不是新色板。
 *
 * ⚠️ 这个模块在 node 里也能 import（只导出字符串与纯函数，不碰 document）。
 */

export const STYLE_ID = 'dsh-cove-task-overview-style'
/** 早期冻结名（lead 的入口按这个 import 也行）。 */
export const OVERVIEW_STYLE_ID = STYLE_ID

/** `color-mix(in oklab, <token> pct%, transparent)`：把「白色 5%」翻译成宿主令牌的透明度。 */
const g = (token, pct) => `color-mix(in oklab, ${token} ${pct}%, transparent)`

/** 令牌回退链：宿主某些版本里 border/layer 命名不同，回退的仍是宿主令牌，不是字面量。 */
const T = {
  bgBase: 'var(--dsw-alias-bg-base, var(--dsw-alias-bg-layer-1))',
  bgLayer1: 'var(--dsw-alias-bg-layer-1)',
  bgLayer2: 'var(--dsw-alias-bg-layer-2)',
  bgOverlay: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2))',
  border1: 'var(--dsw-alias-border-l1, var(--dsw-alias-border-l2))',
  border2: 'var(--dsw-alias-border-l2, var(--dsw-alias-border-l1))',
  brand: 'var(--dsw-alias-brand-primary)',
  label1: 'var(--dsw-alias-label-primary)',
  label2: 'var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary))',
  error: 'var(--dsw-alias-state-error-primary)',
  /* 带兜底：独立页/旧宿主的令牌集可能是残缺的，而 stroke: var(--x) 一旦解析失败会变成
     stroke:none —— 关系图的边会整条消失（2026-11-17 用户实测）。宁可退成次级文字色，也不能不见。 */
  idle: 'var(--dsw-alias-state-idle-primary, var(--dsw-alias-label-secondary))',
  success: 'var(--dsw-alias-state-success-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
  sidebar: 'var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1))',
}

/** 玻璃三件套：卡片面 / 次级面 / 描边，加一个悬停描边与投影。 */
const GLASS = {
  card: g(T.bgLayer1, 92),
  sub: g(T.bgLayer2, 88),
  line: g(T.border1, 65),
  lineHover: g(T.border2, 82),
  shadow: `0 8px 24px ${g(T.label1, 10)}`,
  wash: `linear-gradient(135deg, ${g(T.brand, 6)}, transparent 72%)`,
}

export const CSS = `
/* ============ 根容器：玻璃层的所有变量都在这里定义，组件只引用 ============ */
.fo-root {
  /* **容器查询的锚点**：这块面板活在宿主侧栏的 tab 里，宽度由宿主决定、与视口无关。
     所以响应式一律按「面板自己有多宽」判断（@container fopanel），不要用 @media（视口）——
     否则「桌面大屏 + 很窄的 tab」会让卡片挤爆、rail 又过宽。 */
  container-type: inline-size;
  container-name: fopanel;
  /* 项目分色槽（品牌/状态令牌派生，图形装饰用） */
  --fo-deco-0: ${T.brand};
  --fo-deco-1: color-mix(in oklab, ${T.brand} 64%, ${T.success});
  --fo-deco-2: color-mix(in oklab, ${T.brand} 64%, ${T.warn});
  --fo-deco-3: color-mix(in oklab, ${T.brand} 60%, ${T.error});
  --fo-deco-4: color-mix(in oklab, ${T.brand} 40%, ${T.success});
  --fo-deco-5: color-mix(in oklab, ${T.brand} 40%, ${T.warn});
  --fo-deco-6: color-mix(in oklab, ${T.brand} 40%, ${T.error});
  --fo-deco-7: ${T.idle};
  /* 状态光晕：参考项目 rarity 光晕的等价物，35% 一档 */
  /* 玻璃三件套 */
  --fo-glass-card: ${GLASS.card};
  --fo-glass-sub: ${GLASS.sub};
  --fo-glass-line: ${GLASS.line};
  --fo-glass-line-hover: ${GLASS.lineHover};
  --fo-glass-shadow: ${GLASS.shadow};
  --fo-glass-wash: ${GLASS.wash};
  --fo-glass-blur: blur(12px);
  /* 侧栏宽度：与 cove 完全一致 —— 展开 192px、收起 80px。 */
  --fo-rail-w: 192px;
  /* 全局 Header 高度（= 品牌栏高度，两栏共用）与右侧建议栏宽度 */
  --fo-appbar-h: 48px;
  --fo-dock-w: 340px;
  /* rail 里「一个方块」的边长：logo 与一级项**共用**这一个值，
     以后只调这里，两者不可能再不一致（用户反复踩到的就是「改一处、另一处没跟上」）。 */
  --fo-rail-item: 44px;
  --fo-rail-line: ${g(T.border1, 40)};
  --fo-row-hover-bg: ${g(T.bgLayer2, 55)};
  --fo-selected-bg: ${g(T.brand, 20)};
  --fo-selected-line: ${g(T.brand, 30)};
  /* 画布：40px 网格 + 品牌调渐变底（参考站 WorkflowEditor 同款） */
  /* 优先级：画布左侧 3px 色条，颜色与面板任务卡（data-priority）的 border-left 一一对应。 */
  --fo-grid-size: 40px;
  --fo-grid-line: ${g(T.border1, 12)};
  --fo-canvas-bg: linear-gradient(135deg, ${g(T.bgBase, 55)}, ${g(T.bgLayer1, 35)});
  --fo-canvas-line: ${g(T.border1, 35)};
  --fo-ease: cubic-bezier(.2, .8, .2, 1);
  --fo-dur: 300ms;

  display: grid;
  /* rail（功能导航）| 正文（功能页 + 详情） */
  grid-template-columns: var(--fo-rail-w) minmax(0, 1fr);
  height: 100%;
  /* 宿主 slot 有时候给的是 auto 高度：只写 height:100% 会退化成内容高度，
     导致画布/面板外面多出一整块空白。用视口高度兜底（父容器有确定高度时 100% 仍然优先）。 */
  min-height: 100vh;
  min-height: 100dvh;
  background: ${T.bgBase};
  color: ${T.label1};
  font-size: 12px;
  line-height: 1.5;
}
.fo-root *, .fo-root *::before, .fo-root *::after { box-sizing: border-box; }
.fo-root :focus-visible { outline: 2px solid ${T.brand}; outline-offset: 1px; }

/* ============ 入场：120ms 上浮淡入，逐行 20ms 递延（--fo-i 由组件给，上限 8 行）
   用 backwards 而不是 both —— both 会让最后一帧的 transform 一直生效，把 hover 的上浮吃掉。 ============ */
@keyframes fo-rise {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
/* 注意：**品牌块不参加入场动画**。它和全局 Header 必须严格共线，而 fo-rise 的
   from 帧带 translateY(4px) —— 动画没跑完（或标签页在后台、动画被冻结）时会停在偏移 4px 的
   状态，正好就是用户看到的「中间那条缝对不齐」。 */
.fo-featnav-item, .fo-row, .fo-graph, .fo-sec, .fo-ref, .fo-scope-head {
  animation: fo-rise 120ms var(--fo-ease) backwards;
  animation-delay: calc(var(--fo-i, 0) * 20ms);
}

/* ============ rail 三段：品牌 / 功能导航 / 底部固定区 ============ */
/* ============ rail（与 cove 一致：192/80 宽 · 48 头部 · 44 项 · 12 圆角） ============ */
.fo-rail {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  /* 拖动把手是绝对定位的，需要一个定位上下文 */
  position: relative;
  border-right: 1px solid color-mix(in oklab, ${T.label1} 5%, transparent);
  /* cove：深底 + 一层 5% 品牌色径向光晕 + 右侧投影 */
  background:
    radial-gradient(circle at 30% 20%, color-mix(in oklab, ${T.brand} 5%, transparent) 0%, transparent 70%),
    color-mix(in oklab, ${T.bgBase} 96%, transparent);
  box-shadow: 8px 0 32px -24px color-mix(in oklab, ${T.label1} 30%, transparent);
}
/* 右边缘拖动把手：6px 命中带，hover 时显一条品牌色细线（不占布局） */
.fo-rail-resizer {
  position: absolute; top: 0; right: -3px; bottom: 0; z-index: 6;
  width: 6px; cursor: col-resize; touch-action: none;
}
.fo-rail-resizer::after {
  content: ''; position: absolute; top: 0; right: 3px; bottom: 0; width: 1px;
  background: transparent; transition: background-color .16s var(--fo-ease);
}
.fo-rail-resizer:hover::after, .fo-rail-resizer:focus-visible::after {
  background: color-mix(in oklab, ${T.brand} 60%, transparent);
}
/* 头部 48px（cove h-12）：logo 28px，右侧 16px 内边距 */
.fo-brand {
  display: flex; align-items: center; gap: 12px;
  min-height: 48px; height: 48px; padding: 0 16px;
  border-bottom: 1px solid color-mix(in oklab, ${T.brand} 20%, transparent);
}
/* cove 的 logo 是 28px 裸标（无底板、无描边） */
.fo-brand-logo {
  flex: 0 0 28px; width: 28px; height: 28px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  color: ${T.brand};
  background: none; border: 0; padding: 0;
}
.fo-brand-mark { width: 28px; height: 28px; display: block; object-fit: contain; }
.fo-brand-text { display: flex; flex-direction: column; min-width: 0; gap: 0; }
.fo-brand-title { font-size: 14px; font-weight: 500; color: ${T.label1}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fo-brand-sub { font-size: 12px; color: ${T.label2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 导航容器：p-4 + gap-2 */
.fo-featnav {
  flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding: 16px;
  scrollbar-width: thin; scrollbar-color: var(--fo-glass-line-hover) transparent;
}
.fo-featnav::-webkit-scrollbar, .fo-subnav .fo-scope-body::-webkit-scrollbar { width: 6px; }
.fo-featnav::-webkit-scrollbar-thumb, .fo-subnav .fo-scope-body::-webkit-scrollbar-thumb {
  background: var(--fo-glass-line-hover); border-radius: 3px;
}
.fo-featnav::-webkit-scrollbar-track, .fo-subnav .fo-scope-body::-webkit-scrollbar-track { background: transparent; }
/* 一级项：px-4 py-3 rounded-xl gap-3 leading-5 font-medium */
.fo-featnav-item {
  display: flex; align-items: center; gap: 12px;
  width: 100%; min-width: 0; height: 44px; padding: 0 16px;
  border: 1px solid transparent; border-radius: 12px;
  background: transparent; color: ${T.label2}; font: inherit; font-size: 14px; font-weight: 500; text-align: left;
  cursor: pointer;
  transition: background-color var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease), color var(--fo-dur) var(--fo-ease);
}
.fo-featnav-item:hover {
  background: color-mix(in oklab, ${T.label1} 5%, transparent);
  border-color: transparent; color: ${T.label1};
}
/* 激活：bg-blue-600/30 + border-blue-500/50 + text-blue-300 */
.fo-featnav-item[data-active="1"] {
  background: color-mix(in oklab, ${T.brand} 30%, transparent);
  border-color: color-mix(in oklab, ${T.brand} 50%, transparent);
  color: color-mix(in oklab, ${T.brand} 60%, ${T.label1}); font-weight: 500;
}
/* 有二级菜单的一级项只是分组：当前页属于它时只留一层很轻的底，
   强选中态（品牌色胶囊）留给二级里真正打开的那一页。 */
.fo-featnav-item[data-expandable="1"][data-active="1"] {
  background: color-mix(in oklab, ${T.label1} 6%, transparent);
  border-color: transparent;
  color: ${T.label1};
}
.fo-nav-icon { flex: 0 0 20px; width: 20px; height: 20px; }
.fo-nav-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 底部固定区：cove 是 mt-auto + 上边框 + p-4 + gap-1 */
.fo-rail-foot {
  flex: 0 0 auto; display: flex; gap: 4px; padding: 16px;
  border-top: 1px solid color-mix(in oklab, ${T.label1} 10%, transparent);
}
.fo-rail-action {
  /* 靠左对齐（与一级项同一条起始线），用户口径：打开页面放左下 */
  display: flex; align-items: center; justify-content: flex-start; gap: 12px;
  flex: 1 1 0; min-width: 0; height: 44px; padding: 0 16px;
  border: 1px solid transparent; border-radius: 12px;
  background: transparent; color: ${T.label2};
  font: inherit; font-size: 14px; font-weight: 500; text-align: left; cursor: pointer;
  transition: background-color var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease), color var(--fo-dur) var(--fo-ease);
}
.fo-rail-action:hover {
  background: color-mix(in oklab, ${T.label1} 5%, transparent);
  border-color: transparent; color: ${T.label1};
}
.fo-root[data-rail="0"] .fo-rail-action {
  justify-content: center; padding: 0; flex: 0 0 auto;
  width: 100%; height: 44px; border-radius: 12px;
}
/* 两级菜单：cove NavGroup = mt-1 + bg-white/[0.03] + rounded-xl + py-1.5 + gap-2 */
.fo-featnav-group { display: flex; flex-direction: column; min-width: 0; }

/* 二级菜单（「看板」下面是范围树）：不再自带侧栏底色/描边与 blur —— 它就是 rail 的一部分。
   行更矮（30px）、字号 12px、左侧缩进 24px 起（一级项 padding 是 12px），长文案用省略号。 */
/* ============ 看板页范围树：cove 的「大包小」 ============
   cove 的二级菜单是这样：一个 mt-1 + bg-white/[0.03] + rounded-xl + py-1.5 + gap-2 的容器，
   里面每一项和一级项**完全同款**（px-4 py-3 rounded-xl gap-3 font-medium）。
   所以这里不再给「二级 30px / 三级 26px / 小字号 / 深缩进」这些特殊样式：
   行统一 44px、14px、px-4、gap-3、12 圆角；层级只由**容器一层层包住**来表达。 */
.fo-subnav {
  display: flex; flex-direction: column; min-width: 0;
  padding: 4px 0 0; gap: 2px;
}
.fo-subnav .fo-scope { border-right: 0; background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; }
.fo-subnav .fo-scope-head { padding: 2px 12px 4px; border-bottom: 0; }
/* 底部留 4px：外框用 ::before 的 -4px 画，滚动容器（overflow:auto）会把它裁掉。 */
.fo-subnav .fo-scope-body { padding: 0 0 4px; }
.fo-subnav .fo-scope-list { display: flex; flex-direction: column; gap: 8px; }
/* 二级菜单外面一层边缘：把「看板」下面这些 tab 框成一组，表示它们属于这个一级菜单。
   用绝对定位伪元素画框，不参与布局 —— 不挤占项目名宽度，也不改变行的左对齐。 */
.fo-subnav .fo-scope-list { position: relative; }
.fo-subnav .fo-scope-list::before {
  content: ''; position: absolute; inset: -4px 0; border-radius: 14px;
  border: 1px solid ${g(T.label1, 10)};
  background: ${g(T.label1, 2)};
  pointer-events: none;
}
.fo-subnav .fo-scope-list > * { position: relative; z-index: 1; }


/* 行 = 一级项的同一套取值（只是字号交给 CSS 变量，视觉上和 rail 一级项没有区别） */
.fo-subnav .fo-row {
  position: relative;
  /* 与一级项**完全相同**的取值（cove 的 subItem 与父项同款）：44 高 / px-4 / gap-3 /
     14px / 500 / 12 圆角。层级由外层容器给，不给行加任何特殊样式。 */
  height: 44px; padding: 0 16px; gap: 12px;
  border: 1px solid transparent; border-radius: 12px;
  font-size: 14px; font-weight: 500; color: ${T.label2};
  transition: background-color var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease), color var(--fo-dur) var(--fo-ease);
}
.fo-subnav .fo-row:hover {
  background: ${g(T.label1, 5)}; border-color: transparent; color: ${T.label1};
}
.fo-subnav .fo-row[aria-selected="true"] {
  background: ${g(T.brand, 30)};
  border-color: ${g(T.brand, 50)};
  color: ${g(T.brand, 60, T.label1)};
  font-weight: 500;
  box-shadow: none;
}
/* 目录行与项目行同款：层级由外层容器给，不给文字加粗/变灰这类额外区分 */
.fo-subnav .fo-row[data-kind="group"],
.fo-subnav .fo-row[data-kind="project"],
.fo-subnav .fo-row[data-kind="all"] {
  height: 44px; font-size: 14px; font-weight: 500; color: ${T.label2};
}
.fo-subnav .fo-row[aria-selected="true"]:is([data-kind="group"], [data-kind="project"], [data-kind="all"]) {
  color: ${g(T.brand, 60, T.label1)};
}

/* 嵌套容器：cove 的 mt-1 + bg-white/[0.03] + rounded-xl + py-1.5 + gap-2 */
.fo-row-group {
  /* cove：mt-1（4px）+ bg-white/[0.03] + rounded-xl + py-1.5（6px）+ flex-col gap-2（8px），
     容器自身**没有左右内边距** —— 里面的项用同款 px-4，所以和父项左缘对齐。 */
  display: flex; flex-direction: column; gap: 8px;
  margin: 4px 0 0; padding: 6px 0;
  border-radius: 12px;
  background: ${g(T.label1, 3)};
}
/* 第三层再包一层，观感与 second level 相同（cove 也是同一个 bg/圆角叠一层） */
/* 更深一层：再包一层同款容器、底色深一档 —— 归属关系全靠「外层包住内层」表达，
   不加缩进、不加竖线（缩进会吃掉项目名宽度，竖线又像缩进）。 */
.fo-row-group .fo-row-group {
  margin: 0; padding: 6px 0;
  background: ${g(T.label1, 5)};
}

.fo-subnav .fo-row-label {
  min-width: 0; flex: 1 1 auto; text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 色点 / 项目图标：14px，和一级项图标位对齐 */
/* 行首图标槽：**定宽 16px**，每一行都有图标（没配过 logo 的用默认图标）。
   定宽是关键 —— 宽度一样，标签才会全部落在同一条左对齐线上。 */
/* 20px = 一级项的图标槽宽（gap 也一样），这样二级/三级的文字与一级项**同一条左缘** */
.fo-subnav .fo-dot.is-logo {
  flex: 0 0 20px; width: 20px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--fo-c, ${T.label2});
  background: none; box-shadow: none;
}
.fo-subnav .fo-row[aria-selected="true"] .fo-dot.is-logo { color: ${T.brand}; }
/* 目录行的图标 = 展开/收起开关：单独一块命中区，hover 有反馈 */
.fo-subnav .fo-dot.is-toggle {
  cursor: pointer; border-radius: 6px;
  transition: background-color .12s var(--fo-ease), color .12s var(--fo-ease);
}
.fo-subnav .fo-dot.is-toggle:hover { background: ${g(T.label1, 10)}; color: ${T.label1}; }

/* 行尾「⋯」：绝对定位，hover / 选中 / 聚焦才显形（不占行的宽度） */
.fo-subnav .fo-row-menu {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 22px; height: 22px; min-width: 22px; padding: 0;
  border-radius: 7px; border: 0; background: ${T.bgLayer1};
  font-size: 13px; line-height: 1; color: ${T.label2};
  opacity: 0; transition: opacity .12s var(--fo-ease), background-color .12s var(--fo-ease);
}
.fo-subnav .fo-row:hover .fo-row-menu,
.fo-subnav .fo-row[aria-selected="true"] .fo-row-menu,
.fo-subnav .fo-row-menu:focus-visible { opacity: 1; }
.fo-subnav .fo-row-menu:hover { background: ${g(T.label1, 8)}; color: ${T.label1}; }

.fo-subnav .fo-scope-note { padding: 2px 12px 6px; font-size: 11px; color: ${g(T.label2, 70)}; }
/* 说明：折叠在品牌 logo 上，刷新在正文头部；底部固定区只留「在浏览器打开」。 */
/* rail 收起：只留 56px 图标条（按钮仍可点，能再展开） */
/* rail 收起：只留 52px 图标条。**caret 必须一起藏**——只藏文字、留着 ▾ 会让图标偏左，
   用户实测「折叠时图标没对齐」就是这么来的。 */
.fo-root[data-rail="0"] { --fo-rail-w: 80px; --fo-rail-item: 44px; }
/* 收起态：二级菜单（目录列）留在「看板」下面，做成图标列 —— 不是浮层，rail 宽度也不变。
   三级（项目）在收起态不展开：TreeNav 收到 railCollapsed 时直接不渲染项目行。 */
.fo-root[data-rail="0"] .fo-subnav { display: flex; padding: 4px 0 0; gap: 2px; }
.fo-root[data-rail="0"] .fo-subnav :is(.fo-scope-head, .fo-scope-note, .fo-row-label, .fo-row-menu, .fo-row-count) { display: none; }
.fo-root[data-rail="0"] .fo-subnav .fo-row {
  width: 44px; height: 44px; margin: 0 auto; padding: 0; gap: 0;
  display: flex; align-items: center; justify-content: center;
}
.fo-root[data-rail="0"] .fo-subnav .fo-scope-list,
.fo-root[data-rail="0"] .fo-subnav .fo-row-group { gap: 2px; }
.fo-root[data-rail="0"] .fo-subnav .fo-row-group {
  margin: 2px 0 0; padding: 0; background: transparent;
}
.fo-root[data-rail="0"] .fo-subnav .fo-dot.is-logo { flex: 0 0 20px; }
/* 收起态外框：顶边拉直（不做圆角），像从上面那个一级项挂下来的一列 */
.fo-root .fo-subnav .fo-scope-list::before { border-radius: 0 0 14px 14px; }
/* 外框的两条侧线接到一级项的外边框：去掉顶边那条横线，并把展开态一级项的
   底角拉平 —— 看起来就是「这一个 tab 下面挂着一列」。 */
.fo-root .fo-subnav .fo-scope-list::before { border-top-width: 0; }
.fo-root .fo-featnav-item[data-expandable="1"][data-expanded="1"] {
  border-bottom-left-radius: 0; border-bottom-right-radius: 0;
}


/* 收起态：logo 与下面的一级项**同尺寸正方形**（36×36 / 圆角 10），整条 rail 只留图标列 */
.fo-root[data-rail="0"] .fo-brand { justify-content: center; padding: 8px 0; }
/* 收起态 logo：必须显式改 flex-basis —— 基础规则里的 flex 是 0 0 40px，
   只改 width/height 的话 flex 仍按 40px 排版，于是 logo 比一级项宽 4px（用户看到的「大小不一致」）。 */
.fo-root[data-rail="0"] .fo-brand-logo { padding: 0; border-radius: 10px; }/* 收起态：文字与 caret 都隐藏（只藏文字会让图标偏左）；角标一并藏——36×36 方块里放不下数字。 */
.fo-root[data-rail="0"] .fo-brand-text,
.fo-root[data-rail="0"] .fo-nav-label { display: none; }
/* 收起态：一级项是 36×36 的正方形，与 logo 同尺寸 */
/* cove 收起态：项仍是整行宽、图标居中（80 - 2*16 = 48px 宽 × 44 高） */
.fo-root[data-rail="0"] .fo-featnav-item {
  justify-content: center; padding: 0; gap: 0;
  width: 100%; height: var(--fo-rail-item); margin: 0; border-radius: 12px;
}
/* 收起态：图标本身严格居中（不靠子元素宽度凑），并禁掉 caret 的旋转占位 */
.fo-root[data-rail="0"] .fo-featnav-item > svg,
.fo-root[data-rail="0"] .fo-featnav-item > .fo-nav-icon { margin: 0 auto; flex: 0 0 auto; }
.fo-root[data-rail="0"] .fo-featnav-item[data-active="1"]::before { left: 4px; }
.fo-root[data-rail="0"] .fo-rail-foot { flex-direction: column; justify-content: center; gap: 6px; padding: 8px 0; }

/* ============ 项目图标选择器（纯本地展示配置） ============ */
.fo-logo-backdrop {
  position: fixed; inset: 0; z-index: 61;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in oklab, var(--dsw-alias-bg-base) 55%, transparent);
  backdrop-filter: blur(2px);
}
.fo-logo-pop {
  width: min(420px, calc(100vw - 48px));
  padding: 16px; border-radius: 16px;
  background: color-mix(in oklab, var(--dsw-alias-bg-overlay) 96%, transparent);
  border: 1px solid var(--fo-glass-line);
  box-shadow: 0 24px 48px color-mix(in oklab, var(--dsw-alias-bg-base) 60%, transparent);
  display: flex; flex-direction: column; gap: 12px;
}
.fo-logo-head { display: flex; align-items: baseline; gap: 8px; }
.fo-logo-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.fo-logo-build { margin-left: auto; font-size: 10px; font-family: ui-monospace, Menlo, monospace; color: color-mix(in oklab, var(--dsw-alias-label-secondary) 70%, transparent); }
.fo-logo-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-logo-search { display: flex; flex-direction: column; gap: 8px; }
.fo-logo-input {
  width: 100%; height: 34px; padding: 0 10px; border-radius: 9px; font: inherit; font-size: 12px;
  color: var(--dsw-alias-label-primary);
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 70%, transparent);
  border: 1px solid var(--fo-glass-line);
}
.fo-logo-input::placeholder { color: var(--dsw-alias-label-secondary); }
.fo-logo-tabs { display: flex; gap: 6px; }
.fo-logo-tab {
  padding: 4px 10px; border-radius: 8px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); background: transparent;
  border: 1px solid var(--fo-glass-line);
}
.fo-logo-tab[data-active="1"] {
  color: var(--dsw-alias-label-primary);
  background: color-mix(in oklab, var(--dsw-alias-brand-primary) 20%, transparent);
  border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 45%, transparent);
}
.fo-logo-section { display: flex; flex-direction: column; gap: 6px; }
.fo-logo-section-title { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
.fo-logo-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
.fo-logo-grid-scroll { max-height: 210px; overflow-y: auto; padding-right: 4px; }
.fo-logo-grid-scroll::-webkit-scrollbar { width: 6px; }
.fo-logo-grid-scroll::-webkit-scrollbar-thumb { background: color-mix(in oklab, var(--dsw-alias-label-secondary) 30%, transparent); border-radius: 999px; }
.fo-logo-emoji-scroll { max-height: 230px; overflow-y: auto; gap: 10px; }
.fo-logo-emoji-group { display: flex; flex-direction: column; gap: 4px; }
.fo-logo-emoji-grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
.fo-logo-emoji-cell {
  height: 30px; border-radius: 8px; font-size: 17px; line-height: 1; cursor: pointer;
  background: transparent; border: 1px solid transparent;
}
.fo-logo-emoji-cell:hover { background: color-mix(in oklab, var(--dsw-alias-brand-primary) 16%, transparent); border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 40%, transparent); }
.fo-logo-cell {
  display: flex; align-items: center; justify-content: center;
  height: 40px; border-radius: 10px; cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 60%, transparent);
  border: 1px solid transparent;
  transition: background-color var(--fo-dur) var(--fo-ease), color var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease);
}
.fo-logo-cell:hover {
  color: var(--dsw-alias-label-primary);
  background: color-mix(in oklab, var(--dsw-alias-brand-primary) 18%, transparent);
  border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 45%, transparent);
}
.fo-logo-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

/* ============ 全局 Header：逐条对齐 cove TopBar ============
   h-12 · px-6 · bg-white/[0.03] · backdrop-blur-xl backdrop-saturate-150 ·
   shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] · 横向渐变蒙层（blue→purple 各 2%）。
   与左上品牌栏共用 --fo-appbar-h，两边同为 48 且同底色，视觉上是一条完整的顶栏。 */
.fo-main-head {
  position: relative;
  display: flex; align-items: center; gap: 16px; flex-wrap: nowrap;
  height: var(--fo-appbar-h); min-height: var(--fo-appbar-h);
  padding: 0 24px;
  border-bottom: 0;
  background: ${g(T.label1, 3)};
  backdrop-filter: blur(24px) saturate(1.5);
  -webkit-backdrop-filter: blur(24px) saturate(1.5);
  box-shadow: inset 0 1px 0 0 ${g(T.label1, 4)};
}
.fo-main-head::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(to right, ${g(T.brand, 2)}, transparent 50%, ${g(T.brand, 2)});
}
.fo-main-head > * { position: relative; }

/* 搜索：cove 是「42px 圆形图标 → 点开变 320px 胶囊」
   （collapsed: hover:bg-white/5；open: w-80 bg-white/5 border-white/10 rounded-xl） */
.fo-search-wrap {
  position: relative; display: flex; align-items: center;
  flex: 0 1 auto; min-width: 0; height: 42px;
  width: 42px; border-radius: 12px; overflow: hidden;
  background: transparent; border: 1px solid transparent;
  transition: width .2s ease, background-color .2s ease, border-color .2s ease;
}
.fo-search-wrap:hover { background: ${g(T.label1, 5)}; }
.fo-search-wrap[data-open="1"] {
  width: 320px; max-width: 100%;
  background: ${g(T.label1, 5)};
  border-color: ${g(T.label1, 10)};
}
.fo-search-toggle {
  flex: 0 0 42px; width: 42px; height: 42px;
  display: inline-flex; align-items: center; justify-content: center;
  background: none; border: 0; cursor: pointer;
  color: ${T.label2}; transition: color .2s ease;
}
.fo-search-toggle:hover { color: ${T.label1}; }
.fo-search {
  flex: 1 1 auto; min-width: 0; height: 100%; padding: 8px 16px 8px 0;
  border: 0; border-radius: 0; font: inherit; font-size: 14px;
  color: ${T.label1}; background: transparent;
}
.fo-search::placeholder { color: ${T.label2}; }
.fo-search:focus-visible { outline: none; }
.fo-search-hint { flex: 0 0 auto; padding-right: 12px; font-size: 11px; color: ${T.label2}; white-space: nowrap; }

/* 搜索结果浮层（cove 的 Popover 观感：玻璃卡片 + 圆角 12） */
.fo-search-pop {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 40;
  max-height: 320px; overflow: auto; padding: 6px;
  border-radius: 12px; border: 1px solid var(--fo-glass-line);
  background: var(--fo-glass-card); box-shadow: var(--fo-glass-shadow);
  backdrop-filter: var(--fo-glass-blur); -webkit-backdrop-filter: var(--fo-glass-blur);
}
.fo-search-pop-empty { padding: 10px; font-size: 12px; color: ${T.label2}; }
.fo-search-hit {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px; border-radius: 8px; border: 0; background: none;
  font: inherit; font-size: 12px; text-align: left; color: ${T.label1}; cursor: pointer;
}
.fo-search-hit:hover, .fo-search-hit[data-active="1"] { background: ${g(T.brand, 14)}; }
.fo-search-hit-no { flex: 0 0 auto; font-size: 10px; color: ${T.label2}; font-variant-numeric: tabular-nums; }
.fo-search-hit-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 提示条（role=status）：动作没做成时给一句人话，别静默。与 role=alert 的错误条分开。 */
.fo-note {
  display: flex; align-items: center; gap: 8px;
  margin: 10px 10px 0; padding: 8px 12px;
  border-radius: 10px; font-size: 12px;
  color: ${T.label1};
  background: var(--fo-glass-sub);
  border: 1px solid var(--fo-glass-line);
}
.fo-note .fo-btn { margin-left: auto; }

/* ============ 按钮 ============ */
.fo-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 26px; padding: 0 10px; border-radius: 8px;
  font: inherit; font-size: 12px;
  color: ${T.label1};
  background: var(--fo-glass-sub);
  border: 1px solid var(--fo-glass-line);
  cursor: pointer;
  white-space: nowrap;
  transition: transform var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease), background-color var(--fo-dur) var(--fo-ease);
}
.fo-btn:hover:not(:disabled) { border-color: var(--fo-glass-line-hover); transform: translateY(-1px); }
.fo-btn:disabled { opacity: .5; cursor: default; }
/* 主按钮：**品牌色向底色靠一档当底 + label-primary 当字**。
   用户报「一键整理按钮，文字颜色看不到」，量出来是原方案（实心品牌底 + bgBase 文字）在
   **浅色主题**只有 ~3.5:1：因为 bgBase 在浅色主题是近白、在暗色主题是近黑，而品牌蓝在两个主题里
   都是偏亮的中间色，于是「深色字」在浅色主题才该用 —— 但单个令牌做不到跨主题都深/都浅。
   现在：底色 = brand 62% + bg-base 38%，文字 = label-primary，实测
   暗色 6.85:1、浅色 4.33:1（原方案 4.97 / 3.51），两个主题都过 AA 大字号线。 */
.fo-btn[data-variant="primary"] {
  background: color-mix(in oklab, ${T.brand} 62%, ${T.bgBase});
  border-color: color-mix(in oklab, ${T.brand} 78%, ${T.bgBase});
  color: ${T.label1};
}
.fo-btn[data-variant="primary"]:hover:not(:disabled) {
  background: color-mix(in oklab, ${T.brand} 74%, ${T.bgBase});
}
.fo-btn[data-variant="ghost"] { background: transparent; border-color: transparent; color: ${T.label2}; }
.fo-btn[data-variant="ghost"]:hover:not(:disabled) { background: var(--fo-glass-sub); color: ${T.label1}; border-color: var(--fo-glass-line); }
.fo-btn[data-size="sm"] { height: 22px; padding: 0 8px; font-size: 11px; }

/* ============ 主体三栏 ============ */
/* 正文区：功能页 | 详情（rail 由根栅格的第一列承担） */

/* 搜索：全局常驻；命中列表用浮层（运行/洞察页不过滤页面数据） */
.fo-search-wrap { position: relative; }
.fo-search-pop {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 40;
  max-height: 320px; overflow: auto; padding: 6px;
  border-radius: 12px; border: 1px solid var(--fo-glass-line);
  background: var(--fo-glass-card); box-shadow: var(--fo-glass-shadow);
  backdrop-filter: var(--fo-glass-blur); -webkit-backdrop-filter: var(--fo-glass-blur);
}
.fo-search-pop-empty { padding: 10px; font-size: 12px; color: ${T.label2}; }
.fo-search-hit {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px; border-radius: 8px; border: 0; background: none;
  font: inherit; font-size: 12px; text-align: left; color: ${T.label1}; cursor: pointer;
}
.fo-search-hit:hover, .fo-search-hit[data-active="1"] { background: color-mix(in oklab, ${T.brand} 14%, transparent); }
.fo-search-hit-no { flex: 0 0 auto; font-size: 10px; color: ${T.label2}; font-variant-numeric: tabular-nums; }
.fo-search-hit-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 建议栏：宽屏常驻（占一列），窄面板自动变悬浮；data-dock 可强制 */
.fo-root[data-organize="1"] .fo-body { grid-template-columns: minmax(0, 1fr) var(--fo-dock-w); }
@container fopanel (max-width: 1100px) {
  .fo-root[data-organize="1"] .fo-body { grid-template-columns: minmax(0, 1fr); }
  .fo-organize {
    position: absolute; top: 0; right: 0; bottom: 0; z-index: 30;
    width: var(--fo-dock-w); max-width: 86%;
    border-radius: 12px 0 0 12px;
    box-shadow: var(--fo-glass-shadow);
  }
}
/* 手动钉住：dock=1 永远占列，dock=0 永远悬浮 */
/* 必须同时 data-organize="1"：面板关闭后不能还占着一列（否则关闭后右侧一大片空白）。 */
.fo-root[data-organize="1"][data-organize-dock="1"] .fo-body { grid-template-columns: minmax(0, 1fr) var(--fo-dock-w) !important; }
.fo-root[data-organize-dock="1"] .fo-organize {
  position: relative !important; width: auto; max-width: none; border-radius: 0; box-shadow: none;
}
/* 左缘拖拽把手：拖动调建议栏宽度 */
.fo-org-resize {
  position: absolute; top: 0; bottom: 0; left: 0; z-index: 6;
  width: 6px; cursor: col-resize; touch-action: none;
  background: transparent; transition: background-color .15s ease;
}
.fo-org-resize:hover, .fo-org-resize:active { background: ${g(T.brand, 26)}; }
.fo-root[data-organize="1"][data-organize-dock="0"] .fo-body { grid-template-columns: minmax(0, 1fr) !important; }
.fo-root[data-organize-dock="0"] .fo-organize {
  position: absolute; top: 0; right: 0; bottom: 0; z-index: 30;
  width: var(--fo-dock-w); max-width: 86%;
  border-radius: 12px 0 0 12px;
  box-shadow: var(--fo-glass-shadow);
}
.fo-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
  height: 100%;
  /* 建议栏在窄面板里是悬浮的，需要一个定位上下文 */
  position: relative;
}
.fo-root[data-detail="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(260px, 30%, 336px); }
/* 一键整理抽屉：正文右边的玻璃抽屉；与详情同时开时是第三列（正文 | 详情 | 建议） */
.fo-root[data-detail="1"][data-organize="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(240px, 26%, 336px) clamp(240px, 26%, 340px); }
/* 视口不够时先压详情栏；rail 只在很窄时才收（288 是参考站口径） */
@container fopanel (max-width: 1180px) {
  .fo-root[data-detail="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(240px, 30%, 300px); }
  .fo-root[data-organize="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(240px, 30%, 320px); }
  .fo-root[data-detail="1"][data-organize="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(220px, 25%, 300px) clamp(220px, 25%, 320px); }
}
@container fopanel (max-width: 1040px) {
  .fo-root:not([data-rail="0"]) { --fo-rail-w: 212px; }
  .fo-root[data-detail="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(230px, 30%, 288px); }
}
@container fopanel (max-width: 960px) {
  .fo-root:not([data-rail="0"]) { --fo-rail-w: 196px; }
  .fo-root[data-detail="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(220px, 30%, 264px); }
}

/* ============ 功能页内的范围列（三层树，task-14 从 rail 搬进来） ============ */
.fo-scope {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  border-right: 1px solid var(--fo-rail-line);
  /* 参考站 aside 是「极深蓝黑 80% + blur(40px)」。这里用宿主的 sidebar-fill（「宿主侧栏底」的令牌）
     铺同一层 80% 半透明底，模糊取 24px（性能与 40 取中） */
  background: color-mix(in oklab, ${T.sidebar} 80%, transparent);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}
/* rail 顶部：搜索框（对齐参考站 "Search everything..." 的位置） */
.fo-scope-head {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 16px 12px; border-bottom: 1px solid var(--fo-glass-line);
}
.fo-scope-title { font-size: 11px; font-weight: 600; color: ${T.label2}; letter-spacing: .06em; text-transform: uppercase; }
.fo-scope-head .fo-btn { margin-left: auto; }
.fo-scope-body { flex: 1; min-height: 0; overflow: auto; padding: 8px 16px 16px; }
.fo-scope-list { display: flex; flex-direction: column; gap: 4px; }
.fo-row {
  display: flex; align-items: center; gap: 10px;
  width: 100%; min-width: 0; height: 40px; padding: 0 12px;
  border: 1px solid transparent; border-radius: 12px;
  background: transparent; color: ${T.label2}; font: inherit; font-size: 13px; text-align: left;
  cursor: pointer;
  transition: transform var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease), background-color var(--fo-dur) var(--fo-ease), color var(--fo-dur) var(--fo-ease);
}
.fo-row:hover { background: var(--fo-row-hover-bg); border-color: var(--fo-glass-line); color: ${T.label1}; }
.fo-row[aria-selected="true"] {
  background: var(--fo-selected-bg);
  border-color: var(--fo-selected-line);
  color: ${T.brand}; font-weight: 500;
  box-shadow: inset 2px 0 0 ${T.brand};
}
.fo-row.is-drop { border-color: ${T.brand}; background: ${g(T.brand, 20)}; }
.fo-row.is-drag { opacity: .45; }
/* 色点：项目行的分色槽（--fo-c 由组件给），根行是品牌色，目录行中性 */
.fo-dot {
  flex: 0 0 8px; width: 8px; height: 8px; border-radius: 999px;
  background: var(--fo-c, ${T.idle});
  box-shadow: 0 0 0 3px ${g(T.label1, 6)};
}
.fo-dot.is-logo { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; background: none; border: 0; }
/* 计数：行尾数字（定宽；hover 时淡出，把位置让给「⋯」） */
.fo-row-count {
  flex: 0 0 auto; min-width: 16px; text-align: right;
  font-size: 11px; font-weight: 500; color: ${T.label2};
  font-variant-numeric: tabular-nums;
}
.fo-row { position: relative; }
/* 行尾的「⋯」用绝对定位，不占行宽（rail 只有 232px，20px 就是两个汉字）；
   悬停时它淡入、计数淡出，两者不打架。 */
.fo-row-menu {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  opacity: 0; transition: opacity var(--fo-dur) var(--fo-ease);
}
.fo-row:hover .fo-row-menu,
.fo-row:focus-within .fo-row-menu { opacity: 1; }
.fo-scope-note { padding: 1px 8px 3px 34px; font-size: 11px; color: ${T.label2}; }
.fo-input {
  height: 26px; min-width: 0; width: 100%;
  padding: 0 8px; border-radius: 8px;
  font: inherit; font-size: 12px;
  color: ${T.label1}; background: ${T.bgBase};
  border: 1px solid ${T.brand};
}
.fo-create-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 28px; }
.fo-create-row .fo-input { width: auto; flex: 1; }

/* ============ 右键菜单（玻璃浮层） ============ */
.fo-menu {
  position: fixed; z-index: 60;
  min-width: 184px; padding: 6px;
  border-radius: 10px;
  background: color-mix(in oklab, ${T.bgOverlay} 94%, transparent);
  backdrop-filter: var(--fo-glass-blur);
  -webkit-backdrop-filter: var(--fo-glass-blur);
  border: 1px solid var(--fo-glass-line);
  box-shadow: var(--fo-glass-shadow);
}
.fo-menu-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; height: 26px; padding: 0 8px;
  border: 0; border-radius: 8px; background: transparent;
  color: ${T.label1}; font: inherit; font-size: 12px; text-align: left;
  cursor: pointer;
  transition: background-color var(--fo-dur) var(--fo-ease);
}
.fo-menu-item:hover:not(:disabled), .fo-menu-item[data-open="1"] { background: var(--fo-selected-bg); }
.fo-menu-item:disabled { opacity: .45; cursor: default; }
.fo-menu-item[data-danger="1"] { color: ${T.error}; }
.fo-menu-check { width: 12px; flex: 0 0 12px; color: ${T.brand}; }
.fo-menu-more { margin-left: auto; font-size: 10px; color: ${T.label2}; }
.fo-menu-sep { height: 1px; margin: 4px 6px; background: var(--fo-glass-line); }
.fo-menu-sub { position: fixed; z-index: 61; }

/* ============ 中栏：功能页骨架（骨架不认识具体功能） ============ */
.fo-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: ${T.bgBase}; }
.fo-feature-host { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.fo-feature { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
/* 旧版顶部工具条（.fo-feature-bar）与画布浮动卡片（.fo-canvas-card）都已删：
   全局「建议」在 rail 底部固定区，逐图工具在每张卡片的 header（.fo-graph-actions）。 */
.fo-feature-body { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
/* task-17：范围树搬进 rail 之后，功能页只剩画布一块主内容（单列，画布拿全部宽度）。 */
.fo-canvas-area {
  position: relative;
  flex: 1 1 auto; min-width: 0; min-height: 0;
  overflow: hidden;
  padding: 10px; display: flex; flex-direction: column;
}
/* 画布舞台：图列表（每张卡片自己是独立的玻璃卡）。 */
.fo-canvas-stage {
  position: relative;
  flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column;
}

/* ============ 卡片头部工具（.fo-graph-head 右侧） ============
   用户口径：「右上的按钮应该在卡片的 header 里而不是悬浮」——没有浮层，工具就长在卡片头上。
   视觉沿用 adventure WorkflowEditor 的分段控件口径：深底 + 细边 + 大圆角；
   「建议」已迁到 rail 底部固定区（全局）。 */
.fo-zoom-group {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 3px; border-radius: 10px;
  background: ${g(T.bgBase, 45)};
  border: 1px solid ${g(T.border1, 26)};
}
.fo-zoom-value {
  height: 26px; min-width: 44px; padding: 0 4px;
  font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: center;
  color: ${T.label2}; background: none; border: 0; border-radius: 8px;
  cursor: pointer;
}
.fo-zoom-value:hover { color: ${T.label1}; background: ${g(T.label1, 6)}; }
.fo-zoom-value:disabled { cursor: default; opacity: .45; }
.fo-banner {
  display: flex; align-items: center; gap: 8px;
  margin: 10px 10px 0; padding: 12px 16px;
  border-radius: 10px; font-size: 12px;
  color: ${T.error};
  background: ${g(T.error, 12)};
  border: 1px solid ${g(T.error, 30)};
}
.fo-banner .fo-btn { margin-left: auto; }

/* 画布列表：整个功能页的滚动容器。每张图按内容高度排下去，不再用 flex 均分把画布压扁。 */
.fo-graphs { display: flex; flex-direction: column; gap: 12px; flex: 1 1 auto; min-height: 0; overflow: auto; }
/* 一张图 = 一块画布容器：16px 圆角 + border-l1 35% 描边 + 品牌调渐变底。
   task-18：画布高度**跟随内容**（紧凑打包后每张图 300~900px），不再把 5 张图平均压成
   220px 的迷你窗口再各自内部滚动 —— 那会裁掉卡片，正是「关系图全是散点」的观感来源。 */
.fo-graph {
  flex: 0 0 auto; min-height: 0;
  display: flex; flex-direction: column;
  border: 1px solid var(--fo-canvas-line); border-radius: 16px;
  background: var(--fo-canvas-bg);
  overflow: hidden;
  transition: border-color var(--fo-dur) var(--fo-ease);
}
.fo-graph:hover { border-color: var(--fo-glass-line-hover); }
/* 只显示一张图时（用户点进某个目录）让它填满功能页：卡片本身就是一块 100% 高的画布，
   图内容在画布里垂直居中；多张图时仍各自按内容高度排列。 */
.fo-graph.is-solo { flex: 1 0 auto; }
.fo-graph.is-solo .fo-canvas { flex: 1 0 auto; justify-content: center; }
.fo-graph-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 12px 16px; border-bottom: 1px solid var(--fo-glass-line);
}
/* 边的图例（前置 / 来源 / 时间）：细线段 + 名称 + 数量，样式与画布上的线一一对应
   （实线 / 虚线 / 点线）。少了它，接受建议后「多了几条点线」很容易被当成没变化。 */
.fo-edge-legend { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
.fo-edge-item { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: ${T.label2}; }
/* 图例线与画布线同一套：实线、同色（只有颜色区分类别） */
.fo-edge-swatch { width: 16px; height: 0; border-top: 2.5px solid ${T.brand}; flex: 0 0 16px; opacity: .8; }
.fo-edge-swatch[data-kind="derived_from"] { border-top-color: ${T.idle}; }
.fo-edge-swatch[data-kind="temporal"] { border-top-color: ${T.idle}; }
.fo-edge-count { font-variant-numeric: tabular-nums; }
.fo-edge-empty { font-size: 11px; color: ${T.label2}; }
/* 图例：没有泳道后，这是「哪个颜色 = 哪个项目」的唯一标识 */
.fo-graph-legend { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.fo-legend-item {
  display: inline-flex; align-items: center; gap: 5px; min-width: 0;
  font-size: 11px; color: ${T.label2};
}
.fo-legend-dot {
  width: 8px; height: 8px; border-radius: 50%; flex: 0 0 8px;
  background: var(--fo-c, ${T.brand});
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--fo-c, ${T.brand}) 20%, transparent);
}
.fo-legend-label { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 图头右侧只剩**动作**；计数胶囊已删（同一份数在树上与节点上各有一份，离对象最近的那处胜出）。 */
.fo-graph-actions {
  display: flex; align-items: center; gap: 4px; margin-left: auto;
  flex-wrap: wrap; justify-content: flex-end; min-width: 0;
}
.fo-graph-actions .fo-btn {
  height: 26px; padding: 0 10px; border-radius: 8px;
  font-size: 11px; font-weight: 700; letter-spacing: .02em;
}
.fo-graph-actions .fo-btn[data-action="toggle-done"][aria-pressed="true"] { color: ${T.label1}; }
/* 图标按钮：26×26 方形，文字只在 title / aria-label 里（图头因此永远收得进一行） */
.fo-graph-actions .fo-btn[data-icon="1"] { width: 26px; min-width: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.fo-graph-actions .fo-btn[data-icon="1"] .fo-btn-icon { width: 14px; height: 14px; }
/* 窄面板：先让位给「名字 + 动作」，图例最后才上（信息密度优先给操作） */
@container fopanel (max-width: 900px) {
  .fo-graph-legend { display: none; }
  .fo-edge-legend { display: none; }
  .fo-graph-head { gap: 6px; }
}
@container fopanel (max-width: 700px) {
  .fo-graph-actions .fo-btn[data-action="toggle-done"] { max-width: 84px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fo-graph-head { padding: 8px 10px; }
}

/* 画布区：高度由内容撑开 + 24px 内边距；40px 双层网格铺满整块画布（不拦点击）。
   空白处按下拖动 = 平移（grab / grabbing 给手感）；Ctrl / ⌘ + 滚轮 = 以光标为锚点缩放，
   普通滚轮留给页面（否则多张图时滚不到下一张）。 */
.fo-canvas {
  position: relative; display: flex; flex-direction: column;
  flex: 0 0 auto; min-height: 0; width: 100%;
  padding: 24px;
  cursor: grab;
  touch-action: none;
  overscroll-behavior: contain;
}
.fo-canvas.is-panning { cursor: grabbing; }
.fo-viewport { transform-origin: 0 0; }
.fo-grid {
  position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;
  background-image:
    linear-gradient(to right, var(--fo-grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--fo-grid-line) 1px, transparent 1px);
  background-size: var(--fo-grid-size) var(--fo-grid-size);
}
/* 画布高度由 SVG 自身撑开（不再 100% / 不再内部纵向滚动）。
   SVG 的 CSS 宽度按容器收窄、高度按比例跟随；因此不会出现横向滚动条。 */
.fo-graph-body { position: relative; flex: 0 0 auto; width: 100%; display: flex; justify-content: center; overflow: hidden; margin: 0 auto; }
/* 画布舞台：SVG（边）和 HTML 卡片都按 layout 1:1 排在这里，再由这个容器整体缩放。 */
.fo-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.fo-cards-layer { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; }
.fo-cards-layer .fo-node { position: absolute; pointer-events: auto; }
/* 1:1 画布：SVG 用 layout 尺寸（不再 100% 拉伸），视口靠 viewport transform 平移/缩放。
   overflow: visible 很关键：放大到 >100% 时内容会超出 layout 视口，不能让 SVG 自己的边界
   把卡片从中间裁掉（用户实测「放大后右边一半没了」）。裁剪交给外层 .fo-graph-body。 */
.fo-svg { position: relative; left: auto; top: auto; width: auto; height: auto; display: block; overflow: visible; }
.fo-edge {
  fill: none; stroke: ${T.brand};
  stroke-width: 2.5; stroke-opacity: .7; stroke-linecap: round; stroke-linejoin: round;
  pointer-events: stroke;
  transition: stroke-width var(--fo-dur) var(--fo-ease), stroke-opacity var(--fo-dur) var(--fo-ease), stroke var(--fo-dur) var(--fo-ease);
}
.fo-edge[data-kind="derived_from"] { stroke: ${T.idle}; stroke-dasharray: none; }
.fo-edge[data-kind="temporal"] { stroke: ${T.idle}; stroke-dasharray: none; stroke-opacity: .6; }
.fo-edge:hover, .fo-edge.is-active { stroke-width: 3.5; stroke-opacity: 1; }
.fo-edge.is-active { stroke: ${T.brand}; }
.fo-arrow { fill: ${T.brand}; fill-opacity: .8; }
.fo-arrow[data-kind="derived_from"] { fill: ${T.idle}; }
.fo-arrow[data-kind="temporal"] { fill: ${T.idle}; fill-opacity: .6; }
/* ============ 画布节点 = workflow 式三段卡片（task-15） ============
   参考站 WorkflowEditor 的节点口径：rounded-xl + border-2 + shadow-xl + 玻璃底 +「左动作列 | 中信息 |
   右状态」。这里全落在 SVG 上：卡片 = rect（rx 12 / stroke 2），各段坐标由 layout.cardGeometry 给。
   状态色走 --fo-s（卡片描边 / 编号 eyebrow / 状态胶囊三者同色），项目分色仍走 --fo-c（左侧色条）。 */
/* ============ 节点卡片：与面板里的飞书任务卡同一套设计 ============
   口径照抄 panel.html 的 task 卡：1px 描边、9px 圆角、7/10 内边距、12.5px 标题、
   18px 徽标（radius 5）、会话胶囊（16 高、全圆角、10px 字）。 */
.fo-node { cursor: grab; transition: opacity var(--fo-dur) var(--fo-ease); }
.fo-node:active { cursor: grabbing; }
/* 拖动中：节点位置改走 <g> 的 transform（见 GraphView），拖动时把节点提升成独立合成层（will-change），
   并去掉阴影/过渡/filter —— foreignObject 里的 box-shadow / drop-shadow 在 Chromium 里会留下一层「残影」。 */
.fo-node.is-dragging { filter: none; transition: none; will-change: transform; }
.fo-node.is-dragging .fo-node-dom { outline: none; box-shadow: none; }
.fo-node.is-dragging .fo-node-dom * { box-shadow: none; transition: none; }


/* ============ 节点卡片：foreignObject 里的面板卡 ============
   卡片本体（描边/圆角/间距）由 src/card/taskCardStyles.js 提供；这里只画「画布这一层」的
   状态：悬停、选中、阻塞/挂起提示、ghost 虚线框、聚焦降透明度。 */
.fo-node-dom {
  width: 100%; height: 100%; border-radius: 12px; overflow: hidden; overflow: clip; box-sizing: border-box;
  /* 共享卡片（.tc-scope）在画布上的令牌映射：宿主主题一变，卡片跟着变，不另造调色板。 */
  --tc-bg: var(--dsw-alias-bg-base);
  --tc-card: var(--dsw-alias-bg-layer-1);
  --tc-text: var(--dsw-alias-label-primary);
  --tc-text-2: var(--dsw-alias-label-secondary);
  --tc-text-3: var(--dsw-alias-label-secondary);
  /* 注意：--tc-sub 在卡片里当“浅色底”用（chip 背景），不能直接映射成文字色，
     否则就是浅灰字压浅灰底——整排 chip 看起来像占位条。 */
  /* 与面板同一个语义：面板的 sub 就是宿主 bg-layer-2。 */
  --tc-sub: var(--dsw-alias-bg-layer-2);
  --tc-line: var(--dsw-alias-border-l1);
  --tc-line-hover: var(--dsw-alias-border-l2);
  --tc-shadow: 0 1px 2px color-mix(in oklab, var(--dsw-alias-label-primary) 7%, transparent);
  --tc-select: color-mix(in oklab, var(--dsw-alias-brand-primary) 8%, transparent);
  --tc-accent: var(--dsw-alias-brand-primary);
  --tc-accent-text: var(--dsw-alias-brand-primary);
  --tc-accent-weak: color-mix(in oklab, var(--dsw-alias-brand-primary) 14%, transparent);
  --tc-accent-line: color-mix(in oklab, var(--dsw-alias-brand-primary) 32%, transparent);
  --tc-ok: var(--dsw-alias-state-success-primary);
  --tc-ok-weak: color-mix(in oklab, var(--dsw-alias-state-success-primary) 14%, transparent);
  --tc-ok-line: color-mix(in oklab, var(--dsw-alias-state-success-primary) 32%, transparent);
  --tc-warn: var(--dsw-alias-state-warn-primary);
  --tc-warn-weak: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 14%, transparent);
  --tc-warn-line: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 32%, transparent);
  --tc-danger: var(--dsw-alias-state-error-primary);
  --tc-danger-weak: color-mix(in oklab, var(--dsw-alias-state-error-primary) 14%, transparent);
  --tc-danger-line: color-mix(in oklab, var(--dsw-alias-state-error-primary) 32%, transparent);
}
.fo-menu-scope {
  --tc-bg: var(--dsw-alias-bg-base);
  --tc-card: var(--dsw-alias-bg-layer-1);
  --tc-text: var(--dsw-alias-label-primary);
  --tc-text-1: var(--dsw-alias-label-primary);
  --tc-text-2: var(--dsw-alias-label-secondary);
  --tc-text-3: var(--dsw-alias-label-secondary);
  --tc-sub: var(--dsw-alias-bg-layer-2);
  --tc-line: var(--dsw-alias-border-l1);
  --tc-line-hover: var(--dsw-alias-border-l2);
  --tc-shadow: 0 1px 2px color-mix(in oklab, var(--dsw-alias-label-primary) 7%, transparent);
  --tc-select: color-mix(in oklab, var(--dsw-alias-brand-primary) 8%, transparent);
  --tc-accent: var(--dsw-alias-brand-primary);
  --tc-accent-text: var(--dsw-alias-brand-primary);
  --tc-accent-weak: color-mix(in oklab, var(--dsw-alias-brand-primary) 14%, transparent);
  --tc-accent-line: color-mix(in oklab, var(--dsw-alias-brand-primary) 32%, transparent);
  --tc-ok: var(--dsw-alias-state-success-primary);
  --tc-ok-weak: color-mix(in oklab, var(--dsw-alias-state-success-primary) 14%, transparent);
  --tc-ok-line: color-mix(in oklab, var(--dsw-alias-state-success-primary) 32%, transparent);
  --tc-warn: var(--dsw-alias-state-warn-primary);
  --tc-warn-weak: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 14%, transparent);
  --tc-warn-line: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 32%, transparent);
  --tc-danger: var(--dsw-alias-state-error-primary);
  --tc-danger-weak: color-mix(in oklab, var(--dsw-alias-state-error-primary) 14%, transparent);
  --tc-danger-line: color-mix(in oklab, var(--dsw-alias-state-error-primary) 32%, transparent);
}
.fo-node-dom > * { height: 100%; box-sizing: border-box; }
.fo-node:hover .fo-node-dom { box-shadow: inset 0 0 0 1px ${g(T.label1, 18)}; }
/* 选中态不要用 SVG filter：foreignObject 上的 drop-shadow 在 Chromium 合成层里会留下竖条纹残影。
   改成卡片的 box-shadow（在 foreignObject 内部，安全）。 */
.fo-node.is-selected { filter: none; }
.fo-node.is-selected .fo-node-dom {
  box-shadow: inset 0 0 0 1px ${T.brand}, 0 0 10px ${g(T.brand, 35)};
}
/* 状态只给一个安静的提示：阻塞/挂起时描边带一点状态色，扫一眼画布就能找到卡住的那几张 */
.fo-node[data-state="blocked"] .fo-node-dom { box-shadow: inset 0 0 0 1px ${g(T.error, 34)}; }
.fo-node[data-state="suspended"] .fo-node-dom { box-shadow: inset 0 0 0 1px ${g(T.warn, 32)}; }
/* ghost（不在本分组的任务）：虚线框，不可点 */
.fo-node.is-ghost .fo-node-dom { box-sizing: border-box; border: 1px dashed ${g(T.idle, 55)}; }
/* 聚焦：选中的卡片是主角，其余降透明度（hover 回一点，仍可点） */
.fo-node.is-dimmed { opacity: .3; }
.fo-node.is-dimmed:hover { opacity: .75; }
.fo-node:focus-visible { outline: none; }
.fo-node:focus-visible .fo-node-dom { box-shadow: inset 0 0 0 2px ${T.brand}; }


/* ============ 卡片字段就地编辑 ============ */
.fo-fieldedit-backdrop { position: fixed; inset: 0; z-index: 120; display: flex; align-items: center; justify-content: center; padding: 20px; background: color-mix(in oklab, var(--dsw-alias-bg-base) 55%, transparent); backdrop-filter: blur(3px); }
.fo-fieldedit { width: min(380px, 92vw); display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 14px; border: 1px solid var(--fo-glass-line); background: var(--fo-glass-card); box-shadow: var(--fo-glass-shadow); backdrop-filter: var(--fo-glass-blur); }
.fo-fieldedit-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fo-fieldedit-close { width: 24px; height: 24px; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 18px; cursor: pointer; }
.fo-fieldedit-close:hover { background: color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent); color: var(--dsw-alias-label-primary); }
.fo-fieldedit-task { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-fieldedit-input { width: 100%; height: 32px; box-sizing: border-box; padding: 0 8px; border-radius: 8px; border: 1px solid var(--fo-glass-line); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
.fo-fieldedit-label { display: flex; flex-direction: column; gap: 4px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.fo-fieldedit-choices { display: flex; flex-wrap: wrap; gap: 5px; }
.fo-fieldedit-choice { height: 28px; min-width: 38px; border-radius: 7px; border: 1px solid var(--fo-glass-line); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; cursor: pointer; }
.fo-fieldedit-choice[data-active="1"] { color: var(--dsw-alias-brand-primary); border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 35%, transparent); background: color-mix(in oklab, var(--dsw-alias-brand-primary) 10%, transparent); }
.fo-fieldedit-error { font-size: 11px; color: var(--dsw-alias-state-error-primary); }
.fo-fieldedit-actions { display: flex; justify-content: flex-end; gap: 6px; padding-top: 2px; }

/* ============ 右侧单 dock：详情 / 建议互斥切换 ============ */
/* 不再让详情 + 建议各占一列；窄容器下也不会把建议挤到正文下面。 */
.fo-root[data-rightdock="1"] .fo-body {
  grid-template-columns: minmax(0, 1fr) clamp(280px, 34%, 380px) !important;
}
.fo-rightdock {
  display: flex; flex-direction: column;
  min-width: 0; min-height: 0; height: 100%;
  border-left: 1px solid var(--fo-glass-line);
  background: var(--fo-glass-card);
  backdrop-filter: var(--fo-glass-blur);
  -webkit-backdrop-filter: var(--fo-glass-blur);
  overflow: hidden;
}
.fo-rightdock-tabs {
  flex: 0 0 auto; display: flex; align-items: center; gap: 2px;
  padding: 7px 10px 0; border-bottom: 1px solid var(--fo-glass-line);
}
.fo-rightdock-tab {
  display: inline-flex; align-items: center; gap: 5px;
  height: 27px; padding: 0 10px;
  border: 0; border-radius: 8px 8px 0 0;
  font: inherit; font-size: 11px; font-weight: 600;
  color: var(--dsw-alias-label-secondary); background: transparent; cursor: pointer;
}
.fo-rightdock-tab:hover { color: var(--dsw-alias-label-primary); background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, transparent); }
.fo-rightdock-tab[data-active="1"] { color: var(--dsw-alias-brand-primary); background: color-mix(in oklab, var(--dsw-alias-brand-primary) 9%, transparent); }
.fo-rightdock-badge {
  min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 700; color: var(--dsw-alias-bg-base); background: var(--dsw-alias-brand-primary);
}
.fo-rightdock > .fo-detail,
.fo-rightdock > .fo-organize {
  flex: 1 1 auto; min-height: 0; height: auto;
  border-left: 0; border-radius: 0; box-shadow: none;
}
.fo-rightdock > .fo-organize {
  position: relative !important;
  width: auto !important;
  max-width: none !important;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.fo-rightdock .fo-org-resize,
.fo-rightdock .fo-org-head-actions [data-action="dock"] { display: none; }

/* ============ 右栏：详情（独立玻璃层） ============ */
.fo-detail {
  display: flex; flex-direction: column; gap: 12px;
  min-width: 0; min-height: 0; overflow: auto;
  padding: 16px;
  border-left: 1px solid var(--fo-glass-line);
  background: var(--fo-glass-card);
  backdrop-filter: var(--fo-glass-blur);
  -webkit-backdrop-filter: var(--fo-glass-blur);
}
.fo-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.fo-detail-head .fo-detail-eyebrow { flex: 1 1 auto; min-width: 0; padding-top: 4px; }
.fo-detail-top-actions { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-end; gap: 4px; flex-wrap: wrap; max-width: 62%; }
.fo-detail-top-actions .fo-btn { height: 24px; padding: 0 7px; font-size: 10px; }
.fo-detail-close { width: 24px; padding: 0 !important; font-size: 16px !important; line-height: 1; }
.fo-detail-close-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.fo-detail-eyebrow { display: flex; align-items: center; gap: 8px; font-size: 11px; color: ${T.label2}; }
.fo-detail-title { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.45; word-break: break-word; }
.fo-kv { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 6px 10px; margin: 0; font-size: 12px; }
.fo-kv dt { color: ${T.label2}; }
.fo-kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.fo-mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 11px; }
.fo-sec { display: flex; flex-direction: column; gap: 8px; }
.fo-sec-label { font-size: 11px; font-weight: 600; color: ${T.label2}; }
.fo-refs { display: flex; flex-direction: column; gap: 6px; }
.fo-ref {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 8px 10px;
  border: 1px solid var(--fo-glass-line); border-radius: 10px;
  background: var(--fo-glass-sub); color: inherit; font: inherit; font-size: 12px;
  text-align: left; cursor: pointer;
  transition: transform var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease);
}
.fo-ref::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit;
  background: var(--fo-glass-wash);
  opacity: 0; pointer-events: none;
  transition: opacity var(--fo-dur) var(--fo-ease);
}
.fo-ref:hover:not(:disabled) { transform: translateY(-3px) scale(1.01); border-color: var(--fo-glass-line-hover); }
.fo-ref:hover:not(:disabled)::after { opacity: 1; }
.fo-ref:disabled, .fo-ref[data-missing="1"] { cursor: default; color: ${T.label2}; border-style: dashed; background: transparent; }
.fo-ref-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.fo-ref-row .fo-ref { flex: 1 1 auto; min-width: 0; }
.fo-ref-del {
  flex: 0 0 20px; width: 20px; height: 20px; padding: 0;
  border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: ${T.label2};
  font-size: 13px; line-height: 1; cursor: pointer;
  opacity: 0; transition: opacity var(--fo-dur) var(--fo-ease), color var(--fo-dur) var(--fo-ease);
}
.fo-ref-row:hover .fo-ref-del, .fo-ref-del:focus-visible { opacity: 1; }
.fo-ref-del:hover { color: ${T.error}; border-color: ${g(T.error, 30)}; background: ${g(T.error, 10)}; }
/* 手动加关系：类型 + 目标两个下拉 + 添加 */
.fo-rel-add-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.fo-select {
  min-width: 0; height: 26px; padding: 0 6px;
  border-radius: 8px; font: inherit; font-size: 11.5px;
  color: ${T.label1}; background: ${T.bgLayer2};
  border: 1px solid var(--fo-glass-line);
}
.fo-select[data-role="rel-target"] { flex: 1 1 120px; }
.fo-ref-kind { flex: 0 0 auto; font-size: 10px; color: ${T.label2}; }
.fo-ref-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-muted { margin: 0; font-size: 12px; color: ${T.label2}; }

/* ============ 右栏：一键整理建议抽屉（task-16） ============
   每条建议 = 一次「改一条关系」的动作，所以卡片上必须同时有：类型徽标、两端标题、模型自评的把握、
   evidence 原文（引用块）、代价预览（会让谁变阻塞）。健康色/警告色都走宿主状态令牌。 */
.fo-organize {
  position: relative;
  display: flex; flex-direction: column; gap: 10px;
  min-width: 0; min-height: 0; overflow: hidden;
  /* 高度铺满：右侧一整条。**不要**再减一个固定值——之前 calc(100dvh - 56px)
     会在面板底部留一条空白带，看起来就是「下方多了一块」。 */
  height: 100%;
  max-height: 100%;
  padding: 14px;
  border-left: 1px solid var(--fo-glass-line);
  background: var(--fo-glass-card);
  backdrop-filter: var(--fo-glass-blur);
  -webkit-backdrop-filter: var(--fo-glass-blur);
}
/* 顶部：标题 + 计数一行，操作按钮一行（关闭/重新分析/固定-浮层都在上面，底部不再有"关闭"） */
/* 建议 = Header 右侧唯一入口：一个按钮控制开/收右侧面板。 */
.fo-head-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; flex: 0 0 auto; }
.fo-suggest-btn { gap: 6px; }
.fo-suggest-btn[data-active="1"] { color: ${T.brand}; background: ${g(T.brand, 12)}; border-color: ${g(T.brand, 24)}; }
.fo-suggest-btn[data-running="1"] { opacity: .7; cursor: progress; }
.fo-suggest-label { white-space: nowrap; }
.fo-suggest-badge {
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums;
  color: ${T.bgBase}; background: ${T.brand};
}

/* 标题和图标按钮同一行，永远不换行：范围文案超长就省略，别把 header 撑成两行。 */
.fo-org-head {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: 8px; flex-wrap: nowrap;
  padding-bottom: 10px; border-bottom: 1px solid var(--fo-glass-line);
}
.fo-org-head-main { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1 1 auto; }
.fo-org-head-actions { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; flex-wrap: nowrap; }
/* 项目卡 header 一行到底：不换行（按钮多了就压缩图例，不把 header 撑成两行） */
.fo-graph-head { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; min-width: 0; }
.fo-graph-head .fo-edge-legend { flex: 0 0 auto; }
/* 图例可压缩：挤不下就省略，绝不让 header 换行 */
.fo-graph-head .fo-graph-legend { flex: 1 1 0; min-width: 0; overflow: hidden; flex-wrap: nowrap; }
.fo-graph-head .fo-graph-actions { flex: 0 0 auto; margin-left: auto; flex-wrap: nowrap; }
.fo-graph-head .fo-legend-item { min-width: 0; flex: 0 1 auto; overflow: hidden; }
.fo-graph-head .fo-legend-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 图卡标题 = 这一页的 header：始终展开，只放图标/目录名/单项目名/任务数。
   不再做成 360px 宽的空卡片，也不做折叠。 */
.fo-graph-head .fo-row-card {
  flex: 0 1 auto; width: auto; min-width: 0; max-width: 46%;
  height: 40px; padding: 0 10px; gap: 8px;
  border: 1px solid transparent; border-radius: 10px;
  background: ${g(T.label1, 4)};
  font-size: 14px; font-weight: 600; color: ${T.label1};
  cursor: default;
}
.fo-graph-head .fo-row-card:hover { background: ${g(T.label1, 4)}; border-color: transparent; }
.fo-graph-head .fo-row-card .fo-dot.is-logo { flex: 0 0 20px; width: 20px; height: 20px; color: ${T.brand}; }
.fo-graph-head .fo-row-card .fo-row-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 600; }
/* 单项目：项目名收进标题卡，省掉再单起一份项目图例 */
.fo-graph-project {
  flex: 0 1 auto; min-width: 0; max-width: 150px;
  padding: 2px 6px; border-radius: 999px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; font-weight: 500; color: ${T.label2};
  background: ${g(T.label1, 6)};
}
.fo-graph-head .fo-row-card .fo-row-count {
  flex: 0 0 auto;
  position: static; transform: none; min-width: 18px;
  padding: 0 6px; border-radius: 999px;
  font-size: 11px; color: ${T.label2}; background: ${g(T.label1, 6)};
}
/* 筛选：按钮 + 浮层（浮层贴着卡片右下，不推挤 header 布局） */
.fo-filter-wrap { position: relative; display: inline-flex; }
.fo-filter-pop {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 40;
  display: flex; flex-direction: column; gap: 8px;
  min-width: 292px; padding: 10px 12px;
  border-radius: 12px; border: 1px solid var(--fo-glass-line);
  background: var(--fo-glass-card); box-shadow: var(--fo-glass-shadow);
  backdrop-filter: var(--fo-glass-blur); -webkit-backdrop-filter: var(--fo-glass-blur);
}
.fo-filter-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.fo-filter-label { flex: 0 0 44px; font-size: 11px; color: ${T.label2}; }
.fo-filter-hint { font-size: 10px; color: ${T.label2}; opacity: .8; }
.fo-filter-chip {
  height: 24px; padding: 0 10px; border-radius: 999px;
  font: inherit; font-size: 11px; color: ${T.label2};
  background: transparent; border: 1px solid var(--fo-glass-line); cursor: pointer;
}
.fo-filter-chip[data-active="1"] {
  color: ${T.label1};
  background: ${g(T.brand, 18)};
  border-color: ${g(T.brand, 42)};
}
.fo-filter-chip:hover { border-color: var(--fo-glass-line-hover); }
.fo-org-title { flex: 0 0 auto; font-size: 13px; font-weight: 600; }
.fo-org-counts { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: ${T.label2}; font-variant-numeric: tabular-nums; }
/* 建议栏自己不滚动，只有列表滚（头和底固定） */
.fo-organize { overflow: hidden; }
/* 时间轴：只有列表滚，头和底固定；底栏 sticky，永远点得到「接受以上」。 */
.fo-org-list {
  flex: 1 1 0; min-height: 0; overflow: auto; overscroll-behavior: contain;
  display: flex; flex-direction: column; gap: 10px; padding-right: 2px;
}
/* 这一组依据的用户要求（建议栏底部对话框提交的那句话）：单行省略，hover 看全文。 */
.fo-org-group-hint {
  margin: 2px 2px 8px; padding: 0 8px;
  font-size: 11px; line-height: 1.6; color: ${T.brand};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 底部对话框：和列表同宽，贴着栏底；输入框可多行，Enter 提交、Shift+Enter 换行。 */
.fo-org-composer {
  flex: 0 0 auto; display: flex; align-items: flex-end; gap: 6px;
  margin-top: 10px; padding: 8px 0 2px;
  border-top: 1px solid var(--fo-glass-line);
}
.fo-org-composer-input {
  flex: 1 1 auto; min-width: 0; max-height: 96px; resize: none;
  padding: 7px 10px; box-sizing: border-box;
  border: 1px solid var(--fo-glass-line); border-radius: 10px;
  background: ${g(T.bgLayer2, 55)}; color: ${T.label1};
  font: inherit; font-size: 12px; line-height: 1.5;
}
.fo-org-composer-input::placeholder { color: ${g(T.label2, 80)}; }
.fo-org-composer-input:focus { outline: none; border-color: ${g(T.brand, 55)}; }
.fo-org-composer-input:disabled { opacity: .6; }
.fo-org-composer-send { flex: 0 0 auto; height: 32px; min-width: 32px; padding: 0 8px; }
.fo-org-notes { margin: 0; font-size: 12px; color: ${T.label2}; line-height: 1.5; }
.fo-org-notes[data-tone="error"] { color: ${T.error}; }
/* 组只是「一段」：用分割线隔开，不再套卡片；真正的卡片始终是每一条建议。 */
.fo-org-group {
  border: 0; border-radius: 0; overflow: visible;
  padding-top: 12px; border-top: 1px dashed var(--fo-glass-line);
}
.fo-org-group:first-of-type { border-top: 0; padding-top: 0; }
.fo-org-group.is-archived { opacity: .72; }
.fo-org-group-head { display: flex; align-items: center; gap: 6px; padding: 0 2px 8px; }
.fo-org-group-toggle {
  flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px;
  padding: 0; border: 0; background: transparent; cursor: pointer;
  font: inherit; text-align: left; color: ${T.label2};
}
.fo-org-group-toggle:hover { color: ${T.label1}; }
.fo-org-group-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; }
/* 组底部的接受/拒绝/撤销：跟着这一组的最后一张卡，不用再跑到面板底部找。 */
.fo-org-group-body > .fo-org-group-actions {
  justify-content: flex-end; padding-top: 6px; margin-top: 2px;
  border-top: 1px solid var(--fo-glass-line);
}
.fo-org-load-more { display: flex; justify-content: center; }
.fo-org-loading { display: flex; justify-content: center; padding: 8px 0; }
@keyframes fo-spin { to { transform: rotate(360deg); } }
.fo-spinner {
  width: 14px; height: 14px; flex: 0 0 auto; border-radius: 50%;
  border: 2px solid ${g(T.brand, 20)}; border-top-color: ${T.brand};
  animation: fo-spin .8s linear infinite;
}
.fo-org-load-more-btn { gap: 6px; }
/* 面板里的按钮默认图标态：文字只留在 title / aria-label；
   组级主动作（接受全部 / 拒绝全部 / 撤销）加 has-label 变成「图标 + 文字」。 */
.fo-icon-btn {
  width: 26px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: 8px; background: transparent;
  color: ${T.label2}; cursor: pointer;
}
.fo-icon-btn:hover { color: ${T.label1}; background: ${g(T.label1, 8)}; }
.fo-icon-btn:disabled { opacity: .4; cursor: default; background: transparent; }
.fo-icon-btn[aria-pressed="true"] { color: ${T.brand}; background: ${g(T.brand, 12)}; }
.fo-icon-btn.has-label { width: auto; gap: 5px; padding: 0 9px; }
.fo-icon-btn-label { font-size: 12px; font-weight: 500; white-space: nowrap; }
.fo-org-icon { display: block; }

.fo-org-group-time { flex: 0 0 auto; font-size: 11px; color: ${T.label2}; font-variant-numeric: tabular-nums; }

.fo-org-group-counts {
  flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; color: ${T.label2}; font-variant-numeric: tabular-nums;
}
.fo-org-group-body { display: flex; flex-direction: column; gap: 10px; padding: 0; }
.fo-org-item {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px; border-radius: 12px;
  background: var(--fo-glass-sub);
  border: 1px solid var(--fo-glass-line);
}
.fo-org-item[data-status="accepted"] { border-color: ${g(T.success, 34)}; }
.fo-org-item[data-status="rejected"] { opacity: .6; }
.fo-org-top { display: flex; align-items: center; gap: 8px; }
.fo-org-kind {
  display: inline-flex; align-items: center; height: 18px; padding: 0 8px; border-radius: 999px;
  font-size: 10px; font-weight: 600; white-space: nowrap;
  color: ${T.brand}; background: var(--fo-selected-bg); border: 1px solid var(--fo-selected-line);
}
.fo-org-kind[data-kind="derived_from"] { color: ${T.idle}; background: ${g(T.idle, 16)}; border-color: ${g(T.idle, 32)}; }
.fo-org-kind[data-kind="temporal"] { color: ${T.idle}; background: ${g(T.idle, 12)}; border-color: ${g(T.idle, 24)}; }
/* 预期完成建议：绿色系（它是「改一个配置」，不是改关系） */
.fo-org-kind[data-kind="eta"] { color: ${T.success}; background: ${g(T.success, 14)}; border-color: ${g(T.success, 30)}; }
/* O/KR 建议：品牌色（它是「归组」，既不改图也不改时间） */
.fo-org-kind[data-kind="okr"] { color: ${T.brand}; background: ${g(T.brand, 12)}; border-color: ${g(T.brand, 28)}; }
/* O/KR 卡片：任务名一行，下面 O / KR 两行竖排（文案通常比"任务→任务"长） */
.fo-org-okr-suggest { flex-direction: column; align-items: flex-start; gap: 3px; }
.fo-org-okr-pair { display: flex; flex-direction: column; gap: 2px; min-width: 0; width: 100%; }
.fo-org-okr-o, .fo-org-okr-kr {
  display: block; min-width: 0; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; line-height: 1.45;
}
.fo-org-okr-kr { color: ${T.label2}; }
.fo-org-conf { margin-left: auto; font-size: 11px; color: ${T.label2}; font-variant-numeric: tabular-nums; }
.fo-org-route { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; }
.fo-org-from, .fo-org-to { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-org-arrow { flex: 0 0 auto; color: ${T.brand}; }
.fo-org-evidence {
  margin: 0; padding: 6px 8px;
  border-left: 2px solid var(--fo-selected-line); border-radius: 0 8px 8px 0;
  background: ${g(T.bgBase, 60)};
  font-size: 11px; color: ${T.label2}; line-height: 1.5; word-break: break-word;
}
.fo-org-impact { margin: 0; font-size: 11px; color: ${T.warn}; }
.fo-org-impact[data-tone="idle"] { color: ${T.label2}; }
.fo-org-fail { margin: 0; font-size: 11px; color: ${T.error}; }
.fo-org-item-actions { display: flex; align-items: center; gap: 8px; }
.fo-org-done { font-size: 11px; color: ${T.label2}; }
.fo-org-empty { margin: 0; font-size: 12px; color: ${T.label2}; line-height: 1.5; }
.fo-org-empty.is-loading { display: flex; align-items: center; gap: 6px; }
.fo-org-empty.is-loading .fo-spinner { width: 12px; height: 12px; border-width: 2px; }
.fo-org-dropped { display: flex; flex-direction: column; gap: 6px; }
.fo-org-dropped > .fo-btn { align-self: flex-start; }
.fo-org-dropped-list { display: flex; flex-direction: column; gap: 4px; }
.fo-org-dropped-item { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border-radius: 8px; background: var(--fo-glass-sub); }
.fo-org-dropped-route { font-size: 11px; color: ${T.label2}; }
.fo-org-dropped-reason { font-size: 11px; color: ${T.label2}; }
.fo-btn-icon { flex: 0 0 auto; width: 14px; height: 14px; }

/* ============ 空态 / 加载态 ============ */
.fo-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; flex: 1; min-height: 180px; padding: 32px 20px; text-align: center;
}
.fo-placeholder-title { font-size: 13px; font-weight: 600; }
/* 空目录在看板页只留一条说明，不要占一整屏（下面还有别的目录）。 */
.fo-placeholder-compact { flex: 0 0 auto; min-height: 0; padding: 18px 20px; gap: 6px; }
.fo-placeholder-body { max-width: 420px; font-size: 12px; color: ${T.label2}; }
.fo-skeleton { display: flex; flex-direction: column; gap: 12px; }
.fo-skeleton-row {
  height: 64px; border-radius: 12px;
  background: linear-gradient(90deg, var(--fo-glass-sub) 0%, ${g(T.bgLayer2, 40)} 50%, var(--fo-glass-sub) 100%);
  background-size: 200% 100%;
  animation: fo-shimmer 1.4s var(--fo-ease) infinite;
}
@keyframes fo-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* ============ 尊重系统「减少动态效果」：位移与渐变过渡全部关掉 ============ */
@media (prefers-reduced-motion: reduce) {
  .fo-root *, .fo-root *::before, .fo-root *::after {
    animation: none !important;
    transition: none !important;
  }
  .fo-ref:hover:not(:disabled), .fo-btn:hover:not(:disabled), .fo-row:hover { transform: none !important; }
  .fo-ref:hover:not(:disabled)::after { opacity: 0 !important; }
}

/* React Flow：只用它的连接点算边端点，不把连接点画出来 */

/* ============ 视图切换：画布 / 列表 ============ */
.fo-view-switch {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 2px; border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 12%, transparent);
  background: color-mix(in oklab, var(--dsw-alias-bg-base) 45%, transparent);
}
.fo-view-btn {
  height: 26px; padding: 0 10px; border: 0; border-radius: 8px;
  font: inherit; font-size: 11px; color: var(--dsw-alias-label-secondary);
  background: transparent; cursor: pointer;
}
.fo-view-btn:hover { color: var(--dsw-alias-label-primary); background: color-mix(in oklab, var(--dsw-alias-label-primary) 6%, transparent); }
.fo-view-btn[data-active="1"] {
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);
  box-shadow: 0 1px 3px color-mix(in oklab, var(--dsw-alias-label-primary) 14%, transparent);
}
/* ============ 列表模式：按状态分组的任务看板 ============ */
.fo-board-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--dsw-alias-label-secondary); }
.fo-opp-content { display: flex; flex-direction: column; gap: 8px; flex: 0 0 auto; height: 360px; min-height: 0; padding: 12px 16px 16px; overflow: hidden; }
.fo-flow-graph.is-solo .fo-opp-content { flex: 1 1 auto; height: auto; }

.fo-opp-empty {
  display: flex; align-items: center; justify-content: center;
  flex: 1 1 auto; min-height: 140px; padding: 18px;
  font-size: 12px; color: var(--dsw-alias-label-secondary);
}
/* OKR */
.fo-okr-list { display: flex; flex-direction: column; gap: 14px; flex: 1 1 auto; min-height: 0; overflow: auto; padding: 2px; }
.fo-okr-overview-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 2px 2px 4px; flex-wrap: wrap; }
.fo-okr-overview-title { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.fo-okr-overview-head h2 { margin: 0; font-size: 20px; font-weight: 900; letter-spacing: -.025em; color: var(--dsw-alias-label-primary); }
.fo-okr-overview-head span { font-size: 10px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.fo-scope-chip { flex: 0 0 auto; max-width: 260px; height: 24px; padding: 0 8px; border: 1px solid color-mix(in oklab, var(--dsw-alias-brand-primary) 30%, transparent); border-radius: 6px; background: color-mix(in oklab, var(--dsw-alias-brand-primary) 10%, transparent); color: var(--dsw-alias-brand-primary); font: inherit; font-size: 9px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.fo-okr-overview-actions { display: flex; align-items: center; gap: 8px; }
.fo-okr-refresh { height: 30px; padding: 0 13px; border: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 12%, transparent); border-radius: 9px; background: color-mix(in oklab, var(--dsw-alias-label-primary) 4%, transparent); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
.fo-okr-refresh:hover { color: var(--dsw-alias-label-primary); background: color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent); }
.fo-okr-new { height: 30px; padding: 0 14px; border: 0; border-radius: 9px; background: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11px; font-weight: 800; cursor: pointer; }
.fo-okr-new:hover { filter: brightness(1.08); }
.fo-okr-objective {
  display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 18px;
  padding: 20px; border-radius: 18px;
  border: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 10%, transparent);
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-1) 82%, var(--dsw-alias-bg-base));
}
.fo-okr-o-badge {
  position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  width: 56px; height: 56px; padding: 0; border: 0; border-radius: 15px;
  color: var(--dsw-alias-label-primary); font: inherit; cursor: pointer; overflow: hidden;
  background: linear-gradient(135deg, color-mix(in oklab, var(--dsw-alias-brand-primary) 82%, var(--dsw-alias-label-primary)), var(--dsw-alias-brand-primary));
  box-shadow: 0 7px 20px color-mix(in oklab, var(--dsw-alias-brand-primary) 18%, transparent);
  filter: hue-rotate(42deg) saturate(1.18);
  transition: transform .15s ease, box-shadow .15s ease, filter .15s ease;
}
.fo-okr-o-badge:hover { transform: translateY(-1px); box-shadow: 0 9px 24px color-mix(in oklab, var(--dsw-alias-brand-primary) 28%, transparent); }
.fo-okr-o-badge:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.fo-okr-o-index { font-size: 14px; font-weight: 900; letter-spacing: -.02em; transition: opacity .15s ease; }
.fo-okr-o-chevron { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 20px; line-height: 1; opacity: 0; transition: opacity .15s ease; }
.fo-okr-o-badge:hover .fo-okr-o-index { opacity: 0; }
.fo-okr-o-badge:hover .fo-okr-o-chevron { opacity: 1; }
.fo-okr-objective-body { position: relative; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.fo-okr-kr { margin-left: -14px; }
.fo-okr-objective-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; min-width: 0; }
.fo-okr-objective-title { display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1 1 auto; padding-top: 1px; }
.fo-okr-objective-title h4 { margin: 0; font-size: 16px; font-weight: 800; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: text; }
.fo-okr-objective-title h4:hover { text-decoration: underline; text-decoration-color: color-mix(in oklab, var(--dsw-alias-label-primary) 22%, transparent); text-underline-offset: 3px; }
.fo-okr-labels { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.fo-okr-label { font-size: 9px; color: var(--dsw-alias-label-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }
.fo-okr-status { flex: 0 0 auto; padding: 2px 8px; border-radius: 6px; font-size: 9px; color: var(--dsw-alias-label-secondary); background: color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent); }
.fo-okr-status[data-status="completed"] { color: var(--dsw-alias-state-success-primary); background: color-mix(in oklab, var(--dsw-alias-state-success-primary) 13%, transparent); }
.fo-okr-status[data-status="at-risk"] { color: var(--dsw-alias-state-error-primary); background: color-mix(in oklab, var(--dsw-alias-state-error-primary) 13%, transparent); }
.fo-okr-status[data-status="in-progress"] { color: var(--dsw-alias-brand-primary); background: color-mix(in oklab, var(--dsw-alias-brand-primary) 15%, transparent); }
.fo-okr-meta { display: flex; gap: 14px; flex-wrap: wrap; font-size: 9px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.fo-okr-progress, .fo-okr-kr-progress { height: 7px; border-radius: 999px; overflow: hidden; background: color-mix(in oklab, var(--dsw-alias-label-primary) 9%, transparent); }
.fo-okr-progress i, .fo-okr-kr-progress i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--dsw-alias-brand-primary), var(--dsw-alias-state-success-primary)); }
.fo-okr-objective[data-status="in-progress"] .fo-okr-progress i { background: linear-gradient(90deg, var(--dsw-alias-state-warn-primary), color-mix(in oklab, var(--dsw-alias-state-warn-primary) 70%, var(--dsw-alias-state-error-primary))); }
.fo-okr-objective[data-status="completed"] .fo-okr-progress i { background: var(--dsw-alias-state-success-primary); }
.fo-okr-objective[data-status="at-risk"] .fo-okr-progress i { background: var(--dsw-alias-state-error-primary); }
.fo-okr-objective[data-status="not-started"] .fo-okr-progress i { background: var(--dsw-alias-label-secondary); }
.fo-okr-kr-list { display: flex; flex-direction: column; gap: 8px; padding-top: 2px; }
.fo-okr-kr {
  position: relative; display: flex; flex-direction: column; gap: 7px;
  padding: 12px 14px; border-radius: 12px;
  border: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 9%, transparent);
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 80%, var(--dsw-alias-bg-base));
}
.fo-okr-kr::before { content: ''; position: absolute; left: -32px; top: 21px; width: 24px; height: 2px; background: linear-gradient(to right, color-mix(in oklab, var(--dsw-alias-brand-primary) 55%, transparent), transparent); filter: hue-rotate(42deg) saturate(1.18); pointer-events: none; }
.fo-okr-kr::after { content: ''; position: absolute; left: -32px; top: -4px; bottom: -4px; width: 2px; background: linear-gradient(to bottom, color-mix(in oklab, var(--dsw-alias-brand-primary) 30%, transparent), color-mix(in oklab, var(--dsw-alias-brand-primary) 55%, transparent)); filter: hue-rotate(42deg) saturate(1.18); pointer-events: none; }
.fo-okr-kr:first-child::after { top: -34px; }
.fo-okr-kr.is-last::after { top: -4px; bottom: auto; height: 26px; }
.fo-okr-kr-dot { position: absolute; left: -36px; top: 18px; z-index: 2; width: 8px; height: 8px; padding: 0; border: 2px solid color-mix(in oklab, var(--dsw-alias-brand-primary) 55%, transparent); border-radius: 50%; background: var(--dsw-alias-brand-primary); filter: hue-rotate(42deg) saturate(1.18); cursor: pointer; }
.fo-okr-kr-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fo-okr-kr-title { flex: 1 1 auto; min-width: 0; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: text; }
.fo-okr-kr-title:hover { text-decoration: underline; text-decoration-color: color-mix(in oklab, var(--dsw-alias-label-primary) 22%, transparent); text-underline-offset: 3px; }
.fo-okr-kr-nums { flex: 0 0 auto; font-size: 11px; font-weight: 700; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.fo-okr-kr-status { flex: 0 0 auto; padding: 1px 7px; border-radius: 5px; font-size: 8px; color: var(--dsw-alias-label-secondary); background: color-mix(in oklab, var(--dsw-alias-label-primary) 7%, transparent); }
.fo-okr-kr-status[data-status="completed"] { color: var(--dsw-alias-state-success-primary); background: color-mix(in oklab, var(--dsw-alias-state-success-primary) 11%, transparent); }
.fo-okr-kr-status[data-status="at-risk"] { color: var(--dsw-alias-state-error-primary); background: color-mix(in oklab, var(--dsw-alias-state-error-primary) 11%, transparent); }
.fo-okr-kr-status[data-status="in-progress"] { color: var(--dsw-alias-brand-primary); background: color-mix(in oklab, var(--dsw-alias-brand-primary) 11%, transparent); }
.fo-okr-kr[data-status="completed"] .fo-okr-kr-progress i { background: var(--dsw-alias-state-success-primary); }
.fo-okr-kr[data-status="at-risk"] .fo-okr-kr-progress i { background: var(--dsw-alias-state-error-primary); }
.fo-okr-kr[data-status="in-progress"] .fo-okr-kr-progress i { background: var(--dsw-alias-brand-primary); }
.fo-okr-kr[data-status="not-started"] .fo-okr-kr-progress i { background: var(--dsw-alias-label-secondary); }
.fo-okr-kr-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fo-okr-kr-actions { display: flex; align-items: center; gap: 4px; }
.fo-okr-kr-percent { font-size: 10px; font-weight: 600; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.fo-okr-kr-tasks-btn { height: 21px; padding: 0 8px; border: 1px solid color-mix(in oklab, var(--dsw-alias-brand-primary) 22%, transparent); border-radius: 5px; background: color-mix(in oklab, var(--dsw-alias-brand-primary) 8%, transparent); color: var(--dsw-alias-brand-primary); font: inherit; font-size: 8px; font-weight: 600; cursor: pointer; }
.fo-okr-kr-tasks-btn:hover { background: color-mix(in oklab, var(--dsw-alias-brand-primary) 14%, transparent); }
.fo-okr-tasks { display: flex; flex-direction: column; gap: 3px; padding: 6px 0 1px; border-top: 1px dashed color-mix(in oklab, var(--dsw-alias-label-primary) 10%, transparent); }
.fo-okr-task { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 4px 5px; border: 0; border-radius: 6px; background: transparent; text-align: left; cursor: pointer; }
.fo-okr-task:hover { background: color-mix(in oklab, var(--dsw-alias-brand-primary) 7%, transparent); }
.fo-okr-task:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.fo-okr-task-no { flex: 0 0 auto; font-size: 8px; color: var(--dsw-alias-label-secondary); }
.fo-okr-task-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--dsw-alias-label-primary); }
.fo-okr-task-status { flex: 0 0 auto; font-size: 8px; color: var(--dsw-alias-label-secondary); }
.fo-okr-task-status[data-status="done"] { color: var(--dsw-alias-state-success-primary); }
.fo-okr-task-status[data-status="blocked"] { color: var(--dsw-alias-state-error-primary); }
.fo-okr-task-status[data-status="in-progress"] { color: var(--dsw-alias-brand-primary); }
.fo-okr-add-kr { align-self: flex-start; height: 22px; padding: 0 7px; border: 1px dashed color-mix(in oklab, var(--dsw-alias-label-primary) 18%, transparent); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 9px; cursor: pointer; }
.fo-okr-add-kr:hover { color: var(--dsw-alias-brand-primary); border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 36%, transparent); }
.fo-okr-create-backdrop { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 20px; background: color-mix(in oklab, var(--dsw-alias-bg-base) 72%, transparent); backdrop-filter: blur(4px); }
.fo-okr-create { display: flex; flex-direction: column; gap: 10px; width: min(420px, 100%); padding: 18px; border-radius: 14px; border: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 12%, transparent); background: var(--dsw-alias-bg-overlay); box-shadow: 0 18px 48px color-mix(in oklab, var(--dsw-alias-bg-base) 70%, transparent); }
.fo-okr-create h3 { margin: 0; font-size: 14px; font-weight: 800; color: var(--dsw-alias-label-primary); }
.fo-okr-create-owner { margin-top: -6px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.fo-okr-create label { display: flex; flex-direction: column; gap: 5px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.fo-okr-create input { height: 31px; padding: 0 8px; border: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 14%, transparent); border-radius: 7px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11px; }
.fo-okr-create-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 2px; }
.fo-okr-create-error { font-size: 10px; color: var(--dsw-alias-state-error-primary); }
.fo-okr-edit { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; padding: 5px 0; }
.fo-okr-edit-input { flex: 1 1 160px; min-width: 0; height: 30px; padding: 0 8px; border-radius: 6px; border: 1px solid color-mix(in oklab, var(--dsw-alias-brand-primary) 30%, transparent); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11px; }
.fo-okr-edit-error { flex: 1 1 100%; font-size: 9px; color: var(--dsw-alias-state-error-primary); }
/* Plan matrix */
.fo-opp-plan-wrap { display: flex; flex-direction: column; gap: 5px; flex: 1 1 auto; min-height: 0; }
.fo-opp-plan-hint { flex: 0 0 auto; font-size: 9px; color: var(--dsw-alias-label-secondary); }
.fo-opp-plan-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; border-radius: 12px; }
.fo-opp-plan-grid { display: grid; min-width: 2000px; gap: 7px; align-items: stretch; padding-bottom: 4px; }
.fo-plan-task { width: 100%; min-width: 0; cursor: grab; }
.fo-plan-task:active { cursor: grabbing; }
.fo-plan-task.is-dragging { opacity: .4; }
.fo-taskcard-host { width: 100%; height: auto; border-radius: 0; overflow: visible; }
.fo-taskcard-host > div { height: auto; }
.fo-flow-node .fo-taskcard-host { height: auto; border-radius: 9px; overflow: hidden; }
.fo-flow-node .fo-taskcard-host > div { height: auto; box-sizing: border-box; }
.fo-plan-task .fo-taskcard-host > div { height: auto; }
/* 卡片标签：先换行，超出卡片高度就自动裁掉，避免 O/KR/工作区等长标签顶破右侧。 */
.fo-taskcard-host .task-main { position: relative; }
.fo-taskcard-more {
  position: absolute; right: 2px; bottom: -1px; z-index: 3;
  padding: 0 4px; font-size: 12px; line-height: 1;
  color: var(--dsw-alias-label-secondary);
  background: var(--tc-card, var(--dsw-alias-bg-layer-1));
  pointer-events: none;
}

.fo-taskcard-host .task-meta {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: 4px 6px; min-width: 0;
  max-height: 44px; overflow: hidden;
  transition: max-height .16s ease, background-color .16s ease;
}

.fo-taskcard-host .task-meta > .chip,
.fo-taskcard-host .task-meta > .badge,
.fo-taskcard-host .task-meta > .people-group {
  min-width: 0; max-width: 100%;
}
.fo-taskcard-host .task-meta .chip {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fo-taskcard-host .task-meta .chip[role="button"],
.fo-taskcard-host .task-meta .badge[role="button"],
.fo-taskcard-host .task-meta .due[role="button"] { cursor: pointer; }
.fo-taskcard-host .task-meta .chip[role="button"]:focus-visible,
.fo-taskcard-host .task-meta .badge[role="button"]:focus-visible,
.fo-taskcard-host .task-meta .due[role="button"]:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.fo-taskcard-host .task-meta .chip-field { flex: 0 1 auto; }
.fo-taskcard-host .task-meta .chip-workspace { flex: 0 1 auto; }
.fo-opp-plan-corner, .fo-opp-plan-colhead {
  position: sticky; top: 0; z-index: 3;
  display: flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 9px; border-radius: 9px;
  font-size: 10px; font-weight: 800; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-base);
  border: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 10%, transparent);
}
.fo-opp-plan-corner { left: 0; z-index: 4; }
.fo-opp-plan-colhead[data-status="todo"] .fo-board-dot { background: var(--dsw-alias-label-secondary); }
.fo-opp-plan-colhead[data-status="blocked"] .fo-board-dot { background: var(--dsw-alias-state-error-primary); }
.fo-opp-plan-colhead[data-status="in-progress"] .fo-board-dot { background: var(--dsw-alias-brand-primary); }
.fo-opp-plan-colhead[data-status="suspended"] .fo-board-dot { background: var(--dsw-alias-state-warn-primary); }
.fo-opp-plan-colhead[data-status="done"] .fo-board-dot { background: var(--dsw-alias-state-success-primary); }
.fo-opp-plan-colhead[data-status="cancelled"] .fo-board-dot { background: var(--dsw-alias-label-secondary); opacity: .5; }
.fo-opp-plan-count { margin-left: auto; min-width: 17px; padding: 0 5px; border-radius: 999px; text-align: center; font-size: 9px; background: color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent); }
.fo-opp-plan-rowhead {
  position: sticky; left: 0; z-index: 2;
  display: flex; flex-direction: column; justify-content: flex-start; gap: 2px;
  min-height: 74px; padding: 10px; border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 10%, transparent);
  border-left: 3px solid var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-base);
}
.fo-opp-plan-obj { font-size: 8px; font-weight: 800; letter-spacing: .04em; color: var(--dsw-alias-brand-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-opp-plan-kr { font-size: 11px; font-weight: 700; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-opp-plan-meta { font-size: 8px; color: var(--dsw-alias-label-secondary); }
.fo-opp-plan-cell {
  display: flex; flex-direction: column; gap: 5px;
  min-height: 74px; padding: 5px; border-radius: 10px;
  border: 1px dashed color-mix(in oklab, var(--dsw-alias-label-primary) 10%, transparent);
  background: color-mix(in oklab, var(--dsw-alias-bg-base) 45%, transparent);
}
.fo-opp-plan-cell[data-status="in-progress"] { border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 20%, transparent); }
.fo-opp-plan-cell[data-status="blocked"] { border-color: color-mix(in oklab, var(--dsw-alias-state-error-primary) 18%, transparent); }
.fo-opp-plan-cell[data-status="done"] { border-color: color-mix(in oklab, var(--dsw-alias-state-success-primary) 15%, transparent); }
.fo-opp-plan-cell[data-status="cancelled"] { opacity: .55; }
.fo-opp-plan-cell.is-drop { border-style: solid; border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 42%, transparent); background: color-mix(in oklab, var(--dsw-alias-brand-primary) 7%, transparent); }
.fo-opp-plan-empty { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; min-height: 58px; font-size: 10px; color: var(--dsw-alias-label-secondary); opacity: .4; }
/* Progress timeline */
.fo-gantt { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 4px; overflow: auto; }
.fo-gantt-axis { display: grid; grid-template-columns: 160px 1fr; gap: 8px; padding: 0 2px; }
.fo-gantt-axis-label { font-size: 10px; font-weight: 800; color: var(--dsw-alias-label-secondary); }
.fo-gantt-axis-track { display: flex; justify-content: space-between; font-size: 9px; color: var(--dsw-alias-label-secondary); border-bottom: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent); padding-bottom: 3px; }
.fo-gantt-row { display: grid; grid-template-columns: 160px 1fr; gap: 8px; align-items: stretch; }
.fo-gantt-label { display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 6px 8px; border-radius: 9px; background: color-mix(in oklab, var(--dsw-alias-bg-base) 55%, transparent); border: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 9%, transparent); border-left: 2px solid var(--dsw-alias-brand-primary); }
.fo-gantt-obj { font-size: 8px; font-weight: 800; color: var(--dsw-alias-brand-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-gantt-kr { font-size: 10px; font-weight: 700; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-gantt-meta { font-size: 8px; color: var(--dsw-alias-label-secondary); }
.fo-gantt-track { position: relative; border-radius: 9px; background: color-mix(in oklab, var(--dsw-alias-label-primary) 4%, transparent); border: 1px dashed color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent); overflow: hidden; }
.fo-gantt-today { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--dsw-alias-state-warn-primary); opacity: .55; }
.fo-gantt-bar { position: absolute; height: 20px; cursor: pointer; display: flex; align-items: center; gap: 4px; padding: 0 5px; border-radius: 5px; font-size: 8px; color: var(--dsw-alias-label-primary); background: color-mix(in oklab, var(--dsw-alias-brand-primary) 14%, var(--dsw-alias-bg-layer-1)); border: 1px solid color-mix(in oklab, var(--dsw-alias-brand-primary) 28%, transparent); overflow: hidden; }
.fo-gantt-bar[data-status="done"] { background: color-mix(in oklab, var(--dsw-alias-state-success-primary) 13%, var(--dsw-alias-bg-layer-1)); border-color: color-mix(in oklab, var(--dsw-alias-state-success-primary) 25%, transparent); }
.fo-gantt-bar[data-status="blocked"] { background: color-mix(in oklab, var(--dsw-alias-state-error-primary) 13%, var(--dsw-alias-bg-layer-1)); border-color: color-mix(in oklab, var(--dsw-alias-state-error-primary) 25%, transparent); }
.fo-gantt-bar:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.fo-gantt-bar-no { flex: 0 0 auto; font-size: 8px; opacity: .65; }
.fo-gantt-bar-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-gantt-axis-bottom { display: flex; justify-content: space-between; padding: 2px 2px 0 168px; font-size: 8px; color: var(--dsw-alias-label-secondary); }


/* 标题后的筛选 + Workflow 右下角悬浮工具 */
.fo-filter-wrap.is-title-filter { flex: 0 0 auto; margin-left: 2px; }
.fo-filter-wrap.is-title-filter .fo-btn[data-active="1"] { color: var(--dsw-alias-brand-primary); border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 46%, transparent); background: color-mix(in oklab, var(--dsw-alias-brand-primary) 7%, transparent); }
.fo-filter-wrap.is-title-filter .fo-filter-pop { left: 0; right: auto; }
.fo-flow-float-actions {
  position: absolute; right: 12px; bottom: 12px; z-index: 6;
  display: flex; align-items: center; gap: 5px;
  padding: 4px; border-radius: 11px;
  border: 1px solid var(--fo-glass-line);
  background: var(--fo-glass-card);
  box-shadow: var(--fo-glass-shadow);
  backdrop-filter: var(--fo-glass-blur); -webkit-backdrop-filter: var(--fo-glass-blur);
}
.fo-flow-float-btn {
  height: 26px; padding: 0 9px; border: 0; border-radius: 8px;
  font: inherit; font-size: 10px; font-weight: 600;
  color: var(--dsw-alias-label-secondary); background: transparent; cursor: pointer;
}
.fo-flow-float-btn:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent); }
.fo-flow-float-btn:disabled { cursor: default; opacity: .45; }

.fo-flow-graphs { height: 100%; }
.fo-flow-graph { flex: 0 0 auto; min-height: 0; }
.fo-flow-graph.is-solo { flex: 1 1 auto; }
.fo-flow-canvas { flex: 0 0 auto; height: 360px; }
.fo-flow-graph.is-solo .fo-flow-canvas { flex: 1 1 auto; height: auto; min-height: 0; }
.fo-flow-edge { cursor: pointer; }
.fo-flow-edge:hover .react-flow__edge-path { stroke: var(--dsw-alias-state-error-primary) !important; stroke-width: 2.5 !important; }
.fo-flow-edge .react-flow__edge-interaction { cursor: pointer; }
.fo-edge-delete { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 50%; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-state-error-primary); font: inherit; font-size: 11px; line-height: 1; cursor: pointer; box-shadow: 0 2px 6px color-mix(in oklab, var(--dsw-alias-bg-base) 70%, transparent); z-index: 10; }
.fo-edge-delete:hover { background: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-bg-base); }
.fo-flow-canvas .fo-flow-handle {
  opacity: .5; width: 16px; height: 16px;
  min-width: 16px; min-height: 16px;
  border: 2px solid var(--dsw-alias-brand-primary) !important;
  border-radius: 50%; background: var(--dsw-alias-bg-base) !important;
  pointer-events: all; cursor: crosshair; z-index: 6;
  transition: opacity .15s ease, transform .15s ease, background-color .15s ease;
}
.fo-flow-node:hover .fo-flow-handle, .fo-flow-canvas .fo-flow-handle:hover { opacity: 1; }
.fo-flow-canvas .fo-flow-handle-in { left: -8px; }
.fo-flow-canvas .fo-flow-handle-out { right: -8px; }
.fo-flow-canvas .react-flow__handle-connecting { background: var(--dsw-alias-brand-primary) !important; opacity: 1; }
`

/** 项目分色槽位 → CSS 变量引用（组件只用这个，永远不写死颜色）。 */
export function decoVar(index) {
  const n = Math.floor(Number(index))
  if (!isFinite(n) || n < 0) return 'var(--fo-deco-0)'
  return `var(--fo-deco-${n % 8})`
}

/** 品牌色令牌引用（「全部任务」这类中性高亮用）。 */
export function brandVar() { return T.brand }

/** 任务状态 → 宿主状态令牌引用。 */
export function stateVar(state) {
  if (state === 'done') return T.success
  if (state === 'blocked') return T.error
  if (state === 'suspended') return T.warn
  if (state === 'ghost') return T.idle
  return T.idle
}

/**
 * 幂等注入：同一个 document 只插一次 <style>。入口调用一次即可；
 * 没有 document（node 测试）时安静返回 false。
 */
export function injectStyles(doc) {
  const target = doc || (typeof document !== 'undefined' ? document : null)
  if (!target || !target.head || typeof target.createElement !== 'function') return false
  if (typeof target.getElementById === 'function' && target.getElementById(STYLE_ID)) return false
  const style = target.createElement('style')
  style.id = STYLE_ID
  style.setAttribute('data-plugin', 'dsh-cove-task')
  style.textContent = CSS
  target.head.appendChild(style)
  return true
}

export const OVERVIEW_CSS = CSS
