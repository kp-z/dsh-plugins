/**
 * 把 tsc 不会处理的资产同步进 lib。
 *
 * 两件东西以前是"手工拷过一次、之后靠记得"的：
 * 1. src/vendor/**：原样使用的 vendored 代码（easystar 等）。tsc 只编 .ts，不会带走它们，
 *    少了它寻路 import 直接 ERR_MODULE_NOT_FOUND；
 * 2. src/client/client.js -> lib/client.iife.js：DSH 客户端半体的入口。
 *    这里生成，就不需要再手工维护两份一模一样的文件。
 */
import { cp, mkdir, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = join(root, 'lib')

await mkdir(lib, { recursive: true })
await cp(join(root, 'src', 'vendor'), join(lib, 'vendor'), { recursive: true })
await copyFile(join(root, 'src', 'client', 'client.js'), join(lib, 'client.iife.js'))
console.log('[build] vendor + client.iife.js 已同步到 lib')
