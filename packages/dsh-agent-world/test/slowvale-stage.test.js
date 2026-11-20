/**
 * 舞台（会走路的居民）验收。
 *
 * 只锁两件事：位置会朝目标前进、走够几个点会换场景。
 * 不去测"好不好看"——那要看 /show。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createStage } from '../lib/adapters/slowvale/stage.js'

const ASSETS = new URL('../../../slowvale-mirror/site', import.meta.url).pathname

test('舞台：位置朝目标前进，且会换场景', (t) => {
  let stage
  try {
    stage = createStage({ assetsDir: ASSETS, circuit: ['company', 'park'], name: '测试' })
  } catch (error) {
    t.skip('没有静态站，跳过：' + String(error))
    return
  }

  const first = stage.frame()
  assert.equal(first.name, '测试')
  assert.ok(first.place === 'company' || first.place === 'park')

  const places = new Set([first.place])
  let moved = false
  for (let i = 0; i < 2000; i += 1) {
    const before = stage.frame()
    const after = stage.tick(100)
    if (before.x !== after.x || before.y !== after.y) moved = true
    places.add(after.place)
    if (places.size > 1) break
  }
  assert.ok(moved, '位置必须真的在动，否则 /show 就是一张静图')
  assert.ok(places.size > 1, '走完几个点要换场景，否则人物出不了办公室')
})
