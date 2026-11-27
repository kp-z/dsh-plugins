/**
 * 活动（Activity）：角色"正在做的那件事"的**身份**。
 *
 * 为什么需要它：以前只有 activityKind + activityUntil 两个散字段——
 * 没有 id、没有开始/结束、没有中断语义。于是：
 * · 前端头顶的 active_activity 填不出来（它要的是类型 + 子类型 + 进度）；
 * · 日志里出不了 phase（活动有开始/结束才谈得上阶段）；
 * · 两次"干活"无法区分，谁打断了谁说不清。
 *
 * 这里的活动是**领域概念**，不认识前端词表：kind/skill 由适配层翻译成
 * ProgrammerActivity / GymExerciseActivity 这类前端类型名。
 */
import type { Activity, ActivityPurpose, Agent, World } from '../domain/types.js'
import { nextLogSeq } from './journal.js'
import { recordActivityEpisode } from './memory.js'

/** 活动环形缓冲：只留最近这些条，世界不该因为活动记录无限膨胀。 */
export const ACTIVITY_KEEP = 64

export interface StartActivityInput {
  kind: Activity['kind']
  ticks: number
  skill?: string | undefined
  stationId?: string | null
  taskAttemptId?: string | undefined
  /** R498：用途直接从入参给，不再要求调用方先写老字段。 */
  purpose?: ActivityPurpose | undefined
  trigger?: { kind: 'player' | 'schedule' | 'self' | 'task'; text?: string | undefined } | undefined
}

/** 开始一个活动：写进世界、挂到人身上，并把老字段同步好（旧机制还在读它们）。 */
export function startActivity(world: World, agent: Agent, input: StartActivityInput): Activity {
  // R481：endActivity 会清掉 agent.activityPurpose，先把它带进活动记录。
  const purpose = input.purpose ?? agent.activityPurpose
  endActivity(world, agent, 'interrupted')
  if (world.activities === undefined) world.activities = []
  world.activitySeq = (world.activitySeq ?? 0) + 1
  const activity: Activity = {
    id: 'act-' + String(world.activitySeq),
    agentId: agent.id,
    kind: input.kind,
    skill: input.skill,
    purpose,
    placeId: agent.placeId,
    stationId: input.stationId ?? null,
    trigger: input.trigger,
    status: 'active',
    startedAt: world.tick,
    startedLogSeq: nextLogSeq(world),
    endsAt: input.taskAttemptId === undefined ? world.tick + Math.max(1, Math.round(input.ticks)) : world.tick,
    taskAttemptId: input.taskAttemptId,
  }
  world.activities.push(activity)
  agent.activityId = activity.id
  agent.activityKind = input.kind === 'sleep' ? 'rest' : input.kind
  if (input.taskAttemptId === undefined) {
    agent.activityUntil = activity.endsAt
    agent.activityTicks = activity.endsAt - activity.startedAt
  }
  return activity
}

/** 结束当前活动（完成或被打断）。没有活动就是 no-op。 */
export function endActivity(world: World, agent: Agent, status: 'completed' | 'interrupted'): Activity | null {
  // 老字段无条件清掉：活动记录可以缺（老存档、测试里直接写的 activityKind），
  // 但"结束了一次活动"这件事必须落地——否则人永远停在 activityKind 上。
  const activity = agent.activityId === undefined ? undefined : (world.activities ?? []).find((item) => item.id === agent.activityId)
  agent.activityId = undefined
  delete agent.activityKind
  delete agent.activityPurpose
  delete agent.activitySkill
  delete agent.activityUntil
  delete agent.activityTicks
  if (activity === undefined) return null
  if (activity.status !== 'active') return activity
  activity.status = status
  activity.endedAt = world.tick
  activity.endedLogSeq = nextLogSeq(world)
  // R497：完成写一条；打断且够长也写（"干了两小时最后失败"不该无痕）。
  recordActivityEpisode(world, activity, world.tick, status)
  return activity
}

/** 角色身上活着的那个活动。 */
export function liveActivityOf(world: World, agent: Agent): Activity | null {
  if (agent.activityId === undefined) return null
  return (world.activities ?? []).find((item) => item.id === agent.activityId) ?? null
}

/**
 * 每 tick 对账：
 * 1. 到点的活动 → completed；
 * 2. 老代码直接写 activityKind/activityUntil（心跳、调度器）→ 补一张活动记录。
 *
 * 第 2 条是过渡期的桥：它让"谁设置活动"这件事只有一个出口，
 * 等老字段彻底退休，这段就可以删。
 */
export function syncActivities(world: World): Activity[] {
  if (world.activities === undefined) world.activities = []
  world.activitySeq = world.activitySeq ?? 0
  const completed: Activity[] = []
  for (const agent of world.agents) {
    const live = liveActivityOf(world, agent)
    if (live?.taskAttemptId !== undefined) {
      const task = world.tasks.find((row) => row.id === agent.carrying)
      if (task?.attemptId !== live.taskAttemptId || task.status !== 'in_progress') endActivity(world, agent, 'interrupted')
      continue
    }
    const endedByFields = agent.activityKind === undefined || (agent.activityUntil !== undefined && world.tick >= agent.activityUntil)
    if (live !== null && endedByFields && live.status === 'active') {
      live.status = 'completed'
      live.endedAt = world.tick
      live.endedLogSeq = nextLogSeq(world)
      agent.activityId = undefined
      agent.activityKind = undefined
      agent.activityPurpose = undefined
      agent.activitySkill = undefined
      agent.activityUntil = undefined
      agent.activityTicks = undefined
      // R497：同一出口补记忆，否则这里完成的活动永远进不了记忆。
      recordActivityEpisode(world, live, world.tick)
      completed.push(live)
      continue
    }
    // R479：走路去站点的路上还不算"活动开始"——到站（targetStation 清空）才采纳。
    // 否则活动记录会在半路创建：stationId 是 null、startedAt 是出发时刻，
    // 记忆/统计里就会出现"08:00–09:43 学习"这种没有地点的条目。
    if (live === null && agent.activityKind !== undefined && agent.targetStation === null) {
      world.activitySeq += 1
      const record: Activity = {
        id: 'act-' + String(world.activitySeq),
        agentId: agent.id,
        kind: agent.activityKind === 'meet' ? 'meet' : agent.activityKind === 'rest' ? 'rest' : agent.activityKind === 'visit' ? 'visit' : 'work',
        trigger: agent.activityTrigger,
        skill: agent.activitySkill,
        purpose: agent.activityPurpose,
        placeId: agent.placeId,
        stationId: agent.station,
        status: 'active',
        startedAt: world.tick,
        startedLogSeq: nextLogSeq(world),
        endsAt: agent.activityUntil ?? world.tick + 1,
      }
      world.activities.push(record)
      agent.activityId = record.id
      agent.activityTrigger = undefined
    }
  }
  const excess = world.activities.filter((activity) => activity.status !== 'active').length - ACTIVITY_KEEP
  if (excess > 0) {
    let remaining = excess
    world.activities = world.activities.filter((activity) => activity.status === 'active' || remaining-- <= 0)
  }
  return completed
}
