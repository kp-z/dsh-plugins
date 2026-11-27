import { activityLabelOf } from './logs.js'
import { clockOf, type ProjectOptions } from './project.js'
import { MINUTES_PER_DAY, TICKS_PER_GAME_MINUTE, type WorldLike } from './types.js'

export function projectRecap(world: WorldLike | null, opts: ProjectOptions, requestedRoleId: string | null) {
  // R495-01：已启动世界用游戏时钟；未启动时以配置的第 0 tick 返回空时间线。
  const snapshot = world ?? { id: opts.worldId, name: '', tick: 0, agents: [] }
  const now = clockOf(snapshot, opts.startDate)
  const dayStart = (now.day_number - 1) * MINUTES_PER_DAY / TICKS_PER_GAME_MINUTE
  const anchor = clockOf({ ...snapshot, tick: dayStart }, opts.startDate)
  const roleId = requestedRoleId || (snapshot.agents.some((agent) => agent.id === opts.viewerRoleId)
    ? opts.viewerRoleId : snapshot.agents[0]?.id ?? opts.viewerRoleId)

  // R495-02：只读已保留的活动记录；跨日活动标为继续，计划结束时间不限制仍在进行的活动。
  const timeline = (world?.activities ?? [])
    .filter((activity) => {
      if (activity.agentId !== roleId || activity.startedAt > snapshot.tick) return false
      return activity.startedAt >= dayStart || activity.status === 'active' ||
        (activity.endedAt !== undefined && activity.endedAt > dayStart)
    })
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((activity) => {
      const tick = Math.max(dayStart, activity.startedAt)
      const clock = clockOf({ ...snapshot, tick }, opts.startDate)
      const label = activityLabelOf(activity.kind, activity.purpose)
      const place = snapshot.places?.find((entry) => entry.id === activity.placeId)?.name
      return {
        // R495-03：日常活动不是健康异常、工作变动或关系变化。
        group: 'routine',
        text: (activity.startedAt < dayStart ? '继续' : '') + label + (place ? ' · ' + place : ''),
        day_number: clock.day_number,
        time_label: clock.modern_time,
      }
    })

  return {
    role_id: roleId,
    anchor_kind: null,
    clamped: now.day_number > 1,
    anchor_game_time: anchor.game_time,
    now_game_time: now.game_time,
    timeline,
    player_replies: null,
  }
}
