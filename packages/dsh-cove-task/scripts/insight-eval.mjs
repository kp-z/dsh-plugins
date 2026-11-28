/**
 * 诊断评测材料生成器（不调模型、不写状态）。
 *
 * 用途：把「宿主实际会发给模型的 system + material」原样打印成 JSON，
 * 交给外部模型跑一次，再用 insightLongTerm.normalizeLongTerm 校验。
 * 这样可以在不启动宿主的情况下评估提示词服从度。
 *
 * 跑法：node scripts/insight-eval.mjs [state.json 路径]
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_INSIGHT_PROMPT, INSIGHT_PLAYBOOK } from '../index.js'
import { buildBehaviorProfile } from '../behavior.js'
import { completionQuality, fulfillmentSummary } from '../commitment.js'

const statePath = process.argv[2] || join(homedir(), '.dsh', 'dsh-cove-task', 'state.json')
const state = JSON.parse(readFileSync(statePath, 'utf8'))
const now = Date.now()
const tasks = (state.tasks || []).filter((task) => task && !task.syncFirst)
const metricsByDay = state.metricsByDay || {}

const DAY = 86_400_000
const taskNo = (task) => Number(task.no ?? task.id) || 0
const label = (task) => (taskNo(task) ? 'T' + taskNo(task) + '「' + String(task.title || '').slice(0, 14) + '」' : String(task.title || ''))

const relations = Array.isArray(state.relations) ? state.relations : []
const relOf = (task) => relations.filter((edge) => edge.from === task.id || edge.to === task.id).length

const lines = []
for (const task of tasks.slice(0, 15)) {
  const bits = [label(task), task.done ? '已完成' : (task.sessionId ? '进行中（已有会话在推进）' : '未开始（还没有会话）')]
  if (task.priority) bits.push('优先级=' + task.priority)
  bits.push('项目=' + (task.workspaceTitle || task.workspaceName || '未归属项目'))
  const desc = String(task.description || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (desc) bits.push('说明=' + desc)
  const activity = Math.max(Number(task.lastPushAt) || 0, Number(task.startedAt) || 0,
    Number(task.localUpdatedAt) || 0, Number(task.completedAt) || 0, Number(task.firstSeenAt) || 0)
  const idle = activity ? Math.floor((now - activity) / DAY) : 999
  bits.push('最后活动=' + (idle <= 0 ? '今天' : idle + ' 天前'))
  if (Number(task.expectedAt)) {
    const late = Number(task.completedAt) ? Number(task.completedAt) > Number(task.expectedAt) : now > Number(task.expectedAt)
    bits.push('预期=' + new Date(Number(task.expectedAt)).toLocaleString('zh-CN') + '（' + (late ? '已过期' : '未到期') + '）')
    if (Array.isArray(task.delayLog) && task.delayLog.length) bits.push('改期=' + task.delayLog.length + ' 次')
  }
  if (Array.isArray(task.docs) && task.docs.length) bits.push('文档=' + task.docs.length)
  const rel = relOf(task)
  if (rel) bits.push('关系=' + rel + ' 条')
  lines.push(bits.join(' | '))
}
if (tasks.length > 15) lines.push('任务清单只展开前 15 条（共 ' + tasks.length + ' 条，还有 ' + (tasks.length - 15) + ' 条未展开）。')

const attributed = tasks.map((task) => ({ ...task, delayAttribution: state.delayAttributions?.[task.id] }))
const summary = fulfillmentSummary(attributed, { now, since: now - 28 * DAY })
const quality = completionQuality(attributed, { since: now - 28 * DAY })
if (summary.tracked > 0) {
  lines.push('【履约 · 近 28 天】跟踪 ' + summary.tracked + ' 条，完成 ' + summary.completed
    + '，准时率 ' + (summary.onTimeRate ?? '—') + '%（严格口径）/ ' + (summary.finalOnTimeRate ?? '—') + '%（最终承诺），'
    + '逾期 ' + summary.overdue + '，重承诺 ' + summary.lateCount + ' 次')
  const graded = quality.early + quality.onTime + quality.late
  const pct = (n) => (graded ? Math.round((n / graded) * 100) + '%' : '—')
  lines.push('【完成质量】提前 ' + quality.early + '（' + pct(quality.early) + '）/ 准时 ' + quality.onTime + '（' + pct(quality.onTime) + '）/ 延期 ' + quality.late + '（' + pct(quality.late) + '）')
}

const doneToday = tasks.filter((task) => Number(task.completedAt) >= new Date().setHours(0, 0, 0, 0)).length
const board = {
  total: tasks.length,
  started: tasks.filter((task) => !task.done && (task.started || task.sessionId)).length,
  idle: tasks.filter((task) => !task.done && !task.started && !task.sessionId).length,
}
const profile = buildBehaviorProfile({ tasks, metricsByDay, now, ignoreWords: [] })

const context = lines.join('\n')
const statLine = '共 ' + board.total + ' · 已绑定 ' + board.started + ' · 未开始 ' + board.idle + ' · 今日完成 ' + doneToday
const behaviorBlock = profile.text
  ? '\n\n【行为档案】（样本 ' + profile.sampleDays + ' 天，覆盖 ' + Math.round(profile.coverage * 100) + '%；n<5 的信号不出现）\n' + profile.text
  : '\n\n【行为档案】暂无（样本不足）：本次不要给长期结论，longTerm 填 null。'
const material = context + '\n\n卡片上方已经显示的统计（**不要重复这些数字**）：' + statLine + behaviorBlock
const systemPrompt = DEFAULT_INSIGHT_PROMPT + '\n\n' + INSIGHT_PLAYBOOK

process.stdout.write(JSON.stringify({
  statePath,
  sampleDays: profile.sampleDays,
  windowDays: profile.windowDays,
  gaps: profile.gaps,
  profileText: profile.text,
  systemPrompt,
  material,
  sizes: { systemPrompt: systemPrompt.length, material: material.length },
}, null, 1))
