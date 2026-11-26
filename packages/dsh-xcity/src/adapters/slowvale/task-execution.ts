import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentReportInput, World, Task } from '../../protocol/index.js'

interface TaskExecutionPorts {
  world(): World | null
  cwd: string
  settle(world: World, task: Task, result: { output: string } | { reason: string }): boolean
  sessions(): ReadonlyMap<string, string>
  available(sessionId: string, signal: AbortSignal): Promise<boolean>
  prompt(input: { requestId: string; sessionId: string; mode: 'queue'; content: { type: 'text'; text: string }[] }, signal: AbortSignal): Promise<unknown>
  onError?(error: unknown): void
}

/** Coordinate real session work without changing the saved task model. */
export function createTaskExecution(ports: TaskExecutionPorts) {
  const lifetime = new AbortController()
  type Delivery = { sessionId: string; taskId: string; requestId: string; evidence: string; active: boolean; turn?: number; startedTurn?: number; settled?: boolean }
  const sent = new WeakMap<World, Map<string, Delivery>>()
  const none: ReadonlySet<string> = new Set()
  let eligible: ReadonlySet<string> = none
  let sampledWorld: World | null = null
  let checking = false

  const heartbeat = async (): Promise<void> => {
    const world = ports.world()
    if (checking || world === null || world.paused || lifetime.signal.aborted) return
    checking = true
    eligible = none
    sampledWorld = null
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(5000)])
    try {
      if (!world.tasks.some((task) => task.externalId === null && (task.status === 'ready' || task.status === 'in_progress'))) return
      const sessions = ports.sessions()
      const attempts = sent.get(world) ?? new Map<string, Delivery>()
      sent.set(world, attempts)
      for (const id of attempts.keys()) {
        if (!world.tasks.some((task) => task.status === 'in_progress' && task.attemptId === id)) attempts.delete(id)
      }
      const next = new Set<string>()
      await Promise.all(world.agents.map(async (agent) => {
        const sessionId = sessions.get(agent.id)
        if (sessionId === undefined) return
        const task = agent.carrying === null ? undefined : world.tasks.find((row) => row.id === agent.carrying)
        const attempt = task?.attemptId
        if (agent.state !== 'idle' && (agent.state !== 'working' || task === undefined || !attempt || attempts.has(attempt))) return
        if (!await ports.available(sessionId, signal) || signal.aborted || ports.world() !== world || world.paused) return
        if (ports.sessions().get(agent.id) !== sessionId) return
        if (agent.state === 'idle' && agent.carrying === null && task === undefined) {
          next.add(agent.id)
          return
        }
        if (!task || !attempt || agent.state !== 'working' || agent.carrying !== task.id || task.status !== 'in_progress' ||
          task.owner !== agent.id || task.externalId !== null || task.attemptId !== attempt || attempts.has(attempt)) return
        // The host deduplicates by requestId across a retry or process restart. Never steer.
        const requestId = 'xcity-task:' + world.id + ':' + attempt
        const evidence = '.xcity-results/' + digest(requestId).slice(0, 24) + '.md'
        attempts.set(attempt, { sessionId, taskId: task.id, requestId, evidence, active: false })
        if (!missingArtifact(ports.cwd, evidence)) {
          ports.settle(world, task, { reason: '该工单代次已有交付文件，不能确认本轮执行。' })
          return
        }
        try {
          await ports.prompt({ requestId, sessionId, mode: 'queue', content: [{ type: 'text', text: taskPrompt(task, evidence) }] }, signal)
        } catch (error) {
          // Acceptance can be uncertain when transport fails. Do not dispatch another turn blindly.
          ports.onError?.(error)
        }
      }))
      if (!signal.aborted && ports.world() === world) {
        sampledWorld = world
        eligible = next
      }
    } catch (error) {
      ports.onError?.(error)
    } finally {
      checking = false
    }
  }

  return {
    heartbeat,
    observe(sessionId: string, type: string | undefined, data: Record<string, unknown> | undefined): void {
      const world = ports.world()
      if (!world || lifetime.signal.aborted) return
      const source = data?.['source'] as { kind?: unknown; rpcId?: unknown } | undefined
      const turn = typeof data?.['turn'] === 'number' ? data['turn'] : undefined
      for (const [attempt, delivery] of sent.get(world) ?? []) {
        if (delivery.sessionId !== sessionId || delivery.settled) continue
        if (type !== 'turn/end' && turn !== undefined) delivery.turn = turn
        if (type === 'user/message' && source?.kind !== 'runtime-context') {
          if (delivery.startedTurn === undefined && source?.rpcId === delivery.requestId && delivery.turn !== undefined) {
            delivery.startedTurn = delivery.turn
            delivery.active = true
          } else {
            delivery.active = false
          }
        }
        if (type !== 'turn/end' || turn === undefined || turn !== delivery.startedTurn) continue
        delivery.active = false
        const task = world.tasks.find((row) => row.id === delivery.taskId && row.attemptId === attempt && row.status === 'in_progress')
        if (!task || task.externalId !== null || task.owner === null || ports.sessions().get(task.owner) !== sessionId) continue
        try {
          delivery.settled = ports.settle(world, task, { reason: 'DSH 任务轮次结束，未收到有效交付。' })
        } catch (error) {
          ports.onError?.(error)
        }
      }
    },
    report(sessionId: string, input: AgentReportInput): { accepted: boolean; reason?: string } {
      const world = ports.world()
      const task = world?.tasks.find((row) => row.id === input.taskId)
      const delivery = world && task?.attemptId ? sent.get(world)?.get(task.attemptId) : undefined
      if (!world || !task || task.externalId !== null || task.status !== 'in_progress' || task.owner === null ||
        ports.sessions().get(task.owner) !== sessionId || delivery?.sessionId !== sessionId || !delivery.active || delivery.settled || delivery.turn !== delivery.startedTurn || lifetime.signal.aborted) {
        return { accepted: false, reason: '只能汇报当前会话收到的活跃工单代次。' }
      }
      if (input.summary.trim() === '') return { accepted: false, reason: '汇报结论不能为空。' }
      if (input.status === 'working') return { accepted: true }
      const artifact = input.status === 'done' && input.evidence?.includes(delivery.evidence)
        ? artifactDigest(ports.cwd, delivery.evidence) : null
      if (input.status === 'done' && artifact === null) return { accepted: false, reason: '缺少本工单代次的有效交付文件：' + delivery.evidence }
      if (!ports.settle(world, task, artifact === null ? { reason: input.summary } : {
        output: input.summary + '\n' + delivery.evidence + ' (SHA-256: ' + artifact + ')',
      })) return { accepted: false, reason: '工单裁决未被接受。' }
      delivery.active = false
      delivery.settled = true
      return { accepted: true }
    },
    workers(world: World): ReadonlySet<string> {
      return sampledWorld === world ? eligible : none
    },
    stop(): void { lifetime.abort(); eligible = none; sampledWorld = null },
  }
}

function taskPrompt(task: Task, evidence: string): string {
  return [
    '请执行你在 XCity 已认领的工单 ' + task.id + '。',
    '标题：' + task.title,
    '描述：' + task.description,
    '在你的工作区写入实际交付文件 ' + evidence + '，然后调用 xcity_report，evidence 填该相对路径。',
    '没有可交付的结果就汇报 blocked，不要用口头确认冒充产出。',
  ].join('\n')
}

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function missingArtifact(cwd: string, relative: string): boolean {
  try {
    lstatSync(join(cwd, relative))
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

function artifactDigest(cwd: string, relative: string): string | null {
  let fd: number | undefined
  try {
    const root = realpathSync(cwd)
    const file = join(root, relative)
    const parent = dirname(file)
    if (realpathSync(parent) !== parent) return null
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const info = fstatSync(fd)
    if (!info.isFile() || info.nlink !== 1 || info.size === 0 || info.size > 1024 * 1024) return null
    const body = Buffer.alloc(info.size)
    const bytes = readSync(fd, body, 0, body.length, 0)
    if (bytes !== body.length || !body.toString('utf8').trim()) return null
    return digest(body)
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
