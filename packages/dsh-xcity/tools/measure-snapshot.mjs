#!/usr/bin/env node
/**
 * 存档体积计量：把「存档多大、谁占的、会长到多少」变成可复算的数字。**只读**：
 * 只读 world.json，不写世界、不启进程、不碰内核。
 *
 * 用法：
 *   node tools/measure-snapshot.mjs
 *   node tools/measure-snapshot.mjs --state .testhome/profiles/xcity-3/state --agents 24 --days 30
 *
 * 输出 JSON（口径见 method）：actual / breakdown / perAgent / growth / projection / method。
 */
import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** 一天多少 tick（1 tick = 1 游戏分钟，与 sim/memory.ts 的 DAY_TICKS 同口径）。 */
const DAY_TICKS = 1440
/** 单份存档的体积预算。 */
// 与 src/sim/memory.ts 的 SNAPSHOT_BUDGET_BYTES 保持一致：24 人平台约 1.2 MB，
// 2 MiB 是"平台期还能留一倍余量"的数，不是拍脑袋的上限。
const BUDGET_BYTES = 2 * 1024 * 1024
const DEFAULT_STATE = '.testhome/profiles/xcity-3/state'

// [0] 参数：手写解析，不引依赖（与 tools/measure-tokens.mjs 同风格）
function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}

function done(payload, code) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
  process.exit(code)
}

function positiveInt(name, raw) {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) done({ ok: false, reason: `--${name} 需要正数，收到 ${JSON.stringify(raw)}` }, 1)
  return Math.round(value)
}

const isContainer = (value) => value !== null && typeof value === 'object'
/** 一个值的紧凑 JSON 体积（UTF-8 字节）。 */
const bytesOf = (value) => Buffer.byteLength(JSON.stringify(value ?? null))
const round1 = (value) => Math.round(value * 10) / 10
const round2 = (value) => Math.round(value * 100) / 100

// [1] 定位并读存档：--state 既可是状态目录，也可直接给 world.json
const stateArg = resolve(process.cwd(), String(arg('state', DEFAULT_STATE)))
let file = stateArg
try {
  if (statSync(stateArg).isDirectory()) file = join(stateArg, 'world.json')
} catch {
  done({ ok: false, reason: `状态目录不存在: ${stateArg}`, path: stateArg }, 1)
}
let raw
try {
  raw = readFileSync(file, 'utf8')
} catch (error) {
  done({ ok: false, reason: `读不到存档: ${file} (${error.code})`, path: file }, 1)
}
let doc
try {
  doc = JSON.parse(raw)
} catch {
  done({ ok: false, reason: 'world.json 不是合法 JSON', path: file }, 1)
}
const world = doc?.world
if (!isContainer(world) || Array.isArray(world)) {
  done({ ok: false, reason: '存档缺少 world 字段（结构应为 {world, content, savedAtTick, fileVersion}）', path: file }, 1)
}
const agents = Array.isArray(world.agents) ? world.agents : []
/** 落盘字节（含 pretty-print 缩进与键名）。 */
const fileBytes = Buffer.byteLength(raw)
/** 数据字节（紧凑 JSON，不含缩进）。 */
const compactBytes = bytesOf(doc)
/** 落盘 / 数据 比：存档按 2 空格缩进写，这个比≈1.9。 */
const formatRatio = compactBytes > 0 ? fileBytes / compactBytes : 1

// [2] actual：实测规模
const tick = Number(world.tick) || 0
const day = Math.floor(Math.max(0, tick) / DAY_TICKS) + 1
const episodes = agents.reduce((sum, agent) => sum + (Array.isArray(agent.episodes) ? agent.episodes.length : 0), 0)
const commitments = agents.reduce((sum, agent) => sum + (Array.isArray(agent.commitments) ? agent.commitments.length : 0), 0)
const tasks = Array.isArray(world.tasks) ? world.tasks.length : 0

// [3] breakdown：顶层字段 → world 各字段 → agents 内部再拆 episodes/commitments/其余。
// 剩下的落盘差额（键名 + 分隔符 + 缩进）单独成一行，这样整张表正好加起来等于 actual.bytes。
const rows = []
const push = (path, bytes) => rows.push({ path, bytes })
for (const key of Object.keys(doc)) push(key, bytesOf(doc[key]))
const worldScalars = Object.keys(world).filter((key) => !isContainer(world[key]))
for (const key of Object.keys(world)) {
  if (isContainer(world[key])) push(`world.${key}`, bytesOf(world[key]))
}
push('world.<scalars>', bytesOf(worldScalars.map((key) => world[key])))

