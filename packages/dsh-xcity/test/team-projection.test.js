/**
 * 交付契约 team.projection 的验收（原验收文件 test/client-plugin.test.js 随旧前端删除）。
 *
 * 这条契约说的是**来源**：成员/任务来自官方 agentTeam projection，不轮询、不解析 tool call。
 * 旧前端删掉之后"谁在展示"变了，但"从哪来"这条不能变——所以验收改成对组合根的静态断言。
 *
 * 静态断言是弱的，但比"没有验收"强：它至少会在有人把 projection 换成轮询或解析时变红。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (rel) => readFileSync(new URL(rel, root), 'utf8')

test('团队投影：只从 agentTeams 服务取，不解析 tool call', () => {
  const index = read('src/index.ts')
  assert.match(index, /agentTeams/, '组合根必须消费 agentTeams 服务')
  assert.ok(
    !/JSON\.parse\([^)]*tool_call/.test(index),
    '不许从 tool call 里解析成员（那是观察实现细节，不是投影）',
  )
})

test('旧 web 面板已删除；client 入口只用于 DSH 左侧栏 tab', () => {
  // 旧面板（lib/web/main.js）是我们自己写的一套网页，已删除，不许回来。
  assert.throws(() => read('lib/web/main.js'), /ENOENT/)
  // client 入口现在**是需要的**：DSH 左侧栏 tab 靠它加载（package.json 的 exports[./client]）。
  // 但它只能是「宿主加载器里注册一个槽位」，不能重新长成一个自带前端的页面。
  assert.match(read('package.json'), /"\.\/client"/)
  assert.doesNotMatch(read('lib/client.iife.js'), /document\.body\.appendChild\(\s*document\.createElement\(\s*'div'\s*\)\s*\)/)
})
