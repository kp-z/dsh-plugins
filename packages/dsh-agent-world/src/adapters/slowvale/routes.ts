/**
 * Slow Vale 的 HTTP 契约（P0 最小必需集）。
 *
 * ## 只做能进游戏的那几条
 *
 * 前端有 129 个端点，但"能看见世界"只需要十条左右。其余一律回空对象——
 * 前端对那些面板有兜底（会显示"面板出错了"），不会把整页拖垮。
 * **给假数据比给空数据更糟**：它会让"这个面板到底通没通"变得无法判断。
 *
 * ## 未实现的端点为什么要显式列出来
 *
 * 出问题时第一个问题是"这个端点做没做"。所以这里有一张 KNOWN 表，
 * 打它得到一句"P0 未实现"，而不是让它掉进静态文件兜底变成一个更费解的错。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { REAL_CONFIG } from './data/config.js'
import { sceneByPlace } from './scene-key.js'
import type { SmsStore } from './sms.js'
import { shapeFor } from './shapes.js'
import type { WorldLike } from './types.js'
import {
  projectRoleCard,
  projectScene,
  projectSnapshot,
  projectWorldCard,
  type ProjectOptions,
} from './project.js'

/** 路由上下文：一律靠注入，方便单测不启服务。 */
export interface RouteContext {
  opts: ProjectOptions
  account: { email: string; password: string }
  getWorld: () => WorldLike | null
  token: () => string
  log?: (line: string) => void
  /** 短信线程存储（世界侧，线程不属于会话）。 */
  sms: SmsStore
  /** SSE 通道的当前连接数（给诊断端点用）。 */
  streamClients?: () => number
}

