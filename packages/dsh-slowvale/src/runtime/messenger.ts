
/**
 * Messenger —— 手机短信的世界侧。
 *
 * ## 三条规矩（来自 SMS-DESIGN.md，落到代码里就这三句）
 *
 * 1. **线程属于世界，不属于会话**：会话可以归档、可以换，聊天记录不能丢。
 * 2. **收下即回执**：短信是异步的，前端不该等模型；receive 只负责收下与入队。
 * 3. **投递按 tick 走**：真正"让他看一眼、回一句"发生在 deliver，
 *    这样"他忙着，过一会儿才回"是自然行为，而不是超时。
 */
import type { Character } from '../model/character.js'
import type { CharacterSessions } from './character-sessions.js'

export interface SmsMessage {
  id: string
  threadId: string
  /** 'player' 或角色 id。 */
  from: string
  text: string
  tick: number
  /** 实际投递给会话的时刻；null = 还在排队。 */
  deliveredAtTick: number | null
}

export interface SmsThread {
  id: string
  characterId: string
  messages: SmsMessage[]
}

export interface MessengerOptions {
  sessions: CharacterSessions
  resolveCharacter(id: string): Character | null
  /** 角色此刻方便看手机吗；不给就当"随时方便"。 */
  reachability?(characterId: string): { ready: boolean; reason: string }
}

export interface Receipt {
  messageId: string
  threadId: string
  queued: boolean
  reason: string
}

export interface DeliveredReply {
  threadId: string
  characterId: string
  replyId: string
  text: string
}

const PLAYER = 'player'
const THREAD_PREFIX = 'thread:'

export class Messenger {
  private readonly sessions: CharacterSessions
  private readonly resolveCharacter: (id: string) => Character | null
  private readonly reachability: (characterId: string) => { ready: boolean; reason: string }
  private readonly threads = new Map<string, SmsThread>()
  private readonly pending: SmsMessage[] = []
  private counter = 0

  constructor(options: MessengerOptions) {
    this.sessions = options.sessions
    this.resolveCharacter = options.resolveCharacter
    this.reachability = options.reachability ?? (() => ({ ready: true, reason: '' }))
  }

  /** 收下一条来自玩家的短信：入队，立刻回执。 */
  receive(characterId: string, text: string, tick: number): Receipt {
    if (this.resolveCharacter(characterId) === null) throw new Error('没有这个角色：' + characterId)
    if (text.trim() === '') throw new Error('短信不能为空')
    const thread = this.threadOf(characterId)
    this.counter += 1
    const message: SmsMessage = {
      id: 'm' + String(this.counter),
      threadId: thread.id,
      from: PLAYER,
      text,
      tick,
      deliveredAtTick: null,
    }
    thread.messages.push(message)
    this.pending.push(message)
    const reach = this.reachability(characterId)
    return {
      messageId: message.id,
      threadId: thread.id,
      queued: true,
      reason: reach.ready ? '已送达，等回复' : '他在忙：' + reach.reason,
    }
  }

  /**
   * 推进投递：排队的消息交给角色当前的嘴，收下回复。
   *
   * 没有活会话时**懒开一个**（channel=personal）：短信不需要"换个场合"，只需要一张嘴。
   * 这不是轮换——归档一个不存在的会话没有意义。
   *
   * 某个角色"还没空"时，他的消息留在队列里，别的角色照常投递（不搞全局阻塞）。
   */
  async deliver(tick: number): Promise<DeliveredReply[]> {
    const replies: DeliveredReply[] = []
    const stillWaiting: SmsMessage[] = []
    for (const message of this.pending) {
      const characterId = message.threadId.slice(THREAD_PREFIX.length)
      const character = this.resolveCharacter(characterId)
      if (character === null) continue
      if (!this.reachability(character.id).ready) {
        stillWaiting.push(message)
        continue
      }
      await this.ensureSession(character, tick)
      const reply = await this.sessions.say(character.id, message.text)
      message.deliveredAtTick = tick
      const thread = this.threadOf(character.id)
      this.counter += 1
      const replyMessage: SmsMessage = {
        id: 'm' + String(this.counter),
        threadId: thread.id,
        from: character.id,
        text: reply,
        tick,
        deliveredAtTick: tick,
      }
      thread.messages.push(replyMessage)
      replies.push({ threadId: thread.id, characterId: character.id, replyId: replyMessage.id, text: reply })
    }
    this.pending.length = 0
    this.pending.push(...stillWaiting)
    return replies
  }

  /** 玩家与某个角色的完整线程（含他在别的会话时期聊过的记录）。 */
  messagesOf(characterId: string): readonly SmsMessage[] {
    return this.threadOf(characterId).messages
  }

  /** 还没投递的消息数（面板/诊断用）。 */
  pendingCount(): number {
    return this.pending.length
  }

  private threadOf(characterId: string): SmsThread {
    const existing = this.threads.get(characterId)
    if (existing !== undefined) return existing
    const thread: SmsThread = { id: THREAD_PREFIX + characterId, characterId, messages: [] }
    this.threads.set(characterId, thread)
    return thread
  }

  private async ensureSession(character: Character, tick: number): Promise<void> {
    if (this.sessions.currentOf(character.id) !== null) return
    await this.sessions.open({ character, channel: 'personal', tick, situation: '刚收到一条短信' })
  }
}
