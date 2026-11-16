import type { Context } from '@deepseek-ai/cordis'
import { verifyMermaid } from './verify.ts'
import type { VerifyResult } from './verify.ts'

/**
 * L3 输出闸：监听每条 assistant/message 落盘事件，把所有 mermaid 代码块
 * 在用户可见前「重写 + 真解析」复评：
 * - 能改好的（Unicode 箭头、裸引号、subgraph 特殊字符），替换成干净版本；
 * - 改不好且真语法错（jison SYNTAX-ERR）的，把坏块从可见消息里摘掉并附注原因，
 *   模型与用户之后看到的都是修正版 —— 用户永远看不到渲染失败卡片。
 *
 * 实现：session surface 的原子 replace 机制
 *   session.append('assistant/message', {...fixed}, { surfaceOp: {op:'replace', startSeq, endSeq} })
 * 原始 append 事件仍留在日志（transcript 完整），可见面被修正版遮蔽——
 * agent-loop 的 canonical transcript 过滤 replacement copy，历史对账不受影响。
 *
 * ⚠️ DSH 0.2.x 的 surface 契约（本文件按此实现，旧版 0.1.x 的写法已失效）：
 * 1. replace 的区间键是 `startSeq` / `endSeq`（0.1.x 叫 `start` / `end`），且只允许这三个键；
 * 2. `assistant/message` **禁止**携带 `sourceEventSeqs`（它自带 provider stream）；
 * 3. `assistant/message` 的 data 必须带 `stream: AssistantStreamRecord[]`，
 *    Session 恢复时会强校验（assertAssistantSettlementShape），缺了会让**整个会话加载失败**。
 *
 * 记取教训：这三条都只在运行时校验，类型层面查不出来（本文件与 session 打交道的参数是 any），
 * 所以由 test/gate.test.ts 锁住 append 的入参形状。
 */

interface GateBlock {
  code: string
}

/** 需要替换时，append 的 data 与第三参数（DSH 0.2.x surface 契约）。 */
export interface GateReplacement {
  data: Record<string, unknown>
  opts: {
    surfaceOp: { op: 'replace'; startSeq: number; endSeq: number }
  }
}

/** 从文本中提取所有 mermaid 代码块。 */
function extractBlocks(text: string): GateBlock[] {
  const blocks: GateBlock[] = []
  const fence = /```(?:mermaid|mermaidd)[^\S\n]*\n([^]*?)\n?```/gi
  for (const match of text.matchAll(fence)) {
    blocks.push({ code: match[1] ?? '' })
  }
  return blocks
}

/** 逐块替换法重写整段文本（按出现顺序应用 changes）。 */
function rewriteText(text: string, changes: (string | null)[]): string {
  let index = 0
  return text.replace(/```(?:mermaid|mermaidd)[^\S\n]*\n[^]*?\n?```/gi, (raw) => {
    const replacement = changes[index]
    index += 1
    if (replacement == null) return raw
    if (replacement === '') {
      return `<!-- mermaid-comm: 该图语法错误且无法自动修复，已从可见消息中移除 -->`
    }
    return replacement
  })
}

/**
 * 构造一次 replace：把修正后的消息写回同一条事件位置。
 *
 * 返回 undefined 表示这条事件不该被替换（例如缺 stream 的旧日志事件）——
 * 宁可让闸门少修一次，也不能写出一条恢复时会炸的日志。
 */
export function buildReplacement(event: any, fixedMessage: any): GateReplacement | undefined {
  const data = event?.data
  // 必须是正整数序号，且区间是当前事件自身。
  if (!Number.isSafeInteger(event?.seq) || event.seq < 0) return undefined
  // 0.2.x：assistant/message 自带 provider stream，data.stream 必填。
  if (!Array.isArray(data?.stream)) return undefined

  return {
    data: {
      turn: data.turn,
      step: data.step,
      message: fixedMessage,
      stream: data.stream,
      ...(data.usage === void 0 ? {} : { usage: data.usage }),
      ...(data.interrupted === void 0 ? {} : { interrupted: data.interrupted }),
      // 循环守卫：本插件自己写入的替换事件不再二次处理（该键在 data 里，恢复时被容忍）。
      gateFixed: true,
    },
    opts: { surfaceOp: { op: 'replace', startSeq: event.seq, endSeq: event.seq } },
  }
}

