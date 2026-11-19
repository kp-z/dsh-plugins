import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickRoute, summarizeReply } from '../lib/summarizer.js'
import type { LlmChunkLike } from '../lib/summarizer.js'

/** 假的宿主 llm：把 chunk 列表按 async iterable 吐出来，并记录请求。 */
function fakeLlm(chunks: LlmChunkLike[] | (() => AsyncIterable<LlmChunkLike>), hang = false) {
  const requests: Record<string, unknown>[] = []
  return {
    requests,
    stream(options: Record<string, unknown>) {
      requests.push(options)
      if (hang) return { async *[Symbol.asyncIterator]() { await new Promise(() => {}) } }
      const list = typeof chunks === 'function' ? chunks() : chunks
      if (Symbol.asyncIterator in (list as object)) return list
      return {
        async *[Symbol.asyncIterator]() {
          for (const chunk of list as LlmChunkLike[]) yield chunk
        },
      }
    },
  }
}

const services = (llm: unknown) => ({
  llm: llm as never,
  defaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }) },
})

const text = [
  '我把重试逻辑改成了三次退避，单测和真机都过了。',
  '',
  '## 改动',
  '- \`src/auth/retry.ts\`：重试三次',
  '- 删掉了旧的 sleep 逻辑',
  '',
  '要不要我现在推到主干？',
].join('\n')

const base = { text, maxChars: 80, timeoutMs: 200 }

test('模型可用：走模型，输出洗掉开场白与引号', async () => {
  const llm = fakeLlm([
    { type: 'text-delta', text: '好的，' },
    { type: 'text-delta', text: '“重试改成三次退避了，测试都过了。要不要现在推到主干？”' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const result = await summarizeReply({ ...base, services: services(llm) })
  assert.equal(result.source, 'model')
  assert.equal(result.text, '重试改成三次退避了，测试都过了。要不要现在推到主干？')
  assert.equal(result.channel, 'deepseek-official · deepseek-v4-flash')
  assert.equal(llm.requests.length, 1)
  // 请求形状照宿主的 llm.stream：provider / model / system / messages / maxTokens / signal
  const request = llm.requests[0] ?? {}
  assert.equal(request.provider, 'deepseek-official')
  assert.equal(request.model, 'deepseek-v4-flash')
  assert.ok(typeof request.system === 'string' && request.system.length > 0)
  assert.equal((request.messages as { role: string }[])[0]?.role, 'user')
  assert.ok(request.signal instanceof AbortSignal)
})

test('模型返回空内容：回落本地截断，并说明原因', async () => {
  const llm = fakeLlm([{ type: 'finish', reason: { kind: 'stop' } }])
  const result = await summarizeReply({ ...base, services: services(llm) })
  assert.equal(result.source, 'local')
  assert.match(result.text, /我把重试逻辑改成了三次退避/)
  assert.match(result.reason ?? '', /空内容/)
})

test('模型报错：回落本地截断，不把异常抛给播放层', async () => {
  const llm = fakeLlm([
    { type: 'text-delta', text: '一半' },
    { type: 'finish', reason: { kind: 'error', failure: { message: 'upstream 502' } } },
  ])
  const result = await summarizeReply({ ...base, services: services(llm) })
  assert.equal(result.source, 'local')
  assert.match(result.reason ?? '', /502/)
})

test('模型卡住：6 秒上限到了就用本地截断（这里把上限压到 80ms）', async () => {
  const llm = fakeLlm([], true)
  const started = Date.now()
  const result = await summarizeReply({ ...base, timeoutMs: 80, services: services(llm) })
  const elapsed = Date.now() - started
  assert.equal(result.source, 'local')
  assert.match(result.reason ?? '', /没有响应/)
  assert.ok(elapsed < 1000, `不该真的等满，实际 ${elapsed}ms`)
})

test('宿主没有 llm / 没有默认模型：直接用本地截断并说明缺什么', async () => {
  const noLlm = await summarizeReply({ ...base, services: { defaultModel: services(fakeLlm([])).defaultModel } })
  assert.equal(noLlm.source, 'local')
  assert.match(noLlm.reason ?? '', /没有 llm 服务/)

  const noModel = await summarizeReply({ ...base, services: { llm: fakeLlm([]) as never } })
  assert.equal(noModel.source, 'local')
  assert.match(noModel.reason ?? '', /agentDefaultModel/)

  const noSelection = await summarizeReply({
    ...base,
    services: { llm: fakeLlm([]) as never, defaultModel: { currentSelection: () => null } },
  })
  assert.equal(noSelection.source, 'local')
  assert.match(noSelection.reason ?? '', /没有选定默认模型/)
})

test('关掉模型改写：一次流都不发，直接本地截断', async () => {
  const llm = fakeLlm([{ type: 'text-delta', text: '不该被调用' }])
  const result = await summarizeReply({ ...base, useModel: false, services: services(llm) })
  assert.equal(result.source, 'local')
  assert.equal(llm.requests.length, 0)
  assert.match(result.reason ?? '', /关掉了模型改写/)
})

test('本地也洗不出话时，退到原始首句（不丢行，只剥代码）', async () => {
  // 表格在「本地截断」这一级会被整行丢掉，到第三级才念得出东西
  const result = await summarizeReply({ text: '| 甲 | 乙 |\n| --- | --- |', maxChars: 80, useModel: false })
  assert.equal(result.source, 'raw')
  assert.equal(result.text, '甲 乙')
})

test('一个字都念不出来时才抛错（带上原因）', async () => {
  await assert.rejects(
    () => summarizeReply({ text: '\`\`\`ts\nconst a = 1\n\`\`\`', maxChars: 80, useModel: false }),
    /没有可播报的文字/,
  )
})

test('pickRoute：只认宿主选定的默认模型', () => {
  assert.deepEqual(pickRoute(services(fakeLlm([]))), { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  assert.match((pickRoute({}) as { reason: string }).reason, /llm/)
  assert.match(
    (pickRoute({ llm: fakeLlm([]) as never, defaultModel: { currentSelection: () => ({ provider: '', model: '' }) } }) as { reason: string }).reason,
    /没有选定默认模型/,
  )
})
