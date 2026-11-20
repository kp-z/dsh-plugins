
/**
 * 关系与心情：两个"会随世界变"的注入层。
 *
 * ## 为什么它们不该写进 persona
 *
 * persona 回答"他是谁"，这两个回答"他此刻怎么看待你"。
 * 把关系写进人格，等于说"林野天生讨厌玩家"——换个玩家就错了。
 * 所以它们是**世界的状态**，每次开口现算，进 ContextBundle。
 */
import type { Character } from './character.js'

export type RelationKind = 'family' | 'friend' | 'colleague' | 'neighbour' | 'stranger'

export interface Relationship {
  /** 关系持有者。 */
  fromId: string
  /** 关系指向的人。 */
  toId: string
  kind: RelationKind
  /** 0 = 刚认识，1 = 很熟。 */
  closeness: number
  /** 上次见面（tick），用于"好久没见"这类判断。 */
  lastSeenTick: number
}

const KIND_LABEL: Record<RelationKind, string> = {
  family: '家人',
  friend: '朋友',
  colleague: '同事',
  neighbour: '邻居',
  stranger: '陌生人',
}

/** 给模型看的关系摘要：只写"有谁、什么关系、多熟"，不写建议。 */
export function describeRelationships(relationships: readonly Relationship[], nowTick: number): string | null {
  if (relationships.length === 0) return null
  const parts: string[] = []
  for (const relationship of relationships) {
    const days = Math.max(0, Math.floor((nowTick - relationship.lastSeenTick) / (60 * 60)))
    const freshness = days === 0 ? '今天见过' : days + ' 个多小时前见过'
    parts.push(relationship.toId + '（' + KIND_LABEL[relationship.kind] + '，' + closenessWord(relationship.closeness) + '，' + freshness + '）')
  }
  return parts.join('；')
}

/** 熟络度用词，故意只用三档——模型对形容词比数字敏感。 */
export function closenessWord(closeness: number): string {
  if (closeness >= 0.7) return '很熟'
  if (closeness >= 0.35) return '还行'
  return '不熟'
}

export interface Mood {
  energy: number
  stress: number
  sinceTick: number
}

/** 心情用一句话表达；阈值少，避免模型在"有点累"和"比较累"之间反复横跳。 */
export function describeMood(mood: Mood): string {
  if (mood.energy < 0.3) return '很累，说话短'
  if (mood.stress > 0.7) return '心里烦，没耐心'
  if (mood.energy > 0.8 && mood.stress < 0.3) return '状态不错'
  return '普普通通'
}

/** 角色 + 世界状态 → 关系摘要（给 provider 用）。 */
export function relationshipsOf(
  character: Character,
  all: readonly Relationship[],
  nowTick: number,
): string | null {
  return describeRelationships(
    all.filter((relationship) => relationship.fromId === character.id),
    nowTick,
  )
}
