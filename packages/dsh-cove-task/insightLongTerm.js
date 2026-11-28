/**
 * 长期洞察：宿主侧的归一化与过期判定（纯函数、零 import）。
 *
 * 流程号：
 *   ① 样本门槛：< 14 天直接返回 null（没数据不给长期结论）
 *   ② 视角白名单：lens 只能从 5 个里选
 *   ③ 事实校验：fact 必须能在行为档案里找到（忽略空白），且含数字
 *   ④ 契约校验：falsifier 必填；action 必须是 if-then（当…就…）；metric 必须是信号名
 *   ⑤ 到期日：until 只接受 7–28 天内的 YYYY-MM-DD，否则默认 +7 天
 *
 * 模型只负责写字，能不能落地由这里判定；判定不过就丢掉，宁缺勿凑。
 */

const DAY_MS = 86_400_000
export const MIN_SAMPLE_DAYS = 14
export const LONG_TERM_LENSES = ['contradiction', 'inversion', 'values', 'structure', 'second_order']
export const LONG_TERM_METRICS = ['周节奏', '进出台账', '在跑', '进列表→收口', '预期兑现', 'deadline 挤压', '切换', '基线']

const clip = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max)

/* 人格/临床标签一律不许出现在长期结论里（提示词已禁止，这里再兜一层） */
const BANNED_LABELS = ['不自律', '拖延型', '性格', 'MBTI', '人格', '心理诊断', '抑郁', '焦虑症']
const hasBannedLabel = (value) => {
  const text = String(value == null ? '' : value)
  return BANNED_LABELS.some((word) => text.includes(word))
}
const compact = (value) => String(value == null ? '' : value).replace(/\s+/g, '')

function isoDay(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function parseDay(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  if (!match) return 0
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59).getTime()
}

/**
 * @param {object} raw 模型返回的 longTerm
 * @param {{profileText?: string, sampleDays?: number, windowDays?: number, now?: number}} options
 * @returns {null | {lens,fact,hypothesis,falsifier,secondOrder,action,metric,until,at,sampleDays,windowDays}}
 */
export function normalizeLongTerm(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const now = Number(options.now) || Date.now()
  const sampleDays = Number(options.sampleDays) || 0
  const windowDays = Number(options.windowDays) || 0
  const profileText = String(options.profileText || '')

  if (sampleDays < MIN_SAMPLE_DAYS) return null

  const lens = clip(raw.lens, 24)
  if (!LONG_TERM_LENSES.includes(lens)) return null

  const fact = clip(raw.fact, 120)
  if (!fact || !/\d/.test(fact)) return null
  if (!compact(profileText).includes(compact(fact))) return null

  const falsifier = clip(raw.falsifier, 60)
  if (!falsifier) return null

  /* if-then 的形态允许「当…时，先…」：模型常说「先」而不是「就」，语义等价 */
  const action = clip(raw.action, 80)
  if (!action || !/^当[\s\S]*(就|先|再|立刻|马上)/.test(action)) return null

  /* metric 允许「在跑（中位从 6 降到 4）」这种带说明的写法：抽出信号名，说明单独保留 */
  if ([fact, raw.hypothesis, falsifier, raw.secondOrder, action].some(hasBannedLabel)) return null

  const metricRaw = clip(raw.metric, 40)
  const metric = LONG_TERM_METRICS.find((name) => metricRaw.includes(name)) || ''
  if (!metric) return null
  const metricNote = metricRaw === metric ? '' : metricRaw

  const parsedUntil = parseDay(clip(raw.until, 10))
  const untilTs = parsedUntil > now && parsedUntil <= now + 28 * DAY_MS
    ? parsedUntil
    : now + 7 * DAY_MS

  return {
    lens,
    fact,
    hypothesis: clip(raw.hypothesis, 60),
    falsifier,
    secondOrder: clip(raw.secondOrder, 60),
    action,
    metric,
    metricNote,
    until: isoDay(untilTs),
    at: now,
    sampleDays,
    windowDays,
  }
}

/** 记录是否已过期：until 早于「今天」（本地日）就算过期；缺 until 也算过期。 */
export function isLongTermExpired(record, todayKey = isoDay(Date.now())) {
  const until = record && record.data ? String(record.data.until || '') : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return true
  return until < String(todayKey)
}

export default normalizeLongTerm
