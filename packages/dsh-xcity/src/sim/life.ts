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
import { createRng, seedFromString } from '../domain/rng.js'
import type { Agent, Episode, Station, World } from '../domain/types.js'
import type { IdleBehaviorPlan } from '../protocol/idle.js'
import type { WorldCommand } from '../protocol/wire/commands.js'
import { activityPurposeOf } from './activity-view.js'
import { idleSlotAt } from './idle-behavior.js'
import { needsOf } from './needs.js'
import { cellOf, isWalkable } from './pathfind.js'
import { affinityOf } from './relationships.js'
import { MISS_GRACE_TICKS } from './commitments.js'
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

/** 干活可以去的能力集合：本职工位满了就往这些地方退（按距离挑，不看职位标签）。 */
const WORK_CAPABILITIES: readonly Station['capabilities'][number][] = ['code', 'review', 'research', 'compute']

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

/**
 * R527：抢不到座位时"等一会儿"的时长（游戏分钟）。
 *
 * 走待命行为那套槽机（`idleSlotAt`）算窗口：每 tick 重抽时长会让同一个人
 * "等 30 → 等 41 → 等 57" 地抖，等待点也就跟着抖。槽的 `span` 在**一个窗口内恒定**、
 * 换窗才变，所以每个窗口只开头算一次。
 *
 * `WAIT_WINDOWS` **不是内容**：内容里的待命行为是"他在歇脚点做什么"，
 * 这里只借它的相位得到一段稳定的时长——只有一条、且不参与选行为。
 */
const WAIT_WINDOWS: readonly IdleBehaviorPlan[] = [
  { id: 'life.wait', kind: 'rest', weight: 1, ticksMin: 30, ticksMax: 60, radius: 0 },
]

/**
 * R515：记忆窗口（游戏分钟 = 一天）。只看最近一天里发生过的事——上周的成就感不该一直
 * 压着今天的选择。
 */
export const MEMORY_MOOD_WINDOW = 1440

/** R515：记忆加权的最大幅度（±10%）。再大就不是"微调"，会翻掉性格与需求的既有优先级。 */
export const MEMORY_MOOD_WEIGHT = 0.1

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
 * R523：赴约窗口——到期前多久开始往对方那边走（游戏分钟）。180 → 240。
 *
 * 180 只够"一个活动 + 一段路"的零头：干活/学习是 90 tick，跨办公室单程实测约 50，
 * 撞上一个长活动就只剩 40——人还在工位坐着，承诺先到期了（实测三天 kept 3 / missed 4）。
 * 240 留得下一整个标准活动、走过去、再站着等一会儿。
 * 不放到 480（一个睡觉块）的原因：那等于"答应完立刻往会议室跑"，整个下午坐在空房间里等，
 * 把该干的活挤没了——窗口是"提前动身"，不是"整天守着"。
 */
export const APPOINTMENT_WINDOW = 240

/**
 * R513：最该去赴的那个约。
 *
 * 取"有约定对象、状态 open、到期在 [now, now+APPOINTMENT_WINDOW]"里最早的一条。
 * 自己一个人的承诺（with === ''）不算——那种没有约可赴。
 */
export function dueAppointmentOf(
  world: World,
  agent: Agent,
): { with: string; what: string; dueTick: number } | null {
  const now = world.tick
  let best: { with: string; what: string; dueTick: number } | null = null
  for (const commitment of agent.commitments ?? []) {
    if (commitment.status !== 'open') continue
    if (commitment.with === '') continue
    // R523-4：**过了点也要去**。
    //
    // 现场：agent-1 对该去的约确实动了，社交发生在 117771，而宽限 117540 就结束了——
    // 它是迟到，不是没去。原来这里写「dueTick < now 就 continue」，于是过了点这条约定
    // 立刻退出优先队列，人又埋头干活，越拖越久，最后判成 missed。
    // 现在窗口是 [dueTick - APPOINTMENT_WINDOW, dueTick + MISS_GRACE_TICKS]：
    // 迟到的人仍在赴约，直到裁决落地为止（裁决那侧一行没改，判据不变）。
    if (commitment.dueTick + MISS_GRACE_TICKS < now) continue
    if (commitment.dueTick - now > APPOINTMENT_WINDOW) continue
    if (best === null || commitment.dueTick < best.dueTick) {
      best = { with: commitment.with, what: commitment.what, dueTick: commitment.dueTick }
    }
  }
  return best
}

