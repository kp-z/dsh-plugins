/**
 * R500：每日一次计划的"怎么问"与"怎么解析"。
 *
 * 编排在 `bridge/daily-plan.ts`：06:30 问一次、一天只问一次、失败不回滚世界。
 * 这里只管两件纯事：
 *
 * - **R500-1 怎么问**（{@link buildPlanPrompt}）：把"我是谁 + 今天已经发生了什么 + 认识谁"拼成
 *   一段指令，让模型**只吐一个 JSON 数组**。散文没人消费，还会和记忆里的"今天干了什么"打架。
 * - **R500-2..4 怎么解析**（{@link parsePlan}）：从模型原文里取出数组，逐条严格校验；
 *   **非法条目只丢这一条**并记下中文原因，不整段失败——模型偶尔多写一行解释，不该让今天没有计划。
 *
 * 纯函数：没有 `Date.now()`、没有 `Math.random()`、不读文件、不调模型。
 * 于是"提示词里确实写进了今天的摘要""非法的 due 确实被丢了"这两件事可以被单测证明，
 * 而不是只能读代码相信。1 tick = 1 游戏分钟；一天 1440 tick（与 `sim/day-summary.ts` 同口径）。
 */
import type { Commitment } from '../domain/types.js'

/** 一天最多几条：不是性能考虑，是**只有两条才做得完**。 */
export const MAX_PLAN_ITEMS = 2
/** 提示词里要的字数上限（软预算，模型照着写）。 */
const WHAT_PROMPT_CHARS = 20
/**
 * 校验时容忍的字数上限。**故意比提示词宽**：提示要 20 字，模型多写几个字是好答案，
 * 不该因为 23 字整条报废；但写到 40 字以上就不是"一件能验收的事"了，丢掉。
 */
const WHAT_MAX_CHARS = 40
const DAY_TICKS = 1440

/** 一个"认识的人"：id 是模型要写进 `with` 的值，name 只用来让模型看懂谁是谁。 */
export interface PlanPeer {
  id: string
  name: string
}

export interface PlanPromptInput {
  /** 这个角色的名字（内容库里的显示名）。 */
  agentName: string
  /** 这个角色是谁（内容库的 persona）。 */
  persona: string
  /** 今天已经发生了什么，一行一件（`summarizeDay` 的输出直接可用）。 */
  todaySummary: readonly string[]
  /** 他认识谁；空数组 = 今天谁都不认识，只能自己干。 */
  knownPeers: readonly PlanPeer[]
  /** 现在几点（绝对 tick）。 */
  nowTick: number
}

