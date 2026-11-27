/**
 * RouteContext 的每个字段都必须真的被赋值。
 *
 * 只读源码做静态比对，不需要起桥。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'src', 'adapters', 'slowvale', 'server.ts'), 'utf8')
const routesSrc = readFileSync(join(here, '..', 'src', 'adapters', 'slowvale', 'routes.ts'), 'utf8')

function interfaceFields(name) {
  const start = routesSrc.indexOf('interface ' + name + ' {')
  assert.ok(start > 0, '找不到接口 ' + name)
  const body = routesSrc.slice(start, routesSrc.indexOf('\n}', start))
  const fields = []
  for (const line of body.split('\n')) {
    const m = line.match(/^  ([a-zA-Z_][a-zA-Z0-9_]*)\??:/)
    if (m) fields.push(m[1])
  }
  return fields
}

function ctxKeys() {
  const start = src.indexOf('const ctx: RouteContext = {')
  assert.ok(start > 0, '找不到 ctx 构造')
  const body = src.slice(start, src.indexOf('\n  }', start))
  const keys = []
  for (const line of body.split('\n')) {
    const m = line.match(/^    ([a-zA-Z_][a-zA-Z0-9_]*)(?::|,)/)
    if (m) keys.push(m[1])
  }
  return keys
}

test('RouteContext 声明的字段和 ctx 里赋值的字段必须一致', () => {
  const declared = interfaceFields('RouteContext')
  const assigned = ctxKeys()
  const missing = declared.filter((f) => !assigned.includes(f))
  assert.deepEqual(missing, [], '这些字段声明了但没赋值（漏传就是静默失效）：' + missing.join(', '))
})
