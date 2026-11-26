/**
 * world 内核 → Slow Vale 快照/场景 的投影。
 *
 * ## 这一层为什么必须存在
 *
 * 我们内核对"世界"的定义（tick / station / task / path）和前端的定义
 * （cursor / place / presence / actors / visual_timeline）毫无关系。
 * 把两者搅在一起，任何一边改字段都会连累另一边；所以投影单独成一层，
 * 输入是只读世界，输出是纯数据，**没有任何 IO**，可以直接单测。
 *
 * ## 字段为什么长这样
 *
 * 全部来自 GameView.js 里 an() 校验器与 applyPayload() 的读取代码（见
 * slowvale-mirror/docs/MOCK-BACKEND.md 的"世界快照契约"）。几条容易踩的：
 * - protocol_version 必须等于 76；
 * - cursor.epoch 必须是**字符串**，seq 是非负整数；
 * - role_presences 读的是 location.place_id，不是 scene；
 * - clock 必须带 day_number 与 current_datetime（前端拿它推日期）。
 */
import type { WorldAgentLike, WorldLike } from './types.js'
import { logHeadOf, logNoticesOf } from './logs.js'
import { DEFAULT_CIRCUIT } from './stage.js'
import { sceneKeyOf } from './scene-key.js'
import { MINUTES_PER_DAY, SLOWVALE_PROTOCOL_VERSION, TICKS_PER_GAME_MINUTE } from './types.js'

/** 投影参数（世界 id / 玩家角色 / 默认地点 / 起始日历）。 */
export interface ProjectOptions {
  worldId: string
  viewerRoleId: string
  place: string
  /** 世界第 0 tick 对应的游戏日期（YYYY-MM-DD）。 */
  startDate: string
  /** 只暴露一个地点（调试用：排除多场景互相干扰）。 */
  singlePlace?: boolean
  /** 桥提供的实时水位；独立投影没有连接时使用世界 tick。 */
  realtimeSeq?: number | undefined
  /** 短信信号：最后一条消息行号与未读数（前端靠它们判断要不要重拉线程）。 */
  phone?: { rowId: number; unread: number } | undefined
}

/** 同名同种子的世界可能共用 id；创建时刻在存档内，重开才切换日志 epoch。 */
export function epochOf(world: Pick<WorldLike, 'id' | 'createdAt'>): string {
  return 'epoch-' + world.id + (world.createdAt === undefined ? '' : '-' + world.createdAt) + '-feed3'
}

/** 由 tick 推游戏时间。一天 = MINUTES_PER_DAY 个 tick。 */
export function clockOf(world: WorldLike, startDate: string): {
  paused: boolean
  day_number: number
  day_of_week: number
  modern_time: string
  game_time: Record<string, unknown>
  current_datetime: string
  minute: number
} {
  const minutes = Math.floor(world.tick * TICKS_PER_GAME_MINUTE)
  const dayIndex = Math.floor(minutes / MINUTES_PER_DAY)
  const minuteOfDay = minutes % MINUTES_PER_DAY
  const base = new Date(startDate + 'T00:00:00Z')
  const date = new Date(base.getTime() + dayIndex * 86400000)
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0')
  const mi = String(minuteOfDay % 60).padStart(2, '0')
  const current_datetime = yyyy + '-' + mm + '-' + dd + 'T' + hh + ':' + mi + ':00'
  return {
    paused: world.paused === true,
    day_number: dayIndex + 1,
    day_of_week: (dayIndex + 4) % 7,
    // 前端读的是 clock.game_time.*（HUD 的 gameTime 是它的投影）
    game_time: {
      day_number: dayIndex + 1,
      day_of_week: (dayIndex + 4) % 7,
      modern_time: hh + ':' + mi,
      minute_of_day: minuteOfDay,
      current_datetime,
    },
    modern_time: hh + ':' + mi,
    current_datetime,
    minute: minuteOfDay,
  }
}

