/**
 * 绑定表的落盘版：把 `BindingTable` 存成工作区里的一个 JSON 文件。
 *
 * ## 为什么存文件而不是数据库
 *
 * 绑定关系属于"这个世界"，属于工作区（xcity/bindings.json），人可以直接打开看、
 * 可以直接 diff、可以直接改。用数据库反而把它藏起来了。
 *
 * ## 写盘时机
 *
 * 每次 bind/archive 之后**立即整体重写**（文件很小，单写性能无所谓）。
 * 不做增量：真出问题时，文件内容和内存状态不一致是最难查的一类 bug。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { BindingTable, type SessionBinding } from '../model/binding.js'

interface BindingFile {
  bindings: SessionBinding[]
}

export class FileBindingStore {
  constructor(private readonly path: string) {}

  /** 读盘；文件不存在或损坏时返回空表（不抛——启动时不该因为一个可选文件起不来）。 */
  load(): BindingTable {
    const table = new BindingTable()
    if (!existsSync(this.path)) return table
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<BindingFile>
      for (const row of parsed.bindings ?? []) {
        // 走 bind 会把归档的历史行也重新当成"活"的，所以这里直接按行重建。
        table.restore(row)
      }
    } catch {
      return new BindingTable()
    }
    return table
  }

  /** 整体落盘。 */
  save(table: BindingTable): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const body: BindingFile = { bindings: [...table.history()] }
    writeFileSync(this.path, JSON.stringify(body, null, 2) + '\n', 'utf8')
  }
}
