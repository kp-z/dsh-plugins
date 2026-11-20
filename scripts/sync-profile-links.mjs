// 把本地插件包的构建产物补进 dsh profile 的安装副本（补齐硬链接副本里缺失的新文件）。
//
// 为什么需要它：
//   profile 里用 `file:` 依赖装的本地包，pnpm（nodeLinker: hoisted）会按 package.json 的
//   `files` 白名单做一份「硬链接副本」到 node_modules/<name>。硬链接的语义是：
//     · 已存在的文件被原地重写（tsc 的常规行为）→ 两边自动同步，因为 inode 是同一个；
//     · 新增的文件是全新 inode，没有任何环节会把它链接进 profile → 副本静默缺文件。
//   一旦入口 index.js 引用了新模块，运行时就是 ERR_MODULE_NOT_FOUND；而 dsh 是「插件树
//   加载失败就整体不启动」，表现就是 `dsh web` 直接打不开、且报错指向一个「明明存在」的文件。
//
//   实例：新增 src/dirAi.ts 构建出 lib/dirAi.js，profile 副本没有它，而 lib/index.js 因为
//   原地重写已经带上 `import './dirAi.js'` → 启动崩溃。
//
// 做什么：按 `files` 白名单比对源码包与 profile 副本
//   缺失                  → 硬链接补齐
//   内容不一致            → 重链覆盖
//   内容相同但已不是硬链接 → 归一化为硬链接（跨设备等无法硬链接时退化为复制）
//   `link:` 依赖的 node_modules 是符号链接、天然同源，本脚本对它是 no-op。
//
// 顺带：把 profile 的 `dsh.profile.bundles` 里因包改名而失效的旧名字改写掉
//       （包改名后 dsh 解析不到旧 bundle 名，插件会静默消失）。
//
// 用法：node scripts/sync-profile-links.mjs [profile] [--dry-run] [--prune]
//   profile     目标 profile 名，默认 web（也可写 --profile=web）
//   --dry-run   只报告差异不写盘；有差异时退出码 1（可当门禁）
//   --prune     额外删除副本里源码已不存在的文件（默认只报告不删）
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const SKIP_DIRS = new Set(['node_modules', '.git'])
// npm 无论 files 怎么写都会打包的文件（只看包顶层）
const ALWAYS_INCLUDED = /^(package\.json|readme|licen[cs]e|changelog|notice)(\.[^.]*)?$/i
const MAX_LIST = 20

const HELP = `用法: node scripts/sync-profile-links.mjs [profile] [--dry-run] [--prune]
  profile     目标 profile 名，默认 web
  --dry-run   只报告差异不写盘；有差异时退出码 1
  --prune     额外删除副本里源码已不存在的文件

同时对齐 dsh.profile.bundles 里因改名失效的旧包名（写盘前自动备份 package.json）`

function parseArgs(argv) {
  const opts = { profile: 'web', dryRun: false, prune: false, help: false }
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') opts.dryRun = true
    else if (arg === '--prune') opts.prune = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg.startsWith('--profile=')) opts.profile = arg.slice('--profile='.length)
    else if (arg.startsWith('-')) throw new Error('未知参数: ' + arg)
    else opts.profile = arg
  }
  return opts
}

function toPosix(p) {
  return p.split(path.sep).join('/')
}

// 递归收集文件（相对 root 的 posix 路径）。目录内始终跳过 node_modules/.git；符号链接跳过。
function walkFiles(root, dir, onFile, skipDotFiles) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    if (skipDotFiles && entry.name.startsWith('.')) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(root, abs, onFile, skipDotFiles)
    else if (entry.isFile()) onFile(toPosix(path.relative(root, abs)))
  }
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const pattern = escaped
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?')
  return new RegExp('^' + pattern + '$')
}