/** 闸门处理器（导出以便单测直接调用，不必起 cordis）。 */
export function createOutputGateHandler(options: {
  verify?: (code: string, type?: string) => Promise<VerifyResult>
  warn?: (...args: unknown[]) => void
} = {}) {
  const verify = options.verify ?? verifyMermaid
  const warn = options.warn ?? ((...args: unknown[]) => {
    try { console.warn('[mermaid-comm]', ...args) } catch {}
  })

  const isAppend = (value: unknown): boolean => value === 'append'
    || (value !== null && typeof value === 'object' && (value as { op?: unknown }).op === 'append')

  return async function handleSessionEvent(session: any, event: any): Promise<void> {
    if (event?.type !== 'assistant/message') return
    if (!isAppend(event?.surfaceOp)) return
    if (event.data?.gateFixed === true) return
    const message = event.data?.message
    if (message?.role !== 'assistant') return
    const content = Array.isArray(message.content) ? message.content : []
    const textBlocks = content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    if (textBlocks.length === 0) return
    if (!textBlocks.some((b: any) => /```\s*(?:mermaid|mermaidd)/i.test(b.text))) return

    const hasFence = (t: string) => /```(?:mermaid|mermaidd)[^\S\n]*\n[^]*?\n?```/i.test(t)

    // 第一个异步边界前做同步快速判定，避免 async listener 的时序怪癖
    const plan = textBlocks.map((b: any) => ({ block: b, has: hasFence(b.text as string) }))
    const touched = plan.some((p: { has: boolean }) => p.has)
    if (!touched) return

    // 只有真渲染失败的块才需要动；尝试与其同循环内完成重写
    let finalTouched = false
    const perBlock: Map<any, (string | null)[]> = new Map()
    for (const { block } of plan) {
      const raw = block.text
      const extracted = extractBlocks(raw)
      if (extracted.length === 0) { perBlock.set(block, []); continue }
      const changes: (string | null)[] = extracted.map(() => null)

      for (let i = 0; i < extracted.length; i++) {
        const orig = extracted[i]?.code ?? ''
        const v = await verify(orig)
        if (v.ok) {
          if (v.fixes.length > 0) {
            changes[i] = '```mermaid\n' + v.built.replace(/^\s*\n/, '').replace(/\s+$/, '') + '\n```'
            finalTouched = true
          }
          continue
        }
        // 重写过但依旧失败，或原样失败——都摘块并说明
        changes[i] = ''
        finalTouched = true
      }
      perBlock.set(block, changes)
    }

    if (!finalTouched) return

    // 构造修正版消息：保留原 message id 与 source，只改正文
    const fixedMessage: any = JSON.parse(JSON.stringify(message))
    const fixedContent = Array.isArray(fixedMessage.content) ? [...fixedMessage.content] : []
    for (const [blockIndex, block] of textBlocks.entries()) {
      const changes = perBlock.get(block)
      if (!changes || !changes.some((c) => c != null)) continue
      let textIndex = 0
      const idx = fixedContent.findIndex((b: any) => {
        if (b?.type !== 'text') return false
        const matches = textIndex === blockIndex && b.text === block.text
        textIndex += 1
        return matches
      })
      if (idx === -1) continue
      const newText = rewriteText(fixedContent[idx].text, changes)
      const note = changes.some((c) => c === '')
        ? '\n> mermaid-comm：一条图语法错误且无法自动修复，已从可见消息移除（重画时请先过 mermaid_validate）。'
        : ''
      fixedContent[idx] = { ...fixedContent[idx], text: newText + note }
    }
    fixedMessage.content = fixedContent

    const replacement = buildReplacement(event, fixedMessage)
    if (replacement === undefined) {
      warn('gate skipped: assistant/message without a provider stream')
      return
    }

    try {
      session.append('assistant/message', replacement.data, replacement.opts)
    } catch (error) {
      warn('gate replacement failed:', String(error))
    }
  }
}

export function registerOutputGate(ctx: Context) {
  // 注意：沙箱 ctx 只暴露白名单动词与已声明服务。不能读 ctx.logger / ctx.root（会被沙箱拒绝）。
  // 直接 ctx.on 订阅即可：插件 ctx 无 scope 标签，能收到 web 主会话与各子代理分 scope 的所有事件。
  const handle = createOutputGateHandler()

  ctx.on('session/event', (session: unknown, event: unknown) => {
    handle(session, event).catch((error) => {
      try { console.warn('[mermaid-comm]', 'gate validation failed:', String(error)) } catch {}
    })
  })
}