/**
 * 最近的站点：同一场所、能力匹配、通过 `accept` 的那一个。
 *
 * `accept` 是**唯一**的筛选条件：`freeStation` 传"还有空位"，
 * `waitOption` 传"不挑"（他本来想去哪儿——满员的也算，见 R527）。
 */
function pickStation(
  world: World,
  agent: Agent,
  capabilities: readonly Station['capabilities'][number][],
  accept: (station: Station) => boolean = () => true,
  origin: { x: number; z: number } = agent.position,
): Station | null {
  let best: Station | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const station of world.stations) {
    if (station.placeId !== agent.placeId) continue
    if (!station.capabilities.some((capability) => capabilities.includes(capability))) continue
    if (!accept(station)) continue
    const d = distance(origin, station.anchor)
    if (d < bestDistance) {
      best = station
      bestDistance = d
    }
  }
  return best
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
  origin: { x: number; z: number } = agent.position,
): Station | null {
  return pickStation(
    world,
    agent,
    capabilities,
    (station) =>
      (prefer === undefined || prefer(station)) && occupancyOf(world, station.id) < station.capacity,
    origin,
  )
}

/**
 * R523：对方现在在哪个 district。
 *
 * district 是站点的属性，角色身上没有；所以只能从他"坐着 / 正要去"的那一站反推。
 * 两样都没有（站着发呆、在路上、在别的地点）→ null，调用方退到"同地点任意空位"。
 */
function districtOfPeer(world: World, peer: Agent): string | null {
  const stationId = peer.station ?? peer.targetStation
  if (stationId === null) return null
  return world.stations.find((station) => station.id === stationId)?.district ?? null
}

/**
 * R523：对方是不是真的在睡觉。
 *
 * 状态机分不清"累得躺一会儿"和"睡一觉"：吃饭/歇会儿/睡觉都走 rest → state === sleeping，
 * 只有 activityPurpose 分得清（见 types.ts 的 ActivityPurpose 注释）。
 * 用"用途 + 还没到点"两条一起判：活动到时但待命流程还没收尾的那一 tick 不算睡着。
 */
function isSleepingNow(world: World, peer: Agent): boolean {
  if (activityPurposeOf(world, peer) !== 'sleep') return false
  return peer.activityUntil !== undefined && peer.activityUntil > world.tick
}

/**
 * R523：赴约先坐哪儿——去对方那个房间等着。
 *
 * 旧版只有"对方已经在 converse 站点上聊着"才算有路可走，于是对方在工位上干活时赴约的人
 * 干脆不出门：实测三天 kept 3 / missed 4（43%）。只要**同一地点**，先到房间是赴约方
 * 唯一能自己控制的事（对方也在赴同一个约，会来）。
 * 对方所在 district 没有空位就退到同地点任意 converse 空位——白站在走廊上比坐在别人屋里更糟。
 */
function appointmentSeatId(world: World, agent: Agent, peer: Agent): string | null {
  // 跨地点没有自派路径：freeStation 只在当前 place 里找站点，所以这里直接放弃。
  if (peer.placeId !== agent.placeId) return null
  const district = districtOfPeer(world, peer)
  const seat = district === null
    ? null
    : freeStation(world, agent, ['converse'], (candidate) => candidate.district === district)
  return (seat ?? freeStation(world, agent, ['converse']))?.id ?? null
}

/**
 * R482：社交去哪。
 *
 * 0. R523：赴约优先——约定的人在同一地点，就先去他的房间等着（不等他"正好在聊"）；
 * 1. 已经在聊的人所在房间还有空位 → 加入；
 * 2. 否则找最熟的空闲角色，挑离 TA 最近的 converse 座位（两个人都这么做，才会坐到一起）。
 * 没有第二个人 → null（留给 H4 主动发短信）。
 */
