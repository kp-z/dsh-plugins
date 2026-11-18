/**
 * 任务卡样式（只作用于 .tc-scope 里）。
 *
 * 从 panel.html 的 .task / .chip / .badge / .prio / .sess-inline … 规则搬过来，
 * 选择器统一加 `.tc-scope` 前缀（不污染面板其它区域），颜色从 --p-* 换成
 * `var(--tc-x, var(--p-x))`：面板不设 --tc-* 时行为完全不变；关系画布只要在容器上
 * 定义 --tc-*（从宿主令牌或 --fo-* 映射），同一份样式就能在 SVG 的 foreignObject 里照常生效。
 *
 * 用法：
 *   const node = document.createElement('div')
 *   node.className = 'tc-scope'
 *   node.innerHTML = '<style>' + taskCardStyles() + '</style>'
 *   node.appendChild(renderTaskCard(model, deps))
 */
export const TASK_CARD_SCOPE = 'tc-scope'

export const TASK_CARD_STYLES = `
.tc-scope .task-body > .task-card-comments { flex: 1 0 100%; min-width: 0; }
.tc-scope .task-card-comments { border-top: 1px solid var(--tc-line, var(--p-line)); padding-top: 8px; }
.tc-scope .task-card-comments[hidden], .tc-scope .task-card-comments button[hidden] { display: none; }
.tc-scope .task-card-comments button:focus-visible { outline: 2px solid var(--tc-accent, var(--p-accent)); outline-offset: 2px; }
.tc-scope .badge {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
  }
.tc-scope .badge-ok {
    background: var(--tc-ok-weak, var(--p-ok-weak));
    border-color: var(--tc-ok-line, var(--p-ok-line));
    color: var(--tc-ok, var(--p-ok));
  }
.tc-scope .badge-warn {
    background: var(--tc-warn-weak, var(--p-warn-weak));
    border-color: var(--tc-warn-line, var(--p-warn-line));
    color: var(--tc-warn, var(--p-warn));
  }
.tc-scope .badge-new {
    background: var(--tc-accent-weak, var(--p-accent-weak));
    border-color: var(--tc-accent-line, var(--p-accent-line));
    color: var(--tc-accent-text, var(--p-accent-text));
  }
.tc-scope .badge-done {
    background: var(--tc-sub, var(--p-sub));
    border-color: var(--tc-line, var(--p-line));
    color: var(--tc-text-3, var(--p-text-3));
  }
.tc-scope .task {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    /* 左右从 10px 收到 6px：卡片本来就窄，10px 两侧留白吃掉了一截可用宽度（用户口径）。 */
    padding: 7px 6px 8px;
    border: 1px solid var(--tc-line, var(--p-line));
    border-radius: 9px;
    background: var(--tc-card, var(--p-card));
    box-shadow: var(--tc-shadow, var(--p-shadow));
    min-width: 0;
    transition: border-color .12s ease, box-shadow .12s ease;
  }
.tc-scope .task:hover {
    border-color: var(--tc-line-hover, var(--p-line-hover));
    box-shadow: 0 2px 8px rgba(17, 24, 39, .07);
  }
.tc-scope .task-body {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
  }
.tc-scope .task-main {
    flex: 1 1 auto;
    min-width: 0;
  }
.tc-scope .task-title {
    display: block;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12.5px;
    font-weight: 500;
    line-height: 1.4;
    color: var(--dsw-alias-label-primary, var(--tc-text, var(--p-text)));
  }
.tc-scope .task-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin-top: 4px;
    font-size: 11px;
    gap: 5px 8px;
    margin-top: 5px;
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--tc-text-3, var(--p-text-3));
    word-break: break-word;
  }
.tc-scope .task-err {
    margin-top: 5px;
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--tc-danger, var(--p-danger));
    word-break: break-word;
    overflow-wrap: anywhere;
  }
.tc-scope .task[data-priority] {
    border-left-width: 3px;
    border-left-style: solid;
  }
.tc-scope .task[data-priority="P0"] { border-left-color: #e5484d; }
.tc-scope .task[data-priority="P1"] { border-left-color: #f59e0b; }
.tc-scope .task[data-priority="P2"] { border-left-color: #3b82f6; }
.tc-scope .task[data-priority="P3"] { border-left-color: #94a3b8; }
.tc-scope .prio {
    position: relative;
    isolation: isolate;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 26px;
    height: 18px;
    padding: 0 5px;
    border: 0;
    border-radius: 5px;
    font: inherit;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.03em;
    line-height: 1;
    color: #fff;
    cursor: pointer;
    background: #8b8f9a;
    transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease;
  }
.tc-scope .prio:hover { filter: brightness(1.08); transform: translateY(-1px); }
.tc-scope .prio:focus-visible { outline: 2px solid var(--tc-accent, var(--p-accent)); outline-offset: 1px; }
.tc-scope .prio[data-value="P0"] { background: #e5484d; box-shadow: 0 0 0 3px rgb(229 72 77 / 0.18); }
.tc-scope .prio[data-value="P1"] { background: #f59e0b; }
.tc-scope .prio[data-value="P2"] { background: #3b82f6; }
.tc-scope .prio[data-value="P3"] { background: #94a3b8; }
.tc-scope .prio-empty {
    background: transparent;
    border: 1px dashed var(--p-line-strong, var(--tc-line, var(--p-line)));
    color: var(--tc-text-3, var(--p-text-3));
    font-weight: 600;
  }
.tc-scope .prio-empty:hover { border-color: var(--tc-accent, var(--p-accent)); color: var(--tc-accent, var(--p-accent)); }
.tc-scope .prio.is-running::before {
    content: '';
    position: absolute;
    inset: -3px;
    border: 2px solid var(--tc-accent, var(--p-accent));
    border-radius: 8px;
    pointer-events: none;
    animation: priority-breathe 1.6s ease-in-out infinite;
  }
.tc-scope .prio.is-unread::after {
    content: '';
    position: absolute;
    top: -4px;
    right: -4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tc-ok, var(--p-ok));
    border: 2px solid var(--tc-card, var(--p-card));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--tc-ok, var(--p-ok)) 45%, transparent);
    pointer-events: none;
  }
.tc-scope .chip-attrib { border-color: var(--tc-accent-line, var(--p-accent-line)); color: var(--tc-text, var(--p-text)); background: var(--tc-accent-weak, var(--p-accent-weak)); }
.tc-scope .task-head {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
.tc-scope .task-head .task-title { flex: 1 1 auto; min-width: 0; }
.tc-scope .sess-inline.is-running {
    border-color: color-mix(in srgb, var(--tc-accent, var(--p-accent)) 40%, transparent);
    color: var(--tc-accent-text, var(--p-accent-text));
  }
.tc-scope .sess-inline .lamp {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: 0 0 auto;
    background: var(--tc-text-3, var(--p-text-3));
    box-shadow: 0 0 0 0 transparent;
  }
.tc-scope .sess-inline .lamp-running {
    background: var(--tc-accent, var(--p-accent));
    animation: lamp-pulse 1.3s ease-in-out infinite;
  }
.tc-scope .sess-inline .lamp-unread { background: var(--tc-ok, var(--p-ok)); }
.tc-scope .sess-inline .lamp-idle { background: color-mix(in srgb, var(--tc-ok, var(--p-ok)) 45%, transparent); }
.tc-scope .sess-inline {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 16ch;
    padding: 1px 6px;
    border: 1px solid var(--tc-line, var(--p-line));
    border-radius: 999px;
    background: var(--p-sub, rgba(127, 127, 127, 0.08));
    color: var(--tc-text-3, var(--p-text-3));
    font: inherit;
    font-size: 10px;
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
.tc-scope .sess-inline:hover {
    color: var(--tc-accent, var(--p-accent));
    border-color: var(--tc-accent, var(--p-accent));
  }
.tc-scope .sess-inline:hover {
    opacity: 1;
    color: var(--tc-accent-text, var(--p-accent-text));
    text-decoration: underline;
  }
.tc-scope .badge-auto {
    color: var(--p-accent, #0b5fd8);
    border-color: currentColor;
    opacity: .9;
  }
.tc-scope .badge-warn {
    color: var(--p-warn, #b25e00);
    border-color: currentColor;
  }
.tc-scope .hint-sub {
    margin-top: 3px;
    color: var(--p-text-3, #8a8a92);
    font-size: 10.5px;
    line-height: 1.5;
  }
.tc-scope .hint code {
    padding: 0 3px;
    border-radius: 3px;
    background: var(--tc-sub, var(--p-sub));
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10.5px;
  }
.tc-scope .people-group {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
  }
.tc-scope .avatar {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--tc-sub, var(--p-sub));
    border: 1px solid var(--tc-line, var(--p-line));
    font-size: 9px;
    font-weight: 600;
    color: var(--tc-text-2, var(--p-text-2));
    flex: 0 0 auto;
  }
.tc-scope .avatar.is-anon { color: var(--tc-text-3, var(--p-text-3)); }
.tc-scope .avatar.is-anon::before { content: ""; position: absolute; left: 50%; top: 3px; width: 5px; height: 5px; margin-left: -2.5px; border-radius: 50%; background: currentColor; }
.tc-scope .avatar.is-anon::after { content: ""; position: absolute; left: 50%; bottom: 2px; width: 9px; height: 4px; margin-left: -4.5px; border-radius: 5px 5px 0 0; background: currentColor; }
.tc-scope .avatar.lead { border-color: var(--p-accent, #0b5fd8); }
.tc-scope .avatar.more { font-weight: 500; }
.tc-scope .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
.tc-scope .people-role-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; margin-right: 2px; color: var(--tc-text-3, var(--p-text-3)); line-height: 1; cursor: help; }
.tc-scope .people-group .avatar:focus-visible, .tc-scope .people-role-icon:focus-visible { outline: 2px solid var(--tc-accent, var(--p-accent)); outline-offset: 2px; }
.tc-scope .people-group + .people-group { margin-left: 5px; }
.tc-scope .people-group[aria-label="负责人"] .avatar { border-color: color-mix(in srgb, var(--tc-accent, var(--p-accent)) 45%, var(--tc-line, var(--p-line))); }
.tc-scope .chip {
    max-width: 100%;
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid var(--tc-line, var(--p-line));
    background: var(--tc-sub, var(--p-sub));
    font-size: 10px;
    line-height: 1.6;
    color: var(--tc-text-2, var(--p-text-2));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
.tc-scope .chip-doc {
    cursor: pointer;
    color: var(--tc-accent-text, var(--p-accent-text));
    border-color: var(--tc-accent-line, var(--p-accent-line));
    background: var(--tc-accent-weak, var(--p-accent-weak));
  }
.tc-scope .chip-doc:hover { text-decoration: underline; }
.tc-scope .task.task-current {
    
    --current: var(--tone, var(--tc-select, var(--p-select)));
    border-color: var(--current);
    
    box-shadow: var(--tc-shadow, var(--p-shadow)), 0 0 0 1px var(--current);
    
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--current) 12%, transparent), rgba(0, 0, 0, 0) 72%),
      var(--tc-card, var(--p-card));
    animation: task-current-pulse 2s ease-in-out infinite;
  }
.tc-scope .badge.badge-current {
    
    color: var(--tc-text-1, var(--p-text-1));
    border: 1px solid color-mix(in srgb, var(--current, var(--tc-select, var(--p-select))) 55%, transparent);
    background: color-mix(in srgb, var(--current, var(--tc-select, var(--p-select))) 16%, transparent);
    font-weight: 600;
  }
.tc-scope .task.task-current .task-title {
    font-weight: 600;
  }
.tc-scope .task-docs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-top: 5px;
  }
.tc-scope .doc-chip-group {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    border: 1px solid var(--tc-accent-line, var(--p-accent-line));
    border-radius: 999px;
    background: var(--tc-accent-weak, var(--p-accent-weak));
    overflow: hidden;
  }
.tc-scope .doc-chip-group .doc-link-input {
    width: 250px;
    max-width: 100%;
  }
.tc-scope .doc-chip-group .doc-open {
    border: 0;
    border-radius: 0;
    background: transparent;
    max-width: 240px;
  }
.tc-scope .doc-chip-group .doc-open:hover { text-decoration: underline; }
.tc-scope .doc-tool {
    flex: 0 0 auto;
    padding: 0 5px;
    border: 0;
    background: transparent;
    font-size: 10px;
    line-height: 1.6;
    color: var(--tc-text-3, var(--p-text-3));
    cursor: pointer;
  }
.tc-scope .doc-tool:hover { color: var(--tc-text-1, var(--p-text-1)); background: var(--p-hover, transparent); }
.tc-scope .doc-tool:disabled { opacity: 0.45; cursor: default; }
.tc-scope .doc-tool-del:hover { color: var(--tc-danger, var(--p-danger)); }
.tc-scope .chip-doc-add {
    padding: 0 7px;
    border: 1px dashed var(--tc-line, var(--p-line));
    border-radius: 999px;
    background: transparent;
    font-size: 10px;
    line-height: 1.6;
    color: var(--tc-text-3, var(--p-text-3));
    cursor: pointer;
  }
.tc-scope .chip-doc-add:hover {
    color: var(--tc-accent-text, var(--p-accent-text));
    border-color: var(--tc-accent-line, var(--p-accent-line));
    background: var(--tc-accent-weak, var(--p-accent-weak));
  }
.tc-scope .chip-doc-add:disabled { opacity: 0.45; cursor: default; }
.tc-scope .chip-trigger { font-weight: 500; }
.tc-scope .chip-auto { color: var(--tc-accent-text, var(--p-accent-text)); border-color: var(--tc-accent-line, var(--p-accent-line)); background: var(--tc-accent-weak, var(--p-accent-weak)); }
.tc-scope .chip-scheduled { color: var(--tc-warn, var(--p-warn)); border-color: var(--tc-warn-line, var(--p-warn-line)); background: var(--tc-warn-weak, var(--p-warn-weak)); }
.tc-scope .chip-manual { color: var(--tc-text-2, var(--p-text-2)); }
.tc-scope .chip-time { font-variant-numeric: tabular-nums; }
.tc-scope .chip-list {
    color: var(--tc-text-1, var(--p-text-1));
    font-weight: 500;
  }
.tc-scope .chip-sched {
    cursor: pointer;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
  }
.tc-scope .chip-sched:hover {
    border-color: var(--tc-accent-line, var(--p-accent-line));
    color: var(--tc-accent-text, var(--p-accent-text));
  }
.tc-scope .chip-sched-empty {
    border-style: dashed;
    color: var(--tc-text-3, var(--p-text-3));
    background: transparent;
  }
.tc-scope .chip-sched.is-paused { opacity: 0.62; }
.tc-scope .chip-sched.is-locked { opacity: 0.45; cursor: not-allowed; border-style: dashed; }
.tc-scope .chip-eta {
    cursor: pointer;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
  }
.tc-scope .chip-eta:hover {
    border-color: var(--tc-accent-line, var(--p-accent-line));
    color: var(--tc-accent-text, var(--p-accent-text));
  }
.tc-scope .chip-eta-empty {
    border-style: dashed;
    color: var(--tc-text-3, var(--p-text-3));
    background: transparent;
  }
.tc-scope .chip-eta.is-bad {
    color: var(--tc-danger, var(--p-danger));
    border-color: var(--tc-danger-line, var(--p-danger-line));
    background: var(--tc-danger-weak, var(--p-danger-weak));
  }
.tc-scope .chip-eta.is-warn {
    color: var(--tc-warn, var(--p-warn));
    border-color: var(--tc-warn-line, var(--p-warn-line));
    background: var(--tc-warn-weak, var(--p-warn-weak));
  }
.tc-scope .chip-eta.is-good {
    color: var(--tc-ok, var(--p-ok));
    border-color: var(--tc-ok-line, var(--p-ok-line));
    background: var(--tc-ok-weak, var(--p-ok-weak));
  }
.tc-scope .chip-eta.is-muted { color: var(--tc-text-3, var(--p-text-3)); }
.tc-scope .chip-eta-sync {
    margin-left: 4px;
    padding: 0 3px;
    border-radius: 3px;
    background: var(--tc-warn-weak, var(--p-warn-weak));
    color: var(--tc-warn, var(--p-warn));
    font-size: 9px;
    line-height: 1.5;
  }
.tc-scope .task-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
  }
.tc-scope .task-body { flex-wrap: wrap; }
.tc-scope .task-body > .task-actions { flex: 1 0 100%; min-width: 0; flex-wrap: wrap; border-top: 1px solid var(--tc-line, var(--p-line)); padding-top: 5px; }
.tc-scope .task-action-spacer { flex: 1; }
.tc-scope .task-text-action { background: none; border: 0; padding: 3px 2px; color: var(--tc-text-2, var(--p-text-2)); font: inherit; font-size: 11px; cursor: pointer; }
.tc-scope .task-text-action:hover, .tc-scope .task-text-action:focus-visible { color: var(--tc-text-1, var(--p-text-1)); outline-color: var(--tc-accent-line, var(--p-accent-line)); }
.tc-scope .task-text-action:disabled { opacity: .45; cursor: default; }
.tc-scope .relation-preview { margin: 5px 0; color: var(--tc-text-2, var(--p-text-2)); }
.tc-scope .relation-line { display: flex; align-items: center; flex-wrap: wrap; gap: 3px; min-width: 0; }
.tc-scope .relation-node { background: var(--tc-sub, var(--p-sub)); border: 1px solid var(--tc-line, var(--p-line)); border-radius: 6px; padding: 2px 6px; color: var(--tc-text-2, var(--p-text-2)); font-size: 10px; font-weight: 400; line-height: 1.6; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.tc-scope .relation-arrow { display: inline-block; position: relative; width: 20px; min-width: 20px; height: 10px; font-size: 0; }
.tc-scope .relation-arrow::before { content: ''; position: absolute; left: 0; right: 2px; top: 5px; border-top: 1px solid var(--tc-text-2, var(--p-text-2)); }
.tc-scope .relation-arrow::after { content: ''; position: absolute; right: 2px; top: 3px; width: 4px; height: 4px; border-top: 1px solid var(--tc-text-2, var(--p-text-2)); border-right: 1px solid var(--tc-text-2, var(--p-text-2)); transform: rotate(45deg); }
.tc-scope .relation-provenance .relation-arrow::before { border-top-style: dashed; }
.tc-scope .relation-current { font-weight: 400; }
.tc-scope .relation-selection { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
@keyframes task-current-pulse {
    0%, 100% {
      box-shadow: var(--tc-shadow, var(--p-shadow)), 0 0 0 1px var(--current);
    }
    50% {
      box-shadow: var(--tc-shadow, var(--p-shadow)), 0 0 0 2px var(--current),
        0 2px 14px color-mix(in srgb, var(--current) 40%, transparent);
    }
  }
@keyframes priority-breathe {
    0%, 100% { opacity: .95; transform: scale(1); box-shadow: 0 0 0 1px color-mix(in srgb, var(--tc-accent, var(--p-accent)) 25%, transparent); }
    50% { opacity: .4; transform: scale(1.1); box-shadow: 0 0 10px 3px color-mix(in srgb, var(--tc-accent, var(--p-accent)) 35%, transparent); }
  }
@keyframes lamp-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--tc-accent, var(--p-accent)) 45%, transparent); opacity: 1; }
    70% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--tc-accent, var(--p-accent)) 0%, transparent); opacity: .85; }
  }
`.trim()

