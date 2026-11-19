import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { apply, inject, name } from '../lib/index.js'

/** 最小 cordis context 替身：只提供 apply 用到的那几样。 */
function fakeContext() {
  const tools = []
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  const routes: { kind: string; path: string }[] = []
  const logs = []
  const ctx = {
    logger: () => ({
      info: (...args: unknown[]) => logs.push(args),
      warn: (...args: unknown[]) => logs.push(args),
      debug: (...args: unknown[]) => logs.push(args),
      error: (...args: unknown[]) => logs.push(args),
    }),
    tools: { register: (tool: unknown) => tools.push(tool) },
    // 宿主服务按需现取：测试里一个都没有（插件必须能在缺服务时照常加载）
    get: (_name: string) => undefined,
    on: (eventName: string, callback: (...args: unknown[]) => void) => {
      const list = listeners.get(eventName) ?? []
      list.push(callback)
      listeners.set(eventName, list)
      return () => {}
    },
    // 宿主服务按需注入：给一个假 webServer，验证路由真的挂上了
    inject: (names: string[], callback: (host: unknown) => void) => {
      if (!names.includes('webServer')) return
      callback({
        webServer: {
          register: (spec: { kind: string; path: string }) => {
            routes.push({ kind: spec.kind, path: spec.path })
            return () => {}
          },
        },
      })
    },
    effect: (fn: () => void) => fn(),
  }
  return { ctx, tools, listeners, routes, logs }
}

test('模块契约：name / inject 符合 DSH 插件约定', () => {
  assert.equal(name, 'broadcast')
  assert.deepEqual(inject, ['tools'])
})

test('apply 注册唯一工具 broadcast_say，参数与输出 schema 正确', () => {
  const { ctx, tools } = fakeContext()
  apply(ctx as never, {})
  assert.equal(tools.length, 1)
  const tool = tools[0] as Record<string, any>
  assert.equal(tool.name, 'broadcast_say')
  assert.equal(tool.parameters.type, 'object')
  assert.deepEqual(tool.parameters.required, ['text'])
  assert.equal(tool.parameters.properties.text.type, 'string')
  assert.equal(tool.output.schema.type, 'string')
  assert.equal(typeof tool.execute, 'function')
  assert.match(tool.description, /联网/)
  assert.match(tool.description, /播报/)
})

test('apply 订阅 session/event（S2 的自动播报入口）', () => {
  const { ctx, listeners, logs } = fakeContext()
  apply(ctx as never, { enabled: true })
  assert.equal(listeners.get('session/event')?.length, 1)
  // 加载日志里能看到开关与引擎，便于排查「为什么不响」
  assert.ok(logs.some((args) => String(args[0]).includes('dsh-broadcast 已加载')))
})

test('apply 挂上对话框开关的路由（S4 的遥控器）', () => {
  const { ctx, routes } = fakeContext()
  apply(ctx as never, { enabled: false })
  assert.deepEqual(routes, [{ kind: 'exact', path: '/dsh-broadcast/state' }])
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
