/** 只有普通正文里完整标记的内容允许发给游戏玩家。 */
export const REPLY_OPEN = '<xcity-reply>'
export const REPLY_CLOSE = '</xcity-reply>'
export const REPLY_MAX_CHARS = 60
// R494：角色明确接受本短信提供的已有动作；正文不是命令。
export const ACCEPT_ACTION = '<xcity-action>accept</xcity-action>'

export function extractFrontendReply(text: string): string | null {
  const opening = text.indexOf(REPLY_OPEN)
  if (opening < 0) return null
  const from = opening + REPLY_OPEN.length
  const end = text.indexOf(REPLY_CLOSE, from)
  if (end < 0) return null
  const body = text.slice(from, end)
  if (body.includes(REPLY_OPEN)) return null
  const line = body.replace(/\s+/g, ' ').trim()
  if (line === '') return null
  const chars = Array.from(line)
  return chars.length > REPLY_MAX_CHARS ? chars.slice(0, REPLY_MAX_CHARS - 1).join('').trimEnd() + '…' : line
}
