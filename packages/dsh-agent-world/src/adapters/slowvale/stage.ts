
/**
 * 一个会自己走路的居民。
 *
 * ## 坐标与命名的两个世界
 *
 * 前端只认 place:office.tech_company_1 这种 id（它靠规则表把 id 映射到
 * assets/maps/<asset>）；而地图文件是按 asset 命名的。所以这里把两者绑在一张表里：
 * 对前端只报 placeId，取资源只用 asset。搞混了就会得到"一切都 200，但场景起不来"。
 *
 * ## 为什么不做寻路
 *
 * 先用交互点之间的直线走把"有人在城里"立住；寻路（EasyStar + 8px 网格）是 P1 的事。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PlaceSpec {
  /** 前端认的地点 id（必须是场景注册表里能命中的形态）。 */
  id: string
  /** assets/maps/ 下的目录名。 */
  asset: string
  /** 给人看的名字。 */
  label: string
}

/**
 * 主要场景的循环。
 *
 * 每个 id 都是从 Slow Vale 的场景规则表里挑的**能命中**的那个：
 * place:office.tech_company_* → company、place:residential.apartment_* → home_public、
 * place:residential.mini_market → convenience_store、place:commercial.city_restaurant → restaurant、
 * place:downtown.city_gym → gym、place:outdoor.sunset_beach → beach。
 */
export const DEFAULT_CIRCUIT: readonly PlaceSpec[] = [
  { id: 'place:office.tech_company_1', asset: 'company', label: '科技公司 · 办公室' },
  { id: 'place:residential.apartment_1', asset: 'home_public', label: '公寓' },
  { id: 'place:residential.mini_market', asset: 'convenience_store', label: '便利店' },
  { id: 'place:commercial.city_restaurant', asset: 'restaurant', label: '餐馆' },
  { id: 'place:downtown.city_gym', asset: 'gym', label: '健身房' },
  { id: 'place:outdoor.sunset_beach', asset: 'beach', label: '海滩' },
]

export type Facing = 'down' | 'up' | 'left' | 'right'

/** 一帧舞台状态：前端（HUD 或 /show）完全由它决定画面。 */
export interface StageFrame {
  name: string
  /** 地点 id（喂给前端 place_id）。 */
  place: string
  /** 地图资源目录（内部渲染用）。 */
  placeAsset: string
  placeLabel: string
  x: number
  y: number
  facing: Facing
  moving: boolean
  /** 换场景的序号，前端靠它判断要不要换底图。 */
  placeSeq: number
}

interface Point {
  x: number
  y: number
}

interface LoadedPlace extends PlaceSpec {
  waypoints: Point[]
  spawn: Point
}

function loadPlace(assetsDir: string, spec: PlaceSpec): LoadedPlace | null {
  const base = join(assetsDir, 'assets', 'maps', spec.asset)
  try {
    const interactions = JSON.parse(readFileSync(join(base, 'interactions.json'), 'utf8')) as {
      x?: number
      y?: number
      class?: string
    }[]
    const usable = interactions.filter(
      (item) =>
        typeof item.x === 'number' &&
        typeof item.y === 'number' &&
        (item.class === 'spawn' || item.class === 'target' || item.class === 'pose'),
    )
    if (usable.length === 0) return null
    const spawn = interactions.find((item) => item.class === 'spawn')
    const first = usable[0] as { x: number; y: number }
    return {
      ...spec,
      waypoints: usable.map((item) => ({ x: item.x as number, y: item.y as number })),
      spawn: spawn !== undefined ? { x: spawn.x as number, y: spawn.y as number } : { x: first.x, y: first.y },
    }
  } catch {
    return null
  }
}

/** 舞台：一个居民在几张图之间循环走动。时间由调用方驱动（tick(dt)），不自己持有定时器。 */
export function createStage(options: {
  assetsDir: string
  circuit?: readonly PlaceSpec[]
  name?: string
  speed?: number
}): {
  tick: (dtMs: number) => StageFrame
  frame: () => StageFrame
  places: () => string[]
} {
  const circuit = options.circuit ?? DEFAULT_CIRCUIT
  const speed = options.speed ?? 90
  const name = options.name ?? '阿吉'
  const places: LoadedPlace[] = []
  for (const spec of circuit) {
    const loaded = loadPlace(options.assetsDir, spec)
    if (loaded !== null) places.push(loaded)
  }
  if (places.length === 0) {
    throw new Error('舞台：没有任何可用的地图（检查 slowvale.assetsDir 下的 assets/maps）')
  }

  let placeIndex = 0
  let placeSeq = 0
  let waypointIndex = 0
  let position: Point = { ...(places[0] as LoadedPlace).spawn }
  let target: Point = { ...(places[0] as LoadedPlace).spawn }
  let facing: Facing = 'down'
  let moving = false
  let visited = 0

  const current = (): LoadedPlace => places[placeIndex] as LoadedPlace

  const frame = (): StageFrame => ({
    name,
    place: current().id,
    placeAsset: current().asset,
    placeLabel: current().label,
    x: Math.round(position.x),
    y: Math.round(position.y),
    facing,
    moving,
    placeSeq,
  })

  const pickNext = (): void => {
    const data = current()
    const next = data.waypoints[waypointIndex % data.waypoints.length] as Point
    waypointIndex += 1
    target = { x: next.x, y: next.y }
    const dx = target.x - position.x
    const dy = target.y - position.y
    facing = Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up'
  }

  const nextPlace = (): void => {
    placeIndex = (placeIndex + 1) % places.length
    placeSeq += 1
    waypointIndex = 0
    const data = current()
    position = { ...data.spawn }
    target = { ...data.spawn }
    visited = 0
    pickNext()
  }

  pickNext()

  const tick = (dtMs: number): StageFrame => {
    const step = (speed * dtMs) / 1000
    const dx = target.x - position.x
    const dy = target.y - position.y
    const distance = Math.hypot(dx, dy)
    if (distance <= step || distance === 0) {
      position = { ...target }
      moving = false
      visited += 1
      if (visited >= 3) nextPlace()
      else pickNext()
      return frame()
    }
    moving = true
    position = { x: position.x + (dx / distance) * step, y: position.y + (dy / distance) * step }
    return frame()
  }

  return { tick, frame, places: () => places.map((p) => p.id) }
}
