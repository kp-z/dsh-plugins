/**
 * 短信（SMS）——世界侧的线程存储。
 *
 * ## 为什么线程属于世界，不属于会话
 *
 * 会话会被归档、会换人（见 dsh-slowvale 的 binding.ts：一个角色同时只有一个活会话），
 * 但聊天记录不能跟着丢。所以线程按 `thread:<roleId>` 挂在世界这一侧，
 * 会话只是"现在代表这个人说话的那张嘴"。
 *
 * ## 收下即回执
 *
 * `send()` 只负责把"我发的"落库并返回回执，不等人。
 * 真正的"他回一句"由 responder 端口（接的是 DSH 会话）投递，等会话侧的
 * `assistant/message` 回来再用 `append(isSelf: false)` 写回线程。
 * 这样"他忙着，过一会儿才回"是自然行为，而不是超时。
 *
 * ## R537：等不到回复也是结论
 *
 * 投递和回复之间没有边界：会话没绑定、模型没回、桥断了，线程里看起来都只有自己那条。
 * 于是"发出去、没有然后"没法定位。所以每次 `send()` 都在线程上留一条
 * `reply` 结论（awaiting / timed-out / failed），有回复就销账。
 * 它是世界侧的状态，不是给前端读的渲染字段（见 project.ts 的 `phone.sms.reply`）。
 */

// ── R537：一条玩家短信的投递结论 ─────────────────────────────────
/**
 * R537：世界侧对「这条玩家短信有没有被回复」的结论。
 *
 * 三种结局，缺一个就会出现无法定位的死线程：
 * - awaiting：已交给 responder（= 投进会话），还没等到回复；
 * - timed-out：等到 SMS_REPLY_TIMEOUT_MS 还没回；
 * - failed：根本没投出去（世界没接会话服务 / responder 抛错）。
 */
export interface SmsReplyState {
  state: 'awaiting' | 'timed-out' | 'failed'
  /** 结论对应哪条玩家消息（行号）。 */
  messageRowId: number
  /** 开始等 / 失败的时刻（就是那条玩家消息的 sentAt）。 */
  since: string
  /** failed 的原因；awaiting / timed-out 为 null。 */
  reason: string | null
}

/**
 * 等多久算"没回"。
 *
 * **必须与 index.ts 的 `createSmsReplyTracker(10 * 60 * 1000)` 一致**：过了那个 TTL，
 * 会话侧已经丢掉待回执，再来回复也不会写回线程——世界侧若还挂着 awaiting，就是在撒谎。
 */
export const SMS_REPLY_TIMEOUT_MS = 10 * 60 * 1000

export interface SmsMessage {
  messageRowId: number
  threadId: string
  senderRoleId: string
  senderName: string
  /** 已经生成好的展示文本（不在这里做本地化）。 */
  content: string
  sentAt: string
  isSelf: boolean
}

export interface SmsThreadView {
  threadId: string
  peerRoleId: string
  peerName: string
  lastContent: string
  lastSentAt: string
  unread: number
  messages: SmsMessage[]
  /**
   * R537：最近一条玩家消息的投递结论；null = 已经有回复（或从没发过）。
   * 这里只存 awaiting / failed；timed-out 是读的时候按 since 算出来的（见 replyStateOf）。
   */
  reply: SmsReplyState | null
}

/** R537：把线程里记的结论 + 现在的时间，算成世界侧最终看到的结论（超时在这里得出）。 */
export function replyStateOf(reply: SmsReplyState | null, now: number): SmsReplyState | null {
  if (reply === null || reply.state !== 'awaiting') return reply
  const since = Date.parse(reply.since)
  // sentAt 不是合法时间（老存档/夹具）时不做超时判断，宁可显示"还在等"也不误报。
  if (!Number.isFinite(since) || now - since < SMS_REPLY_TIMEOUT_MS) return reply
  return { ...reply, state: 'timed-out' }
}

/** 收到一条消息后，由谁来决定怎么回。返回 null = 这次不回。 */
export type SmsResponder = (input: {
  threadId: string
  peerRoleId: string
  peerName: string
  content: string
  tick: number
}) => Promise<string | null>

export class SmsStore {
  private readonly threads = new Map<string, SmsThreadView>()
  private rowId = 0
  private responder: SmsResponder | null = null
  /** 最近一次 responder 失败的原因；null = 没失败过。 */
  lastResponderError: string | null = null

  /** 接上"谁会回话"。没接就只会记下消息，不会有回复。 */
  useResponder(responder: SmsResponder | null): void {
    this.responder = responder
  }

  /** 给"我"和每个角色各建一条线程（幂等）。 */
  ensureThread(peerRoleId: string, peerName: string): SmsThreadView {
    const threadId = 'thread:' + peerRoleId
    const existing = this.threads.get(threadId)
    if (existing !== undefined) return existing
    const created: SmsThreadView = {
      threadId,
      peerRoleId,
      peerName,
      lastContent: '',
      lastSentAt: '',
      unread: 0,
      messages: [],
      reply: null,
    }
    this.threads.set(threadId, created)
    return created
  }

