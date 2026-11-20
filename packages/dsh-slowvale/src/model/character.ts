
/**
 * 角色（Character）—— 世界里的"人"，与"谁在替他说话"无关。
 *
 * ## 为什么角色和会话要彻底解耦
 *
 * 会话是**临时的嘴**：可以开、可以关、可以换。角色是**持久的人**：住在哪、什么性格、
 * 和谁熟，都不因为"今天用哪个会话"而变。
 * 一旦把 persona 硬塞进会话，换一个会话就等于换了一个人——那是错的。
 *
 * ## 角色只存"事实"，不存"这次怎么说话"
 *
 * "这次怎么说话"由 Context Bundle 现算（见 context.ts）：同样一个林野，
 * 在工作频道和私人频道，说出来的话应该不同，但**他还是他**。
 */
import type { Persona } from './persona.js'

/** 地点引用：只要 id 与给人看的名字，不把地图结构塞进角色。 */
export interface PlaceRef {
  placeId: string
  name: string
}

/** 外观八件套：与前端 character_generator 的字段一一对应。 */
export interface Appearance {
  skin: number
  eyes: number
  outfit_style: number
  outfit_variant: number
  hair_style: number
  hair_variant: number
  accessory_style: string | null
  accessory_variant: number | null
}

export interface Character {
  id: string
  name: string
  pronouns: string
  appearance: Appearance
  /** 家：晚上在哪。 */
  home: PlaceRef
  /** 工作地点：白天可能在哪；没有工作就是 null。 */
  work: PlaceRef | null
  /** 人格：稳定，不随时间变。 */
  persona: Persona
  /** 建这个角色的 tick，用于回放与排序。 */
  createdAtTick: number
}

export const DEFAULT_APPEARANCE: Appearance = {
  skin: 1,
  eyes: 1,
  outfit_style: 1,
  outfit_variant: 1,
  hair_style: 1,
  hair_variant: 1,
  accessory_style: null,
  accessory_variant: null,
}

/** 角色的一句话摘要（给日志、诊断、名单用），不参与对话。 */
export function describeCharacter(character: Character): string {
  return character.name + '（' + character.pronouns + '）· ' + character.persona.traits.slice(0, 2).join('、')
}
