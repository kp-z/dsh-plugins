/**
 * 模拟一步（BACKLOG M2-3）。
 *
 * ## 六段固定顺序
 *
 * ```
 * ingest → scheduler → movement → interaction → mailbox → emit
 * ```
 *
 * 顺序是语义的一部分，不是风格：
 * - `ingest` 在最前，所以"这一 tick 收到的命令"立刻影响这一 tick 的世界；
 * - `scheduler` 在 `movement` 前，所以刚被派出去的人**这一 tick 就开始走**；
 * - `interaction` 在 `movement` 后，所以**到站当 tick 就能开始干活**；
 * - `emit` 在最后，所以它看到的是这一 tick 的最终状态。
 *
 * `scheduler` 段的第一件事是 `recomputeReady()`——调度器的输入必须是"依赖已求值"的状态，
 * 而这个求值全世界只有那一处实现（见 `ready.ts`）。
 *
 * ## 签名里没有 `dt`，这是刻意的
 *
 * 原计划是 `step(world, dt, commands)`。但**这是定步长模拟**：一次调用 = 前进一个 tick，
 * `dt` 永远等于 `tickMs`，收到它却不用它只会让人以为"传别的值会改变结果"。
 * 步长属于编排层（`runtime` 决定多久调一次 `step`），不属于模拟内核。
 *
 * ## 模拟内核不认识内容库，所以有些命令它做不了
 *
 * `reset` / `dispatch` / `hire` 都需要**内容**（场景布局、任务集、花名册），
 * 而 `sim/` 按边界规则不许 import `content/`。所以 `step()` 把它们**转交**出去，
 * 放在 `StepResult.requests` 里由编排层执行。
 *
 * 这不是权宜之计，而是那条边界规则在起作用：模拟内核只认装配好的 `World`。
 * 顺带的好处是 `step()` 可以在**没有任何内容注册表**的情况下被测试。
 *
 * ## "纯"的含义
 *
 * `step()` **就地修改传入的 world 并返回它**（同一个引用）。"纯"指的是：
 * 不碰 IO、不用未注入的随机与时间。调用方要么拥有这个世界，要么先克隆一份。
 */
import type {
  Activity, WorldEventType, AgentRole, World, WorldEvent } from '../domain/types.js'
import type { WorldCommand } from '../protocol/wire/commands.js'
import { advanceMovement } from './movement.js'
import { arriveTravelers, beginTravel } from './travel.js'
import { endActivity, liveActivityOf, startActivity, syncActivities } from './activity.js'
import { advanceWork } from './interaction.js'
import { advanceIdle } from './idle.js'
import { recoverStalledTasks } from './recovery.js'
import type { StepContext } from '../protocol/idle.js'
import { dispatchComms } from './comms.js'
import type { CommsOutcome } from './comms.js'
import type { DeliverOutcome } from './mailbox.js'
import { deliverMessages } from './mailbox.js'
import { runHeartbeats } from './heartbeat.js'
import { DAY_TICKS, writeDayDigest } from './memory.js'
import { advanceNeeds } from './needs.js'
import { advanceInitiative } from './initiative.js'
import { applyMeetAffinity } from './relationships.js'
import { emitPhaseEvents } from './emit.js'
import { emitEvent } from './journal.js'
import { recomputeReady } from './ready.js'
import { claimTasks, occupancyOf } from './scheduler.js'
import { findPath } from './pathfind.js'
import { stationSlot } from '../domain/geometry.js'
import type { Claim, Stalled } from './scheduler.js'

/**
 * 模拟内核做不了、要转交给编排层的动作。
 *
 * 每一项都需要内容注册表（`sim/` 按边界规则不许 import `content/`）。
 */
