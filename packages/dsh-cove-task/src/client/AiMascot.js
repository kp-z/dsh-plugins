/**
 * AI 诊断卡上的「海湾小助手」：一只跟着状态变表情的小家伙。
 *
 * 为什么自己画、不用现成素材：
 * - 插件要离线可用，不能引 CDN / 远程图；内联 SVG 没有网络依赖。
 * - 宿主有明暗两套主题，素材里的固定色块会「花」；这里的每一笔都走 --fd-* 令牌，
 *   跟着主题和品牌色一起变。
 * - 只有 4 个状态（待命 / 思考 / 开心 / 提醒），手写比引一个 10 万字的头像库轻。
 *
 * 参考方向（仅风格，不含其代码）：DiceBear 一类「拟人头像 + 状态表情」的做法，
 * 其代码 MIT、42 个风格 CC0，但都是固定配色的成品，不适合双主题宿主。
 */
export const AI_MOODS = ['calm', 'thinking', 'happy', 'alert']

const MOOD_LABEL = {
  calm: '待命中',
  thinking: '正在想',
  happy: '看到好的一面',
  alert: '有需要处理的事',
}

/** 眼睛：开心时是弯的，提醒时带一点皱眉，其余是圆点。 */
function eyes(h, mood) {
  if (mood === 'happy') {
    return h('g', { className: 'fd-bot-eyes' },
      h('path', { className: 'fd-bot-eye-arc', d: 'M35.5 50q4.5-5 9 0' }),
      h('path', { className: 'fd-bot-eye-arc', d: 'M51.5 50q4.5-5 9 0' }))
  }
  return h('g', { className: 'fd-bot-eyes' },
    h('circle', { className: 'fd-bot-eye', cx: 40, cy: mood === 'thinking' ? 49 : 50, r: 3.4 }),
    h('circle', { className: 'fd-bot-eye', cx: 56, cy: mood === 'thinking' ? 49 : 50, r: 3.4 }),
    mood === 'alert'
      ? h('g', { className: 'fd-bot-brows' },
        h('path', { d: 'M34.5 42.5l8 2' }),
        h('path', { d: 'M61.5 42.5l-8 2' }))
      : null)
}

/** 嘴：开心张嘴笑，提醒是小小的「哦」，其余是浅浅一笑。 */
function mouth(h, mood) {
  if (mood === 'happy') return h('path', { className: 'fd-bot-mouth', d: 'M42 59q6 6 12 0' })
  if (mood === 'alert') return h('ellipse', { className: 'fd-bot-mouth is-shape', cx: 48, cy: 62, rx: 2.6, ry: 3.2 })
  if (mood === 'thinking') return h('path', { className: 'fd-bot-mouth', d: 'M45 61q3 1.6 6 0' })
  return h('path', { className: 'fd-bot-mouth', d: 'M44 60q4 3.4 8 0' })
}

/**
 * 渲染小助手。只吃 `h` 和心情，不读全局状态，方便单测直接断言结构。
 */
export function aiMascot(h, mood) {
  const kind = AI_MOODS.includes(mood) ? mood : 'calm'
  return h('svg', {
    className: 'fd-bot is-' + kind,
    viewBox: '0 0 96 96',
    role: 'img',
    'aria-label': 'AI 小助手：' + MOOD_LABEL[kind],
  },
    /* 思考时转的虚线圈：不占位，只在思考态显形 */
    h('circle', { className: 'fd-bot-ring', cx: 48, cy: 48, r: 45 }),
    /* 头顶天线：待命常亮、思考快闪、提醒换警示色 */
    h('g', { className: 'fd-bot-antenna' },
      h('path', { d: 'M48 20V11' }),
      h('circle', { className: 'fd-bot-bulb', cx: 48, cy: 9, r: 3.4 })),
    /* 身体 */
    h('g', { className: 'fd-bot-body' },
      h('path', {
        className: 'fd-bot-head',
        d: 'M48 20c16.6 0 29 11.4 29 26.6v5.8C77 68.6 65 79 48 79S19 68.6 19 52.4v-5.8C19 31.4 31.4 20 48 20Z',
      }),
      h('path', { className: 'fd-bot-glint', d: 'M32 38c3-4 7.4-6 12-6.2' }),
      h('circle', { className: 'fd-bot-cheek', cx: 32, cy: 60, r: 3.6 }),
      h('circle', { className: 'fd-bot-cheek', cx: 64, cy: 60, r: 3.6 }),
      eyes(h, kind),
      mouth(h, kind)),
    /* 思考时的三个小气泡 */
    h('g', { className: 'fd-bot-think' },
      h('circle', { cx: 74, cy: 30, r: 2.2 }),
      h('circle', { cx: 81, cy: 23, r: 1.8 }),
      h('circle', { cx: 87, cy: 15, r: 1.4 })),
    h('ellipse', { className: 'fd-bot-shadow', cx: 48, cy: 89, rx: 19, ry: 2.6 }))
}

export default aiMascot
