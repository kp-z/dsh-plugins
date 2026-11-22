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
