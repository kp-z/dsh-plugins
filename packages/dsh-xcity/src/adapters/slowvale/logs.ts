/**
 * 日志投影：世界事件 -> 前端要的卡片/条目形状。
 *
 * 形状来自 bundle 里两个校验器（mb / Dx）与它们的报错文案：
 * - 信封：outcome='page' / entries[] / card_upserts[] / next_record_entry_id / target_record_entry_id / has_more
 * - 卡片：card_id / aggregate_id / title / viewer_role ∈ initiator|participant|observer / game_time.current_datetime
 * - 事件条目：record_entry_id>0 / card_id / game_time.current_datetime / kind='event' / source_aggregate_id
 */

export interface LogEvent { seq: number; tick: number; type: string; payload: Record<string, unknown> }

const CARD_ID = 'card.town'
const AGGREGATE_ID = 'aggregate.town'

function cardOf(datetime: string): Record<string, unknown> {
  return { card_id: CARD_ID, aggregate_id: AGGREGATE_ID, title: '小镇动态', viewer_role: 'participant', game_time: { current_datetime: datetime } }
}

function entryOf(event: LogEvent, datetime: string): Record<string, unknown> {
  return {
    record_entry_id: Math.max(1, event.seq),
    card_id: CARD_ID,
    game_time: { current_datetime: datetime },
    kind: 'event',
    source_aggregate_id: AGGREGATE_ID,
    item: { event_type: event.type, payload: event.payload, tick: event.tick },
  }
}

export function logsOf(input: { datetime: string; events: readonly LogEvent[] }): { recent: Record<string, unknown>; catchUp: Record<string, unknown> } {
  const events = input.events.slice(-50)
  const entries = events.map((event) => entryOf(event, input.datetime))
  const first = entries.length > 0 ? Number(entries[0]?.['record_entry_id'] ?? 0) : 0
  const newest = entries.length > 0 ? Number(entries[entries.length - 1]?.['record_entry_id'] ?? 0) : 0
  void first
  return {
    recent: { entries, card_upserts: entries.length > 0 ? [cardOf(input.datetime)] : [], has_more: false, next_record_entry_id: newest, oldest_day_number: null },
    catchUp: { outcome: 'page', entries, card_upserts: entries.length > 0 ? [cardOf(input.datetime)] : [], next_record_entry_id: newest, target_record_entry_id: newest, has_more: false },
  }
}
