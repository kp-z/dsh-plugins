import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shouldRestartWorld } from '../lib/runtime/watchdog.js'

test('有观众 + 允许推进 + 停着 -> 拉起来', () => {
  assert.equal(shouldRestartWorld({ viewers: 1, autoStart: true, running: false }), true)
})

test('没人看就不推（不占 CPU）', () => {
  assert.equal(shouldRestartWorld({ viewers: 0, autoStart: true, running: false }), false)
})

test('配置不许推进就不许自作主张', () => {
  assert.equal(shouldRestartWorld({ viewers: 3, autoStart: false, running: false }), false)
})

test('正在跑就不要重启它（重启会丢这一帧）', () => {
  assert.equal(shouldRestartWorld({ viewers: 1, autoStart: true, running: true }), false)
})
