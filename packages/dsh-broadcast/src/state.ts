/**
 * 播报的可持久化状态：开关 + 选中的音色。
 *
 * 状态为什么住在 host：真正出声的是 host（afplay / say），对话输入框里的按钮只是遥控器；
 * 组件在切换会话时会重挂载，客户端局部状态既留不住也传不回 host。
 *
 * 持久化用 **状态文件**（照 `dsh-mermaid-comm/src/switch.ts` 的写法）：同步读、原子写、重启后仍在。
 * 不用插件 config 表单，是因为写 profile patch 会触发 HMR 重载——每点一次按钮就重挂一次插件。
 *
 * 三条路径依次尝试，都不可用就退化成进程内状态（功能照常，只是重启回默认值）：
 *   $DSH_PROFILE_DIR/broadcast/state.json → $DSH_HOME/broadcast/ → ~/.dsh/broadcast/
 */
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 状态文件里的内容。逐字段兜底，加字段不会让老文件作废。 */
export interface BroadcastState {
  /** 总开关：开=每轮结束自动播报。 */
  enabled: boolean
  /** 选中的音色 id（'baidu' / 'say:xxx'）；空串 = 默认在线音色。 */
  voiceId: string
}

const STATE_FILE = 'state.json'

/** 只有两个字段，超过这个大小就是坏文件。 */
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

/**
 * 同步读已存状态。文件缺失/内容非法一律当作「没存过」；
 * 单个字段类型不对时只丢那一个字段，不整份作废（换代加字段时不至于把开关也丢了）。
 */
export function readState(file: string | undefined): Partial<BroadcastState> | undefined {
  if (file === undefined) return undefined
  try {
    const text = readFileSync(file, 'utf8')
    if (text.length > MAX_STATE_BYTES) return undefined
    const parsed = JSON.parse(text) as unknown
    if (parsed === null || typeof parsed !== 'object') return undefined
    const record = parsed as { enabled?: unknown; voiceId?: unknown; sayVoice?: unknown }
    const state: Partial<BroadcastState> = {}
    if (typeof record.enabled === 'boolean') state.enabled = record.enabled
    if (typeof record.voiceId === 'string') state.voiceId = record.voiceId
    // 老文件里存的是裸的 say 名字，迁移成 'say:xxx'
    else if (typeof record.sayVoice === 'string' && record.sayVoice !== '') state.voiceId = `say:${record.sayVoice}`
    return Object.keys(state).length === 0 ? undefined : state
  } catch {
    return undefined
  }
}

/** 原子写：先写同目录临时文件再 rename，避免读到半截 JSON。 */
export async function writeState(file: string | undefined, next: BroadcastState): Promise<void> {
  if (file === undefined) return
  const body = JSON.stringify({ ...next, updatedAt: new Date().toISOString() }) + '\n'
  const tmp = file + '.' + String(process.pid) + '.' + String(Date.now()) + '.tmp'
  await mkdir(dirname(file), { recursive: true })
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, file)
}

/** 对外的最小接口：同步读（判定要立刻拿到答案）、异步写。 */
export interface StateStore {
  get(): BroadcastState
  /** 合并写：只改给出的字段，其余保持。 */
  set(patch: Partial<BroadcastState>): Promise<void>
}

/**
 * 建立状态存储：初值 = 持久化值 ?? 构造时给的默认值；之后每次写先改进程内真值再落盘。
 * 落盘失败不影响本次生效（只是重启后回到旧值），所以只回调报错。
 */
export function createStateStore(options: {
  fallback: BroadcastState
  file?: string | undefined
  onPersistError?: (error: unknown) => void
}): StateStore {
  const file = options.file ?? stateFilePath()
  const persisted = readState(file)
  let current: BroadcastState = { ...options.fallback, ...(persisted ?? {}) }

  return {
    get: () => current,
    async set(patch: Partial<BroadcastState>) {
      current = { ...current, ...patch }
      try {
        await writeState(file, current)
      } catch (error) {
        options.onPersistError?.(error)
      }
    },
  }
}
