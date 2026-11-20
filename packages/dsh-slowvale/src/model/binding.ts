/**
 * 角色 ↔ 会话 的绑定表。
 *
 * ## 为什么不是 agent.boundAgentId 那种一对一字段
 *
 * 一个人可以有多张嘴：工作号、私人号、旁观号。反过来**一个会话只能是一个人在说话**——
 * 否则聊天记录会精神分裂，回放时也说不清"这句是谁说的"。
 * 一对一字段表达不了前者，所以改成一张表。
 *
 * ## 为什么是 append-only
 *
 * 解绑不是删行，而是写 unboundAtTick。这样"某小时的某个会话代表谁"永远可查，
 * 也是世界回放的前提（绑定变更本身要进 journal）。
 *
 * ## 三档角色
 *
 * - primary：这个角色的"主口"，对外默认由它发言；一个角色同时只能有一个；
 * - secondary：副口（工作号/私人号），能发言但不能代表角色做承诺；
 * - observer：只听不说（旁观、只读的窗口）。
 */
export type BindingRole = 'primary' | 'secondary' | 'observer'

/** 一个会话代表某角色时，能看到哪些内容。 */
export type Channel = 'work' | 'personal' | 'all'

export interface SessionBinding {
  sessionId: string
  characterId: string
  role: BindingRole
  channel: Channel
  boundAtTick: number
  unboundAtTick: number | null
}

export interface BindInput {
  sessionId: string
  characterId: string
  role?: BindingRole
  channel?: Channel
  tick: number
}

/** 绑定不合法时抛这个，消息必须能照做（说清是哪个 id、哪条冲突）。 */
export class BindingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BindingError'
  }
}

export class BindingTable {
  private readonly rows: SessionBinding[] = []

  /** 当前生效的绑定（unboundAtTick 为 null）。 */
  active(): SessionBinding[] {
    return this.rows.filter((row) => row.unboundAtTick === null)
  }

  /** 全部历史，按加入顺序；回放与审计用。 */
  history(): readonly SessionBinding[] {
    return this.rows
  }

  /**
   * 把会话绑到角色上。
   *
   * 三条不变量在这里挡住，而不是事后校验：
   * 1. 一个会话同时只能代表一个人；
   * 2. 一个角色同时只能有一个 primary；
   * 3. observer 不能是 primary（只看不说的人不能当主口）。
   */
  bind(input: BindInput): SessionBinding {
    const role = input.role ?? 'secondary'
    const channel = input.channel ?? 'all'
    if (input.sessionId.trim() === '') throw new BindingError('绑定缺少 sessionId')
    if (input.characterId.trim() === '') throw new BindingError('绑定缺少 characterId')
    if (role === 'observer' && channel === 'all') {
      throw new BindingError('observer 必须指定 work 或 personal 频道：旁观不能看全部')
    }
    const current = this.active().find((row) => row.sessionId === input.sessionId)
    if (current !== undefined) {
      throw new BindingError(
        '会话 ' + input.sessionId + ' 已绑定在角色 ' + current.characterId + ' 上；先解绑再绑',
      )
    }
    if (role === 'primary' && this.primaryOf(input.characterId) !== null) {
      throw new BindingError('角色 ' + input.characterId + ' 已有 primary 会话；一个角色只能有一个主口')
    }
    const row: SessionBinding = {
      sessionId: input.sessionId,
      characterId: input.characterId,
      role,
      channel,
      boundAtTick: input.tick,
      unboundAtTick: null,
    }
    this.rows.push(row)
    return row
  }

  /** 解绑：写 unboundAtTick，不删行。返回是否真的解绑了。 */
  unbind(sessionId: string, tick: number): boolean {
    const current = this.active().find((row) => row.sessionId === sessionId)
    if (current === undefined) return false
    current.unboundAtTick = tick
    return true
  }

  /** 这个会话现在代表谁；没绑或已解绑返回 null。 */
  characterOf(sessionId: string): string | null {
    return this.active().find((row) => row.sessionId === sessionId)?.characterId ?? null
  }

  /** 这个角色现在有哪些嘴，可按时段过滤。 */
  sessionsOf(characterId: string, tick?: number): SessionBinding[] {
    return this.rows.filter(
      (row) =>
        row.characterId === characterId &&
        (row.unboundAtTick === null || (tick !== undefined && row.unboundAtTick > tick)),
    )
  }

  /** 角色的主口。 */
  primaryOf(characterId: string): SessionBinding | null {
    return this.active().find((row) => row.characterId === characterId && row.role === 'primary') ?? null
  }

  /** 谁能替这个角色"对外发言"：primary 优先，其次 secondary，observer 不算。 */
  speakerOf(characterId: string): SessionBinding | null {
    const active = this.active()
    return (
      active.find((row) => row.characterId === characterId && row.role === 'primary') ??
      active.find((row) => row.characterId === characterId && row.role === 'secondary') ??
      null
    )
  }

  /** 完整性自检：给测试与诊断用，返回人话问题列表（空数组 = 健康）。 */
  validate(): string[] {
    const problems: string[] = []
    const seen = new Set<string>()
    for (const row of this.active()) {
      if (seen.has(row.sessionId)) problems.push('会话被重复绑定：' + row.sessionId)
      seen.add(row.sessionId)
      if (row.role === 'observer' && row.channel === 'all') problems.push('observer 不该看全部：' + row.sessionId)
    }
    const byCharacter = new Map<string, number>()
    for (const row of this.active()) {
      if (row.role !== 'primary') continue
      byCharacter.set(row.characterId, (byCharacter.get(row.characterId) ?? 0) + 1)
    }
    for (const [characterId, count] of byCharacter) {
      if (count > 1) problems.push('角色 ' + characterId + ' 有 ' + String(count) + ' 个 primary')
    }
    return problems
  }
}
