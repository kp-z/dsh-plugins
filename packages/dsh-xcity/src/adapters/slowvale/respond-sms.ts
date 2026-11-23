/**
 * 短信 → 会话的转发器。
 *
 * 为什么把它单独拎出来：这段逻辑原来内联在 index.ts 的桥配置里，
 * 出错时只能靠"重启 + 手点"来验证，而它恰恰出过错（prompt 参数字段不全 → 500）。
 * 拆出来之后依赖全部注入，可以直接断言"到底用什么形状调了宿主"。
 */

export interface RespondSmsDeps {
  /** 线程里的 peer_role_id（世界里是 agent-N）。 */
  characterOf: (peerRoleId: string) => string | null
  /** 角色 → 会话（严格一对一）。 */
  sessionOf: (characterId: string) => string | null
  /** 宿主的会话投递。 */
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
  now: () => number = Date.now,
): Promise<null> {
  const characterId = deps.characterOf(input.peerRoleId)
  if (characterId === null) return null
  const sessionId = deps.sessionOf(characterId)
  if (sessionId === null) return null
  await deps.prompt(
    {
      requestId: 'xcity-sms:' + sessionId + ':' + String(now()),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: input.content }],
    },
    new AbortController().signal,
  )
  return null
}
