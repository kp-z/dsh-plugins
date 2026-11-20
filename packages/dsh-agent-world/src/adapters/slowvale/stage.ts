/**
 * 一个会自己走路的居民（P0 可见版）。
 *
 * ## 为什么单独做这一层
 *
 * Slow Vale 的 HUD 要挂载场景还得走通它的 scene_state/visual 管道；在那之前，
 * **世界是动的、画面不动**。这一层把"谁在哪、朝哪、在不在走"做成一个独立的、
 * 可验证的状态机：它既给 /show 这个极简视图用，也是将来把位置喂回 HUD 的同一份数据。
 *
 * ## 为什么不做寻路
 *
 * 只为了让"有个人在城市里走"这件事先立住：在每张图的交互点之间直线移动。
 * 撞墙会有，但可接受——寻路是 P1 的口径（EasyStar + 8px 网格），
 * 在那之前先证明**资产与坐标是通的**，别把两件事搅在一起。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 场景循环：办公室 → 街上 → 便利店 → 公园 → 餐馆 → 家 → 回到办公室。 */
export const DEFAULT_CIRCUIT = [
  'company',
  'commercial_street',
  'convenience_store',
  'park',
  'restaurant',
  'home_public',
] as const

export type Facing = 'down' | 'up' | 'left' | 'right'

/** 一帧舞台状态：/show 每 150ms 取一次，画面完全由它决定。 */
export interface StageFrame {
  name: string
  place: string
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

interface PlaceData {
  key: string
  label: string
  waypoints: Point[]
  spawn: Point
  width: number
  height: number
}

/** 读一张图的交互点，挑出"能站人的地方"。读不到就跳过这张图，不要因此崩掉世界。 */
function loadPlace(assetsDir: string, key: string): PlaceData | null {
  const base = join(assetsDir, 'assets', 'maps', key)
  try {
    const interactions = JSON.parse(readFileSync(join(base, 'interactions.json'), 'utf8')) as {
      x?: number
      y?: number
      class?: string
      name?: string
    }[]
    const usable = interactions.filter(
      (item) =>
        typeof item.x === 'number' &&
        typeof item.y === 'number' &&
        (item.class === 'spawn' || item.class === 'target' || item.class === 'pose'),
    )
    const spawn = interactions.find((item) => item.class === 'spawn')
    const waypoints = usable.map((item) => ({ x: item.x as number, y: item.y as number }))
    if (waypoints.length === 0) return null
    return {
      key,
      label: key,
      waypoints,
      spawn: spawn !== undefined ? { x: spawn.x as number, y: spawn.y as number } : (waypoints[0] as Point),
      width: 0,
      height: 0,
    }
  } catch {
    return null
  }
}

/**
 * 舞台：一个居民在几张图之间循环走动。
 *
 * 时间推进用 tick(dtMs)，由调用方驱动（dev 脚本 100ms 一次，宿主里由 runtime 驱动），
 * 这样它不自己持有定时器——测试里可以直接喂 dt。
 */
export function createStage(options: {
  assetsDir: string
  circuit?: readonly string[]
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
  const places: PlaceData[] = []
  for (const key of circuit) {
    const loaded = loadPlace(options.assetsDir, key)
    if (loaded !== null) places.push(loaded)
  }
  if (places.length === 0) {
    throw new Error('舞台：没有任何可用的地图（检查 slowvale.assetsDir 下的 assets/maps）')
  }

  let placeIndex = 0
  let placeSeq = 0
  let waypointIndex = 0
  let position: Point = { ...(places[0] as PlaceData).spawn }
  let target: Point = { ...(places[0] as PlaceData).spawn }
  let facing: Facing = 'down'
  let moving = false
  let visited = 0

  const current = (): PlaceData => places[placeIndex] as PlaceData

  const frame = (): StageFrame => ({
    name,
    place: current().key,
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
    // 面朝目标：横向差大于纵向差就走左右，否则上下——和前端 facingOf 的口径一致。
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

  return { tick, frame, places: () => places.map((p) => p.key) }
}
