/**
 * dsh-slowvale —— 把 Slow Vale 的城市接到 DSH。
 *
 * 分层：Character（人）→ Persona（人格）→ ContextBundle（这次开口看到什么）→ Session（嘴）。
 * 会话永远不持有角色；它每次开口向世界要一份 bundle。
 */
export { BindingTable, BindingError } from './model/binding.js'
export type { BindingRole, Channel, SessionBinding, BindInput } from './model/binding.js'
export { DEFAULT_APPEARANCE, describeCharacter } from './model/character.js'
export type { Character, Appearance, PlaceRef } from './model/character.js'
export { CONTEXT_VERSION, DEFAULT_PROVIDERS, buildContext } from './model/context.js'
export type { ContextBundle, ContextInput, ContextProvider, ContextSection } from './model/context.js'
export { channelNote, personaBrief, personaPrompt } from './model/persona.js'
export type { Persona, PersonaSpeech } from './model/persona.js'
export { CHARACTERS, findCharacter } from './content/characters.js'
