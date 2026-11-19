import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clipForSpeech, speak } from '../lib/announce.js'
import { resolveConfig } from '../lib/config.js'

const config = resolveConfig({ engine: 'auto' })
const text = '这一轮把播报骨架搭好了，要不要我接着做触发？'

/** 一次完整的假链路：记录每一跳，便于断言顺序。 */
function recorder(overrides = {}) {
  const calls = []
  const deps = {
    synthesize: async () => {
      calls.push('synth')
      return Buffer.from('fake-mp3')
    },
    writeTemp: () => {
      calls.push('write')
      return '/tmp/dsh-broadcast/fake.mp3'
    },
    play: async (file) => {
      calls.push(`play:${file}`)
    },
    remove: (file) => {
      calls.push(`remove:${file}`)
    },
    say: async (_value, options) => {
      calls.push(`say:${options.voice}:${options.rate}`)
    },
    now: () => 1000,
    ...overrides,
  }
  return { calls, deps }
}

test('edge 成功：合成 → 落盘 → 播放 → 删临时文件', async () => {
  const { calls, deps } = recorder()
  const result = await speak(text, config, deps)
  assert.equal(result.engine, 'edge')
  assert.equal(result.fallbackReason, undefined)
  assert.deepEqual(calls, ['synth', 'write', 'play:/tmp/dsh-broadcast/fake.mp3', 'remove:/tmp/dsh-broadcast/fake.mp3'])
})

test('合成 403：自动回落 say，并说明原因', async () => {
  const { calls, deps } = recorder({
    synthesize: async () => {
      throw new Error('edge-tts 连接失败（握手被拒或网络不可达）')
    },
  })
  const result = await speak(text, config, deps)
  assert.equal(result.engine, 'say')
  assert.match(result.fallbackReason ?? '', /握手被拒/)
  assert.deepEqual(calls, ['say:Tingting:205']) // +8% 基准 190 → 205
})

test('播放失败也要删临时文件，然后回落 say', async () => {
  const { calls, deps } = recorder({
    play: async () => {
      calls.push('play-failed')
      throw new Error('afplay 退出码 1')
    },
  })
  const result = await speak(text, config, deps)
  assert.equal(result.engine, 'say')
  assert.match(result.fallbackReason ?? '', /afplay/)
  assert.deepEqual(calls.slice(0, 4), ['synth', 'write', 'play-failed', 'remove:/tmp/dsh-broadcast/fake.mp3'])
  assert.equal(result.engine, 'say')
})

test('engine=edge 时不回落，直接抛错（便于定位）', async () => {
  const { deps } = recorder({
    synthesize: async () => {
      throw new Error('403 Forbidden')
    },
  })
  await assert.rejects(
    () => speak(text, { ...config, engine: 'edge' }, deps),
    /edge-tts 播报失败：403 Forbidden/,
  )
})

test('engine=say 时完全不碰网络合成', async () => {
  const { calls, deps } = recorder()
  const result = await speak(text, { ...config, engine: 'say' }, deps)
  assert.equal(result.engine, 'say')
  assert.deepEqual(calls, ['say:Tingting:205'])
})

test('空文本直接拒绝，不去念空气', async () => {
  const { calls, deps } = recorder()
  await assert.rejects(() => speak('   \n  ', config, deps), /没有可播报的文字/)
  assert.deepEqual(calls, [])
})

test('clipForSpeech 折叠空白并按上限截断', () => {
  assert.equal(clipForSpeech('  你好\n\n  世界  ', 80), '你好 世界')
  assert.equal(clipForSpeech('一二三四五', 3), '一二三')
  assert.equal(clipForSpeech('一二三', 0), '一二三') // 上限非法时不截
})
