/**
 * 日志投影：世界里的活动 -> 前端日志面板要的 entry。
 *
 * ## 为什么不再用 standalone notice
 *
 * 以前我们的世界事件是扁平的（agent.intent 之类），没有决策也没有阶段，
 * 只能降级成 kind='standalone' 的系统公告——翻历史时只有一行“某某做了决定”。
 *
 * 活动有身份之后就不一样了：每段活动天然是一条 event 条目，带 phase
 * （activity_id / activity_type / name / status）。这正是前端校验器要求的形状：
 * kind='event' 必须有 decision 或 phase，否则抛“缺少 decision 或 phase”。
 *
 * ## 形状依据（bundle 里的真实校验）
 *
 * recent 信封：feed_head_record_entry_id（非负整数）、realtime_epoch（非空串）、
 * entries / card_upserts 数组、has_more 布尔。
 * 每条 entry：record_entry_id>0、card_id、game_time.current_datetime + day_number（正整数）。
 */

export interface LogActivity {
  id: string
  agentId: string
  kind: string
  skill?: string | undefined
  placeId: string
  status: string
  startedAt: number
  endsAt: number
  endedAt?: number | undefined
}

export interface LogInput {
  /** 当前游戏时间（ISO），用于最新条目。 */
  datetime: string
  /** 当前天数（正整数）。 */
  dayNumber: number
  /** 实时纪元，必须与快照 cursor.epoch 一致。 */
  epoch: string
  /** 世界起点日期（YYYY-MM-DD），用于把 tick 换算成游戏时间。 */
  startDate: string
  activities: readonly LogActivity[]
  /** 角色 id -> 名字（条目上的发起人）。 */
  nameOf: (agentId: string) => string
  /** 场所 id -> {asset, name}（卡片按场所切）。 */
  placeOf: (placeId: string) => { asset: string; name: string } | null
}

/** tick -> 游戏时间。与 clockOf 同一套换算：1 tick = 1 游戏分钟。 */
function timeOfTick(startDate: string, tick: number): { datetime: string; dayNumber: number } {
  const minutes = Math.floor(tick)
  const dayIndex = Math.floor(minutes / 1440)
  const minuteOfDay = minutes % 1440
  const date = new Date(new Date(startDate + 'T00:00:00Z').getTime() + dayIndex * 86400000)
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0')
  const mi = String(minuteOfDay % 60).padStart(2, '0')
  return { datetime: yyyy + '-' + mm + '-' + dd + 'T' + hh + ':' + mi + ':00', dayNumber: dayIndex + 1 }
}

/** 活动类型：仍然是前端徽章白名单里的名字。 */
function activityTypeOf(kind: string, skill?: string | undefined): string {
  if (kind === 'sleep') return 'SleepActivity'
  if (kind === 'rest') return 'RestActivity'
  if (kind === 'meet') return 'SpeakActivity'
  if (kind === 'visit') return 'WaitActivity'
  if (skill === 'research') return 'SkillStudyActivity'
  return 'ProgrammerActivity'
}

const ACTIVITY_LABEL: Record<string, string> = {
  work: '干活',
  rest: '休息',
  meet: '交谈',
  visit: '待着',
  sleep: '睡觉',
}

export function logsOf(input: LogInput): { recent: Record<string, unknown>; catchUp: Record<string, unknown> } {
  const entries: Record<string, unknown>[] = []
  const cards = new Map<string, Record<string, unknown>>()
  const activities = [...input.activities].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))

  for (const activity of activities) {
    const place = input.placeOf(activity.placeId)
    const asset = place?.asset ?? 'company'
    const cardId = 'card.place.' + asset
    const aggregateId = 'aggregate.place.' + asset
    const at = timeOfTick(input.startDate, activity.startedAt)
    const gameTime = { current_datetime: at.datetime, day_number: at.dayNumber }
    if (!cards.has(cardId)) {
      cards.set(cardId, {
        card_id: cardId,
        aggregate_id: aggregateId,
        title: place?.name ?? '小镇',
        viewer_role: 'participant',
        initiator_name: input.nameOf(activity.agentId),
        game_time: gameTime,
      })
    }
    entries.push({
      // 条目 id 从活动身份派生：同一段活动每次投影都得到同一个 id（内容不可变）。
      record_entry_id: entryIdOf(activity.id),
      card_id: cardId,
      source_aggregate_id: aggregateId,
      game_time: gameTime,
      kind: 'event',
      phase: {
        kind: 'activity',
        activity_id: activity.id,
        activity_type: activityTypeOf(activity.kind, activity.skill),
        name: (ACTIVITY_LABEL[activity.kind] ?? activity.kind) + ' · ' + input.nameOf(activity.agentId),
        status: activity.status,
        is_viewer_activity: false,
      },
    })
  }

  const head = entries.length > 0 ? Number(entries[entries.length - 1]?.['record_entry_id'] ?? 0) : 0
  const body = { entries, card_upserts: [...cards.values()] }
  return {
    recent: { ...body, has_more: false, feed_head_record_entry_id: head, realtime_epoch: input.epoch, oldest_available_game_time: null },
    catchUp: { outcome: 'page', ...body, next_record_entry_id: head, target_record_entry_id: head, has_more: false },
  }
}

/** 活动 id（act-17）-> 条目 id（17）；解析不出来就退化成 1。 */
function entryIdOf(activityId: string): number {
  const digits = activityId.replace(/\D/g, '')
  const value = Number.parseInt(digits, 10)
  return Number.isSafeInteger(value) && value > 0 ? value : 1
}