/** 朝向角（弧度）→ 像素精灵的四向。 */
function facingOf(radians: number | undefined): string {
  if (typeof radians !== 'number' || !Number.isFinite(radians)) return 'down'
  const x = Math.cos(radians)
  const y = Math.sin(radians)
  if (Math.abs(x) > Math.abs(y)) return x >= 0 ? 'right' : 'left'
  return y >= 0 ? 'down' : 'up'
}

/** 角色在城里的落点。没有 station 的人先放在默认地点。 */
/** 活动类型映射：领域语义 -> 前端徽章查表能命中的类型名。
 *
 * 前端只认它自己那 61 个活动类名（ProgrammerActivity 之类），查不到会记一条
 * badge.activity_type 警告然后什么都不画。所以这是白名单，不是自由字符串。
 */
function activityTypeOf(kind: string, skill?: string | null, purpose?: string | null): string {
  // R478：吃饭/睡觉都复用 rest 活动，用 purpose 决定徽章，别把吃饭画成 RestActivity。
  if (purpose === 'meal') return 'EatActivity'
  if (purpose === 'sleep') return 'SleepActivity'
  // R481：学习可能发生在 code 工位（skill=code）；用 purpose 保证徽章仍是“学习”。
  if (purpose === 'study') return 'SkillStudyActivity'
  if (kind === 'sleep') return 'SleepActivity'
  if (kind === 'rest') return 'RestActivity'
  if (kind === 'meet') return 'SpeakActivity'
  if (kind === 'visit') return 'WaitActivity'
  if (skill === 'research') return 'SkillStudyActivity'
  return 'ProgrammerActivity'
}

/** 角色头顶的「正在做什么」；没有活动就不给字段（前端据此决定画不画徽章）。 */
/** tick -> 游戏时间（ISO）。1 tick = 1 游戏分钟，与 clockOf 同一套换算。 */
function gameTimeAt(startDate: string, tick: number): string {
  const minutes = Math.floor(tick)
  const dayIndex = Math.floor(minutes / 1440)
  const minuteOfDay = minutes % 1440
  const date = new Date(new Date(startDate + 'T00:00:00Z').getTime() + dayIndex * 86400000)
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0')
  const mi = String(minuteOfDay % 60).padStart(2, '0')
  return yyyy + '-' + mm + '-' + dd + 'T' + hh + ':' + mi + ':00'
}

/**
 * 角色头顶的「正在做什么」。
 *
 * 进度是**前端自己算的**（bundle 里的 ev()）：
 *   progress = clamp((progress_elapsed_seconds + (now - anchor)/1000) / duration_seconds)
 * 所以这里只要把三个锚点字段给对，进度条就会自己动——不需要额外的推送。
 */
function activeActivityOf(world: WorldLike, agent: WorldAgentLike, startDate: string): Record<string, unknown> | undefined {
  const activities = world.activities
  if (activities === undefined) return undefined
  const id = (agent as { activityId?: string }).activityId
  const live = activities.find((item) => item.id === id && item.status === 'active')
  if (live === undefined) return undefined
  const label = activityLabelOf(live.kind, agent.activityPurpose)
  const activity = {
    activity_type: activityTypeOf(live.kind, live.skill, agent.activityPurpose),
    name: label,
    description: live.taskAttemptId === undefined ? label : live.trigger?.text ?? label,
  }
  if (live.taskAttemptId !== undefined) return activity
  // 1 tick = 1 游戏分钟 = 60 游戏秒。
  const durationSeconds = Math.max(1, (live.endsAt - live.startedAt) * 60)
  return {
    ...activity,
    duration_seconds: durationSeconds,
    progress_elapsed_seconds: 0,
    progress_anchor_game_time: gameTimeAt(startDate, live.startedAt),
  }
}

export function publicStatusOf(world: WorldLike, agent: WorldAgentLike, startDate: string): Record<string, unknown> {
  const activity = activeActivityOf(world, agent, startDate)
  return activity === undefined ? { status: 'offline' } : { status: 'online', active_activity: activity }
}

