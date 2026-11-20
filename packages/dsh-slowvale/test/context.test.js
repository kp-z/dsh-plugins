
/**
 * 解耦验收：角色与会话互不依赖，注入层可增删。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CHARACTERS, findCharacter } from '../lib/content/characters.js'
import { CONTEXT_VERSION, DEFAULT_PROVIDERS, buildContext } from '../lib/model/context.js'

const lin = findCharacter('role.lin')
assert.ok(lin)

test('换嘴（换场）后，注入的人格部分完全一致——人不变', () => {
  const work = buildContext({ character: lin, channel: 'work', tick: 1 })
  const home = buildContext({ character: lin, channel: 'personal', tick: 9 })
  assert.equal(
    work.sections.find((section) => section.key === 'persona')?.text,
    home.sections.find((section) => section.key === 'persona')?.text,
    '人格只跟人有关，跟用哪张嘴无关',
  )
  assert.notEqual(work.text, home.text, '变的应该只有场合那一节')
})

test('新增一层注入不需要改 buildContext', () => {
  const before = buildContext({ character: lin, channel: 'all', tick: 1 })
  const extended = [
    ...DEFAULT_PROVIDERS,
    { key: 'rumor', provide: () => ({ key: 'rumor', title: '传闻', text: '听说便利店要换老板。', source: 'world.rumor' }) },
  ]
  const after = buildContext({ character: lin, channel: 'all', tick: 1 }, extended)
  assert.equal(after.sections.length, before.sections.length + 1)
  assert.match(after.text, /听说便利店要换老板/)
  assert.equal(after.version, CONTEXT_VERSION)
})

test('每节都带来源', () => {
  const bundle = buildContext({ character: lin, channel: 'work', situation: '在科技公司三楼工位', tick: 3 })
  for (const section of bundle.sections) assert.ok(section.source !== '', section.key + ' 缺少 source')
  assert.equal(bundle.sections.find((section) => section.key === 'situation')?.source, 'world.presence')
})

test('没有处境、没有记忆时这两层不出现', () => {
  const bundle = buildContext({ character: lin, channel: 'all', tick: 1 })
  assert.equal(bundle.sections.some((section) => section.key === 'situation'), false)
  assert.equal(bundle.sections.some((section) => section.key === 'memory'), false)
  assert.equal(bundle.sections.some((section) => section.key === 'persona'), true)
})

test('角色数据完整', () => {
  assert.equal(CHARACTERS.length, 3)
  for (const character of CHARACTERS) {
    assert.ok(character.home.placeId.startsWith('place:'))
    assert.ok(character.persona.traits.length >= 2)
    assert.ok(character.appearance.skin >= 1)
  }
})
