import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDirective } from '../lib/adapters/slowvale/directive.js'
import { DEFAULT_CIRCUIT } from '../lib/adapters/slowvale/stage.js'

const places = DEFAULT_CIRCUIT.map((p) => ({ id: p.id, label: p.label, asset: p.asset }))

test('去办公室工作 → work + 对应地点', () => {
  const d = parseDirective('你去办公室工作吧', places)
  assert.equal(d?.kind, 'work')
  assert.equal(d?.placeId, 'place:office.tech_company_1')
})

test('回家 → rest（公寓）', () => {
  const d = parseDirective('回家休息', places)
  assert.equal(d?.kind, 'rest')
  assert.equal(d?.placeId, 'place:residential.apartment_1')
})

test('去健身房 → visit（没说工作）', () => {
  const d = parseDirective('去健身房待一会儿', places)
  assert.equal(d?.kind, 'visit')
  assert.equal(d?.placeId, 'place:downtown.city_gym')
})

test('认不出来就返回 null，不瞎猜', () => {
  assert.equal(parseDirective('今天天气不错', places), null)
  assert.equal(parseDirective('   ', places), null)
})
