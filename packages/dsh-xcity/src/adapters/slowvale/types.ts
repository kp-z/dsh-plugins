/**
 * Slow Vale 前端所消费的世界视图。
 *
 * 这里**不复制** Slow Vale 的全部类型，只声明我们真正投影出去的部分：
 * 前端是编译产物，字段名是它定的，写错一个就白屏——所以每个字段旁边都记着
 * "为什么必须是这个名字"（来源：GameView.js 的 an() 校验器与 applyPayload()）。
 */

/** world 内核里我们读到的角色。字段名来自 content/instantiate.ts。 */
export interface WorldAgentLike {
  id: string
  name: string
  state?: string
  station?: string | null
  position?: { x?: number; z?: number }
  /** 剩余路径点（内核 sim/movement 用同一套；坐标就是地图像素）。 */
  path?: { x: number; z: number }[]
  facing?: number
  boundAgentId?: string | null
}

/** world 内核的世界快照。我们只读这几个字段。 */
export interface WorldLike {
  id: string
  name: string
  tick: number
  paused?: boolean
  agents: WorldAgentLike[]
}

/** Slow Vale 的协议版本。与请求头 X-TCW-Protocol-Version 是同一个数字。 */
export const SLOWVALE_PROTOCOL_VERSION = 76

/** 一 tick 算多少游戏分钟。世界 10Hz，1440 tick 走完一天（约 2.4 分钟）。 */
export const TICKS_PER_GAME_MINUTE = 1
export const MINUTES_PER_DAY = 1440
