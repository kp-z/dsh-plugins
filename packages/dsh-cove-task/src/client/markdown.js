/**
 * 极简 Markdown → React 树（摘要预览用）。
 *
 * 只支持写纪要真会用到的语法：标题、粗/斜、行内 code、代码块、列表、引用、分割线、链接。
 * 安全：不拼 HTML 字符串，全部走 h() 生成节点；链接只放行 http(s)/mailto。
 */

/* 斜体要求两侧都不是空白：避免把 "a * b * c" 里的乘号吃成斜体 */
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*(?![\s*])[^*\n]*?[^\s*]\*|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)\s]+\))/g

function inline(h, text) {
  const out = []
  const source = String(text == null ? '' : text)
  const parts = source.split(INLINE)
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith('`') && part.endsWith('`')) {
      out.push(h('code', { className: 'fd-md-code-inline', key: 'c' + out.length }, part.slice(1, -1)))
    } else if (part.startsWith('**') && part.endsWith('**')) {
      out.push(h('strong', { key: 'b' + out.length }, part.slice(2, -2)))
    } else if (part.startsWith('*') && part.endsWith('*')) {
      out.push(h('em', { key: 'i' + out.length }, part.slice(1, -1)))
    } else if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
      const cut = part.indexOf('](')
      const label = part.slice(1, cut)
      const href = part.slice(cut + 2, -1)
      out.push(h('a', {
        key: 'a' + out.length, href, target: '_blank', rel: 'noreferrer noopener',
        className: 'fd-md-link',
      }, label))
    } else {
      out.push(part)
    }
  }
  return out
}

const isBlockStart = (line) => /^(#{1,4}\s|\`\`\`|>\s?|\s*[-*]\s+|\s*\d+\.\s+|---+\s*$)/.test(line)

export function renderMarkdown(h, text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i += 1; continue }

    if (/^\`\`\`/.test(line)) {
      const code = []
      i += 1
      while (i < lines.length && !/^\`\`\`/.test(lines[i])) { code.push(lines[i]); i += 1 }
      i += 1
      blocks.push(h('pre', { key: 'pre' + blocks.length, className: 'fd-md-pre' }, h('code', null, code.join('\n'))))
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      const level = Math.min(6, heading[1].length + 2)
      blocks.push(h('h' + level, { key: 'h' + blocks.length, className: 'fd-md-h' }, ...inline(h, heading[2])))
      i += 1
      continue
    }

    if (/^---+\s*$/.test(line.trim())) {
      blocks.push(h('hr', { key: 'hr' + blocks.length, className: 'fd-md-hr' }))
      i += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i += 1 }
      blocks.push(h('blockquote', { key: 'q' + blocks.length, className: 'fd-md-quote' }, ...inline(h, quote.join(' '))))
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(h('li', { key: 'li' + items.length }, ...inline(h, lines[i].replace(/^\s*[-*]\s+/, ''))))
        i += 1
      }
      blocks.push(h('ul', { key: 'ul' + blocks.length, className: 'fd-md-list' }, items))
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(h('li', { key: 'li' + items.length }, ...inline(h, lines[i].replace(/^\s*\d+\.\s+/, ''))))
        i += 1
      }
      blocks.push(h('ol', { key: 'ol' + blocks.length, className: 'fd-md-list' }, items))
      continue
    }

    const para = []
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { para.push(lines[i]); i += 1 }
    if (!para.length) { i += 1; continue }
    const children = []
    para.forEach((row, index) => {
      if (index) children.push(h('br', { key: 'br' + index }))
      children.push(...inline(h, row))
    })
    blocks.push(h('p', { key: 'p' + blocks.length, className: 'fd-md-p' }, children))
  }
  return blocks
}
