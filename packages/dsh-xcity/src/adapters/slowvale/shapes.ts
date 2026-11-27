
/**
 * 结构层：每个端点的"合法空形状"。
 *
 * ## 为什么需要它
 *
 * 前端的每个面板都带一个**硬校验**（"missing array: xxx" / "配置缺少 xxx"），
 * 少一个字段整块面板就抛。结构层的目标不是"有内容"，而是**面板能打开、显示空态**。
 *
 * ## 形状从哪来
 *
 * 不是猜的：每一条都对应前端会抛的那句错（见 docs/API-COVERAGE.md 的巡检记录）。
 * 补新端点时按同一套流程：点面板 → 读 __svlog 的第一条 error → 补这里。
 *
 * ## 约定
 *
 * - 一律返回 200 + 合法 JSON；语义上的"没有"用空数组/0/null 表达，**不要 404**。
 *   （404 会让前端把它当错误，空态则正常显示"还没有…"）
 * - 键名用前端读的那个名字，不做"优化"。
 * - 同一族端点共享 builder，减少重复。
 */

type Json = Record<string, unknown>

/** 空的分页响应：前端读 items + 游标。 */
function emptyPage(): Json {
  return { items: [], entries: [], has_more: false, next_cursor: null }
}

/** 日志族：/game/logs/recent 与 /game/logs/catch-up。 */
function logsRecent(): Json {
  return { entries: [], card_upserts: [], has_more: false, next_record_entry_id: 0, oldest_day_number: null }
}

function logsCatchUp(): Json {
  return {
    outcome: 'page',
    entries: [],
    card_upserts: [],
    next_record_entry_id: 0,
    target_record_entry_id: 0,
    has_more: false,
  }
}

/** 手机族。 */
function smsThreads(): Json {
  return { threads: [], unread_total: 0 }
}

function smsThread(): Json {
  return { thread_id: null, title: null, messages: [], has_more: false, next_before_message_id: null }
}

function contacts(): Json {
  return { contacts: [], groups: [] }
}

/** 朋友圈族。 */
function moments(): Json {
  return { moments: [], posts: [], items: [], feed: [], entries: [], has_more: false, next_cursor: null, head: null }
}

/** 市场族。 */
function market(): Json {
  return { rows: [], merchants: [], symbols: [], bars: [], items: [], entries: [], listings: [], snapshot: null, balance: 0, holdings: [], freshness: null }
}

/** 关系图。 */
function relationshipMap(): Json {
  return { roles: [], communities: [], edges: [], nodes: [], viewer_role_id: null }
}

/** 角色相关：记忆 / 变化。 */
function roleMemories(): Json {
  return { memories: [], has_more: false, next_cursor: null }
}

function roleChanges(): Json {
  return { changes: [], has_more: false, next_cursor: null }
}

/** 玩家操作类：统一回执。 */
function ack(): Json {
  return { ok: true }
}

/** 配额类。 */
function quota(): Json {
  return { used: 0, limit: 0, remaining: 0, reset_at: null, next_available_at: null }
}

/** 一族的形状表：路径正则 → 响应。 */
export interface ShapeRule {
  method: string
  pattern: RegExp
  body: () => Json
}

