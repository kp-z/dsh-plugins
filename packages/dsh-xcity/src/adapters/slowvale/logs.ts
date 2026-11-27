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
  purpose?: string | undefined
  placeId: string
  status: string
  startedAt: number
  startedLogSeq?: number
  endedLogSeq?: number
  taskAttemptId?: string | undefined
  endsAt: number
  endedAt?: number | undefined
  trigger?: LogTrigger | undefined
}

export interface LogNotice {
  seq: number
  logSeq?: number
  tick: number
  type: string
  text: string
}

export interface LogInput {
  epoch: string
  /** 世界起点日期（YYYY-MM-DD）：tick -> 游戏时间要用它。 */
  startDate: string
  activities: readonly LogActivity[]
  notices: readonly LogNotice[]
  query?: URLSearchParams
  logSeq?: number | undefined
  nameOf: (agentId: string) => string
  placeOf: (placeId: string) => { asset: string; name: string } | null
}

const TOWN_CARD = 'card.town'
const TOWN_AGGREGATE = 'aggregate.town'

/** tick -> 游戏时间（1 tick = 1 游戏分钟，与 clockOf 同一换算）。 */
function timeOfTick(startDate: string, tick: number) {
  const minutes = Math.floor(tick)
  const dayIndex = Math.floor(minutes / 1440)
  const minuteOfDay = minutes % 1440
  const date = new Date(new Date(startDate + 'T00:00:00Z').getTime() + dayIndex * 86400000)
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0')
  const mi = String(minuteOfDay % 60).padStart(2, '0')
  const modern_time = hh + ':' + mi
  return { current_datetime: yyyy + '-' + mm + '-' + dd + 'T' + modern_time + ':00', day_number: dayIndex + 1, modern_time }
}

/** 活动类型映射：领域语义 -> 前端徽章查表能命中的类型名。
 *
 * 前端只认它自己那 61 个活动类名（ProgrammerActivity 之类），查不到会记一条
 * badge.activity_type 警告然后什么都不画。所以这是白名单，不是自由字符串。
 */
export function activityTypeOf(kind: string, skill?: string | null, purpose?: string | null): string {
  // R478：吃饭/睡觉都复用 rest 活动，用 purpose 决定徽章，别把吃饭画成 RestActivity。
  if (purpose === 'meal') return 'EatActivity'
  if (purpose === 'sleep') return 'SleepActivity'
  // R481：学习可能发生在 code 工位（skill=code）；用 purpose 保证徽章仍是“学习”。
  if (purpose === 'study') return 'SkillStudyActivity'
  if (kind === 'sleep') return 'SleepActivity'
  if (kind === 'rest') return 'RestActivity'
  if (kind === 'meet') return 'SpeakActivity'
  if (kind === 'visit') return 'WaitActivity'
  if (skill === 'research') return 'SkillStudyActivity'
  return 'ProgrammerActivity'
}

/** 活动的中文标签（前端的忙碌文案会用它）。 */
export function activityLabelOf(kind: string, purpose?: string | null): string {
  if (purpose === 'meal') return '吃饭'
  if (purpose === 'sleep') return '睡觉'
  if (purpose === 'study') return '学习'
  if (purpose === 'social') return '聊天'
  if (kind === 'work') return '干活'
  if (kind === 'rest') return '休息'
  if (kind === 'meet') return '交谈'
  if (kind === 'visit') return '待着'
  if (kind === 'sleep') return '睡觉'
  return '忙'
}

interface Draft {
  at: number
  id: number
  cardId: string
  aggregateId: string
  body: Record<string, unknown>
}

// 旧存档保留历史，但不能让旧编号进入新记录的序列。
const LEGACY_LIMIT = 2 ** 32
const sequenceId = (seq: number): number => LEGACY_LIMIT + seq * 2
const activityStartId = (activity: LogActivity): number => activity.startedLogSeq === undefined
  ? Number(activity.id.slice(4)) * 4 + 2 : sequenceId(activity.startedLogSeq)
const activityEndId = (activity: LogActivity): number => activity.endedLogSeq === undefined
  ? activityStartId(activity) + 1 : sequenceId(activity.endedLogSeq)
const noticeId = (notice: LogNotice): number => notice.logSeq === undefined ? notice.seq * 4 + 4 : sequenceId(notice.logSeq)

export function logHeadOf(activities: readonly LogActivity[], notices: readonly LogNotice[], logSeq?: number): number {
  let head = logSeq ? sequenceId(logSeq) : 0
  for (const activity of activities) head = Math.max(head, activity.status === 'active' ? activityStartId(activity) : activityEndId(activity))
  for (const notice of notices) head = Math.max(head, noticeId(notice))
  return head
}

export function logNoticesOf(events: readonly { seq: number; tick: number; type: string; payload: Record<string, unknown> }[]): LogNotice[] {
  return events.flatMap(({ seq, tick, type, payload }) => {
    const logSeq = typeof payload['logSeq'] === 'number' ? { logSeq: payload['logSeq'] } : {}
    if (type === 'world.reset') return [{ seq, tick, type, ...logSeq, text: '小镇重新开始了。' }]
    if (type === 'world.paused') return [{ seq, tick, type, ...logSeq, text: payload['paused'] === false ? '小镇恢复运行。' : '小镇暂停了。' }]
    return []
  }).slice(-20)
}

