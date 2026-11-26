/**
 * 模拟内核出口（BACKLOG M2）。
 *
 * 设计：**阶段函数只返回"变了什么"，事件只从 `emit.ts` 一处产出。**
 * 阶段函数都是纯的（不碰 IO、不用未注入的随机与时间），各自可单独测。
 *
 * `step()` 把它们按固定顺序串起来，并**就地修改**传入的 `World`。
 * 模拟内核不认识内容库，所以 `reset` / `dispatch` / `hire` 会被转交出去
 * （见 `step.ts` 的 `StepRequests`）。
 */
export type { MovementOutcome } from './movement.js'
export { advanceMovement } from './movement.js'

export type { ReadyOutcome } from './ready.js'
export { isTaskReady, recomputeReady } from './ready.js'

export type { WorkOutcome } from './interaction.js'
export { advanceWork } from './interaction.js'

export type { IdleOutcome } from './idle.js'
export { advanceIdle } from './idle.js'

export type { IdleSlot } from './idle-behavior.js'
export { describeKind, idleSlotAt, lookFacing, paceGoal, quarterFacing, quarterOf, slotTicks } from './idle-behavior.js'

export type { CommsOutcome } from './comms.js'
export { dispatchComms } from './comms.js'

// R480：主动找玩家（决定 + 限频在 sim）。
export { advanceInitiative } from './initiative.js'
export type { InitiativeIntent } from './initiative.js'

// R479：当天经历摘要（进短信 prompt）。
export { summarizeDay } from './day-summary.js'

// R476/R478：没活干时由需求自己安排（吃/睡/歇/社交/干活/学习）。
export { chooseLife, isNightMinute, isWorkMinute, minuteOfDay, selfLifeCommands } from './life.js'
export type { LifeIntent, LifePurpose } from './life.js'

// R477：内在状态（体力/饥饿/社交）随游戏时间变化。
export { advanceNeeds, needsOf, NEED_MAX } from './needs.js'

export type { Claim, SchedulerOutcome, Stalled } from './scheduler.js'
export { claimTasks, occupancyOf, pickStation } from './scheduler.js'

export type { DeliverOutcome, MessageDraft, SendOutcome } from './mailbox.js'
export { deliverMessages, isInFlight, sendMessages } from './mailbox.js'

export { emitEvent } from './journal.js'
export { liveActivityOf, startActivity } from './activity.js'

export type { PhaseOutcomes } from './emit.js'
export { emitPhaseEvents } from './emit.js'

export type { StepRequests, StepResult } from './step.js'
export { step } from './step.js'
export { planTeamSync } from './team-sync.js'
