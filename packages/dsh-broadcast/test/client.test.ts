import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/**
 * 客户端半边的冒烟测试：不渲染真实 DOM，只验证模块外壳、槽位注入，以及
 * 「菜单必须 portal 到 body」这条最容易在真机才炸的约定。
 */
function loadClient(options: { withReactDom?: boolean } = {}) {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  const loaded: { id: string; factory: (require: (name: string) => unknown) => unknown }[] = []

  const fakeDocument = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
    body: {},
  }
  const fakeWindow = { __ModuleLoader__: { load: (spec: unknown) => loaded.push(spec as never) } }

  const run = new Function('window', 'document', source)
  run(fakeWindow, fakeDocument)

  assert.equal(loaded.length, 1, '应当注册且只注册一个客户端模块')
  const spec = loaded[0] as { id: string; factory: (require: (name: string) => unknown) => unknown }
  assert.equal(spec.id, 'dsh-broadcast')

  const react = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useState: (initial: unknown) => [initial, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useCallback: (fn: unknown) => fn,
    useRef: () => ({ current: null }),
  }
  const reactDom = options.withReactDom === false
    ? undefined
    : { createPortal: (node: unknown, target: unknown) => ({ type: 'portal', node, target }) }

  const require = (name: string): unknown => {
    if (name === 'react') return react
    if (name === 'react-dom') {
      if (reactDom === undefined) throw new Error('react-dom unavailable')
      return reactDom
    }
    throw new Error('not available in test: ' + name)
  }
  return spec.factory(require) as { name: string; inject: string[]; apply: (ctx: unknown) => unknown }
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

test('拿不到官方 Tooltip / react-dom 也不能崩（各自有退路）', () => {
  const mod = loadClient({ withReactDom: false })
  assert.equal(typeof mod.apply, 'function')
})

test('菜单走 portal：源码里必须 portal 到 body，否则会被玻璃卡片的 backdrop-filter 带偏', () => {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.match(source, /createPortal\(panel, document\.body\)/)
  assert.match(source, /containingBlockOf/, '没有 portal 时的兜底要做包含块修正')
  assert.match(source, /backdrop-filter/)
  assert.match(source, /position:fixed/)
})

test('没有 slots 服务时安静退出', () => {
  const mod = loadClient()
  assert.doesNotThrow(() => mod.apply(undefined))
  assert.doesNotThrow(() => mod.apply({}))
})
