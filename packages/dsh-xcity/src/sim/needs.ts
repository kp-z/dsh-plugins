/**
 * R477/R478：内在状态——体力 / 饥饿 / 社交。
 *
 * 取值 0–100，**100 = 满足**（有体力 / 吃饱 / 社交满足）。
 * 1 tick = 1 游戏分钟（与前端时钟同一套换算，见 adapters/slowvale/types.ts）。
 *
 * 这里只回答"量怎么变"；"因此去哪、做什么"是 `sim/life.ts` 的选择器。
 *
 * R478：活动用途（`agent.activityPurpose`）决定恢复方向：
 * meal/sleep/rest/social/study/work 各一条；没有用途的（玩家指令、老代码）按状态兜底。
 * 只在**到站之后**（`station !== null`）按用途恢复——走路去吃饭的路上不该算吃过了。
 */
import { DEFAULT_NEEDS } from '../domain/types.js'
import type { ActivityPurpose, Agent, AgentNeeds, AgentState, World } from '../domain/types.js'
import { activityPurposeOf } from './activity-view.js'

/** 满值。所有量都夹在 [0, NEED_MAX]。 */
export const NEED_MAX = 100

/** 每游戏分钟的基线衰减：什么都不做也会慢慢饿、累、想说话。 */
const BASE_DECAY = { energy: 0.045, hunger: 0.075, social: 0.04 } as const

/**
 * 状态兜底（每分钟，叠加在基线之上）。
 *
 * 没有 activityPurpose 时用它；带用途的活动见 `rateOfPurpose`。
 * 数值与 3.3.1 的"一天的账"对过：睡 8h 约 +72，工作 8h 约 −31。
 */
const STATE_RATE: Record<AgentState, { energy: number; hunger: number; social: number }> = {
  idle: { energy: 0, hunger: 0, social: 0 },
  walking: { energy: -0.01, hunger: 0, social: 0 },
  traveling: { energy: -0.01, hunger: 0, social: 0 },
  working: { energy: -0.02, hunger: -0.01, social: -0.01 },
  talking: { energy: 0, hunger: 0, social: 0.12 },
  blocked: { energy: 0, hunger: 0, social: 0 },
  celebrating: { energy: -0.01, hunger: 0, social: 0.05 },
  sleeping: { energy: 0.15, hunger: -0.02, social: 0 },
}

/**
 * 用途带来的变化（每分钟，叠加在基线上）。R478。
 *
 * 数值来自"一天的账"：
 * - 一顿 40 tick 补 ~45 饥饿；一天三顿对 −108 的消耗；
 * - 睡 480 tick 补 ~146 体力（会夹到 100），够撑一天；
 * - 聊 40 tick 补 ~22 社交，一天两次略缺，正好推动主动短信。
 */
const PURPOSE_RATE: Record<ActivityPurpose, { energy: number; hunger: number; social: number }> = {
  meal: { energy: 0.05, hunger: 1.2, social: 0 },
  sleep: { energy: 0.35, hunger: -0.02, social: 0 },
  rest: { energy: 0.35, hunger: -0.02, social: 0 },
  social: { energy: 0, hunger: 0, social: 0.6 },
  study: { energy: -0.02, hunger: -0.01, social: -0.01 },
  work: { energy: -0.02, hunger: -0.01, social: -0.01 },
}

function clamp(value: number): number {
  return value < 0 ? 0 : value > NEED_MAX ? NEED_MAX : value
}

/** 缺省补全：老存档 / 手工构造的世界都可能没有 needs。 */
export function needsOf(agent: { needs?: AgentNeeds | undefined }): AgentNeeds {
  return agent.needs ?? { ...DEFAULT_NEEDS }
}

function rateFor(world: World, agent: Agent): { energy: number; hunger: number; social: number } {
  // 只在到站后按用途恢复：走路去吃饭的路上不算吃过。
  // R485：用途从“活动读入口”取（Activity 优先，老字段兜底）。
  const purpose: ActivityPurpose | undefined = activityPurposeOf(world, agent)
  if (agent.station !== null && purpose !== undefined) {
    return PURPOSE_RATE[purpose] ?? STATE_RATE[agent.state] ?? STATE_RATE.idle
  }
  return STATE_RATE[agent.state] ?? STATE_RATE.idle
}

/**
 * 推进一 tick 的内在状态（就地修改）。
 *
 * 放在所有阶段之后、emit 之前调用：这一 tick 的状态已经定格，
 * 事件与快照读到的是同一个值。
 */
export function advanceNeeds(world: World): void {
  for (const agent of world.agents) {
    const needs = needsOf(agent)
    const rate = rateFor(world, agent)
    agent.needs = {
      energy: clamp(needs.energy - BASE_DECAY.energy + rate.energy),
      hunger: clamp(needs.hunger - BASE_DECAY.hunger + rate.hunger),
      social: clamp(needs.social - BASE_DECAY.social + rate.social),
    }
  }
}
