/**
 * 让模型「说人话」的提示词（纯函数，能单测）。
 *
 * 这一层只负责把**原料**组织好：这一轮的收尾记录 + 调过哪些工具 + 是不是异常收尾。
 * 所有「别说代码、别说路径、先说结论」的约束都写死在 system 里，
 * 因为模型手里没有别的上下文，写不写清楚全看这几行。
 */

/** 喂给模型的正文上限：再长也只是浪费 token，收尾记录前 2000 字足够判断「这轮干了什么」。 */
export const MAX_INPUT_CHARS = 2000

/** 模型的系统提示：约束越具体，越不容易念出代码。 */
export const SYSTEM_PROMPT = [
  '你是一个语音播报员。用户刚看完一轮 AI 的干活记录，你要用声音把这一轮讲给他听。',
  '',
  '要求：',
  '1. 只用普通话口语，2 到 3 句，总共不超过 80 字。',
  '2. 先说结论：做完了没有、成没成；再说一句关键变化。',
  '3. 如果这轮有需要他拍板的事，用一句话点出来；没有就别硬编。',
  '4. 不要念代码、文件路径、网址、英文标识符、列表编号和表格。',
  '5. 数字说成中文口语：12 说成十二，80% 说成八成。',
  '6. 不要开场白（不要说「好的」「总结如下」），不要 Markdown，不要用引号把整句话包起来。',
  '',
  '只输出要念的那几句话，不要任何解释。',
].join('\n')

export interface PromptInput {
  /** 这一轮累积的助手正文（未清洗）。 */
  readonly text: string
  /** 这一轮调过的工具名（只给模型参考，明确要求不要太念出来）。 */
  readonly tools?: readonly string[] | undefined
  /** turn/end 的 reason.kind。 */
  readonly kind?: string | undefined
}

/** 截断原料，按行边界收尾，避免把一句话切两半。 */
export function clipInput(text: string, maxChars: number = MAX_INPUT_CHARS): string {
  const flat = text.replace(/\r\n?/g, '\n').trim()
  if (flat.length <= maxChars) return flat
  const cut = flat.slice(0, maxChars)
  const lastBreak = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('\n'))
  return (lastBreak > maxChars * 0.5 ? cut.slice(0, lastBreak) : cut).trim()
}

/** 组一次请求的 system + user。 */
export function buildPrompt(input: PromptInput): { system: string; user: string } {
  const parts: string[] = [`这一轮的收尾记录：\n${clipInput(input.text)}`]

  const tools = input.tools ?? []
  if (tools.length > 0) {
    const unique = [...new Set(tools)].slice(0, 12)
    parts.push(`这一轮调用过的工具（只作参考，不要念出来）：${unique.join('、')}`)
  }

  if (input.kind !== undefined && input.kind !== 'completed') {
    parts.push(`注意：这一轮不是正常完成，结束原因是 ${input.kind}。`)
  }

  parts.push('请按上面的要求，说出要念给用户听的那几句话。')
  return { system: SYSTEM_PROMPT, user: parts.join('\n\n') }
}
