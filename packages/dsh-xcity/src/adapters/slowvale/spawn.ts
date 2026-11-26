/** Prepare a character session without starting an inference on the host default model. */
export interface SessionSpawnPorts {
  createAgent: (input: { sessionId: string; cwd: string }) => Promise<void>
  attachToWorkspace: (sessionId: string, cwd: string) => Promise<boolean>
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
}): Promise<SpawnResult> {
  const sessionId = xcitySessionId(input.characterId, input.now)
  try {
    await input.ports.createAgent({ sessionId, cwd: input.cwd })
  } catch (error: unknown) {
    return { ok: false, reason: '建会话失败：' + String(error) }
  }
  try {
    if (await input.ports.attachToWorkspace(sessionId, input.cwd)) return { ok: true, sessionId }
  } catch {
    // A session can exist even if the workspace has not been registered.
  }
  return { ok: true, sessionId, reason: '会话已建，但没挂进工作区' }
}
