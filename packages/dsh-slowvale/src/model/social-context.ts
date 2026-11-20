
/**
 * 扩展注入层：关系与心情。
 *
 * 这两个 provider 是"加层不改调用方"的第一个真实用例：
 * buildContext 一行没动，只是在传入的 provider 列表里多两项。
 */
import type { ContextProvider } from './context.js'
import type { Relationship } from './relations.js'
import { describeMood, relationshipsOf, type Mood } from './relations.js'

/** 世界状态里，与注入有关的那一小块。 */
export interface SocialState {
  relationships: readonly Relationship[]
  mood: Mood | null
  nowTick: number
}

/** 关系层：只写"有谁、什么关系、多熟"，不写建议。 */
export function relationshipProvider(state: SocialState): ContextProvider {
  return {
    key: 'relationship',
    provide(input) {
      const text = relationshipsOf(input.character, state.relationships, state.nowTick)
      if (text === null) return null
      return { key: 'relationship', title: '你认识的人', text, source: 'world.relationships' }
    },
  }
}

/** 心情层：体力/压力 → 一句话，空状态时不出现。 */
export function moodProvider(state: SocialState): ContextProvider {
  return {
    key: 'mood',
    provide() {
      if (state.mood === null) return null
      return { key: 'mood', title: '你现在', text: describeMood(state.mood), source: 'world.mood' }
    },
  }
}

/** 一次拿到两层，顺序固定（关系在心情之前：先说人，再说自己状态）。 */
export function socialProviders(state: SocialState): readonly ContextProvider[] {
  return [relationshipProvider(state), moodProvider(state)]
}
