/**
 * 调度器（BACKLOG M2-4）。
 *
 * 给每个空闲角色原子地 claim 一张可领取的工单，并按 `requires` 的能力挑一个**有空位**的站点。
 *
 * ## 为什么是"原子 claim"
 *
 * 一条 tick 内，一张工单最多被一个角色拿到。这不是靠"先查再改"的时序小心来保证的，
 * 而是**结构上保证**：本模块在一趟遍历里完成"挑单 + 挑人 + 挑站点 + 写状态"，
 * 中途没有任何 await、也没有第二次遍历去重复挑同一张单。
 * 一旦这里出现异步或两次遍历，"两个人抢到同一张单"就会变成偶发问题。
 *
 * ## 容量与座位
 *
 * 站点容量是硬约束。占用者包括**已经在那里的**和**正在走过去的**——
 * 只看前者会让三个人同时被派到一张单人工位上，然后到达时才发现挤不下。
 * 座位号也在 claim 时定好，写进路径；到达时不用再算（到达时再算会拿到不确定的序号）。
 *
 * ## 派单公平（R514）
 *
 * 原来的候选顺序就是 `world.agents` 的原序，于是**同一个人总是先拿到单**：
 * 他交完工回到 idle，又排在队首，下一张单还是他的（H6 现场：agent-1 做了
 * task-1 与 task-3，agent-3 一张没拿到）。现在按「今天经手最少的人优先」排队，
 * 平手按 `agent.id`，保证同一世界同一 tick 挑到同一个人。
 *
 * 口径的代价：没有"领取时刻"字段，跨天领、隔天交的单会算在**交工那天**
 *（见 `loadToday`）。这比精确账本粗，但"今天空着的人先上"这个判断不受影响。
 *
 * ## 不在这里发事件
 *
 * 返回"谁领了什么"，事件由 `step.ts` 统一产出。
 */
import { stationSlot } from '../domain/geometry.js'
import { findPath } from './pathfind.js'
import { DAY_TICKS } from './memory.js'
import type { Agent, Station, Task, World } from '../domain/types.js'

/** 一次派工。 */
export interface Claim {
  agentId: string
  taskId: string
  stationId: string
  /** 本轮尝试 id。重新派工时换新，旧 attempt 的汇报会被拒（M7 用）。 */
  attemptId: string
}

/** 派不出去的原因。 */
export interface Stalled {
  taskId: string
  reason: 'no-station' | 'no-worker'
  /** 给人看的说明（诊断与测试直接读它）。 */
  detail: string
}

/** 一次调度的结果。 */
export interface SchedulerOutcome {
  claims: Claim[]
  stalled: Stalled[]
}

/**
 * 站点当前被占用多少。
 *
 * **已经在那里的**与**正在过去的**都算——理由见文件头。
 */
export function occupancyOf(world: World, stationId: string): number {
  let n = 0
  for (const agent of world.agents) {
    if (agent.station === stationId) n += 1
    else if (agent.targetStation === stationId) n += 1
  }
  return n
}

/**
 * 挑一个能承载这张工单、且还有空位的站点。
 *
 * 判据是**能力包含**（`requires` ⊆ `station.capabilities`），不是"有交集"：
 * 一张要求「评审 + 讨论」的单，放在只有「评审」的桌上是不对的。
 *
 * 遍历顺序按 `world.stations` 原序（由内容库场景的站点列表决定，稳定），
 * 不排序也不随机——**同一个世界的同一 tick 必须挑到同一个站点**。
 *
 * @returns 站点与座位号；挑不到返回 null。
 */
export function pickStation(world: World, task: Task): { station: Station; slotIndex: number } | null {
  for (const station of world.stations) {
    const covers = task.requires.every((need) => station.capabilities.includes(need))
    if (!covers) continue
    const used = occupancyOf(world, station.id)
    if (used >= station.capacity) continue
    return { station, slotIndex: used }
  }
  return null
}

/** 空闲角色：状态 `idle` 且手上没有工单。 */
function idleAgents(world: World): Agent[] {
  return world.agents.filter((a) => a.state === 'idle' && a.carrying === null)
}

/** R514：今天从哪个 tick 起。边界用 `sim/memory.ts` 的 `DAY_TICKS`，不另写一份。 */
function dayStartOf(tick: number): number {
  return Math.floor(Math.max(0, tick) / DAY_TICKS) * DAY_TICKS
}

