/**
 * R481：把"学完了"结算进 persona。
 *
 * persona 只有 skills（会不会）+ xp（总熟练度），没有"每技能等级"——
 * 不为了学习再造一套等级表。一次完成的学习块 = 1 XP；同一 activityId 只结算一次。
 */
import type { PersonaStore } from './store.js'

export interface StudyCompletion {
  activityId: string
  skill: string | null | undefined
}

/**
 * 结算一次学习。
 *
 * @param seen - 本进程已经结算过的 activityId（挡住重复事件）；调用方持有。
 * @returns 真的加了 XP 才返回 true。
 */
export function awardStudyXp(store: PersonaStore, key: string, completion: StudyCompletion, seen: Set<string>): boolean {
  const activityId = completion.activityId
  if (activityId === '' || seen.has(activityId)) return false
  const persona = store.get(key)
  if (persona === null) return false

  seen.add(activityId)
  const skill = (completion.skill ?? '').trim()
  const skills = skill !== '' && !persona.skills.includes(skill) ? [...persona.skills, skill] : persona.skills
  if (skills !== persona.skills) store.upsert({ id: key, skills })
  store.addXp(key, 1)
  return true
}
