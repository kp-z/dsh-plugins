/**
 * 把 Markdown 回复洗成「能念的中文」。纯函数，无 IO、无时钟，单测可穷举。
 *
 * 为什么必须洗：真机实测，一段含代码块/路径/链接的收尾报告念出来 19.6 秒，
 * 而改写成两句话只要 9.5 秒——路径会被念成「s r c 斜杠 auth 斜杠 retry 点 t s」。
 * 这一步在 S2 就够用（不需要模型），S3 的 llm 改写是在它**之前**的原料。
 */

/** 段落之间保留空行（后面取「首段」要用），行内空白压成一个空格。 */
function tidyLines(text: string): string {
  const lines = text.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim())
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 洗掉所有念不出来或念出来很吵的东西：
 * 围栏代码块 / 行内代码 / 图片 / 链接地址 / HTML / URL / 表格 / 标题与列表标记 /
 * 文件路径 / 强调符号 / 表情。
 */
export function sanitizeForSpeech(markdown: string): string {
  let text = markdown.replace(/\r\n?/g, '\n')

  // 代码块整块丢（含 dsh-ui / mermaid 这类自定义围栏），未闭合的也丢到结尾
  text = text.replace(/```[\s\S]*?```/g, ' ')
  text = text.replace(/~~~[\s\S]*?~~~/g, ' ')
  text = text.replace(/```[\s\S]*$/g, ' ')

  // 行内代码
  text = text.replace(/`[^`\n]*`/g, ' ')

  // 图片整条丢；链接只留文字
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  // HTML 标签（含自动链接的 <> 形式）
  text = text.replace(/<[^>]+>/g, ' ')

  // URL
  text = text.replace(/https?:\/\/\S+/gi, ' ')
  text = text.replace(/\bwww\.\S+/gi, ' ')

  // 表格：整行丢（含 | 分隔符的行不念）
  text = text.replace(/^.*\|.*$/gm, ' ')

  // 标题 / 引用 / 列表标记
  text = text.replace(/^#{1,6}\s*/gm, '')
  text = text.replace(/^\s*>\s?/gm, '')
  text = text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')

  // 单位后缀：344px 念成「三百四十四 p x」，去掉单位只留数字
  text = text.replace(/(\d)\s*(?:px|ms|kb|mb|gb|s)\b/gi, '$1')

  // 文件名：charts.html / retry.ts 这类念出来是一串字母，直接丢
  text = text.replace(/\b[\w-]+\.(?:html?|md|ts|tsx|js|mjs|cjs|jsx|json|css|ya?ml|py|sh|toml)\b/gi, ' ')

  // 路径：绝对路径整段丢；相对路径要求「含字母且有多段」，免得把 1/4 这种分数也吃掉
  text = text.replace(/(?:^|[\s(（])(?:~|\.{1,2})?\/[\w./-]+/g, ' ')
  text = text.replace(/[\w.-]+(?:\/[\w.-]+)+/g, (token) => (/[A-Za-z]/.test(token) ? ' ' : token))

  // 强调与残留 Markdown 符号（反引号、星号、井号、管道等一律不留）
  text = text.replace(/[*_~`#>|[\]{}]/g, '')

  // 表情与零宽连接符
  text = text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')

  // 剩下零散的斜杠与反斜杠（"要不要/不要" 这种也一并断开）
  text = text.replace(/[\\/]/g, ' ')

  // 被剥掉的行内内容会留下「访问 。」这种空档，标点前的空白收掉
  text = text.replace(/[ \t]+([。，！？；：、）])/g, '$1')

  return tidyLines(text)
}

/** 第一段（用空行分段）；找不到就返回空串。 */
export function firstParagraph(text: string): string {
  for (const block of text.split(/\n\s*\n/)) {
    const flat = block.replace(/\s+/g, ' ').trim()
    if (flat !== '') return flat
  }
  return ''
}

/** 截到上限，尽量停在句号上（不然会念半句话）。 */
export function clipToSentence(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!Number.isFinite(maxChars) || maxChars <= 0 || flat.length <= maxChars) return flat
  const window = flat.slice(0, maxChars)
  const ends = ['。', '！', '？', '；', '.', '!', '?', ';'].map((mark) => window.lastIndexOf(mark))
  const lastEnd = Math.max(...ends)
  if (lastEnd >= Math.floor(maxChars * 0.4)) return window.slice(0, lastEnd + 1).trim()
  return window.trim()
}

/**
 * S2 的降级文案：不调模型时，取「首段」再截到上限。
 * 这一级保证插件单独就能用——S3 的模型改写失败了也落到这里。
 */
export function summarizeLocally(markdown: string, maxChars: number): string {
  const cleaned = sanitizeForSpeech(markdown)
  const paragraph = firstParagraph(cleaned)
  return clipToSentence(paragraph !== '' ? paragraph : cleaned, maxChars)
}
