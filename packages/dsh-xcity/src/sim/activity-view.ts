/**
 * R485：活动的唯一读入口。
 *
 * 现状是两套真相：`agent.activityKind/activityUntil/activityPurpose/activitySkill`
 * 这套老字段给 movement/idle 用；`world.activities` 是正式记录。
 * 这一小时**只统一读**：读的人先问 Activity，没有活动记录才回退老字段；
 * 写入路径不动（等下一轮再收）。
 */
import type { Activity, ActivityPurpose, Agent, World } from '../domain/types.js'

/** 这个人当前正在做的活动记录；没有/已结束/对不上就 null。 */
export function currentActivityOf(world: World, agent: Agent): Activity | null {
  if (agent.activityId === undefined) return null
  const activity = (world.activities ?? []).find((item) => item.id === agent.activityId)
  if (activity === undefined || activity.status !== 'active') return null
  return activity
}

/** 活动用途：Activity 优先，老字段兜底。 */
export function activityPurposeOf(world: World, agent: Agent): ActivityPurpose | undefined {
  return currentActivityOf(world, agent)?.purpose ?? agent.activityPurpose
}

/** 活动技能：Activity 优先，老字段兜底。 */
export function activitySkillOf(world: World, agent: Agent): string | undefined {
  return currentActivityOf(world, agent)?.skill ?? agent.activitySkill
}

/** 活动类型（老口径：sleep 归到 rest）：Activity 优先，老字段兜底。 */
export function activityKindOf(world: World, agent: Agent): Agent['activityKind'] {
  const activity = currentActivityOf(world, agent)
  if (activity === null) return agent.activityKind
  if (activity.kind === 'sleep') return 'rest'
  return activity.kind === 'work' || activity.kind === 'meet' || activity.kind === 'rest' || activity.kind === 'visit'
    ? activity.kind
    : agent.activityKind
}
