/**
 * BridgeOptions 声明了的每个字段，index.ts 真的传了吗？
 *
 * 和 RouteContext 那条守卫同一类：接口声明 + 调用点漏传 = 静默失效。
 * 这里查的是 index.ts 构造桥配置时有没有把字段带过去。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const server = readFileSync(join(here, '..', 'src', 'adapters', 'slowvale', 'server.ts'), 'utf8')
const index = readFileSync(join(here, '..', 'src', 'index.ts'), 'utf8')

function declaredOptions() {
  const start = server.indexOf('export interface BridgeOptions {')
  assert.ok(start > 0, '找不到 BridgeOptions')
  const body = server.slice(start, server.indexOf('\n}', start))
  const fields = []
  for (const line of body.split('\n')) {
    const m = line.match(/^  ([a-zA-Z_][a-zA-Z0-9_]*)\??:/)
    if (m) fields.push(m[1])
  }
  return fields
}

function passedOptions() {
  const start = index.indexOf('createSlowvaleBridge({')
  assert.ok(start > 0, '找不到 createSlowvaleBridge 调用')
  const body = index.slice(start, index.indexOf('\n        }).then', start))
  const keys = []
  for (const line of body.split('\n')) {
    const m = line.match(/^ {10}([a-zA-Z_][a-zA-Z0-9_]*)(?::|,)/)
    if (m) keys.push(m[1])
  }
  return keys
}

test('BridgeOptions 的字段在 index.ts 里都要传（漏传就是静默失效）', () => {
  const declared = declaredOptions()
  const passed = passedOptions()
  // 只给开发脚本用的旋钮：正式进程传它们没有意义，但必须写明理由。
  const devOnly = new Map([
    ['debug', '调试采集：只有 scripts/slowvale-dev.mjs 会打开'],
    ['forceVisible', '假的可见性：后台窗口测试用，正式进程不该伪造'],
  ])
  const missing = declared.filter((f) => !passed.includes(f) && !devOnly.has(f))
  assert.deepEqual(missing, [], '这些字段声明了但没传：' + missing.join(', '))
})
