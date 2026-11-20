/**
 * dsh-slowvale —— 把 Slow Vale 的城市接到 DSH。
 *
 * 这一版（H1）只有模型层：persona、角色↔会话绑定表。会话接入在 H2。
 */
export { BindingTable, BindingError } from './model/binding.js'
export type { BindingRole, Channel, SessionBinding, BindInput } from './model/binding.js'
export { personaBrief, personaPrompt, channelNote } from './model/persona.js'
export type { Persona, PersonaSpeech } from './model/persona.js'
export { CHARACTERS } from './content/characters.js'
