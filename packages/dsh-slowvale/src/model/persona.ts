/**
 * 人物设定（persona）。
 *
 * ## 为什么要结构化，而不是一段散文
 *
 * 一段散文没法被程序检查，也没法在多会话之间保持一致：同一个人的"工作号"和"私人号"
 * 必须共享性格，只在**语气与可见信息**上不同。所以性格是数据，语气是它的一个投影。
 *
 * ## 字段怎么来的
 *
 * 三个字段回答三个不同的问题，缺一个角色就会变成"会说话的模板"：
 * - traits：他是谁（稳定，不随场景变）；
 * - speech：他怎么说话（稳定，但可以按 channel 微调）；
 * - goals / taboos：他要什么、绝不做什么（决定行为，不只是语气）。
 */
export interface PersonaSpeech {
  /** 语气的三个关键词，例如 "简短" "克制" "带刺"。 */
  tone: string
  /** 一句话的大致字数上限；用来约束模型别写成小作文。 */
  sentenceLimit: number
  /** 口头习惯：固定会用的词或句式。 */
  quirks: readonly string[]
}

export interface Persona {
  id: string
  name: string
  /** 代词，用于中文自述（"我" 之外的第三人称描写）。 */
  pronouns: string
  traits: readonly string[]
  speech: PersonaSpeech
  goals: readonly string[]
  taboos: readonly string[]
}

/** 说话场合：不同场合看到的信息与语气允许不同。 */
export type Channel = 'work' | 'personal' | 'all'

/**
 * 把 persona 编成一段可注入的说明。
 *
 * 注意这里**只写"他是谁"**，不写"现在发生了什么"——处境由调用方另给。
 * 混在一起会让 prompt 无法复用，也会让模型把临时状态当成人格。
 */
export function personaBrief(persona: Persona): string {
  const quirks = persona.speech.quirks.length > 0 ? '口头习惯：' + persona.speech.quirks.join('；') + '。' : ''
  return [
    '你是' + persona.name + '（' + persona.pronouns + '）。',
    '性格：' + persona.traits.join('、') + '。',
    '说话方式：' + persona.speech.tone + '，一句话不超过 ' + String(persona.speech.sentenceLimit) + ' 字。' + quirks,
    '你在意的事：' + persona.goals.join('；') + '。',
    '你不做的事：' + persona.taboos.join('；') + '。',
  ].join('\n')
}

/** 场合差异：工作场合更克制，私人场合更松。 */
export function channelNote(channel: Channel): string {
  if (channel === 'work') return '现在是工作场合：说重点，不提私事。'
  if (channel === 'personal') return '现在是私人场合：可以放松，可以说感受。'
  return '场合不限：按对象调整尺度。'
}

/** 完整的人设注入：人格 + 场合 + 处境。处境由调用方给（他会随世界变）。 */
export function personaPrompt(persona: Persona, options: { channel: Channel; situation?: string }): string {
  const parts = [personaBrief(persona), channelNote(options.channel)]
  if (options.situation !== undefined && options.situation !== '') parts.push('此刻的处境：' + options.situation)
  return parts.join('\n')
}
