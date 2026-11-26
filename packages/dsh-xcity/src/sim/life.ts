/**
 * R476/R478：角色自己安排生活。
 *
 * R476 只做了"上班时段去工位"；R478 把 H1 的体力/饥饿/社交接进来：
 * 最缺什么就去做什么（吃饭/睡觉/歇一会儿/找人说话/干活/学习），而不是由钟点决定一切。
 *
 * 仍然**不新增 Activity kind 或 AgentState**：吃饭/休息都走 `rest`，学习走 `work + skill`，
 * 用 `purpose` 标签区分"这次 rest 是吃饭还是睡觉"（只影响需求恢复与日志，不影响状态机）。
 *
 * 时间：1 tick = 1 游戏分钟（与前端时钟同一换算）；一天 1440 tick。
 * 决策纯函数：同样的 world 输入得到同样的选择，方便仿真与回放。
 */
import { distance } from '../domain/geometry.js'
import type { Agent, Station, World } from '../domain/types.js'
import type { WorldCommand } from '../protocol/wire/commands.js'
import { needsOf } from './needs.js'
import { occupancyOf } from './scheduler.js'

/** 一天多少游戏分钟（= 多少 tick）。 */
const MINUTES_PER_DAY = 1440

/** 上班时段：[09:00, 12:00) 与 [14:00, 18:00)。 */
const WORK_WINDOWS: readonly (readonly [number, number])[] = [
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60],
]

/** 角色干活/学习用什么能力。 */
const SKILL_OF_ROLE: Record<Agent['role'], 'code' | 'review' | 'research' | 'compute'> = {
  // 工头不是只能在 HR 的评审桌：办公室任意工位都能干活，别让他每天横穿全城。
  lead: 'code',
  engineer: 'code',
  reviewer: 'review',
  researcher: 'research',
  ops: 'compute',
  docs: 'code',
}

/** 触发阈值（100 = 满足；越低越急）。 */
const HUNGER_LOW = 35
const ENERGY_LOW = 30
const SOCIAL_LOW = 35

/** 一次活动持续多少 tick（游戏分钟）。 */
const MEAL_TICKS = 50
const NAP_TICKS = 60
const SLEEP_TICKS = 480
const SOCIAL_TICKS = 40
const WORK_TICKS = 90
const STUDY_TICKS = 90

export type LifePurpose = 'meal' | 'rest' | 'sleep' | 'social' | 'work' | 'study'

export interface LifeIntent {
  purpose: LifePurpose
  /** 指定去哪一站；null = 没有合适站点。 */
  stationId: string | null
  skill?: 'code' | 'review' | 'research' | 'compute'
  ticks: number
  reason: string
}

