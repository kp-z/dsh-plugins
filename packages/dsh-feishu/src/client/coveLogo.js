/**
 * 海湾的 logo —— cove（github.com/kp-z/cove）的品牌主标：青绿色的「海湾」漩涡。
 *
 * 源图 code/frontend/public/cove-logo.png 是 2048×2048（883KB），这里裁掉透明边、
 * 缩到 128×128（22KB）随包发（logo.png），面板与独立页共用同一张。
 * 不做成内联 path：它是一个带渐变的插画标，矢量化会失真。
 */

export function coveMark(h, size = 28) {
  return h('img', {
    className: 'fo-brand-mark',
    src: '/dsh-feishu/logo.png',
    width: size,
    height: size,
    alt: '',
    'aria-hidden': 'true',
    draggable: false,
  })
}
