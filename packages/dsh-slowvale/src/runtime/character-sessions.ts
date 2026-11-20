
/**
 * CharacterSessions —— 把"角色"和"会话"接起来的唯一地方。
 *
 * ## 它做三件事，不做别的
 *
 * 1. 开：按角色 + 频道 → 现算 ContextBundle → 让 SessionPort 开一个会话；
 * 2. 说：按角色找到**能代表他说话**的会话（primary 优先），把话递过去；
 * 3. 记：绑定进 BindingTable（可回放），会话 id 留在内存映射里。
 *
 * ## 为什么"说"不直接接受 sessionId
 *
 * 上层（面板、任务、另一个角色）想找的是**人**，不是某张嘴。
 * 只允许按 characterId 说话，路由规则（primary/secondary/observer）才有地方执行；
 * 一旦允许调用方指定 sessionId，observer 也能对外发言，规则就形同虚设。
 */
import { BindingTable, type BindingRole, type Channel, type SessionBinding } from '../model/binding.js'
import { buildContext, type ContextInput, type ContextProvider } from '../model/context.js'
import type { Character } from '../model/character.js'
import { SessionError, type SessionPort } from './session-port.js'

export interface OpenCharacterInput {
  character: Character
  channel?: Channel
  role?: BindingRole
  /** 此刻的处境，由世界给。 */
  situation?: string
  tick: number
  memories?: readonly string[]
  /** 额外的注入层（H3 起会用）。 */
  providers?: readonly ContextProvider[]
}

export interface CharacterSessionsOptions {
  port: SessionPort
  /** 从 id 取角色；不存在要抛，不许造一个空壳。 */
  resolveCharacter(id: string): Character | null
  bindings?: BindingTable
}

export class CharacterSessions {
  private readonly port: SessionPort
  private readonly resolveCharacter: (id: string) => Character | null
  private readonly bindings: BindingTable
  private readonly sessionOf = new Map<string, string>()
  private readonly characterOfSession = new Map<string, string>()

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
   * 同一个角色已经有同频道的活会话时直接复用——重复开会把同一个人的两段回答
   * 接到两个上下文里，聊着聊着就精神分裂了。
   */
  async open(input: OpenCharacterInput): Promise<{ sessionId: string; contextText: string }> {
    const channel = input.channel ?? 'all'
    const role = input.role ?? 'secondary'
    const existing = this.bindings
      .sessionsOf(input.character.id)
      .find((binding) => binding.unboundAtTick === null && binding.channel === channel && binding.role === role)
    if (existing !== undefined) {
      const sessionId = this.sessionOf.get(existing.sessionId)
      if (sessionId !== undefined) {
        const contextInput: ContextInput = {
          character: input.character,
          channel,
          tick: input.tick,
          ...(input.situation === undefined ? {} : { situation: input.situation }),
          ...(input.memories === undefined ? {} : { memories: input.memories }),
        }
        const bundle = buildContext(contextInput, input.providers)
        return { sessionId, contextText: bundle.text }
      }
    }
    const contextInput: ContextInput = {
      character: input.character,
      channel,
      tick: input.tick,
      ...(input.situation === undefined ? {} : { situation: input.situation }),
      ...(input.memories === undefined ? {} : { memories: input.memories }),
    }
    const bundle = buildContext(contextInput, input.providers)
    const opened = await this.port.open({ characterId: input.character.id, channel, contextText: bundle.text })
    this.bindings.bind({ sessionId: opened.sessionId, characterId: input.character.id, role, channel, tick: input.tick })
    this.sessionOf.set(opened.sessionId, opened.sessionId)
    this.characterOfSession.set(opened.sessionId, input.character.id)
    return { sessionId: opened.sessionId, contextText: bundle.text }
  }

  /** 按角色说话：路由到能代表他的会话，等回复文本。 */
  async say(characterId: string, text: string): Promise<string> {
    const speaker = this.speakerOf(characterId)
    if (speaker === null) {
      throw new SessionError('角色 ' + characterId + ' 现在没有人能说话（没有 primary 或 secondary 会话）')
    }
    return this.port.say(speaker, text)
  }

  /** 谁能代表这个角色说话（sessionId）；没有就是 null。 */
  speakerOf(characterId: string): string | null {
    const binding = this.bindings.speakerOf(characterId)
    return binding?.sessionId ?? null
  }

  /** 这个角色所有的嘴。 */
  bindingsOf(characterId: string): SessionBinding[] {
    return this.bindings.sessionsOf(characterId).filter((row) => row.unboundAtTick === null)
  }

  /** 关掉一个会话并解绑（历史保留）。 */
  async close(sessionId: string, tick: number): Promise<boolean> {
    const characterId = this.characterOfSession.get(sessionId)
    if (characterId === undefined) return false
    await this.port.close(sessionId)
    this.bindings.unbind(sessionId, tick)
    this.characterOfSession.delete(sessionId)
    return true
  }
}
