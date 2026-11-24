/**
 * 日志投影：世界事件 -> 前端日志面板要的形状。
 *
 * ## 形状依据（全部来自 bundle 里前端的真实校验，不是猜的）
 *
 * recent 响应（GameView 里 Zn/Pn 那段）：
 * - feed_head_record_entry_id：Number.isSafeInteger 且 >= 0，否则抛
 *   「日志响应缺少 feed_head_record_entry_id」
 * - realtime_epoch：非空字符串，否则抛「日志响应缺少 realtime_epoch」
 * - entries / card_upserts：数组；has_more：布尔
 * - 每条 entry：game_time.current_datetime + game_time.day_number（正整数），
 *   否则抛「日志 entry X 缺少有效 day_number」
 * - kind='event' 的条目必须带 decision 或 phase（否则「事件日志 entry X 缺少 decision 或 phase」）；
 *   kind='standalone' 只要求 item —— 我们的世界事件没有 decision/phase，所以走 standalone，
 *   渲染成 notice（item.record_type='system_notice'）。
 *
 * 之前这些字段一个都没有（只有 entries/card_upserts/has_more），前端于是把异常统一显示成
 * 「加载日志失败，请稍后重试」——面板永远打不开。
 */

export interface LogEvent {
  seq: number
  tick: number
  type: string
  payload: Record<string, unknown>
}

export interface LogInput {
  /** ISO 时间，喂给 game_time.current_datetime。 */
  datetime: string
  /** 正整数天数，喂给 game_time.day_number（前端强校验）。 */
  dayNumber: number
  /** 实时纪元，必须与快照 cursor.epoch 一致（前端会比对，不一致就要求整体重同步）。 */
  epoch: string
  events: readonly LogEvent[]
}

const CARD_ID = 'card.town'
const AGGREGATE_ID = 'aggregate.town'

/** 事件类型 -> 面板上的一句人话。认不出的类型原样显示类型名，不编故事。 */
function describe(event: LogEvent): string {
  const agent = typeof event.payload['agentId'] === 'string' ? event.payload['agentId'] : ''
  switch (event.type) {
    case 'agent.intent':
      return agent === '' ? '有角色做了决定' : agent + ' 做了决定'
    case 'task.changed':
      return '工单状态变化'
    case 'agent.activity':
      return agent === '' ? '有角色换了活动' : agent + ' 换了活动'
    default:
      return event.type
  }
}

function cardOf(input: LogInput): Record<string, unknown> {
  return {
    card_id: CARD_ID,
    aggregate_id: AGGREGATE_ID,
    title: '小镇动态',
    viewer_role: 'participant',
    game_time: { current_datetime: input.datetime, day_number: input.dayNumber },
  }
}

function entryOf(event: LogEvent, input: LogInput): Record<string, unknown> {
  return {
    record_entry_id: Math.max(1, event.seq),
    card_id: CARD_ID,
    game_time: { current_datetime: input.datetime, day_number: input.dayNumber },
    kind: 'standalone',
    item: {
      record_type: 'system_notice',
      category: 'system',
      content: describe(event),
    },
  }
}

export function logsOf(input: LogInput): {
  recent: Record<string, unknown>
  catchUp: Record<string, unknown>
} {
  const events = input.events.slice(-50)
  const entries = events.map((event) => entryOf(event, input))
  const head = entries.length > 0 ? Number(entries[entries.length - 1]?.['record_entry_id'] ?? 0) : 0
  const cards = entries.length > 0 ? [cardOf(input)] : []

  return {
    recent: {
      entries,
      card_upserts: cards,
      has_more: false,
      // 这两个是前端 recent 路径的硬要求（缺一个就整块失败）。
      feed_head_record_entry_id: head,
      realtime_epoch: input.epoch,
      oldest_available_game_time: null,
    },
    catchUp: {
      outcome: 'page',
      entries,
      card_upserts: cards,
      next_record_entry_id: head,
      target_record_entry_id: head,
      has_more: false,
    },
  }
}