/** 活动的中文标签（前端的忙碌文案会用它）。 */
function activityLabelOf(kind: string, purpose?: string | null): string {
  if (purpose === 'meal') return '吃饭'
  if (purpose === 'sleep') return '睡觉'
  if (purpose === 'study') return '学习'
  if (purpose === 'social') return '聊天'
  if (kind === 'work') return '干活'
  if (kind === 'rest') return '休息'
  if (kind === 'meet') return '交谈'
  if (kind === 'visit') return '待着'
  if (kind === 'sleep') return '睡觉'
  return '忙'
}
/** 场所 id -> 前端场景资源键（presence.scene 必须是资源键，不是 place id）。 */
function assetOfPlace(world: WorldLike, placeId: string): string {
  const place = world.places?.find((candidate) => candidate.id === placeId)
  return place === undefined ? sceneKeyOf(placeId) : place.asset
}

function presenceOf(agent: WorldAgentLike, place: string, asset: string = sceneKeyOf(place)): Record<string, unknown> {
  const position = agent.position ?? {}
  // 场所是角色自己的属性：之前拿工位 id 冒充，导致所有人在同一个"地点"里。
  const placeId = agent.placeId ?? place
  // HUD 的同场景列表直接读 presence 上的 name/gender/appearance/titles，
  // 少任何一个都会在渲染时抛（"reading 'map'" 就是 titles 缺失）。
  return {
    role_id: agent.id,
    name: agent.name,
    gender: 'male',
    appearance: DEFAULT_APPEARANCE,
    titles: [],
    scene: asset,
    location: {
      place_id: placeId,
      x: typeof position.x === 'number' ? position.x : 0,
      y: typeof position.z === 'number' ? position.z : 0,
      facing: facingOf(agent.facing),
    },
    visual_state: {},
  }
}

/**
 * 地点拓扑。
 *
 * 前端拿 place_id 去场景规则表里查资源；查不到会走兜底（画占位房间）并报
 * "place.name 未登记"。所以这里必须用规则表命中得了的 id，并且给出人看的名字。
 */
export function placesOf(place: string, single = false): Record<string, Record<string, unknown>> {
  const places: Record<string, Record<string, unknown>> = {
    home_public: { place_id: 'home_public', scene: 'home_public', name: '家', place_type: 'compound', parent_id: null },
    world_map: { place_id: 'world_map', scene: 'world_map', name: '城市地图', place_type: 'compound', parent_id: null },
  }
  // place_type 是前端硬校验的（未登记的类型会直接抛错），
  // 合法值：self / venue / building / courtyard / unit / bedroom / compound。
  const kinds: Record<string, string> = {
    'place:office.tech_company_1': 'building',
    'place:residential.apartment_1': 'unit',
    'place:residential.mini_market': 'venue',
    'place:commercial.city_restaurant': 'venue',
    'place:downtown.city_gym': 'venue',
    'place:outdoor.sunset_beach': 'venue',
  }
  for (const spec of DEFAULT_CIRCUIT) {
    places[spec.id] = {
      place_id: spec.id,
      // 拓扑里的 scene 是**场景资源键**（前端用它找地图），不是 place id
      scene: sceneKeyOf(spec.id),
      name: spec.label,
      asset: spec.asset,
      place_type: kinds[spec.id] ?? 'venue',
      parent_id: null,
    }
  }
  if (single) {
    return {
      [place]: places[place] ?? { place_id: place, scene: sceneKeyOf(place), name: place, place_type: 'venue', parent_id: null },
    }
  }
  if (places[place] === undefined) {
    places[place] = { place_id: place, scene: place, name: place, place_type: 'venue', parent_id: null }
  }
  return places
}

/** 默认外观：前端要求八件套齐全，缺一个就画不出人。 */
export const DEFAULT_APPEARANCE = {
  skin: 1,
  eyes: 1,
  outfit_style: 1,
  outfit_variant: 1,
  hair_style: 1,
  hair_variant: 1,
  accessory_style: null,
  accessory_variant: null,
}

