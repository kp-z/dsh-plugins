/**
 * `visual` 包：让角色在场景里"动起来/说一句话"。
 *
 * ## 为什么对话走这条路，而不是聊天接口
 *
 * 前端渲染对话只认一种东西：视觉时间轴上的一拍（beat）。
 * SceneActor 里就一行——`beat.dialogue && this._spawnSpeechBubble(beat.dialogue)`。
 * 所以"角色开口"不是发一条消息给别人看，而是**给那个角色的时间轴塞一拍**。
 *
 * ## 包的结构（从 bundle 里读出来的）
 *
 * 信封：kind='visual'，payload 里必须带 `epoch` / `seq` / `tick_marker`，
 * 且 **payload.tick_marker 必须与信封一致**（否则前端直接丢弃并报错）。
 *
 * 时间轴有两种：
 * - `kind='independent'`：一个角色自己的 `beats[]`；
 * - `kind='group'`：`participants[]` + `steps[].tracks[actorId]`（多人同框时用）。
 *
 * 说话也走 independent（一拍 dialogue），见 sayBeat；
 * 非语言的头顶反馈（「嗯」「！」）走 floatTextBeat，两条通道不要合并。
 */
/** 一拍的形状。前端按字段存在与否决定渲染方式：body / dialogue / bubble / toast。 */
export interface VisualBeat {
  beat_type?: string
  dialogue?: Record<string, unknown>
  bubble?: Record<string, unknown>
  body?: Record<string, unknown>
  toast?: Record<string, unknown>
  /** 这一拍持续多久（ms）；不给就用前端默认。 */
  duration_ms?: number
}

/**
 * 造一拍：前端只认 body.action + 参数（动作表见 docs/DRIVE-MODEL.md）。
 */
export function actionBeat(action: string, extra: Record<string, unknown> = {}, durationMs?: number): VisualBeat {
  const beat: VisualBeat = { body: { action, ...extra } }
  if (durationMs !== undefined) beat['duration_ms'] = durationMs
  return beat
}

/** R496-03：镜像从 to_anchor 寻路；pose 的 approach 由地图决定。 */
export function walkBeat(path: { x: number; y: number }[], durationMs?: number, poseId?: string): VisualBeat {
  const end = path.at(-1)
  const to_anchor = poseId !== undefined ? { kind: 'pose', id: poseId } : end === undefined ? { kind: 'current' } : { kind: 'point', ...end }
  return actionBeat('walk', { to_anchor }, durationMs)
}

/**
 * R538-01：对话通道的 tone 白名单。
 *
 * 前端 `JL(actor, text, tone)` 拿 tone 去查气泡样式表 `Mp`（GameView.js:92726-92733），
 * 查不到就抛 `[SpeechBubble] 未知 tone`。在拍产出时拦住，早失败好过前端 crash。
 */
export const DIALOGUE_TONES = ['speech', 'thought', 'sms'] as const
export type DialogueTone = (typeof DIALOGUE_TONES)[number]

/**
 * R538-04：谁看得到这句话。前端 s5/r5（GameView.js:93138-93166）只认这两种形状，
 * 缺了 audience 不是"少显示一个泡"，而是 throw `[dialogue] 缺少 audience`。
 *
 * - place：同场景（同 place_id）的人都能看到——我们的默认；
 * - role_ids：只给名单里的人看。
 *
 * 注意 god 视角（前端没有 currentRoleId 时走 r5）：place 返回 true、role_ids 返回 false。
 * 所以想"让所有人都看到"就发 place，别两种都发。
 */
export type DialogueAudience =
  | { kind: 'place'; place_id: string }
  | { kind: 'role_ids'; role_ids: string[] }

/** R538-05：sayBeat 的入参。选项对象比四个位置参好 review（也不会传错序）。 */
export interface SayBeatOptions {
  speakerId: string
  audience: DialogueAudience
  tone?: DialogueTone
}

/**
 * R538-02：说话 = 一拍 dialogue（走前端真正的说话泡 `_spawnSpeechBubble`）。
 *
 * 为什么 speaker_id 是硬要求：前端第一行就是
 * `if (!g.speaker_id) throw new Error("[dialogue] 缺少 speaker_id")`（GameView.js:93879）。
 *
 * 为什么空文本返回空拍而不是抛错：`JL` 里 `if (!g) throw new Error("泡内容为空")`（:92751），
 * 而"这一轮没话可说"是正常情况——空拍（没有 body/dialogue/bubble）前端什么都不渲染。
 */
export function sayBeat(text: string, options: SayBeatOptions): VisualBeat {
  const { speakerId, audience, tone = 'speech' } = options
  if (speakerId === '') throw new Error('[dialogue] 缺少 speaker_id')
  if (!DIALOGUE_TONES.includes(tone)) {
    throw new Error(`[visual] 未知 tone: ${String(tone)}（只允许 ${DIALOGUE_TONES.join('/')}）`)
  }
  assertAudience(audience)
  if (text.trim() === '') return {}
  return { dialogue: { speaker_id: speakerId, text, tone, audience } }
}

