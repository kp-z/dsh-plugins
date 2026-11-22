#!/usr/bin/env node
/**
 * xcity 绑定 CLI：把角色绑到 DSH 会话（严格一对一）。
 *
 * 用法：
 *   node scripts/xcity-bind.mjs list
 *   node scripts/xcity-bind.mjs bind <characterId> <sessionId>
 *   node scripts/xcity-bind.mjs unbind <sessionId> [reason]
 *
 * 规则**不在这里重写**：直接复用 dsh-slowvale 的 BindingTable（库里已有 1:1 校验与测试）。
 * 这个脚本只做两件事：读盘 → 交给库 → 写盘。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { BindingTable, FileBindingStore } from '../../dsh-slowvale/lib/index.js'

// 工作区按 cove 的做法放在 ~/.dsh/<name>：DSH 的工作区注册表指向那里。
const file = process.env.XCITY_BINDINGS ?? homedir() + '/.dsh/xcity/bindings.json'
const store = new FileBindingStore(file)
const table = store.load()

const [command, ...rest] = process.argv.slice(2)

function print() {
  const active = table.active()
  if (active.length === 0) {
    console.log('（还没有绑定）')
    return
  }
  for (const row of active) {
    console.log(row.characterId + '  ←  ' + row.sessionId + '  [' + row.channel + ', tick ' + row.boundAtTick + ']')
  }
}

if (command === 'list') {
  print()
} else if (command === 'bind') {
  const [characterId, sessionId] = rest
  if (!characterId || !sessionId) {
    console.error('用法：bind <characterId> <sessionId>')
    process.exit(2)
  }
  const row = table.bind({ characterId, sessionId, tick: 0 })
  store.save(table)
  console.log('已绑定：' + row.characterId + ' ← ' + row.sessionId)
  print()
} else if (command === 'unbind') {
  const [sessionId, reason] = rest
  if (!sessionId) {
    console.error('用法：unbind <sessionId> [reason]')
    process.exit(2)
  }
  const ok = table.archive(sessionId, 0, reason ?? 'manual')
  store.save(table)
  console.log(ok ? '已归档：' + sessionId : '没找到这个会话的活绑定')
  print()
} else {
  console.error('用法：list | bind <characterId> <sessionId> | unbind <sessionId> [reason]')
  process.exit(2)
}
