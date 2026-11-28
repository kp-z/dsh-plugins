/**
 * dsh-xcity —— host 入口。
 *
 * 装配逻辑一句话：**内容、世界、模拟循环必挂，界面可选**。
 * - `tools` 是硬依赖：没有工具注册表，模型无法与世界交互，这个插件就没有意义。
 * - `webServer`（M3-3 之后）会用 `ctx.inject` 按需等待：没有它时世界照跑，只是没有 3D 面板。
 *   把"模拟能力"与"展示能力"解耦，是为了让世界不依赖宿主是否恰好挂了 HTTP 服务。
 *
 * 当前进度（R7）：内容库层 + 契约层 + 模拟内核 + 运行时（**世界会动了**）。
 * 落盘与 HTTP/SSE 见 BACKLOG M3，3D 面板见 M4。
 * 架构见 docs/ARCHITECTURE.md，内容模型见 docs/CONTENT.md，协议见 docs/PROTOCOL.md。
 */
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  buildCharacterSystemPrompt,
  createDshCharacterBridge,
  createSessionEventFeed,
  createSessionTransport,
  createTeamsCaptain,
  createTeamsPort,
  readDefaultModelSelection,
  seatForAgent,
  toLazyDialoguePort,
} from './bridge/index.js'
import type { DispatchOutcome, WorldServicePort } from './protocol/index.js'
import type { World } from './domain/types.js'
import type { AgentReportInput, AgentReportPort, AgentReportResult } from './protocol/index.js'
import type { TeamsPort } from './bridge/index.js'
import type { CharacterBridge } from './bridge/index.js'
import { type AgentWorldConfig, resolveConfig } from './config.js'
import { resolveContentRoot } from './content/load-files.js'
import { createHandler } from './routes/index.js'
import type { DialogueChannel } from './routes/dialogue.js'
import { createEventHub, createRuntime } from './runtime/index.js'
import { planTeamSync, startActivity } from './sim/index.js'
import { createWorldStore } from './store/index.js'
import { skillForTool } from './sim/tool-skill.js'
import { intentStats } from './sim/intent-stats.js'
import { summarizeDay } from './sim/day-summary.js'
import { createPluginState } from './state.js'
import { createSlowvaleBridge, type Bridge } from './adapters/slowvale/index.js'
import { shouldRestartWorld } from './runtime/watchdog.js'
import { characterOfSession, loadAgentMap, loadXcityBindings, sessionsByAgent } from './adapters/slowvale/xcity.js'
import { respondViaSession } from './adapters/slowvale/respond-sms.js'
import { deliverInitiative } from './adapters/slowvale/initiative-delivery.js'
import { createSessionAsker } from './adapters/slowvale/ask-session.js'
import { createDailyPlanner } from './bridge/daily-plan.js'
import { createPlanStats } from './runtime/plan-stats.js'
import { createTurnCost, DEFAULT_WARN_INPUT_CHARS } from './runtime/turn-cost.js'
import { buildPlanPrompt, parsePlan, planMemories } from './bridge/plan-prompt.js'
import { renderMemoryContext } from './bridge/memory-context.js'
import { acquireOwnerLock } from './runtime/owner-lock.js'
import { scoreEpisode, selectEpisodes } from './sim/memory.js'
import { promiseBetween, settleCommitments } from './sim/commitments.js'
import { actorForSession, activityForEvent, createSmsReplyTracker, textOfBlocks } from './adapters/slowvale/session-events.js'
import { directiveToCommand, parseDirective } from './adapters/slowvale/directive.js'
import { DEFAULT_CIRCUIT, spawnOf } from './adapters/slowvale/stage.js'
import { spawnCharacterSession } from './adapters/slowvale/spawn.js'
import { createTaskExecution } from './adapters/slowvale/task-execution.js'
import { hasXcityRoleModel, isIdleSession } from './bridge/dsh-adapter.js'
import { createPersonaStore } from './persona/store.js'
import { awardStudyXp } from './persona/study.js'
import { registerDispatchTool } from './tools/dispatch.js'
import { registerReportTool } from './tools/report.js'
import { registerWorldTools } from './tools/world.js'

/** Loader entry id（kebab-case，全局唯一，配置覆盖靠它定位）。 */
/** 会话侧要说话时用的桥句柄（回复方向：会话 → 游戏短信）。 */
let slowvaleBridgeHandle: Bridge | null = null

export const name = 'xcity'

/**
 * 硬依赖：模型可见工具注册表。
 * 不写运行时兜底——缺它就 fail-loud，符合本仓库 docs/DEVELOPMENT.md §2 的约定。
 */
export const inject = ['tools']

/**
 * 插件入口。
 *
 * @param ctx - cordis 上下文。
 * @param config - Loader 传进来的**原始**配置（schema default 不会被自动填充，故走 resolveConfig）。
 */
/** 从 agent/error 的负载里尽量取出会话 id（不同版本形状不同）。 */
function this_agentId(record: Record<string, unknown>): string | undefined {
  const a = record['agent'] as { id?: unknown } | undefined
  return typeof a?.id === 'string' ? a.id : undefined
}

