/**
 * **Microverse 原版办公室**（R62）——把我们解出来的那张图变成这一局的场景。
 *
 * ## 这个包和 `pack.pixel` 的关系
 *
 * `pack.pixel` 是"用像素素材拼一个办公室"：它**自己声明** 10 个站点、给每个站点写
 * `props`（桌、椅、显示器…）与 `slots`（人站哪）。那是**我们用素材现搭**的场景。
 *
 * 这个包是"**把原版场景搬过来**"：地图已经把家具画好了（1322 格原版图块），
 * 所以站点**只需要位置与能力，不需要 props**——家具位置不再是我们维护的数据。
 *
 * 两个包**整条覆盖**同名的 districts/stations，所以装了本包就等于换场景。
 * 这也是 D31"表现是内容"真正兑现的地方：换场景 = 换一个包。
 *
 * ## 数据从哪来
 *
 * `office-map.ts`（`scripts/convert-microverse-map.mjs` 从 Godot 场景解出）
 * `office-scene.ts`（`scripts/gen-office-scene.mjs` 把地图转成分区与站点）
 *
 * **两个都是生成物，不要手改**；改转换器再重跑。
 */
import type { ContentPack, DistrictEntry, StationEntry, MapEntry, SceneEntry } from '../kinds.js'
import { OFFICE_BACKGROUND, OFFICE_DISTRICTS, OFFICE_STATIONS } from './office-scene.js'
import { OFFICE_MAP } from './office-map.js'
import { OFFICE_OCCUPANCY, OFFICE_OCCUPANCY_RECTS } from './office-occupancy.js'

/** 美术占位格：并进 walkable（不能站），同时留给 `SceneSpace` 生成整格碰撞体。 */
const OCCUPIED = new Set(OFFICE_OCCUPANCY)

/** 底图（整张办公室，1184×672）。 */
const MAP: MapEntry = {
  id: 'map.office',
  name: 'Microverse 办公室',
  url: OFFICE_BACKGROUND.url,
  width: OFFICE_BACKGROUND.width,
  height: OFFICE_BACKGROUND.height,
  cellPx: OFFICE_BACKGROUND.cellPx,
  unitsPerCell: OFFICE_BACKGROUND.unitsPerCell,
  // 原版图块的物理多边形解出来的可行走网格（248/777 格是墙或家具）。
  // R229：再并上"美术明显是家具、但物理多边形没挡"的 7 格——它们**画面上有东西**，
  // 挡上去不是空气墙，是不让人站在台面上。
  walkable: OFFICE_MAP.walkable.map((value, index) => (value === true && OCCUPIED.has(index) ? false : value)),
  occupancy: OFFICE_OCCUPANCY,
  occupancyRects: OFFICE_OCCUPANCY_RECTS,
}

/**
 * 9 个房间 → 分区。
 *
 * ⚠️ **房间描述（`desc`）原版就有**，而且是我们见过最省事的内容来源：
 * 会议室"大显示屏、两个写字板、一个大会议桌以及四个座位"、
 * 办公室"北半部分财务团队六个工位，南边软件工程师八个工位"——**不用我们编**。
 * 但它们现在**只用于分区**，还没有进对话上下文。那是一条独立的小改动（见 BACKLOG M14-5）。
 */
const DISTRICTS: DistrictEntry[] = OFFICE_DISTRICTS.map((d) => ({
  id: d.id,
  name: d.name,
  // 原版有 9 个房间，我们的 `DistrictKind` 只有 4 个值（它决定强调色）——
  // 映射是有损的，见 `gen-office-scene.mjs` 的 `ROOM_KIND`。这里如实转换。
  kind: d.kind as DistrictEntry['kind'],
  bounds: {
    min: { x: d.bounds.min.x, z: d.bounds.min.z },
    max: { x: d.bounds.max.x, z: d.bounds.max.z },
  },
  // 地面色仍走皮肤库——但**底图会盖住它**，所以在装了底图的这一局里，
  // 这个色只在"底图加载失败"时看得见（那正是我们想保留的回退）。
  ground: 'skin.ground.engineering',
}))

/** 24 把椅子 → 站点。**没有 `props`**：地图已经把家具画好了。 */
const CHAIR = 'model.part.chair-desk'

/**
 * R463：原版地图只画了椅子，没有“椅子可坐点”；很多站的 slots 还是 {0,0}，
 * 人就会坐到桌子旁边。这里给 desk 补一把明确椅子 + slot，会议桌补 4 把。
 * 地图里原有的椅子保留（用户要求“多放几把”），新增的是可坐、可碰撞的椅子。
 */
