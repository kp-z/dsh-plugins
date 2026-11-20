
/**
 * Presence 投影：把"角色在哪"变成前端要的那个形状。
 *
 * ## 为什么要单独一层
 *
 * 位置在内部是浮点、是任意精度；前端要的是整数像素与四个朝向。
 * 直接把它们混在一起，就会出现"1.9999 像素"这种谁也说不清的状态。
 * 所以这里做两件事：**按步长推进**（手感契约）与**取整输出**（前端契约）。
 *
 * ## 前端认的形状（已在适配层验证）
 *
 * { location: { place_id, x, y, facing } } —— worker 的坐标是整数，
 * facing 只能是 up/down/left/right，否则前端不知道该用哪一行动画帧。
 */
import type { Facing, MoveState, Point } from '../rules/movement.js'
import { stepToward } from '../rules/movement.js'

export interface PresenceEntry {
  role_id: string
  location: {
    place_id: string
    x: number
    y: number
    facing: Facing
  }
}

export interface Track {
  roleId: string
  placeId: string
  state: MoveState
  /** 目标点；null = 站着不动。 */
  target: Point | null
}

export class PresenceView {
  private readonly tracks = new Map<string, Track>()

  constructor(private readonly step = 2) {}

  /** 放一个人到某个场景的某个点（进场景/传送用；会清掉目标）。 */
  place(roleId: string, placeId: string, at: Point, facing: Facing = 'down'): void {
    this.tracks.set(roleId, {
      roleId,
      placeId,
      state: { x: at.x, y: at.y, facing, moving: false },
      target: null,
    })
  }

  /** 让他走向某点；跨场景由调用方先 place 再走。 */
  walkTo(roleId: string, target: Point): void {
    const track = this.tracks.get(roleId)
    if (track === undefined) throw new Error('角色不在场：' + roleId)
    track.target = target
  }

  /** 推进一帧：所有在走的角色各走一步。 */
  tick(): void {
    for (const track of this.tracks.values()) {
      if (track.target === null) continue
      const next = stepToward(track.state, track.target, this.step)
      track.state = next
      if (!next.moving) track.target = null
    }
  }

  /** 某个人现在的状态（内部精度）。 */
  stateOf(roleId: string): MoveState | null {
    return this.tracks.get(roleId)?.state ?? null
  }

  /** 前端要的 presence 列表：整数像素 + 四向朝向。 */
  entries(): PresenceEntry[] {
    const out: PresenceEntry[] = []
    for (const track of this.tracks.values()) {
      out.push({
        role_id: track.roleId,
        location: {
          place_id: track.placeId,
          x: Math.round(track.state.x),
          y: Math.round(track.state.y),
          facing: track.state.facing,
        },
      })
    }
    return out
  }
}
