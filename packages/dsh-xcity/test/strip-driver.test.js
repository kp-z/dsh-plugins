/** R543：驱动前缀只用于归因，不该出现在中文看板的原话字段里。 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { stripDriverPrefix } from '../lib/adapters/slowvale/logs.js'

test('三种驱动前缀都被剥掉，原句一字不改', () => {
  assert.equal(stripDriverPrefix('need: 饿了，去吃点东西'), '饿了，去吃点东西')
  assert.equal(stripDriverPrefix('duty: 快到点了，去找悟空'), '快到点了，去找悟空')
  assert.equal(stripDriverPrefix('routine: 到了上班的点，自己去干活'), '到了上班的点，自己去干活')
})

test('没有前缀、或只是提到这些词，都原样返回', () => {
  assert.equal(stripDriverPrefix('想去吃东西'), '想去吃东西')
  assert.equal(stripDriverPrefix('needs: 这是普通句子'), 'needs: 这是普通句子')
  assert.equal(stripDriverPrefix(''), '')
})

test('只剥开头、只剥一次；中间出现不处理', () => {
  assert.equal(stripDriverPrefix('need: duty: 两个前缀'), 'duty: 两个前缀')
  assert.equal(stripDriverPrefix('他说 need: 不好'), '他说 need: 不好')
})