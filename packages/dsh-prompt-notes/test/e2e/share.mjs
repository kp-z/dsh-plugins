#!/usr/bin/env node
/**
 * 真实环境里的分享回环：导出 → 删掉 → 预览 → 导入 → 导入的东西真的生效。
 *
 *   node test/e2e/share.mjs
 *
 * 前置：scripts/e2e.sh start（Host 半体最新）。
 * 断言：
 *   1. 导出的文件带 format/version，且包含刚建的两张便签
 *   2. 预览说出「会新建两条」并把 MCP 将执行的命令原样列出；预览本身不写盘
 *   3. 导入后两张便签回来了；MCP 仍然是未钉住（导出文件里它也没钉住）
 *   4. 导入的提示词真的进了真实 assemble 的 system prompt（不是只在面板里好看）
 *   5. 坏文件被整体拒绝，状态不变
 * 结束时删掉自己建的全部便签。
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..', '..')
const MARK = `share-${Date.now().toString(36)}`

const rawUrl = process.env.PN_TEST_URL
  || execFileSync(join(pkg, 'scripts', 'e2e.sh'), ['url'], { encoding: 'utf8' }).trim()
if (!rawUrl) { console.error('no test instance URL: run scripts/e2e.sh start first'); process.exit(2) }
const base = new URL(rawUrl).origin

let cookie = ''
{
  const res = await fetch(rawUrl, { redirect: 'manual' })
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
}
const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'content-type': 'application/json', ...(method === 'GET' ? {} : { 'x-dsh-prompt-notes': '1' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const until = async (what, fn, ms = 15000) => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for: ${what}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

let failures = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`); if (!ok) failures++ }

const ids = []
const created = [] // 本测试自己建的 id（测试 HOME 里可能还有别人的便签，断言只认自己的）
const mk = async (body) => {
  const r = await call('/dsh-prompt-notes/notes', 'POST', body)
  if (r.status !== 201) throw new Error(`create failed (${r.status}): ${JSON.stringify(r.json)}`)
  const id = r.json.notes.at(-1).id
  ids.push(id)
  created.push(id)
  return id
}

try {
  const promptId = await mk({ kind: 'prompt', title: `分享 ${MARK}`, body: `SHARE ${MARK} 回答用中文`, scope: 'global' })
  const mcpName = `pns${MARK.replace(/[^a-z0-9]/g, '')}`.slice(0, 30)
  const mcpId = await mk({ kind: 'mcp', body: 'fixture', enabled: false, scope: 'global',
    mcp: { name: mcpName, transport: 'stdio', command: 'node', args: [join(here, '..', 'fixtures', 'echo-mcp.mjs')] } })

  // ① 导出
  // 只导出自己建的这两张：测试 HOME 里可能还有别的便签，导全部会把它们也带回来
  const exported = await call('/dsh-prompt-notes/export?ids=' + created.join(','))
  check('export answers with a share file', exported.json?.format === 'dsh-prompt-notes' && exported.json.version >= 1)
  const byId = new Map(exported.json.notes.map((n) => [n.id, n]))
  check('the two new notes are in the export', byId.has(promptId) && byId.has(mcpId) && exported.json.notes.length === 2, JSON.stringify(exported.json.notes.map((n) => n.kind)))
  check('the exported MCP note is unpinned', byId.get(mcpId)?.enabled === false)
  const bundle = exported.json

  // ② 先删掉，回到"干净"状态
  for (const id of created) await call(`/dsh-prompt-notes/notes/${id}`, 'DELETE')
  ids.length = 0
  const cleared = await until('notes gone', async () => {
    const s = (await call('/dsh-prompt-notes/state')).json
    return created.every((id) => !s.notes.some((n) => n.id === id)) ? s : null
  })
  check('notes removed before importing back', created.every((id) => !cleared.notes.some((n) => n.id === id)))

  // ③ 预览
  const preview = await call('/dsh-prompt-notes/import/preview', 'POST', { bundle, strategy: 'rename' })
  check('preview says it would create two notes', preview.json?.counts?.create === 2, JSON.stringify(preview.json?.counts))
  check('preview lists the command that pinning would run',
    (preview.json?.warnings ?? []).some((w) => w.includes('echo-mcp.mjs')))
  const stillAfterPreview = (await call('/dsh-prompt-notes/state')).json.notes
  check('preview writes nothing', created.every((id) => !stillAfterPreview.some((n) => n.id === id)))

  // ④ 导入
  const imported = await call('/dsh-prompt-notes/import', 'POST', { bundle, strategy: 'rename' })
  check('import reports two added', imported.status === 200 && imported.json?.imported?.added === 2, JSON.stringify(imported.json?.imported))
  const after = imported.json.notes
  const ours = after.filter((n) => n.kind === 'mcp' ? n.mcp?.name?.startsWith('pns') : String(n.body || '').includes(MARK))
  check('both notes are back', ours.length === 2)
  check('the imported MCP is unpinned', after.find((n) => n.kind === 'mcp')?.enabled === false)
  for (const n of after) ids.push(n.id)
  check('the imported notes have fresh ids', ours.every((n) => !bundle.notes.some((b) => b.id === n.id)))

  // ⑤ 导入的提示词真的进了真实 assemble 结果
  const sys = await until('imported prompt in the real system prompt', async () => {
    const s = (await call('/dsh-prompt-notes/system')).json
    const mineText = (s.sections ?? []).find((x) => x.mine)?.text ?? ''
    return mineText.includes(MARK) ? s : null
  })
  check('the imported prompt reaches the real system prompt', Boolean(sys))

  // ⑥ 坏文件：整体拒绝，状态不变
  const bad = await call('/dsh-prompt-notes/import', 'POST', { bundle: { format: 'x', version: 1, notes: [] }, strategy: 'rename' })
  check('a foreign file is rejected with 400', bad.status === 400)
  const afterBad = (await call('/dsh-prompt-notes/state')).json.notes
  check('a rejected import changes nothing', afterBad.length === after.length)
} catch (error) {
  failures++
  console.log(`FAIL  ${error.message}`)
} finally {
  for (const id of ids) await call(`/dsh-prompt-notes/notes/${id}`, 'DELETE').catch(() => {})
  try {
    await until('cleanup withdrawn', async () => {
      const s = (await call('/dsh-prompt-notes/state')).json
      const sys = (await call('/dsh-prompt-notes/system')).json
      const mineText = (sys.sections ?? []).find((x) => x.mine)?.text ?? ''
      const gone = created.every((id) => !s.notes.some((n) => n.id === id))
      return gone && !mineText.includes(MARK) ? true : null
    }, 12000)
    check('deleting the imported notes removes them everywhere', true)
  } catch (e) { failures++; console.log(`FAIL  cleanup: ${e.message}`) }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall share checks passed')
process.exit(failures ? 1 : 0)