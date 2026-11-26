/**
 * R482：人和人的关系。
 *
 * affinity = 对一个认识的人的熟悉度（0–100，缺省 50）。只存"变化"，不建社交图谱库。
 * 互动完成时双方各 +2；同一 tick 同一对只加一次（step 里用 Set 去重）。
 */
import type { Activity, Agent, World } from '../domain/types.js'

export const DEFAULT_AFFINITY = 50
/** 一次聊天加多少。 */
const AFFINITY_GAIN = 2

export function affinityOf(agent: Agent, otherId: string): number {
  return agent.affinity?.[otherId] ?? DEFAULT_AFFINITY
}

/** 加一点熟悉度（就地写），返回新值。 */
export function bumpAffinity(agent: Agent, otherId: string, delta = AFFINITY_GAIN): number {
  const before = affinityOf(agent, otherId)
  const after = Math.max(0, Math.min(100, before + delta))
  agent.affinity = { ...(agent.affinity ?? {}), [otherId]: after }
  return after
}

export interface AffinityBump {
  agentId: string
  otherId: string
  before: number
  after: number
}

/**
 * 一次 meet 活动完成：同屋（同 district）还在聊天的人互相 +2。
 *
 * 为什么按 district 而不是同一站点：办公室会议椅是一人一座，两人坐同屋不同椅也算聊天。
 * @param seen - 本 tick 已加过的 pair key，挡住两次完成各加一遍。
 */
export function applyMeetAffinity(world: World, activity: Activity, seen: Set<string>): AffinityBump[] {
  if (activity.kind !== 'meet' || activity.stationId === null) return []
  const station = world.stations.find((item) => item.id === activity.stationId)
  if (station === undefined) return []
  const self = world.agents.find((item) => item.id === activity.agentId)
  if (self === undefined) return []

  const bumps: AffinityBump[] = []
  for (const other of world.agents) {
    if (other.id === self.id || other.station === null) continue
    const otherStation = world.stations.find((item) => item.id === other.station)
    if (otherStation === undefined || otherStation.district !== station.district) continue
    if (other.state !== 'talking' && other.activityKind !== 'meet') continue

    const key = [self.id, other.id].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)

    const before = affinityOf(self, other.id)
    const after = bumpAffinity(self, other.id)
    bumps.push({ agentId: self.id, otherId: other.id, before, after })

    const backBefore = affinityOf(other, self.id)
    const backAfter = bumpAffinity(other, self.id)
    bumps.push({ agentId: other.id, otherId: self.id, before: backBefore, after: backAfter })
  }
  return bumps
}
