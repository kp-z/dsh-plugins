/**
 * 让插件自己开一个会话（照 cove-task 的做法）。
 *
 * ## 之前为什么做不到
 *
 * 我只用了 `sessionController.prompt`——那个只能往**已存在**的会话里发话，
 * 不能建会话，也不能把会话挂进工作区。所以"人物接通会话"一直卡在
 * "得先有个会话"这一步，而这一步在插件里其实做得到：
 *
 *   1. `agents.create({ sessionId, meta: { cwd } })` —— 建会话，cwd 决定它归哪个工作区；
 *   2. `workspaceRegistry.resolveByPath(cwd)` → `workspace.attachSession(sessionId)` —— 挂进工作区；
 *   3. `sessionController.prompt(...)` —— 投递第一条消息。
 *
 * 这三步在 cove-task 里是成熟的（见 packages/dsh-cove-task/index.js 的 startInSession），
 * 这里只是把它接到小镇的角色上：**一个角色一个会话**。
 */
export interface SessionSpawnPorts {
  /** 建会话：`agents.create`。 */
  createAgent: (input: { sessionId: string; cwd: string }) => Promise<void>
  /** 把会话挂进工作区：`registry.resolveByPath` + `workspace.attachSession`。 */
  attachToWorkspace: (sessionId: string, cwd: string) => Promise<boolean>
  /** 投递第一条消息：`sessionController.prompt`。 */
  prompt: (sessionId: string, text: string) => Promise<void>
}

export interface SpawnResult {
  ok: boolean
  sessionId?: string
  reason?: string
}

/** 会话 id 带前缀：一眼能看出这条会话是小镇开出来的，不和用户的会话混。 */
export function xcitySessionId(characterId: string, now: number): string {
  const clean = characterId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
  return 'xcity-' + clean + '-' + now.toString(36)
}

/** 给一个角色开一条属于 xcity 工作区的会话，并投递开场白。 */
export async function spawnCharacterSession(input: {
  characterId: string
  characterName: string
  cwd: string
  ports: SessionSpawnPorts
  now: number
}): Promise<SpawnResult> {
  const sessionId = xcitySessionId(input.characterId, input.now)
  try {
    await input.ports.createAgent({ sessionId, cwd: input.cwd })
  } catch (error: unknown) {
    return { ok: false, reason: '建会话失败：' + String(error) }
  }
  let attached = false
  try {
    attached = await input.ports.attachToWorkspace(sessionId, input.cwd)
  } catch {
    attached = false
  }
  try {
    await input.ports.prompt(
      sessionId,
      '你是' + input.characterName + '，现在在 xcity 小镇里。用一句话自我介绍一下。',
    )
  } catch {
    /* 投递失败不算建会话失败：会话已经在，面板里能看到 */
  }
  return attached
    ? { ok: true, sessionId }
    : { ok: true, sessionId, reason: '会话已建，但没挂进工作区' }
}
