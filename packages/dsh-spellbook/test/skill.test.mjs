/**
 * spellbook skill 的测试。
 *
 * 护三件事：
 *
 * 1. **目录那一行与正文同源**。description 只在 SKILL.md 的 frontmatter 里写一次；
 *    代码里再抄一份，就会变成「目录上写的是 A、模型读到的是 B」—— 没人会发现的那种错。
 * 2. **正文必须指向工具**。skill 本身不检索，它说「调 spellbook_lookup」。一旦工具改了名，
 *    这句话就变成一条做不到事的指令，而模型只会照着做、然后失败。
 * 3. **工具不在就不挂 skill**。目录里留一条依赖不存在工具的条目，比没有这条条目更坏。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_FILE = path.join(ROOT, 'SKILL.md')
const LIB = path.join(ROOT, 'lib')

const { registerSpellbookSkill } = await import(pathToFileURL(path.join(LIB, 'skill.js')).href)

/** 造一个只认 skills 的上下文，把注册出来的 provider 与回收钩子都抓出来。 */
function harness(file) {
  const seen = { provider: null, cleanup: null, disposed: false, deps: [] }
  const ctx = {
    inject(names, cb) {
      seen.deps.push(names.join(','))
      if (!names.includes('skills')) return
      cb({
        skills: {
          registerProvider(create) {
            seen.provider = create()
            return () => {
              seen.disposed = true
            }
          },
        },
        // cordis 的 effect 会立刻跑回调，把它的返回值收作 disposer
        effect(fn) {
          seen.cleanup = fn()
        },
      })
    },
  }
  registerSpellbookSkill(ctx, file)
  return seen
}

function frontmatterField(raw, key) {
  return new RegExp('^' + key + ':\\s*(.+?)\\s*$', 'm').exec(raw)?.[1]
}

async function tempSkill(body) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spellbook-skill-'))
  const file = path.join(dir, 'SKILL.md')
  await writeFile(file, body)
  return { dir, file }
}

test('目录条目：名字、来源、优先级与 frontmatter 一致', async () => {
  const seen = harness(SKILL_FILE)
  assert.ok(seen.provider, '没有注册 provider')
  assert.equal(seen.provider.name, 'dsh-spellbook')

  const [candidate] = await seen.provider.list()
  const raw = readFileSync(SKILL_FILE, 'utf8')

  assert.equal(candidate.name, 'spellbook')
  assert.equal(candidate.name, frontmatterField(raw, 'name'), '注册名与 frontmatter 的 name 不一致')
  assert.equal(candidate.description, frontmatterField(raw, 'description'), '目录那一行不是 frontmatter 里那一行')
  assert.match(candidate.description, /长这样/)
  assert.equal(candidate.provider, 'dsh-spellbook')
  assert.equal(candidate.source, 'bundled')
  assert.equal(candidate.rank, 600)
  assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true })
  // 目录阶段不读正文：候选上不该有 content，否则每次列目录都在读整份文件
  assert.equal('content' in candidate, false)
})

test('正文：去掉 frontmatter，且必须指向 spellbook_lookup', async () => {
  const seen = harness(SKILL_FILE)
  const skill = await seen.provider.get()

  assert.equal(skill.name, 'spellbook')
  assert.match(skill.content, /^# 长这样/m)
  assert.equal(skill.content.includes('description:'), false, 'frontmatter 混进了正文')
  assert.equal(skill.content.startsWith('---'), false, 'frontmatter 混进了正文')

  // skill 不检索，它只教怎么用工具 —— 所以工具名必须出现在正文里
  assert.match(skill.content, /spellbook_lookup/)
  // 三条承重的话：怎么判命中、哪段不能跳、怎么答
  assert.match(skill.content, /命中/)
  assert.match(skill.content, /容易失效的地方/)
  assert.match(skill.content, /slug/)
})

test('正文现读：改 SKILL.md 不用重启宿主', async () => {
  const { dir, file } = await tempSkill('---\nname: spellbook\ndescription: 第一版\n---\n旧正文\n')
  try {
    const seen = harness(file)
    assert.equal((await seen.provider.list())[0].description, '第一版')
    assert.match((await seen.provider.get()).content, /旧正文/)

    await writeFile(file, '---\nname: spellbook\ndescription: 第二版\n---\n新正文\n')
    assert.equal((await seen.provider.list())[0].description, '第二版', '目录那一行没有跟着文件走')
    assert.match((await seen.provider.get()).content, /新正文/, '正文没有现读')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('frontmatter 缺 description 就报错，不许静默出一条没说的话', async () => {
  const { dir, file } = await tempSkill('---\nname: spellbook\n---\n正文\n')
  try {
    const seen = harness(file)
    await assert.rejects(() => seen.provider.list(), /description/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('插件卸载时把 provider 摘掉', () => {
  const seen = harness(SKILL_FILE)
  assert.equal(typeof seen.cleanup, 'function', '回收钩子没挂到 ctx 上')
  seen.cleanup()
  assert.equal(seen.disposed, true)
})

test('工具没挂上就不挂 skill —— 目录里不留做不到事的条目', async () => {
  const mod = await import(pathToFileURL(path.join(LIB, 'index.js')).href)
  const deps = []
  const ctx = {
    inject(names, cb) {
      deps.push(names.join(','))
      if (names.includes('webServer')) cb({ webServer: { register: () => () => {} } })
      if (names.includes('skills')) cb({ skills: { registerProvider: () => () => {} } })
    },
    on() {},
  }
  mod.apply(ctx)
  assert.equal(deps.includes('skills'), false, '没有 tool 却去找了 skills')
})

test('工具挂上之后才去找 skills 服务', async () => {
  const mod = await import(pathToFileURL(path.join(LIB, 'index.js')).href)
  const deps = []
  let provider = null
  const ctx = {
    get: (key) => (key === 'tools' ? { register: () => () => {} } : undefined),
    effect: (fn) => fn(),
    inject(names, cb) {
      deps.push(names.join(','))
      if (names.includes('webServer')) cb({ webServer: { register: () => () => {} } })
      if (names.includes('skills')) {
        cb({
          skills: { registerProvider: (create) => { provider = create(); return () => {} } },
          effect() {},
        })
      }
    },
    on() {},
  }
  mod.apply(ctx)

  assert.ok(deps.includes('skills'), '工具挂上了却没有去挂 skill')
  assert.ok(provider, 'skills 服务在、但没有注册 provider')
  assert.equal((await provider.list())[0].name, 'spellbook')
})