const agentBytes = bytesOf(agents)
const agentParts = { episodes: 0, commitments: 0, other: 0 }
for (const agent of agents) {
  const episodeBytes = bytesOf(agent.episodes ?? [])
  const commitmentBytes = bytesOf(agent.commitments ?? [])
  agentParts.episodes += episodeBytes
  agentParts.commitments += commitmentBytes
  agentParts.other += bytesOf(agent) - episodeBytes - commitmentBytes
}
push('world.agents[].episodes', agentParts.episodes)
push('world.agents[].commitments', agentParts.commitments)
push('world.agents[].other', agentParts.other)

const topFieldBytes = Object.keys(doc).reduce((sum, key) => sum + bytesOf(doc[key]), 0)
push('(键名与缩进)', fileBytes - topFieldBytes)
for (const row of rows) row.share = round2(row.bytes / fileBytes)
rows.sort((a, b) => b.bytes - a.bytes)

// [4] perAgent：人均体积、人均情节、单条情节的成本（数据字节口径）
const perAgent = {
  avgBytes: agents.length > 0 ? Math.round(agentBytes / agents.length) : null,
  avgEpisodes: agents.length > 0 ? round1(episodes / agents.length) : null,
  bytesPerEpisode: episodes > 0 ? Math.round(agentParts.episodes / episodes) : null,
}

// [5] growth：人均每天净增的数据字节（估算，用 day 与 agents 分摊）
const bytesPerAgentPerDay = agents.length > 0 ? round1(agentBytes / agents.length / day) : 0
const growth = { bytesPerAgentPerDay }

// [6] projection：给定 --agents / --days 的预测体积，对比预算（结论按落盘字节给）
const projAgents = positiveInt('agents', arg('agents', agents.length))
const projDays = positiveInt('days', arg('days', day))
const fixedDataBytes = compactBytes - agentBytes
const projectedBytes = Math.round((fixedDataBytes + bytesPerAgentPerDay * projAgents * projDays) * formatRatio)
const projection = {
  agents: projAgents,
  days: projDays,
  projectedBytes,
  budgetBytes: BUDGET_BYTES,
  ratio: round2(projectedBytes / BUDGET_BYTES),
  verdict: projectedBytes <= BUDGET_BYTES ? 'ok' : 'over',
}

done(
  {
    ok: true,
    actual: { path: file, bytes: fileBytes, jsonBytes: compactBytes, day, agents: agents.length, episodes, commitments, tasks },
    breakdown: rows,
    perAgent,
    growth,
    projection,
    method:
      'actual.bytes = world.json 落盘字节（含 2 空格缩进与键名）；actual.jsonBytes = 整棵 JSON 紧凑序列化的字节，是纯数据量。' +
      'breakdown 的 bytes 是「该字段紧凑 JSON 的字节数」，不含键名与分隔符，所以 world.* 各行之和不等于 world 那一行；' +
      '分别列 world 与 world.<字段> 是为了看清楚构成，这些行互相重叠、不可相加；' +
      '「(键名与缩进)」= actual.bytes − 各顶层字段紧凑字节之和，含键名、分隔符与 pretty-print 缩进，' +
      '整张表（顶层 4 行 + 这一行）正好加总为 actual.bytes。' +
      '不读 events.jsonl 事件流（约 28 MB 的追加日志，不是存档本体）。' +
      'day = floor(tick / 1440) + 1，与 sim/memory.ts 的 dayOf 同口径。' +
      'perAgent.bytesPerEpisode 只摊 episodes 本身的字节，不含 agent 其余字段。' +
      'growth.bytesPerAgentPerDay = agents 紧凑字节 / 人数 / day，是「人均每天沉淀多少数据」的估算，' +
      '含建世界时就有的固定字段（因此天数少时偏高、天数越多越接近边际增量）。' +
      'projection.projectedBytes = (当前非 agent 数据 + bytesPerAgentPerDay × 人数 × 天数) × formatRatio(落盘/数据比)，' +
      '即只让 agent 记忆按「人 × 天」线性长大，骨架/内容包/站点/导航/tasks/messages 按当前实测值固定' +
      '（activities 另有 activityKeepFor(world)=max(64, 24×人数) 的上限，故不放大）。' +
      'episodes 有 7 天 / 150 条的裁剪上限，会先封顶，所以这是上界估算：verdict=over 表示「按线性增长会超预算」，不是已超。',
  },
  0,
)