/* 菜单挂在 body 上（不在 .tc-scope 里），所以用独立的 .tc-menu 作用域，令牌口径同上。 */
export const TASK_MENU_STYLES = `
.tc-menu {
  position: fixed;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 116px;
  padding: 4px;
  border: 1px solid var(--tc-line, var(--p-line, rgba(127, 127, 127, .24)));
  border-radius: 10px;
  background: var(--tc-card, var(--p-card, #fff));
  box-shadow: 0 10px 28px rgb(0 0 0 / .16);
}
.tc-menu .prio-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tc-text, var(--p-text, #333));
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.tc-menu .prio-item:hover { background: var(--tc-sub, var(--p-sub, rgba(127, 127, 127, .08))); }
.tc-menu .prio-item.is-current { background: var(--tc-accent-weak, var(--p-accent-weak, rgba(59, 91, 219, .1))); }
.tc-menu .prio-item .dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  background: #8b8f9a;
}
.tc-menu .prio-item[data-value="P0"] .dot { background: #e5484d; }
.tc-menu .prio-item[data-value="P1"] .dot { background: #f59e0b; }
.tc-menu .prio-item[data-value="P2"] .dot { background: #3b82f6; }
.tc-menu .prio-item[data-value="P3"] .dot { background: #94a3b8; }

.tc-menu .task-text-action { display: block; width: 100%; text-align: left; padding: 6px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--tc-text, var(--p-text, #333)); font: inherit; font-size: 12px; cursor: pointer; }
.tc-menu .task-text-action:hover { background: var(--tc-sub, var(--p-sub, rgba(127, 127, 127, .08))); }
.tc-menu .chip-pop-row { justify-content: flex-end; }
.tc-menu .chip-pop-row .task-text-action { width: auto; flex: 0 0 auto; }
.tc-menu .btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  border: 1px solid var(--tc-line, var(--p-line, rgba(127, 127, 127, .24)));
  border-radius: 6px; background: transparent; color: var(--tc-text, var(--p-text, #333));
  font: inherit; font-size: 12px; cursor: pointer;
}
.tc-menu .btn:hover { background: var(--tc-sub, var(--p-sub, rgba(127, 127, 127, .08))); }
.tc-menu .btn-primary {
  border-color: var(--tc-accent, var(--p-accent));
  background: var(--tc-accent, var(--p-accent));
  color: var(--dsw-alias-label-primary-foreground, var(--tc-text, var(--p-text, #fff)));
}
.tc-menu .btn-primary:hover { filter: brightness(1.06); }
.tc-menu .btn-xs { height: 24px; padding: 0 8px; font-size: 11px; }
.tc-menu .task-text-action.is-danger:hover { color: var(--tc-danger, var(--p-danger, #d33)); }
.tc-menu .task-text-action.is-current { background: var(--tc-accent-weak, var(--p-accent-weak, rgba(59, 91, 219, .1))); }
.tc-menu .tc-menu-sep { height: 1px; margin: 3px 4px; background: var(--tc-line, var(--p-line, rgba(127, 127, 127, .2))); }
.tc-menu.ws-menu { min-width: min(240px, calc(100vw - 16px)); max-height: min(320px, calc(100vh - 16px)); overflow-y: auto; }
.tc-menu .prio-item .ws-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: var(--tc-text-3, var(--p-text-3, #999)); }
.tc-menu .prio-item .ws-label { display: flex; flex-direction: column; min-width: 0; text-align: left; }
.tc-menu .prio-item .ws-path { display: block; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--tc-text-3, var(--p-text-3, #888)); }
.tc-menu.chip-pop { width: min(300px, calc(100vw - 16px)); padding: 10px; font-size: 11.5px; line-height: 1.5; }
.tc-menu .chip-pop-title { font-size: 12px; font-weight: 600; margin-bottom: 6px; }
.tc-menu .chip-pop-sub { margin-bottom: 6px; color: var(--tc-text-3, var(--p-text-3, #888)); }
.tc-menu input[type="text"], .tc-menu input[type="url"], .tc-menu input[type="date"], .tc-menu input[type="datetime-local"] {
  box-sizing: border-box; width: 100%; padding: 6px; border: 1px solid var(--tc-line, var(--p-line, rgba(127, 127, 127, .3)));
  border-radius: 5px; background: var(--tc-bg, var(--p-bg, transparent)); color: var(--tc-text, var(--p-text, inherit)); font: inherit;
  color-scheme: light dark;
}
.tc-menu .chip-pop-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tc-menu .chip-pop-msg { margin-top: 6px; color: var(--tc-text-2, var(--p-text-2, #666)); word-break: break-word; }
.tc-menu .chip-pop-msg.is-err { color: var(--tc-danger, var(--p-danger, #d33)); }
.tc-menu .chip-pop-warn { margin-top: 3px; color: var(--tc-warn, var(--p-warn, #b25e00)); font-size: 11px; }
.tc-menu .hint { color: var(--tc-text-3, var(--p-text-3, #888)); font-size: 10.5px; }
`.trim()

export function taskCardStyles() {
  return TASK_CARD_STYLES
}

export function taskMenuStyles() {
  return TASK_MENU_STYLES
}

export default taskCardStyles

/** 画布/独立页的 <style> 注入点：同一份样式只插一次（面板有旧 CSS，不走这里）。 */
export const TASK_CARD_STYLE_ID = 'dsh-cove-task-task-card-styles'

export function ensureTaskCardStyles(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null)
  if (!d || typeof d.getElementById !== 'function' || typeof d.createElement !== 'function') return false
  if (d.getElementById(TASK_CARD_STYLE_ID)) return true
  const style = d.createElement('style')
  style.id = TASK_CARD_STYLE_ID
  style.textContent = TASK_CARD_STYLES + '\n' + TASK_MENU_STYLES
  const parent = d.head || d.documentElement
  if (!parent || typeof parent.appendChild !== 'function') return false
  parent.appendChild(style)
  return true
}
