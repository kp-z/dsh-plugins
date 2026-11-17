import { renderIcon } from './projectIcons.js'

/**
 * 侧栏卡片与关系图项目卡**共用**的三件套：图标 / 名字 / 计数。
 *
 * 为什么抽出来：用户口径是「关系图里项目的卡片和侧边栏卡片一模一样，直接复用组件」。
 * 两处都在渲染「一个项目」，只是外面包的容器不同（rail 里是树行，画布上是分组卡），
 * 所以把**内容**抽成一个纯函数，两边调用同一份，样式由同一组 `.fo-row*` class 决定。
 */
export function sideCardIcon(h, options) {
  const o = options || {}
  const icon = o.icon || 'lucide:folder'
  return h('span', {
    className: `fo-dot is-logo${o.toggle ? ' is-toggle' : ''}`,
    style: o.color ? { '--fo-c': o.color } : undefined,
    title: o.iconTitle || undefined,
    'aria-hidden': 'true',
    onClick: typeof o.onIconClick === 'function' ? o.onIconClick : undefined,
  }, renderIcon({ h }, icon, 16))
}

export function sideCardLabel(h, options) {
  const o = options || {}
  return h('span', { className: 'fo-row-label', title: o.title || undefined }, o.label)
}

export function sideCardCount(h, options) {
  const o = options || {}
  if (o.count === '' || o.count === undefined || o.count === null) return null
  return h('span', {
    className: o.className || 'fo-row-count',
    'data-kind': o.kind || undefined,
    title: o.title || undefined,
  }, String(o.count))
}

/** 卡片内容（图标 + 名字 + 计数），顺序与侧栏树行一致。 */
export function sideCardParts(h, options) {
  const o = options || {}
  return [
    sideCardIcon(h, o),
    sideCardLabel(h, o),
    sideCardCount(h, o),
  ].filter(Boolean)
}