/** 短信消息 → 前端字段（前端的行号靠它判断有没有新消息）。 */
function messageOf(message: {
  messageRowId: number
  threadId: string
  senderRoleId: string
  senderName: string
  content: string
  sentAt: string
  isSelf: boolean
}): Record<string, unknown> {
  return {
    message_row_id: message.messageRowId,
    thread_id: message.threadId,
    sender_role_id: message.senderRoleId,
    sender_name: message.senderName,
    content: message.content,
    sent_at: message.sentAt,
    is_self: message.isSelf,
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8')
      if (raw.length > 1_000_000) raw = raw.slice(0, 1_000_000)
    })
    req.on('end', () => {
      try {
        const parsed: unknown = raw === '' ? {} : JSON.parse(raw)
        resolve(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/** 物品分类（背包面板的筛选用）。先给一份通用集合，够面板打开。 */
const ITEM_CATEGORIES = [
  { id: 'food', name: '食物' },
  { id: 'drink', name: '饮品' },
  { id: 'medicine', name: '药品' },
  { id: 'material', name: '材料' },
  { id: 'tool', name: '工具' },
  { id: 'gift', name: '礼物' },
  { id: 'collectible', name: '收藏' },
] as const

/** 手机桌面：id 顺序必须与前端 PxPhoneFrame 的硬编码列表一致。 */
const PHONE_APPS = [
  { id: 'jobs', title: '工作', icon: '💼' },
  { id: 'bank', title: '银行', icon: '🏦' },
  { id: 'housing', title: '住房', icon: '🏠' },
  { id: 'delivery', title: '外卖', icon: '🛵' },
  { id: 'shopping', title: '购物', icon: '🛒' },
  { id: 'stocks', title: '股票', icon: '📈' },
  { id: 'gacha', title: '抽卡', icon: '🎴' },
  { id: 'my_business', title: '我的生意', icon: '🏪' },
  { id: 'singer', title: '唱歌', icon: '🎤' },
  { id: 'martial', title: '武术', icon: '🥋' },
  { id: 'news', title: '新闻', icon: '📰' },
  { id: 'moments', title: '朋友圈', icon: '🖼' },
] as const

/** P0 已知但未实现：列出来是为了让 404 有意义。 */
const NOT_IMPLEMENTED = new Set([
  '/game/phone/sms/threads',
  '/game/phone/thread',
  '/game/phone/contacts',
  '/game/logs/recent',
  '/game/logs/catch-up',
  '/game/moments',
  '/game/market',
  '/game/market/bars',
  '/game/finance/transactions',
  '/game/newspaper/issues',
  '/game/relationship-map',
  '/game/recap',
  '/shop/entries',
  '/shop/overview',
])

/**
 * 处理一个 /api 请求。返回是否已处理（false 时交给静态层）。
 */
export async function handleApi(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname.startsWith('/api') ? url.pathname.slice(4) || '/' : url.pathname
  if (!url.pathname.startsWith('/api')) return false
  const method = (req.method ?? 'GET').toUpperCase()
  const world = ctx.getWorld()

  if (path === '/__slowvale/health') {
    sendJson(res, 200, {
      ok: true,
      world: world === null ? null : { id: world.id, tick: world.tick, agents: world.agents.length },
      streamClients: ctx.streamClients?.() ?? 0,
    })
    return true
  }

  // ── 身份：本地单机，账号是配置里的固定值，token 只是占位 ──────────────
  if (path === '/auth/login' && method === 'POST') {
    const body = await readBody(req)
    if (body['email'] !== ctx.account.email || body['password'] !== ctx.account.password) {
      sendJson(res, 401, { detail: { code: 'invalid_credentials', message: '邮箱或密码错误' } })
      return true
    }
    sendJson(res, 200, sessionBody(ctx))
    return true
  }
  if (path === '/auth/refresh') {
    sendJson(res, 200, sessionBody(ctx))
    return true
  }
  if (path === '/auth/me') {
    sendJson(res, 200, {
      user_id: 'u-local',
      email: ctx.account.email,
      is_admin: true,
      locale: 'zh',
      display_name: 'Local',
      created_at: ctx.opts.startDate + 'T00:00:00Z',
      preferences: { locale: 'zh' },
    })
    return true
  }
  if (path === '/auth/select-role' && method === 'POST') {
    const body = await readBody(req)
    sendJson(res, 200, { world_id: ctx.opts.worldId, role_id: String(body['role_id'] ?? ctx.opts.viewerRoleId) })
    return true
  }
  if (path === '/config') {
    // 线上真实配置原样返回：这些键前端硬校验，自己拼总会漏（scene_by_place 曾经是 {}）
    sendJson(res, 200, REAL_CONFIG)
    return true
  }
  if (path === '/registry/items' || path === '/registry/recipes') {
    sendJson(res, 200, { entries: [], version: 1 })
    return true
  }
  if (path === '/admission-invites/check') {
    sendJson(res, 200, { allowed: true })
    return true
  }
  if (path === '/survey/current') {
    sendJson(res, 200, { id: null, submitted: true, questions: [] })
    return true
  }

  // ── 世界与角色 ──────────────────────────────────────────────────────────
  if (path === '/world/list') {
    sendJson(res, 200, { worlds: world === null ? [] : [projectWorldCard(world, ctx.opts)] })
    return true
  }
  if (path.startsWith('/world/') && path.endsWith('/info')) {
    // 角色页真正读的是这里的 roles（不是 /role/list）——少了它页面会显示"尚无可进入的角色"，
    // 而网络面板一片 200，极难看出问题。
    const card = world === null ? {} : projectWorldCard(world, ctx.opts)
    sendJson(res, 200, {
      ...card,
      roles: world === null ? [] : world.agents.map((agent) => projectRoleCard(world, agent, ctx.opts)),
    })
    return true
  }
  if (path.startsWith('/world/') && path.endsWith('/bulletins')) {
    sendJson(res, 200, { bulletins: [], campaigns: [], fishing_contest: null })
    return true
  }
  // 世界内角色列表：角色页真正读的是这条（/role/list 只是全局兜底）
  if (path.startsWith('/role/world/') && path.endsWith('/characters')) {
    sendJson(res, 200, {
      roles: world === null ? [] : world.agents.map((agent) => projectRoleCard(world, agent, ctx.opts)),
    })
    return true
  }
  if (path === '/role/list') {
    sendJson(res, 200, {
      roles: world === null ? [] : world.agents.map((agent) => projectRoleCard(world, agent, ctx.opts)),
    })
    return true
  }

  // ── 世界状态：进游戏的两条命脉 ──────────────────────────────────────────
  if (path === '/game/state/world') {
    if (world === null) {
      sendJson(res, 503, { detail: { code: 'no_world', message: '世界还没起来' } })
      return true
    }
    sendJson(res, 200, projectSnapshot(world, ctx.opts))
    return true
  }
  if (path === '/game/state/scene') {
    if (world === null) {
      sendJson(res, 503, { detail: { code: 'no_world', message: '世界还没起来' } })
      return true
    }
    // 前端请求会带 ?scene=<place_id>；照它回，否则它判「快照没覆盖这次切换」并整体重同步
    const requested = url.searchParams.get('scene')
    sendJson(res, 200, projectScene(world, requested === null ? ctx.opts : { ...ctx.opts, scene: requested }))
    return true
  }
  // ── 短信：线程 / 详情 / 发送 ─────────────────────────────────────────────
  if (path === '/game/phone/sms/threads' && method === 'GET') {
    // 先按世界里的角色建线程（幂等）：联系人来自世界，不来自会话。
    const world = ctx.getWorld()
    for (const agent of world?.agents ?? []) {
      if (agent.id === ctx.opts.viewerRoleId) continue
      ctx.sms.ensureThread(agent.id, agent.name)
    }
    const threads = ctx.sms.list().map((thread) => ({
      thread_id: thread.threadId,
      peer_role_id: thread.peerRoleId,
      peer_name: thread.peerName,
      last_message: thread.lastContent,
      last_sent_at: thread.lastSentAt,
      unread_count: thread.unread,
    }))
    sendJson(res, 200, { threads, unread_total: ctx.sms.unreadTotal() })
    return true
  }
  if (path === '/game/phone/sms/thread' && method === 'GET') {
    const threadId = url.searchParams.get('thread_id') ?? ''
    ctx.sms.markRead(threadId)
    const thread = ctx.sms.get(threadId)
    if (thread === null) {
      sendJson(res, 200, { thread_id: threadId, peer_name: null, messages: [], has_more: false, next_before_message_id: null })
      return true
    }
    sendJson(res, 200, {
      thread_id: thread.threadId,
      peer_name: thread.peerName,
      messages: thread.messages.map(messageOf),
      has_more: false,
      next_before_message_id: null,
    })
    return true
  }
  if (path === '/game/player/message' && method === 'POST') {
    const body = await readBody(req)
    const threadId = typeof body['thread_id'] === 'string' ? body['thread_id'] : ''
    const content = typeof body['content'] === 'string' ? body['content'] : ''
    const world = ctx.getWorld()
    if (threadId === '' || content.trim() === '' || world === null) {
      sendJson(res, 200, { ok: false, messages: [] })
      return true
    }
    await ctx.sms.send({
      threadId,
      senderRoleId: ctx.opts.viewerRoleId,
      senderName: '我',
      content,
      sentAt: new Date().toISOString(),
      tick: world.tick,
    })
    const thread = ctx.sms.get(threadId)
    sendJson(res, 200, { ok: true, messages: (thread?.messages ?? []).map(messageOf) })
    return true
  }
  if (path === '/game/player/conversation') {
    // 互动面板要 messages 数组；缺了直接抛 "missing array"
    // 这个响应有一组**固定数组字段**，少一个就抛 "missing array: xxx"。
    // 一次补齐比逐个试快。来源：GameView 里的 player_conversation_response 校验。
    sendJson(res, 200, {
      messages: [],
      suggestions: [],
      topics: [],
      pending_gifts: [],
      declutter_requests: [],
      calls: [],
      sticky_notes: [],
      urgent_messages: [],
      interactions: [],
      notes: [],
      can_operate: true,
    })
    return true
  }
  if (path === '/game/role-profile') {
    // 角色档案：前端读 response.role.* 与 response.attribute_effects.sources。
    // 这两个键少一个，整个角色面板都渲染不出来。
    const agent = world === null ? null : (world.agents.find((a) => a.id === ctx.opts.viewerRoleId) ?? world.agents[0] ?? null)
    const profile = agent === null ? {} : {
      role_id: agent.id,
      name: agent.name,
      display_name: agent.name,
      gender: 'male',
      status: 'online',
      appearance: {
        skin: 1, eyes: 1, outfit_style: 1, outfit_variant: 1,
        hair_style: 1, hair_variant: 1, accessory_style: null, accessory_variant: null,
      },
      basic_info: { role_id: agent.id, name: agent.name, gender: 'male', personality_reset_available: false },
      money: 128000,
      wallet: { balance: 128000, currency: 'CNY' },
      finance: { money: 128000, balance: 128000, transactions: [] },
      assets: { items: [], entries: [] },
      attributes: {},
      attribute_effects: { sources: [], totals: {} },
      titles: [],
      memories: [],
      changes: [],
    }
    sendJson(res, 200, {
      role: profile,
      attribute_effects: { sources: [], totals: {} },
      memories: [],
      changes: [],
      relationship: { friends: [], blocked: [] },
    })
    return true
  }
  if (path === '/game/blocks') {
    sendJson(res, 200, { blocked_role_ids: [] })
    return true
  }

  // ── SSE 票据：真正的流在 server 里发起 ──────────────────────────────────
  if (path === '/game/stream-ticket' && method === 'POST') {
    sendJson(res, 200, { ticket: ctx.token() })
    return true
  }

  // 结构层：已知形状的端点一律给合法空结构。前端对空态有兜底，对缺字段没有。
  const shaped = shapeFor(method, path)
  if (shaped !== null) {
    sendJson(res, 200, shaped)
    return true
  }

  if (NOT_IMPLEMENTED.has(path)) {
    ctx.log?.('[slowvale] 未实现端点被请求：' + path)
    sendJson(res, 501, { detail: { code: 'not_implemented', message: 'P0 未实现：' + path } })
    return true
  }

  // 其余一律空对象：前端对空结构的容忍度远高于对 404 的容忍度。
  sendJson(res, 200, {})
  return true
}

function sessionBody(ctx: RouteContext): Record<string, unknown> {
  return {
    access_token: ctx.token(),
    refresh_token: ctx.token(),
    user_id: 'u-local',
    is_admin: true,
    locale: 'zh',
  }
}
