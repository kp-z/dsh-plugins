
/**
 * H7：presence 必须遵守手感契约，且形状是前端认的那个。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { PresenceView } from '../lib/view/presence.js'

const PLACE = 'place:office.tech_company_1'

test('走 100 像素，每一帧的整数坐标变化都不超过步长', () => {
  const view = new PresenceView(2)
  view.place('role.lin', PLACE, { x: 0, y: 0 })
  view.walkTo('role.lin', { x: 100, y: 0 })
  let previous = view.entries()[0].location
  for (let frame = 0; frame < 60; frame += 1) {
    view.tick()
    const now = view.entries()[0].location
    assert.ok(Math.abs(now.x - previous.x) <= 2, '第 ' + String(frame) + ' 帧跳了 ' + String(now.x - previous.x))
    assert.equal(now.y, 0)
    previous = now
  }
  assert.equal(previous.x, 100, '应该正好走到')
})

test('朝向是四向，且随方向变化', () => {
  const view = new PresenceView(2)
  view.place('role.lin', PLACE, { x: 0, y: 0 })
  view.walkTo('role.lin', { x: 10, y: 0 })
  view.tick()
  assert.equal(view.entries()[0].location.facing, 'right')
  view.walkTo('role.lin', { x: 10, y: 10 })
  view.tick()
  assert.equal(view.entries()[0].location.facing, 'down')
})

test('到点就停，不会一直抖', () => {
  const view = new PresenceView(2)
  view.place('role.lin', PLACE, { x: 0, y: 0 })
  view.walkTo('role.lin', { x: 3, y: 0 })
  view.tick()
  view.tick()
  const settled = view.entries()[0].location
  assert.equal(settled.x, 3)
  view.tick()
  assert.deepEqual(view.entries()[0].location, settled, '停下之后不该再动')
})

test('输出形状就是前端认的那个：整数 + place_id + 四向', () => {
  const view = new PresenceView(2)
  view.place('role.lin', PLACE, { x: 10.4, y: 20.6 })
  const entry = view.entries()[0]
  assert.equal(entry.role_id, 'role.lin')
  assert.equal(entry.location.place_id, PLACE)
  assert.equal(Number.isInteger(entry.location.x), true)
  assert.equal(Number.isInteger(entry.location.y), true)
  assert.equal(entry.location.x, 10)
  assert.equal(entry.location.y, 21)
  assert.ok(['up', 'down', 'left', 'right'].includes(entry.location.facing))
})

test('不在场的人不能被指挥走路', () => {
  const view = new PresenceView(2)
  assert.throws(() => view.walkTo('role.nobody', { x: 1, y: 1 }))
  assert.equal(view.stateOf('role.nobody'), null)
})
