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
import { DEFAULT_CIRCUIT } from './stage.js'
import { MINUTES_PER_DAY, SLOWVALE_PROTOCOL_VERSION, TICKS_PER_GAME_MINUTE } from './types.js'

/** 投影参数（世界 id / 玩家角色 / 默认地点 / 起始日历）。 */
export interface ProjectOptions {
  worldId: string
  viewerRoleId: string
  place: string
  /** 世界第 0 tick 对应的游戏日期（YYYY-MM-DD）。 */
  startDate: string
}

/** 一 epoch 的含义：世界重启一次换一个。 */
export function epochOf(world: WorldLike): string {
  return 'epoch-' + world.id
}

/** 由 tick 推游戏时间。一天 = MINUTES_PER_DAY 个 tick。 */
export function clockOf(world: WorldLike, startDate: string): {
  paused: boolean
  day_number: number
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
  return {
    paused: world.paused === true,
    day_number: dayIndex + 1,
    current_datetime: yyyy + '-' + mm + '-' + dd + 'T' + hh + ':' + mi + ':00',
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
function presenceOf(agent: WorldAgentLike, place: string): Record<string, unknown> {
  const position = agent.position ?? {}
  const placeId = typeof agent.station === 'string' && agent.station !== '' ? agent.station : place
  // HUD 的同场景列表直接读 presence 上的 name/gender/appearance/titles，
  // 少任何一个都会在渲染时抛（"reading 'map'" 就是 titles 缺失）。
  return {
    role_id: agent.id,
    name: agent.name,
    gender: 'nonbinary',
    appearance: DEFAULT_APPEARANCE,
    titles: [],
    scene: placeId,
    location: {
      place_id: placeId,
      x: typeof position.x === 'number' ? position.x : 0,
      y: typeof position.z === 'number' ? position.z : 0,
      facing: facingOf(agent.facing),
    },
    visual_state: {},
  }
}

/** 角色公开状态：前端只认 online / offline / initializing / reactivating。 */
function publicStatusOf(agent: WorldAgentLike): Record<string, unknown> {
  return { status: agent.state === 'working' || agent.state === 'moving' ? 'online' : 'offline' }
}

/**
 * 地点拓扑。
 *
 * 前端拿 place_id 去场景规则表里查资源；查不到会走兜底（画占位房间）并报
 * "place.name 未登记"。所以这里必须用规则表命中得了的 id，并且给出人看的名字。
 */
export function placesOf(place: string): Record<string, Record<string, unknown>> {
  const places: Record<string, Record<string, unknown>> = {
    home_public: { place_id: 'home_public', scene: 'home_public', name: '家' },
    world_map: { place_id: 'world_map', scene: 'world_map', name: '城市地图' },
  }
  for (const spec of DEFAULT_CIRCUIT) {
    places[spec.id] = { place_id: spec.id, scene: spec.id, name: spec.label, asset: spec.asset }
  }
  if (places[place] === undefined) {
    places[place] = { place_id: place, scene: place, name: place }
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
    const placeId = typeof agent.station === 'string' && agent.station !== '' ? agent.station : place
    out[agent.id] = {
      actor_id: agent.id,
      role_id: agent.id,
      actorKind: 'role',
      name: agent.name,
      appearance: DEFAULT_APPEARANCE,
      place_id: placeId,
      location: { place_id: placeId, x: typeof position.x === 'number' ? position.x : 0, y: typeof position.z === 'number' ? position.z : 0 },
      visual_state: { anim: 'idle', facing: facingOf(agent.facing) },
    }
  }
  return out
}

/** 世界快照（/game/state/world 与 SSE connected 用同一份）。 */
export function projectSnapshot(world: WorldLike, opts: ProjectOptions): Record<string, unknown> {
  const clock = clockOf(world, opts.startDate)
  const presence: Record<string, unknown> = {}
  const statuses: Record<string, unknown> = {}
  for (const agent of world.agents) {
    presence[agent.id] = presenceOf(agent, opts.place)
    statuses[agent.id] = publicStatusOf(agent)
  }
  const viewerAgent = world.agents.find((a) => a.id === opts.viewerRoleId) ?? world.agents[0]
  const viewerId = viewerAgent?.id ?? opts.viewerRoleId
  const viewerName = viewerAgent?.name ?? '访客'
  return {
    // gameState.role：HUD 的几乎所有组件都从这里取名字与外观
    // （缺了就是 "Cannot read properties of undefined (reading 'name')"，且整块 HUD 挂不出来）
    role: {
      role_id: viewerId,
      basic_info: {
        role_id: viewerId,
        name: viewerName,
        gender: 'nonbinary',
        appearance: DEFAULT_APPEARANCE,
        personality_reset_available: false,
      },
      attributes: {},
      player_declutter: null,
    },
    scene: opts.place,
    world_id: opts.worldId,
    protocol_version: SLOWVALE_PROTOCOL_VERSION,
    cursor: { epoch: epochOf(world), seq: world.tick },
    viewer_role_id: viewerAgent?.id ?? opts.viewerRoleId,
    feed_head_record_entry_id: 0,
    role_public_statuses: statuses,
    role_presences: presence,
    place_topology: { places: placesOf(opts.place) },
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
          gender: 'nonbinary',
          appearance: DEFAULT_APPEARANCE,
          personality_reset_available: false,
        },
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
      attributes: {},
      package: {},
      phone: {},
      housing: {},
      farm: null,
    },
    clock,
    weather: 'clear',
    story_flags: {},
    can_operate: true,
    market: {},
    actors: actorsOf(world, opts.place),
    visual_timeline: [],
    scene_place_runtime_states: [{ place_id: opts.place, furniture: [] }],
    scene_farm_state: null,
  }
}

/** 场景快照（/game/state/scene）。比世界快照窄，但校验同样严格。 */
export function projectScene(world: WorldLike, opts: ProjectOptions): Record<string, unknown> {
  const presence: Record<string, unknown> = {}
  const statuses: Record<string, unknown> = {}
  for (const agent of world.agents) {
    presence[agent.id] = presenceOf(agent, opts.place)
    statuses[agent.id] = publicStatusOf(agent)
  }
  return {
    world_id: opts.worldId,
    cursor: { epoch: epochOf(world), seq: world.tick },
    tick_marker: 'tick-' + String(world.tick),
    scene: opts.place,
    role_public_statuses: statuses,
    role_presences: presence,
    actors: actorsOf(world, opts.place),
    place_runtimes: [{ place_id: opts.place, installed_appliances: [] }],
    place_topology: { places: placesOf(opts.place) },
    clock: clockOf(world, opts.startDate),
    weather: 'clear',
    story_flags: {},
    market: {},
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
