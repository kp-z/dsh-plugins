import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shouldRestartWorld } from '../lib/runtime/watchdog.js'

test('允许推进 + 停着 -> 拉起来', () => {
  assert.equal(shouldRestartWorld({ viewers: 1, autoStart: true, running: false }), true)
})

/** 关键回归：没人看也要跑。否则玩家关掉页面再发短信，角色永远动不了。 */
test('没人看也要推进（autoStart 的语义就是推进）', () => {
  assert.equal(shouldRestartWorld({ viewers: 0, autoStart: true, running: false }), true)
})

test('配置不许推进就不许自作主张', () => {
  assert.equal(shouldRestartWorld({ viewers: 3, autoStart: false, running: false }), false)
})

test('正在跑就不要重启它（重启会丢这一帧）', () => {
  assert.equal(shouldRestartWorld({ viewers: 1, autoStart: true, running: true }), false)
})
