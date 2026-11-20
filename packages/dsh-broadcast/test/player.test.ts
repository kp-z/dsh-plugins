import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  afplayArgs,
  ffplayArgs,
  hasCommand,
  pickPlayer,
  sayArgs,
} from '../lib/player.js'

test('pickPlayer：macOS 优先 afplay，其次 ffplay，最后 say', () => {
  const darwinAll = pickPlayer({ platform: 'darwin', has: () => true })
  assert.equal(darwinAll, 'afplay')

  const darwinNoAfplay = pickPlayer({
    platform: 'darwin',
    has: (command) => command === 'ffplay',
  })
  assert.equal(darwinNoAfplay, 'ffplay')

  const darwinOnlySay = pickPlayer({
    platform: 'darwin',
    has: (command) => command === 'say',
  })
  assert.equal(darwinOnlySay, 'say')
})

test('pickPlayer：Linux 上没有 afplay 只有 ffplay', () => {
  assert.equal(pickPlayer({ platform: 'linux', has: (c) => c === 'ffplay' }), 'ffplay')
  assert.equal(pickPlayer({ platform: 'linux', has: (c) => c === 'afplay' }), 'none')
  // say 只在 macOS 上算兜底，Linux 有同名命令也不选
  assert.equal(pickPlayer({ platform: 'linux', has: (c) => c === 'say' }), 'none')
})

test('pickPlayer：什么都没有时返回 none（不静默假装能播）', () => {
  assert.equal(pickPlayer({ platform: 'darwin', has: () => false }), 'none')
})

test('hasCommand 能按 PATH 找到可执行文件', () => {
  assert.equal(hasCommand('afplay'), true) // 本机 /usr/bin/afplay
  assert.equal(hasCommand('definitely-not-a-real-binary-xyz'), false)
})

test('播放参数：afplay 只要文件路径，ffplay 不弹窗且播完退出', () => {
  assert.deepEqual(afplayArgs('/tmp/a.mp3'), ['/tmp/a.mp3'])
  assert.deepEqual(ffplayArgs('/tmp/a.mp3'), ['-nodisp', '-autoexit', '-loglevel', 'error', '/tmp/a.mp3'])
})

test('say 参数带音色与语速，文本是最后一个参数', () => {
  assert.deepEqual(sayArgs('你好', { voice: 'Tingting', rate: 205 }), ['-v', 'Tingting', '-r', '205', '你好'])
  assert.deepEqual(sayArgs('你好'), ['-v', 'Tingting', '-r', '190', '你好'])
})