export function apply(ctx: Context, config: Partial<AgentWorldConfig> = {}): void {
  const resolved = resolveConfig(config)
  const personaStore = createPersonaStore(join(resolved.stateDir, 'personas.json'))
  // R446：调试数据只写文件，不上正式面板。JSONL，排查时直接 tail。
  const debugLogPath = join(resolved.stateDir, 'debug.jsonl')
  const debugLog = (scope: string, payload: Record<string, unknown>): void => {
    try {
      // 2MB 轮转：调试日志不能无限增长把工作区写满。
      if (existsSync(debugLogPath) && statSync(debugLogPath).size > 2_000_000) {
        renameSync(debugLogPath, `${debugLogPath}.1`)
      }
      appendFileSync(debugLogPath, `${JSON.stringify({ ts: new Date().toISOString(), scope, ...payload })}\n`)
    } catch { /* 调试日志失败不能影响世界 */ }
  }
  const logger = ctx.logger('agent-world')

  // 外部内容目录的解析结果要**原样打出来**：用户配了 contentDir 却没生效时，
  // 第一个问题永远是"它到底去读哪个目录了"。
  const contentRoot = resolveContentRoot(resolved.contentDir, process.cwd())
  if (contentRoot.root !== null) {
    logger.info(`外部内容目录：${contentRoot.root}（${contentRoot.reason}）`)
  }

  // 存档目录：`stateDir` 目前按 `process.cwd()` 解析（与 contentDir 同一个基准，
  // 而"相对哪个 workspace"这件事是 M1.5-6 的待定项——多工作区时任何自动挑选都是猜）。
  // 把解析结果**原样打出来**：写盘位置是用户第一个会问的问题。
  const storeDir =
    resolved.persistEveryTicks > 0 ? resolve(process.cwd(), resolved.stateDir) : null
  if (storeDir !== null) logger.info(`世界存档目录：${storeDir}`)

  // R166 Phase C：旧的**全局** world.json 不再参与会话世界。归档它，不删；
  // 每个会话的世界在 `storeDir/sessions/<会话编码>/world.json`。
  if (storeDir !== null) {
    const legacy = join(storeDir, 'world.json')
    const archive = join(storeDir, 'world.legacy.json')
    try {
      if (existsSync(legacy) && !existsSync(archive)) {
        renameSync(legacy, archive)
        logger.info(`已归档旧的全局世界：${archive}`)
      }
    } catch (error) {
      logger.warn(`归档旧全局世界失败（不影响会话世界）：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 小镇是**一个**世界，不该按会话切成「只有队长一个人」的开局。
  // 之前用默认 'captain'：一旦激活某条会话，世界被重建，只剩 1 个 agent（工位、任务、街区全没了），
  // 游戏里看着就是「人没了、活不干」。这里显式要完整开局。
  // 城市：地点表来自前端规则表能命中的那些 place id，入口点来自镜像地图。
  // 没有入口点的（地图里没标 spawn）退回场景原点——宁可站在 0,0，也不要少一个地点。
  // 入口点从**镜像站**的地图里读（assets/maps/<asset>/interactions.json 的 class:"spawn"），
  // 不是内容包目录——那是两回事。
  const slowvaleAssets = resolve(process.cwd(), resolved.slowvale.assetsDir)
  const cityPlaces = DEFAULT_CIRCUIT.map((spec) => ({
    id: spec.id,
    name: spec.label,
    asset: spec.asset,
    spawn: spawnOf(slowvaleAssets, spec.asset) ?? { x: 0, z: 0 },
  }))
  const state = createPluginState(resolved, {
    externalRoot: contentRoot.root,
    storeDir,
    sessionInitialAgents: 'all',
    places: cityPlaces,
    // R520：存档被裁必须看得见——不然"我的角色怎么忘事"只能靠猜。
    log: (line) => logger.info(line),
  })
  /** R175：sessionQuery 是软依赖；先 inject 捕获，避免请求时 ctx.get 拿不到。 */
  let sessionQueryService:
    | { readSession?(id: string): Promise<unknown> }
    | undefined
  let sessionControllerService:
    | { prompt?(request: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
    inspect?(sessionId: string, signal?: AbortSignal): Promise<{ events?: readonly { type?: string; time?: number; data?: Record<string, unknown> }[] }> }
    | undefined
  // 建会话 / 挂工作区：cove-task 用的就是这两个服务（agents.create + workspaceRegistry）。
  // 都是软依赖——没有它们，世界照跑，只是不能自己开会话。
  let workspaceRegistryService: { resolveByPath?: (path: string) => Promise<unknown> } | null = null
  ctx.inject(['workspaceRegistry'], (host) => {
    workspaceRegistryService = (host as { workspaceRegistry?: typeof workspaceRegistryService }).workspaceRegistry ?? null
  })

  ctx.inject(['sessionController'], (host) => {
    sessionControllerService = (host as unknown as {
      sessionController?: { prompt?(request: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
    inspect?(sessionId: string, signal?: AbortSignal): Promise<{ events?: readonly { type?: string; time?: number; data?: Record<string, unknown> }[] }> }
    }).sessionController
  })
  ctx.inject(['sessionQuery'], (host) => {
    sessionQueryService = (host as unknown as {
      sessionQuery?: { readSession?(id: string): Promise<unknown> }
    }).sessionQuery
  })
  let agentsService: { get?(id: string): { id?: string } | undefined } | undefined
  let agentTeamsService:
    | {
        membership?(agent: { id?: string }): unknown
        listMembers?(agent: { id?: string }): unknown
        listTasks?(agent: { id?: string }): unknown
        sendMessage?(
          caller: { id?: string },
          request: { target: string; content: readonly unknown[]; signal: AbortSignal },
        ): Promise<unknown>
        createTask?(caller: { id?: string }, request: Record<string, unknown>): Promise<unknown>
        updateTask?(caller: { id?: string }, request: Record<string, unknown>): Promise<unknown>
      }
    | undefined
  ctx.inject(['agents', 'agentTeams'], (host) => {
    const h = host as unknown as {
      agents?: { get?(id: string): { id?: string } | undefined }
      agentTeams?: {
        membership?(agent: { id?: string }): unknown
        listMembers?(agent: { id?: string }): unknown
        listTasks?(agent: { id?: string }): unknown
      }
    }
    agentsService = h.agents
    agentTeamsService = h.agentTeams
  })

  // ── D41/R43：把小镇的工单接到 agent-teams 的任务上 ────────────────────────────
  //
  // 两件事：
  // ① **派单时同时在团队里建任务**：小镇的工单是"投影"（谁在哪、什么时候到），
  //    团队的任务才是"谁做什么、做完没有"。所以要成对创建，再把两张单对应起来。
  // ② **轮询团队状态并同步回小镇**：团队说"派给谁了/做完了/失败了" → 算成命令 → 进世界。
  //
  // 两边都**只通过命令改世界**（`taskLink` / `taskAssign` / `taskComplete` / `taskFail`），
  // 命令照旧进 journal，所以回放仍然确定（D41 ③）。
  const TEAM_SYNC_INTERVAL_TICKS = 20
  let lastTeamSyncTick = -1
  let teamSyncBusy = false
  let teamSyncErrors = 0

  /**
   * 派单的"团队侧"：为刚建出来的小镇工单在团队里建对应任务，并回填对应关系。
   *
   * 依赖关系要**映射**：小镇的 `blockedBy` 是小镇 id（`task-3`），团队要的是团队 id（`t3`）。
   * 所以先建没有依赖的、记下映射，再建依赖它们的——按 `blockedBy` 的拓扑序建。
   */
  const linkNewTasksToTeam = async (addedTaskIds: readonly string[]): Promise<void> => {
    // 有 Agent World 视图时不接管团队；团队任务归 native plan。
    if (state.activeSessionId !== null) return
    const world = state.currentWorld()
    if (world === null || addedTaskIds.length === 0) return
    const port = acquireTeamsPort()
    if (!port.ok) return
    const added = new Set(addedTaskIds)
    const localToTeam = new Map<string, string>()
    let pending = world.tasks.filter((t) => added.has(t.id))

    // 最多转 N 轮：每轮建"依赖都已映射好"的那些。有环或跨集合依赖时剩下的会被跳过（内容校验本来就禁环）。
    // ⚠️ 上界必须在循环**外**算（R43 真机抓到）：`pending` 在循环里会缩短，拿它当上界的话
    // 三张单的流水线只建了两张——第三张被提前截断，而且不报错。
    const maxRounds = pending.length
    for (let round = 0; round < maxRounds && pending.length > 0; round += 1) {
      const ready = pending.filter((t) => t.blockedBy.every((dep) => !added.has(dep) || localToTeam.has(dep)))
      if (ready.length === 0) break
      for (const task of ready) {
        const teamId = await port.port.createTask({
          subject: task.title,
          description: task.description,
          dependencies: task.blockedBy.map((dep) => localToTeam.get(dep)).filter((id): id is string => id !== undefined),
        })
        localToTeam.set(task.id, teamId)
        runtime.enqueue({ kind: 'taskLink', taskId: task.id, externalId: teamId })
      }
      pending = pending.filter((t) => !localToTeam.has(t.id))
    }
  }

  /** 把团队状态同步回小镇。一轮只发一次命令，失败只记日志不打断世界。 */
  const syncTeamOnce = async (): Promise<void> => {
    // 有 Agent World 视图时不接管团队；世界任务板只显示 native 产物（后续接入）。
    if (state.activeSessionId !== null) return
    if (teamSyncBusy) return
    const world = state.currentWorld()
    if (world === null) return
    const port = acquireTeamsPort()
    if (!port.ok) return
    teamSyncBusy = true
    try {
      const rows = await port.port.readTasks()
      const commands = planTeamSync({
        tasks: rows.map((r) => ({
          id: r.id,
          subject: r.subject,
          status: r.status,
          ...(r.assignee === '' ? {} : { assignee: r.assignee }),
          dependencies: r.dependencies,
          ...(r.output === '' ? {} : { output: r.output }),
          ...(r.attemptId === '' ? {} : { attemptId: r.attemptId }),
        })),
        worldTasks: world.tasks.map((t) => ({
          id: t.id,
          externalId: t.externalId,
          status: t.status,
          owner: t.owner,
          attemptId: t.attemptId,
        })),
        agentIdForMember: (name: string) => world.agents.find((a) => a.name === name)?.id ?? null,
      })
      for (const command of commands) runtime.enqueue(command)
    } catch (error) {
      teamSyncErrors += 1
      // 同步失败不该打断世界：世界继续跑，只是这一轮没跟上团队。
      if (teamSyncErrors <= 3) {
        logger.warn(`团队任务同步失败（第 ${teamSyncErrors} 次，世界继续跑）：${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      teamSyncBusy = false
    }
  }

  // 内容层的问题不阻断插件加载——照 dsh-daily 的做法：
  // 插件树加载失败会让**整个 dsh 起不来**，那个代价远大于"世界暂时建不出来"。
  const errors = state.issues().filter((i) => i.level === 'error')
  if (errors.length > 0) {
    const detail = errors
      .slice(0, 5)
      .map((e) => `[${e.where}] ${e.message}`)
      .join('；')
    logger.error(
      `内容层有 ${errors.length} 个错误，世界不会被创建（插件仍可用，xcity_status 会列出细节）：${detail}`,
    )
    return
  }

  const warnings = state.issues().filter((i) => i.level === 'warning')
  if (warnings.length > 0) {
    logger.warn(
      `内容层有 ${warnings.length} 个警告：${warnings.slice(0, 3).map((w) => `[${w.where}] ${w.message}`).join('；')}`,
    )
  }

  // R509：一个 stateDir 只许一个推进者。角色会话也是会话，插件会在它们身上再加载一次；
  // 不设闩就会各跑一套循环、各自存盘，互相覆盖（H6 现场：tick 倒退、派单消失）。
  const ownerLock = acquireOwnerLock(resolve(resolved.stateDir))
  if (!ownerLock.owned) {
    logger.warn(
      `世界已由进程 ${String(ownerLock.ownerPid ?? '未知')} 推进；本会话只读，不推进、不占端口（R509）。`,
    )
  }

  // 世界先建出来（这样 xcity_status 立刻有东西可看）。
  // **注意 `ensureWorld()` 会先试着接回上次的存档**——所以下面这句日志之前世界可能已经不是新的了。
  // `autoStart` 只决定**要不要开始推进**——配置的语义是"是否推进"，不是"是否存在"。
  try {
    state.ensureWorld()
  } catch (error) {
    logger.error(`建世界失败（已忽略，不影响 dsh 启动）：${error instanceof Error ? error.message : String(error)}`)
    return
  }

  // 事件广播：运行时往里**推**，SSE 订阅者往里**取**。同一个对象两副面孔。
  const hub = createEventHub()

  const bindingsPath = resolve(resolved.slowvale.bindingsFile)
  const characterWorkspace = dirname(bindingsPath)
  const taskExecution = resolved.slowvale.enabled && ownerLock.owned ? createTaskExecution({
    world: () => state.currentWorld(),
    cwd: characterWorkspace,
    sessions: () => sessionsByAgent(loadXcityBindings(bindingsPath), loadAgentMap(join(characterWorkspace, 'agents.json'))),
    available: async (sessionId, signal) => {
      if (typeof sessionControllerService?.prompt !== 'function' || !hasXcityRoleModel(ctx, sessionId)) return false
      return await isIdleSession(ctx, sessionId, signal)
    },
    prompt: async (request, signal) => {
      if (typeof sessionControllerService?.prompt !== 'function' || !hasXcityRoleModel(ctx, request.sessionId)) {
        throw new Error('角色会话未选定指定模型或会话服务已不可用。')
      }
      await sessionControllerService.prompt(request, signal)
    },
    start: (world, agent, task) => {
      if (task.attemptId === null) return
      startActivity(world, agent, {
        kind: 'work', ticks: 0, stationId: agent.station,
        taskAttemptId: task.attemptId,
        trigger: { kind: 'task', text: '开始执行工单「' + task.title + '」' },
      })
      delete agent.activityTrigger
    },
    settle: (world, task, result) => {
      if (state.currentWorld() !== world || task.attemptId === null) return false
      const identity = { taskId: task.id, attemptId: task.attemptId }
      runtime.enqueue('output' in result
        ? { kind: 'taskComplete', ...identity, output: result.output }
        : { kind: 'taskFail', ...identity, reason: result.reason }, world)
      return true
    },
    onError: (error) => logger.warn('XCity 工单投递未确认：' + String(error)),
  }) : null
  if (taskExecution !== null) ctx.effect(() => () => taskExecution.stop(), 'xcity: task execution')
  let nextTaskHeartbeat = 0

  // R502：计划计数（问了几次、卡在哪一门、落了几条）。挂在 /api/world 上可读。
  const planStats = createPlanStats()

  // R517：每轮输入体积计数（user/message 文本 + 工具结果字符数）。和计划计数一样只读，
  // 阈值写在这里是为了接线处能一眼看到"线"在哪；语义与"不是计费"的说明见 turn-cost.ts。
  const turnCost = createTurnCost({ warnInputChars: DEFAULT_WARN_INPUT_CHARS })

  // R500：每天 06:30 各自想一下今天。投递走会话，取回走 assistant 原文（见 ask-session）。
  const planAsker = createSessionAsker({
    onFailure: (reason, message) => {
      if (reason === 'timeout') planStats.timeout += 1
      else {
        planStats.promptError += 1
        if (message !== undefined) planStats.lastPromptError = message.slice(0, 300)
      }
    },
    prompt: async (payload, signal) => {
      if (typeof sessionControllerService?.prompt !== 'function') throw new Error('宿主没有会话服务')
      await sessionControllerService.prompt(payload as never, signal)
    },
  })
  const dailyPlanner = createDailyPlanner({
    ask: async (agentId, prompt) => {
      const world = state.currentWorld()
      if (world === null) return null
      const sessionId = sessionsByAgent(loadXcityBindings(bindingsPath), loadAgentMap(join(characterWorkspace, 'agents.json'))).get(agentId)
      if (sessionId === undefined) {
        planStats.noBinding += 1
        logger.warn('[xcity-plan] 跳过 agent=' + agentId + '：没有绑定会话')
        return null
      }
      if (!hasXcityRoleModel(ctx, sessionId)) {
        planStats.noModel += 1
        logger.warn('[xcity-plan] 跳过 agent=' + agentId + '：会话没选模型 session=' + sessionId)
        return null
      }
      if (typeof sessionControllerService?.prompt !== 'function') {
        planStats.noService += 1
        logger.warn('[xcity-plan] 跳过 agent=' + agentId + '：宿主没有会话服务')
        return null
      }
      // 会话正在跑别的轮次（主动短信/工单）时不要挤进去：挤进去只会互相打断。
      if (!(await isIdleSession(ctx, sessionId, new AbortController().signal))) {
        planStats.busy += 1
        return null
      }
      planStats.asked += 1
      const answer = await planAsker.ask(sessionId, prompt)
      if (answer === null) planStats.failed += 1
      else planStats.answered += 1
      return answer
    },
    promptFor: (agentId, day) => {
      const world = state.currentWorld()
      const agent = world?.agents.find((row) => row.id === agentId)
      const peers = (world?.agents ?? []).filter((row) => row.id !== agentId).map((row) => ({ id: row.id, name: row.name }))
      // R516：昨天的日小结（00:00 那一刻写的，属于前一天）。没有就省略整段。
      const yesterday = (agent?.episodes ?? [])
        .filter((episode) => episode.kind === 'day' && episode.day === day - 1)
        .map((episode) => episode.summary)
        .join(' ')
      const nowTick = world?.tick ?? day * 1440
      return buildPlanPrompt({
        agentName: agent?.name ?? agentId,
        // R516：persona 一直是空串，模型每次都读到空的「## 你是谁」。先用角色+性格顶上，
        // 不新造字段——traits 是我们已经有的东西。
        persona: agent === undefined
          ? ''
          : '角色：' + agent.role + '；干活劲头 ' + String(Math.round((agent.traits?.diligence ?? 0.5) * 100)) + '/100' +
            '；责任心 ' + String(Math.round((agent.traits?.duty ?? 0.5) * 100)) + '/100',
        todaySummary: world === null ? [] : summarizeDay(world, agentId, world.tick),
        yesterday,
        // R524：昨天以前的记忆。「更多」不等于「更好」：全量塞会直接顶到每轮输入的预算上
        // （H14 实测增量输入 p95 16k 字符），所以只取最相关的几条，打分与 Top-K 仍走
        // sim/memory.ts（与对话里那份记忆是同一份打分，不另写一套检索）。
        memories: planMemories({ episodes: agent?.episodes ?? [], nowTick, selectEpisodes }),
        knownPeers: peers,
        nowTick,
      })
    },
    parse: (text, agentId) => {
      const world = state.currentWorld()
      if (world === null) return []
      const peers = world.agents.filter((row) => row.id !== agentId).map((row) => row.id)
      return parsePlan(text, { nowTick: world.tick, agentId, peerIds: peers }).commitments
    },
    apply: (agentId, commitments) => {
      const world = state.currentWorld()
      if (world === null) return
      for (const row of commitments) {
        // 暂时不落"对自己"的承诺：没有对方可写，宁可少一条也不编一个对象。
        if (row.with === '') continue
        if (promiseBetween(world, agentId, row.with, { what: row.what, dueTick: row.dueTick, source: 'plan' }) !== null) {
          planStats.applied += 1
        }
      }
    },
    log: (line) => logger.info(line),
  })
  const runtime = createRuntime({
    service: state,
    tickMs: state.tickMs,
    idleActionsEnabled: resolved.idleActionsEnabled,
    // R476：角色按钟点自己生活（上班去工位）。没有模式开关，永远开着。
    selfLifeEnabled: true,
    sink: hub,
    ...(taskExecution === null ? {} : { sessionWorkers: taskExecution.workers }),
    ...(storeDir === null
      ? {}
      : {
          persist: {
            store: createWorldStore(storeDir),
            checkpointEveryTicks: resolved.persistEveryTicks,
            log: (line) => logger.info(line),
          },
        }),
    onError: (error) =>
      logger.error(`模拟循环出错（已继续，诊断计数见 errors）：${error instanceof Error ? error.message : String(error)}`),
    // D41/R43：每隔一段 tick 把团队状态同步回小镇。**同步返回**（见 onTick 说明），
    // 真正的读与算丢给一个不等待的 promise。
    onTick: (tick) => {
      // R500：到点问计划；到期承诺由内核裁决（不做 IO）。
      const world = state.currentWorld()
      if (world !== null) {
        dailyPlanner.tick(world.agents, tick)
        if (tick % 60 === 0) settleCommitments(world, tick)
      }
      if (taskExecution !== null && Date.now() >= nextTaskHeartbeat) {
        nextTaskHeartbeat = Date.now() + 1000
        void taskExecution.heartbeat()
      }
      if (tick - lastRosterSyncTick >= TEAM_SYNC_INTERVAL_TICKS) {
        lastRosterSyncTick = tick
        void syncRoster()
        syncPersonaProgress(state.currentWorld() ?? ({ agents: [], tasks: [] } as never))
      }
      if (tick - lastTeamSyncTick < TEAM_SYNC_INTERVAL_TICKS) return
      lastTeamSyncTick = tick
      void syncTeamOnce()
    },
  })

  /**
   * R353：任务完成 → Persona 关联 + XP。
   *
   * 只在“这张单第一次进入 persona.taskIds”时结算，所以刷新/重放不会重复加经验。
   * 数据仍在 personaStore 里，不另造一套成就表。
   */
  function syncPersonaProgress(world: World): void {
    const roleSkills: Record<string, string[]> = {
      lead: ['协调', '计划'],
      engineer: ['写代码', '调试'],
      researcher: ['检索', '分析'],
      reviewer: ['评审', '验收'],
      ops: ['部署', '监控'],
      docs: ['写作', '整理'],
    }
    for (const agent of world.agents) {
      const key = agent.boundAgentId ?? agent.id
      if (personaStore.get(key) === null) {
        personaStore.upsert({ id: key, name: agent.name, role: agent.role, skills: roleSkills[agent.role] ?? [agent.role] })
      } else if ((personaStore.get(key)?.skills.length ?? 0) === 0) {
        // 老存档里的 persona 没有技能；按当前角色回填，不要求用户重开世界。
        personaStore.upsert({ id: key, skills: roleSkills[agent.role] ?? [agent.role] })
      }
    }
    for (const task of world.tasks) {
      if (task.owner === null) continue
      const agent = world.agents.find((candidate) => candidate.id === task.owner)
      if (agent === undefined) continue
      const key = agent.boundAgentId ?? agent.id
      personaStore.linkTask(key, task.id)
      const persona = personaStore.get(key)
      if (task.status === 'done' && persona !== null && !persona.awardedTaskIds.includes(task.id)) {
        personaStore.awardTask(key, task.id, 40)
      }
    }
  }

  /**
   * R166：把**当前会话**的真实 subagent 子会话投影成镇上角色。
   *
   * 只读 `subagents.listChildren(sessionId)`；没有子会话时镇上只有队长。
   * 失败不抛（subagents 服务可能还没挂上）；下一次 tick 再试。
   */
  let rosterSyncBusy = false
  let lastRosterSyncTick = -1
  const syncRoster = async (): Promise<void> => {
    const sessionId = state.activeSessionId
    if (sessionId === null || rosterSyncBusy) return
    const subagents = (ctx as unknown as { get(name: string): unknown }).get('subagents') as
      | { listChildren?(parentSessionId: string, signal?: AbortSignal): Promise<readonly { id: string; label?: string }[]> }
      | undefined
    if (typeof subagents?.listChildren !== 'function') return
    rosterSyncBusy = true
    try {
      // experimental 的 Lead 就是会话本身；旧 agent-teams 才用派生队长。
      const experimental = typeof agentTeamsService?.listMembers === 'function'
      const parent = experimental ? sessionId : captainSessionIdFor(sessionId)
      const children = await subagents.listChildren(parent)
      const merged = [...children]
      if (experimental) {
        const lead = agentsService?.get?.(sessionId)
        const members = lead === undefined ? [] : (agentTeamsService?.listMembers?.(lead) ?? []) as readonly { id?: unknown; name?: unknown }[]
        const known = new Set(merged.map((child) => child.label?.slice(child.label.lastIndexOf(':') + 1)))
        for (const member of members) {
          const name = typeof member.name === 'string' ? member.name : ''
          if (name === '' || name === 'lead' || name === 'captain' || known.has(name)) continue
          merged.push({ id: typeof member.id === 'string' ? member.id : name, label: `agent-teams:${name}` })
        }
      }
      const leadMember = experimental ? (agentTeamsService?.listMembers?.(agentsService?.get?.(sessionId)!) as readonly { role?: unknown; name?: unknown }[] | undefined)?.find((m) => m.role === 'lead') : undefined
      const leadName = typeof leadMember?.name === 'string' ? leadMember.name : undefined
      const changed = state.syncSubagents(sessionId, merged, leadName)
      debugLog('roster.sync', { sessionId, children: merged.map((child) => child.label ?? child.id), leadName: leadName ?? null, changed })
    } catch (error) {
      logger.warn(`同步 subagent 花名册失败（下次再试）：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      rosterSyncBusy = false
    }
  }

  // **先挂清理，再启动。**
  //
  // 顺序是刻意的：dsh 支持热重载，泄漏的 setInterval 会让"改一次代码多一个世界在跑"，
  // 而症状是 CPU 慢慢爬高——很难归因到某个插件。如果先 start 再挂清理，
  // 而挂清理这一步抛了（比如 ctx 形状不对），定时器就**已经泄漏了**，没有任何人再能停它。
  ctx.effect(() => () => {
    runtime.stop()
    planAsker.stop()
    state.deactivate()
    // R509：锁跟着已有的生命周期一起放，不额外占一个 disposer（测试锁死了数量）。
    ownerLock.release()
  }, 'agent-world: runtime')

  if (resolved.autoStart && ownerLock.owned) runtime.start()

  // **默认激活一个会话**：没有激活会话时，世界不会推进（tick 不动、工单永远没人接）。
  // 现象很迷惑：派了活、花名册也在，但所有人一直"待命"，看着像派单坏了。
  // 用 captain 会话兜底——它是这个插件自己创建的，不占用用户的会话。
  if (resolved.autoActivate && state.activeSessionId === null && resolved.captainSessionId !== '') {
    try {
      state.activateSession(resolved.captainSessionId)
      runtime.start()
    } catch (error: unknown) {
      logger.warn('[agent-world] 默认会话激活失败：' + String(error))
    }
  }

  // ── 对话：角色 ↔ DSH Agent 会话（M6-1 / M6-3）─────────────────────────────
  //
  // 这一步把"世界里的小人物"接到 DSH 的 AI 基座上：每个角色**第一次被搭话时才**建一个
  // 真实的 Agent 会话（D36 懒创建），上限由 `maxLiveSessions` 控，卸载时全部 dispose。
  //
  // 拿不到会话服务时**不阻塞插件加载**：世界与面板照跑，`/api/say` 仍会登记对话，
  // 然后以一条写清了原因的 SSE `failed` 事件收场（红线第 6 条：失败要退化，不要卡住）。
  //
  // ⚠️ **建桥必须是惰性的**（R30 在真宿主上踩出来的）：插件加载那一刻，`sessionController`
  // 往往还没挂上 —— cordis 只按 `inject` 图排序，而我们只声明了 `tools`。原来在这里同步建一次，
  // 结果被定死成"没有会话服务"，`/api/say` 从此每条都失败。现在推迟到第一次真正要说话时，
  // 成功后记住；失败则每次都给出**当次**的原因（服务没挂上 / 挂了又掉了，诊断上不是一回事）。
  let liveBridge: CharacterBridge | undefined
  /** 当前真正打开着 Agent World 视图的会话；null = 没有视图。 */
  let viewSessionId: string | null = null
  let lastFailureCode: string | undefined
  const dialoguePort = toLazyDialoguePort(() => {
    const wiring = createDshCharacterBridge(ctx, {
      systemPromptFor: createPersonaResolver(state, personaStore),
      // 角色只许看世界、读内容、派单（D35）。**不给 xcity_open**：那会让一个角色重开整个世界。
      characterTools: ['xcity_status', 'xcity_content', 'xcity_dispatch'],
      maxLiveSessions: resolved.maxLiveSessions,
      requestIdPrefix: 'agent-world-say',
      onError: (reason) => logger.warn(`对话桥：${reason}`),
    })
    if (wiring.ok) {
      liveBridge = wiring.bridge
      logger.info(`对话通道已就绪：${resolved.maxLiveSessions > 0 ? `上限 ${resolved.maxLiveSessions} 个角色会话` : '不限制角色会话数'}（懒创建）`)
      return { ok: true, bridge: wiring.bridge }
    }
    // 同一种失败只记一次日志：每次搭话都重试，若每次都写一行，日志就会被同一句话淹没。
    if (lastFailureCode !== wiring.code) {
      lastFailureCode = wiring.code
      // headless profile 里没有 agent 能力是**正常配置**，记 info；
      // 有 agentLoop 却拿不到会话服务才值得 warn —— 把常态写成 warn，真正的警告就会被淹掉。
      if (wiring.code === 'no-agent-loop') logger.info(`对话通道未启用（这个 profile 没有 agent 能力，属于正常配置）：${wiring.reason}`)
      else logger.warn(`对话通道暂不可用（有 agentLoop 却拿不到会话服务）：${wiring.reason}`)
    }
    return { ok: false, reason: wiring.reason }
  })
  // 卸载 / 热重载时把所有角色的会话一起释放 —— 否则每改一次代码就多几个活着的会话
  // （与上面那个 setInterval 泄漏同类：症状是成本慢慢爬高，很难归因到某个插件）。
  ctx.effect(() => () => {
    void liveBridge?.disposeAll()
  }, 'agent-world: dialogue bridge')

  // ── R37：套壳 dsh-agent-teams 的对话后端 ────────────────────────────────────
  //
  // 用户原话："为什么不直接在 dsh-agent-teams 这个插件上套壳？" —— 他是对的。
  // 角色变成 agent-teams 名册里的成员：会话生命周期、信箱、持久化、冷启动接回都归它管，
  // 我们只当队长（队长就是一个普通 DSH 会话，它自己从不需要发言）。
  // 与上面的惰性端口**同样惰性**：加载那一刻 tools/subagents 可能还没挂上（R30 的教训）。
  const resolveSeat = createSeatResolver(state)
  /**
   * R166：TeamsPort 不再是一个全局固定队长，而是**按会话缓存**。
   *
   * 打开哪个会话的 Agent World，就只和那个会话的团队说话；队长就是该会话自己
   * （`ctx.agents.get(sessionId)` 的 live agent），不再另建 `agent-world:captain`。
   */
  const teamsPorts = new Map<string, TeamsPort>()
  /**
   * 每个会话一个**独立的队长会话**，而不是直接拿用户会话当队长。
   *
   * 真机结论：用户会话在 UI 里被写句柄占用，且空闲时没有 live Agent；
   * 拿它当 agent_teams 的 captain 会撞 already exists/active write handle，
   * 或拿到的 {id} handle 在工具里读 `agent.header` 直接崩。
   */
  const captainSessionIdFor = (conversationId: string): string => `agent-world:captain:${conversationId}`
  /**
   * 每个会话的团队名必须不同。agent-teams 的 teamId 是从团队名 slug 出来的；
   * 固定 `Agent World G2` 会被旧队长占用（真机：team id "agent-world-g2" is taken by another captain）。
   */
  const teamNameFor = (conversationId: string): string =>
    conversationId === resolved.captainSessionId
      ? resolved.teamName
      : `${resolved.teamName} #${conversationId.slice(-8)}`
  const createCaptainBase = createTeamsCaptain(ctx, { cwd: process.cwd() })
  const createCaptain = async (sessionId: string, cwd: string) => {
    if (createCaptainBase === undefined) throw new Error('拿不到 agentLoop：建不了会话级队长会话')
    return await createCaptainBase(sessionId, cwd)
  }
  function acquireTeamsPort(
    conversationId: string = state.activeSessionId ?? resolved.captainSessionId,
  ): { ok: true; port: TeamsPort } | { ok: false; reason: string } {
    const sessionId = conversationId === resolved.captainSessionId
      ? resolved.captainSessionId
      : captainSessionIdFor(conversationId)
    const existing = teamsPorts.get(sessionId)
    if (existing !== undefined) return { ok: true, port: existing }
    const tools = (ctx as unknown as { get(name: string): unknown }).get('tools')
    const subagents = (ctx as unknown as { get(name: string): unknown }).get('subagents')
    if (subagents === undefined) {
      return {
        ok: false,
        reason:
          '拿不到 ctx.subagents：agent-teams 的成员是 subagents 建出来的持久子会话，没有它就没有成员。' +
          '确认这个 profile 挂了 dsh-subagent 与 dsh-agent-teams。',
      }
    }
    const feed = createSessionEventFeed(ctx)
    if (feed === undefined) {
      return {
        ok: false,
        reason: '拿不到会话事件总线（ctx.on）：能建团队但收不到成员的回复。再搭一次话试试；一直这样说明宿主没有事件总线。',
      }
    }
    const port = createTeamsPort(
      tools,
      subagents,
      feed,
      {
        captainSessionId: sessionId,
        cwd: process.cwd(),
        teamName: teamNameFor(conversationId),
        teamDescription: resolved.teamDescription,
        memberNameFor: (id) =>
          state.currentWorld()?.agents.find((agent) => agent.id === id)?.name ?? resolveSeat(id).name,
        memberRoleFor: (id) => {
          const actor = state.currentWorld()?.agents.find((agent) => agent.id === id)
          return actor !== undefined && (actor as { boundAgentId?: string | null }).boundAgentId === null ? 'lead' : resolveSeat(id).role
        },
        personaFor: (id) => {
          const actor = state.currentWorld()?.agents.find((agent) => agent.id === id)
          // R173：leader 的显示名/成员名固定为 leader，人设也不能再自称内容花名册里的名字
          // （真机回复里冒出了「工头阿金」——名字从 persona 漏回来了）。
          if (actor !== undefined && (actor as { boundAgentId?: string | null }).boundAgentId === null) {
            return '你是这个团队的 leader，负责统筹与回答。始终用「lead」自称，不要使用花名册里的其它人名。'
          }
          return resolveSeat(id).persona
        },
        toolPolicy: resolved.memberToolPolicy,
        agentOptionsFor: () => readDefaultModelSelection(ctx),
        onError: (reason) => logger.warn(`agent-teams 套壳：${reason}`),
        createCaptain,
      },
    )
    teamsPorts.set(sessionId, port)
    logger.info(`对话后端：agent-teams（队长会话 ${sessionId}，团队「${resolved.teamName}」）`)
    return { ok: true, port }
  }
  const teamsDialoguePort = {
    async say(characterId: string, text: string) {
      const got = acquireTeamsPort()
      if (!got.ok) return { ok: false as const, reason: got.reason }
      return got.port.say(characterId, text)
    },
    async waitForReply(
      characterId: string,
      timeoutMs: number,
      onProgress?: (actions: readonly { name: string; detail?: string; ok: boolean }[]) => void,
    ) {
      const got = acquireTeamsPort()
      if (!got.ok) return { ok: false as const, reason: got.reason }
      return got.port.waitForReply(characterId, timeoutMs, onProgress)
    },
    liveCount: () => [...teamsPorts.values()].reduce((sum, port) => sum + port.liveCount(), 0),
  }
  ctx.effect(() => () => {
    for (const port of teamsPorts.values()) void port.dispose()
    teamsPorts.clear()
  }, 'agent-world: agent-teams ports')

  /**
   * R166 Phase C：工具调用按**调用者会话**定位世界。
   *
   * `ctx.agents.currentInitiator()` 是这次工具调用所属的会话 Agent。没有视图时只把世界
   * 载入内存、**不启动 ticker**（没人看就不跑）；有别的会话的视图开着时直接拒绝，
   * 避免把别人正在跑的世界换掉。
   */
  const currentInitiatorId = (): string | undefined => {
    const getService = (ctx as unknown as { get?: (name: string) => unknown }).get
    const agents = (typeof getService === 'function' ? getService.call(ctx, 'agents') : undefined) as
      | { currentInitiator?(): { id?: unknown } | undefined }
      | undefined
    const id = agents?.currentInitiator?.()?.id
    return typeof id === 'string' && id !== '' ? id : undefined
  }
  const ensureCallerSession = (): void => {
    const caller = currentInitiatorId()
    if (caller === undefined || state.activeSessionId === caller) return
    if (viewSessionId !== null && viewSessionId !== caller) {
      throw new Error(`另一个会话（${viewSessionId}）的 Agent World 正开着；先切回当前会话再操作它的世界。`)
    }
    runtime.stop()
    state.activateSession(caller)
    // 没有视图就不启动 ticker；下次打开该会话视图时 activate 会重新 start。
  }
  const sessionWorld = new Proxy(state as unknown as WorldServicePort, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        ensureCallerSession()
        return (value as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  }) as WorldServicePort
  registerWorldTools(ctx, sessionWorld)

  // R441：官方 subagent 的结构化汇报入口。身份来自工具执行上下文，不解析正文。
  const reportPort: AgentReportPort = {
    report(agentSessionId: string, input: AgentReportInput): AgentReportResult {
      const world = state.currentWorld()
      const base = { agentId: '', agentName: '', taskId: input.taskId, status: input.status, xpAwarded: 0, level: 1 }
      if (world === null) return { ...base, accepted: false, reason: '世界尚未创建。' }
      const localTask = world.tasks.find((candidate) => candidate.id === input.taskId && candidate.externalId === null)
      if (taskExecution !== null && localTask !== undefined) {
        const result = taskExecution.report(agentSessionId, input)
        const owner = world.agents.find((candidate) => candidate.id === localTask.owner)
        return { ...base, ...result, agentId: owner?.id ?? '', agentName: owner?.name ?? '' }
      }
      const agent = world.agents.find((candidate) => candidate.boundAgentId === agentSessionId)
      if (agent === undefined) return { ...base, accepted: false, reason: '调用者不是当前世界绑定的 subagent。' }
      const task = world.tasks.find((candidate) => candidate.id === input.taskId)
      if (task === undefined) return { ...base, agentId: agent.id, agentName: agent.name, accepted: false, reason: `没有工单 ${input.taskId}。` }
      if (task.owner !== null && task.owner !== agent.id) return { ...base, agentId: agent.id, agentName: agent.name, accepted: false, reason: `${task.id} 属于 ${task.owner}，不是 ${agent.id}。` }
      const key = agent.boundAgentId ?? agent.id
      if (input.status === 'done') {
        if (task.status !== 'done') {
          task.status = 'done'
          task.progress = 1
          task.finishedAtTick = world.tick
          task.station = null
          task.output = input.summary
          agent.carrying = null
          agent.state = 'idle'
          agent.station = null
          agent.targetStation = null
          agent.path = []
          personaStore.awardTask(key, task.id, 40)
        }
      } else if (input.status === 'working') {
        if (task.status !== 'done' && task.status !== 'failed') {
          task.status = 'in_progress'
          task.owner = agent.id
          agent.state = 'working'
        }
      } else {
        if (task.status !== 'done' && task.status !== 'failed') {
          task.status = 'blocked'
          task.owner = agent.id
          agent.state = 'blocked'
          task.failureReason = input.summary
        }
      }
      const persona = personaStore.get(key)
      if (input.skill !== undefined && input.skill.trim() !== '' && persona !== null && !persona.skills.includes(input.skill.trim())) {
        personaStore.upsert({ id: key, skills: [...persona.skills, input.skill.trim()] })
      }
      world.events.push({
        seq: (world.events.at(-1)?.seq ?? 0) + 1,
        tick: world.tick,
        type: 'agent.report',
        payload: { agentId: agent.id, taskId: task.id, status: input.status, summary: input.summary, evidence: input.evidence ?? [], next: input.next ?? null },
      })
      const latest = personaStore.get(key)
      debugLog('agent.report', { agentId: agent.id, taskId: task.id, status: input.status, summary: input.summary, evidence: input.evidence ?? [], skill: input.skill ?? null })
      return {
        accepted: true,
        agentId: agent.id,
        agentName: agent.name,
        taskId: task.id,
        status: input.status,
        xpAwarded: input.status === 'done' ? 40 : 0,
        level: latest?.level ?? 1,
      }
    },
  }
  registerReportTool(ctx, reportPort)

  // ── 派单后立刻在团队里建对应任务（D41，R43）────────────────────────────────
  //
  // 包在 `state.dispatch` 外面而不是改 `state`：`state`（世界服务）不该认识 agent-teams，
  // 那是编排层的事。`state` 的方法全是闭包（`this.` 出现 0 次），所以展开一层是安全的。
  const teamAwareWorld = new Proxy(sessionWorld, {
    get(target, prop, receiver) {
      if (prop === 'dispatch') {
        return (taskSet: string): DispatchOutcome => {
          ensureCallerSession()
          const outcome = target.dispatch(taskSet)
          void linkNewTasksToTeam(outcome.addedTaskIds).catch((error) => {
            logger.warn(
              `在团队里建对应任务失败（小镇的工单照常建好了）：${error instanceof Error ? error.message : String(error)}`,
            )
          })
          return outcome
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as WorldServicePort
  registerDispatchTool(ctx, teamAwareWorld)

  /**
   * R174：Agent World 打开时，世界是 **dsh-agent-teams staged plan 的只读投影**。
   *
   * 不再从游戏里自动建队/加成员（那会绕过 Pre-run plan review，并制造
   * already exists / team id taken / agent.header 缺失）。团队由对话里的 captain
   * 走原生 staged plan，批准后成员才 spawn；世界只负责把已 spawn 的 children 画出来。
   *
   * 没有 active 会话（headless/测试/旧 API）时仍保留旧 teams 后端，避免影响其它入口。
   */
  /**
   * R177：experimental profile 没有 staged plan，也没有 agent_teams_*。
   * 点击已 spawn 的成员时，直接走 TeamService.sendMessage；captain 是对话本身，不能从世界里投递。
   */
  /**
   * R189：experimental 成员回复桥。
   *
   * TeamService.sendMessage 只保证投递，回复落在成员自己的 session 里。
   * 这里监听 `session/event` 的 assistant/message，按成员 session id 把第一条
   * 非空文本回传给 waitForReply；超时/无回复由调用方按失败处理。
   */
  const replyWaiters = new Map<string, { resolve(text: string): void; timer: ReturnType<typeof setTimeout> }[]>()
  const listen = (ctx as unknown as {
    on?: (name: string, handler: (session: { id?: string }, event: { type?: string; data?: Record<string, unknown> }) => void) => unknown
  }).on
  const smsReplies = createSmsReplyTracker(10 * 60 * 1000)

  /**
   * R480：把 sim 的"想发"变成真正的会话投递。
   *
   * sim 已经写好限频字段（世界只经 step 改）；这里只做 IO：找角色会话、投递、
   * 用带 kind 的登记项等回复。失败只记日志，不重试（限频已消耗，3 小时后再来）。
   */
  async function sendInitiative(agentId: string, reason: string, tick: number): Promise<void> {
    try {
      await deliverInitiative(agentId, reason, tick, {
        characterOf: (id) => loadAgentMap(join(dirname(resolved.slowvale.bindingsFile), 'agents.json'))[id] ?? null,
        sessionOf: (characterId) =>
          loadXcityBindings(resolved.slowvale.bindingsFile).find((row) => row.characterId === characterId)?.sessionId ?? null,
        // R479/R480：主动短信也带当天经历，别发"在吗"这种没有生活的话。
        dayContext: (id) => {
          const world = state.currentWorld()
          return world === null ? [] : summarizeDay(world, id, world.tick)
        },
        track: (id, sessionId, text, kind) => smsReplies.track(id, sessionId, text, kind),
        prompt: async (payload) => {
          if (typeof sessionControllerService?.prompt !== 'function') throw new Error('宿主没有会话服务')
          await sessionControllerService.prompt(payload as never, new AbortController().signal)
        },
        onError: (message) => logger.warn('[xcity-init] 投递失败 agent=' + agentId + '：' + message),
      })
    } catch (error: unknown) {
      // 读绑定表失败等：只记日志，不重试。
      logger.warn('[xcity-init] 投递失败 agent=' + agentId + '：' + String(error))
    }
  }

  // R481：学习结算。只看 completed + purpose=study；同一 activityId 只加一次。
  const studySeen = new Set<string>()
  hub.subscribe((events) => {
    const world = state.currentWorld()
    if (world === null) return
    for (const event of events) {
      if (event.type !== 'agent.state') continue
      const payload = event.payload as Record<string, unknown>
      if (payload.status !== 'completed' || payload.purpose !== 'study') continue
      const agentId = typeof payload.agentId === 'string' ? payload.agentId : ''
      const agent = world.agents.find((item) => item.id === agentId)
      if (agent === undefined) continue
      const key = agent.boundAgentId ?? agent.id
      try {
        awardStudyXp(
          personaStore,
          key,
          {
            activityId: typeof payload.activityId === 'string' ? payload.activityId : '',
            skill: typeof payload.skill === 'string' ? payload.skill : null,
          },
          studySeen,
        )
      } catch (error: unknown) {
        // 写 persona 失败不能把这一步的世界推进带崩（hub.publish 是同步的）。
        logger.warn('[xcity-study] 结算失败 agent=' + agent.id + '：' + String(error))
      }
    }
  })

  // 订阅世界事件：sim 决定"想发"，这里负责投递。
  hub.subscribe((events) => {
    for (const event of events) {
      if (event.type !== 'agent.initiative') continue
      const agentId = typeof event.payload.agentId === 'string' ? event.payload.agentId : ''
      if (agentId === '') continue
      const reason = typeof event.payload.reason === 'string' ? event.payload.reason : '想找你说说话'
      void sendInitiative(agentId, reason, event.tick)
    }
  })

  let mainDialogueChannel: DialogueChannel | null = null
  let mainTurnSeq = 0
  const turnBySession = new Map<string, string>()
  /**
   * R517：每条会话当前这一轮的文本体积（user/message + 工具结果 + assistant 文本）。
   * 在 turn/end 结算：一轮里可能有多步工具调用，提前结算会少算输入。
   */
  const pendingTurnChars = new Map<string, { inputChars: number; outputChars: number }>()
  if (typeof listen === 'function') {
    const disposeDialogue = listen('session/event', (session, event) => {
      const sessionId = typeof session?.id === 'string' ? session.id : ''
      const message = event.data?.['message'] as { content?: unknown } | undefined
      const content = event.type === 'user/message' ? event.data?.['content'] ?? message?.content : message?.content
      const blocks = Array.isArray(content) ? content : []
      // R517：只计数，不改任何行为。输入 = 这轮 user/message 文本 + 工具结果文本，
      // 输出 = assistant 文本；结算放 turn/end（多步工具回合只算一轮）。
      const text = textOfBlocks(blocks)
      if (sessionId !== '') {
        const pending = pendingTurnChars.get(sessionId)
        if (event.type === 'user/message') {
          // 一轮里可能有多条 user/message（用户文本 + 每次投递后的 runtime-context），累加不重置。
          const inputChars = (pending?.inputChars ?? 0) + text.length
          pendingTurnChars.set(sessionId, { inputChars, outputChars: pending?.outputChars ?? 0 })
        } else if (event.type === 'tool/result' && pending !== undefined) {
          pendingTurnChars.set(sessionId, { ...pending, inputChars: pending.inputChars + text.length })
        } else if (event.type === 'assistant/message' && pending !== undefined) {
          pendingTurnChars.set(sessionId, { ...pending, outputChars: pending.outputChars + text.length })
        } else if (event.type === 'turn/end' && pending !== undefined) {
          pendingTurnChars.delete(sessionId)
          const warning = turnCost.observe(pending.inputChars, pending.outputChars)
          if (warning !== null) {
            logger.warn(
              `[xcity-cost] 一轮输入 ${String(warning.inputChars)} 字符，超过 ${String(warning.warnInputChars)} 字符的提示线（约 30k token）。这是体积提示，不是计费。`,
            )
          }
        }
      }
      planAsker.observe(sessionId, event.type ?? '', event.data)
      const sms = smsReplies.observe(sessionId, event.type, event.data, blocks)
      if (sms === null) taskExecution?.observe(sessionId, event.type, event.data)
      if (event.type !== 'user/message' && event.type !== 'assistant/message' && event.type !== 'tool/result') return
      const world = state.currentWorld()
      if (world === null) return
      if (sms !== null) {
        if (sms.reply) {
          const peer = world.agents.find((agent) => agent.id === sms.reply.peerRoleId)
          if (peer !== undefined) {
            slowvaleBridgeHandle?.appendIncoming(peer.id, peer.name, sms.reply.text)
            // R507：回复同时在他头顶说一遍，玩家在场景里也看得见。
            slowvaleBridgeHandle?.say(peer.id, sms.reply.text)
            try {
              sms.reply.acceptAction?.()
            } catch (error: unknown) {
              logger.warn('[xcity-sms] 已接受的建议未能入队：' + String(error))
            }
          }
        }
        // R494：短信回合的工具事件不触发工位或收工映射。
        return
      }
      // 谁代表这条会话：显式绑定 > 当前激活会话的队长 > xcity 绑定表（规则见 runtime/session-events.ts）。
      const actor = actorForSession({
        agents: world.agents,
        sessionId,
        activeSessionId: state.activeSessionId,
        characterOfSession: (id) => characterOfSession(loadXcityBindings(resolved.slowvale.bindingsFile), id),
        agentOfCharacter: (character) => {
          const agents = loadAgentMap(join(dirname(resolved.slowvale.bindingsFile), 'agents.json'))
          return Object.keys(agents).find((agentId) => agents[agentId] === character) ?? null
        },
      })
      if (actor === null) return

      // ② 看起来在干活：工具调用 → 去工位，工具返回 → 收工。
      if (taskExecution === null || !world.agents.some((agent) => agent.id === actor.id && agent.carrying !== null)) {
        const activity = activityForEvent({ type: event.type, blocks, agentId: actor.id, skillOf: skillForTool })
        if (activity !== null) runtime.enqueue(activity as never)
      }

      // ③ 对话气泡：只有它需要通道，前两件事不受影响。
      if (mainDialogueChannel === null) return
      if (text === '') return
      if (event.type === 'user/message') {
        const turnId = `main-${String(++mainTurnSeq)}`
        turnBySession.set(sessionId, turnId)
        mainDialogueChannel.publish({
          turnId, tick: world.tick, phase: 'thinking',
          from: { kind: 'god' }, to: { kind: 'agent', id: actor.id }, text,
        })
        return
      }
      const replyTurn = turnBySession.get(sessionId) ?? `main-${String(++mainTurnSeq)}`
      turnBySession.delete(sessionId)
      mainDialogueChannel.publish({
        turnId: replyTurn,
        tick: world.tick, phase: 'replied',
        from: { kind: 'agent', id: actor.id }, to: { kind: 'god' }, text,
      })
    })
    try {
      ctx.effect(() => () => { (disposeDialogue as (() => void) | undefined)?.() })
    } catch (error) {
      if (!(error instanceof Error) || !/inactive context/i.test(error.message)) throw error
      ;(disposeDialogue as (() => void) | undefined)?.()
    }
  }
  const pendingReplies = new Map<string, Promise<string>>()
  const captainSentAt = new Map<string, number>()
  function replyFor(sessionId: string, timeoutMs = 60_000): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const waiters = replyWaiters.get(sessionId) ?? []
        const index = waiters.findIndex((w) => w.resolve === resolve)
        if (index >= 0) waiters.splice(index, 1)
        if (waiters.length === 0) replyWaiters.delete(sessionId)
        resolve('')
      }, timeoutMs)
      const waiter = { resolve, timer }
      const waiters = replyWaiters.get(sessionId) ?? []
      waiters.push(waiter)
      replyWaiters.set(sessionId, waiters)
    })
  }
  const experimentalDialoguePort = {
    async say(characterId: string, text: string): Promise<{ ok: true } | { ok: false; reason: string }> {
      const actor = state.currentWorld()?.agents.find((agent) => agent.id === characterId)
      if (actor === undefined) return { ok: false, reason: '没有这个角色：先等成员 spawn 出来。' }
      // R385：captain 属于当前会话本身，不需要先成为 agent-teams Lead。
      // 之前的 agentsService 前置检查会把“会话在线但没建团队”直接误报成 Lead 不在线。
      if ((actor as { boundAgentId?: string | null }).boundAgentId === null) {
        // R198：captain 就是当前会话的 Lead；通过 sessionController.prompt 把话送进对话，
        // 回复仍由 session/event 桥接回场景气泡。
        const sessionId = state.activeSessionId ?? ''
        if (sessionId === '' || typeof sessionControllerService?.prompt !== 'function') {
          return { ok: false, reason: 'captain 对话通道不可用：拿不到 sessionController。' }
        }
        try {
          captainSentAt.set(characterId, Date.now())
          pendingReplies.set(characterId, replyFor(sessionId))
          await sessionControllerService.prompt({
            requestId: `agent-world-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            sessionId,
            mode: 'steer',
            content: [{ type: 'text', text }],
          }, new AbortController().signal)
          return { ok: true }
        } catch (error) {
          return { ok: false, reason: error instanceof Error ? error.message : String(error) }
        }
      }
      const lead = agentsService?.get?.(state.activeSessionId ?? '')
      if (lead === undefined) {
        if (state.activeSessionId === null) {
          return { ok: false, reason: '当前是独立 Agent World 页，未绑定 DSH 会话。请从 DSH 对话里的 Agent World 面板打开，或用 ?session=<会话id> 打开。' }
        }
        return { ok: false, reason: `成员对话需要 agent-teams Lead；会话 ${state.activeSessionId} 还没有在线团队。` }
      }
      if (typeof agentTeamsService?.sendMessage !== 'function') {
        return { ok: false, reason: 'experimental agentTeams 服务不可用。' }
      }
      try {
        const members = agentTeamsService.listMembers?.(lead) as readonly { id?: unknown; name?: unknown }[] | undefined
        const memberId = (members ?? []).find((m) => m.name === actor.name)?.id
        if (typeof memberId === 'string' && memberId !== '') {
          pendingReplies.set(characterId, replyFor(memberId))
        }
        await agentTeamsService.sendMessage(lead, {
          target: actor.name,
          content: [{ type: 'text', text }],
          signal: new AbortController().signal,
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      }
    },
    async waitForReply(characterId: string, timeoutMs = 60_000, _onProgress?: (actions: readonly { name: string; detail?: string; ok: boolean }[]) => void): Promise<{ ok: true; text: string; actions: [] } | { ok: false; reason: string }> {
      const actor = state.currentWorld()?.agents.find((agent) => agent.id === characterId)
      // Lead 的主对话可能在跑别的任务，assistant/message 事件不一定落在 world 的监听里；
      // 用 sessionController.inspect 直接轮询会话日志兜底。
      const sentAt = captainSentAt.get(characterId)
      if (sentAt !== undefined && typeof sessionControllerService?.inspect === 'function') {
        const deadline = Date.now() + Math.max(1000, timeoutMs)
        const extract = (data: Record<string, unknown> | undefined): string => {
          const message = data?.['message'] as { content?: unknown } | undefined
          const blocks = Array.isArray(message?.content) ? message.content : []
          return blocks
            .filter((block): block is { type: string; text: string } => {
              const b = block as Record<string, unknown>
              return b?.['type'] === 'text' && typeof b['text'] === 'string' && b['text'].trim() !== ''
            })
            .map((block) => block.text)
            .join('\n\n')
            .trim()
        }
        while (Date.now() < deadline) {
          try {
            const inspection = await sessionControllerService.inspect(state.activeSessionId ?? '')
            for (const event of [...(inspection?.events ?? [])].reverse()) {
              if (event.type !== 'assistant/message') continue
              if (typeof event.time === 'number' && event.time < sentAt - 1000) break
              const text = extract(event.data)
              if (text !== '') {
                captainSentAt.delete(characterId)
                pendingReplies.delete(characterId)
                return { ok: true, text, actions: [] }
              }
            }
          } catch (error) { /* 继续轮询 */ }
          await new Promise((resolve) => setTimeout(resolve, 700))
        }
        captainSentAt.delete(characterId)
        pendingReplies.delete(characterId)
        return { ok: false, reason: `${actor?.name ?? characterId} 没有在超时内回复` }
      }
      const pending = pendingReplies.get(characterId)
      if (pending === undefined) {
        return { ok: true, text: `已发送给 ${actor?.name ?? characterId}`, actions: [] }
      }
      pendingReplies.delete(characterId)
      const text = await Promise.race([
        pending,
        new Promise<string>((resolve) => setTimeout(() => resolve(''), Math.max(1000, timeoutMs))),
      ])
      if (text === '') return { ok: false, reason: `${actor?.name ?? characterId} 没有在超时内回复` }
      return { ok: true, text, actions: [] }
    },
    liveCount: () => 0,
  }
  const nativePlanReadOnlyPort = {
    async say(): Promise<{ ok: false; reason: string }> {
      return {
        ok: false,
        reason:
          'Agent World 是只读投影：请先在对话里用 dsh-agent-teams 的 Pre-run plan review 批准团队计划；' +
          '成员 spawn 后会自动出现在镇上。',
      }
    },
    async waitForReply(): Promise<{ ok: false; reason: string }> {
      return { ok: false, reason: 'Agent World 是只读投影，不直接向成员发消息。' }
    },
    liveCount: () => 0,
  }
  const activeDialoguePort = resolved.dialogueBackend === 'native'
    ? dialoguePort
    : {
        say: (...args: Parameters<typeof teamsDialoguePort.say>) => {
          if (state.activeSessionId === null) return teamsDialoguePort.say(...args)
          return typeof agentTeamsService?.sendMessage === 'function'
            ? experimentalDialoguePort.say(...args)
            : nativePlanReadOnlyPort.say()
        },
        waitForReply: (...args: Parameters<typeof teamsDialoguePort.waitForReply>) => {
          if (state.activeSessionId === null) return teamsDialoguePort.waitForReply(...args)
          return typeof agentTeamsService?.sendMessage === 'function'
            ? experimentalDialoguePort.waitForReply(...args)
            : nativePlanReadOnlyPort.waitForReply()
        },
        liveCount: () => (state.activeSessionId !== null ? 0 : teamsDialoguePort.liveCount()),
      }

  // ── 诊断：把宿主侧的 agent 报错**带 stack** 写出来（R31）─────────────────────
  //
  // 宿主拒绝一条事件时，那条事件**不会落盘、也不会发 session/event**（后者是提交后才推送）；
  // `turn/end` 里只剩一句 message。所以 R30 卡在 "producer-owned source kind" 上看不到是哪条。
  // `agent/error` 带的是**原始 Error 对象**——把它的 stack 打出来就能定位到产出那条事件的代码。
  //
  // 只记**本插件建的会话**（id 以 agent-world: 开头），不碰用户其它会话的报错。
  // 默认只进 logger；设了 AGENT_WORLD_TRACE_FILE 时额外追加到那个文件（宿主日志常常看不到）。
  const traceFile = process.env['AGENT_WORLD_TRACE_FILE']
  const onAgentError = (payload: unknown, ...rest: unknown[]): void => {
    try {
      const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
      const agent = (rest[0] ?? record['agent']) as { id?: unknown; session?: { id?: unknown } } | undefined
      const id = String(agent?.id ?? agent?.session?.id ?? (this_agentId(record) ?? ''))
      if (id !== '' && !id.startsWith('agent-world:')) return
      const error = record['error']
      const stack = error instanceof Error ? (error.stack ?? error.message) : String(error)
      const line = `[agent-world] agent/error session=${id || '?'} turn=${String(record['turn'])} step=${String(record['step'])}\n${stack}`
      logger.warn(line)
      if (traceFile) appendFileSync(traceFile, `${new Date().toISOString()} ${line}\n\n`)
    } catch {
      // 诊断钩子自己出错绝不能影响对话
    }
  }
  const on = (ctx as unknown as { on?: (name: string, cb: (...args: unknown[]) => void) => unknown }).on
  if (typeof on === 'function') {
    const off = on.call(ctx, 'agent/error', onAgentError)
    if (typeof off === 'function') ctx.effect(() => off as () => void, 'agent-world: error trace')
  }

  // ── Slow Vale 适配层：可视化入口（取代旧面板）────────────────────────────
  //
  // 独立端口、独立生命周期；**失败不拖垮世界**（世界能不能跑与有没有人看是两件事，
  // 这条原则沿用旧面板的软依赖设计）。配置里的一位 switch 就能整个关掉。
  // R509：只有推进者才开桥——否则每个角色会话都去抢同一个端口。
  if (resolved.slowvale.enabled && ownerLock.owned) {
    const slowvaleRoot = resolve(process.cwd(), resolved.slowvale.assetsDir)
    if (!existsSync(join(slowvaleRoot, 'index.html'))) {
      logger.debug('[slowvale] 静态产物不存在：' + slowvaleRoot + '（改 slowvaleAssetsDir，或把静态站放到这里）')
    } else {
      ctx.effect(() => {
        let bridge: Bridge | null = null
        let watchGameViewers: NodeJS.Timeout | null = null
        let disposed = false
        createSlowvaleBridge({
          host: resolved.slowvale.host,
          port: resolved.slowvale.port,
          assetsDir: slowvaleRoot,
          pushMs: resolved.slowvale.pushMs,
          // 只在场景真的变了才推 scene_state：每帧推会让前端反复重启场景（也是它画不出来的原因之一）。
          sceneStateOnChangeOnly: true,
          // 谁代表谁：短信线程 -> 绑定角色 -> DSH 会话。不传就用默认 ~/.dsh/xcity/bindings.json。
          bindingsFile: resolved.slowvale.bindingsFile,
          account: { email: resolved.slowvale.email, password: resolved.slowvale.password },
          opts: {
            worldId: resolved.slowvale.worldId,
            viewerRoleId: resolved.slowvale.viewerRoleId,
            place: resolved.slowvale.place,
            startDate: resolved.slowvale.startDate,
          },
          // 建好角色会话，但不使用宿主默认模型发送开场白。
          spawnSession: async (input: { characterId: string; characterName: string }) => {
            const cwd = dirname(resolve(resolved.slowvale.bindingsFile))
            return spawnCharacterSession({
              characterId: input.characterId,
              cwd,
              now: Date.now(),
              // R503：spawn 出来的会话必须明确选模型，否则 current() 为空，全被门控挡住。
              model: resolved.slowvale.characterModel.provider === '' ? undefined : resolved.slowvale.characterModel,
              ports: {
                createAgent: async (args) => {
                  const creator = (agentsService as unknown as {
                    create?: (input: Record<string, unknown>) => Promise<unknown>
                  })?.create
                  if (typeof creator !== 'function') throw new Error('宿主没有 agents 服务')
                  await creator.call(agentsService, { sessionId: args.sessionId, meta: { cwd: args.cwd } })
                },
                selectModel: async (sessionId, choice) => {
                  const get = (agentsService as unknown as { get?: (id: string) => unknown })?.get
                  const handle = typeof get === 'function' ? (get.call(agentsService, sessionId) as Record<string, unknown> | undefined) : undefined
                  // R504：只创建不启动的会话收不到消息；但启动会重置模型选择，
                  // 所以顺序必须是**先启动、再选模型**（实测反了会出现 noModel=3）。
                  const start = (handle?.['start'] ?? handle?.['resume']) as ((input?: unknown) => Promise<unknown>) | undefined
                  if (typeof start === 'function') {
                    try {
                      await start.call(handle)
                    } catch {
                      // 启动失败不拦建会话：至少会话在，玩家还能从 UI 打开。
                    }
                  }
                  const fresh = typeof get === 'function' ? (get.call(agentsService, sessionId) as Record<string, unknown> | undefined) : handle
                  const model = fresh?.['model'] as Record<string, unknown> | undefined
                  const select = (model?.['select'] ?? model?.['set']) as ((input: unknown) => Promise<unknown>) | undefined
                  if (typeof select !== 'function') return false
                  await select.call(model, choice)
                  return true
                },
                attachToWorkspace: async (sessionId, path) => {
                  const registry = workspaceRegistryService
                  if (registry === null || typeof registry?.resolveByPath !== 'function') return false
                  const workspace = (await registry.resolveByPath(path)) as
                    | { sessionIds?: string[]; attachSession?: (id: string) => Promise<unknown> }
                    | undefined
                  if (workspace === undefined) return false
                  if (!Array.isArray(workspace.sessionIds) || !workspace.sessionIds.includes(sessionId)) {
                    await workspace.attachSession?.(sessionId)
                  }
                  return true
                },
              },
            })
          },
          respondSms: async (input: { peerRoleId: string; content: string }) => {
            const world = state.currentWorld()
            if (world === null || !world.agents.some((agent) => agent.id === input.peerRoleId)) return null
            const characterOf = (peerRoleId: string) => loadAgentMap(join(characterWorkspace, 'agents.json'))[peerRoleId] ?? null
            const sessionOf = (characterId: string) => loadXcityBindings(bindingsPath).find((row) => row.characterId === characterId)?.sessionId ?? null
            // R494：识别玩家建议仅用于提供选项；短信到达时不向世界发命令。
            const directive = parseDirective(input.content, DEFAULT_CIRCUIT)
            const place = world.places?.find((item) => item.id === directive?.placeId)
            const command = directive === null || place === undefined ? null : directiveToCommand(directive, input.peerRoleId)
            const suggestedAction = command === null ? undefined :
              '去' + place?.name + (command.activity === 'work' ? '工作' : command.activity === 'rest' ? '休息' : '看看')
            try {
              return await respondViaSession(input, {
                characterOf,
                sessionOf,
                suggestedAction,
                dayContext: (peerRoleId) => summarizeDay(world, peerRoleId, world.tick),
                // R505：让他记得自己干过什么、答应过谁——不再是每次都从零开始聊。
                memoryContext: (peerRoleId) => {
                  const agent = world.agents.find((row) => row.id === peerRoleId)
                  if (agent === undefined) return ''
                  return renderMemoryContext({
                    episodes: agent.episodes ?? [],
                    commitments: agent.commitments ?? [],
                    nowTick: world.tick,
                    // R505：承诺里存 id，模型该看到人名。
                    nameOf: (id) => world.agents.find((row) => row.id === id)?.name ?? id,
                    selectEpisodes,
                    scoreEpisode,
                  })
                },
                onForward: (peerRoleId, sessionId, text) => smsReplies.track(peerRoleId, sessionId, text, 'player-sms', command === null ? undefined : () => {
                  // R494：延迟回话不能跨世界或已更换的绑定执行。
                  const characterId = characterOf(peerRoleId)
                  if (state.currentWorld() !== world || characterId === null || sessionOf(characterId) !== sessionId) return
                  runtime.enqueue({ ...command, trigger: { kind: 'player', text: input.content } }, world)
                }),
                prompt: async (payload, signal) => {
                  if (typeof sessionControllerService?.prompt !== 'function') throw new Error('宿主没有会话服务')
                  await sessionControllerService.prompt(payload as never, signal)
                },
              })
            } catch (error: unknown) {
              logger.warn('[xcity-sms] 转发失败 peer=' + input.peerRoleId + '：' + String(error))
              return null
            }
          },
          getWorld: () => state.currentWorld() as unknown as { id: string; name: string; tick: number; paused?: boolean; agents: { id: string; name: string }[] } | null,
          log: (line) => logger.info(line),
        }).then((started) => {
          bridge = started
          slowvaleBridgeHandle = started
          // 「有人在看，世界就得活着」：世界曾经因为某个会话被停掉而冻住（tick 不动、指令全排队），
          // 表现就是游戏里所有人杵着不动。这里做一个守卫：只要游戏页还连着，runtime 停了就拉起来。
          watchGameViewers = setInterval(() => {
            if (disposed) return
            if (shouldRestartWorld({ autoStart: resolved.autoStart, running: runtime.running }) && ownerLock.owned) {
              runtime.start()
            }
          }, 2000)
          watchGameViewers.unref?.()
          if (disposed) void started.close()
        }).catch((error: unknown) => {
          logger.warn('[slowvale] 启动失败：' + String(error))
        })
        return () => {
          disposed = true
          if (watchGameViewers !== null) clearInterval(watchGameViewers)
          if (bridge !== null) void bridge.close()
          slowvaleBridgeHandle = null
        }
      }, 'agent-world: slowvale bridge')
    }
  }

  // ── HTTP：面板 + API ─────────────────────────────────────────────────────
  //
  // `webServer` 是**软依赖**：没有它时世界照跑，只是没有界面。用 `ctx.inject` 而不是写进
  // 顶层 `inject` ——写进去会让这个插件在 headless profile 里直接加载失败，
  // 而"世界能不能跑"和"有没有人看"本来就不该绑在一起（架构 §2 的第一原则）。
  ctx.inject(['webServer'], (host) => {
    const webServer = (host as unknown as {
      webServer: { register(route: { kind: 'prefix'; path: string; handler: unknown }): () => void }
    }).webServer

    const handler = createHandler(
      resolved.routePrefix,
      {
        service: state,
        runtime,
        source: hub,
        tickMs: state.tickMs,
        plan: () => ({ ...planStats }),
        // R517：每轮输入体积（字符）。和 plan 并列，人不必翻日志就知道上下文在不在膨胀。
        turnCost: () => ({ ...turnCost.snapshot() }),
        // R528：意图为空时按出口归因。同样是"和 plan 并列"的只读计数，进程内累计。
        intentStats: () => ({ ...intentStats.snapshot() }),
        // 客户端 iframe 该连哪个端口：由这里告诉它，不写死在客户端里。
        bridgeBase: 'http://' + resolved.slowvale.host + ':' + String(resolved.slowvale.port),
        maxLiveSessions: resolved.maxLiveSessions,
        dialogue: activeDialoguePort,
        personas: {
          list: () => personaStore.list() as unknown as Record<string, unknown>[],
          upsert: (input) => personaStore.upsert(input as never) as unknown as Record<string, unknown>,
          addXp: (id, amount) => personaStore.addXp(id, amount) as unknown as Record<string, unknown> | null,
          linkTask: (id, taskId) => personaStore.linkTask(id, taskId) as unknown as Record<string, unknown> | null,
        },
        onDialogueChannel: (channel) => { mainDialogueChannel = channel },
        // R166：一个会话一个世界；同一时刻只有激活的那个在跑。
        activateSession: (sessionId: string) => {
          viewSessionId = sessionId
          runtime.stop()
          const world = state.activateSession(sessionId)
          if (resolved.autoStart && ownerLock.owned) runtime.start()
          void syncRoster()
          return world
        },
        deactivateSession: () => {
          viewSessionId = null
          runtime.stop()
          state.deactivate()
        },
        // R162：header 要显示"这个世界对应的会话名"。
        // 队长会话的标题在 session 日志里，异步读；读不到就让前端退回 teamName / id。
        worldSession: async () => {
          const id = state.activeSessionId ?? resolved.captainSessionId
          const teamName = resolved.teamName
          try {
            const query = ctx.get('sessionQuery') as
              | { readTitle?: (sessionId: string) => Promise<{ title?: string } | undefined> }
              | undefined
            const snapshot = typeof query?.readTitle === 'function' ? await query.readTitle(id) : undefined
            const title = typeof snapshot?.title === 'string' && snapshot.title !== '' ? snapshot.title : null
            return { id, teamName, title }
          } catch {
            return { id, teamName, title: null }
          }
        },
        teamRoster: async (sessionId: string) => {
          const lead = agentsService?.get?.(sessionId)
          if (lead === undefined) return { available: false, reason: 'Lead Agent 不在线：先打开这个会话再试' }
          const teams = agentTeamsService
          if (typeof teams?.membership !== 'function' || typeof teams.listMembers !== 'function' || typeof teams.listTasks !== 'function') {
            return { available: false, reason: 'experimental agentTeams 服务不可用（当前 profile 没装/未激活）' }
          }
          try {
            const membership = teams.membership(lead) as { id?: unknown; name?: unknown; role?: unknown } | undefined
            const members = teams.listMembers(lead) as readonly Record<string, unknown>[] | undefined
            const tasks = teams.listTasks(lead) as readonly Record<string, unknown>[] | undefined
            // 不能把 Agent/service 对象直接序列化（真机：cannot get property "toJSON" without inject）。
            return {
              available: true,
              provider: 'experimental',
              lead: membership === undefined ? null : {
                id: String(membership.id ?? ''),
                name: String(membership.name ?? ''),
                role: String(membership.role ?? ''),
              },
              members: (members ?? []).map((m) => ({
                id: String(m['id'] ?? ''),
                name: String(m['name'] ?? ''),
                role: String(m['role'] ?? ''),
                status: String(m['status'] ?? ''),
                description: typeof m['description'] === 'string' ? m['description'] : '',
                model: typeof m['model'] === 'string' ? m['model'] : '',
              })),
              tasks: (tasks ?? []).map((t) => ({
                id: String(t['id'] ?? ''),
                subject: String(t['subject'] ?? ''),
                description: typeof t['description'] === 'string' ? t['description'] : '',
                status: String(t['status'] ?? ''),
                ownerName: typeof t['ownerName'] === 'string' ? t['ownerName'] : '',
                ready: t['ready'] === true,
                // R207：依赖/版本是看图与 CAS 的输入，之前被 sanitize 掉了，导致 0 条边。
                blockedBy: Array.isArray(t['blockedBy']) ? t['blockedBy'].filter((id): id is string => typeof id === 'string') : [],
                revision: Number.isFinite(t['revision']) ? Number(t['revision']) : undefined,
              })),
            }
          } catch (error) {
            return { available: false, reason: error instanceof Error ? error.message : String(error) }
          }
        },
        teamTask: async (payload: Record<string, unknown>) => {
          const rootSessionId = typeof payload.rootSessionId === 'string' ? payload.rootSessionId : ''
          const lead = agentsService?.get?.(rootSessionId)
          if (lead === undefined) return { ok: false, error: 'Lead Agent 不在线：先打开这个会话再试' }
          const teams = agentTeamsService
          if (typeof teams?.createTask !== 'function' || typeof teams.updateTask !== 'function' || typeof teams.listTasks !== 'function') {
            return { ok: false, error: 'experimental agentTeams 任务服务不可用' }
          }
          const action = payload.action
          try {
            if (action === 'create') {
              const subject = typeof payload.subject === 'string' ? payload.subject.trim() : ''
              if (subject === '') return { ok: false, error: '任务标题不能为空' }
              const task = await teams.createTask!(lead, {
                subject,
                description: typeof payload.description === 'string' && payload.description.trim() !== ''
                  ? payload.description
                  : subject,
              })
              const owner = typeof payload.owner === 'string' ? payload.owner.trim() : ''
              if (owner === '') return { ok: true, task }
              const created = task as { id?: unknown; revision?: unknown }
              const assigned = await teams.updateTask(lead, {
                taskId: String(created.id ?? ''),
                expectedRevision: Number(created.revision ?? 1),
                action: 'reassign',
                owner,
              })
              return { ok: true, task: assigned }
            }
            if (action === 'update') {
              // projection 的 task 行不总是带 revision（真机 task.revision undefined）。
              // 缺失时用官方 listTasks 反查当前 revision，再走同一条 CAS。
              let expectedRevision = payload.expectedRevision
              if (typeof expectedRevision !== 'number') {
                const current = await teams.listTasks!(lead) as readonly { id?: unknown; revision?: unknown }[]
                expectedRevision = current.find((row) => row.id === payload.taskId)?.revision
              }
              const doUpdate = async (revision: unknown) => teams.updateTask!(lead, {
                taskId: payload.taskId,
                expectedRevision: revision,
                action: payload.updateAction,
                ...(typeof payload.owner === 'string' && payload.owner !== '' ? { owner: payload.owner } : {}),
              })
              try {
                const task = await doUpdate(expectedRevision)
                return { ok: true, task }
              } catch (error) {
                // 官方 projection 的 task 行不带 revision 时，服务仍会报出当前 revision。
                // 只在这种“本来就没有 CAS 基线”的情况下重试一次；不是掩盖真实冲突。
                const message = error instanceof Error ? error.message : String(error)
                const match = /current revision is (\d+)/.exec(message)
                if (match !== null) {
                  const task = await doUpdate(Number(match[1]))
                  return { ok: true, task }
                }
                throw error
              }
            }
            return { ok: false, error: '未知任务动作' }
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) }
          }
        },
        reports: () => (state.currentWorld()?.events ?? [])
          .filter((event) => event.type === 'agent.report')
          .slice(-50)
          .map((event) => event as unknown as Record<string, unknown>),
        // R438：唯一的新成员入口——让主会话调用官方 spawn_teammate，不复制 NPC。
        spawnMember: async ({ name, role }) => {
          const sessionId = state.activeSessionId ?? ''
          if (sessionId === '' || typeof sessionControllerService?.prompt !== 'function') {
            return { ok: false, reason: '当前会话没有可用的 sessionController' }
          }
          const label = name === '' ? role : name
          debugLog('team.spawn', { name: label, role, sessionId })
          try {
            await sessionControllerService.prompt({
              requestId: `agent-world-spawn-${Date.now()}`,
              sessionId,
              mode: 'steer',
              content: [{
                type: 'text',
                text: `请在团队中调用 spawn_teammate 创建一个真实 subagent（角色：${role}，名字偏好：${label}）。只做这件事，不要复制 NPC，也不要在 world 里 hire。`,
              }],
            }, new AbortController().signal)
            return { ok: true }
          } catch (error) {
            return { ok: false, reason: error instanceof Error ? error.message : String(error) }
          }
        },
        history: async (agentId: string) => {
          const world = state.currentWorld()
          const actor = world?.agents.find((a) => a.id === agentId)
          const sessionId = actor?.boundAgentId ?? state.activeSessionId
          if (sessionId === null || sessionId === undefined || typeof sessionControllerService?.inspect !== 'function') {
            return { ok: false, messages: [] }
          }
          try {
            // sessionQuery 的日志含 user/message；sessionController.inspect 在真机上只回 assistant。
            const query = sessionQueryService
            const inspection = typeof query?.readSession === 'function'
              ? await query.readSession(sessionId) as { events?: readonly { type?: string; time?: number; data?: Record<string, unknown> }[] }
              : await sessionControllerService.inspect(sessionId)
            const messages: { role: 'user' | 'assistant'; text: string; time: number }[] = []
            const extract = (data: Record<string, unknown> | undefined): string => {
              const message = data?.['message'] as { content?: unknown } | undefined
              const direct = data?.['content']
              const blocks = Array.isArray(direct) ? direct : Array.isArray(message?.content) ? message.content : []
              return blocks
                .filter((block): block is { type: string; text: string } => {
                  const b = block as Record<string, unknown>
                  return b?.['type'] === 'text' && typeof b['text'] === 'string' && b['text'].trim() !== ''
                })
                .map((block) => block.text)
                .join('\n\n')
                .trim()
            }
            for (const event of inspection?.events ?? []) {
              if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
              const text = extract(event.data)
              if (text === '') continue
              // 上下文注入/调度提醒不是用户说的话，不能当成聊天气泡。
              if (/^(Current runtime context\.|This snapshot supersedes|\[SCHEDULE REMINDER|<system-reminder>|Time sampled while preparing turn|【灵枢最近记忆】)/.test(text) || text.includes('【灵枢最近记忆】')) continue
              messages.push({ role: event.type === 'user/message' ? 'user' : 'assistant', text, time: Number(event.time ?? 0) })
            }
            return { ok: true, sessionId, messages: messages.slice(-200) }
          } catch (error) {
            return { ok: false, messages: [], error: error instanceof Error ? error.message : String(error) }
          }
        },
        teamPlan: async (sessionId: string) => {
          const query = sessionQueryService
          if (typeof query?.readSession !== 'function') return null
          try {
            const snapshot = await query.readSession(sessionId) as { events?: readonly { type?: string; data?: Record<string, unknown> }[] } | undefined
            const events = snapshot?.events ?? []
            for (let i = events.length - 1; i >= 0; i -= 1) {
              const event = events[i]
              if (event?.type !== 'tool/call') continue
              const data = event.data ?? {}
              if (data.name !== 'agent_teams_create') continue
              let args: Record<string, unknown> = {}
              try { args = JSON.parse(typeof data.arguments === 'string' ? data.arguments : '{}') as Record<string, unknown> } catch { continue }
              const plan = args.plan as { members?: unknown; tasks?: unknown } | undefined
              if (plan === undefined) continue
              return {
                name: typeof args.name === 'string' ? args.name : '',
                description: typeof args.description === 'string' ? args.description : '',
                approval: typeof args.approval === 'string' ? args.approval : 'required',
                members: Array.isArray(plan.members) ? plan.members : [],
                tasks: Array.isArray(plan.tasks) ? plan.tasks : [],
              }
            }
            return null
          } catch {
            return null
          }
        },
      },
      (error, request) => {
        const detail = error instanceof Error ? error.message : String(error)
        logger.warn(`HTTP ${request.method} ${request.pathname} 出错：${detail}`)
      },
    )

    // 整个插件只占**一个**路由座位（一个前缀），所以与别的插件不可能撞——
    // 而 `webServer.register` 撞了是会抛的，且 fallback 座位已被官方 SPA 占用，不能抢。
    const dispose = webServer.register({ kind: 'prefix', path: resolved.routePrefix, handler })
    host.effect(() => dispose, 'agent-world: http routes')

    logger.info(
      `面板与 API 挂在 ${resolved.routePrefix}/（同宿主地址）· 快照 ${resolved.routePrefix}/api/world · 搭话 ${resolved.routePrefix}/api/say · 事件流 ${resolved.routePrefix}/api/events`,
    )
  })

  const restored = state.restoredFrom()
  if (restored !== null) {
    logger.info(
      `已从存档接回世界（存档在 tick ${restored.savedAtTick}，用 ${restored.packVersions
        .map((p) => `${p.id}@${p.version}`)
        .join('、')} 装）——不是新开的一局。`,
    )
  }

  logger.info(
    `已就绪：${state.describeContent()} · 世界${
      resolved.autoStart ? `每 ${state.tickMs}ms 推进一次（autoStart）` : '已建好但未开始推进（autoStart=false）'
    }`,
  )
}

/**
 * 角色 → system prompt（M6-2）。
 *
 * ## 这里做的是"取内容"，不是"造人设"
 *
 * 人设与说话方式**全部来自花名册**（决策 D37）：本函数只负责
 * **把世界里的角色对上花名册的座位**，再把世界此刻的事实一起交给
 * {@link buildCharacterSystemPrompt} 那个纯模板。所以"换一个花名册 = 换一套性格"。
 *
 * ## ⚠️ 为什么不能按 `role` 找座位（这里踩过一次）
 *
 * 默认花名册里有**三个 `engineer`**。按 `role` 反查会让这三个角色拿到**同一份人设**，
 * 而它**不会报错**——症状只是"这三个角色说话一模一样"，极难归因。
 * 所以用 `seatForAgent()`：**序号优先**（域自己的规则 `roster.seats[i] → agent-<i+1>`，
 * 见 `content/instantiate.ts`），名字兜底，名字有歧义时**宁可报错也不猜**。
 *
 * ## 失败要给出能直接下手的原因
 *
 * 拿不到人设就**抛**（而不是发一条空 prompt）：空人设的症状是"所有人都像同一个人"，
 * 那种失败比"这个角色说不出话"更难查。抛出后 bridge 会把原因变成
 * `会话创建失败：<原因>`（或者人设生成失败），一路带到面板上。
 *
 * @param state - 插件状态（读世界 + 读内容注册表）。
 */
/**
 * 角色 id → 花名册席位（R37）。
 *
 * 套壳 `dsh-agent-teams` 时，一个角色要三样东西：**成员名**（团队名册里的唯一键）、
 * **岗位**（写进成员人设的 role）、**人设正文**（走 `executionPrompt`）。
 * 这三样都从同一个席位上取，所以解析逻辑收在一处——分成三个函数就会出现三份
 * "怎么按 agent-N 找座位"的实现，迟早不一致。
 */
interface ResolvedSeat {
  readonly name: string
  readonly role: string
  readonly persona: string
}

function createSeatResolver(state: ReturnType<typeof createPluginState>): (characterId: string) => ResolvedSeat {
  return (characterId: string): ResolvedSeat => {
    const world = state.currentWorld()
    if (world === null) {
      throw new Error('世界还没建出来，读不到这个角色是谁（人设来自内容库的花名册）。')
    }

    const agent = world.agents.find((candidate) => candidate.id === characterId)
    if (agent === undefined) {
      const ids = world.agents.map((candidate) => candidate.id)
      throw new Error(
        `世界里没有 "${characterId}" 这个角色，生成不了人设。` +
          `可用角色：${ids.length > 0 ? ids.join(' / ') : '（一个都没有）'}`,
      )
    }

    // 世界记录的是"用哪个场景装出来的"，场景引用花名册。跟着这条链走，
    // 就不需要在这里写任何内容 id（写死的 id 会让换内容包变成改代码）。
    const scene = state.registry.require(
      'scenes',
      world.origin.scene,
      `给「${agent.name}」(${characterId}) 生成人设时读场景（它引用花名册）`,
    )
    const roster = state.registry.require(
      'rosters',
      scene.roster,
      `给「${agent.name}」(${characterId}) 生成人设时读花名册`,
    )

    const seat = seatForAgent(roster.seats, agent)
    if (seat === undefined) {
      const seats = roster.seats.map((s) => `${s.name}(${s.role})`)
      throw new Error(
        `花名册「${roster.id}」里找不到「${agent.name}」(${characterId}) 对应的座位，所以生成不了人设。` +
          `花名册里的座位：${seats.join(' / ')}。` +
          '（座位与角色按 agent-N ↔ 第 N 个座位的顺序对应；名字必须唯一，否则无法判断是哪一位。）',
      )
    }

    const carrying = agent.carrying
    const taskTitle =
      carrying === null ? null : (world.tasks.find((task) => task.id === carrying)?.title ?? null)

    return {
      name: seat.name,
      role: seat.role,
      persona: buildCharacterSystemPrompt(
        seat,
        {
          worldName: world.name,
          tick: world.tick,
          state: agent.state,
          stationName: stationLabel(state, agent.station),
          taskTitle,
          walkingTo: stationLabel(state, agent.targetStation),
        },
        scene.residentRules ?? [],
      ),
    }
  }
}

/** 旧签名（人设正文）：套壳路径之外的调用方还在用。 */
function createPersonaResolver(state: ReturnType<typeof createPluginState>, personas: ReturnType<typeof createPersonaStore>): (characterId: string) => string {
  const resolve = createSeatResolver(state)
  const GAME_PROMPT = [
    '你现在在一个可玩的办公室里，而不是只做文本问答。',
    '保持角色人设；最终回复必须固定结构：第一行「结论：<一句话>」，可选第二行「下一步：<一句话>」。',
    '不要输出思考过程、工具调用日志、逐步执行流水账；中间过程不要进对话正文。',
    '详细说明只放在对话面板正文里；头顶气泡只显示「结论」这一句，保持简短。',
    '用「正在写代码 / 正在查信息 / 正在计划 / 正在开会」这类短状态描述当前动作，不要长段落。',
    '进入游戏世界时给自己取一个游戏角色名（例：阿金、小青、小紫），在对话和任务署名里使用；官方 projection 的成员名是唯一真相，不要另造一套并行身份。',
    '你拥有 level / skills / preferences 的游戏化设定：升级靠完成任务，技能决定你更适合工位、会议还是休息。',
    '每次行动要能在场景里对应到工作 / 开会 / 休息；不知道做什么时，先看世界状态再决定。',
  ].join('\n')
  return (characterId) => {
    const seat = resolve(characterId)
    const world = state.currentWorld()
    const actor = world?.agents.find((agent) => agent.id === characterId)
    const key = actor?.boundAgentId ?? actor?.id ?? characterId
    const saved = personas.get(key) ?? personas.upsert({ id: key, name: actor?.name ?? key, role: actor?.role ?? 'engineer', prompt: seat.persona })
    // 把等级/技能/任务关联注入，让 subagent 不只是“知道人设”，还知道自己的成长与手头关系。
    const growth = [
      `Level ${saved.level} / XP ${saved.xp}`,
      saved.skills.length > 0 ? `Skills: ${saved.skills.join(', ')}` : 'Skills: 尚未学习',
      saved.taskIds.length > 0 ? `Linked tasks: ${saved.taskIds.slice(-5).join(', ')}` : 'Linked tasks: 无',
      saved.prompt.trim() !== '' ? `Persona note: ${saved.prompt}` : '',
    ].filter(Boolean).join('\n')
    return `${seat.persona}\n\n${GAME_PROMPT}\n\n${growth}`
  }
}

/**
 * 站点 id → 站点名。
 *
 * 站点名是**内容**，所以走注册表取；取不到时退回 id 本身——
 * 那也是事实（比编一个名字诚实），而且不会因为一个名字缺失就让人设生成失败。
 */
function stationLabel(state: ReturnType<typeof createPluginState>, stationId: string | null): string | null {
  if (stationId === null) return null
  return state.registry.get('stations', stationId)?.data.name ?? stationId
}