export function logsOf(input: LogInput): { recent: Record<string, unknown>; catchUp: Record<string, unknown> } {
  const drafts: Draft[] = []
  const cards = new Map<string, Record<string, unknown>>()

  const cardFor = (cardId: string, aggregateId: string, title: string, initiator: string, gameTime: ReturnType<typeof timeOfTick>): void => {
    if (cards.has(cardId)) return
    cards.set(cardId, { card_id: cardId, aggregate_id: aggregateId, title, viewer_role: 'participant', initiator_name: initiator, game_time: gameTime })
  }

  for (const activity of input.activities) {
    const place = input.placeOf(activity.placeId)
    const asset = place?.asset ?? 'company'
    const cardId = 'card.place.' + asset + '.' + activity.id
    const aggregateId = 'aggregate.' + activity.id
    const at = timeOfTick(input.startDate, activity.startedAt)
    const name = input.nameOf(activity.agentId)
    cardFor(cardId, aggregateId, place?.name ?? '小镇', name, at)

    // 有触发来源才有 decision：reason 用原话，不加工。
    if (activity.trigger?.text !== undefined && activity.trigger.text.trim() !== '') {
      drafts.push({
        at: activity.startedAt,
        id: activityStartId(activity) - 1,
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

    const label = activityLabelOf(activity.kind, activity.purpose)
    const phase = (tick: number, lifecycle: 'start' | 'complete' | 'interrupt'): void => {
      drafts.push({
        at: tick,
        id: lifecycle === 'start' ? activityStartId(activity) : activityEndId(activity),
        cardId,
        aggregateId,
        body: {
          kind: 'event',
          phase_id: activity.id,
          phase: {
            kind: 'activity',
            activity_id: activity.id,
            activity_type: activityTypeOf(activity.kind, activity.skill, activity.purpose),
            name: label + ' · ' + name,
            is_viewer_activity: activity.agentId === input.query?.get('role_id'),
            items: [{ lifecycle, content: label }],
          },
        },
      })
    }
    phase(activity.startedAt, 'start')
    if (activity.status !== 'active') {
      phase(activity.endedAt ?? activity.endsAt, activity.status === 'completed' ? 'complete' : 'interrupt')
    }
  }

  for (const notice of input.notices) {
    const at = timeOfTick(input.startDate, notice.tick)
    const cardId = TOWN_CARD + '.' + notice.seq
    const aggregateId = TOWN_AGGREGATE + '.' + notice.seq
    cardFor(cardId, aggregateId, '小镇公告', '小镇', at)
    drafts.push({
      at: notice.tick,
      id: noticeId(notice),
      cardId,
      aggregateId,
      body: {
        kind: 'standalone',
        item: { record_type: 'system_notice', category: 'system', content: notice.text },
      },
    })
  }

  drafts.sort((a, b) => a.at - b.at || a.id - b.id)
  const normalized = drafts.map((draft) => {
    const at = timeOfTick(input.startDate, draft.at)
    return {
      record_entry_id: draft.id,
      card_id: draft.cardId,
      source_aggregate_id: draft.aggregateId,
      game_time: at,
      ...draft.body,
    }
  })

  const head = logHeadOf(input.activities, input.notices, input.logSeq)
  const query = input.query
  const numberParam = (key: string, fallback: number): number => {
    const value = query?.get(key)
    const n = value ? Number(value) : fallback
    return Number.isSafeInteger(n) && n >= 0 ? n : fallback
  }
  const limit = Math.max(1, Math.min(500, numberParam('limit', 500)))
  const bodyOf = (entries: typeof normalized) => ({
    entries,
    card_upserts: [...new Set(entries.map((entry) => entry.card_id))].map((id) => cards.get(id)!),
    realtime_epoch: input.epoch,
  })
  const from = query?.get('from_game_time')
  const before = query?.get('before_game_time')
  const since = query?.get('since_game_time')
  const sinceId = numberParam('since_record_entry_id', 0)
  const eligible = normalized.filter((entry) => {
    const at = entry.game_time.current_datetime
    return (!from || at >= from) && (!before || at < before) &&
      (!since || at > since || (at === since && entry.record_entry_id > sinceId))
  })
  const page = eligible.slice(0, limit)
  const last = page.at(-1)
  const after = numberParam('after_record_entry_id', 0)
  const target = Math.max(after, numberParam('target_record_entry_id', head))
  const updates = normalized.filter((entry) => entry.record_entry_id > after && entry.record_entry_id <= target)
  updates.sort((a, b) => a.record_entry_id - b.record_entry_id)
  const batch = updates.slice(0, limit)
  const hasMore = updates.length > batch.length
  const epoch = query?.get('realtime_epoch')
  const reset = !!epoch && epoch !== input.epoch
  return {
    recent: {
      ...bodyOf(page),
      has_more: eligible.length > page.length,
      feed_head_record_entry_id: head,
      oldest_available_game_time: normalized[0]?.game_time.current_datetime ?? null,
      updated_until_game_time: last?.game_time.current_datetime ?? null,
      page_end_record_entry_id: last?.record_entry_id ?? null,
    },
    catchUp: reset
      ? { outcome: 'reset_required', ...bodyOf([]), next_record_entry_id: head, target_record_entry_id: head, has_more: false }
      : { outcome: 'page', ...bodyOf(batch), next_record_entry_id: hasMore ? batch.at(-1)!.record_entry_id : target, target_record_entry_id: target, has_more: hasMore },
  }
}
