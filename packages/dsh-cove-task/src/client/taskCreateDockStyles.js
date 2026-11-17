/**
 * 「创建为飞书任务」勾选条 —— 与官方 composer 栈同宽、同一套宿主令牌。
 * 类名前缀 ftc-。
 */
export const STYLE_ID = 'dsh-cove-task-task-create-style'

export const CSS = `
.ftc-dock {
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
}

.ftc-bar {
  position: relative;
  isolation: isolate;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: calc(var(--dsh-composer-card-max-width, 100%) - 4 * var(--dsh-composer-dock-inset, 0px));
  min-height: 36px;
  margin: 0 auto;
  padding: 4px 12px;
  border-radius: var(--dsw-radius-md, 8px);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-panel);
}

.ftc-bar::before {
  position: absolute;
  z-index: -1;
  inset: 0;
  border-radius: inherit;
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(12px));
  content: '';
  pointer-events: none;
}

.ftc-field {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 6px 0 3px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 7px;
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-1) 52%, transparent);
  transition: border-color .14s ease, box-shadow .14s ease;
}

.ftc-field:focus-within {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--dsw-alias-brand-primary) 18%, transparent);
}

.ftc-emoji {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  transition: background-color .14s ease;
}

.ftc-emoji:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.ftc-emoji-current {
  font-size: 14px;
  line-height: 1;
}

.ftc-emoji-default {
  display: inline-flex;
  color: var(--dsw-alias-label-secondary);
}

.ftc-emoji-select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}

.ftc-emoji:focus-within {
  outline: none;
}

.ftc-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: none;
  height: 26px;
  padding: 0 9px 0 6px;
  border: 1px solid transparent;
  border-radius: 999px;
  cursor: pointer;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 24px;
  user-select: none;
  transition: background-color .14s ease, border-color .14s ease;
}

.ftc-toggle:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.ftc-toggle.is-on {
  background: color-mix(in oklab, var(--dsw-alias-brand-primary) 12%, transparent);
  border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 26%, transparent);
}

.ftc-toggle.is-on:hover {
  background: color-mix(in oklab, var(--dsw-alias-brand-primary) 16%, transparent);
}

.ftc-checkbox {
  appearance: none;
  -webkit-appearance: none;
  display: inline-grid;
  place-content: center;
  flex: none;
  width: 16px;
  height: 16px;
  margin: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  transition: background-color .14s ease, border-color .14s ease;
}

.ftc-checkbox::after {
  content: '';
  width: 3.5px;
  height: 7px;
  border: solid var(--dsw-alias-label-primary-foreground);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg) translate(-1px, -1px);
  opacity: 0;
  transition: opacity .12s ease;
}

.ftc-checkbox:checked {
  background: var(--dsw-alias-button-primary-fill);
  border-color: var(--dsw-alias-button-primary-fill);
}

.ftc-checkbox:checked::after {
  opacity: 1;
}

.ftc-label {
  white-space: nowrap;
  font-weight: 500;
}

.ftc-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}

.ftc-input::placeholder {
  color: var(--dsw-alias-label-tertiary);
}

.ftc-checkbox:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
  border-radius: var(--dsw-radius-sm, 6px);
}


/* 优先级：视觉复用任务卡的 .prio 徽标；透明 select 盖在上面出原生下拉。 */
.ftc-prio {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  /* 任务卡 .prio 的变量回退到宿主令牌，空优先级/焦点色在 composer 里也正常。 */
  --tc-line: var(--dsw-alias-border-l2);
  --tc-text-3: var(--dsw-alias-label-tertiary);
  --tc-accent: var(--dsw-alias-brand-primary);
}

.ftc-prio .prio {
  pointer-events: none;
}

.ftc-prio-select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}

.ftc-prio:focus-within {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
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
