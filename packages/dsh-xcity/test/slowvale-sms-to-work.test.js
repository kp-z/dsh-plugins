/** R494：短信 → 真实角色会话事件 → 世界动作；未接受和吃饭中都不切换。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'
import { startActivity } from '../lib/sim/activity.js'
import { summarizeDay } from '../lib/sim/day-summary.js'
import { projectRecap } from '../lib/adapters/slowvale/recap.js'
import { parseDirective, directiveToCommand } from '../lib/adapters/slowvale/directive.js'
import { DEFAULT_CIRCUIT } from '../lib/adapters/slowvale/stage.js'
import { createSmsReplyTracker } from '../lib/adapters/slowvale/session-events.js'
import { respondViaSession } from '../lib/adapters/slowvale/respond-sms.js'
import { ACCEPT_ACTION } from '../lib/adapters/slowvale/reply.js'

function makeWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
}

async function runSms(world, agent, reply) {
  const text = (value) => [{ type: 'text', text: value }]
  const tracker = createSmsReplyTracker(100, () => 0)
  const commands = []
  const content = '现在去工作'
  const command = directiveToCommand(parseDirective(content, DEFAULT_CIRCUIT), agent.id)
  let delivered
  await respondViaSession({ peerRoleId: agent.id, content }, {
    characterOf: () => agent.id,
    sessionOf: () => 'resident',
    suggestedAction: '去办公室工作',
    onForward: (id, session, prompt) => tracker.track(id, session, prompt, 'player-sms', () => {
      commands.push({ ...command, trigger: { kind: 'player', text: content } })
    }),
    prompt: async ({ content }) => { delivered = content },
  }, () => 'one')
  assert.equal(commands.length, 0, '发送本身不能执行建议')
  tracker.observe('resident', 'user/message', { turn: 1 }, delivered)
  const result = tracker.observe('resident', 'assistant/message', { turn: 1 }, text(reply))
  result.reply?.acceptAction?.()
  assert.equal(tracker.observe('resident', 'assistant/message', { turn: 1 }, text(reply)).reply, null, '同轮不能重复执行')
  step(world, commands)
  return commands.length
}

function resident(world) {
  const agent = world.agents[0]
  Object.assign(agent, { state: 'idle', station: null, targetStation: null, path: [], carrying: null })
  return agent
}

const accepts = '<xcity-reply>我这就去。</xcity-reply>\n' + ACCEPT_ACTION

test('R494：拒绝与仅口头同意都不改变活动', async () => {
  for (const reply of ['<xcity-reply>我等会再去。</xcity-reply>', '<xcity-reply>好。</xcity-reply>']) {
    const world = makeWorld()
    const agent = resident(world)
    assert.equal(await runSms(world, agent, reply), 0)
    assert.notEqual(agent.activityKind, 'work')
  }
})

test('R494：明确接受但正在吃饭，原活动继续', async () => {
  const world = makeWorld()
  const agent = resident(world)
  agent.state = 'sleeping'
  agent.activityPurpose = 'meal'
  const meal = startActivity(world, agent, { kind: 'rest', ticks: 20 })
  assert.equal(await runSms(world, agent, accepts), 1)
  assert.equal(agent.activityId, meal.id)
  assert.equal(meal.status, 'active')
})

test('R494：空闲时明确接受，按世界现有流程走向工位', async () => {
  const world = makeWorld()
  const agent = resident(world)
  assert.equal(await runSms(world, agent, accepts), 1)
  assert.equal(agent.state, 'walking')
  assert.ok(agent.path.length > 0)
  assert.notEqual(agent.targetStation, null)
  for (let i = 0; i < 200 && !world.activities.some(a => a.agentId === agent.id && a.kind === 'work' && a.status === 'completed'); i += 1) step(world)
  assert.ok(world.activities.some(a => a.agentId === agent.id && a.kind === 'work' && a.status === 'completed'))
  const recap = projectRecap(world, { worldId: 'w1', viewerRoleId: agent.id, place: agent.placeId, startDate: '2026-01-01' }, agent.id)
  assert.ok(recap.timeline.some(entry => entry.text.includes('干活')))
  assert.ok(summarizeDay(world, agent.id, world.tick).some(line => line.includes('干活')))
})
