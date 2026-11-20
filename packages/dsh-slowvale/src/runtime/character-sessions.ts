
/**
 * CharacterSessions —— 把"角色"和"会话"接起来的唯一地方。
 *
 * ## 一个角色一张嘴
 *
 * 角色当前只有一个活会话。想换就 rotate：归档旧的、开一个新的。
 * 旧会话的记录留着当历史；人和记忆不换，换的只是"这次用哪张嘴"。
 *
 * ## 为什么"说"只接受 characterId
 *
 * 上层想找的是**人**。只允许按人说话，才不需要任何路由规则——因为只有一张嘴。
 */
import { BindingTable, type SessionBinding } from '../model/binding.js'
import type { Channel } from '../model/persona.js'
import { buildContext, type ContextInput, type ContextProvider } from '../model/context.js'
import type { Character } from '../model/character.js'
import { SessionError, type SessionPort } from './session-port.js'

export interface OpenCharacterInput {
  character: Character
  channel?: Channel
  /** 此刻的处境，由世界给。 */
  situation?: string
  tick: number
  memories?: readonly string[]
  /** 额外的注入层（H3 起会用）。 */
  providers?: readonly ContextProvider[]
}

export interface RotateInput extends OpenCharacterInput {
  /** 为什么换嘴：换场、换话题、会话坏了……事后要能解释。 */
  reason: string
}

export interface CharacterSessionsOptions {
  port: SessionPort
  /** 从 id 取角色；不存在要抛，不许造一个空壳。 */
  resolveCharacter: (id: string) => Character | null
  bindings?: BindingTable
}

export class CharacterSessions {
  private readonly port: SessionPort
  private readonly resolveCharacter: (id: string) => Character | null
  private readonly bindings: BindingTable
  private readonly sessionIds = new Set<string>()

  constructor(options: CharacterSessionsOptions) {
    this.port = options.port
    this.resolveCharacter = options.resolveCharacter
    this.bindings = options.bindings ?? new BindingTable()
  }

  /** 只读地看一眼绑定现状（面板/诊断用）。 */
  get table(): BindingTable {
    return this.bindings
  }

  /**
   * 给角色开一个会话。
   *
   * 已经有活会话时**直接拒绝**，而不是悄悄复用或悄悄顶替：
   * 复用会把新处境套在旧上下文上，顶替会丢掉旧会话的去向——两种都难查。
   */
  async open(input: OpenCharacterInput): Promise<{ sessionId: string; contextText: string }> {
    const current = this.bindings.current(input.character.id)
    if (current !== null) {
      throw new SessionError(
        '角色 ' + input.character.id + ' 已有活会话 ' + current.sessionId + '；要换请用 rotate（归档 + 新开）',
      )
    }
    return this.spawn(input)
  }

  /** 归档旧会话并开一个新的；返回新的会话与新上下文。 */
  async rotate(input: RotateInput): Promise<{ sessionId: string; contextText: string; archived: string | null }> {
    const current = this.bindings.current(input.character.id)
    let archived: string | null = null
    if (current !== null) {
      await this.port.close(current.sessionId)
      this.bindings.archive(current.sessionId, input.tick, input.reason)
      this.sessionIds.delete(current.sessionId)
      archived = current.sessionId
    }
    const opened = await this.spawn(input)
    return { ...opened, archived }
  }

  /** 按角色说话：找他当前那张嘴，等回复文本。 */
  async say(characterId: string, text: string): Promise<string> {
    const current = this.bindings.current(characterId)
    if (current === null) throw new SessionError('角色 ' + characterId + ' 现在没有活会话')
    if (!this.sessionIds.has(current.sessionId)) {
      throw new SessionError('会话 ' + current.sessionId + ' 没打开（端口未开户），不能说话')
    }
    return this.port.say(current.sessionId, text)
  }

  /** 角色当前的会话 id；没有就是 null。 */
  currentOf(characterId: string): string | null {
    return this.bindings.current(characterId)?.sessionId ?? null
  }

  /** 归档当前会话（不开新的）。 */
  async archive(characterId: string, tick: number, reason: string): Promise<string | null> {
    const current = this.bindings.current(characterId)
    if (current === null) return null
    await this.port.close(current.sessionId)
    this.bindings.archive(current.sessionId, tick, reason)
    this.sessionIds.delete(current.sessionId)
    return current.sessionId
  }

  /** 体检：绑定表是否自洽。 */
  health(): string[] {
    return this.bindings.validate()
  }

  private async spawn(input: OpenCharacterInput): Promise<{ sessionId: string; contextText: string }> {
    const contextInput: ContextInput = {
      character: input.character,
      channel: input.channel ?? 'all',
      tick: input.tick,
      ...(input.situation === undefined ? {} : { situation: input.situation }),
      ...(input.memories === undefined ? {} : { memories: input.memories }),
    }
    const bundle = buildContext(contextInput, input.providers)
    const opened = await this.port.open({
      characterId: input.character.id,
      channel: input.channel ?? 'all',
      contextText: bundle.text,
    })
    this.bindings.bind({
      sessionId: opened.sessionId,
      characterId: input.character.id,
      channel: input.channel ?? 'all',
      tick: input.tick,
    })
    this.sessionIds.add(opened.sessionId)
    return { sessionId: opened.sessionId, contextText: bundle.text }
  }
}
