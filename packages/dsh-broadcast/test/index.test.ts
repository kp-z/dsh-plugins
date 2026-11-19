import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, inject, name } from '../lib/index.js'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** 最小 cordis context 替身：只提供 apply 用到的那两样。 */
function fakeContext() {
  const tools = []
  const logs = []
  const ctx = {
    logger: () => ({
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    }),
    tools: { register: (tool) => tools.push(tool) },
  }
  return { ctx, tools, logs }
}

test('模块契约：name / inject 符合 DSH 插件约定', () => {
  assert.equal(name, 'broadcast')
  assert.deepEqual(inject, ['tools'])
})

test('apply 注册唯一工具 broadcast_say，参数与输出 schema 正确', () => {
  const { ctx, tools } = fakeContext()
  apply(ctx as never, {})
  assert.equal(tools.length, 1)
  const tool = tools[0]
  assert.equal(tool.name, 'broadcast_say')
  assert.equal(tool.parameters.type, 'object')
  assert.deepEqual(tool.parameters.required, ['text'])
  assert.equal(tool.parameters.properties.text.type, 'string')
  assert.equal(tool.output.schema.type, 'string')
  assert.equal(typeof tool.execute, 'function')
  // 工具描述要说清副作用（联网合成 + 出声）
  assert.match(tool.description, /联网/)
  assert.match(tool.description, /播报/)
})

test('定义与示例工具同构：defineTool 产出 name/description/parameters/output/execute', () => {
  const tool = defineTool({
    name: 'x',
    description: 'd',
    parameters: { text: { type: 'string', required: true, description: 't' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute: async () => 'ok',
  })
  assert.deepEqual(Object.keys(tool).sort(), ['description', 'execute', 'name', 'output', 'parameters'])
})