function socialStationId(world: World, agent: Agent, preferPeer: string | null = null): string | null {
  if (preferPeer !== null) {
    const peer = world.agents.find((other) => other.id === preferPeer)
    const seat = peer === undefined ? null : appointmentSeatId(world, agent, peer)
    if (seat !== null) return seat
    // R523-2：没有空的**会话椅**不代表去不了。
    //
    // 证据判的是"同一地点、时间重叠"，不是"同一张会议椅"（sim/commitments.ts 的 metInWindow
    // 与 Episode.with 都是地点级）。而会话椅只有 10 张、24 个人抢——实测 3 条爽约全是
    // "同地点却没有社交重叠"。所以退一步：坐同地点的**任意**空位（先同 district），
    // 到了那个房间，对方一空下来就能接上。座位稀缺时这比"根本不去"更接近真实。
    if (peer !== undefined) {
      const districtOf = (row: typeof peer): string | null => {
        const id = row.station ?? row.targetStation
        return id === null ? null : world.stations.find((item) => item.id === id)?.district ?? null
      }
      const district = districtOf(peer)
      const near = district === null ? null : freeStation(world, agent, ['converse', 'code', 'review', 'research', 'compute', 'rest'], (candidate) => candidate.district === district)
      if (near !== null) return near.id
    }
  }

  let join: { stationId: string; affinity: number } | null = null
  for (const other of world.agents) {
    if (other.id === agent.id) continue
    const stationId = other.targetStation ?? (other.state === 'talking' ? other.station : null)
    if (stationId === null) continue
    const station = world.stations.find((item) => item.id === stationId)
    if (station === undefined || !station.capabilities.includes('converse')) continue
    // 找同房间的另一个空位（会议椅是一人一座）。
    const seat = freeStation(world, agent, ['converse'], (candidate) => candidate.district === station.district)
    if (seat === null) continue
    const affinity = affinityOf(agent, other.id)
    if (join === null || affinity > join.affinity) join = { stationId: seat.id, affinity }
  }
  if (join !== null) return join.stationId

  const others = world.agents
    .filter((other) => other.id !== agent.id && other.state === 'idle' && other.targetStation === null && other.station === null)
    .sort((a, b) => affinityOf(agent, b.id) - affinityOf(agent, a.id))
  const target = others[0]
  // R498：没人闲着也可以先坐下——第二个想聊天的人会从"加入"那条路过来。
  // 没有这一条，三人永远在忙，社交在结构上就不可能发生（实测三天 0 次）。
  if (target === undefined) return freeStation(world, agent, ['converse'])?.id ?? null
  // 两人都用"中点"选房间：A 和 B 算出同一个中点、落到同一个 district，
  // 才不会一个去东屋一个去西屋（之前 25 次 meet 只有 10 对关系就是这么来的）。
  const midpoint = {
    x: (agent.position.x + target.position.x) / 2,
    z: (agent.position.z + target.position.z) / 2,
  }
  const near = freeStation(world, agent, ['converse'], undefined, midpoint)
  if (near === null) return null
  const seat = freeStation(world, agent, ['converse'], (candidate) => candidate.district === near.district)
  return (seat ?? near).id
}

/**
 * R527：等待点——目的地（当前场所）的出生点 + 由 `agent.id` 定死的一个小偏移。
 *
 * 为什么不是"站点上的空位"：座位满的时候压根没有空位，而"在目的地附近排队"只需要
 * 一个站得住人的位置。偏移由 id 定死（不是每 tick 抽），所以同一段等待里位置不抖；
 * 方向按 6 等分试，第一个走得通的为准，都走不通返回 null（调用方退回原歇脚点）。
 */
function waitSpot(world: World, agent: Agent): { x: number; z: number } | null {
  const place = (world.places ?? []).find((row) => row.id === agent.placeId)
  if (place === undefined) return null
  const rng = createRng(seedFromString(`${agent.id}@wait`))
  const start = rng.next() * Math.PI * 2
  // 2~6：够把同时等待的人散开，又稳稳落在"目的地附近"（< 8）。
  const radius = 2 + rng.next() * 4
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const angle = start + (attempt * Math.PI) / 3
    const point = {
      x: place.spawn.x + Math.cos(angle) * radius,
      z: place.spawn.z + Math.sin(angle) * radius,
    }
    if (world.nav === null || isWalkable(world.nav, cellOf(world.nav, point))) return point
  }
  return null
}

/**
 * R498：候选意图 + 分数。
 *
 * B1（本次）只把结构抽出来：`chooseLife` 仍取**第一个**候选，行为与旧阶梯完全一致；
 * B2 再把“取第一个”换成“取分数最高”，用 golden 测试钉住差异。
 *
 * `intent: null` 表示**这一档卡住了**（饿了却没座位），不能落到下一档——
 * 旧实现是提前 return null，这里用候选语义表达同一件事。
 */