export interface StepRequests {
  /** 要重开一局（需要场景与内容）。 */
  reset: { name: string | null } | null
  /** 要用任务库派进世界的任务集 id。 */
  dispatch: string[]
  /** 要招募的角色（需要花名册）。 */
  hire: { role: AgentRole; name: string | null }[]
  /** 要设置的真实时间倍速（编排层的事，不影响模拟结果）。 */
  setSpeed: number | null
  /**
   * 外部（agent-teams）对工单的裁决（D41，R39）。
   *
   * **这些就地改世界，与 `dispatch`/`hire` 不同**——那两个要内容库才能落（由编排层完成），
   * 而"某张单被派给谁 / 做完了 / 失败了"是纯粹的既有事实，模拟内核自己能落。
   * 而且它们必须**在同一 tick 内生效**：否则面板上会出现"人还在工位上忙，但单已经完成"的一帧。
   */
  external: ExternalTaskCommand[]
}

/** 外部裁决一条工单（D41）。 */
export type ExternalTaskCommand =
  | { readonly kind: 'taskAssign'; readonly taskId: string; readonly agentId: string; readonly attemptId: string }
  | { readonly kind: 'taskComplete'; readonly taskId: string; readonly attemptId: string; readonly output: string | null }
  | { readonly kind: 'taskFail'; readonly taskId: string; readonly attemptId: string; readonly reason: string }
  | { readonly kind: 'taskLink'; readonly taskId: string; readonly externalId: string }

/** 一步的结果。 */
export interface StepResult {
  /** 就是传进来的那个 world（就地修改）。 */
  world: World
  /** 本 tick 产生的事件（`seq` 单调，已写进 `world.events`）。 */
  events: WorldEvent[]
  /** 本 tick 派出去的工。 */
  claims: Claim[]
  /** 派不出去的原因（诊断用，**刻意不发事件**——没空闲角色时每 tick 都成立，发出来只会刷屏）。 */
  stalled: Stalled[]
  /** 转交给编排层的动作。 */
  requests: StepRequests
  /** 本 tick 新开始飞行的协作消息（M2.5-2）。 */
  messages: CommsOutcome['queued']
  /** 本 tick 送达的消息（诊断用；**不发事件**——送达时刻由 `deliverAtTick` 算得出来）。 */
  delivered: DeliverOutcome['delivered']
  /**
   * 本 tick 被**不变量修复**退回 ready 的单（R151 / task-25）。
   *
   * 放在这里而不是只发事件：真机验收要能"读到"它（`/api/world` 不含 StepResult，
   * 但测试与诊断可以拿它断言"回收确实发生了、回收了几张"）。
   */
  recovered: { taskId: string; ownerId: string | null; stalledTicks: number }[]
}

function emptyRequests(): StepRequests {
  return { reset: null, dispatch: [], hire: [], setSpeed: null, external: [] }
}

/**
 * 处理命令阶段：能就地做的就地做，需要内容的转交出去。
 *
 * @param world - 世界（就地修改 `paused`）。
 * @param commands - 本 tick 收到的命令。
 * @param requests - 要在其上累加转交项的容器（就地修改）。
 * @returns 本阶段产生的事件载荷（由调用方交给 `journal` 记账）。
 */