/**
 * 场景里要摆的 actor。
 *
 * 前端把 actors 当成 actor_id -> actor 的字典，并且**要求键与 actor_id 一致**
 * （GameView 的 At() 会直接抛错）。角色（role）的 actor 还必须带 appearance，
 * 否则合成不出精灵——那是"人不见了但一切都 200"的典型症状。
 */
function actorsOf(world: WorldLike, place: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const agent of world.agents) {
    const position = agent.position ?? {}
    // 场所是角色自己的属性；坐标是相对该场所的。
    const placeId = agent.placeId ?? place
    out[agent.id] = {
      actor_id: agent.id,
      role_id: agent.id,
      actorKind: 'role',
      name: agent.name,
      display_name: agent.name,
      appearance: DEFAULT_APPEARANCE,
      place_id: placeId,
      location: { place_id: placeId, x: typeof position.x === 'number' ? position.x : 0, y: typeof position.z === 'number' ? position.z : 0 },
      // anim 取自内核状态：之前恒为 'idle'，所以就算人在走、在干活，画面上也永远站着不动。
      visual_state: { anim: animOf(agent), facing: facingOf(agent.facing) },
    }
  }
  return out
}

export function feedHeadOf(world: WorldLike): number {
  return logHeadOf(world.activities ?? [], logNoticesOf(world.events ?? []), world.logSeq)
}

/** 内核状态 -> 前端动作名（动作表见 docs/DRIVE-MODEL.md）。 */
/**
 * 内核状态 -> 前端动作名（动作表见 docs/DRIVE-MODEL.md）。
 *
 * 注意：干活时内核的 state 仍是 idle（活动由 activityKind + activityUntil 维持），
 * 所以只看 state 会永远显示“站着”。这里把 activityKind 也读进来。
 */
function animOf(agent: { state?: string; activityKind?: string | null; activityPurpose?: string | null }): string {
  if (agent.state === 'walking') return 'walk'
  // R478：吃饭播 eat、睡觉播 sleep、小憩坐着（sit）；没有用途的老活动仍按状态兜底。
  if (agent.activityPurpose === 'meal') return 'eat'
  if (agent.activityPurpose === 'sleep') return 'sleep'
  if (agent.activityPurpose === 'rest') return 'sit'
  if (agent.state === 'sleeping') return 'sleep'
  if (agent.activityKind === 'work') return 'work'
  if (agent.activityKind === 'meet') return 'sit'
  return 'idle'
}

/** 原版 role_phone replace 与整份快照共用相同形状。 */
export function projectPhone(signal: ProjectOptions['phone']) {
  return { sms: { player_thread_message_row_id: signal?.rowId || null, player_thread_unread_count: signal?.unread ?? 0, latest_message_row_id: signal?.rowId || null, total_unread_count: signal?.unread ?? 0 }, wallet: { balance: 128000, currency: 'CNY' }, money: 128000, bank: { balance: 128000, money: 128000, credit_limit: 50000, total_credit: 50000, available_credit: 50000, used_credit: 0, active_loans: [], loans: [], cards: [], entries: [], transactions: [], monthly_due: 0, due_day: 1 } }
}

