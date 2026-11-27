/**
 * R479：今天记得什么。
 *
 * 短信回复不能只靠会话里聊过什么；角色要能说出"今天做了什么、现在在做什么"。
 * 这里只读世界事实（活动记录 + 站点名），不编、不读 DSH 内部思考/工具调用。
 *
 * activities 是环形缓冲：被裁剪掉的就少说，不补造。
 * 1 tick = 1 游戏分钟；一天 1440 tick。
 */
import type { Activity, World } from '../domain/types.js'
import { currentActivityOf } from './activity-view.js'

/** 一条摘要最多多少字（prompt 预算，见 4.4）。 */
const MAX_SUMMARY_CHARS = 300

function hhmm(tick: number): string {
  const minute = ((Math.floor(tick) % 1440) + 1440) % 1440
  const hh = String(Math.floor(minute / 60)).padStart(2, '0')
  const mm = String(minute % 60).padStart(2, '0')
  return hh + ':' + mm
}

/** 活动名：优先用触发文本里的生活线索，再退回 kind/skill。 */
function labelOf(activity: Activity): string {
  const text = activity.trigger?.text ?? ''
  if (text.includes('吃')) return '吃饭'
  if (text.includes('睡')) return '睡觉'
  if (text.includes('学')) return '学习'
  if (text.includes('聊')) return '聊天'
  if (activity.kind === 'work') return activity.skill === 'research' ? '研究' : '干活'
  if (activity.kind === 'rest') return '休息'
  if (activity.kind === 'meet') return '聊天'
  if (activity.kind === 'visit') return '待着'
  if (activity.kind === 'sleep') return '睡觉'
  return '忙着'
}

function placeNameOf(world: World, stationId: string | null): string {
  if (stationId === null) return ''
  return world.stations.find((station) => station.id === stationId)?.name ?? ''
}

function lineOf(world: World, activity: Activity, nowTick: number, dayStart: number): string {
  const place = placeNameOf(world, activity.stationId)
  const where = place === '' ? '' : '在' + place
  const label = labelOf(activity)
  if (activity.status === 'active') return `现在${where}${label}`
  // 跨午夜的活动（昨晚的觉）按"今天凌晨"算：起点夹到 00:00。
  const start = Math.max(activity.startedAt, dayStart)
  const end = Math.min(activity.endedAt ?? nowTick, nowTick)
  return `${hhmm(start)}–${hhmm(end)} ${where}${label}`
}

/**
 * 当天摘要（最多 5 行，倒序取最近的活动，再按时间正序输出）。
 *
 * 返回空数组 = 今天还没有任何记录；调用方不要把"没有记录"写成编造的经历。
 */
export function summarizeDay(world: World, agentId: string, nowTick: number): string[] {
  const day = Math.floor(nowTick / 1440)
  const dayStart = day * 1440
  const mine = (world.activities ?? []).filter((activity) => activity.agentId === agentId)
  // R485：当前活动从唯一读入口取；老存档没有 activityId 时退回扫 active。
  const agent = (world.agents ?? []).find((item) => item.id === agentId)
  const current = (agent === undefined ? null : currentActivityOf(world, agent)) ?? mine.find((activity) => activity.status === 'active') ?? null
  const done = mine
    .filter((activity) => activity.status === 'completed' && activity.endedAt !== undefined && activity.endedAt >= dayStart && activity.startedAt <= nowTick)
    .sort((a, b) => a.startedAt - b.startedAt)

  if (done.length === 0 && current === null) return []

  // 当前活动单独一行；已完成最多 4 条 + 当前 = 5 条。
  const recent = current === null ? done.slice(-5) : done.slice(-4)
  const lines: string[] = recent.map((activity) => lineOf(world, activity, nowTick, dayStart))
  if (current !== null) lines.push(lineOf(world, current, nowTick, dayStart))
  if (current === null) lines.push('现在闲着')

  // 预算：超长就从最早的一条开始丢（当前/最近更重要）。
  while (lines.length > 1 && lines.join('；').length > MAX_SUMMARY_CHARS) {
    lines.shift()
  }
  return lines
}
