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
  /** 触发来源：落地重放时要继续带着，否则日志里的 decision 会丢。 */
  trigger?: { kind: 'player' | 'schedule' | 'self' | 'task'; text?: string | undefined } | undefined
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
/**
 * 把落点收进可行走网格。
 *
 * 为什么需要：场所的落点来自前端地图的**像素坐标**（480,800），而领域的坐标是
 * 网格单位（37x21 格 x 2 单位）。不折算就落在一个没有路的地方，findPath 直接返回空——
 * 表现就是"到了某个地方之后什么都不干"。这里按最近的可行走格收编，越过尺度差异。
 */
export function snapIntoNav(world: World, point: { x: number; z: number }): { x: number; z: number } {
  const nav = world.nav
  if (nav === null || nav === undefined) return point
  const u = nav.unitsPerCell
  const col = Math.round((point.x - nav.originX) / u - 0.5)
  const row = Math.round((point.z - nav.originZ) / u - 0.5)
  const clamp = (value: number, max: number): number => Math.max(0, Math.min(max, value))
  const startCol = clamp(col, nav.width - 1)
  const startRow = clamp(row, nav.height - 1)
  // 螺旋找最近的空格：半径从小往外，最多 8 圈（覆盖 136 个格，够用了）。
  for (let radius = 0; radius <= 8; radius += 1) {
    for (let dc = -radius; dc <= radius; dc += 1) {
      for (let dr = -radius; dr <= radius; dr += 1) {
        if (Math.abs(dc) !== radius && Math.abs(dr) !== radius) continue
        const c = startCol + dc
        const r = startRow + dr
        if (c < 0 || r < 0 || c >= nav.width || r >= nav.height) continue
        if (nav.blocked[r * nav.width + c] === true) continue
        return { x: nav.originX + (c + 0.5) * u, z: nav.originZ + (r + 0.5) * u }
      }
    }
  }
  return point
}

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
    agent.position = snapIntoNav(world, place.spawn)
    agent.travelTo = undefined
    agent.travelUntil = undefined
    agent.state = 'idle'
    arrived.push(agent.id)
  }
  return arrived
}