export interface IntentOption {
  intent: LifeIntent | null
  /** 0-1：B2 用；B1 忽略。 */
  score: number
}

/**
 * R527：想去的地方一个空位都没有 → 给一条"等着"的意图。
 *
 * 为什么复用 `rest` 而不新增 purpose：等待不是一种生活，它只是抢不到座位时的空档，
 * 而 `rest` 的语义本来就是"原地待着"。`stationId: null` 是这条分支的记号——
 * 吃饭/睡觉/休息一定带着站点，`selfLifeCommands` 据此把 hangout 临时指向等待点。
 *
 * @param capabilities - 他本来想去的那类地方；一个都没有 = 没目标，不发等待意图。
 */
function waitOption(
  world: World,
  agent: Agent,
  capabilities: readonly Station['capabilities'][number][],
): IntentOption {
  const target = pickStation(world, agent, capabilities)
  if (target === null) return { score: 0.55, intent: null }
  const slot = idleSlotAt(WAIT_WINDOWS, world.seed, agent.id, world.tick)
  return {
    score: 0.55,
    intent: {
      purpose: 'rest',
      stationId: null,
      ticks: slot?.span ?? 30,
      reason: '想去' + target.name + '，一个空位都没有，先在这儿等着',
    },
  }
}

export function intentOptions(world: World, agent: Agent): IntentOption[] {
  if (!available(agent)) return []
  if (world.tasks.some((task) => task.status === 'ready')) return []

  const needs = needsOf(agent)

  // 1) 饿了：去茶水间（breakroom）吃点东西。夜里也一样，饿是更硬的需求。
  if (needs.hunger < HUNGER_LOW) {
    const station = freeStation(world, agent, ['rest'], (candidate) => candidate.kind === 'breakroom')
    // 饿了却没有吃饭的地方：宁可站着等（交给待命行为），也不要转头去干活。
    return [{ score: 1, intent: station === null
      ? null
      : { purpose: 'meal', stationId: station.id, ticks: MEAL_TICKS, reason: '饿了，去吃点东西' } }]
  }

  // 2) 夜里：睡觉。还没有“家”，先睡休息区（下一份计划再做 home）。
  if (isNightMinute(world.tick)) {
    const station = freeStation(world, agent, ['rest'])
    // R527-2：夜里**没有床位**是最常见的一档（24 人 / 10 张休息位，实测一天 5764 次）。
    // 和干活一样，没床位就去休息区附近排着队——不是站在别处发呆。
    if (station === null) return [waitOption(world, agent, ['rest'])]
    return [{ score: 0.95, intent: { purpose: 'sleep', stationId: station.id, ticks: SLEEP_TICKS, reason: '夜深了，去睡一觉' } }]
  }

  // 3) 累了：歇一会儿。
  if (needs.energy < ENERGY_LOW) {
    const station = freeStation(world, agent, ['rest'])
    return [{ score: 0.8, intent: station === null
      ? null
      : { purpose: 'rest', stationId: station.id, ticks: NAP_TICKS, reason: '有点累，歇一会儿' } }]
  }

  const options: IntentOption[] = []

  // 3.5) 赴约：答应过别人的事，快到点了就真的去。
  //
  // 为什么必须单独一条：实测 22 条 missed 里 **0 条有交集**——不是裁决误判，
  // 而是承诺从来没影响过行为：人许完愿照常去上班/学习，然后被判失约。
  const appointment = dueAppointmentOf(world, agent)
  if (appointment !== null) {
    const peer = world.agents.find((row) => row.id === appointment.with)
    // R523：对方在睡觉就不追。夜里闯进休息区坐着等，既等不到人，还白占一张椅子；
    // 这事必须在这里判——socialStationId 只回答"坐哪儿"，回答不了"该不该去"。
    const stationId = peer === undefined || isSleepingNow(world, peer)
      ? null
      : socialStationId(world, agent, peer.id)
    if (stationId !== null) {
      options.push({
        score: 0.9,
        intent: {
          purpose: 'social',
          stationId,
          ticks: SOCIAL_TICKS,
          reason: '快到点了，去找' + (peer?.name ?? appointment.with) + '把答应的「' + appointment.what + '」办了',
        },
      })
    }
  }

  // 4) 想说话：有人才去。先加入已经在聊的人，否则找最熟的人、去他附近。
  if (needs.social < SOCIAL_LOW && world.agents.length > 1) {
    const stationId = socialStationId(world, agent)
    if (stationId !== null) {
      options.push({ score: 0.7, intent: { purpose: 'social', stationId, ticks: SOCIAL_TICKS, reason: '想找人聊两句' } })
    }
  }

  // 5) 上班时段：干活。站点按角色能力找；一个空位都没有就去目的地附近等着（R527）。
  if (isWorkMinute(world.tick)) {
    const preferred = SKILL_OF_ROLE[agent.role] ?? 'code'
    // 先找本职工位；满员/太远就退到任意工位，别为了“职位标签”横穿全城。
    const station = freeStation(world, agent, [preferred]) ?? freeStation(world, agent, WORK_CAPABILITIES)
    if (station === null) return [...options, waitOption(world, agent, WORK_CAPABILITIES)]
    const skill = station.capabilities.includes(preferred) ? preferred : (station.capabilities.find((capability) => capability === 'code' || capability === 'review' || capability === 'research' || capability === 'compute') ?? 'code')
    return [...options, { score: 0.65, intent: { purpose: 'work', stationId: station.id, skill, ticks: WORK_TICKS, reason: '到了上班的点，自己去干活' } }]
  }

  // 6) 其余时间：学点东西（research/code 里挑最近的，不为了“研究”两个字横穿全城）。
  const studyStation = freeStation(world, agent, ['research', 'code'])
  if (studyStation === null) return [...options, waitOption(world, agent, ['research', 'code'])]
  const studySkill: 'research' | 'code' = studyStation.capabilities.includes('research') ? 'research' : 'code'
  return [...options, { score: 0.5, intent: { purpose: 'study', stationId: studyStation.id, skill: studySkill, ticks: STUDY_TICKS, reason: '闲着，学点东西' } }]
}

