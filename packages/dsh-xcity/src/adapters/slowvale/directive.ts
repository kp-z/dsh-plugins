/**
 * 把一句人话变成一条世界指令。
 *
 * 为什么要有这一层：短信/会话里的回复是自然语言，世界只认「去哪个地点、做什么」。
 * 这一层只做**词表匹配**（地点的 label 与常见别名），不做任何"智能推断"——
 * 匹配不到就返回 null，由调用方决定怎么回（比如请对方说得具体点）。
 *
 * 依据：地点清单来自 stage.ts 的 DEFAULT_CIRCUIT（这些 id 是前端规则表能命中的）。
 */

export interface Directive {
  /** work = 到工位干活；rest = 回家；visit = 只是过去待着。 */
  kind: 'work' | 'rest' | 'visit'
  placeId: string
  /** 命中的词，便于回执时说明"我是因为听到什么才这么做的"。 */
  matched: string
}

interface PlaceLike {
  id: string
  label: string
  asset: string
}

/** 每个地点额外认的别名（label 本身也会匹配）。 */
const ALIASES: Record<string, string[]> = {
  'place:office.tech_company_1': ['办公室', '公司', '上班', '工位', 'tech_company'],
  'place:residential.apartment_1': ['公寓', '家', '回去', '回家', '睡觉'],
  'place:residential.mini_market': ['便利店', '超市', '买东西'],
  'place:commercial.city_restaurant': ['餐馆', '吃饭', '餐厅'],
  'place:downtown.city_gym': ['健身房', '锻炼', '运动'],
  'place:outdoor.sunset_beach': ['海滩', '海边', '散步'],
}

const WORK_WORDS = ['工作', '上班', '干活', '打工']

export function parseDirective(text: string, places: readonly PlaceLike[]): Directive | null {
  const input = text.trim()
  if (input === '') return null

  let placeId: string | null = null
  let matched = ''
  for (const place of places) {
    const words = [place.label, ...(ALIASES[place.id] ?? [])]
    for (const word of words) {
      if (word !== '' && input.includes(word) && word.length > matched.length) {
        placeId = place.id
        matched = word
      }
    }
  }
  if (placeId === null) return null

  const wantsWork = WORK_WORDS.some((word) => input.includes(word))
  const kind: Directive['kind'] = wantsWork ? 'work' : placeId.includes('apartment') ? 'rest' : 'visit'
  return { kind, placeId, matched }
}

/**
 * 把指令翻成世界已经在用的命令。
 *
 * 关键点：**世界本来就有这个命令**（protocol 的 agentActivity），它已经会「按能力挑站点 →
 * findPath → state=walking」。这里不新造动作语义，只做映射，避免出现第二套"怎么去上班"的实现。
 *
 * @returns 命令；世界暂时做不到的（比如还没建模的地点）返回 null。
 */
export function directiveToCommand(
  directive: Directive,
  agentId: string,
  ticks = 60,
): { kind: 'agentActivity'; agentId: string; activity: 'work' | 'rest'; ticks: number; skill?: 'code' } | null {
  if (directive.placeId !== 'place:office.tech_company_1') return null
  if (directive.kind === 'work') return { kind: 'agentActivity', agentId, activity: 'work', ticks, skill: 'code' }
  if (directive.kind === 'rest') return { kind: 'agentActivity', agentId, activity: 'rest', ticks }
  return null
}
