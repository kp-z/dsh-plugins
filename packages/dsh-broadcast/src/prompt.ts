/**
 * 让模型「说人话」的提示词（纯函数，能单测）。
 *
 * 这一层的成败几乎全在**原料**：只给模型一段助手回复，它只能复述那段话；
 * 给它「用户要什么 + 实际做了哪几步 + 最后结论」，它才能说出「你让我做的事，做到哪了」。
 * 所以这里的输入是按这三段组织的，而不是一段正文。
 */

/** 喂给模型的三段原料各自的上限：再长也只是浪费 token。 */
export const MAX_ASK_CHARS = 400
export const MAX_REPLY_CHARS = 1200
export const MAX_ACTIONS = 8

/** 模型的系统提示：约束越具体，越不容易念出代码。 */
export const SYSTEM_PROMPT = [
  '你是一个语音播报员。用户刚看完一轮 AI 的干活记录，你要**用嘴跟他汇报**这一轮。',
  '',
  '要求：',
  '1. 只用普通话口语，2 到 3 句，总共不超过 80 字。',
  '2. 第一句先说结论：**他让你做的事，做到哪了**（做完了 / 没做成 / 还差一步）。',
  '3. 第二句说关键变化或卡点，不要复述原文，也不要逐条念做过的事。',
  '4. 如果这轮有需要他拍板的事，用一句话点出来；没有就别硬编。',
  '5. 用「我」说，不要用「本轮」「该会话」「任务」这类书面词，也不要念工具名。',
  '6. 不要念代码、文件路径、网址、英文标识符、列表编号和表格。',
  '7. 数字说成中文口语：12 说成十二，80% 说成八成。',
  '8. 不要开场白（不要说「好的」「总结如下」），不要 Markdown，不要用引号把整句话包起来。',
  // 合成器只吃纯文本，多音字全靠它自己猜（行/长/重/还/都/了 这些经常猜错）；
  // 换词是唯一能提前消除歧义的手段，所以直接写进提示词。
  '9. 有把握会被读错的多音字，换一个不含歧义的词：行 → 可以、干；长 → 久；重 → 再、沉；还 → 也；',
  '   单字容易读错的（行、长、重、差、处）尽量别单独出现，放回一个只有一种读法的词里。',
  '10. 中英文混排会被逐字母念（hang 会念成 h-a-n-g），所以英文单词、缩写一律换成中文说法。',
  '',
  '只输出要念的那几句话，不要任何解释。',
].join('\n')

/** 这一轮做过的一件事（由 session.ts 解出来的动作摘要）。 */
export interface PromptAction {
  readonly name: string
  readonly detail: string | undefined
}

export interface PromptInput {
  /** 用户这一轮的原话（可能很长）。 */
  readonly ask?: string | undefined
  /** 这一轮累积的助手正文（未清洗），最后一段才是结论。 */
  readonly text: string
  /** 这一轮做过的动作，按顺序。 */
  readonly actions?: readonly PromptAction[] | undefined
  /** turn/end 的 reason.kind。 */
  readonly kind?: string | undefined
}

/** 截断原料，按行边界收尾，避免把一句话切两半。 */
export function clipInput(text: string, maxChars: number): string {
  const flat = text.replace(/\r\n?/g, '\n').trim()
  if (flat.length <= maxChars) return flat
  const cut = flat.slice(0, maxChars)
  const lastBreak = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('\n'))
  return (lastBreak > maxChars * 0.5 ? cut.slice(0, lastBreak) : cut).trim()
}

/** 把动作压成一行行的「读了 X」「改了 Y」，最多 MAX_ACTIONS 条。 */
export function describeActions(actions: readonly PromptAction[], max: number = MAX_ACTIONS): string[] {
  const lines: string[] = []
  for (const action of actions.slice(0, max)) {
    const verb = ACTION_VERBS[action.name] ?? '做了'
    const target = action.detail === undefined ? '' : ` ${action.detail}`
    lines.push(`- ${verb}${target}`)
  }
  if (actions.length > max) lines.push(`- …另外还有 ${actions.length - max} 步`)
  return lines
}

/** 工具名 → 一个口语动词（认不出的统一说「做了」，不猜）。 */
const ACTION_VERBS: Record<string, string> = {
  read: '读了',
  write: '新写了',
  edit: '改了',
  bash: '运行了',
  run_code: '跑了段代码',
  grep: '搜了',
  glob: '找了文件',
  browser_open: '打开了网页',
  browser_screenshot: '截了图',
  vision_describe: '看了图',
  todo_write: '更新了计划',
  task: '派了子任务',
}

/** 组一次请求的 system + user。 */
export function buildPrompt(input: PromptInput): { system: string; user: string } {
  const parts: string[] = []

  const ask = clipInput(input.ask ?? '', MAX_ASK_CHARS)
  if (ask !== '') parts.push(`用户这一轮的原话：\n${ask}`)

  const text = clipInput(input.text, MAX_REPLY_CHARS)
  parts.push(`我最后的回复（结论在这里）：\n${text}`)

  const actions = describeActions(input.actions ?? [])
  if (actions.length > 0) {
    parts.push(`这一轮实际做过的事（供参考，不要逐条念）：\n${actions.join('\n')}`)
  }

  if (input.kind !== undefined && input.kind !== 'completed') {
    parts.push(`注意：这一轮不是正常完成，结束原因是 ${input.kind}。`)
  }

  parts.push('请按上面的要求，说出要念给用户听的那几句话。')
  return { system: SYSTEM_PROMPT, user: parts.join('\n\n') }
}
