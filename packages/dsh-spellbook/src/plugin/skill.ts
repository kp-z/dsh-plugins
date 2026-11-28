/**
 * spellbook skill —— 把「这本书怎么用」放进会话的技能目录。
 *
 * 这里**没有检索**。取词永远是 tool.ts 的 spellbook_lookup：它是唯一的打分来源，
 * 而这一条只负责「取到之后怎么判、怎么用、什么时候该说没有」。理由与 tool.ts
 * 里那条相同 —— 任何第二套检索都会让侧边栏、工具、skill 三处给出不同的答案，
 * 而这种不一致几乎没人会发现。
 *
 * ── 为什么走 provider，而不是 skills.register() ──
 *
 * 1) 正文从 SKILL.md 现读：改一句提示词不用重启宿主（genui 同款做法）。
 * 2) 目录里那一行 description 也来自同一份 frontmatter —— 写进代码就成了第二份，
 *    而「目录上写的是 A、模型读到的是 B」是最难发现的一类不一致。
 * 3) 随包的 skill 有 rank，不会随便被用户目录里同名的东西顶掉（见 dsh-skill 的 rank 表）。
 *
 * 文件读不到时**不抛**到插件层：list() 抛，注册表会记一条 warn 并保住上一份可用目录，
 * 侧边栏与工具照常；把异常抛在 apply 里则会连带把整站路由打掉。
 */
import type { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'

/** skill 的名字。与 SKILL.md frontmatter 的 name 必须一致（test 里钉住）。 */
const SKILL_NAME = 'spellbook'

/** 提供方名。注册表会把候选上的 provider 与本名字对齐校验。 */
const PROVIDER = 'dsh-spellbook'

/** 与 genui 同一档：随包 skill 的优先级。 */
const BUNDLED_SKILL_RANK = 600

const INVOCATION = { modelInvocable: true, userInvocable: true }

/** 资源提示只交代一件事：正文从哪来。别把库里的路径写成第二份目录。 */
const RESOURCE_BASE = {
  kind: 'opaque',
  description: '整本库在侧边栏「咒语书」里；取正文用 spellbook_lookup。',
} as const

interface SkillFile {
  description: string
  whenToUse?: string
  content: string
}

/** 只声明用到的那一个方法，不 import 整个 skill 包的类型。 */
interface SkillsRegistrar {
  registerProvider(create: () => unknown): () => void
}

/**
 * 读 SKILL.md 并拆成 frontmatter + 正文。
 *
 * 流程 1：frontmatter 必须是文件开头的一段 `---` 包围的键值；description 缺失就报错 ——
 * 目录里那一行是模型决定「要不要加载」的唯一依据，空着等于这条 skill 不存在。
 * 流程 2：正文是闭合的 `---` 之后的全部内容，原样给模型，不做任何裁剪。
 */
async function readSkill(file: string): Promise<SkillFile> {
  const raw = await readFile(file, 'utf8')
  if (!raw.startsWith('---\n')) throw new Error(`${file} 没有 frontmatter`)

  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) throw new Error(`${file} 的 frontmatter 没有闭合`)

  const front = raw.slice(4, end)
  const field = (key: string): string | undefined => {
    const match = new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'mu').exec(front)
    return match?.[1]
  }

  const description = field('description')
  if (!description) throw new Error(`${file} 的 frontmatter 没有 description`)

  return { description, whenToUse: field('whenToUse'), content: raw.slice(end + 5) }
}

/**
 * 流程 3：目录条目。只给「这条 skill 是什么」，不读正文 —— 会话目录里有几十条，
 * 每条都读一遍正文是白烧的。
 * 流程 4：按名字加载时现读正文。改 SKILL.md 后下一次加载就生效，不用重启宿主。
 */
function createProvider(file: string) {
  return {
    name: PROVIDER,
    async list() {
      const skill = await readSkill(file)
      return [
        {
          name: SKILL_NAME,
          description: skill.description,
          ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
          invocation: INVOCATION,
          source: 'bundled',
          provider: PROVIDER,
          rank: BUNDLED_SKILL_RANK,
          locator: file,
          path: file,
          resourceBase: RESOURCE_BASE,
        },
      ]
    },
    async get() {
      const skill = await readSkill(file)
      return {
        name: SKILL_NAME,
        description: skill.description,
        ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
        invocation: INVOCATION,
        source: 'bundled',
        provider: PROVIDER,
        path: file,
        resourceBase: RESOURCE_BASE,
        content: skill.content,
      }
    },
  }
}

export function registerSpellbookSkill(ctx: Context, file: string): void {
  try {
    // 流程 5：skills 是可选服务。它没挂（或这个 profile 没装）时这条 skill 不出现，
    // 但工具与侧边栏不受影响 —— 所以这里不等它，也不为它挡路。
    ctx.inject(['skills'], (c) => {
      const skillCtx = c as unknown as {
        skills?: SkillsRegistrar
        effect?: (fn: () => void) => void
      }
      const skills = skillCtx.skills
      if (!skills || typeof skills.registerProvider !== 'function') {
        console.warn('[dsh-spellbook] skills 服务没有 registerProvider，spellbook skill 没有注册')
        return
      }

      // 流程 6：注册与回收。返回的那个 disposer 必须挂到 ctx 上，
      // 否则插件卸载后 provider 还留在注册表里，指着一个可能已经不存在的文件。
      // 必须挂在 skillCtx 上调用：effect 是 Context 的原型方法，摘下来存进变量再调就丢了 this。
      const dispose = skills.registerProvider(() => createProvider(file))
      if (skillCtx.effect) skillCtx.effect(() => dispose)
    })
  } catch (error) {
    // 注册失败只会让技能目录里少一条，不会让书消失。但这条必须是响的：
    // 否则「模型从来不用 skill」没有任何线索指向这里。
    console.warn('[dsh-spellbook] spellbook skill 注册失败：', error)
  }
}