/**
 * R514：每个角色「今天」经手了几张单。**只用既有字段，不新增状态。**
 *
 * 依据 `world.tasks`：`owner` 是唯一的人单归属记录，完工与失败都**不清**它
 *（`step.ts` 的 taskComplete 只改状态，`recovery.ts` 只在回收时才清）。
 * 时间戳也只有两个既有字段可用：
 * - 已完工的单有 `finishedAtTick`：看它是否落在今天；
 * - 在办/失败的单没有结束 tick：看 `createdAtTick` 是否落在今天。
 *
 * 只给花名册里的角色记账（键来自 `world.agents`）：离职/历史 owner 的单不计入。
 */
function loadToday(world: World, dayStart: number): Map<string, number> {
  const load = new Map<string, number>()
  for (const agent of world.agents) load.set(agent.id, 0)
  for (const task of world.tasks) {
    if (task.owner === null) continue
    const handledAt = task.finishedAtTick ?? task.createdAtTick
    if (handledAt < dayStart) continue
    const count = load.get(task.owner)
    if (count === undefined) continue
    load.set(task.owner, count + 1)
  }
  return load
}

/**
 * R514：空闲角色按「今天经手最少」排好，平手按 `agent.id`。
 *
 * 同一个人这一轮拿到的第二张由 `taken` 挡掉，所以这里只需要回答
 * 「今天谁还空着」——不需要每派一张就重算一遍。
 */