export const SHAPES: readonly ShapeRule[] = [
  // ── 日志 / 回顾 ────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/game\/logs\/recent$/, body: logsRecent },
  { method: 'GET', pattern: /^\/game\/logs\/catch-up$/, body: logsCatchUp },

  // ── 手机 ──────────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/game\/phone\/sms\/threads$/, body: smsThreads },
  { method: 'GET', pattern: /^\/game\/phone\/sms\/thread$/, body: smsThread },
  { method: 'GET', pattern: /^\/game\/phone\/contacts$/, body: contacts },
  { method: 'GET', pattern: /^\/game\/phone\/group\/messages$/, body: () => ({ messages: [], has_more: false }) },
  { method: 'GET', pattern: /^\/game\/phone\/delivery\/orders$/, body: () => ({ orders: [], has_more: false }) },
  { method: 'GET', pattern: /^\/game\/phone\/shopping\/orders$/, body: () => ({ orders: [], has_more: false }) },
  { method: 'GET', pattern: /^\/game\/phone\/my-business$/, body: () => ({ businesses: [] }) },
  { method: 'GET', pattern: /^\/game\/phone\/singer$/, body: () => ({ songs: [], fans: [], income: 0 }) },
  { method: 'GET', pattern: /^\/game\/phone\/apps\/.+\/listings$/, body: () => ({ listings: [], has_more: false }) },
  { method: 'GET', pattern: /^\/game\/phone\/apps\/bank$/, body: () => ({ loans: [], debt: 0, balance: 128000, credit_limit: 50000, entries: [], transactions: [] }) },
  { method: 'GET', pattern: /^\/game\/phone\/apps\/gacha$/, body: () => ({ card_sets: [], owned: [], tickets: 0, pity: 0 }) },
  { method: 'GET', pattern: /^\/game\/phone\/apps\/.+$/, body: emptyPage },

  // ── 朋友圈 ────────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/game\/moments$/, body: moments },
  { method: 'GET', pattern: /^\/game\/moments\/head$/, body: () => ({ head: null, unread: 0 }) },
  { method: 'GET', pattern: /^\/game\/moments\/activity$/, body: () => ({ activity: [], has_more: false }) },
  { method: 'GET', pattern: /^\/game\/moments\/profiles\/.+$/, body: () => ({ profile: null }) },
  { method: 'GET', pattern: /^\/game\/moments\/.+\/comments$/, body: () => ({ comments: [], has_more: false }) },
  { method: 'GET', pattern: /^\/game\/moments\/.+\/likes$/, body: () => ({ likes: [], has_more: false }) },
  { method: 'GET', pattern: /^\/game\/moments\/.+\/photo$/, body: () => ({ photo: null }) },
  { method: 'GET', pattern: /^\/game\/moments\/.+$/, body: () => ({ moment: null, comments: [] }) },

  // ── 市场 / 财经 ────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/game\/market$/, body: market },
  { method: 'GET', pattern: /^\/game\/market\/bars$/, body: () => ({ bars: [], symbol: null }) },
  { method: 'GET', pattern: /^\/game\/finance\/transactions$/, body: () => ({ transactions: [], has_more: false }) },
  { method: 'GET', pattern: /^\/game\/business\/grocery\/trades$/, body: () => ({ trades: [], has_more: false }) },
  { method: 'GET', pattern: /^\/game\/music\/(history|income|people|songs)$/, body: () => ({ items: [], songs: [], people: [], history: [], income: 0, has_more: false }) },
  { method: 'GET', pattern: /^\/game\/music\/songs\/.+$/, body: () => ({ song: null }) },
  { method: 'GET', pattern: /^\/game\/newspaper\/issues$/, body: () => ({ issues: [], has_more: false }) },
  { method: 'GET', pattern: /^\/game\/newspaper\/issues\/.+$/, body: () => ({ issue: null, articles: [] }) },
  { method: 'GET', pattern: /^\/game\/farm\/report$/, body: () => ({ plots: [], animals: [], summary: null }) },
  { method: 'GET', pattern: /^\/game\/custom-dishes$/, body: () => ({ dishes: [] }) },
  { method: 'GET', pattern: /^\/game\/custom-drinks$/, body: () => ({ drinks: [] }) },

  // ── 角色 / 关系 ────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/game\/role-memories$/, body: roleMemories },
  { method: 'GET', pattern: /^\/game\/role-changes$/, body: roleChanges },
  { method: 'GET', pattern: /^\/game\/relationship-map$/, body: relationshipMap },
  { method: 'GET', pattern: /^\/game\/map\/presences$/, body: () => ({ presences: [] }) },
  { method: 'GET', pattern: /^\/game\/package$/, body: () => ({ items: [], version: 1, money: 0 }) },
  { method: 'GET', pattern: /^\/game\/player\/(calls|stance)$/, body: () => ({ calls: [], stance: null }) },
  { method: 'GET', pattern: /^\/game\/player\/(declutter-quota|interaction-quota)$/, body: quota },
  { method: 'GET', pattern: /^\/game\/home\/furniture-layout$/, body: () => ({ place_id: null, furniture: [], rooms: [] }) },
  { method: 'PUT', pattern: /^\/game\/home\/furniture-layout$/, body: ack },
  { method: 'GET', pattern: /^\/game\/blocks$/, body: () => ({ blocked_role_ids: [] }) },
  { method: 'DELETE', pattern: /^\/game\/blocks\/.+$/, body: ack },

  // ── 玩家操作（一律回执） ────────────────────────────────────────────────────
  { method: 'POST', pattern: /^\/game\/player\//, body: ack },
  { method: 'POST', pattern: /^\/game\/(report|blocks)$/, body: ack },

  // ── 商店（本地版一律回执/空列表） ─────────────────────────────────────────
  { method: 'GET', pattern: /^\/shop\/(entries|orders|month-card)$/, body: () => ({ entries: [], orders: [], month_card: null, energy: 0 }) },
  { method: 'POST', pattern: /^\/shop\//, body: ack },
  { method: 'GET', pattern: /^\/admin\//, body: () => ({ items: [], entries: [], rows: [], overview: null, users: [], worlds: [], reports: [] }) },
  { method: 'POST', pattern: /^\/admin\//, body: ack },
  { method: 'PUT', pattern: /^\/admin\//, body: ack },
  { method: 'DELETE', pattern: /^\/admin\//, body: ack },

  // ── 杂项 ──────────────────────────────────────────────────────────────────
  { method: 'POST', pattern: /^\/push\/devices/, body: ack },
  { method: 'POST', pattern: /^\/widget\/session$/, body: ack },
  { method: 'POST', pattern: /^\/survey\/current\/submit$/, body: ack },
  { method: 'PATCH', pattern: /^\/auth\/me\/preferences$/, body: () => ({ locale: 'zh' }) },
  { method: 'POST', pattern: /^\/role\/create$/, body: () => ({ role_id: 'agent-1', world_id: 'w1' }) },
  { method: 'POST', pattern: /^\/role\/.+\/delete$/, body: ack },
]

/** 按 (method, path) 找形状；找不到返回 null，由调用方决定兜底。 */
export function shapeFor(method: string, path: string): Json | null {
  for (const rule of SHAPES) {
    if (rule.method === method && rule.pattern.test(path)) return rule.body()
  }
  return null
}
