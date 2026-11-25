/**
 * 小助手的结构契约（node test/aiMascot.mjs）。
 *
 * 为什么单独测：这只小人是纯数据 → SVG，表情全靠 mood 分支。
 * 分支写错（比如开心态还留着圆眼）在界面上不容易被一眼发现，但会让「结论好坏」
 * 和「表情」对不上——那正是拟人形象存在的意义。
 */
import assert from 'node:assert/strict'
import { aiMascot, AI_MOODS } from '../src/client/AiMascot.js'

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log('  ok  ' + name)
  } catch (error) {
    failures.push(name)
    console.log('  FAIL ' + name)
    console.log(String((error && error.message) || error).split('\n').slice(0, 4).map((line) => '       ' + line).join('\n'))
  }
}

/* 最小 h：够把 vnode 摊平成可断言的结构（type / props / children）。 */
const h = (type, props, ...children) => ({ type, props: props || {}, children })
const walk = (node, hit = []) => {
  if (!node || typeof node !== 'object') return hit
  if (node.type) hit.push(node)
  for (const child of node.children || []) walk(child, hit)
  return hit
}
const classesOf = (node) => walk(node).map((item) => String((item.props && item.props.className) || ''))
const countClass = (node, name) => classesOf(node).filter((cls) => cls.split(' ').includes(name)).length

check('四种心情都能渲染，且根节点带对应 is-* 类', () => {
  for (const mood of AI_MOODS) {
    const svg = aiMascot(h, mood)
    assert.equal(svg.type, 'svg')
    assert.ok(svg.props.className.includes('is-' + mood), mood + ' 应带 is-' + mood)
  }
})

check('未知心情退成 calm，不抛', () => {
  const svg = aiMascot(h, 'excited')
  assert.ok(svg.props.className.includes('is-calm'))
  assert.equal(aiMascot(h, undefined).props.className.includes('is-calm'), true)
})

check('开心是弯眼，其余是圆眼（表情必须和结论对得上）', () => {
  assert.equal(countClass(aiMascot(h, 'happy'), 'fd-bot-eye-arc'), 2, '开心应有两只弯眼')
  assert.equal(countClass(aiMascot(h, 'happy'), 'fd-bot-eye'), 0, '开心不该再有圆眼')
  for (const mood of ['calm', 'thinking', 'alert']) {
    assert.equal(countClass(aiMascot(h, mood), 'fd-bot-eye'), 2, mood + ' 应有两只圆眼')
    assert.equal(countClass(aiMascot(h, mood), 'fd-bot-eye-arc'), 0)
  }
})

check('提醒态有皱眉，其他态没有', () => {
  assert.equal(countClass(aiMascot(h, 'alert'), 'fd-bot-brows'), 1)
  for (const mood of ['calm', 'thinking', 'happy']) {
    assert.equal(countClass(aiMascot(h, mood), 'fd-bot-brows'), 0)
  }
})

check('每张脸都有嘴、天线、屏幕高光与思考圈（结构不为某个状态少画一笔）', () => {
  for (const mood of AI_MOODS) {
    const svg = aiMascot(h, mood)
    for (const name of ['fd-bot-mouth', 'fd-bot-antenna', 'fd-bot-bulb', 'fd-bot-glint', 'fd-bot-ring', 'fd-bot-cheek']) {
      assert.ok(countClass(svg, name) >= 1, mood + ' 缺 ' + name)
    }
  }
})

check('可访问名说人话，且标明是 AI 小助手', () => {
  for (const mood of AI_MOODS) {
    const label = String(aiMascot(h, mood).props['aria-label'])
    assert.ok(label.includes('AI 小助手'), mood + ' 的 aria-label 应说明身份：' + label)
    assert.ok(label.length > 6)
  }
})

console.log('\naiMascot.js: ' + passed + ' passed, ' + failures.length + ' failed')
if (failures.length) process.exit(1)
console.log('AI_MASCOT_OK')
