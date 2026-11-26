/**
 * 短信 → 会话的转发器。
 *
 * 为什么把它单独拎出来：这段逻辑原来内联在 index.ts 的桥配置里，
 * 出错时只能靠"重启 + 手点"来验证，而它恰恰出过错（prompt 参数字段不全 → 500）。
 * 拆出来之后依赖全部注入，可以直接断言"到底用什么形状调了宿主"。
 */

import { randomUUID } from 'node:crypto'
import { REPLY_CLOSE, REPLY_OPEN } from './reply.js'

export interface RespondSmsDeps {
  /** 线程里的 peer_role_id（世界里是 agent-N）。 */
  characterOf: (peerRoleId: string) => string | null
  /** 角色 → 会话（严格一对一）。 */
  sessionOf: (characterId: string) => string | null
  /** R479：当天经历摘要（由世界事实生成；老调用方可以不给）。 */
  dayContext?: (peerRoleId: string) => string[]
  /** 宿主的会话投递。 */
  /** 已经真的把这条短信投进会话了（用来标记「下一次回复要写回游戏」）。 */
  onForward?: (peerRoleId: string, sessionId: string, text: string) => (() => void) | void
  prompt: (input: {
    requestId: string
    sessionId: string
    mode: 'queue'
    content: { type: 'text'; text: string }[]
  }, signal: AbortSignal) => Promise<unknown>
}

export interface RespondSmsInput {
  peerRoleId: string
  content: string
}

/**
 * 回一句"这次我不在请求里回"（返回 null），把话投进会话里。
 *
 * 返回 null 是诚实的：短信是异步的，"他回一句"发生在会话侧，
 * 不该在这个 HTTP 请求里编一句假回复。
 */
export async function respondViaSession(
  input: RespondSmsInput,
  deps: RespondSmsDeps,
  nonce: () => string = randomUUID,
): Promise<null> {
  const characterId = deps.characterOf(input.peerRoleId)
  if (characterId === null) return null
  const sessionId = deps.sessionOf(characterId)
  if (sessionId === null) return null
  const requestId = 'xcity-sms:' + sessionId + ':' + nonce()
  // 摘要失败不能把短信也弄丢：世界取不到/老存档异常时退回"没有摘要"。
  let dayLines: string[] = []
  try {
    dayLines = deps.dayContext?.(input.peerRoleId) ?? []
  } catch {
    dayLines = []
  }
  const text = promptText(input.content, dayLines) + '\n\n短信投递编号：' + requestId
  const cancel = deps.onForward?.(input.peerRoleId, sessionId, text)
  try {
    await deps.prompt({ requestId, sessionId, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
  } catch (error) {
    cancel?.()
    throw error
  }
  return null
}

/**
 * 投进会话的那段话：玩家原话 + **给前端看的回复格式要求**。
 *
 * 为什么要把格式写进 prompt：同一次回复有两个读者——DSH 里的人要详细，
 * 游戏里的玩家只要一句。靠"模型自己猜"永远不稳定，所以给一个明确标记。
 */
export function promptText(content: string, dayLines: readonly string[] = []): string {
  const day = dayLines.length === 0 ? [] : ['你今天到目前为止：', ...dayLines.map((line) => '- ' + line), '']
  return [
    '你在 xcity 小镇里，玩家刚给你发来一条短信：',
    '「' + content + '」',
    '',
    ...day,
    '请回复。规则：',
    '1. 给玩家看的话放进 ' + REPLY_OPEN + '…' + REPLY_CLOSE + ' 之间，一句，不超过 30 字；',
    '2. 标记之外可以写详细说明——那部分只有 DSH 里的人看得到，不会进游戏；',
    '3. 做不到的事不要答应；',
    '4. 这条回复必须是普通文本消息（assistant text），只写在思考里玩家收不到；若调用了工具，工具之后要再补一条文本回复。',
  ].join('\n')
}
