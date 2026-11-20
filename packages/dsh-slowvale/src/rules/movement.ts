
/**
 * 移动的**手感契约**。
 *
 * ## 为什么这属于"规则"而不是"实现"
 *
 * 前端把每一帧的位置画出来；位置的**变化方式**决定玩家觉得这个人在走路、在滑行，还是在瞬移。
 * 这三件事在数据结构上完全一样（都是 x/y），只能靠**约束**区分：
 *
 * - 每 tick 位移 ≤ 上限 → 不是瞬移；
 * - 朝向只能是四向   → 不是斜着飘；
 * - 到达要吸附       → 不是停在目标点旁边 3 像素。
 *
 * 所以这三条写在这里，并且有单测钉住。谁改坏了，测试先红。
 */
export type Facing = 'up' | 'down' | 'left' | 'right'

export interface Point {
  x: number
  y: number
}

export interface MoveState extends Point {
  facing: Facing
  moving: boolean
}

/** 每 tick 允许的最大位移（像素）。超过这个数，画面上就是"跳"。 */
export const DEFAULT_STEP_PIXELS = 2

/**
 * 朝目标走一步。
 *
 * 规则：
 * 1. 位移长度不超过 step（斜向也不超过，所以按欧氏距离算）；
 * 2. 朝向取**主轴**方向（|dx| > |dy| 用左右，否则用上下），不做斜向朝向；
 * 3. 距离小于 step 时直接落到目标点（吸附），并把 moving 置 false。
 */
export function stepToward(from: MoveState, target: Point, step = DEFAULT_STEP_PIXELS): MoveState {
  if (!(step > 0)) throw new Error('步长必须为正数，收到 ' + String(step))
  const dx = target.x - from.x
  const dy = target.y - from.y
  const distance = Math.hypot(dx, dy)
  if (distance <= step) {
    return { x: target.x, y: target.y, facing: facingFor(dx, dy, from.facing), moving: false }
  }
  const ratio = step / distance
  return {
    x: from.x + dx * ratio,
    y: from.y + dy * ratio,
    facing: facingFor(dx, dy, from.facing),
    moving: true,
  }
}

/** 朝向：主轴优先；几乎不动时保持原朝向（转身要有理由）。 */
export function facingFor(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return fallback
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
}

/** 走到目标的预计 tick 数（用于日程排期与"他什么时候到"）。 */
export function ticksToReach(from: Point, target: Point, step = DEFAULT_STEP_PIXELS): number {
  if (!(step > 0)) throw new Error('步长必须为正数，收到 ' + String(step))
  return Math.ceil(Math.hypot(target.x - from.x, target.y - from.y) / step)
}
