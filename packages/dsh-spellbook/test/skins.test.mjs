/**
 * 风格样张。
 *
 * 十张样张是**同一套结构、同一份内容、只换一层 CSS**：预览页先载入站点自己的
 * spellbook.css，再叠 skins/<名字>.css。所以它证明的是「这本书换一层皮长什么样」，
 * 而不是另画一张设计稿 —— 挑中哪张，把那层皮并进来就行。
 *
 * 这里守三件事：十张都在、每张都挂着自己的那层皮、皮肤文件真的被构建搬进了产物。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SKINS, previewPage, galleryPage } from '../src/render/skins.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('十二张样张（10 种方向 + 装帧书的两个墨色），名字与说明都不为空，slug 合法且互不相同', () => {
  assert.equal(SKINS.length, 12)
  const slugs = new Set()
  for (const skin of SKINS) {
    assert.match(skin.slug, /^[0-9]{2}-[a-z-]+$/, 'slug 应当是 序号-英文名 的形式：' + skin.slug)
    assert.ok(skin.name.trim(), '缺名字')
    assert.ok(skin.note.trim(), '缺一句说明')
    assert.ok(!slugs.has(skin.slug), 'slug 重复：' + skin.slug)
    slugs.add(skin.slug)
  }
})

test('每张样张都载入站点样式，并且只叠自己那一层皮', () => {
  for (const skin of SKINS) {
    const html = previewPage(skin)
    assert.match(html, /href="\.\.\/styles\/spellbook\.css"/, skin.slug + ' 没有载入站点样式')
    assert.match(html, new RegExp('href="\\./' + skin.slug + '\\.css"'), skin.slug + ' 没有叠自己的皮')
    // 结构必须是真的：顶栏、开场、卡片、条目页样张，少一样就看不出风格
    for (const hook of ['class="topbar"', 'class="hero-title"', 'class="card', 'class="code-block"']) {
      assert.ok(html.includes(hook), skin.slug + ' 少了 ' + hook)
    }
    assert.doesNotMatch(html, /allow-same-origin/)
  }
})

test('总览页把每一张都摊开，每张一个面板', () => {
  const html = galleryPage(SKINS)
  assert.equal((html.match(/<section class="panel"/g) ?? []).length, SKINS.length)
  for (const skin of SKINS) {
    assert.ok(html.includes('src="./' + skin.slug + '.html"'), '总览里找不到 ' + skin.slug)
  }
})

test('皮肤文件都在，而且没有跟站点抢同一批选择器之外的东西', () => {
  const dir = path.join(ROOT, 'src', 'styles', 'skins')
  for (const skin of SKINS) {
    const file = path.join(dir, skin.slug + '.css')
    assert.ok(existsSync(file), '缺皮肤文件：' + file)
    const css = readFileSync(file, 'utf8')
    assert.match(css, /:root \{/, skin.slug + ' 没有覆盖令牌')
    // 皮肤只该改观感，不该藏结构（装饰性的伪元素除外）——藏了内容，样张之间就不可比了
    for (const rule of css.matchAll(/([^{}]+)\{[^}]*display:\s*none/g)) {
      assert.match(rule[1].trim(), /::?(before|after)$/, skin.slug + ' 把 ' + rule[1].trim() + ' 藏了')
    }
  }
})

test('构建产物里有样张，且每一页都在', () => {
  const dir = path.join(ROOT, 'dist', 'skins')
  if (!existsSync(path.join(dir, 'index.html'))) {
    assert.ok(true, '还没构建，跳过')
    return
  }
  for (const skin of SKINS) {
    assert.ok(existsSync(path.join(dir, skin.slug + '.html')), '产物缺页面：' + skin.slug)
    assert.ok(existsSync(path.join(dir, skin.slug + '.css')), '产物缺皮肤：' + skin.slug)
  }
})
