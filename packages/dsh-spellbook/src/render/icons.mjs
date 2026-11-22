/**
 * 书里所有的图标。一处定义，页面与脚本共用同一套笔画。
 *
 * 规矩只有两条：
 *  1. 全部是 24 格的线稿，颜色走 currentColor —— 明暗两套主题不用各写一份；
 *  2. 笔画粗细在 CSS 里统一（.icon），这里只管形状。
 */

const PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.6" cy="6.5" r=".8"/><circle cx="4.6" cy="12" r=".8"/><circle cx="4.6" cy="17.5" r=".8"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  sparkle: '<path d="M12 3.5 13.9 10l6.6 2-6.6 2L12 20.5 10.1 14 3.5 12l6.6-2z"/>',
  // —— 章（分类）图标 ——
  材质: '<path d="M6 3.5h12l3.5 5.5L12 20.5 2.5 9z"/><path d="M2.5 9h19M9 3.5 7.5 9 12 20.5 16.5 9 15 3.5"/>',
  动效: '<path d="M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5z"/>',
  排版: '<path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6"/>',
  交互: '<path d="m5 3.5 14 7-6 2.2-2.2 6.3z"/>',
  布局: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.4"/><path d="M3.5 9.5h17M9.5 20.5v-11"/>',
  图形: '<circle cx="7.5" cy="7.5" r="3.5"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.6"/><path d="m7.5 13.5 4 7h-8z"/>',
  组件: '<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="m2.5 12 9.5 5 9.5-5M2.5 16l9.5 5 9.5-5"/>',
  风格: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H17a4 4 0 0 0 4-4c0-4.4-4-8.2-9-8.2z"/><circle cx="7.6" cy="11" r=".9"/><circle cx="10.2" cy="7.2" r=".9"/><circle cx="14.6" cy="7.2" r=".9"/>',
}

export function icon(name, className = '') {
  const body = PATHS[name]
  if (!body) throw new Error('没有这个图标：' + name)
  return '<svg class="icon' + (className ? ' ' + className : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + body + '</svg>'
}

/** 复用图标：同一个图标在页面里重复几百次（卡片工具）时用 <use> 指向精灵，省下几百份路径。 */
export function iconUse(name, className = '') {
  return '<svg class="icon' + (className ? ' ' + className : '') + '" aria-hidden="true" focusable="false"><use href="#i-' + name + '"/></svg>'
}

/** 精灵：放在 body 开头一次。只收会重复很多次的那几个。 */
export function iconSprite(names) {
  return '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' + names.map((n) => '<symbol id="i-' + n + '" viewBox="0 0 24 24">' + PATHS[n] + '</symbol>').join('') + '</defs></svg>'
}

/** 书的记号：圆角底 + 一颗四角星火。底色在 CSS 里（渐变），星用 currentColor。 */
export function logo(className = 'logo') {
  return '<span class="' + className + '" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 3 14 10l7 2-7 2-2 7-2-7-7-2 7-2z"/></svg></span>'
}

/** 给站点脚本用：与页面渲染同一份笔画，不在两处各抄一遍。 */
export const ICON_PATHS = PATHS
