/**
 * 「CoveTask」条 —— E1 徽章条。
 *
 * 一行 36px：来源标记（logo + CoveTask）→ 任务名 → 优先级胶囊 → 状态胶囊 → 选已有。
 * 颜色只有一处来源：优先级语义色（与任务卡同一套 P0 红 / P1 橙 / P2 蓝 / P3 灰），
 * 其余全部是宿主令牌，明暗两套自动跟随。
 */
export const STYLE_ID = 'dsh-cove-task-task-create-style'

export const CSS = `
.ftc-dock {
  position: relative;
  box-sizing: border-box;
  width: calc(
    100% -
    var(--dsh-composer-side-clearance, 0px) -
    var(--dsh-composer-side-clearance, 0px) -
    var(--dsh-composer-dock-inset, 0px) -
    var(--dsh-composer-dock-inset, 0px) -
    var(--dsh-composer-dock-inset, 0px) -
    var(--dsh-composer-dock-inset, 0px)
  );
  margin: 0 auto;
  /* 默认灰：没选优先级 / 绑定态任务没有优先级时都用它 */
  --ftc-prio: var(--dsw-alias-label-tertiary);
}

/*
 * 优先级语义色：与任务卡（taskCardStyles）完全一致的四个值。
 * 这是**语义色**，不是装饰色；只允许出现在这个映射里，其它地方一律用 var(--ftc-prio)。
 */
.ftc-dock[data-prio="P0"] { --ftc-prio: #e5484d; }
.ftc-dock[data-prio="P1"] { --ftc-prio: #f59e0b; }
.ftc-dock[data-prio="P2"] { --ftc-prio: #3b82f6; }
.ftc-dock[data-prio="P3"] { --ftc-prio: #94a3b8; }

.ftc-bar {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: calc(var(--dsh-composer-card-max-width, 100%) - 4 * var(--dsh-composer-dock-inset, 0px));
  height: 36px;
  margin: 0 auto;
  padding: 0 8px 0 11px;
  border: 1px solid color-mix(in oklab, var(--dsw-alias-border-l2) 55%, transparent);
  border-radius: 9px;
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-1) 68%, transparent);
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(12px));
}

/* 勾选后左缘一条优先级色带：一眼看出「这条会话是几档任务」。 */
.ftc-edge {
  position: absolute;
  top: 7px;
  bottom: 7px;
  left: 0;
  width: 3px;
  border-radius: 3px;
  background: var(--ftc-prio);
  opacity: 0;
  transition: opacity .14s ease;
  pointer-events: none;
}

.ftc-dock[data-on="1"] .ftc-edge {
  opacity: 1;
}

/* 图块 = 开关：未勾选是插件 logo（来源标记），勾选后是优先级色底上的动作图标。 */
.ftc-tile {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: color-mix(in oklab, var(--dsw-alias-label-primary) 7%, transparent);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background-color .14s ease, color .14s ease, transform .1s ease;
}

.ftc-tile:hover {
  background: color-mix(in oklab, var(--dsw-alias-label-primary) 11%, transparent);
}

.ftc-tile:active {
  transform: scale(.94);
}

.ftc-tile:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

.ftc-dock[data-on="1"] .ftc-tile {
  background: color-mix(in oklab, var(--ftc-prio) 16%, transparent);
  color: var(--ftc-prio);
}

.ftc-logo {
  display: block;
  width: 16px;
  height: 16px;
  object-fit: contain;
}

/* 来源标记：插件名，字号比任务名小一档。 */
.ftc-brand {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .02em;
  line-height: 1;
  white-space: nowrap;
}

.ftc-sep {
  flex: none;
  width: 1px;
  height: 12px;
  background: color-mix(in oklab, var(--dsw-alias-border-l2) 80%, transparent);
}

.ftc-body {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  height: 22px;
}

.ftc-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12.5px;
  line-height: 20px;
}

.ftc-input::placeholder {
  color: var(--dsw-alias-label-tertiary);
}

/* 未勾选时的整行提示：点一下就勾上并聚焦名字。 */
.ftc-ph {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.ftc-ph:hover {
  color: var(--dsw-alias-label-secondary);
}

.ftc-ph:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
  border-radius: 4px;
}

/* 绑定态：T<号> · 标题 的只读胶囊（扁平，不再伪装成输入框）。 */
.ftc-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  height: 22px;
}

.ftc-chip-no {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, Menlo, monospace;
  font-size: 10.5px;
  letter-spacing: .04em;
}

.ftc-chip-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
}

.ftc-chip-clear {
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.ftc-chip-clear:hover {
  background: color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent);
  color: var(--dsw-alias-label-primary);
}

/* 优先级胶囊：底色是优先级色 14%，字与图标同色。 */
.ftc-prio-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 20px;
  padding: 0 7px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in oklab, var(--ftc-prio) 14%, transparent);
  color: var(--ftc-prio);
  font: inherit;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: .02em;
  cursor: pointer;
}

.ftc-prio-pill:hover {
  background: color-mix(in oklab, var(--ftc-prio) 22%, transparent);
}

.ftc-prio-pill.is-static {
  cursor: default;
}

.ftc-prio-pill:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

/* 状态胶囊：绑定后到发出第一条消息之间是「待绑定」。 */
.ftc-pill-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--dsw-alias-state-idle-primary) 14%, transparent);
  color: var(--dsw-alias-state-idle-primary);
  font-size: 10.5px;
  font-weight: 500;
}

/* 选已有任务：一个图标按钮。 */
.ftc-act {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background-color .14s ease, color .14s ease;
}

.ftc-act:hover,
.ftc-act[aria-expanded="true"] {
  background: color-mix(in oklab, var(--dsw-alias-label-primary) 7%, transparent);
  color: var(--dsw-alias-label-primary);
}

.ftc-act:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.ftc-start {
  display: inline-flex;
  align-items: center;
  flex: none;
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
}

.ftc-start:hover {
  opacity: .9;
}

.ftc-start:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

/* ---------- 浮层 ---------- */
.ftc-pop {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  right: 0;
  box-sizing: border-box;
  width: min(380px, 100%);
  padding: 6px;
  border: 1px solid color-mix(in oklab, var(--dsw-alias-border-l2) 55%, transparent);
  border-radius: 12px;
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay));
  box-shadow: 0 12px 32px color-mix(in oklab, var(--dsw-alias-label-primary) 12%, transparent);
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(12px));
}

.ftc-pop-head {
  padding: 2px 2px 6px;
}

.ftc-search {
  box-sizing: border-box;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-1) 60%, transparent);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  outline: 0;
}

.ftc-search:focus {
  border-color: var(--dsw-alias-brand-primary);
}

.ftc-cands {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 262px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.ftc-cand {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.ftc-cand.is-active {
  background: color-mix(in oklab, var(--dsw-alias-label-primary) 7%, transparent);
}

.ftc-cand.is-new {
  color: var(--dsw-alias-label-secondary);
}

.ftc-cand-no {
  flex: none;
  min-width: 44px;
  color: var(--dsw-alias-label-tertiary);
  font-family: ui-monospace, Menlo, monospace;
  font-size: 10.5px;
}

.ftc-cand-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ftc-cand-prio {
  flex: none;
  padding: 0 5px;
  border: 1px solid color-mix(in oklab, var(--dsw-alias-border-l2) 70%, transparent);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 15px;
}

.ftc-pop-empty {
  padding: 10px 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11.5px;
}

.ftc-pop-foot {
  margin-top: 4px;
  padding: 6px 6px 2px;
  border-top: 1px solid color-mix(in oklab, var(--dsw-alias-border-l2) 45%, transparent);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.ftc-pop-more {
  padding: 8px;
}

.ftc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px;
}

.ftc-row-label {
  flex: none;
  width: 44px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}

.ftc-select {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-1) 60%, transparent);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.ftc-select:disabled {
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .ftc-edge,
  .ftc-tile,
  .ftc-act {
    transition: none !important;
  }
}
`

export function injectStyles(doc) {
  if (!doc || typeof doc.createElement !== 'function') return
  if (doc.getElementById && doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.setAttribute('id', STYLE_ID)
  style.textContent = CSS
  if (doc.head && typeof doc.head.appendChild === 'function') doc.head.appendChild(style)
}
