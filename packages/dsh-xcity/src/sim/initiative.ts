/**
 * R480：角色主动找玩家。
 *
 * 决定放在 sim（世界只经 step 改）：社交低、或刚做完一件事时，
 * 角色会想给玩家发条短信；限频字段随存档。app 只负责把"想发"变成真正的会话投递。
 *
 * 时间：1 tick = 1 游戏分钟；一天 1440 tick。白天 07:00–23:00 才发。
 */
import type { World } from '../domain/types.js'
import { needsOf } from './needs.js'
import { DAY_TICKS } from './memory.js'

const DAY_START = 7 * 60
const DAY_END = 23 * 60
/** 两次主动短信至少隔 3 游戏小时。 */
const MIN_GAP = 180
/** 当天最多 2 条。 */
const MAX_PER_DAY = 2
/** "刚做完一件事"的窗口：30 游戏分钟。 */
const NOTABLE_WINDOW = 30

export interface InitiativeIntent {
  agentId: string
  reason: string
  tick: number
}

function minuteOf(tick: number): number {
  return ((Math.floor(tick) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS
}

/** 这个人是不是刚做完一件"值得说一声"的事（读世界记录，不编）。 */
function justDidSomething(world: World, agentId: string, now: number): boolean {
  return (world.activities ?? []).some(
    (activity) =>
      activity.agentId === agentId &&
      activity.status === 'completed' &&
      activity.endedAt !== undefined &&
      now - activity.endedAt <= NOTABLE_WINDOW &&
      // 日常干活不算"值得说"：只认完成工单、或研究/学习这类有积累的事。
      activity.kind === 'work' &&
      (activity.taskAttemptId !== undefined || activity.skill === 'research'),
  )
}

/**
 * 推进主动短信的"想不想发"（就地写限频字段）。
 *
 * 返回本 tick 真要发的意图；同一个人不会在一天里超过 2 条。
 */
export function advanceInitiative(world: World): InitiativeIntent[] {
  const now = Math.floor(world.tick)
  const minute = minuteOf(now)

  const intents: InitiativeIntent[] = []
  for (const agent of world.agents) {
    const day = Math.floor(now / DAY_TICKS)
    // 换天重置计数（即使今天不发，也要把日期推进）。
    if (agent.initiatedSmsDay !== day) {
      agent.initiatedSmsDay = day
      agent.initiatedSmsCount = 0
    }
    if ((agent.initiatedSmsCount ?? 0) >= MAX_PER_DAY) continue
    if (minute < DAY_START || minute >= DAY_END) continue
    if (agent.lastInitiatedSmsTick !== undefined && now - agent.lastInitiatedSmsTick < MIN_GAP) continue
    // 睡着/正在对话/被卡住：不打扰。
    if (agent.state === 'sleeping' || agent.state === 'talking' || agent.state === 'blocked') continue
    if (agent.carrying !== null) continue

    const needs = needsOf(agent)
    let reason: string | null = null
    if (needs.social < 35) reason = '今天有点想找人聊聊'
    else if (justDidSomething(world, agent.id, now)) reason = '刚忙完一件事，想跟你说一声'
    if (reason === null) continue

    agent.lastInitiatedSmsTick = now
    agent.initiatedSmsCount = (agent.initiatedSmsCount ?? 0) + 1
    intents.push({ agentId: agent.id, reason, tick: now })
  }
  return intents
}
