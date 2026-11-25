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
 * `receive()` 只负责收下并返回一条消息，不阻塞、不等人。
 * 真正的"他回一句"由 `deliver()` 在做客的会话侧完成，之后用 `append()` 写回线程。
 * 这样"他忙着，过一会儿才回"是自然行为，而不是超时。
 *
 * ## 现在谁来回复
 *
 * 还没有会话绑定时没有回复——这是诚实的默认值。
 * 需要一个 responder 端口（收到消息 → 返回回复文本），接上 DSH 会话后才有真回复。
 */
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
      if (!input.isSelf) thread.unread += 1
    }
    return message
  }

  /**
   * 前端判断「有没有新消息」的两个值：最后一条的行号 + 未读总数。
   *
   * 为什么需要它：前端不轮询短信，它看快照里 viewer.phone.sms 的这两个值变没变，
   * 变了才重拉当前线程。我们之前没投影这两个值，于是「消息到了但界面不动」。
   */
  signal(): { rowId: number; unread: number } {
    let rowId = 0
    let unread = 0
    for (const thread of this.threads.values()) {
      rowId = Math.max(rowId, thread.messages[thread.messages.length - 1]?.messageRowId ?? 0)
      unread += thread.unread
    }
    return { rowId, unread }
  }

  /** 我发一条：先落库（回执），再问 responder 要不要回。 */
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
    if (thread === undefined || this.responder === null) return message
    // responder 是**外部世界**（DSH 会话）。它失败不该让玩家的短信发不出去：
    // 消息已经落库，回执要正常返回；失败只记一笔，等下次重连再说。
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