// 按 package.json 的 files 白名单算出「应该出现在 profile 副本里」的文件集合
function collectShipped(pkgDir, pkgJson) {
  const shipped = new Set()
  const missingEntries = []

  const addEntry = (entry) => {
    const abs = path.join(pkgDir, entry)
    let stat
    try {
      stat = fs.statSync(abs)
    } catch {
      missingEntries.push(entry)
      return
    }
    if (stat.isDirectory()) walkFiles(pkgDir, abs, (rel) => shipped.add(rel), false)
    else shipped.add(entry)
  }

  const files = Array.isArray(pkgJson.files) ? pkgJson.files : null
  if (files) {
    for (const raw of files) {
      const entry = String(raw).replace(/^\.\//, '').replace(/\/+$/, '')
      if (!entry) continue
      if (entry.includes('*')) {
        const re = globToRegExp(entry)
        let hit = 0
        walkFiles(pkgDir, pkgDir, (rel) => {
          if (re.test(rel)) {
            shipped.add(rel)
            hit++
          }
        }, true)
        if (hit === 0) missingEntries.push(entry)
      } else {
        addEntry(entry)
      }
    }
  } else {
    // 没有 files 字段：按 npm 语义全量打包（跳过点文件与 node_modules/.git）
    walkFiles(pkgDir, pkgDir, (rel) => shipped.add(rel), true)
  }

  for (const entry of fs.readdirSync(pkgDir, { withFileTypes: true })) {
    if (entry.isFile() && ALWAYS_INCLUDED.test(entry.name)) shipped.add(entry.name)
  }
  const main = typeof pkgJson.main === 'string' ? pkgJson.main.replace(/^\.\//, '') : null
  if (main && fs.existsSync(path.join(pkgDir, main))) shipped.add(main)

  return { shipped, missingEntries }
}

function isSameInode(a, b) {
  const sa = fs.statSync(a)
  const sb = fs.statSync(b)
  return sa.ino === sb.ino && sa.dev === sb.dev
}

function isSameContent(a, b) {
  const sa = fs.statSync(a)
  const sb = fs.statSync(b)
  if (sa.size !== sb.size) return false
  return fs.readFileSync(a).equals(fs.readFileSync(b))
}

// 先链到临时名再 rename，避免覆盖时出现「目标短暂不存在」的窗口
function placeLink(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  const tmp = dst + '.sync-tmp-' + process.pid
  let how = 'hardlink'
  try {
    fs.linkSync(src, tmp)
  } catch {
    fs.copyFileSync(src, tmp)
    how = 'copy'
  }
  fs.renameSync(tmp, dst)
  return how
}

function syncPackage({ pkgDir, dstPkg, dryRun, prune }) {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  const { shipped, missingEntries } = collectShipped(pkgDir, pkgJson)

  const added = []
  const updated = []
  const relinked = []
  const conflicts = []
  let inSync = 0

  for (const rel of [...shipped].sort()) {
    const src = path.join(pkgDir, rel)
    const dst = path.join(dstPkg, rel)
    if (!fs.existsSync(dst)) {
      if (!dryRun) placeLink(src, dst)
      added.push(rel)
      continue
    }
    if (fs.statSync(dst).isDirectory()) {
      conflicts.push(rel)
      continue
    }
    if (isSameInode(src, dst)) {
      inSync++
      continue
    }
    if (isSameContent(src, dst)) {
      if (!dryRun) placeLink(src, dst)
      relinked.push(rel)
      continue
    }
    if (!dryRun) placeLink(src, dst)
    updated.push(rel)
  }

  // 副本里多出来的文件（源码已删除或已移出白名单）
  const extra = []
  walkFiles(dstPkg, dstPkg, (rel) => {
    if (!shipped.has(rel)) extra.push(rel)
  }, true)
  extra.sort()

  const pruned = []
  if (prune) {
    for (const rel of extra) {
      if (!dryRun) fs.rmSync(path.join(dstPkg, rel), { force: true })
      pruned.push(rel)
    }
  }

  return { added, updated, relinked, conflicts, extra, pruned, inSync, missingEntries }
}

function listPaths(paths, prefix) {
  for (const p of paths.slice(0, MAX_LIST)) console.log('    ' + prefix + ' ' + p)
  if (paths.length > MAX_LIST) console.log('    … 还有 ' + (paths.length - MAX_LIST) + ' 个')
}

function report(name, r, opts) {
  const changes = r.added.length + r.updated.length + r.relinked.length + r.pruned.length
  const suffix = opts.dryRun ? '（待写入）' : ''
  if (changes === 0) {
    console.log('✓ ' + name + '：副本与源码一致（' + r.inSync + ' 个文件）')
  } else {
    console.log('• ' + name + '：')
  }
  if (r.added.length) {
    console.log('  + 补齐缺失 ' + r.added.length + ' 个' + suffix)
    listPaths(r.added, '+')
  }
  if (r.updated.length) {
    console.log('  ~ 内容不一致 ' + r.updated.length + ' 个' + (opts.dryRun ? suffix : '，已重链覆盖'))
    listPaths(r.updated, '~')
  }
  if (r.relinked.length) {
    console.log('  = 内容相同但非硬链接 ' + r.relinked.length + ' 个' + (opts.dryRun ? suffix : '，已归一化为硬链接'))
    listPaths(r.relinked, '=')
  }
  if (r.conflicts.length) {
    console.log('  ! 副本里是目录、源码里是文件，未处理 ' + r.conflicts.length + ' 个')
    listPaths(r.conflicts, '!')
  }
  if (r.extra.length && !opts.prune) {
    console.log('  ? 副本里多出 ' + r.extra.length + ' 个源码已不存在的文件（--prune 可清理）')
    listPaths(r.extra, '?')
  }
  if (r.pruned.length) {
    console.log('  - 清理多余 ' + r.pruned.length + ' 个' + suffix)
    listPaths(r.pruned, '-')
  }
  if (r.missingEntries.length) {
    console.log('  ! files 白名单里有 ' + r.missingEntries.length + ' 项在源码里不存在（是不是没构建？）：' + r.missingEntries.join(', '))
  }
}

// profile 的 `dsh.profile.bundles` 是按**名字**解析包的：包一改名（dsh-x → @scope/dsh-x），
// 旧条目就解析不到，dsh 会跳过整个 bundle——表现就是「插件不见了」。
// 这里把仍指向旧名的条目，按 deps 里 basename 相同、且确实装上了的新名字改写掉。
function planBundleAlignment(profileDir, profileJson) {
  const bundles = profileJson?.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) return null
  const req = createRequire(path.join(profileDir, 'package.json'))
  // node_modules 里存在就算能解析：有些包只暴露 ESM exports，require.resolve 会误判成失败。
  const resolves = (name) => {
    if (fs.existsSync(path.join(profileDir, 'node_modules', name))) return true
    try {
      req.resolve(name)
      return true
    } catch {
      return false
    }
  }
  const deps = Object.keys(profileJson.dependencies || {})
  const renamed = []
  const pending = []
  const unresolved = []
  const next = []
  for (const name of bundles) {
    let entry = name
    // 已不是当前依赖名、但 deps 里有同 basename 的新名字 → 是改名残留，跟着 deps 走
    if (!deps.includes(name)) {
      const sameBase = deps.filter((dep) => dep.split('/').pop() === name)
      const ready = sameBase.filter(resolves)
      if (ready.length === 1) {
        entry = ready[0]
        renamed.push([name, entry])
      } else if (sameBase.length) pending.push([name, sameBase[0]])
      else if (!resolves(name) && !name.startsWith('@deepseek-ai/')) unresolved.push(name) // @deepseek-ai/* 由 app 自带
    } else if (!resolves(name)) {
      unresolved.push(name)
    }
    if (!next.includes(entry)) next.push(entry)
  }
  return { renamed, pending, unresolved, next, changed: renamed.length > 0 || next.length !== bundles.length }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(HELP)
    return 0
  }

  const profileDir = path.join(DSH_HOME, 'profiles', opts.profile)
  const profileJsonPath = path.join(profileDir, 'package.json')
  if (!fs.existsSync(profileJsonPath)) {
    console.error('✗ 找不到 profile：' + profileDir)
    return 1
  }

  const profileJson = JSON.parse(fs.readFileSync(profileJsonPath, 'utf8'))
  const localDeps = Object.entries(profileJson.dependencies || {}).filter(([, spec]) => /^(file|link):/.test(spec))

  console.log('profile: ' + profileDir)
  console.log('本地依赖: ' + (localDeps.length ? localDeps.map(([n]) => n).join(', ') : '（无）'))
  console.log('模式: ' + (opts.dryRun ? '只读检查（--dry-run）' : '同步') + (opts.prune ? ' + 清理多余文件' : ''))
  console.log('')

  let drift = 0
  let failed = 0
  const notInstalled = []

  const bundles = planBundleAlignment(profileDir, profileJson)
  if (bundles) {
    if (bundles.renamed.length) {
      console.log('bundle 名还是旧包名（dsh 会解析不到、整个插件被跳过）：')
      for (const [from, to] of bundles.renamed) console.log('  → ' + from + '  ⟶  ' + to)
    }
    for (const [from, to] of bundles.pending) {
      console.log('  ! ' + from + ' 的依赖已改名成 ' + to + '，但还没装：先在该 profile 完成安装再重跑本脚本')
    }
    if (bundles.unresolved.length) {
      console.log('  ! bundles 里这些名字在 profile 中解析不到（不是本仓库的本地包？）：' + bundles.unresolved.join(', '))
    }
    if (bundles.changed) {
      drift += bundles.renamed.length
      if (opts.dryRun) {
        console.log('  （--dry-run 未写盘）')
      } else {
        const backup = profileJsonPath + '.bak-bundles-' + Date.now()
        fs.copyFileSync(profileJsonPath, backup)
        profileJson.dsh.profile.bundles = bundles.next
        fs.writeFileSync(profileJsonPath, JSON.stringify(profileJson, null, 2) + '\n')
        console.log('  ✓ bundles 已改写，原文件备份为 ' + path.basename(backup) + '（重启 dsh 生效）')
      }
    }
    if (bundles.renamed.length || bundles.pending.length) console.log('')
  }

  const outsideRepo = []

  for (const [name, spec] of localDeps) {
    const pkgDir = path.resolve(profileDir, spec.replace(/^(file|link):/, ''))
    if (pkgDir !== REPO_ROOT && !pkgDir.startsWith(REPO_ROOT + path.sep)) {
      outsideRepo.push(name + ' → ' + pkgDir)
      continue
    }
    const dstPkg = path.join(profileDir, 'node_modules', name)
    if (!fs.existsSync(dstPkg)) {
      notInstalled.push(name)
      continue
    }
    let r
    try {
      r = syncPackage({ pkgDir, dstPkg, dryRun: opts.dryRun, prune: opts.prune })
    } catch (err) {
      console.error('✗ ' + name + '：' + (err && err.message ? err.message : String(err)))
      failed++
      continue
    }
    report(name, r, opts)
    drift += r.added.length + r.updated.length + r.relinked.length + r.pruned.length
  }

  console.log('')
  if (notInstalled.length) console.log('· 未安装到该 profile（先跑 dsh plugin --profile ' + opts.profile + ' add <pkg>）：' + notInstalled.join(', '))
  if (outsideRepo.length) console.log('· 不在本工作区内，已跳过：' + outsideRepo.join(', '))

  if (failed) console.log('结果：有 ' + failed + ' 个包处理失败。')
  else if (drift === 0) console.log('结果：无差异。')
  else if (opts.dryRun) console.log('结果：发现 ' + drift + ' 处差异（--dry-run 未写盘）。去掉 --dry-run 即可补齐。')
  else console.log('结果：已同步 ' + drift + ' 处。重启 dsh 生效。')

  if (failed) return 1
  if (opts.dryRun && drift > 0) return 1
  return 0
}

process.exitCode = main()
