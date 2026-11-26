/**
 * xcity 工作区里的绑定表（只读投影）。
 *
 * ## 为什么适配层只读、不写
 *
 * 写入必须经过 `BindingTable`（1:1 校验、归档语义），而那是 dsh-slowvale 的职责。
 * 适配层如果也维护一份规则，迟早两边不一致——那种 bug（"一个会话绑了两个人"）
 * 不会当场报错，会在很久以后以"谁说的话算数"的形式出现。
 *
 * 所以这里只做一件事：把 `xcity/bindings.json` 读出来，映射成"谁代表谁"。
 */
import { readFileSync, existsSync } from 'node:fs'

export interface XcityBinding {
  sessionId: string
  characterId: string
  channel: string
  boundAtTick: number
}

interface RawFile {
  bindings?: {
    sessionId?: unknown
    characterId?: unknown
    channel?: unknown
    boundAtTick?: unknown
    archivedAtTick?: unknown
  }[]
}

/** 读活着的绑定（归档的不算）。文件缺失/损坏时返回空——它不该让世界起不来。 */
export function loadXcityBindings(path: string | null): XcityBinding[] {
  if (path === null || !existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as RawFile
    const out: XcityBinding[] = []
    for (const row of parsed.bindings ?? []) {
      if (row.archivedAtTick !== null && row.archivedAtTick !== undefined) continue
      if (typeof row.sessionId !== 'string' || typeof row.characterId !== 'string') continue
      out.push({
        sessionId: row.sessionId,
        characterId: row.characterId,
        channel: typeof row.channel === 'string' ? row.channel : 'all',
        boundAtTick: typeof row.boundAtTick === 'number' ? row.boundAtTick : 0,
      })
    }
    return out
  } catch {
    return []
  }
}

/** 某个会话现在代表谁；没有就 null。 */
export function characterOfSession(bindings: XcityBinding[], sessionId: string): string | null {
  return bindings.find((row) => row.sessionId === sessionId)?.characterId ?? null
}

/**
 * 世界里 agent-N 和角色 id（role.lin）的对应表。
 *
 * 为什么需要它：绑定表按**角色**记账（那是人的身份），而世界里的 agentId 是插槽。
 * 两个 id 空间不该混用，但必须有一处显式对应，否则"谁代表谁"无从落地。
 */
export function loadAgentMap(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [agentId, characterId] of Object.entries(raw)) {
      if (typeof characterId === 'string') out[agentId] = characterId
    }
    return out
  } catch {
    return {}
  }
}

/** Autonomy never guesses which session owns an ambiguous character or slot. */
export function sessionsByAgent(bindings: readonly XcityBinding[], agents: Readonly<Record<string, string>>): Map<string, string> {
  const slots = Object.entries(agents)
  const sessions = new Map<string, string>()
  for (const [agentId, characterId] of slots) {
    if (slots.some(([otherId, otherCharacter]) => otherId !== agentId && otherCharacter === characterId)) continue
    const matches = bindings.filter((binding) => binding.characterId === characterId)
    if (matches.length !== 1) continue
    const sessionId = matches[0]?.sessionId
    if (!sessionId || bindings.filter((binding) => binding.sessionId === sessionId).length !== 1) continue
    sessions.set(agentId, sessionId)
  }
  return sessions
}
