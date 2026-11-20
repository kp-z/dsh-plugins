import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clipForSpeech, enginePlan, speak } from '../lib/announce.js'
import { resolveConfig } from '../lib/config.js'

const auto = resolveConfig({ engine: 'auto' })
const text = '这一轮把播报的音色换成在线的了，要不要现在听听看？'

/** 假链路：记录每一跳，便于断言顺序与清理。 */
function recorder(overrides = {}) {
  const calls = []
  const deps = {
    synthesizeEdge: async () => {
      calls.push('edge')
      return Buffer.from('mp3-edge')
    },
    synthesizeBaidu: async () => {
      calls.push('baidu')
      return Buffer.from('mp3-baidu')
    },
    writeTemp: (audio) => {
      calls.push(`write:${audio.toString()}`)
      return '/tmp/dsh-broadcast/fake.mp3'
    },
    play: async () => {
      calls.push('play')
    },
    remove: () => {
      calls.push('remove')
    },
    say: async (_value, options) => {
      calls.push(`say:${options.voice}`)
    },
    now: () => 1000,
    ...overrides,
  }
  return { calls, deps }
}

test('默认（auto、在线音色）：走百度，成功就用它', async () => {
  const { calls, deps } = recorder()
  const result = await speak(text, auto, deps)
  assert.equal(result.engine, 'baidu')
  assert.equal(result.fallbackReason, undefined)
  assert.deepEqual(calls, ['baidu', 'write:mp3-baidu', 'play', 'remove'])
})

test('显式 engine=edge：走 edge-tts（端点恢复后即可启用）', async () => {
  const { calls, deps } = recorder()
  const result = await speak(text, resolveConfig({ engine: 'edge' }), deps)
  assert.equal(result.engine, 'edge')
  assert.deepEqual(calls, ['edge', 'write:mp3-edge', 'play', 'remove'])
})

test('在线合成挂了：退到 say，并把原因留在结果里', async () => {
  const { calls, deps } = recorder({
    synthesizeBaidu: async () => {
      calls.push('baidu')
      throw new Error('baidu 超时')
    },
  })
  const result = await speak(text, auto, deps)
  assert.equal(result.engine, 'say')
  assert.match(result.fallbackReason ?? '', /baidu 超时/)
  assert.ok(calls.includes('say:Tingting'))
})

test('选了在线音色：只走百度，不会偷偷用 say', async () => {
  const config = resolveConfig({ engine: 'auto', voiceId: 'baidu' })
  const { calls, deps } = recorder()
  const result = await speak(text, config, deps)
  assert.equal(result.engine, 'baidu')
  assert.deepEqual(calls, ['baidu', 'write:mp3-baidu', 'play', 'remove'])
})

test('选了在线音色但它挂了：仍然退到 say（宁可机械也要有声音）', async () => {
  const config = resolveConfig({ engine: 'auto', voiceId: 'baidu' })
  const { calls, deps } = recorder({
    synthesizeBaidu: async () => { throw new Error('baidu 500') },
  })
  const result = await speak(text, config, deps)
  assert.equal(result.engine, 'say')
  assert.match(result.fallbackReason ?? '', /baidu 500/)
})

test('选了本机音色：一次网络都不碰，直接 say 那个音色', async () => {
  const config = resolveConfig({ engine: 'auto', voiceId: 'say:Eddy (中文（中国大陆）)' })
  const { calls, deps } = recorder()
  const result = await speak(text, config, deps)
  assert.equal(result.engine, 'say')
  assert.deepEqual(calls, ['say:Eddy (中文（中国大陆）)'])
})

test('显式 engine=edge 时失败直接抛，不回落（调试用）', async () => {
  const config = resolveConfig({ engine: 'edge' })
  const { deps } = recorder({
    synthesizeEdge: async () => { throw new Error('403 Forbidden') },
  })
  await assert.rejects(() => speak(text, config, deps), /edge 播报失败：403 Forbidden/)
})

test('播放失败也要删临时文件，然后回落下一档', async () => {
  const { calls, deps } = recorder({
    play: async () => {
      calls.push('play-failed')
      throw new Error('afplay 退出码 1')
    },
  })
  const result = await speak(text, auto, deps)
  assert.equal(result.engine, 'say')
  assert.ok(calls.indexOf('remove') > calls.indexOf('play-failed'), '失败后仍要删临时文件')
  assert.match(result.fallbackReason ?? '', /afplay/)
})

test('空文本直接拒绝，不去念空气', async () => {
  const { calls, deps } = recorder()
  await assert.rejects(() => speak('   \n  ', auto, deps), /没有可播报的文字/)
  assert.deepEqual(calls, [])
})

test('clipForSpeech 折叠空白并按上限截断', () => {
  assert.equal(clipForSpeech('  你好\n\n  世界  ', 80), '你好 世界')
  assert.equal(clipForSpeech('一二三四五', 3), '一二三')
  assert.equal(clipForSpeech('一二三', 0), '一二三')
})

test('enginePlan：选了什么就只走那一条', () => {
  assert.deepEqual(enginePlan(resolveConfig({})).engines, ['baidu', 'say'])
  assert.deepEqual(enginePlan(resolveConfig({ voiceId: 'baidu' })).engines, ['baidu', 'say'])
  assert.deepEqual(enginePlan(resolveConfig({ voiceId: 'say:Meijia' })).engines, ['say'])
  assert.deepEqual(enginePlan(resolveConfig({ engine: 'say' })).engines, ['say'])
  assert.deepEqual(enginePlan(resolveConfig({ engine: 'baidu' })).engines, ['baidu'])
  assert.deepEqual(enginePlan(resolveConfig({ engine: 'edge' })).engines, ['edge'])
})
