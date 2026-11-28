/** 任务天气：只按本地口径给一句结论（卡住 / 停滞 / 完成节奏），不调模型。 */
export const WEATHER = {
  storm: { icon: '⛈', word: '暴雨' },
  rain: { icon: '🌧', word: '小雨' },
  cloud: { icon: '⛅', word: '多云' },
  fair: { icon: '🌤', word: '晴间多云' },
  sunny: { icon: '☀', word: '晴' },
}

/**
 * 天气 = 对「今天」的本地判断，阈值写死在这里，不调模型。
 * criteria 给 hover tooltip 用：必须能说清是哪个阈值触发的。
 */
export function weatherOf(local) {
  const today = local?.today || {}
  const done = Number(today.doneCount) || 0
  const active = Number(today.activeCount) || 0
  const stuck = (local?.stalled || []).length
  const drift = Number(today.deviation) || 0
  const rate = Number(today.completion)
  let key = 'fair'
  let note
  let criteria
  if (stuck >= 3 || (stuck > 0 && !done)) {
    key = 'storm'
    note = stuck + ' 条卡着'
    criteria = '卡住 ' + stuck + ' 条（阈值 ≥3），或有卡住且今天 0 完成 → 暴雨'
  } else if (stuck > 0 || drift >= 50) {
    key = 'rain'
    note = stuck ? stuck + ' 条卡着' : '停滞占 ' + Math.round(drift) + '%'
    criteria = stuck
      ? '卡住 ' + stuck + ' 条（阈值 ≥1）→ 小雨'
      : '停滞占比 ' + Math.round(drift) + '%（阈值 ≥50%）→ 小雨'
  } else if (!done && !active) {
    key = 'cloud'
    note = '今天还没有动静'
    criteria = '今天完成 0、在推 0 → 多云'
  } else if (!done) {
    key = 'cloud'
    note = active + ' 条在推，还没落地'
    criteria = '在推 ' + active + ' 条、完成 0 → 多云'
  } else if (rate >= 60) {
    key = 'sunny'
    note = '完成 ' + done + ' 条'
    criteria = '完成度 ' + Math.round(rate) + '%（阈值 ≥60%）→ 晴'
  } else {
    note = '完成 ' + done + ' 条 · 在推 ' + active
    criteria = '完成 ' + done + ' 条、完成度 ' + (rate ? Math.round(rate) + '%' : '—') + '（未达 60%）→ 晴间多云'
  }
  return { ...WEATHER[key], key, note, criteria }
}