function idleAgentsByFairness(world: World): Agent[] {
  const load = loadToday(world, dayStartOf(world.tick))
  return idleAgents(world).sort(
    (a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/**
 * 推进一 tick 的派工。
 *
 * **会就地修改 `world.tasks` 与 `world.agents`。**
 *
 * @param world - 世界（就地修改）。
 */
export function claimTasks(world: World, sessionWorkers?: ReadonlySet<string>): SchedulerOutcome {
  const claims: Claim[] = []
  const stalled: Stalled[] = []

  // 可领取的工单，按（创建 tick, 创建序号）排序——**不用 id 字符串排序**：
  // `task-10` 的字符串序在 `task-2` 前面，那会让优先级在两位数时静默改变。
  const ready = world.tasks
    .filter((t) => t.status === 'ready')
    .sort((a, b) => a.createdAtTick - b.createdAtTick || a.ordinal - b.ordinal)

  if (ready.length === 0) return { claims, stalled }

  // 本次调度里已经被占用的角色，避免一张单派给同一个人两次。
  const taken = new Set<string>()
  // R514：候选顺序 = 今天经手最少的人优先（理由见文件头与 `loadToday`）。
  // **同职业优先仍然是硬偏好**，只在同职业内部按这个顺序挑；没有同职业才落到总体最空的人。
  const available = idleAgentsByFairness(world)

  // R514：同一批内不重复派同一个人。
  //
  // 现场：task-8 给了 agent-1 之后另外两个人都在睡觉，task-9 于是又落回 agent-1。
  // 只看"谁现在闲"不够——同批的单本来就该分给不同的人。
  const batchTicks = new Set(ready.map((task) => task.createdAtTick))
  const batchLoad = (agentId: string): number =>
    world.tasks.filter((task) => task.owner === agentId && batchTicks.has(task.createdAtTick)).length

  for (const task of ready) {
    const free = available.filter((a) => !taken.has(a.id) &&
      (task.externalId !== null || sessionWorkers === undefined || sessionWorkers.has(a.id)) &&
      (task.owner === null || task.owner === a.id))
    if (free.length === 0) {
      stalled.push({
        taskId: task.id,
        reason: 'no-worker',
        detail: '没有空闲角色了。等有人干完手上的活，或招募更多角色。',
      })
      continue
    }

    const chosen = pickStation(world, task)
    if (chosen === null) {
      stalled.push({
        taskId: task.id,
        reason: 'no-station',
        detail:
          `没有任何站点能承载能力 [${task.requires.join(', ')}] 且还有空位。` +
          `可以加一个带这些能力的站点，或等占着的人干完。`,
      })
      continue
    }

    // ── 外部已经指派了人（D41，R39）：**必须尊重它**，不许调度器自己挑 ──────────
    //
    // R39 的测试当场抓到：调度器原本无视外部指派，按职业自己挑人并覆写 `owner`，
    // **还覆写 `attemptId`**——后者是致命的：agent-teams 的完成汇报带的是它自己的代次，
    // 被覆写之后每一次真实的完成都会被 `applyExternalTasks` 当成"旧代"拒掉，
    // 于是 live 世界里**没有任何一张单能真正完成**，而且不会有任何报错。
    // live 下接上团队、但团队还没指派的单：**小镇不许自己挑人**（R43 真机抓到）。
    // 否则小镇先派给小青、写下自己的代次，随后团队派给小紫——小镇的代次让团队的指派与完成全被当成"旧代"拒掉，
    // 结果是团队已经做完，小镇这边永远卡在"进行中"。
    if (world.mode === 'live' && task.externalId !== null && task.owner === null) {
      stalled.push({ taskId: task.id, reason: 'no-worker', detail: '等团队指派：这张单接在团队任务上，由团队决定谁来做。' })
      continue
    }

    const externallyOwned = task.externalId !== null && task.owner !== null
    const assigned = externallyOwned ? free.find((a) => a.id === task.owner) : undefined
    if (externallyOwned && assigned === undefined) {
      // 指派的人此刻不空闲（还在忙别的）：等他，而不是把单塞给别人。
      stalled.push({
        taskId: task.id,
        reason: 'no-worker',
        detail: '团队把这张单派给了一个此刻还在忙的角色：等他忙完再开工。',
      })
      continue
    }

    // R514：**公平优先，职业只在同一负载档内做次级偏好**。
    //
    // 早先的写法是"同职业优先"覆盖一切，实测结果：lead 只有一个人，于是三张单
    // 里的两张都给了他、另一个人一张没有（H6 现场）。职业匹配不值得破坏轮转——
    // 工单的能力要求本来就按**站点能力**校验（pickStation），不是按角色职业。
    const load = loadToday(world, dayStartOf(world.tick))
    // R514：先把"本批已经拿过单的人"排除。
    //
    // 排除之后如果**还有人没拿过本批的单**（哪怕此刻在忙/在睡），就宁可不派——
    // 让这张单等着，也不要重复派给同一个人。现场：另外两人都在睡觉时，
    // 第三张单会直接落回刚干完的那个人，于是"一人一张"永远做不到。
    const fresh = free.filter((a) => batchLoad(a.id) === 0)
    if (fresh.length === 0 && world.agents.some((a) => batchLoad(a.id) === 0)) {
      stalled.push({
        taskId: task.id,
        reason: 'no-worker',
        detail: '本批其他人还没拿过单，但他们此刻在忙/在睡：等他空出来，而不是把第二张塞给同一个人。',
      })
      continue
    }
    const pool = fresh.length > 0 ? fresh : free
    const least = pool[0]
    if (least === undefined) continue
    const matching = pool.find((a) =>
      task.suggestedRole !== null &&
      a.role === task.suggestedRole &&
      (load.get(a.id) ?? 0) === (load.get(least.id) ?? 0),
    )
    const agent = assigned ?? matching ?? least

    if (agent === undefined) continue

    const slot = stationSlot(chosen.station, chosen.slotIndex)
    // 外部指派的单保留外部代次；只有小镇自己派的单才用自己的代次。
    const attemptId = externallyOwned && task.attemptId !== null ? task.attemptId : `attempt-${world.tick}-${task.id}`

    task.status = 'in_progress'
    task.owner = agent.id
    task.station = chosen.station.id
    task.attemptId = attemptId
    task.progress = 0

    agent.carrying = task.id
    // 触发来源是这张工单：日志里的 decision 会写它的标题，不编理由。
    agent.activityTrigger = { kind: 'task', text: '接了工单「' + task.title + '」' }
    agent.targetStation = chosen.station.id
    agent.station = null
    // R64 物理：**绕障路径**，不再是一个终点（那会直线穿墙）。
    // `findPath` 返回一串途经点；`movement.ts` 的循环逐个 shift，逻辑一行没改。
    agent.path = findPath(world.nav, agent.position, slot)
    agent.state = 'walking'

    taken.add(agent.id)
    claims.push({ agentId: agent.id, taskId: task.id, stationId: chosen.station.id, attemptId })
  }

  return { claims, stalled }
}