const EXTRA_CHAIRS: Record<string, { x: number; z: number; rotationY: number }> = {
  'station.seat-04': { x: 0, z: 1.5, rotationY: 0 },
  'station.seat-05': { x: 0, z: 1.5, rotationY: 0 },
  'station.seat-15': { x: 0, z: -1.5, rotationY: Math.PI },
  'station.seat-16': { x: 0, z: -1.5, rotationY: Math.PI },
}

const STATIONS: StationEntry[] = OFFICE_STATIONS.map((s) => {
  const base = {
    id: s.id,
    name: s.name,
    kind: s.kind as StationEntry['kind'],
    district: s.district,
    anchor: { x: s.anchor.x, z: s.anchor.z },
    relativeTo: null,
    capacity: s.capacity,
    capabilities: s.capabilities as StationEntry['capabilities'],
  }
  const extra = EXTRA_CHAIRS[s.id]
  if (extra !== undefined && s.kind === 'desk') {
    return {
      ...base,
      // 额外椅子只做装饰/占位，不改官方 seat slot，避免把工位坐点挪进墙里。
      props: [{ model: 'model.part.chair-desk', offset: { x: extra.x, z: extra.z }, rotationY: extra.rotationY }],
      slots: s.slots.map((v) => ({ x: v.x, z: v.z })),
    }
  }
  return { ...base, slots: s.slots.map((v) => ({ x: v.x, z: v.z })) }
})

/**
 * R478：茶水间休息位。
 *
 * 原版地图的 24 把椅子都是工位/会议椅，没有“吃饭、歇一会儿”的落点；
 * 于是“饿了/累了”在模型里只能站着。这里补一个 breakroom 站点——
 * `kind: 'breakroom'` 与 `rest` 能力都已经存在，不新增概念。
 */
const BREAKROOM: StationEntry = {
  id: 'station.breakroom-01',
  name: '茶水间休息位',
  kind: 'breakroom',
  district: 'district.6',
  anchor: { x: -12, z: -10 },
  relativeTo: null,
  // 8 个角色同时想吃饭时 2 个座位会排队饿死；茶水间按 4 个座位做。
  capacity: 4,
  capabilities: ['rest'],
  props: [{ model: CHAIR, offset: { x: 0, z: 0 }, rotationY: 0 }],
  // 座点是**相对锚点**的偏移（stationSlot 会加 anchor）；两者都要落在可走格上。
  slots: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }, { x: 6, z: 0 }],
}

/**
 * R478：东侧休息区。
 *
 * 茶水间只有 4 个座位，8 个角色夜里同时想睡时，一半人整夜站着（实测饥饿/体力到 0）。
 * 这里再补 6 个休息位，让"睡觉"不必排队；仍然是 breakroom 这一既有 kind。
 */
const LOUNGE: StationEntry = {
  id: 'station.lounge-01',
  name: '东侧休息区',
  kind: 'breakroom',
  district: 'district.4',
  anchor: { x: 20, z: -6 },
  relativeTo: null,
  capacity: 6,
  capabilities: ['rest'],
  props: [{ model: CHAIR, offset: { x: 0, z: 0 }, rotationY: 0 }],
  // R531：第 3 个槽原来是 x=+4（绝对坐标 24,-6），**和 station.seat-04 的工位落点
  // 完全重合**——工位上的人会和一个休息的人叠在同一点。这里跳过那一格，
  // 6 个座点摊成 20/22/26/28/30/32（x=24 那张椅子是工位，不是沙发）。
  slots: [
    { x: 0, z: 0 },
    { x: 2, z: 0 },
    { x: 6, z: 0 },
    { x: 8, z: 0 },
    { x: 10, z: 0 },
    { x: 12, z: 0 },
  ],
}

/**
 * R531：茶水间第二排座位（6 座）。
 *
 * 为什么"加站点"而不是把 breakroom-01 的 capacity 从 4 调大：capacity 与 slots
 * 条数**不被校验**（src/content/validate.ts:358-384），而 stationSlot 会把越界索引
 * **夹到最后一个槽**（src/domain/geometry.ts:39-43）——多出来的人会叠在同一点。
 * 要加座位，就得同时给得出**互不重合的可走坐标**。
 *
 * 坐标怎么定的：取 OFFICE_MAP.walkable 去掉 OFFICE_OCCUPANCY 后剩下的可走格，
 * 再排除已被其它站点槽位占用的格（docs/SEATING-CAPACITY.md 第 6 节有复核命令）。
 * 茶水间（district.6，x∈[-17,3]、z∈[-15,-7]）的 z=-8 一排整排可走且全空；
 * 相对锚点 (-12,-8) 每 2 单位一格，正好 6 个。
 */
