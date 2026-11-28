/**
 * R530：裁剪时先丢琐事，别先丢"我答应过谁"。
 *
 * 现场：agent-1 每天写 21–50 条记忆，EPISODE_MAX=150 只够 3–7 天——于是承诺裁决写的
 * 那一条（守约/没做完）在 7 天窗口还没到之前就被挤掉了，而对端还在，看起来像漏写。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { EPISODE_MAX, pruneEpisodes } from '../lib/sim/memory.js'

const ep = (tick, summary, kind = 'social') => ({
  tick,
  day: Math.floor(tick / 1440) + 1,
  kind,
  summary,
  with: [],
  placeId: 'p',
  salience: 0.5,
})

test('R530：超上限时琐事被丢掉，守约/没做完/工单留下', () => {
  const episodes = []
  // 200 条琐事 + 3 条正经事，正经事在最前面（最早），按老逻辑一定被 slice 掉。
  episodes.push(ep(100, '守约：答应阿金的「对一遍工单」兑现了'))
  episodes.push(ep(110, '没做完：答应小铁的「巡休息区」'))
  episodes.push(ep(120, '工单「盘点小镇」做完了', 'task'))
  for (let i = 0; i < 200; i += 1) episodes.push(ep(200 + i, '吃了顿饭'))
  const kept = pruneEpisodes(episodes, 5000)
  assert.equal(kept.length, EPISODE_MAX)
  const summaries = kept.map((row) => row.summary)
  assert.ok(summaries.some((s) => s.startsWith('守约：')), '守约不该被丢')
  assert.ok(summaries.some((s) => s.startsWith('没做完：')), '没做完不该被丢')
  assert.ok(summaries.some((s) => s.startsWith('工单')), '工单不该被丢')
})

test('R530：没超上限时原样返回顺序（不排序、不动内容）', () => {
  const episodes = [ep(100, '吃了顿饭'), ep(200, '守约：答应阿金的「对一遍工单」兑现了')]
  const kept = pruneEpisodes(episodes, 300)
  assert.deepEqual(kept.map((row) => row.summary), episodes.map((row) => row.summary))
})

test('R530：确定性——同一份输入跑两次结果一致', () => {
  const build = () => {
    const list = []
    for (let i = 0; i < 160; i += 1) list.push(ep(100 + i, i % 7 === 0 ? '守约：答应阿金的「干活」兑现了' : '吃了顿饭'))
    return list
  }
  const first = pruneEpisodes(build(), 9000).map((row) => row.summary)
  const second = pruneEpisodes(build(), 9000).map((row) => row.summary)
  assert.deepEqual(first, second)
})

test('R530：7 天窗口仍然生效（更旧的一律丢，与上限无关）', () => {
  // 第 1 天的记忆 vs 第 20 天的"现在"：7 天窗口早该把它丢掉（与上限无关）。
  const kept = pruneEpisodes([ep(10, '守约：答应阿金的「很久以前」兑现了'), ep(28000, '吃了顿饭')], 28000)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].summary, '吃了顿饭')
})