function ingest(
  world: World,
  commands: readonly WorldCommand[],
  requests: StepRequests,
): { type: WorldEventType; payload: Record<string, unknown> }[] {
  const out: { type: WorldEventType; payload: Record<string, unknown> }[] = []

  for (const command of commands) {
    switch (command.kind) {
      case 'pause':
        if (!world.paused) {
          world.paused = true
          out.push({ type: 'world.paused', payload: { paused: true } })
        }
        break
      case 'resume':
        if (world.paused) {
          world.paused = false
          out.push({ type: 'world.paused', payload: { paused: false } })
        }
        break
      case 'reset':
        requests.reset = { name: command.name }
        break
      case 'dispatch':
        requests.dispatch.push(command.taskSet)
        break
      case 'hire':
        requests.hire.push({ role: command.role, name: command.name })
        break
      case 'setSpeed':
        requests.setSpeed = command.speed
        break
      case 'taskAssign':
      case 'taskComplete':
      case 'taskFail':
      case 'taskLink':
        requests.external.push(command)
        break
      case 'agentActivity': {
        const agent = world.agents.find((item) => item.id === command.agentId)
        if (agent === undefined) break
        // R494：角色接受玩家建议也不能打断正在进行的生活或工单。
        if (command.trigger?.kind === 'player' && (
          agent.state !== 'idle' || agent.carrying !== null || agent.activityId !== undefined ||
          agent.activityUntil !== undefined || agent.targetStation !== null || agent.path.length > 0
        )) break
        if (command.activity === 'idle') {
          agent.state = 'idle'
          agent.station = null
          agent.targetStation = null
          agent.path = []
          endActivity(world, agent, 'completed')
          break
        }
        // "去某地待着"不需要工位：场所里没有椅子也该能站着（内容没建模的地方多得是）。
        const wants = command.activity === 'meet' ? ['converse'] : command.activity === 'rest' ? ['rest'] : [command.skill ?? 'code']
        // 场所：命令没说就用角色当前所在地；说了但这个世界没有那个场所，
        // 就就地做（老档/单场所世界不该因为一个陌生 id 把人派到虚空里）。
        // 跨场所 = 先出行，到了再重放这次活动。
        const places = world.places ?? []
        const requested = command.placeId ?? agent.placeId
        // 没有场所表的老世界：当作"只有一处"，也不按场所过滤站点。
        const placeId = places.length === 0 || places.some((place) => place.id === requested) ? requested : agent.placeId
        if (placeId !== agent.placeId) {
          beginTravel(world, agent, placeId, {
            kind: command.activity === 'meet'
              ? 'meet'
              : command.activity === 'rest'
                ? 'rest'
                : command.activity === 'visit'
                  ? 'visit'
                  : 'work',
            ticks: Math.max(5, Math.round(command.ticks)),
            skill: command.skill,
            trigger: command.trigger,
          })
          break
        }
        if (command.activity === 'visit') {
          agent.state = 'idle'
          agent.station = null
          agent.targetStation = null
          agent.path = []
          startActivity(world, agent, { kind: 'visit', ticks: Math.max(5, Math.round(command.ticks)), trigger: command.trigger })
          break
        }
        // R478：调用方可以指定站点（吃饭去 breakroom、休息去休息位）；指定失效就退回能力搜索。
        const eligible = (candidate: World['stations'][number]): boolean =>
          (places.length === 0 || candidate.placeId === placeId) &&
          candidate.capabilities.some((capability) => wants.includes(capability)) &&
          occupancyOf(world, candidate.id) < candidate.capacity
        const requestedStation = command.stationId === undefined
          ? undefined
          : world.stations.find((candidate) => candidate.id === command.stationId)
        const preferred = requestedStation !== undefined && eligible(requestedStation) ? requestedStation : undefined
        // R482：指定站点满了时优先同房间的另一个空位（两人约好去同一屋，别一个被挤到别的屋）。
        const sameRoom = requestedStation === undefined
          ? undefined
          : world.stations.find((candidate) => candidate.district === requestedStation.district && eligible(candidate))
        const station = preferred ?? sameRoom ?? world.stations.find(eligible)
        if (station === undefined) break
        const path = findPath(world.nav, agent.position, stationSlot(station, occupancyOf(world, station.id)))
        // 活动的身份在到达时创建（见 transition 段）；这里只记下"要做什么"，
        // 用老字段承载，syncActivities 会在下一 tick 采纳成正式活动。
        agent.activityKind = command.activity
        // R478：用途标签（吃饭/睡觉/学习…）；不传就按命令类型推一个默认值。
        agent.activityPurpose = command.purpose ?? (command.activity === 'meet' ? 'social' : command.activity === 'work' ? 'work' : command.activity === 'rest' ? 'rest' : undefined)
        agent.activitySkill = command.skill
        agent.activityTrigger = command.trigger
        agent.activityTicks = Math.max(5, Math.round(command.ticks))
        if (path.length === 0) {
          // R478：已经在站点上（刚干完一轮、原地再开）——直接开始，
          // 不要把命令丢掉；否则要等待命行为把人挪开，白白空转 90 tick。
          agent.station = station.id
          agent.targetStation = null
          agent.state = command.activity === 'meet' ? 'talking' : command.activity === 'rest' ? 'sleeping' : 'working'
          agent.activityUntil = world.tick + Math.max(5, Math.round(command.ticks))
          break
        }
        agent.state = 'walking'
        agent.station = null
        agent.targetStation = station.id
        agent.path = path
        // R478：走路时间不算进活动时长——到站后由 movement 按 activityTicks 起算。
        agent.activityUntil = undefined
        break
      }
      case 'moveAgent': {
        // 键盘操控落地（P4）。**服务端权威**：位置写进世界，客户端才不会被同步拽回去。
        const agent = world.agents.find((item) => item.id === command.agentId)
        if (agent === undefined) break
        // 坏坐标直接拒：NaN 一旦写进位置，寻路/渲染/快照全都会跟着坏掉。
        if (!Number.isFinite(command.x) || !Number.isFinite(command.z)) break

        // ⚠️ R229 纠正：这里**不再按 nav 格夹回**。
        //
        // R226 用"整格不可走"把手动落点夹到最近格中心。但 nav 是保守的整格网格，
        // 而墙/家具的美术只占格子的一部分（office 248 个 blocked 格里 113 个是部分覆盖），
        // 按格夹回会在视觉是地板的地方把人拽回来——用户报的"空气墙错位"。
        //
        // 物理真相是**精细几何**（客户端 Arcade 静态体，按美术轮廓建）。手动操控本来就是
        // 客户端权威；服务端只负责拒绝坏坐标（NaN/Infinity），不再用粗网格二次判定。
        const landed = { x: command.x, z: command.z }
        agent.position = { x: landed.x, z: landed.z }
        // 待命踱步以 `hangout` 为锚：不跟着走的话，下一 tick 待命逻辑会把他往旧歇脚点拽。
        agent.hangout = { x: landed.x, z: landed.z }
        // 清掉在途状态：路径、目标工位、在站标记——他现在就是"玩家放下的人"。
        agent.path = []
        agent.targetStation = null
        agent.station = null
        agent.state = 'idle'
        out.push({
          type: 'agent.moved',
          payload: { id: agent.id, x: landed.x, z: landed.z, source: 'manual' },
        })
        break
      }
    }
  }

  return out
}