/** 绝对 tick → 当天 HH:mm（与 `sim/day-summary.ts` 的 hhmm 同口径）。 */
function clockOf(tick: number): string {
  const minute = ((Math.floor(tick) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS
  return String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0')
}

/** 当天 00:00 的绝对 tick。 */
function dayStartOf(tick: number): number {
  return Math.floor(Math.max(0, tick) / DAY_TICKS) * DAY_TICKS
}

/**
 * R500-1：拼出"今天想做什么"的指令。
 *
 * 只说事实（现在几点、今天做过什么、认识谁），不下性格判断——性格已经在 system prompt 里了，
 * 这里再描述一遍只会稀释指令。
 *
 * @returns 给角色会话的一整段中文指令；调用方负责把它送出去。
 */
export function buildPlanPrompt(input: PlanPromptInput & { yesterday?: string }): string {
  const clock = clockOf(input.nowTick)
  const summary = input.todaySummary.length === 0
    ? ['（今天还没有任何记录）']
    : input.todaySummary.map((line) => '- ' + line)
  const peers = input.knownPeers.length === 0
    ? ['（今天还没有认识的人）']
    : input.knownPeers.map((peer) => '- ' + peer.id + '：' + peer.name)
  // 示例用**他认识的第一个人**，模型照着改就能用；一个都不认识时用空字符串（自己干）。
  const samplePeer = input.knownPeers[0]?.id ?? ''
  const sample =
    '[{"with":"' + samplePeer + '","what":"去仓库看看缺什么","due":"15:00"},' +
    '{"with":"","what":"把手上的活收尾","due":"18:00"}]'

  return [
    '你是「' + input.agentName + '」。现在是 ' + clock + '，新的一天开始了，请安排今天。',
    '',
    '## 你是谁',
    input.persona,
    '',
    // R516：把**昨天**也给他。原来的「今天已经发生的事」取的是当天 00:00 起的活动，
    // 而典型作息 23:00–07:00 在睡觉——于是每天 06:30 生成计划时这一段基本是空的，
    // 等于让人在没有昨天的情况下安排今天。
    ...(input.yesterday === undefined || input.yesterday.trim() === ''
      ? []
      : ['## 昨天你怎么过的', input.yesterday.trim(), '']),
    '## 今天已经发生的事',
    ...summary,
    '',
    '## 你认识的人',
    ...peers,
    '',
    '## 要你做的事',
    '想清楚今天要做成哪几件事（最多 ' + MAX_PLAN_ITEMS + ' 条），每件都要能验收。',
    '',
    '**只输出一个 JSON 数组，不许散文、不许解释、不要 markdown 代码块以外的任何文字。**',
    '每条一个对象，字段固定为 with / what / due，例如：',
    sample,
    '',
    '字段规则：',
    '- with：和谁一起做。必须是上面「你认识的人」里的 id；自己一个人做就填空字符串 ""。',
    '- what：做什么。' + WHAT_PROMPT_CHARS + ' 字以内，要具体到能判断做没做完（"把事情想清楚"不算）。',
    '- due：几点做完。24 小时制 HH:mm，必须晚于现在（' + clock + '），只算今天之内。',
    '',
    '做不到（今天不想安排，或者没想好）就只输出 []，这比你编一件假事要好。',
  ].join('\n')
}

/** 一条被丢掉的条目为什么被丢；code 用来分类，reason 给人看。 */
export type PlanRejectCode =
  | 'no-array'
  | 'too-many'
  | 'not-object'
  | 'bad-with'
  | 'unknown-peer'
  | 'empty-what'
  | 'what-too-long'
  | 'bad-due'
  | 'due-passed'

export interface PlanRejection {
  /** 第几条（0 起）；整段没解析出数组时是 -1（那不是某一条的问题）。 */
  index: number
  code: PlanRejectCode
  /** 中文原因，已带上出问题的那个值——写日志时不用再回原文找。 */
  reason: string
}

export interface PlanParseResult {
  /** 通过校验的承诺；已填好 source/status/createdAtTick/dueTick，调用方直接落世界。 */
  commitments: Commitment[]
  /** 被丢掉的条目（含原因）。空数组 = 模型这次答得很干净。 */
  rejected: PlanRejection[]
}

export interface PlanParseInput {
  /** 现在几点（绝对 tick），用来算 dueTick 与判断"是不是已经过去"。 */
  nowTick: number
  /** 这个角色（写进 id，便于事后追查是哪次计划产生的）。 */
  agentId: string
  /** 认识的人；`with` 只能从这里选，或留空。 */
  peerIds: readonly string[]
}

/**
 * R500-2：从 `start` 处的 `[` 找到与之配对的 `]`（字符串内的括号不算）。
 *
 * @returns 配平的一段原文；文本没配平（模型被截断）时 `null`。
 */
function balancedArrayAt(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text.charAt(i)
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * R500-2：取出原文里**第一个能解析成数组**的片段。
 *
 * 不专门去剥代码围栏：围栏只是插了一段 ``` 和语言名，从第一个 `[` 开始配平，
 * 围栏里的数组照样能取到，代码反而更短。遇到"散文里先冒出一个 `[`"的情况就试下一个。
 */
function firstJsonArray(text: string): unknown[] | null {
  for (let at = text.indexOf('['); at >= 0; at = text.indexOf('[', at + 1)) {
    const slice = balancedArrayAt(text, at)
    if (slice === null) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(slice)
    } catch {
      continue
    }
    if (Array.isArray(parsed)) return parsed
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** HH:mm → 当天的绝对 tick；格式不对返回 `null`。 */
function dueTickOf(raw: unknown, nowTick: number): number | null {
  if (typeof raw !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (match === null) return null
  const hours = Number.parseInt(match[1] ?? '', 10)
  const minutes = Number.parseInt(match[2] ?? '', 10)
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (hours > 23 || minutes > 59) return null
  const today = dayStartOf(nowTick) + hours * 60 + minutes
  // R500-5：游戏时钟是 1 tick = 1 分钟、100ms 一跳（1 游戏小时 = 6 秒）——问完到答完
  // 世界已经过了几十分钟。所以 HH:mm 表示"下一个该时刻"，已过就顺延到明天，
  // 否则「今天上午」的安排会在回答落地的瞬间被判过期，静默丢掉。
  return today > nowTick ? today : today + 1440
}

/**
 * R500-3/4：解析模型原文 → 承诺 + 被丢弃的条目。
 *
 * 校验口径（顺序即判定顺序，先命中的原因胜出）：
 * 1. 整段取不出数组 → `no-array`（index -1）；
 * 2. 第 3 条起 → `too-many`（**先按条数截，再校验内容**：超额的条目本来就不会被用，不必再挑它别的毛病）；
 * 3. 不是对象 → `not-object`；
 * 4. `with` 不是字符串或不在 `peerIds` 里 → `bad-with` / `unknown-peer`（空字符串 = 自己一个人）；
 * 5. `what` 空 → `empty-what`；超过 40 字 → `what-too-long`（字段单位是字符，一个汉字算一个）；
 * 6. `due` 不是 HH:mm → `bad-due`；不晚于现在 → `due-passed`。
 *
 * **"落在未来 24h 内"是结构性成立的**：HH:mm 一律按**今天**映射，晚于现在最多 1439 分钟，
 * 所以不需要再补一道 24h 判断（跨午夜的那种口径见文件末尾的 TODO）。
 *
 * 多余字段一律忽略——承诺只从 `with/what/due` 三个字段来，模型的注释性字段不该漏进世界状态。
 */
export function parsePlan(text: string, input: PlanParseInput): PlanParseResult {
  const rejected: PlanRejection[] = []
  const raw = typeof text === 'string' ? text : ''

  if (raw.trim() === '') {
    rejected.push({ index: -1, code: 'no-array', reason: '模型什么都没返回' })
    return { commitments: [], rejected }
  }

  const entries = firstJsonArray(raw)
  if (entries === null) {
    rejected.push({ index: -1, code: 'no-array', reason: '输出里找不到能解析的 JSON 数组' })
    return { commitments: [], rejected }
  }

  const commitments: Commitment[] = []
  for (let index = 0; index < entries.length; index += 1) {
    // R500-3a：先按条数截断。
    if (index >= MAX_PLAN_ITEMS) {
      rejected.push({
        index,
        code: 'too-many',
        reason: '一天最多 ' + MAX_PLAN_ITEMS + ' 条，多出来的这条被丢弃',
      })
      continue
    }

    const entry = entries[index]
    if (!isRecord(entry)) {
      rejected.push({ index, code: 'not-object', reason: '这一条不是 JSON 对象' })
      continue
    }

    // R500-4a：with —— 空字符串是合法的"我一个人做"。
    const withRaw = entry.with
    let withId: string | null
    if (withRaw === undefined || withRaw === '') withId = ''
    else if (typeof withRaw === 'string') withId = withRaw.trim()
    else withId = null
    if (withId === null) {
      rejected.push({ index, code: 'bad-with', reason: 'with 必须是字符串，收到的是 ' + JSON.stringify(withRaw) })
      continue
    }
    if (withId !== '' && !input.peerIds.includes(withId)) {
      rejected.push({
        index,
        code: 'unknown-peer',
        reason: 'with 不在认识的人里：' + withId,
      })
      continue
    }

    // R500-4b：what。
    const what = typeof entry.what === 'string' ? entry.what.trim() : ''
    if (what === '') {
      rejected.push({ index, code: 'empty-what', reason: 'what 是空的' })
      continue
    }
    if (what.length > WHAT_MAX_CHARS) {
      rejected.push({
        index,
        code: 'what-too-long',
        reason: 'what 有 ' + String(what.length) + ' 字，超过 ' + String(WHAT_MAX_CHARS) + ' 字上限',
      })
      continue
    }

    // R500-4c：due。
    const dueTick = dueTickOf(entry.due, input.nowTick)
    if (dueTick === null) {
      rejected.push({
        index,
        code: 'bad-due',
        reason: 'due 必须是 24 小时制的 HH:mm，收到的是 ' + JSON.stringify(entry.due),
      })
      continue
    }
    if (dueTick <= input.nowTick) {
      rejected.push({
        index,
        code: 'due-passed',
        reason: 'due ' + clockOf(dueTick) + ' 不晚于现在（' + clockOf(input.nowTick) + '）',
      })
      continue
    }

    commitments.push({
      // 纯函数不能摇随机数：id 由角色 + 到期时刻 + 序号决定，同一次输入永远同一个 id。
      // 这是**占位 id**：真正落世界要走 sim/commitments.ts 的 promiseBetween，那时由它用
      // commitmentId(双方, what, day) 重写（它负责双写与幂等）。这里不直接复用 commitmentId，
      // 是因为它要"当天 + 对方"两个只有世界侧才知道的量，而解析器只该看模型原文。
      id: 'plan-' + input.agentId + '-' + String(dueTick) + '-' + String(index),
      with: withId,
      what,
      dueTick,
      status: 'open',
      source: 'plan',
      createdAtTick: input.nowTick,
    })
  }

  return { commitments, rejected }
}

// TODO(口径待定)：目前 HH:mm 一律解释成"今天"。如果哪天要求 06:30 也能安排"明天凌晨",
// 就在 dueTickOf 里按"早于现在则顺延一天"处理，并把测试里 due-passed 那条改成"等于现在"。
