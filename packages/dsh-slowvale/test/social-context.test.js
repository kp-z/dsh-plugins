
/**
 * H3 验收：加两层注入不需要改 buildContext；关系与心情按世界状态出文本。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_PROVIDERS, buildContext } from '../lib/model/context.js'
import { moodProvider, relationshipProvider, socialProviders } from '../lib/model/social-context.js'
import { closenessWord, describeMood, describeRelationships } from '../lib/model/relations.js'
import { findCharacter, CHARACTERS } from '../lib/content/characters.js'

const lin = findCharacter('role.lin')
assert.ok(lin)

const NOW = 60 * 60 * 3

test('关系层：写清谁、什么关系、多熟、多久没见', () => {
  const text = describeRelationships(
    [
      { fromId: 'role.lin', toId: 'role.mei', kind: 'colleague', closeness: 0.8, lastSeenTick: NOW - 60 },
      { fromId: 'role.lin', toId: 'role.zhou', kind: 'stranger', closeness: 0.1, lastSeenTick: NOW - 60 * 60 * 5 },
    ],
    NOW,
  )
  assert.ok(text)
  assert.match(text, /role\.mei（同事，很熟，今天见过）/)
  assert.match(text, /role\.zhou（陌生人，不熟，5 个多小时前见过）/)
})

test('没有任何关系时这一层不出现（而不是给一句空话）', () => {
  const provider = relationshipProvider({ relationships: [], mood: null, nowTick: NOW })
  assert.equal(provider.provide({ character: lin, channel: 'all', tick: NOW }), null)
})

test('心情：阈值少，输出稳定', () => {
  assert.equal(describeMood({ energy: 0.2, stress: 0.1, sinceTick: NOW }), '很累，说话短')
  assert.equal(describeMood({ energy: 0.9, stress: 0.8, sinceTick: NOW }), '心里烦，没耐心')
  assert.equal(describeMood({ energy: 0.9, stress: 0.1, sinceTick: NOW }), '状态不错')
  assert.equal(describeMood({ energy: 0.5, stress: 0.5, sinceTick: NOW }), '普普通通')
})

test('熟络度只用三档词，不用数字', () => {
  assert.equal(closenessWord(0.1), '不熟')
  assert.equal(closenessWord(0.4), '还行')
  assert.equal(closenessWord(0.9), '很熟')
})

test('加两层注入不改 buildContext：节数与顺序都对', () => {
  const social = socialProviders({
    relationships: [{ fromId: 'role.lin', toId: 'role.mei', kind: 'friend', closeness: 0.6, lastSeenTick: NOW }],
    mood: { energy: 0.9, stress: 0.1, sinceTick: NOW },
    nowTick: NOW,
  })
  const bundle = buildContext(
    { character: lin, channel: 'work', situation: '在工位', tick: NOW },
    [...DEFAULT_PROVIDERS, ...social],
  )
  // 记忆层没数据，所以不出现；其余五节按"人→场合→处境→关系→心情"排
  assert.deepEqual(
    bundle.sections.map((section) => section.key),
    ['persona', 'channel', 'situation', 'relationship', 'mood'],
  )
  assert.match(bundle.text, /role\.mei（朋友/)
})

test('三个人在同一世界里拿到的关系层各不相同', () => {
  const relationships = [
    { fromId: 'role.lin', toId: 'role.mei', kind: 'colleague', closeness: 0.9, lastSeenTick: NOW },
    { fromId: 'role.mei', toId: 'role.lin', kind: 'colleague', closeness: 0.9, lastSeenTick: NOW },
    { fromId: 'role.zhou', toId: 'role.lin', kind: 'neighbour', closeness: 0.3, lastSeenTick: NOW },
  ]
  const texts = CHARACTERS.map((character) => {
    const provider = relationshipProvider({ relationships, mood: null, nowTick: NOW })
    return provider.provide({ character, channel: 'all', tick: NOW })?.text ?? ''
  })
  assert.match(texts[0] ?? '', /role\.mei/)
  assert.match(texts[1] ?? '', /role\.lin/)
  assert.match(texts[2] ?? '', /role\.lin/)
  assert.notEqual(texts[0], texts[2])
})

test('没有心情时心情层不出现', () => {
  const provider = moodProvider({ relationships: [], mood: null, nowTick: NOW })
  assert.equal(provider.provide({ character: lin, channel: 'all', tick: NOW }), null)
})