/**
 * 把外部裁决落到世界里（D41，R39）。
 *
 * 三条纪律：
 * 1. **认 `attemptId`**：agent-teams 的执行代一变，旧的完成汇报就该被拒——
 *    否则"重新指派之后，上一个执行者的结果把新单标成完成"。空串表示对方没给代次（放行）。
 * 2. **幂等**：已经 done/failed 的单不再改（同步是轮询的，同一件事会被看到很多次）。
 * 3. **指派要连带落位**：人得从当前状态切到"去做这张单"，否则他只是站在广场上，
 *    而工单板说他在忙——那是画面与数据打架。
 *
 * @param world - 世界（就地修改）。
 * @param commands - 本 tick 收到的外部裁决。
 * @returns 要记账的事件载荷。
 */
function applyExternalTasks(
  world: World,
  commands: readonly ExternalTaskCommand[],
): { type: WorldEventType; payload: Record<string, unknown> }[] {
  const events: { type: WorldEventType; payload: Record<string, unknown> }[] = []
  const byId = new Map(world.tasks.map((t) => [t.id, t]))

  for (const command of commands) {
    const task = byId.get(command.taskId)
    if (task === undefined) continue

    // 对应关系：只在还没对应时写（幂等；同一张单不许被改接到另一张团队任务上）。
    if (command.kind === 'taskLink') {
      if (task.externalId === null && command.externalId !== '') {
        task.externalId = command.externalId
        // 一旦有单接上团队，世界就是 live：完成只认团队的裁决（D41）。
        world.mode = 'live'
        events.push({ type: 'task.changed', payload: { taskId: task.id, externalId: command.externalId } })
      }
      continue
    }

    // ① 代次不对：这条裁决属于上一代执行者，丢掉。
    const stale = command.attemptId !== '' && task.attemptId !== null && task.attemptId !== command.attemptId

    if (command.kind === 'taskAssign') {
      // 指派**不做旧代检查**：指派本身就是团队开启新一代，它的代次就是新的真相，要被采纳。
      // （R43 真机：小镇先自己派了、写下自己的代次，若对指派也做旧代检查，团队永远接管不了。）
      if (task.status === 'done' || task.status === 'failed') continue
      const agent = world.agents.find((a) => a.id === command.agentId)
      if (agent === undefined) continue
      if (task.owner === agent.id && task.status === 'in_progress') continue

      // 换人时把上一个人从这张单上摘下来（否则他永远"在忙一张不属于他的单"）。
      if (task.owner !== null && task.owner !== agent.id) {
        const previous = world.agents.find((a) => a.id === task.owner)
        if (previous !== undefined && previous.carrying === task.id) {
          previous.carrying = null
          previous.state = 'idle'
        }
      }
      const ownerChanged = task.owner !== agent.id
      task.owner = agent.id
      task.attemptId = command.attemptId === '' ? task.attemptId : command.attemptId
      // 状态交给调度器在下一 tick 领：它才知道该去哪张桌子（能力匹配在 `claimTasks` 里）。
      // 换了人的进行中单要退回 ready：原来的工位与进度属于上一个人。
      if (task.status === 'pending' || task.status === 'blocked' || (ownerChanged && task.status === 'in_progress')) {
        task.status = 'ready'
        task.station = null
        task.progress = 0
      }
      events.push({ type: 'task.assigned', payload: { taskId: task.id, agentId: agent.id } })
      continue
    }

    if (stale) continue
    if (task.status === 'done' || task.status === 'failed') continue

    const owner = task.owner === null ? undefined : world.agents.find((a) => a.id === task.owner)
    if (owner !== undefined && owner.carrying === task.id) {
      const activity = liveActivityOf(world, owner)
      if (activity?.taskAttemptId !== undefined && activity.taskAttemptId === task.attemptId) {
        endActivity(world, owner, command.kind === 'taskComplete' ? 'completed' : 'interrupted')
      }
      owner.carrying = null
      owner.state = 'idle'
      owner.station = null
      owner.targetStation = null
      owner.path = []
    }

    if (command.kind === 'taskComplete') {
      task.status = 'done'
      task.progress = 1
      task.finishedAtTick = world.tick
      task.station = null
      task.output = command.output
      // 完工不只清 owner：任何 agent 若还挂着这张单（曾接手/投影错位）都要释放，
      // 否则它会一直 carrying，调度器误判“没有空闲角色”。
      for (const carryingAgent of world.agents) {
        if (carryingAgent.carrying === task.id) {
          carryingAgent.carrying = null
          carryingAgent.state = 'idle'
          carryingAgent.station = null
          carryingAgent.targetStation = null
          carryingAgent.path = []
        }
      }
      events.push({ type: 'task.completed', payload: { taskId: task.id, agentId: task.owner, stationId: null } })
    } else {
      task.status = 'failed'
      task.failureReason = command.reason
      events.push({ type: 'task.failed', payload: { taskId: task.id, reason: command.reason } })
    }
  }
  return events
}

