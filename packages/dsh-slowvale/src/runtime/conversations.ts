
/**
 * 角色之间的对话。
 *
 * ## 为什么要过世界，而不是 A 直接调 B 的会话
 *
 * 直连会绕过三样东西：谁在场、谁有话说、花了多少钱。
 * 而且回放时会缺一环——"B 那句话是回什么说的"查不到。
 * 所以：A 说 → 世界记一条 utterance → 世界决定投不投 → 投给 B 的会话 → 回复回世界。
 *
 * ## 为什么要防环
 *
 * A 找 B、B 回问 A、A 再回、B 再问……模型不会自己停。
 * 这不是模型笨，是"对话没有终点"本来就该由规则裁决。
 * 两道闸：**深度**（一句对话最多几次往返）与**每 tick 预算**（一轮里最多几回合）。
 */
import type { Character } from '../model/character.js'
import type { CharacterSessions } from './character-sessions.js'

export interface Utterance {
  id: string
  fromId: string
  toId: string
  text: string
  tick: number
  /** 第几跳：A→B 是 0，B→A 是 1。 */
  hop: number
}

export interface ConversationsOptions {
  sessions: CharacterSessions
  resolveCharacter(id: string): Character | null
  /** 最多几跳（默认 2：A 说一句、B 回一句）。 */
  maxHop?: number
  /** 每 tick 最多几次往返（默认 8），防止两个话痨把预算吃光。 */
  maxPerTick?: number
}

export interface SayToInput {
  fromId: string
  toId: string
  text: string
  tick: number
  /** 由上一次回复带过来；外部调用默认 0。 */
  hop?: number
}

export interface SayToResult {
  utterance: Utterance
  reply: string
  /** 回复是否被当作下一跳（false = 到这里为止）。 */
  continues: boolean
}

export class ConversationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversationError'
  }
}

const DEFAULT_MAX_HOP = 2
const DEFAULT_MAX_PER_TICK = 8

export class Conversations {
  private readonly sessions: CharacterSessions
  private readonly resolveCharacter: (id: string) => Character | null
  private readonly maxHop: number
  private readonly maxPerTick: number
  private readonly log: Utterance[] = []
  private readonly perTick = new Map<number, number>()
  private counter = 0

  constructor(options: ConversationsOptions) {
    this.sessions = options.sessions
    this.resolveCharacter = options.resolveCharacter
    this.maxHop = options.maxHop ?? DEFAULT_MAX_HOP
    this.maxPerTick = options.maxPerTick ?? DEFAULT_MAX_PER_TICK
  }

  /**
   * A 对 B 说一句，拿回 B 的回复。
   *
   * 拒绝的三种情况都要说清原因：没这个人、跳太深、这轮说太多了。
   */
  async sayTo(input: SayToInput): Promise<SayToResult> {
    const speaker = this.resolveCharacter(input.fromId)
    const listener = this.resolveCharacter(input.toId)
    if (speaker === null) throw new ConversationError('没有这个角色：' + input.fromId)
    if (listener === null) throw new ConversationError('没有这个角色：' + input.toId)
    if (input.fromId === input.toId) throw new ConversationError('不能自己跟自己说话')
    const hop = input.hop ?? 0
    if (hop > this.maxHop) {
      throw new ConversationError('对话太长：已到第 ' + String(hop) + ' 跳（上限 ' + String(this.maxHop) + '）')
    }
    const used = this.perTick.get(input.tick) ?? 0
    if (used >= this.maxPerTick) {
      throw new ConversationError('本轮对话已用完（' + String(this.maxPerTick) + ' 次/ tick）')
    }
    // 让 B 知道是谁在说话：一个会话只有一个人，所以对方身份必须写进文本。
    const delivered = speaker.name + '对你说：' + input.text
    await this.ensureSession(listener, speaker, input.tick)
    const reply = await this.sessions.say(listener.id, delivered)
    this.perTick.set(input.tick, used + 1)
    this.counter += 1
    const utterance: Utterance = {
      id: 'u' + String(this.counter),
      fromId: speaker.id,
      toId: listener.id,
      text: input.text,
      tick: input.tick,
      hop,
    }
    this.log.push(utterance)
    return { utterance, reply, continues: hop + 1 <= this.maxHop }
  }

  /** 一个 tick 内已经发生的回合数。 */
  usedInTick(tick: number): number {
    return this.perTick.get(tick) ?? 0
  }

  /** 全部回合（回放用）。 */
  history(): readonly Utterance[] {
    return this.log
  }

  /** 某个角色参与过的回合。 */
  utterancesOf(characterId: string): Utterance[] {
    return this.log.filter((utterance) => utterance.fromId === characterId || utterance.toId === characterId)
  }

  private async ensureSession(listener: Character, speaker: Character, tick: number): Promise<void> {
    if (this.sessions.currentOf(listener.id) !== null) return
    await this.sessions.open({
      character: listener,
      channel: 'personal',
      tick,
      situation: speaker.name + '走过来跟你说话',
    })
  }
}
