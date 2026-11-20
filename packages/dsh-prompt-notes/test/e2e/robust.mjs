#!/usr/bin/env node
/**
 * 真实实例里的稳健性检查（M6 ②③）：
 *   ② 200 条便签时的接口与组装耗时（度量并打印，不做硬断言——机器不同）
 *   ③ 数据文件被写坏之后：实例还活着、接口还答得上、坏文件被备份、修好就恢复
 *
 *   node test/e2e/robust.mjs
 *
 * 前置：scripts/e2e.sh start。**会直接改写隔离实例的数据文件**（/tmp/pn-test-home 下），
 * 结束时会把它还原成空便签簿。绝不碰 ~/.dsh。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..', '..')
const HOME = process.env.PN_TEST_HOME || '/tmp/pn-test-home'
const FILE = join(HOME, 'prompt-notes', 'notes.json')
const MARK = `robust-${Date.now().toString(36)}`

const rawUrl = process.env.PN_TEST_URL
  || execFileSync(join(pkg, 'scripts', 'e2e.sh'), ['url'], { encoding: 'utf8' }).trim()
if (!rawUrl) { console.error('no test instance URL: run scripts/e2e.sh start first'); process.exit(2) }
const base = new URL(rawUrl).origin
const res = await fetch(rawUrl, { redirect: 'manual' })
const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

const call = async (path) => {
  const r = await fetch(base + path, { headers: { cookie } })
  return { status: r.status, json: await r.json().catch(() => null) }
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
const note = (i) => ({
  id: `robust-${MARK}-${i}`, kind: 'prompt', scope: 'global', target: '', title: `第 ${i} 条`, color: 'yellow',
  body: i === 0 ? `ROBUST ${MARK}` : `第 ${i} 条的正文，用来凑长度。` + 'x'.repeat(120), tags: [], enabled: true,
  createdAt: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
  updatedAt: '2026-01-01T00:00:00.000Z',
})
/**
 * 直接写数据文件时顺手把 mtime 往前推一点：store 用 `mtimeMs:size` 判断文件是否变过，
 * 连续两次写入如果落在同一毫秒、大小又碰巧一样，它就不会重读（这是真实存在的竞态）。
 */
let touchTick = 0
const touch = () => { const t = new Date(Date.now() + (++touchTick)); utimesSync(FILE, t, t) }
const writeRaw = (text) => { writeFileSync(FILE, text); touch() }
const writeDoc = (notes, extra = {}) => writeRaw(JSON.stringify({ version: 3, paused: false, notes, trash: [], ...extra }, null, 2))

const original = existsSync(FILE) ? readFileSync(FILE, 'utf8') : null
// 本测试会故意写坏文件、于是 store 会留下 corrupt 备份：记住开跑前有哪些，结束时只删自己制造的
const DIR = join(HOME, 'prompt-notes')
const backupsBefore = new Set(existsSync(DIR) ? readdirSync(DIR).filter((f) => f.startsWith('notes.json.corrupt')) : [])
try {
  // ① 200 条：直接写文件（顺便省掉 200 次 HTTP 往返），等 store 的 poll 感知到
  writeDoc(Array.from({ length: 200 }, (_, i) => note(i)))
  const state = await until('200 notes loaded', async () => { const s = await call('/dsh-prompt-notes/state'); return s.json?.notes?.length === 200 ? s : null })
  check('200 notes load from the data file', state.json.notes.length === 200)

  const times = []
  let payload = 0
  for (let i = 0; i < 6; i++) {
    const t0 = performance.now()
    const r = await call('/dsh-prompt-notes/state')
    times.push(performance.now() - t0)
    payload = JSON.stringify(r.json).length
  }
  const sorted = times.slice(1).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  console.log(`INFO  /state with 200 notes: median ${median.toFixed(1)}ms (max ${Math.max(...times).toFixed(1)}ms), payload ${(payload / 1024).toFixed(1)} KB`)
  check('/state with 200 notes answers under 200ms (median)', median < 200, `${median.toFixed(1)}ms`)

  // 组装（真实 assemble）也要在 200 条下答得出来
  // /system 每个观察者有 3 秒缓存：用一个独立的 cwd 换个缓存键，并轮询到标记真的出现再算数
  const t1 = performance.now()
  const mine = await until('assemble with 200 notes', async () => {
    const s = await call('/dsh-prompt-notes/system?cwd=/tmp/pn-robust-perf')
    const text = (s.json?.sections ?? []).find((x) => x.mine)?.text ?? ''
    return text.includes(`ROBUST ${MARK}`) ? text : null
  })
  const assembleMs = performance.now() - t1
  console.log(`INFO  /system (real assemble) with 200 notes: ${assembleMs.toFixed(1)}ms, section ${mine.length} chars`)
  check('the notes section still renders with 200 notes', mine.includes(`ROBUST ${MARK}`))

  // ② 写坏文件：实例必须活着，接口必须还答得上
  const before = readdirSync(join(HOME, 'prompt-notes')).filter((f) => f.startsWith('notes.json.corrupt'))
  writeRaw('{"version":3,"notes":[{"kind":"prompt" 这不是 JSON')
  await until('corrupt file noticed', async () => { const s = await call('/dsh-prompt-notes/state'); return s.json && s.json.notes.length === 0 ? s : null })
  check('a corrupt data file does not crash the instance', (await call('/dsh-prompt-notes/state')).status === 200)
  const after = readdirSync(join(HOME, 'prompt-notes')).filter((f) => f.startsWith('notes.json.corrupt'))
  check('the corrupt file is kept as a backup', after.length > before.length, `${before.length} → ${after.length}`)
  const sys2 = await call('/dsh-prompt-notes/system')
  check('the real assemble still answers with an empty notes section', sys2.status === 200 && Boolean(sys2.json?.sections))

  // ③ 修好 → 恢复
  writeDoc(Array.from({ length: 200 }, (_, i) => note(i)))
  const back = await until('notes recovered after fixing the file', async () => { const s = await call('/dsh-prompt-notes/state'); return s.json?.notes?.length === 200 ? s : null })
  check('fixing the file brings the notes back', back.json.notes.length === 200)
} catch (error) {
  failures++
  console.log(`FAIL  ${error.message}`)
} finally {
  try {
    if (original !== null) writeRaw(original)
    else writeDoc([])
    await until('instance settled after restore', async () => {
      const s = await call('/dsh-prompt-notes/state')
      return s.status === 200 ? true : null
    }, 10000)
    check('the instance answers after cleanup', true)
    for (const f of readdirSync(DIR)) {
      if (f.startsWith('notes.json.corrupt') && !backupsBefore.has(f)) { try { rmSync(join(DIR, f), { force: true }) } catch { /* 删不掉就留着 */ } }
    }
  } catch (e) { failures++; console.log(`FAIL  cleanup: ${e.message}`) }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall robustness checks passed')
process.exit(failures ? 1 : 0)