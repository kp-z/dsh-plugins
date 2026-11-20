// notes.js 只用到 node:path 的 isAbsolute / relative / resolve；demo 在浏览器里跑，给一个 POSIX 版最小实现。
export const isAbsolute = (p) => typeof p === 'string' && p.startsWith('/')
export function resolve(p) {
  const out = []
  for (const seg of String(p).split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return '/' + out.join('/')
}
export function relative(from, to) {
  const a = resolve(from).split('/').filter(Boolean)
  const b = resolve(to).split('/').filter(Boolean)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}
export default { isAbsolute, resolve, relative }
