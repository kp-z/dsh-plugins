/**
 * 卡片「活动状态」与「人员分组」（阶段 5 后由共享模型承担）。
 *
 * 原来的 priorityChip / personGroup 已删除；同样的口径在 taskCardModel 里：
 * 运行中 / 运行未读 / 已读三态，以及负责人/关注人分组、头像三档、+N 折叠。
 */
import assert from 'node:assert/strict'
import { buildTaskCardModel } from '../src/card/taskCardModel.js'

const build = (task) => buildTaskCardModel(task, { now: 1763000000000, currentSessionId: '' })

/* ---- 会话态 ---- */
const running = build({ id: 'r', sessionId: 's-r', sessionAlive: true, sessionPhase: 'running', sessionUnread: true })
assert.equal(running.priority.running, true)
assert.equal(running.priority.unread, false, '运行中优先于未读')
assert.equal(running.session.lamp, 'running')

const unread = build({ id: 'u', sessionId: 's-u', sessionAlive: true, sessionPhase: 'idle', sessionUnread: true })
assert.equal(unread.priority.running, false)
assert.equal(unread.priority.unread, true)
assert.equal(unread.session.lamp, 'unread')

const seen = build({ id: 's', sessionId: 's-s', sessionAlive: true, sessionPhase: 'idle', sessionUnread: false })
assert.equal(seen.priority.running, false)
assert.equal(seen.priority.unread, false)
assert.equal(seen.session.lamp, 'idle')

const dead = build({ id: 'd', sessionId: 's-d', sessionAlive: false, sessionPhase: 'running', sessionUnread: true })
assert.equal(dead.priority.running, false)
assert.equal(dead.priority.unread, false)
assert.equal(dead.session.lamp, 'dead')

/* ---- 人员分组 ---- */
const people = build({
  id: 'p',
  members: [
    { id: 'a', name: 'Aaron', role: 'assignee', avatar: 'https://x.test/aaron.png' },
    { id: 'b', name: 'Person 0', role: 'assignee' },
    { id: 'c', name: 'Person 1', role: 'assignee' },
    { id: 'd', name: 'Person 2', role: 'assignee' },
    { id: 'e', name: 'Person 3', role: 'assignee' },
    { id: 'f', name: 'Follower', role: 'follower' },
    { id: 'ou_7515cfb505bce97ec6dcae7bb5b224f5', name: '', role: 'follower', avatar: 'ftp://nope.png' },
  ],
}).people
assert.equal(people.length, 2)
const [assignees, followers] = people
assert.equal(assignees.label, '负责人')
assert.equal(assignees.items.length, 4, '最多展示 4 个头像')
assert.equal(assignees.more, 1, '剩下的折成 +N')
assert.match(assignees.moreTip, /Person 3/)
assert.equal(assignees.items[0].avatar, 'https://x.test/aaron.png')
assert.equal(assignees.items[0].initial, 'A')
assert.equal(followers.items[0].name, 'Follower')
const anon = followers.items[1]
assert.equal(anon.anon, true, '没有真名/真照片 → 中性人形')
assert.equal(anon.initial, '', '绝不拿 ou_ 首字母当头像')
assert.equal(anon.avatar, '', '非 http(s) 头像不透传')

console.log('TASK_ACTIVITY_MODEL_OK: running/unread/idle/dead lamps, people groups, +N cap, anonymous avatars')
