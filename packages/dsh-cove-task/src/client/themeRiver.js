/**
 * 主题河流图：近 14 天「按项目的新增任务」——多类别随时间的消长。
 *
 * 只回答「哪类在变多/变少」，不回答精确每日数值（垂直位置除带宽外不代表量）。
 * 取项目名（缺省用清单名，再缺省「未分组」），前 3 名各一条带，其余合并成「其他」。
 */
export const RIVER_DAYS = 14
export const RIVER_COLORS = ['#1f9d55', '#6fc394', '#bfe3ca', '#a8adb3']
const DAY = 86_400_000

const dayStart = (ts) => {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/* 本地日期：不能用 toISOString().slice(0,10)——东八区零点会落到前一天 */
const dayLabel = (ts) => {
  const date = new Date(ts)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

export function buildThemeRiver(tasks, now = Date.now()) {
  const today = dayStart(now)
  const first = today - (RIVER_DAYS - 1) * DAY
  const groups = new Map()
  let samples = 0

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const at = Number(task && task.createdAt)
    if (!at || at < first || at > now) continue
    const name = String(task.project || task.listName || '').trim() || '未分组'
    if (!groups.has(name)) groups.set(name, new Map())
    const buckets = groups.get(name)
    const key = dayStart(at)
    buckets.set(key, (buckets.get(key) || 0) + 1)
    samples += 1
  }

  const ranked = [...groups.entries()]
    .map(([name, buckets]) => ({ name, buckets, total: [...buckets.values()].reduce((sum, n) => sum + n, 0) }))
    .sort((a, b) => b.total - a.total)
  const top = ranked.slice(0, 3)
  const rest = ranked.slice(3)
  const categories = top.map((item) => item.name)
  /* 「其他」可能与真实项目名撞车：撞了就用「其他·」递增，避免 ECharts 同类别合并 */
  let merged = '其他'
  while (categories.includes(merged)) merged += '·'
  if (rest.length) categories.push(merged)

  const dates = Array.from({ length: RIVER_DAYS }, (_, index) => dayLabel(first + index * DAY))
  const rows = []
  dates.forEach((label, index) => {
    const ts = first + index * DAY
    top.forEach((item) => rows.push([label, item.buckets.get(ts) || 0, item.name]))
    if (rest.length) rows.push([label, rest.reduce((sum, item) => sum + (item.buckets.get(ts) || 0), 0), merged])
  })

  return { rows, categories, dates, samples }
}