export function minuteOfDay(tick: number): number {
  return ((Math.floor(tick) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
}

export function isWorkMinute(tick: number): boolean {
  const minute = minuteOfDay(tick)
  return WORK_WINDOWS.some(([from, to]) => minute >= from && minute < to)
}

/** 睡觉时段：[23:00, 07:00)。 */
export function isNightMinute(tick: number): boolean {
  const minute = minuteOfDay(tick)
  return minute >= 23 * 60 || minute < 7 * 60
}

/** 这个人现在能不能被"自己"安排：站着、没拿单、没有活动、没有目标站点。 */
function available(agent: Agent): boolean {
  return (
    agent.state === 'idle' &&
    agent.carrying === null &&
    agent.activityUntil === undefined &&
    agent.station === null &&
    agent.targetStation === null &&
    agent.path.length === 0
  )
}

/**
 * 最近的一个"有空位 + 有其中任一能力"的站点；没有就 null。
 *
 * 用"能力集合"而不是单个能力：学习既能去 research 也能去 code，
 * 只认 research 会让所有人横穿办公室去 HR（实测单程 50 tick）。
 */
function freeStation(
  world: World,
  agent: Agent,
  capabilities: readonly Station['capabilities'][number][],
  prefer?: (station: Station) => boolean,
): Station | null {
  let best: Station | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const station of world.stations) {
    if (station.placeId !== agent.placeId) continue
    if (!station.capabilities.some((capability) => capabilities.includes(capability))) continue
    if (prefer !== undefined && !prefer(station)) continue
    if (occupancyOf(world, station.id) >= station.capacity) continue
    const d = distance(agent.position, station.anchor)
    if (d < bestDistance) {
      best = station
      bestDistance = d
    }
  }
  return best
}

/**
 * 由需求决定"下一步做什么"。
 *
 * 有 ready 工单时返回 null：调度器才是主导，自派会把空闲的人先占走。
 */
export function chooseLife(world: World, agent: Agent): LifeIntent | null {
  if (!available(agent)) return null
  if (world.tasks.some((task) => task.status === 'ready')) return null

  const needs = needsOf(agent)

  // 1) 饿了：去茶水间（breakroom）吃点东西。夜里也一样，饿是更硬的需求。
  if (needs.hunger < HUNGER_LOW) {
    const station = freeStation(world, agent, ['rest'], (candidate) => candidate.kind === 'breakroom')
    // 饿了却没有吃饭的地方：宁可站着等（交给待命行为），也不要转头去干活。
    return station === null
      ? null
      : { purpose: 'meal', stationId: station.id, ticks: MEAL_TICKS, reason: '饿了，去吃点东西' }
  }

  // 2) 夜里：睡觉。还没有"家"，先睡休息区（下一份计划再做 home）。
  if (isNightMinute(world.tick)) {
    const station = freeStation(world, agent, ['rest'])
    return station === null
      ? null
      : { purpose: 'sleep', stationId: station.id, ticks: SLEEP_TICKS, reason: '夜深了，去睡一觉' }
  }

  // 3) 累了：歇一会儿。
  if (needs.energy < ENERGY_LOW) {
    const station = freeStation(world, agent, ['rest'])
    return station === null
      ? null
      : { purpose: 'rest', stationId: station.id, ticks: NAP_TICKS, reason: '有点累，歇一会儿' }
  }

  // 4) 想说话：有人才去（H6 会把"找谁"接上）。
  if (needs.social < SOCIAL_LOW && world.agents.length > 1) {
    // 办公室的会议椅是一人一座：不要求"同一站能坐两人"，两人坐同屋不同椅也算聊天。
    const station = freeStation(world, agent, ['converse'])
    if (station !== null) {
      return { purpose: 'social', stationId: station.id, ticks: SOCIAL_TICKS, reason: '想找人聊两句' }
    }
  }

  // 5) 上班时段：干活。站点按角色能力找；找不到就交给待命行为。
  if (isWorkMinute(world.tick)) {
    const preferred = SKILL_OF_ROLE[agent.role] ?? 'code'
    // 先找本职工位；满员/太远就退到任意工位，别为了"职位标签"横穿全城。
    const station = freeStation(world, agent, [preferred]) ?? freeStation(world, agent, ['code', 'review', 'research', 'compute'])
    if (station === null) return null
    const skill = station.capabilities.includes(preferred) ? preferred : (station.capabilities.find((capability) => capability === 'code' || capability === 'review' || capability === 'research' || capability === 'compute') ?? 'code')
    return { purpose: 'work', stationId: station.id, skill, ticks: WORK_TICKS, reason: '到了上班的点，自己去干活' }
  }

  // 6) 其余时间：学点东西（research/code 里挑最近的，不为了"研究"两个字横穿全城）。
  const studyStation = freeStation(world, agent, ['research', 'code'])
  if (studyStation === null) return null
  const studySkill: 'research' | 'code' = studyStation.capabilities.includes('research') ? 'research' : 'code'
  return { purpose: 'study', stationId: studyStation.id, skill: studySkill, ticks: STUDY_TICKS, reason: '闲着，学点东西' }
}

export type SelfLifeCommand = Extract<WorldCommand, { kind: 'agentActivity' }>

/** 本 tick 由角色自己发起的活动命令。 */
export function selfLifeCommands(world: World): SelfLifeCommand[] {
  const commands: SelfLifeCommand[] = []
  for (const agent of world.agents) {
    const intent = chooseLife(world, agent)
    if (intent === null) continue
    commands.push({
      kind: 'agentActivity',
      agentId: agent.id,
      activity: intent.purpose === 'social' ? 'meet' : intent.purpose === 'work' || intent.purpose === 'study' ? 'work' : 'rest',
      ticks: intent.ticks,
      purpose: intent.purpose,
      ...(intent.skill === undefined ? {} : { skill: intent.skill }),
      ...(intent.stationId === null ? {} : { stationId: intent.stationId }),
      trigger: { kind: 'self', text: intent.reason },
    })
  }
  return commands
}
