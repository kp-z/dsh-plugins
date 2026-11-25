/**
 * 从会话回复里取出「给游戏前端看的那一句」。
 *
 * ## 为什么需要它
 *
 * 同一次回复有两个读者：DSH 里的人（可以详细）和小镇里发短信的玩家（要短）。
 * 所以绑定会话被要求把**给玩家的话**放进 <xcity-reply>…</xcity-reply>，
 * 标记之外的内容只在 DSH 里出现，不进游戏。
 *
 * ## 没有标记怎么办
 *
 * 不假装有标记：退回"第一句"（按句号/问号/换行切），再截断到上限。
 * 这样模型偶尔忘了标记时玩家仍能收到一句，而不是石沉大海。
 */

export const REPLY_OPEN = '<xcity-reply>'
export const REPLY_CLOSE = '</xcity-reply>'

/** 前端气泡/短信能舒服显示的字符上限。 */
export const REPLY_MAX_CHARS = 60

/**
 * 把一段可能很长的回复压成一句给前端的话。
 *
 * @returns 取到了就返回短句；整段没有任何可说的返回 null。
 */
export function extractFrontendReply(text: string, maxChars: number = REPLY_MAX_CHARS): string | null {
  const raw = text.trim()
  if (raw === '') return null

  const marked = firstTagged(raw)
  const source = marked ?? firstSentence(raw)
  const oneLine = source.replace(/\s+/g, ' ').trim()
  if (oneLine === '') return null
  return oneLine.length > maxChars ? oneLine.slice(0, maxChars).trimEnd() + '…' : oneLine
}

function firstTagged(text: string): string | null {
  const start = text.indexOf(REPLY_OPEN)
  if (start < 0) return null
  const from = start + REPLY_OPEN.length
  const end = text.indexOf(REPLY_CLOSE, from)
  // 没闭合就取到结尾——仍比整段分析更适合当短信。
  const body = (end < 0 ? text.slice(from) : text.slice(from, end)).trim()
  return body === '' ? null : body
}

function firstSentence(text: string): string {
  // 去掉残留标记再取第一句，避免把 "<xcity-reply>" 当成内容。
  const cleaned = text.split(REPLY_OPEN).join(' ').split(REPLY_CLOSE).join(' ')
  const line = cleaned
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part !== '')
  if (line === undefined) return ''
  const match = line.match(/^[^。！？!?]*(?:[。！？!?]|$)/)
  return (match?.[0] ?? line).trim()
}