/** 世界快照（/game/state/world 与 SSE connected 用同一份）。 */
export function projectSnapshot(world: WorldLike, opts: ProjectOptions): Record<string, unknown> {
  // 世界快照永远用配置里的默认场景；请求级的场景切换由 projectScene 处理
  const clock = clockOf(world, opts.startDate)
  const presence: Record<string, unknown> = {}
  const statuses: Record<string, unknown> = {}
  for (const agent of world.agents) {
    const agentPlace = agent.placeId ?? opts.place
    presence[agent.id] = presenceOf(agent, agentPlace, assetOfPlace(world, agentPlace))
    statuses[agent.id] = publicStatusOf(world, agent, opts.startDate)
  }
  const viewerAgent = world.agents.find((a) => a.id === opts.viewerRoleId) ?? world.agents[0]
  // 场景必须跟着 viewer 的实际位置走：前端靠 committedScene 的**变化**去启动/切换场景，
  // 一直给同一个场景就等于永远不触发切换，Phaser 连贴图都不会请求。
  const viewerStation = viewerAgent === undefined || viewerAgent === null ? opts.place : viewerAgent.station
  const livePlace = typeof viewerStation === 'string' ? viewerStation : opts.place
  const scene = sceneKeyOf(livePlace)
  const viewerId = viewerAgent?.id ?? opts.viewerRoleId
  const viewerName = viewerAgent?.name ?? '访客'
  // presence.scene 必须与 snapshot.scene 同一套 id（场景资源键），
  // 否则前端认为「这个场景里没这个人」，场景就不会启动。
  for (const entry of Object.values(presence)) {
    (entry as { scene?: string }).scene = scene
  }
  return {
    // gameState.role：HUD 的几乎所有组件都从这里取名字与外观
    // （缺了就是 "Cannot read properties of undefined (reading 'name')"，且整块 HUD 挂不出来）
    role: {
      role_id: viewerId,
      basic_info: {
        role_id: viewerId,
        name: viewerName,
        gender: 'male',
        appearance: DEFAULT_APPEARANCE,
        personality_reset_available: false,
      },
      attributes: { sources: [], totals: {}, rows: [] },
      attribute_effects: { sources: [], totals: {}, rows: [] },
      player_declutter: null,
      money: 128000,
      wallet: { balance: 128000, currency: 'CNY' },
    },
    scene,
    world_id: opts.worldId,
    protocol_version: SLOWVALE_PROTOCOL_VERSION,
    cursor: { epoch: epochOf(world), seq: opts.realtimeSeq ?? world.tick },
    viewer_role_id: viewerAgent?.id ?? opts.viewerRoleId,
    // 快照与 /game/logs/recent 必须报同一个 head：前端靠它对齐日志游标，不一致会被当成整体重同步。
    feed_head_record_entry_id: feedHeadOf(world),
    role_public_statuses: statuses,
role_presences: presence,
    place_topology: { places: placesOf(scene, opts.singlePlace === true) },
    place_counts: { place_counts: {} },
    viewer: {
      core: {
        role_id: viewerAgent?.id ?? opts.viewerRoleId,
        name: viewerAgent?.name ?? '访客',
        // HUD 的 role 是 viewer.core 经 Mb() 包装出来的，所以 basic_info 必须在这儿，
        // 放在快照根上的 role 只是备胎。
        basic_info: {
          role_id: viewerAgent?.id ?? opts.viewerRoleId,
          name: viewerAgent?.name ?? '访客',
          gender: 'male',
          appearance: DEFAULT_APPEARANCE,
          personality_reset_available: false,
        },
        // HUD 的 role 是 core 经 Mb() 展开的：role.money 与 role.attribute_effects
        // 分别来自 core.money 与 viewer.attributes。少一个就是"金钱必须是有限数字: undefined"。
        money: 128000,
        cash: 128000,
        bank: { balance: 128000, money: 128000, credit_limit: 50000, total_credit: 50000, available_credit: 50000, used_credit: 0, active_loans: [], loans: [], cards: [], entries: [], transactions: [], monthly_due: 0, due_day: 1 },
        jobs: [],
        debt: 0,
        finance: { loans: [], debt: 0, money: 128000, balance: 128000, transactions: [] },
        package: { money: 128000, items: [], entries: [] },
        wallet: { balance: 128000, currency: 'CNY' },
        assets: { items: [], entries: [], total: 128000, net_worth: 128000 },
        attributes: { sources: [], totals: {}, rows: [] },
        appearance: {
          skin: 1,
          eyes: 1,
          outfit_style: 1,
          outfit_variant: 1,
          hair_style: 1,
          hair_variant: 1,
          accessory_style: null,
          accessory_variant: null,
        },
      },
      attributes: { sources: [], totals: {}, rows: [] },
      attribute_effects: { sources: [], totals: {}, rows: [] },
      package: { money: 128000, items: [], entries: [] },
      phone: projectPhone(opts.phone),
      housing: {},
      farm: null,
      money: 128000,
      wallet: { balance: 128000, currency: 'CNY' },
    },
    clock,
    weather: 'clear',
    story_flags: {},
    can_operate: true,
    market: { balance: 128000, money: 128000, holdings: [] },
    actors: actorsOf(world, scene),
    visual_timeline: [],
    // installed_appliances 是前端场景校验器要求的数组（缺了整份场景数据被判无效，画布就不启动）
    scene_place_runtime_states: [{ place_id: scene, furniture: [], installed_appliances: [] }],
    scene_farm_state: null,
  }
}

