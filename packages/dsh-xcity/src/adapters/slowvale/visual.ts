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
 * 这里只实现 independent——一个人说一句话，够用了。
 */
export interface DialogueBeat {
  /** 说话内容。 */
  text: string
  /** 气泡停留时长（ms）；不给就用前端默认。 */
  durationMs?: number
}

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

/** 构造一个"某角色说了一句话"的 visual 包。 */
export function independentDialogue(input: {
  epoch: string
  seq: number
  tickMarker: string
  actorId: string
  beat: DialogueBeat
}): Record<string, unknown> {
  const dialogue: Record<string, unknown> = { text: input.beat.text }
  if (input.beat.durationMs !== undefined) dialogue['duration_ms'] = input.beat.durationMs
  return {
    epoch: input.epoch,
    seq: input.seq,
    tick_marker: input.tickMarker,
    kind: 'independent',
    actorId: input.actorId,
    beats: [{ dialogue }],
  }
}

/**
 * 造一拍：前端只认 body.action + 参数（动作表见 docs/DRIVE-MODEL.md）。
 */
export function actionBeat(action: string, extra: Record<string, unknown> = {}, durationMs?: number): VisualBeat {
  const beat: VisualBeat = { body: { action, ...extra } }
  if (durationMs !== undefined) beat['duration_ms'] = durationMs
  return beat
}

/** 走过去：路径点由后端算，前端只按点走。 */
export function walkBeat(path: { x: number; y: number }[], durationMs?: number): VisualBeat {
  return actionBeat('walk', { path }, durationMs)
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
}): Record<string, unknown> {
  return {
    epoch: input.epoch,
    seq: input.seq,
    tick_marker: input.tickMarker,
    kind: 'independent',
    actorId: input.actorId,
    beats: input.beats,
  }
}

/**
 * 把世界里的剩余路径点换成 beat 需要的 {x, y}。
 *
 * 坐标**不需要换算**：actorsOf 里就是 x = position.x、y = position.z，
 * 也就是世界坐标本身就是地图像素（舞台行走一直用这套）。这里只改字段名，
 * 不引入一个没有依据的缩放系数。
 */
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