/** 性格缺省：老档没有 traits 时按中庸处理，不改变老档行为太多。 */
function traitOf(agent: Agent, key: 'diligence' | 'duty'): number {
  const value = agent.traits?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
}

/**
 * R515/R521：一条记忆是好事、坏事还是闲事。只看已有字段（kind/summary），不新增 polarity 字段。
 *
 * - `没做完：` 开头 = 负向：`sim/memory.ts` 的 summarizeActivity 对 interrupted 活动只加这个
 *   前缀（`没做完：干活` / `没做完：工单「X」`）；承诺被判 missed 时也用它。
 * - `工单` 开头 = 正向：同一函数对带工单触发的活动写 `工单「X」`，即真的把一张单办成了。
 * - `守约：` 开头 = 正向：R521 起 `sim/commitments.ts` 裁决成 kept 时给双方各写一条
 *   （`守约：答应b的「一起吃饭」兑现了`），于是"兑现了承诺"真的抬高心情。
 * - 其余（吃饭/睡觉/干活/学习/聊天/日小结）中性：日常琐事不构成心情。这一点是刻意的——
 *   若把它们也算正向，golden 世界跑一天就有 30+ 条完成记忆，心情恒为 +1，加权退化成常数偏置，
 *   那就不是"记忆影响决策"，而是"永远 +10%"。
 *
 * 曾经的盲区（R521 已补）：承诺以前只改 Commitment.status、不写情节记忆，所以守约/爽约读不到；
 * 现在两条裁决都会产出上面两种前缀的记忆，这里不需要为新概念增加分支。
 */
function moodPolarityOf(episode: Episode): -1 | 0 | 1 {
  if (episode.summary.startsWith('没做完：')) return -1
  if (episode.summary.startsWith('守约：')) return 1
  if (episode.summary.startsWith('工单')) return 1
  return 0
}

/**
 * R515：最近的记忆 → 心情 [-1, 1]。没有可计分的记忆返回 0（= 零影响，老行为不变）。
 *
 * 分量：mood = clamp(Σ ±salience)，每条 salience 本来就在 [0,1]，所以正负相抵、到顶封边。
 * 不做平均：按平均的话，一条 0.2 的小失误（"没做完：吃了顿饭"）就等于"一天全毁"；
 * 按求和，小事就只是小事，几件重要的坏事才压得住。
 * 纯函数：只读 episodes 与 nowTick，不看世界其他状态，无随机——同输入必须同结果。
 */