/** 场景快照（/game/state/scene）。比世界快照窄，但校验同样严格。 */
export function projectScene(
  world: WorldLike,
  opts: ProjectOptions & { scene?: string },
): Record<string, unknown> {
  // 前端会问 "给我 scene=X 的快照"，并要求三件事一致：
  // response.scene === X、cursor 覆盖请求的 seq、**viewer 的 presence.scene === X**。
  // 所以这里的场景用请求里的值，而不是配置里那个固定值。
  // 快照里的 scene 用 place id（前端拿它反查地点与命名）；资源键只出现在 place_topology 里
  // 这一段必须原样回显：前端校验 response.scene === request.scene；
  // 在这里做 id 映射会让它永远对不上（映射只发生在世界快照里）。
  const scene = opts.scene ?? opts.place
  const presence: Record<string, unknown> = {}
  const statuses: Record<string, unknown> = {}
  for (const agent of world.agents) {
    const entry = presenceOf(agent, scene) as { scene?: string }
    if (agent.id === opts.viewerRoleId) entry.scene = scene
    presence[agent.id] = entry
    statuses[agent.id] = publicStatusOf(world, agent, opts.startDate)
  }
  return {
    world_id: opts.worldId,
    cursor: { epoch: epochOf(world), seq: opts.realtimeSeq ?? world.tick },
    tick_marker: 'tick-' + String(world.tick),
    scene,
    role_public_statuses: statuses,
    role_presences: presence,
    actors: actorsOf(world, scene),
    place_runtimes: [{ place_id: scene, installed_appliances: [] }],
    place_topology: { places: placesOf(scene, opts.singlePlace === true) },
    clock: clockOf(world, opts.startDate),
    weather: 'clear',
    story_flags: {},
    market: { balance: 128000, money: 128000, holdings: [] },
    can_operate: true,
    logs: [],
    events: [],
  }
}

/** 世界卡片（/world/list 与 /world/{id}/info）。 */
export function projectWorldCard(world: WorldLike, opts: ProjectOptions): Record<string, unknown> {
  const clock = clockOf(world, opts.startDate)
  return {
    world_id: opts.worldId,
    name: world.name,
    created_at: opts.startDate + 'T00:00:00Z',
    game_day: clock.day_number,
    online_role_count: world.agents.length,
    role_count: world.agents.length,
    public_role_count: world.agents.length,
    max_roles: 12,
    is_paused: world.paused === true,
    operate_role_ids: world.agents.map((a) => a.id),
  }
}

/** 角色卡（/role/list）。字段名来自 RoleSelectView 的读取代码。 */
export function projectRoleCard(world: WorldLike, agent: WorldAgentLike, opts: ProjectOptions): Record<string, unknown> {
  return {
    role_id: agent.id,
    world_id: opts.worldId,
    world_name: world.name,
    name: agent.name,
    status: agent.state === 'working' ? 'online' : 'offline',
    retirement_reason: null,
    can_operate: true,
    is_player_owned: agent.boundAgentId !== null && agent.boundAgentId !== undefined,
    access_level: 'operate',
    home_name: opts.place,
    last_active_at: opts.startDate + 'T00:00:00Z',
    month_card_expires_at: null,
  }
}
