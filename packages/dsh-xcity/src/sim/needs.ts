/**
 * R477：内在状态——体力 / 饥饿 / 社交。
 *
 * 取值 0–100，**100 = 满足**（有体力 / 吃饱 / 社交满足）。
 * 1 tick = 1 游戏分钟（与前端时钟同一套换算，见 adapters/slowvale/types.ts）。
 *
 * 这里只回答"量怎么变"；"因此去哪、做什么"是 `sim/life.ts` 的选择器。
 * 分开的理由与 idle-behavior 一样：状态变化可单测、可回放，决策可以单独换。
 */
import { DEFAULT_NEEDS } from '../domain/types.js'
import type { AgentNeeds, AgentState, World } from '../domain/types.js'

/** 满值。所有量都夹在 [0, NEED_MAX]。 */
export const NEED_MAX = 100

/** 每游戏分钟的基线衰减：什么都不做也会慢慢饿、累、想说话。 */
const BASE_DECAY = { energy: 0.045, hunger: 0.075, social: 0.04 } as const

/**
 * 状态带来的额外变化（每分钟，叠加在基线之上）。
 *
 * 只认已经存在的状态，不新增"吃饭"这种状态：吃饭是活动，等选择器接上后
 * 用活动去补饥饿，而不是再造一个状态机取值。
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

function clamp(value: number): number {
  return value < 0 ? 0 : value > NEED_MAX ? NEED_MAX : value
}

/** 缺省补全：老存档 / 手工构造的世界都可能没有 needs。 */
export function needsOf(agent: { needs?: AgentNeeds | undefined }): AgentNeeds {
  return agent.needs ?? { ...DEFAULT_NEEDS }
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
    const rate = STATE_RATE[agent.state] ?? STATE_RATE.idle
    agent.needs = {
      energy: clamp(needs.energy - BASE_DECAY.energy + rate.energy),
      hunger: clamp(needs.hunger - BASE_DECAY.hunger + rate.hunger),
      social: clamp(needs.social - BASE_DECAY.social + rate.social),
    }
  }
}
