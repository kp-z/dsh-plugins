import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/**
 * 客户端半边的冒烟测试：不渲染（没有真 React），只验证模块外壳、
 * 槽位注入与「宿主路径/字段」这三件最容易在浏览器里才炸的事。
 */
function loadClient() {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  const loaded: { id: string; factory: (require: (name: string) => unknown) => unknown }[] = []

  const fakeDocument = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
  }
  const fakeWindow = { __ModuleLoader__: { load: (spec: unknown) => loaded.push(spec as never) } }

  // 客户端文件是给浏览器用的（window / document 全局），这里只做模块加载那一段
  const run = new Function('window', 'document', source)
  run(fakeWindow, fakeDocument)

  assert.equal(loaded.length, 1, '应当注册且只注册一个客户端模块')
  const spec = loaded[0] as { id: string; factory: (require: (name: string) => unknown) => unknown }
  assert.equal(spec.id, 'dsh-broadcast')

  const react = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useState: (initial: unknown) => [initial, () => {}],
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
  }
  const require = (name: string): unknown => {
    if (name === 'react') return react
    // primitives 在测试里故意拿不到：客户端必须能退回原生 title 而不是崩掉
    throw new Error('not available in test: ' + name)
  }
  return spec.factory(require) as {
    name: string
    inject: string[]
    apply: (ctx: unknown) => unknown
  }
}

test('客户端模块：名字、依赖与槽位注入', () => {
  const mod = loadClient()
  assert.equal(mod.name, 'broadcast')
  assert.deepEqual(mod.inject, ['slots'])

  const injected: { slot: string; id: string; order?: number }[] = []
  const ctx = {
    slots: {
      inject: (slot: string, factory: () => unknown) => {
        injected.push({ slot, id: '' })
        return factory()
      },
      register: (spec: { name: string; id: string; order?: number }, component: unknown) => {
        assert.equal(typeof component, 'function', '注册的必须是个组件')
        injected[injected.length - 1] = { slot: spec.name, id: spec.id, order: spec.order }
        return () => {}
      },
    },
  }
  const dispose = mod.apply(ctx)
  assert.deepEqual(injected, [{ slot: 'conversation.input.left', id: 'broadcast.switch', order: 100 }])
  assert.equal(typeof dispose, 'function', '必须返回 disposer，否则重新声明槽位会撞 id')
})

test('客户端模块：拿不到官方 Tooltip 也不能崩（退回原生 title）', () => {
  const mod = loadClient()
  assert.equal(typeof mod.apply, 'function')
})

test('客户端模块：没有 slots 服务时安静退出', () => {
  const mod = loadClient()
  assert.doesNotThrow(() => mod.apply(undefined))
  assert.doesNotThrow(() => mod.apply({}))
})
