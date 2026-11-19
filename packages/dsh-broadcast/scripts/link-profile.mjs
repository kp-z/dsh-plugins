#!/usr/bin/env node
/**
 * 把 dsh-broadcast 装进某个 dsh profile。
 *
 * 为什么要有这个脚本：官方方式是 `dsh plugin --profile <p> add file:<path>`，
 * 但装成 App 的 DSH 里 `dsh` 可能不在 PATH（它在 app.asar 里），此时那条命令根本跑不了。
 * 这里做的是同一件事的三步（备份 → 改 profile 的 package.json → 在 profile 的
 * node_modules 里放一个指向源码目录的软链），并在最后**真的 import 一次**验证装完能加载。
 *
 *   node packages/dsh-broadcast/scripts/link-profile.mjs desktop          # 装进 desktop（桌面 App 用的那个）
 *   node packages/dsh-broadcast/scripts/link-profile.mjs web --dry-run    # 只看会改什么
 *   node packages/dsh-broadcast/scripts/link-profile.mjs                  # 不给参数时用 $DSH_PROFILE_DIR
 *
 * 注意：**装进哪个 profile 取决于你正在用哪个 App**。桌面版跑的是 `desktop` profile，
 * 命令行 `dsh web` 跑的是 `web`。装错地方重启后看不到按钮。
 *
 * 装完需要重启 DSH 才生效。撤销：把打印出来的 package.json.bak-* 拷回去、删掉软链。
 */
import { copyFileSync, existsSync, lstatSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PACKAGE_NAME = 'dsh-broadcast'
const packageDir = resolve(import.meta.dirname, '..')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const profileArg = args.find((arg) => !arg.startsWith('--'))
const envProfileDir = process.env.DSH_PROFILE_DIR?.trim()
// 参数优先 > 当前进程的 profile > 报错（不猜，猜错就是装了个看不见的插件）
const profileDir = profileArg !== undefined
  ? join(homedir(), '.dsh', 'profiles', profileArg)
  : envProfileDir !== undefined && envProfileDir !== ''
    ? envProfileDir
    : undefined
const manifestPath = join(profileDir, 'package.json')
const linkPath = join(profileDir, 'node_modules', PACKAGE_NAME)

function fail(message) {
  console.error('✗', message)
  process.exit(1)
}

if (profileDir === undefined) fail('请指定 profile（例如 desktop / web），或用 $DSH_PROFILE_DIR 指明')
if (!existsSync(manifestPath)) fail(`找不到 profile 的 package.json：${manifestPath}`)
if (!existsSync(join(packageDir, 'lib', 'index.js'))) fail('先构建：pnpm --filter dsh-broadcast build')

const before = readFileSync(manifestPath, 'utf8')
const pkg = JSON.parse(before)
const depSpec = 'file:' + packageDir
const bundles = pkg.dsh?.profile?.bundles
if (!Array.isArray(bundles)) fail('profile 里没有 dsh.profile.bundles，拒绝猜着改')

const needsDep = pkg.dependencies?.[PACKAGE_NAME] !== depSpec
const needsBundle = !bundles.includes(PACKAGE_NAME)

console.log('profile :', profileDir, profileArg === undefined ? '（来自 $DSH_PROFILE_DIR）' : '')
console.log('包      :', depSpec)
console.log('变更    :', [needsDep ? 'dependencies += ' + PACKAGE_NAME : null, needsBundle ? 'bundles += ' + PACKAGE_NAME : null].filter(Boolean).join('、') || '无（已经装过）')

if (dryRun) {
  console.log('（--dry-run：不写盘）')
  process.exit(0)
}

// 1. 备份
const backupPath = manifestPath + '.bak-broadcast-' + new Date().toISOString().replace(/[:.]/g, '-')
copyFileSync(manifestPath, backupPath)
console.log('备份    :', backupPath)

// 2. 改 profile 清单：依赖 + 层栈条目
if (needsDep) {
  pkg.dependencies = { ...(pkg.dependencies ?? {}), [PACKAGE_NAME]: depSpec }
}
if (needsBundle) bundles.push(PACKAGE_NAME)
if (needsDep || needsBundle) writeFileSync(manifestPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

// 3. node_modules 软链（等价于 hoisted 安装，且源码改动即时生效）
const existing = existsSync(linkPath) ? lstatSync(linkPath) : null
if (existing === null) {
  symlinkSync(packageDir, linkPath, 'dir')
  console.log('软链    :', linkPath + ' -> ' + packageDir)
} else if (existing.isSymbolicLink()) {
  console.log('软链    : 已存在，保持原样')
} else {
  console.log('注意    : node_modules/' + PACKAGE_NAME + ' 存在且不是软链（可能是硬链副本），保持原样')
}

// 4. 真 import 一次：装完必须能加载，否则重启 DSH 会整个起不来
try {
  const { pathToFileURL: toUrl } = await import('node:url')
  const mod = await import(toUrl(join(linkPath, 'lib', 'index.js')).href)
  if (mod.name !== 'broadcast') throw new Error('导出的 name 不是 broadcast')
  console.log('加载验证: OK（name=' + mod.name + '，inject=' + JSON.stringify(mod.inject) + '）')
} catch (error) {
  console.error('✗ 装上了但加载失败，正在还原清单：', String(error))
  copyFileSync(backupPath, manifestPath)
  process.exit(1)
}

console.log('')
console.log('下一步：重启 DSH（profile=' + profile + '），然后验证：')
console.log('  curl -s http://127.0.0.1:52559/' + PACKAGE_NAME + '/state')
console.log('  应返回 {"toggle":true,...}；输入框左侧出现扬声器按钮')