const BREAKROOM_2: StationEntry = {
  id: 'station.breakroom-02',
  name: '茶水间窗边座位',
  kind: 'breakroom',
  district: 'district.6',
  anchor: { x: -12, z: -8 },
  relativeTo: null,
  capacity: 6,
  capabilities: ['rest'],
  props: [{ model: CHAIR, offset: { x: 0, z: 0 }, rotationY: 0 }],
  // 绝对坐标：(-12,-8) (-10,-8) (-8,-8) (-6,-8) (-4,-8) (-2,-8)。
  slots: [
    { x: 0, z: 0 },
    { x: 2, z: 0 },
    { x: 4, z: 0 },
    { x: 6, z: 0 },
    { x: 8, z: 0 },
    { x: 10, z: 0 },
  ],
}

/**
 * R531：东侧休息区里排（6 座）。
 *
 * 与 lounge-01（z=-6）平行，退到 z=-10 一排——那一排整排可走且全空，
 * 且离 z=-9 那三张工位椅（seat-19/20/21）≥2 单位，不会和工位坐点挤在一起。
 * 这样休息位合计 4+6+6+6 = 22 座，覆盖实测 16.7 的需求峰值。
 */
const LOUNGE_2: StationEntry = {
  id: 'station.lounge-02',
  name: '东侧休息区里排',
  kind: 'breakroom',
  district: 'district.4',
  anchor: { x: 24, z: -10 },
  relativeTo: null,
  capacity: 6,
  capabilities: ['rest'],
  props: [{ model: CHAIR, offset: { x: 0, z: 0 }, rotationY: 0 }],
  // 绝对坐标：24/26/28/30/32/34 在 z=-10。
  slots: [
    { x: 0, z: 0 },
    { x: 2, z: 0 },
    { x: 4, z: 0 },
    { x: 6, z: 0 },
    { x: 8, z: 0 },
    { x: 10, z: 0 },
  ],
}

const ALL_STATIONS: StationEntry[] = [...STATIONS, BREAKROOM, LOUNGE, BREAKROOM_2, LOUNGE_2]

/**
 * **这一局的装配单**：只引用原版办公室的 9 个分区与 24 个座位。
 *
 * 为什么需要它：`overrides` 只能**按 id 替换**条目，删不掉别人的。而基础包里有
 * 4 个分区（工程区/机房/会议区/公共区）和 10 个手摆的站点——它们会和原版的并存，
 * 于是角色可能被派到"墙外面那个工位"去。
 *
 * `SceneEntry` 就是为这件事存在的：**它按 id 列出这一局用哪些地块与站点**。
 * 所以切换场景 = 换一个 scene 条目，而不是删别人的内容。这也是"包是替换与升级的单位"
 * 那句话真正的用法。
 */
const SCENE: SceneEntry = {
  id: 'scene.office',
  name: 'Microverse 办公室（含茶水间/休息区）',
  districts: DISTRICTS.map((d) => d.id),
  stations: ALL_STATIONS.map((s) => s.id),
  // 入场点：接待处门口（原版前台那一片）。
  spawn: { x: -28, z: 12 },
  // 世界半边长 = 地图宽度的一半（74 / 2）。
  groundSize: 37,
  // 底图：整张烘好的办公室。家具在图里，所以站点不写 props。
  map: 'map.office',
  theme: 'theme.cozy-isometric',
  roster: 'roster.software-team',
  agentModel: 'model.agent.mv-tom',
  // ⚠️ 上面三个 id 我第一版是**猜的**（'roster.default' / 'theme.studio-night'），
  // 结果 76 个测试红在"场景引用了不存在的条目"。内容 id 必须去库里查，不能按命名习惯推。
  residentRules: [],
}

export const officePack: ContentPack = {
  manifest: {
    id: 'pack.office',
    name: 'Microverse 原版办公室',
    description:
      '把 Microverse 游戏自带的办公室场景搬过来：9 个房间（名字与描述是原版的中文）、24 个工位、茶水间/休息区 22 个座位（4+6+6+6，R531）、一张整图底图。',
    version: '1.0.0',
    schemaVersion: 1,
    requires: ['pack.pixel'],
    provides: ['districts', 'stations', 'maps', 'scenes'],
    overrides: [
      ...DISTRICTS.map((d) => `districts/${d.id}`),
      ...ALL_STATIONS.map((s) => `stations/${s.id}`),
      'maps/map.office',
      'scenes/scene.office',
    ],
  },
  entries: {
    maps: [MAP],
    scenes: [SCENE],
    districts: DISTRICTS,
    stations: ALL_STATIONS,
  },
}
