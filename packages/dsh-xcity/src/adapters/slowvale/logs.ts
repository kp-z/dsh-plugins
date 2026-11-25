/**
 * 日志投影：活动的 phase、触发它的 decision、以及世界公告 notice。
 *
 * ## 三类条目都来自真实数据，不编
 *
 * - phase：每段活动一条（activity_id / activity_type / name / status）；
 * - decision：活动**有触发来源**时才有（trigger.text 就是那句话——玩家短信、或调度理由）；
 * - notice：世界级事件（开新局、暂停）转成 standalone 公告。
 *
 * 没有触发来源的活动不产生 decision —— 空白好过编一句“他觉得该去上班”。
 *
 * ## 形状依据（bundle 里的真实校验）
 *
 * recent 信封：feed_head_record_entry_id（非负整数）、realtime_epoch（非空串）、
 * entries / card_upserts 数组、has_more 布尔。
 * entry：record_entry_id>0、card_id、game_time.current_datetime + day_number（正整数）；
 * kind='event' 必须带 decision 或 phase；kind='standalone' 必须带 item。
 */

export interface LogTrigger {
  kind: 'player' | 'schedule' | 'self' | 'task'
  text?: string | undefined
}

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
  trigger?: LogTrigger | undefined
}

export interface LogNotice {
  seq: number
  tick: number
  type: string
  text: string
}

export interface LogInput {
  datetime: string
  dayNumber: number
  epoch: string
  /** 世界起点日期（YYYY-MM-DD）：tick -> 游戏时间要用它。 */
  startDate: string
  activities: readonly LogActivity[]
  notices: readonly LogNotice[]
  nameOf: (agentId: string) => string
  placeOf: (placeId: string) => { asset: string; name: string } | null
}

const TOWN_CARD = 'card.town'
const TOWN_AGGREGATE = 'aggregate.town'

/** tick -> 游戏时间（1 tick = 1 游戏分钟，与 clockOf 同一换算）。 */
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

/** 前端徽章白名单里的活动类型名。 */
export function activityTypeOf(kind: string, skill?: string | undefined): string {
  if (kind === 'sleep') return 'SleepActivity'
  if (kind === 'rest') return 'RestActivity'
  if (kind === 'meet') return 'SpeakActivity'
  if (kind === 'visit') return 'WaitActivity'
  if (skill === 'research') return 'SkillStudyActivity'
  return 'ProgrammerActivity'
}

const ACTIVITY_LABEL: Record<string, string> = {
  work: '干活', rest: '休息', meet: '交谈', visit: '待着', sleep: '睡觉',
}

interface Draft {
  at: number
  /** 同一时刻的稳定次序：decision 先于 phase。 */
  order: number
  cardId: string
  aggregateId: string
  body: Record<string, unknown>
}

export function logsOf(input: LogInput): { recent: Record<string, unknown>; catchUp: Record<string, unknown> } {
  const drafts: Draft[] = []
  const cards = new Map<string, Record<string, unknown>>()

  const cardFor = (cardId: string, aggregateId: string, title: string, initiator: string, gameTime: { current_datetime: string; day_number: number }): void => {
    if (cards.has(cardId)) return
    cards.set(cardId, { card_id: cardId, aggregate_id: aggregateId, title, viewer_role: 'participant', initiator_name: initiator, game_time: gameTime })
  }

  for (const activity of input.activities) {
    const place = input.placeOf(activity.placeId)
    const asset = place?.asset ?? 'company'
    const cardId = 'card.place.' + asset
    const aggregateId = 'aggregate.place.' + asset
    const at = timeOfTick(input.startDate, activity.startedAt)
    const name = input.nameOf(activity.agentId)
    const gameTime = { current_datetime: at.datetime, day_number: at.dayNumber }
    cardFor(cardId, aggregateId, place?.name ?? '小镇', name, gameTime)

    // 有触发来源才有 decision：reason 用原话，不加工。
    if (activity.trigger?.text !== undefined && activity.trigger.text.trim() !== '') {
      drafts.push({
        at: activity.startedAt,
        order: 0,
        cardId,
        aggregateId,
        body: {
          kind: 'event',
          decision: {
            record_id: activity.id,
            reason: activity.trigger.text.trim(),
            mood: null,
            source: activity.trigger.kind,
          },
        },
      })
    }

    drafts.push({
      at: activity.startedAt,
      order: 1,
      cardId,
      aggregateId,
      body: {
        kind: 'event',
        phase: {
          kind: 'activity',
          activity_id: activity.id,
          activity_type: activityTypeOf(activity.kind, activity.skill),
          name: (ACTIVITY_LABEL[activity.kind] ?? activity.kind) + ' · ' + name,
          status: activity.status,
          is_viewer_activity: false,
        },
      },
    })
  }

  for (const notice of input.notices) {
    const at = timeOfTick(input.startDate, notice.tick)
    const gameTime = { current_datetime: at.datetime, day_number: at.dayNumber }
    cardFor(TOWN_CARD, TOWN_AGGREGATE, '小镇公告', '小镇', gameTime)
    drafts.push({
      at: notice.tick,
      order: 2,
      cardId: TOWN_CARD,
      aggregateId: TOWN_AGGREGATE,
      body: {
        kind: 'standalone',
        item: { record_type: 'system_notice', category: 'system', content: notice.text },
      },
    })
  }

  drafts.sort((a, b) => a.at - b.at || a.order - b.order)
  const normalized = drafts.map((draft, index) => {
    const at = timeOfTick(input.startDate, draft.at)
    return {
      record_entry_id: index + 1,
      card_id: draft.cardId,
      source_aggregate_id: draft.aggregateId,
      game_time: { current_datetime: at.datetime, day_number: at.dayNumber },
      ...draft.body,
    }
  })

  const head = normalized.length > 0 ? Number(normalized[normalized.length - 1]?.['record_entry_id'] ?? 0) : 0
  const body = { entries: normalized, card_upserts: [...cards.values()] }
  return {
    recent: { ...body, has_more: false, feed_head_record_entry_id: head, realtime_epoch: input.epoch, oldest_available_game_time: null },
    catchUp: { outcome: 'page', ...body, next_record_entry_id: head, target_record_entry_id: head, has_more: false },
  }
}
