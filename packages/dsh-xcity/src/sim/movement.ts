/**
 * 移动（BACKLOG M2-5）。
 *
 * 把 `walking` 的角色沿 `path` 推向目标站点，到站切 `working`。
 *
 * ## 路径由调度器给，这里不负责找路
 *
 * 调度器 claim 一张工单时就决定了"去哪个站点的哪个座位"，并把路径写进 `agent.path`。
 * 本模块只做**位置推进**。这样切分的好处是：以后换成网格 A\* 或 navmesh，
 * 改的是"路径怎么算出来"（在调度器/寻路模块里），而"怎么沿路走"一行不动。
 *
 * 当前 path 只有一个点（站点座位）。做出真正的绕障路径时，这里的循环逻辑不用改。
 *
 * ## 不在这里发事件
 *
 * 返回"谁动了、谁到了"，事件由 `step.ts` 统一产出。
 */
import { WALK_SPEED } from '../domain/constants.js'
import { angleTo, stepToward } from '../domain/geometry.js'
import type { World } from '../domain/types.js'

/** 一次移动推进的结果。 */
export interface MovementOutcome {
  /** 本 tick 位置发生变化的角色 id。 */
  advanced: string[]
  /** 本 tick 抵达站点并转入 `working` 的角色。 */
  arrived: { agentId: string; stationId: string }[]
  /**
   * 因状态自相矛盾被就地修好的角色 id。
   *
   * 判据：自称 `walking` 但没有目标、或目标站点不存在。这类角色如果不修，
   * 会永远卡在"走路"状态上不动——**静默卡死**是最难查的一类问题，宁可就地修好并报出来。
   */
  repaired: string[]
}

/**
 * 推进一 tick 的移动。
 *
 * **会就地修改 `world.agents`。**
 *
 * @param world - 世界（就地修改）。
 */
export function advanceMovement(world: World): MovementOutcome {
  const stations = new Map(world.stations.map((s) => [s.id, s]))
  const advanced: string[] = []
  const arrived: MovementOutcome['arrived'] = []
  const repaired: string[] = []

  for (const agent of world.agents) {
    if (agent.state !== 'walking') continue

    // ⚠️ **R69：`walking` 有两个主人，判据是 `targetStation`。**
    //
    // | 谁写的 | targetStation | 谁推进 |
    // |---|---|---|
    // | 调度器派工（`scheduler.ts` claim 时**同时**写 state 与 targetStation） | 有 | 这里 |
    // | 待命踱步（`idle.ts`，人往歇脚点附近的点挪） | 无 | `idle.ts` |
    //
    // 所以"没有目标工位的走路"**不是坏数据**，而是**别人的**。这里要跳过，
    // 而不是把它"修好"——修了就是"待命的人刚开始踱步就被打回站着"，
    // 而那正是 R69 要修的症状（人在滑动、却播站立的带）。
    //
    // 那"自称走路又没有目标"这类真正的坏数据谁来收？—— `idle.ts`：
    // 它认领所有 `targetStation === null` 的走路（含连歇脚点都没有、谁都推不动的那种），
    // 推不动就当场收成 `idle` 报出来。**守卫没消失，只是换了主人**——
    // 因为只有那个主人知道"没有目标工位的走路"该往哪走。
    if (agent.targetStation === null) continue

    const station = stations.get(agent.targetStation)

    if (station === undefined) {
      // 声明的目标站点不存在（内容改了 / 存档旧了）：修好，别让它卡住。
      agent.targetStation = null
      agent.path = []
      agent.state = 'idle'
      repaired.push(agent.id)
      continue
    }

    /**
     * R510：到站落位到**自己的槽位**，不要所有人叠在锚点上。
     *
     * 现场：8 人压测时 5 个睡觉的人位置完全重合（都是 station.anchor），
     * 前端就是 5 个精灵叠成一坨。工位本来就有 slots，这里挑一个没被同站
     * 其他人占的槽位；全占满就退回锚点（容量判定在别处，这里不负责拒绝）。
     */
    const seatAt = (): { x: number; z: number } => {
      const taken = new Set(
        world.agents
          .filter((row) => row.id !== agent.id && row.station === station.id)
          .map((row) => String(row.position.x) + ',' + String(row.position.z)),
      )
      const slots = station.slots.length > 0 ? station.slots : [{ x: 0, z: 0 }]
      for (const slot of slots) {
        const spot = { x: station.anchor.x + slot.x, z: station.anchor.z + slot.z }
        if (!taken.has(String(spot.x) + ',' + String(spot.z))) return spot
      }
      return { x: station.anchor.x, z: station.anchor.z }
    }

    /** 到站：落位、占站、转 working。 */
    const arrive = (): void => {
      agent.position = seatAt()
      agent.station = station.id
      agent.targetStation = null
      agent.path = []
      agent.state = agent.activityKind === 'meet' ? 'talking' : agent.activityKind === 'rest' ? 'sleeping' : 'working'
      // 干活时长**从到站开始算**：否则走 6 秒就把 6 秒的活耗光了，人到工位立刻又变回 idle。
      if (agent.activityKind !== undefined && agent.activityTicks !== undefined) {
        agent.activityUntil = world.tick + agent.activityTicks
      }
      arrived.push({ agentId: agent.id, stationId: station.id })
    }

    const next = agent.path[0]
    if (next === undefined) {
      // 兜底：调度器给了空路径。正常不会发生（claim 时至少写入一个座位点）。
      arrive()
      continue
    }

    const moved = stepToward(agent.position, next, WALK_SPEED)
    // 朝向只在真的移动时更新：站在原地面朝跳变看起来像抽帧。
    if (!moved.arrived) agent.facing = angleTo(agent.position, next)
    agent.position = moved.position
    advanced.push(agent.id)
    if (moved.arrived) agent.path.shift()

    // **走到最后一个点的当 tick 就到站**，不是等下一 tick。
    // 等下一 tick 的话，会出现一帧"状态还是 walking、位置已经到了"——
    // 渲染层那一帧不知道该播走路还是坐下，而且看起来像慢了一拍。
    if (agent.path.length === 0) arrive()
  }

  return { advanced, arrived, repaired }
}
