/**
 * 中英文案一致性：`client.js` 里的 STR 必须中英成对，且代码里 `t("...")` 用到的 key 都存在。
 *
 * 为什么值得一条测试：这是纯文本，写错不会有任何报错——t() 找不到 key 就把 key 本身显示给用户
 * （比如表单标签直接变成 "fSkillDesc"），只有在真的切到那个语言时才看得见。加了新文案忘了补英文，
 * 人眼几乎必漏，机器不会。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** 把源码里的 `var STR = { … }` 字面量求值出来（它只含字符串与对象，没有副作用）。 */
function readSTR() {
  const start = src.indexOf('var STR = {')
  assert.ok(start >= 0, 'client.js 里找不到 STR')
  const end = src.indexOf('\n    };', start)
  assert.ok(end > start, 'STR 字面量的结尾没找到')
  const literal = src.slice(start + 'var STR = '.length, end + '\n    };'.length - 1)
  return new Function(`return (${literal})`)()
}

const STR = readSTR()
const zh = Object.keys(STR.zh)
const en = Object.keys(STR.en)

/** 代码里用到的 key：字面量 + `t("前缀_" + x)` 这种动态拼接。 */
function usedKeys() {
  const literal = new Set()
  for (const m of src.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) {
    if (m[1].endsWith('_')) continue // 动态拼接的前缀，由下一条测试负责
    literal.add(m[1])
  }
  const prefixes = new Set()
  for (const m of src.matchAll(/\bt\("([A-Za-z0-9_]+)_"\s*\+/g)) prefixes.add(m[1])
  return { literal, prefixes }
}

test('i18n: 中英 key 完全一致', () => {
  assert.deepEqual(zh.slice().sort(), en.slice().sort())
})

test('i18n: 代码里用到的字面量 key 都存在（且两侧都有值）', () => {
  const { literal } = usedKeys()
  const missing = [...literal].filter((k) => !STR.zh[k] || !STR.en[k])
  assert.deepEqual(missing, [])
})

test('i18n: 动态拼接的前缀（如 mcpState_）在两侧都有对应 key', () => {
  const { prefixes } = usedKeys()
  assert.ok(prefixes.size > 0, '没找到动态拼接的 key，检查这条测试自己的正则')
  for (const prefix of prefixes) {
    const keys = zh.filter((k) => k.startsWith(prefix + '_'))
    const enKeys = en.filter((k) => k.startsWith(prefix + '_'))
    assert.ok(keys.length > 0, `前缀 ${prefix}_ 没有任何 key`)
    assert.deepEqual(keys.sort(), enKeys.sort())
  }
})

test('i18n: 没有空文案、也没有丢在 zh/en 一侧的占位符', () => {
  for (const key of zh) {
    assert.equal(typeof STR.zh[key], 'string', `${key} 在 zh 里不是字符串`)
    assert.equal(typeof STR.en[key], 'string', `${key} 在 en 里不是字符串`)
    assert.ok(STR.zh[key].trim().length > 0, `${key} 的 zh 是空的`)
    assert.ok(STR.en[key].trim().length > 0, `${key} 的 en 是空的`)
    // {used} / {n} 这类变量两边必须一致，否则切换语言时数字就丢了
    const vars = (s) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort()
    assert.deepEqual(vars(STR.zh[key]), vars(STR.en[key]), `${key} 的中英变量不一致`)
  }
})
test('a11y: prefers-reduced-motion 关掉了所有会动的东西', () => {
  const reduced = src.match(/@media \(prefers-reduced-motion:reduce\)\{([^}]*\}[^}]*)\}/)
  assert.ok(reduced, '找不到 prefers-reduced-motion 的媒体查询')
  const block = reduced[1]
  assert.match(block, /transition:none|transition:\s*none/)
  // 每一个声明了 transition 的类都要在这个块里被关掉；新加动画却忘了这里，这条测试会红
  const animated = new Set()
  for (const m of src.matchAll(/\.(pn-[a-z-]+)[^{}]*\{[^{}]*\btransition\s*:/g)) animated.add(m[1])
  assert.ok(animated.size > 0)
  const missing = [...animated].filter((cls) => !block.includes('.' + cls))
  assert.deepEqual(missing, [], '这些类有 transition，但 prefers-reduced-motion 里没关掉')
})
