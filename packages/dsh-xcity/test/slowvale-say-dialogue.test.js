/**
 * R538：说话这条链路（pushSay → flushSay → visual 包 → 前端的 dialogue 拍）。
 *
 * 为什么要有这条：桥的 say 路径此前**没有任何测试**。visual.ts 的 sayBeat 从
 * bubble.float_up 换成 dialogue 拍时，server.ts 里那句旧调用在运行时是 TypeError，
 * 全量测试却全绿——"说话"这件事在测试里根本没有走通过。
 *
 * 这里跑真 HTTP：连 SSE，调 bridge.say，把推出来的 visual 包解压后按前端契约断言。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createSlowvaleBridge } from '../lib/adapters/slowvale/server.js'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(here, '..', '..', '..', 'slowvale-mirror', 'site')
const PLACE = 'place:office.tech_company_1'

/**
 * 两个角色都**不给 station**：这样推送循环里除了说话不会推出别的 visual 拍
 * （坐姿/走路那几段都要 station），断言才不会被无关的拍污染。
 */
const worldOf = (agents) => ({ id: 'w1', name: 'w', tick: 5, agents })

const sleep = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms))
const TIMEOUT = Symbol('timeout')

/** SSE 帧流：yield [事件名, 解析后的 JSON]。 */
async function* events(url, signal) {
  const response = await fetch(url, { signal })
  assert.equal(response.status, 200)
  let buffer = ''
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk
    let end
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      if (frame.startsWith('event: ')) {
        const [name, json] = frame.split('\n')
        yield [name.slice(7), JSON.parse(json.slice(6))]
      }
    }
  }
}

/** 等到下一个 visual 包，解出 output（别的信封——clock/state/phone——直接跳过）。 */
async function nextVisual(stream, timeoutMs = 2000) {
  for (;;) {
    const hit = await Promise.race([stream.next(), sleep(timeoutMs, TIMEOUT)])
    if (hit === TIMEOUT) throw new Error('等 visual 包超时')
    if (hit.done === true) throw new Error('SSE 流提前结束')
    const [name, envelope] = hit.value
    if (name !== 'update' || envelope.kind !== 'visual') continue
    return JSON.parse(gunzipSync(Buffer.from(envelope.payload_gz, 'base64')).toString())
  }
}

/** 起桥 + 连流，返回 { bridge, stream, close }。 */
async function connect(world) {
  const bridge = await createSlowvaleBridge({
    host: '127.0.0.1',
    port: 0,
    assetsDir,
    pushMs: 40,
    account: { email: 'a@b.c', password: 'x' },
    // god 视角（viewerRoleId 空）：前端的 r5 只让 place 类 audience 通过——
    // 我们发 place 就是为了两种视角都能看到。
    opts: { worldId: 'w1', viewerRoleId: '', place: PLACE, startDate: '2026-01-01' },
    getWorld: () => world,
  })
  const controller = new AbortController()
  const stream = events('http://127.0.0.1:' + String(bridge.port) + '/api/game/stream', controller.signal)
  const [name] = (await stream.next()).value
  assert.equal(name, 'connected', '连上之后才可以说话（桥只在有客户端时入队）')
  return {
    bridge,
    stream,
    async close() {
      controller.abort()
      await bridge.close()
    },
  }
}

test('R538：say 出去的是 dialogue 拍，带 speaker_id / audience.place_id / tone=speech', async () => {
  const world = worldOf([{ id: 'agent-1', name: '林野', placeId: PLACE }])
  const linked = await connect(world)
  try {
    assert.equal(linked.bridge.say('agent-1', '今天风不小。'), true)
    const packet = await nextVisual(linked.stream)
    assert.deepEqual(Object.keys(packet.playback.tracks), ['agent-1'], '一个角色的独立时间轴')
    assert.deepEqual(packet.playback.tracks['agent-1'], [
      {
        dialogue: {
          speaker_id: 'agent-1',
          text: '今天风不小。',
          tone: 'speech',
          audience: { kind: 'place', place_id: PLACE },
        },
      },
    ])
  } finally {
    await linked.close()
  }
})

test('R538：角色没说自己在哪时，audience 回退到 opts.place（不发缺 place_id 的废拍）', async () => {
  const world = worldOf([{ id: 'agent-1', name: '林野' }])
  const linked = await connect(world)
  try {
    assert.equal(linked.bridge.say('agent-1', '我在楼下。'), true)
    const packet = await nextVisual(linked.stream)
    const dialogue = packet.playback.tracks['agent-1'][0].dialogue
    assert.deepEqual(dialogue.audience, { kind: 'place', place_id: PLACE })
  } finally {
    await linked.close()
  }
})

test('R538：一轮只发一个角色的说话，剩下的留到下一轮（不丢也不挤成一包）', async () => {
  const world = worldOf([
    { id: 'agent-1', name: '林野', placeId: PLACE },
    { id: 'agent-2', name: '小满', placeId: PLACE },
  ])
  const linked = await connect(world)
  try {
    assert.equal(linked.bridge.say('agent-1', '我先说。'), true)
    assert.equal(linked.bridge.say('agent-2', '我后说。'), true)

    const first = await nextVisual(linked.stream)
    assert.deepEqual(Object.keys(first.playback.tracks), ['agent-1'], '先进队的角色这一轮发')
    assert.equal(first.playback.tracks['agent-1'][0].dialogue.text, '我先说。')

    const second = await nextVisual(linked.stream)
    assert.deepEqual(Object.keys(second.playback.tracks), ['agent-2'], '另一个留到下一轮，不能丢')
    assert.equal(second.playback.tracks['agent-2'][0].dialogue.text, '我后说。')
  } finally {
    await linked.close()
  }
})