/**
 * 推进一 tick。
 *
 * @param world - 世界（**就地修改**）。
 * @param commands - 本 tick 收到的命令；默认空。
 * @param context - 本 tick 的内容上下文（待命行为目录）；默认空 = 老行为。
 * @returns 本 tick 的事件、派工、诊断与转交动作。
 */
export function step(
  world: World,
  commands: readonly WorldCommand[] = [],
  context: StepContext = {},
): StepResult {
  const requests = emptyRequests()
  const events: WorldEvent[] = []

  // ── 0. travel ──
  // 到点的出行先落地：换场所 + 清掉路上状态，然后把攒下的活动当成这一 tick 的命令重放。
  // 放在 ingest 前，所以“落地当 tick 就开始干活”，和工位到站语义一致。
  const arrivedNow = arriveTravelers(world)
  const replay: WorldCommand[] = []
  for (const agentId of arrivedNow) {
    const agent = world.agents.find((item) => item.id === agentId)
    const pending = agent?.pendingActivity
    if (agent === undefined || pending === undefined) continue
    agent.pendingActivity = undefined
    replay.push({
      kind: 'agentActivity',
      agentId,
      activity: pending.kind,
      ticks: pending.ticks,
      ...(pending.skill === undefined ? {} : { skill: pending.skill as 'code' | 'review' | 'research' | 'compute' }),
      ...(pending.trigger === undefined ? {} : { trigger: pending.trigger }),
    })
    events.push(emitEvent(world, 'agent.moved', { agentId, placeId: agent.placeId, travel: true }))
  }
  const allCommands: readonly WorldCommand[] = replay.length > 0 ? [...commands, ...replay] : commands

  // ── 1. ingest ──
  // 先处理命令：暂停时**也要**能收到 resume，所以这一段在暂停判断之前。
  for (const item of ingest(world, allCommands, requests)) {
    events.push(emitEvent(world, item.type, item.payload))
  }

  // 外部裁决在**同一 tick 内**落地（见 `StepRequests.external` 的说明）。
  // 放在暂停判断之前：暂停是"模拟不推进"，不是"外部事实不算数"——
  // 团队里的活不会因为我们按了暂停就停下来，单完成了就该显示完成。
  for (const item of applyExternalTasks(world, requests.external)) {
    events.push(emitEvent(world, item.type, item.payload))
  }

  // 暂停时世界不推进。**注意 `world.tick` 也不加**——tick 是"世界前进了多少"，
  // 暂停期间它不该动，否则 HUD 上会出现"暂停了但时间还在走"。
  if (world.paused) {
    return { world, events, claims: [], stalled: [], requests, messages: [], delivered: [], recovered: [] }
  }

  // R464：读档/重放后可能残留“任务已完成但人还 carrying”的脏状态；
  // 先自愈再调度，否则调度器会误判没有空闲角色。
  for (const agent of world.agents) {
    if (agent.carrying === null) continue
    const carried = world.tasks.find((task) => task.id === agent.carrying)
    // 只自愈“任务确实已完成/失败但人还挂着”；假的 carrying 不在这里猜（测试也会用它造忙态）。
    if (carried !== undefined && (carried.status === 'done' || carried.status === 'failed' || carried.owner !== agent.id)) {
      agent.carrying = null
      agent.state = 'idle'
      agent.station = null
      agent.targetStation = null
      agent.path = []
    }
  }

  // ── 2. scheduler ──
  // 输入必须是"依赖已求值"的状态，而这个求值全世界只有 ready.ts 一处实现。
  const ready = recomputeReady(world)
  const scheduled = claimTasks(world, context.sessionWorkers)

  // ── 3. movement ──
  const movement = advanceMovement(world)

  // ── 3.4 relationship ──
  // R482：到点的聊天在 idle 清站点之前先结算关系；否则两人同一 tick 结束，
  // 先被 idle 清掉 station 的一方会让这一对只涨一边。
  const affinitySeen = new Set<string>()
  for (const agent of world.agents) {
    if (agent.state !== 'talking' || agent.station === null) continue
    if (agent.activityUntil === undefined || world.tick < agent.activityUntil) continue
    const finishing: Activity = {
      id: 'meet-finishing',
      agentId: agent.id,
      kind: 'meet',
      placeId: agent.placeId,
      stationId: agent.station,
      status: 'active',
      startedAt: 0,
      endsAt: 0,
    }
    for (const bump of applyMeetAffinity(world, finishing, affinitySeen)) {
      events.push(emitEvent(world, 'agent.affinity', { ...bump }))
    }
  }

  // ── 3.5 idle ──
  // 待命角色走向歇脚点（M2.5-1）。**放在 movement 之后**：movement 只处理 `walking`，
  // 而这一步只处理 `idle`，两者互不重叠；但刚被派工的人这一 tick 已经是 `walking` 了，
  // 所以不会被这里再挪一次。
  const idle = advanceIdle(world, context.idleBehaviors ?? [], { allowAmbient: context.idleAmbient ?? true })

  // ── 4. interaction ──
  const work = advanceWork(world, context.sessionWorkers)

  // ── 4.5 comms ──
  // 产生协作消息（M2.5-2）。放在 interaction 之后，才能把"本 tick 刚完工的单"报出去。
  // 注意：这里只是**入队**，真正的送达由下面的 mailbox 段按延迟推进。
  const comms = dispatchComms(world, scheduled.claims, work.completed)

  // ── 5. mailbox ──
  const mailbox = deliverMessages(world)
  const heartbeat = runHeartbeats(world, mailbox.delivered)
  const allMessages = { queued: [...comms.queued, ...heartbeat.sent] }
  const intentEvents = heartbeat.intents.map((intent) => emitEvent(world, 'agent.intent', { ...intent }))

  // ── 5.5 不变量修复（R151 / task-25）──
  // **放在所有阶段之后、`world.tick += 1` 之前**：此时本 tick 的状态已经定格，
  // "这个人到底在不在推进那张单"才是最终答案（放在中间会被后续阶段改写，造成假报）。
  //
  // 这一段的职责是把"在进行中却没人推进"的单**退回 ready**（理由见 `recovery.ts` 头注释）。
  // 它和 `idle.ts` 入口那条"押着单的人不算空闲"是一对：那条防再犯，这条收已经卡住的。
  const recovery = recoverStalledTasks(world)

  // ── 5.5 activity ──
  // 活动对账放在 emit 之前：这一 tick 结束的活动要能在同一 tick 的事件里被看见。
  const completedActivities = syncActivities(world)
  for (const activity of completedActivities) {
    events.push(emitEvent(world, 'agent.state', {
      agentId: activity.agentId,
      activityId: activity.id,
      status: 'completed',
      // R481：学习结算需要知道"这是什么活动、学的是什么"。
      kind: activity.kind,
      skill: activity.skill ?? null,
      purpose: activity.purpose ?? null,
    }))
    // R482：同屋聊天完成，双方 +2；同一 tick 同一对只加一次。
    if (activity.kind === 'meet') {
      for (const bump of applyMeetAffinity(world, activity, affinitySeen)) {
        events.push(emitEvent(world, 'agent.affinity', { ...bump }))
      }
    }
  }

  // R497：换天时给每个角色写一条日小结（复用 Episode，kind='day'，幂等）。
  if (world.tick > 0 && world.tick % DAY_TICKS === 0) writeDayDigest(world, world.tick / DAY_TICKS)

  // ── 5.6 needs ──
  // R477：这一 tick 的状态已经定格（活动也对过账），内在量按它变化。
  // 放在 emit 之前：快照与事件读到的是同一份需求值。
  advanceNeeds(world)

  // ── 5.7 initiative ──
  // R480：社交低/刚忙完的人会想主动发条短信。决定与限频都在 sim，
  // app 只订阅事件去投递；这里不碰 IO。
  const initiatives = advanceInitiative(world)
  for (const intent of initiatives) {
    events.push(emitEvent(world, 'agent.initiative', { ...intent }))
  }

  // ── 6. emit ──
  events.push(...intentEvents, ...emitPhaseEvents(world, { ready, scheduler: scheduled, movement, idle, work, comms: allMessages }))

  // tick 在最后自增：上面所有阶段的 `world.tick` 读到的都是"这一步的编号"，
  // 事件的时间戳也因此一致。放在开头加会让事件落在下一个 tick 上，差一帧。
  world.tick += 1

  return {
    world,
    events,
    claims: scheduled.claims,
    stalled: scheduled.stalled,
    requests,
    messages: allMessages.queued,
    delivered: mailbox.delivered,
    recovered: recovery.recovered,
  }
}
