/**
 * R480：把 sim 的"想发"变成会话投递（纯 IO，可单测）。
 *
 * 从 index.ts 抽出来的理由和 respond-sms 一样：这段出过错（prompt 参数不全、
 * 回写串线），内联在组合根里只能靠重启手点。依赖注入后可以直接断言"到底投了什么"。
 */
import { initiativePromptText } from './respond-sms.js'

export interface InitiativeDeliveryDeps {
  /** agent id → 角色（绑定的 characterId）。 */
  characterOf: (agentId: string) => string | null
  /** 角色 → 会话。 */
  sessionOf: (characterId: string) => string | null
  /** 当天经历摘要（失败返回空数组即可）。 */
  dayContext: (agentId: string) => string[]
  /** 登记"这次回复要写回游戏"；返回取消函数。 */
  track: (agentId: string, sessionId: string, text: string, kind: 'initiative') => () => void
  prompt: (payload: {
    requestId: string
    sessionId: string
    mode: 'queue'
    content: { type: 'text'; text: string }[]
  }) => Promise<unknown>
  onError?: (message: string) => void
}

/**
 * 投递一条主动短信的提示。
 *
 * 返回 true = 已经投进会话；false = 没绑定 / 投递失败（调用方只记日志，不重试）。
 */
export async function deliverInitiative(
  agentId: string,
  reason: string,
  tick: number,
  deps: InitiativeDeliveryDeps,
): Promise<boolean> {
  const character = deps.characterOf(agentId)
  if (character === null) return false
  const sessionId = deps.sessionOf(character)
  if (sessionId === null) return false

  const marker = 'xcity-init:' + sessionId + ':' + tick
  let dayLines: string[] = []
  try {
    dayLines = deps.dayContext(agentId)
  } catch {
    dayLines = []
  }
  const text = initiativePromptText(reason, dayLines) + '\n\n主动短信编号：' + marker
  const cancel = deps.track(agentId, sessionId, text, 'initiative')
  try {
    await deps.prompt({ requestId: marker, sessionId, mode: 'queue', content: [{ type: 'text', text }] })
    return true
  } catch (error) {
    cancel()
    deps.onError?.(String(error))
    return false
  }
}
