import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shouldRestartWorld } from '../lib/runtime/watchdog.js'

/** 关键回归：没人看也要跑。否则玩家关掉页面再发短信，角色永远动不了。 */
test('允许推进但停着 -> 拉起来（与有没有人看无关）', () => {
  assert.equal(shouldRestartWorld({ autoStart: true, running: false }), true)
})

test('配置不许推进就不许自作主张', () => {
  assert.equal(shouldRestartWorld({ autoStart: false, running: false }), false)
})

test('正在跑就不要重启它（重启会丢这一帧）', () => {
  assert.equal(shouldRestartWorld({ autoStart: true, running: true }), false)
})
