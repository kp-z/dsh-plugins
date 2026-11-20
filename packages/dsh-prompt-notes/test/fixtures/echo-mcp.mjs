#!/usr/bin/env node
// 最小的 stdio MCP 测试桩（换行分隔的 JSON-RPC）：只有一个 echo 工具。
// 用途：在隔离的 DSH 测试实例里验证「MCP 便签 → mcpManager.register → 工具出现」这条真实链路。
// 用法：便签里 command=node，args=[本文件的绝对路径]。
import readline from 'node:readline'

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
const rl = readline.createInterface({ input: process.stdin })

rl.on('line', (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.method === 'initialize') {
    send({ id: m.id, result: {
      protocolVersion: m.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'pn-echo-fixture', version: '1.0.0' },
    } })
  } else if (m.method === 'tools/list') {
    send({ id: m.id, result: { tools: [{
      name: 'echo', description: 'Echo the given text back (test fixture).',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    }] } })
  } else if (m.method === 'tools/call') {
    send({ id: m.id, result: { content: [{ type: 'text', text: `echo: ${m.params?.arguments?.text ?? ''}` }] } })
  } else if (m.id !== undefined && m.method) {
    send({ id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } })
  } // 通知（无 id，如 notifications/initialized）不回复
})
rl.on('close', () => process.exit(0))
