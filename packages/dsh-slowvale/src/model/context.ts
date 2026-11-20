
/**
 * Context Bundle —— 会话"睁开眼睛"时看到的那一份东西。
 *
 * ## 这是整个设计里最关键的解耦点
 *
 * 会话不持有角色，也不持有 persona。它每次开口前向世界**要一份 bundle**：
 * 现在我是谁、在什么场合、处境如何、记得什么。世界按当前状态现算。
 *
 * 于是：
 * - 换会话 ≠ 换人（人不变，只是换了一张嘴）；
 * - 加注入层 ≠ 改会话（加一个 provider 就行）；
 * - 每句话都能回答"他当时看到了什么"（bundle 里每段都带 source）。
 *
 * ## 为什么是"分节"而不是一整段 prompt
 *
 * 一整段散文没法单测、没法局部替换、出了问题也没法定位是哪一层写坏的。
 * 分节之后，一段 prompt = 若干节，每节标注来源；增删层只是增删一个 provider。
 */
import type { Character } from './character.js'
import { channelNote, personaBrief, type Channel } from './persona.js'

/** 一次注入的输入：谁、在什么场合、什么处境、记得什么。 */
export interface ContextInput {
  character: Character
  channel: Channel
  /** 此刻的处境（他正站在哪、在干嘛）。由世界给，会话不改。 */
  situation?: string
  /** 当前 tick，用于记忆检索与回放。 */
  tick: number
  /** 检索到的记忆片段；H7 之前一直是空数组。 */
  memories?: readonly string[]
}

/** 一节注入内容。source 是"这段从哪来"，用于诊断与回放。 */
export interface ContextSection {
  key: string
  title: string
  text: string
  source: string
}

/** 一层注入。新增维度 = 新增一个 provider，不改 buildContext。 */
export interface ContextProvider {
  key: string
  provide(input: ContextInput): ContextSection | null
}

/** bundle 的版本：注入规则变了就加一，便于回放时判断"当时用的是哪版"。 */
export const CONTEXT_VERSION = 1

export interface ContextBundle {
  version: number
  sections: readonly ContextSection[]
  /** 渲染好的文本，按 sections 顺序拼接。 */
  text: string
}

const personaProvider: ContextProvider = {
  key: 'persona',
  provide(input) {
    return { key: 'persona', title: '你是谁', text: personaBrief(input.character.persona), source: 'character.persona' }
  },
}

const channelProvider: ContextProvider = {
  key: 'channel',
  provide(input) {
    return { key: 'channel', title: '场合', text: channelNote(input.channel), source: 'binding.channel' }
  },
}

const situationProvider: ContextProvider = {
  key: 'situation',
  provide(input) {
    if (input.situation === undefined || input.situation === '') return null
    return { key: 'situation', title: '此刻', text: input.situation, source: 'world.presence' }
  },
}

const memoryProvider: ContextProvider = {
  key: 'memory',
  provide(input) {
    const memories = input.memories ?? []
    if (memories.length === 0) return null
    return { key: 'memory', title: '你还记得', text: memories.join('\n'), source: 'character.memory' }
  },
}

/** 默认的四层。顺序 = prompt 里的顺序：先是谁，再是场合，再是处境，最后记忆。 */
export const DEFAULT_PROVIDERS: readonly ContextProvider[] = [
  personaProvider,
  channelProvider,
  situationProvider,
  memoryProvider,
]

/**
 * 组装 bundle。
 *
 * providers 可注入：测试可以塞一个假 provider 检查扩展性，
 * 未来加"关系""心情""传闻"都走同一条路，不碰这里。
 */
export function buildContext(
  input: ContextInput,
  providers: readonly ContextProvider[] = DEFAULT_PROVIDERS,
): ContextBundle {
  const sections: ContextSection[] = []
  for (const provider of providers) {
    const section = provider.provide(input)
    if (section !== null) sections.push(section)
  }
  const text = sections.map((section) => section.text).join('\n\n')
  return { version: CONTEXT_VERSION, sections, text }
}
