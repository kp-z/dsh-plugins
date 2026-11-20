/**
 * 静态站（Slow Vale 构建产物）的本地服务。
 *
 * 两条规矩，都是为了复现线上的真实行为：
 * - **SPA fallback**：非 /assets/ 的未知路径回 index.html。Slow Vale 是 history 路由，
 *   刷新 /world/w1 必须还能打开；而 /assets/ 下缺文件要老实 404，否则前端会拿到一段 HTML
 *   当 JS 解析，报错信息离真相极远。
 * - **不许越界**：解析后的路径必须仍在 root 之下。
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.md': 'text/markdown; charset=utf-8',
}

/** 把一个 URL 路径落到磁盘上的文件；找不到返回 null。 */
export function resolveFile(root: string, pathname: string): string | null {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([.][.][/\\])+/, '')
  const target = resolve(join(root, safe))
  if (target !== root && !target.startsWith(root + sep)) return null
  if (existsSync(target) && statSync(target).isDirectory()) {
    const index = join(target, 'index.html')
    return existsSync(index) ? index : null
  }
  if (existsSync(target) && statSync(target).isFile()) return target
  return null
}

/** 服务一个静态请求。返回 false 表示没找到（调用方决定要不要兜底）。 */
export function serveStatic(root: string, req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  let file = resolveFile(root, pathname)
  if (file === null) {
    if (pathname.startsWith('/assets/')) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end('{"detail":"Not Found"}')
      return true
    }
    file = resolveFile(root, '/index.html')
    if (file === null) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Slow Vale 静态资源没有找到：检查 slowvaleAssetsDir 配置')
      return true
    }
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  })
  if ((req.method ?? 'GET').toUpperCase() === 'HEAD') {
    res.end()
    return true
  }
  createReadStream(file).pipe(res)
  return true
}
