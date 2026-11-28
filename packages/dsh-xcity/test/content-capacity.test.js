/**
 * R531：休息类座位供给 ≥ 20，且每个站点的 slots 与 capacity 逐条相等。
 *
 * 为什么这条值得单独立测试：capacity > slots.length **不会报错**，
 * 而 stationSlot（src/domain/geometry.ts:39-43）会把越界索引**夹到最后一个槽**——
 * 多出来的人会叠在同一点，只有跑起来才看得见（docs/SEATING-CAPACITY.md 第 4 节）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'

/** scene.office 的站点（只看内容层供给，不经世界实例化）。 */
function officeStations() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const scene = content.get('scenes', 'scene.office').data
  return scene.stations.map((id) => content.get('stations', id).data)
}

test('R531：scene.office 的休息位总量 ≥ 20', () => {
  const rest = officeStations().filter((s) => s.capabilities.includes('rest'))
  const seats = rest.reduce((n, s) => n + s.capacity, 0)
  assert.ok(seats >= 20, `休息位只有 ${seats} 个（实测需求峰值 16.7），至少要 20`)
})

test('R531：每个站点的 slots 条数等于 capacity（否则多出来的人被夹到同一点）', () => {
  for (const station of officeStations()) {
    assert.equal(
      station.slots.length,
      station.capacity,
      `${station.id} capacity=${station.capacity}，但只有 ${station.slots.length} 个槽位`,
    )
  }
})

test('R531：站点槽位（绝对坐标）两两不重合——工位与休息位也不例外', () => {
  const owners = new Map()
  for (const station of officeStations()) {
    for (const slot of station.slots) {
      const key = `${station.anchor.x + slot.x},${station.anchor.z + slot.z}`
      assert.equal(
        owners.has(key),
        false,
        `槽位 ${key} 同时属于 ${owners.get(key)} 与 ${station.id}（两人会叠在同一点）`,
      )
      owners.set(key, station.id)
    }
  }
})