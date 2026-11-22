
/**
 * 角色 ↔ 会话 的绑定表。
 *
 * ## 一个角色同时只有一个活会话
 *
 * 这不是保守，是**符合"人"的模型**：街上走的那个人只有一张嘴。
 * "工作号 + 私人号"是聊天软件的习惯，不是人；两个活会话还会让同一个人
 * 在两份上下文里各说一套，回放时说不清哪句算数。
 *
 * 要换一种状态（换个场合、换个话题），做法是**归档旧的、开一个新的**：
 * 旧会话的聊天记录留着当历史，人和记忆不换。
 *
 * ## 为什么还是"表"而不是字段
 *
 * 因为要能回答"某个小时代表他的是哪个会话"。所以是 append-only：
 * 解绑 = 写 archivedAtTick + reason，不删行。
 */
import type { Channel } from './persona.js'

export interface SessionBinding {
  sessionId: string
  characterId: string
  /** 频道只影响注入内容（工作/私人/不限），不影响谁能说话——因为只有一个人能说。 */
  channel: Channel
  boundAtTick: number
  /** 归档时刻；null = 还活着。 */
  archivedAtTick: number | null
  /** 归档原因（换号、换场、结束），便于事后解释。 */
  archivedReason: string | null
}

export interface BindInput {
  sessionId: string
  characterId: string
  channel?: Channel
  tick: number
}

export class BindingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BindingError'
  }
}

export class BindingTable {
  private readonly rows: SessionBinding[] = []

  /** 活着的绑定。正常情况下每个角色最多一条。 */
  active(): SessionBinding[] {
    return this.rows.filter((row) => row.archivedAtTick === null)
  }

  /** 全部历史（归档的也在），按加入顺序。 */
  history(): readonly SessionBinding[] {
    return this.rows
  }

  /**
   * 绑定一个会话。
   *
   * 两条不变量：
   * 1. 一个会话同时只能代表一个人；
   * 2. 一个角色同时只有一个活会话——要换就先 archive。
   */
  bind(input: BindInput): SessionBinding {
    if (input.sessionId.trim() === '') throw new BindingError('绑定缺少 sessionId')
    if (input.characterId.trim() === '') throw new BindingError('绑定缺少 characterId')
    const sameSession = this.active().find((row) => row.sessionId === input.sessionId)
    if (sameSession !== undefined) {
      throw new BindingError('会话 ' + input.sessionId + ' 已经是角色 ' + sameSession.characterId + ' 的活会话')
    }
    const sameCharacter = this.current(input.characterId)
    if (sameCharacter !== null) {
      throw new BindingError(
        '角色 ' + input.characterId + ' 已有活会话 ' + sameCharacter.sessionId + '；先 archive 再绑新的',
      )
    }
    const row: SessionBinding = {
      sessionId: input.sessionId,
      characterId: input.characterId,
      channel: input.channel ?? 'all',
      boundAtTick: input.tick,
      archivedAtTick: null,
      archivedReason: null,
    }
    this.rows.push(row)
    return row
  }

  /**
   * 从落盘数据重建一行（迁移/加载时用）。
   *
   * **不做冲突检查**：文件里的历史是既成事实，重放时如果还按 bind 的规则校验，
   * 一旦历史上真有例外（比如手工修过），程序就再也起不来了。
   */
  restore(row: SessionBinding): void {
    this.rows.push(row)
  }

  /** 归档一个会话：写归档时刻与原因，不删行。返回是否真的归档了。 */
  archive(sessionId: string, tick: number, reason = 'manual'): boolean {
    const current = this.active().find((row) => row.sessionId === sessionId)
    if (current === undefined) return false
    current.archivedAtTick = tick
    current.archivedReason = reason
    return true
  }

  /** 角色当前那张嘴；没有就 null。 */
  current(characterId: string): SessionBinding | null {
    return this.active().find((row) => row.characterId === characterId) ?? null
  }

  /** 这个会话现在代表谁；已归档返回 null。 */
  characterOf(sessionId: string): string | null {
    return this.active().find((row) => row.sessionId === sessionId)?.characterId ?? null
  }

  /** 某个角色用过的全部会话（含归档），按时间顺序。 */
  sessionsOf(characterId: string): SessionBinding[] {
    return this.rows.filter((row) => row.characterId === characterId)
  }

  /** 完整性自检：给测试与诊断用，返回人话问题列表（空数组 = 健康）。 */
  validate(): string[] {
    const problems: string[] = []
    const sessions = new Set<string>()
    const characters = new Set<string>()
    for (const row of this.active()) {
      if (sessions.has(row.sessionId)) problems.push('会话被重复绑定：' + row.sessionId)
      sessions.add(row.sessionId)
      if (characters.has(row.characterId)) problems.push('角色有多个活会话：' + row.characterId)
      characters.add(row.characterId)
    }
    return problems
  }
}
