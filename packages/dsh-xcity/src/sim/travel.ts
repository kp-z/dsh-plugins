/**
 * 出行：在城市里的场所之间移动。
 *
 * 为什么出行不是"走路"：
 * 前端的地图按场所切，换场所 = 换整张底图（它自己的 transition 就是瞬切）。
 * 所以领域层也不该假装有一条跨地图的路径——那是两套坐标，走不通。
 * 出行的语义因此是：一段有耗时的过程，到点换场所、落在该场所入口。
 *
 * 为什么到了要"重放"活动：
 * 命令说"去办公室干活"，途中人不在办公室，找不到工位。
 * 所以活动先记在 pendingActivity，落地后再按目的地重新找站；
 * 找不到也不算失败：他会站在入口，状态仍是干活（场所没有工位是内容的事）。
 */
import type { Agent, World } from '../domain/types.js'

/** 一次跨场所出行要多少 tick（1 tick = tickMs，默认 100ms；30 = 3 秒）。 */
export const TRAVEL_TICKS = 30

export interface PendingActivity {
  kind: 'work' | 'rest' | 'meet' | 'visit'
  ticks: number
  skill?: string | undefined
}

/** 让角色开始前往某个场所。已经在那儿就不动。 */
export function beginTravel(world: World, agent: Agent, placeId: string, pending: PendingActivity): boolean {
  if (agent.placeId === placeId) return false
  const place = world.places.find((candidate) => candidate.id === placeId)
  if (place === undefined) return false
  agent.state = 'traveling'
  agent.travelTo = placeId
  agent.travelUntil = world.tick + TRAVEL_TICKS
  agent.pendingActivity = pending
  agent.path = []
  agent.station = null
  agent.targetStation = null
  return true
}

/**
 * 推进出行：到点的角色换场所、落在入口，并把攒下的活动交还给调用方。
 *
 * @returns 已经落地的角色 id（调用方据此重放活动、发事件）。
 */
export function arriveTravelers(world: World): string[] {
  const arrived: string[] = []
  for (const agent of world.agents) {
    if (agent.state !== 'traveling') continue
    if (agent.travelTo === undefined) continue
    if (world.tick < (agent.travelUntil ?? 0)) continue
    const place = world.places.find((candidate) => candidate.id === agent.travelTo)
    if (place === undefined) {
      // 目标场所消失了：就地站住，别让"走不动的旅行"卡死。
      agent.state = 'idle'
      agent.travelTo = undefined
      agent.travelUntil = undefined
      continue
    }
    agent.placeId = place.id
    agent.position = { ...place.spawn }
    agent.travelTo = undefined
    agent.travelUntil = undefined
    agent.state = 'idle'
    arrived.push(agent.id)
  }
  return arrived
}
