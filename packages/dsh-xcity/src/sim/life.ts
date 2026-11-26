/**
 * R476：角色自己安排生活。
 *
 * 用户要的不是"等着被派活或收到短信才动"，而是没活干的时候也按时间过日子。
 * 这里只做**最小的一天**：上班时段自己去工位干活，其余时间交给待命行为
 * （走回歇脚点、张望、踱步、歇息）——不新增状态机、不新增内容库。
 *
 * 为什么用 tick 推时间而不再存一份时钟：慢谷的换算就是 **1 tick = 1 游戏分钟**
 * （adapters/slowvale/types.ts 的 TICKS_PER_GAME_MINUTE），前端时钟也按它算。
 * 世界自己再存一个"现在几点"只会多一个会漂移的真相。
 *
 * 为什么只在没有 ready 工单时才自派：有单的时候调度器才是主导，自派会把
 * 空闲的人先占成 working，工单反而派不出去。
 */
import type { Agent, World } from '../domain/types.js'
import type { WorldCommand } from '../protocol/wire/commands.js'

/** 一天多少游戏分钟（= 多少 tick）。 */
const MINUTES_PER_DAY = 1440

/** 上班时段：[09:00, 12:00) 与 [14:00, 18:00)。 */
const WORK_WINDOWS: readonly (readonly [number, number])[] = [
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60],
]

/** 角色的活用什么能力找工位；没有对应能力就退回 code。 */
const SKILL_OF_ROLE: Record<Agent['role'], 'code' | 'review' | 'research' | 'compute'> = {
  lead: 'review',
  engineer: 'code',
  reviewer: 'review',
  researcher: 'research',
  ops: 'compute',
  docs: 'code',
}

export function isWorkMinute(tick: number): boolean {
  const minute = ((Math.floor(tick) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return WORK_WINDOWS.some(([from, to]) => minute >= from && minute < to)
}

/** 这个人现在能不能被"自己"安排：站着、没拿单、没有活动、没有目标站点。 */
function available(agent: Agent): boolean {
  return (
    agent.state === 'idle' &&
    agent.carrying === null &&
    agent.activityUntil === undefined &&
    agent.station === null &&
    agent.targetStation === null &&
    agent.path.length === 0
  )
}

/**
 * 本 tick 由角色自己发起的活动命令。
 *
 * @param world - 世界（只读；命令由调用方交给 step）。
 */
export type SelfLifeCommand = Extract<WorldCommand, { kind: 'agentActivity' }>

export function selfLifeCommands(world: World): SelfLifeCommand[] {
  if (!isWorkMinute(world.tick)) return []
  // 有单等人领时不抢人：先让调度器派工。
  if (world.tasks.some((task) => task.status === 'ready')) return []

  const commands: SelfLifeCommand[] = []
  for (const agent of world.agents) {
    if (!available(agent)) continue
    commands.push({
      kind: 'agentActivity',
      agentId: agent.id,
      activity: 'work',
      ticks: 60,
      skill: SKILL_OF_ROLE[agent.role] ?? 'code',
      trigger: { kind: 'self', text: '到了上班的点，自己去干活' },
    })
  }
  return commands
}