export function memoryMood(agent: Agent, nowTick: number): number {
  const from = nowTick - MEMORY_MOOD_WINDOW
  let mood = 0
  for (const episode of agent.episodes ?? []) {
    if (episode.tick < from || episode.tick > nowTick) continue
    const sign = moodPolarityOf(episode)
    if (sign === 0) continue
    // salience 是 0-1 的"有多值得记住"；老档万一缺这个字段，按 0 处理——别让 NaN 流进决策。
    const weight = Number.isFinite(episode.salience) ? Math.min(1, Math.max(0, episode.salience)) : 0
    mood += sign * weight
  }
  return Math.min(1, Math.max(-1, mood))
}

/**
 * R515：把心情折成"社交 vs 工作/学习"的乘数，幅度 ≤ MEMORY_MOOD_WEIGHT（±10%）。
 *
 * 方向：最近净是办成的事 → 坐得住干活、少掺和闲聊；净是没做完 → 想找人说话缓缓、少啃硬活。
 * 吃饭/睡觉/休息恒为 1：它们由需求驱动，不该被心情动摇（intentOptions 里本来也提前 return）。
 */
export function memoryWeightOf(purpose: LifePurpose, mood: number): number {
  const tilt = MEMORY_MOOD_WEIGHT * Math.min(1, Math.max(-1, mood))
  if (purpose === 'work' || purpose === 'study') return 1 + tilt
  if (purpose === 'social') return 1 - tilt
  return 1
}

/**
 * R498-B2：把候选按性格加权后取最高分。
 *
 * 为什么不是纯权重：纯权重是弱机制——需求贴阈值时要做大 3 倍以上才翻得动。
 * 所以可见差异还要靠 L2 硬规则与承诺（H3/H7）；这里只先让"同样有空"的人分出偏好。
 */
function weightedScore(option: IntentOption, agent: Agent, mood: number): number {
  const purpose = option.intent?.purpose
  if (purpose === undefined) return option.score
  // R515：记忆只做小幅乘数，叠在性格权重之上；meal/sleep/rest 的乘数恒为 1。
  const remembered = memoryWeightOf(purpose, mood)
  if (purpose === 'work' || purpose === 'study') {
    // 干劲 0→×0.8，1→×1.2。
    return option.score * (0.8 + 0.4 * traitOf(agent, 'diligence')) * remembered
  }
  if (purpose === 'social') {
    // 越有干劲越不急着闲聊，但幅度要小：社交本身有需求驱动。
    return option.score * (1.1 - 0.2 * traitOf(agent, 'diligence')) * remembered
  }
  return option.score * remembered
}

export function chooseLife(world: World, agent: Agent): LifeIntent | null {
  const options = intentOptions(world, agent).filter((option) => option.intent !== null)
  if (options.length === 0) return null
  // R515：心情一个 tick 只算一次——同一批候选看到的是同一份记忆。
  const mood = memoryMood(agent, world.tick)
  let best = options[0]!
  let bestScore = weightedScore(best, agent, mood)
  for (const option of options.slice(1)) {
    const score = weightedScore(option, agent, mood)
    // 同分保持旧顺序，保证确定性。
    if (score > bestScore) {
      best = option
      bestScore = score
    }
  }
  return best.intent
}

export type SelfLifeCommand = Extract<WorldCommand, { kind: 'agentActivity' }>

/** 本 tick 由角色自己发起的活动命令。 */
export function selfLifeCommands(world: World): SelfLifeCommand[] {
  const commands: SelfLifeCommand[] = []
  for (const agent of world.agents) {
    const intent = chooseLife(world, agent)
    if (intent === null) continue
    // R527：抢不到座位的人去"目的地附近"排队，而不是站在原歇脚点发呆。
    //
    // 判据是"rest 但没有站点"：吃饭/睡觉/休息都一定带站点，只有 waitOption 会这样产生。
    // 改的是 hangout（待命流程的锚点，见 sim/idle.ts），不是 position——位置由 idle 推进
    // 一 tick 走一步挪过去，不瞬移。hangout 本身是派生量（world/reconcile.ts 会按站点重算），
    // 所以这里不用为"临时"另存一份原值：座位一旦空出来，他接了别的活动就会离开。
    if (intent.purpose === 'rest' && intent.stationId === null) {
      const spot = waitSpot(world, agent)
      if (spot !== null) agent.hangout = spot
    }
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
