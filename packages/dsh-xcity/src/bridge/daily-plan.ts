/**
 * R500：每天一次的计划。角色自己在 06:30 想一下今天要做什么，产出**结构化承诺**，
 * 不产出散文——散文没人消费，还会和记忆里的"今天干了什么"打架。
 *
 * 这个模块只做编排：什么时候问、问谁、失败了怎么办。怎么问（prompt）与怎么解析
 * 分别由 bridge/plan-prompt.ts 与 sim/commitments.ts 负责，IO 由调用方注入。
 */
import type { Commitment } from '../domain/types.js'

/** 06:30 开始问；一天只问一次。 */
export const PLAN_MINUTE = 6 * 60 + 30
const DAY_TICKS = 1440

export interface DailyPlanDeps {
  /** 问一个角色；返回模型原文，失败返回 null（不抛）。 */
  ask: (agentId: string, prompt: string) => Promise<string | null>
  /** 组装提示词。 */
  promptFor: (agentId: string, day: number) => string
  /** 把解析出来的承诺落到世界（双方各一条由调用方保证）。 */
  apply: (agentId: string, commitments: readonly Commitment[]) => void
  /** 解析模型原文；非法条目自己丢弃。 */
  parse: (text: string, agentId: string, day: number) => readonly Commitment[]
  log?: (line: string) => void
}

export interface DailyPlanner {
  /** 每 tick 调一次；返回本 tick 真正发起的提问数。 */
  tick: (agents: readonly { id: string }[], tick: number) => number
  /** 今天问过没有（测试与诊断用）。 */
  askedOn: (agentId: string) => number | null
  /** 停掉在途提问（插件卸载）。 */
  stop: () => void
}

export function createDailyPlanner(deps: DailyPlanDeps): DailyPlanner {
  const asked = new Map<string, number>()
  let stopped = false

  return {
    tick(agents, tick) {
      if (stopped) return 0
      const minute = ((Math.floor(tick) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS
      if (minute !== PLAN_MINUTE) return 0
      const day = Math.floor(Math.max(0, tick) / DAY_TICKS) + 1
      let started = 0
      for (const agent of agents) {
        if (asked.get(agent.id) === day) continue
        asked.set(agent.id, day)
        started += 1
        // 不 await：一次提问不能挡住世界推进。
        void (async () => {
          try {
            const text = await deps.ask(agent.id, deps.promptFor(agent.id, day))
            if (stopped || text === null || text.trim() === '') return
            const commitments = deps.parse(text, agent.id, day)
            if (commitments.length > 0) deps.apply(agent.id, commitments)
          } catch (error: unknown) {
            deps.log?.('每日计划失败（已忽略）agent=' + agent.id + '：' + String(error))
          }
        })()
      }
      return started
    },
    askedOn(agentId) {
      return asked.get(agentId) ?? null
    },
    stop() {
      stopped = true
    },
  }
}
