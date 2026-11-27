/** Prepare a character session without starting an inference on the host default model. */
export interface SessionSpawnPorts {
  createAgent: (input: { sessionId: string; cwd: string }) => Promise<void>
  attachToWorkspace: (sessionId: string, cwd: string) => Promise<boolean>
  /**
   * R503：给新会话明确选一个模型。
   *
   * 为什么必须有：宿主默认模型只对 UI 建的会话生效，spawn 出来的角色会话
   * model.current() 是 undefined，于是自主开工/每日计划一律被门控挡住
   * （实测计划计数 noModel=3）。没配就跳过，不猜。
   */
  selectModel?: (sessionId: string, choice: { provider: string; model: string }) => Promise<boolean>
}

export interface SpawnResult {
  ok: boolean
  sessionId?: string
  reason?: string
}

export function xcitySessionId(characterId: string, now: number): string {
  const clean = characterId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
  return 'xcity-' + clean + '-' + now.toString(36)
}

export async function spawnCharacterSession(input: {
  characterId: string
  cwd: string
  ports: SessionSpawnPorts
  now: number
  /** R503：角色会话用的模型；不配就不选（保持旧行为）。 */
  model?: { provider: string; model: string } | undefined
}): Promise<SpawnResult> {
  const sessionId = xcitySessionId(input.characterId, input.now)
  try {
    await input.ports.createAgent({ sessionId, cwd: input.cwd })
  } catch (error: unknown) {
    return { ok: false, reason: '建会话失败：' + String(error) }
  }
  if (input.model !== undefined && input.ports.selectModel !== undefined) {
    try {
      await input.ports.selectModel(sessionId, input.model)
    } catch {
      // 选模型失败不拦建会话：至少会话在，玩家还能在 UI 里手动选。
    }
  }
  try {
    if (await input.ports.attachToWorkspace(sessionId, input.cwd)) return { ok: true, sessionId }
  } catch {
    // A session can exist even if the workspace has not been registered.
  }
  return { ok: true, sessionId, reason: '会话已建，但没挂进工作区' }
}