/**
 * R538-06：audience 形状校验。
 *
 * 报错文案照前端 s5/r5 抄（"缺少 audience"/"place audience 缺少 place_id"/
 * "role_ids audience 缺少角色名单"），日志里一眼能对上是谁拦的。
 */
function assertAudience(audience: unknown): asserts audience is DialogueAudience {
  const kind = (audience as { kind?: unknown } | null | undefined)?.kind
  if (kind === undefined) throw new Error('[dialogue] 缺少 audience')
  if (kind === 'place') {
    if (!(audience as { place_id?: unknown }).place_id) throw new Error('[dialogue] place audience 缺少 place_id')
    return
  }
  if (kind === 'role_ids') {
    const roleIds = (audience as { role_ids?: unknown }).role_ids
    if (!Array.isArray(roleIds) || roleIds.length === 0) throw new Error('[dialogue] role_ids audience 缺少角色名单')
    return
  }
  throw new Error(`[dialogue] 未知 audience.kind: ${String(kind)}`)
}

/**
 * R538-03：非语言反馈的头顶浮字（原 R507 的 `bubble.float_up`）。
 *
 * 前端：`beat.bubble.text && beat.bubble.float_up && this._spawnFloatText(...)`（:93839）。
 * 这条通道**不带名字**，只适合「嗯」「！」这类反应；要说话请用 sayBeat。
 */
export function floatTextBeat(text: string): VisualBeat {
  return { bubble: { text, float_up: true } }
}

/** 在工位干活。 */
export function workBeat(durationMs?: number): VisualBeat {
  return actionBeat('work', {}, durationMs)
}

/** 若干拍打成一个 independent 时间轴（单个角色）。 */
export function independentTimeline(input: {
  epoch: string
  seq: number
  tickMarker: string
  actorId: string
  beats: VisualBeat[]
  endState?: Record<string, unknown> | undefined
  commitState?: Record<string, unknown> | undefined
}): Record<string, unknown> {
  return {
    epoch: input.epoch,
    seq: input.seq,
    tick_marker: input.tickMarker,
    playback: { kind: 'independent', tracks: { [input.actorId]: input.beats } },
    ...(input.endState === undefined ? {} : { end_states: { [input.actorId]: input.endState } }),
    ...(input.commitState === undefined ? {} : { actor_commit_states: { [input.actorId]: input.commitState } }),
  }
}

/** R496：仅换轴。异源办公室的工位必须另用地图 pose，不能把这里的点当作桌位。 */
export function walkPathOf(agent: { path?: { x: number; z: number }[] }): { x: number; y: number }[] {
  return (agent.path ?? []).map((point) => ({ x: point.x, y: point.z }))
}

/**
 * 谁需要发一条 walk：只看「路径从无到有」这一跳。
 *
 * 为什么不是每帧都发：beat 是"一次动作"，不是位置流。位置流由快照的 actors 承担；
 * 每帧发 beat 会让前端反复重启动画。
 */
export function pickWalkStarts(
  previous: Map<string, number>,
  agents: readonly { id: string; path?: { x: number; z: number }[] }[],
): { started: { agentId: string; path: { x: number; y: number }[] }[]; next: Map<string, number> } {
  const next = new Map<string, number>()
  const started: { agentId: string; path: { x: number; y: number }[] }[] = []
  for (const agent of agents) {
    const length = agent.path?.length ?? 0
    next.set(agent.id, length)
    const before = previous.get(agent.id) ?? 0
    if (length > 0 && before === 0) started.push({ agentId: agent.id, path: walkPathOf(agent) })
  }
  return { started, next }
}

/**
 * 多人同框的一段时间轴（前端 Sb() 那一段读的就是 participants + steps[].tracks）。
 *
 * 为什么不自己拼 participants：前端判断"这一包跟我有没有关系"用的是
 * participants.includes(actorId) 和 steps.some(x => x.tracks[actorId])，
 * 两处必须一致；由 steps 推导是唯一不会写岔的写法。
 */
export function groupTimeline(input: {
  epoch: string
  seq: number
  tickMarker: string
  steps: { tracks: Record<string, VisualBeat> }[]
}): Record<string, unknown> {
  const participants: string[] = []
  for (const step of input.steps) {
    for (const actorId of Object.keys(step.tracks)) {
      if (!participants.includes(actorId)) participants.push(actorId)
    }
  }
  return {
    epoch: input.epoch,
    seq: input.seq,
    tick_marker: input.tickMarker,
    kind: 'group',
    participants,
    steps: input.steps,
  }
}