  /** 追加一条消息（内部用；行号单调递增，前端靠它判断"有没有新消息"）。 */
  append(input: {
    threadId: string
    senderRoleId: string
    senderName: string
    content: string
    sentAt: string
    isSelf: boolean
  }): SmsMessage {
    this.rowId += 1
    const message: SmsMessage = {
      messageRowId: this.rowId,
      threadId: input.threadId,
      senderRoleId: input.senderRoleId,
      senderName: input.senderName,
      content: input.content,
      sentAt: input.sentAt,
      isSelf: input.isSelf,
    }
    const thread = this.threads.get(input.threadId)
    if (thread !== undefined) {
      thread.messages.push(message)
      thread.lastContent = input.content
      thread.lastSentAt = input.sentAt
      if (!input.isSelf) {
        thread.unread += 1
        // R537 ③：回复到了 → 销账。这是"等到了"唯一的写法，别在别处删状态。
        thread.reply = null
      }
    }
    return message
  }

  /**
   * 前端判断「有没有新消息」的两个值：最后一条的行号 + 未读总数。
   *
   * 为什么需要它：前端不轮询短信，它看快照里 viewer.phone.sms 的这两个值变没变，
   * 变了才重拉当前线程。我们之前没投影这两个值，于是「消息到了但界面不动」。
   *
   * R537：顺带给出世界侧结论 `reply`（最近一条玩家消息到底是等着、超时了还是没投出去）。
   * 前端不读它；它是"发出去没有回音"能被回答的唯一出处——诊断与快照都从这里取。
   */
  signal(now: number = Date.now()): { rowId: number; unread: number; reply: SmsReplyState | null } {
    let rowId = 0
    let unread = 0
    let latest: SmsReplyState | null = null
    for (const thread of this.threads.values()) {
      rowId = Math.max(rowId, thread.messages[thread.messages.length - 1]?.messageRowId ?? 0)
      unread += thread.unread
      // 多个线程都有结论时取最新那条（行号最大），不做"全局最坏"——问的是"我最后一句有没有人回"。
      if (thread.reply !== null && (latest === null || thread.reply.messageRowId > latest.messageRowId)) {
        latest = thread.reply
      }
    }
    return { rowId, unread, reply: replyStateOf(latest, now) }
  }

  /**
   * 我发一条：先落库（回执），再问 responder 要不要回。
   *
   * R537 三步，顺序不能换：
   * ① 玩家消息落库（回执照发）；
   * ② 记下"这条在等回复"——必须在 ③ **之前**：responder 卡住时（会话冷启动、
   *    宿主迟迟不受理）世界侧也要能回答"这条在等谁"；
   * ③ 问 responder。它返回文本 = 当场就回了；返回 null = 已投进会话、等会话侧回写。
   * responder 抛错只记一笔，不误伤回执（玩家的话已经落库了）。
   */
  async send(input: {
    threadId: string
    senderRoleId: string
    senderName: string
    content: string
    sentAt: string
    tick: number
  }): Promise<SmsMessage> {
    const message = this.append({ ...input, isSelf: true })
    const thread = this.threads.get(input.threadId)
    // 线程不存在时消息无处可挂（routes 会先 ensureThread）；不编结论，免得报一条看不见的错。
    if (thread === undefined) return message
    const awaiting: SmsReplyState = {
      state: 'awaiting',
      messageRowId: message.messageRowId,
      since: input.sentAt,
      reason: null,
    }
    // 世界没接会话服务：这条没有收发室，直接给"没投出去"的结论（失败的第一种）。
    if (this.responder === null) {
      thread.reply = { ...awaiting, state: 'failed', reason: 'no-responder' }
      return message
    }
    // ② 先挂"在等"，再问 responder：它卡住时世界侧也要能回答"这条在等谁"。
    thread.reply = awaiting
    let reply: string | null = null
    try {
      reply = await this.responder({
        threadId: thread.threadId,
        peerRoleId: thread.peerRoleId,
        peerName: thread.peerName,
        content: input.content,
        tick: input.tick,
      })
    } catch (error: unknown) {
      this.lastResponderError = error instanceof Error ? error.message : String(error)
      thread.reply = { ...awaiting, state: 'failed', reason: this.lastResponderError }
      reply = null
    }
    if (reply === null || reply.trim() === '') return message
    this.append({
      threadId: thread.threadId,
      senderRoleId: thread.peerRoleId,
      senderName: thread.peerName,
      content: reply,
      sentAt: input.sentAt,
      isSelf: false,
    })
    return message
  }

  /** 线程列表：最近聊过的排前面。 */
  list(): SmsThreadView[] {
    return [...this.threads.values()]
      .sort((a, b) => (a.lastSentAt < b.lastSentAt ? 1 : -1))
  }

  get(threadId: string): SmsThreadView | null {
    return this.threads.get(threadId) ?? null
  }

  /** 标记已读（打开线程时调用）。 */
  markRead(threadId: string): void {
    const thread = this.threads.get(threadId)
    if (thread !== undefined) thread.unread = 0
  }

  unreadTotal(): number {
    let total = 0
    for (const thread of this.threads.values()) total += thread.unread
    return total
  }
}
