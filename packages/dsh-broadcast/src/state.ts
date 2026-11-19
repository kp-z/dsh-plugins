/**
 * 播报开关的持久化。
 *
 * 状态为什么住在 host：真正出声的是 host（afplay / say），对话输入框里的扬声器按钮
 * 只是遥控器；而且组件在切换会话时会重挂载，客户端局部状态既留不住也传不回 host。
 *
 * 持久化用 **profile 目录下的状态文件**（照 `dsh-mermaid-comm/src/switch.ts` 的写法）：
 * 同步读、原子写、重启后仍在。不用插件 config 表单，是因为写 profile patch 会触发 HMR
 * 重载——每点一次按钮就重挂一次插件，请求会被打断。
 *
 * 三条路径依次尝试，都不可用就退化成进程内状态（功能照常，只是重启回默认值）：
 *   $DSH_PROFILE_DIR/broadcast/state.json → $DSH_HOME/broadcast/ → ~/.dsh/broadcast/
 */
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 状态文件里的内容。字段少而稳：将来加字段不影响老文件（读时逐字段兜底）。 */
export interface BroadcastState {
  /** 总开关：开=每轮结束自动播报。 */
  enabled: boolean
}

const STATE_FILE = 'state.json'

/** 只有一个布尔值，超过这个大小就是坏文件。 */
const MAX_STATE_BYTES = 8 * 1024

/** 解析状态目录：profile 优先（状态按部署隔离），最后退回用户级 ~/.dsh。 */
export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const profileDir = env['DSH_PROFILE_DIR']?.trim()
  if (profileDir) return join(profileDir, 'broadcast')
  const home = env['DSH_HOME']?.trim()
  if (home) return join(home, 'broadcast')
  const userHome = env['HOME']?.trim()
  if (userHome) return join(userHome, '.dsh', 'broadcast')
  return undefined
}

/** 状态文件的绝对路径；解析不出目录时为 undefined（= 放弃持久化）。 */
export function stateFilePath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = resolveStateDir(env)
  return dir === undefined ? undefined : join(dir, STATE_FILE)
}

/** 同步读已存状态：文件缺失/内容非法一律当作「没存过」。 */
export function readState(file: string | undefined): BroadcastState | undefined {
  if (file === undefined) return undefined
  try {
    const text = readFileSync(file, 'utf8')
    if (text.length > MAX_STATE_BYTES) return undefined
    const parsed = JSON.parse(text) as unknown
    if (parsed === null || typeof parsed !== 'object') return undefined
    const enabled = (parsed as { enabled?: unknown }).enabled
    return typeof enabled === 'boolean' ? { enabled } : undefined
  } catch {
    return undefined
  }
}

/** 原子写：先写同目录临时文件再 rename，避免读到半截 JSON。 */
export async function writeState(file: string | undefined, next: BroadcastState): Promise<void> {
  if (file === undefined) return
  const body = JSON.stringify({ enabled: next.enabled, updatedAt: new Date().toISOString() }) + '\n'
  const tmp = file + '.' + String(process.pid) + '.' + String(Date.now()) + '.tmp'
  await mkdir(dirname(file), { recursive: true })
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, file)
}

/** 对外的最小接口：同步读（判定要立刻拿到答案）、异步写。 */
export interface BroadcastSwitch {
  isEnabled(): boolean
  setEnabled(on: boolean): Promise<void>
}

/**
 * 建立开关：初值 = 持久化值 ?? 配置默认值；之后每次写先改进程内真值再落盘。
 * 落盘失败不影响本次生效（只是重启后回到旧值），所以只记日志。
 */
export function createSwitch(options: {
  fallback: boolean
  file?: string | undefined
  onPersistError?: (error: unknown) => void
}): BroadcastSwitch {
  const file = options.file ?? stateFilePath()
  const persisted = readState(file)
  let enabled = persisted?.enabled ?? options.fallback

  return {
    isEnabled: () => enabled,
    async setEnabled(next: boolean) {
      enabled = next
      try {
        await writeState(file, { enabled: next })
      } catch (error) {
        options.onPersistError?.(error)
      }
    },
  }
}
