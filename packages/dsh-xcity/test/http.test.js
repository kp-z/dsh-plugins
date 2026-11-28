/**
 * HTTP 传输层测试（BACKLOG M3-3 / M3-5）。
 *
 * 用**真 HTTP 服务器**（端口 0 = 系统分配）而不是假的 req/res：
 * 这一层的活儿就是"把 Node 的请求对象变成响应"，用假的就等于把要测的东西替换掉了。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { resolveConfig } from '../lib/config.js'
import { createPluginState } from '../lib/state.js'
import { createEventHub, createRuntime } from '../lib/runtime/index.js'
import { createHandler } from '../lib/routes/index.js'
import { HttpError, createHttpHandler, matchPath, readJsonBody } from '../lib/routes/router.js'
import { buildSnapshot, applyCommand } from '../lib/routes/api.js'

const PREFIX = '/agent-world'

/** 测试建的临时目录，跑完清掉。 */
const tempDirs = []
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

/** 起一个真服务器，跑完关掉。 */
async function withServer(handler, fn) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`
  try {
    return await fn(base)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

/** 一套可用的依赖（真世界 + 真运行时 + 真路由）。 */
function makeDeps() {
  // http 测试固定 default-town：`task.quick-fix` 的目标站点（desk-a/b/c）都在这个场景里。
  const service = createPluginState(resolveConfig({ autoStart: false, scene: 'scene.default-town' }))
  service.ensureWorld()
  service.dispatch('task.quick-fix')
  const runtime = createRuntime({ service, tickMs: 100 })
  const hub = createEventHub()
  const handler = createHandler(PREFIX, { service, runtime, source: hub, tickMs: 100 })
  return { service, runtime, hub, handler }
}

// ── 路径匹配 ────────────────────────────────────────────────────────────────

test('matchPath：精确段、命名段、以及不匹配', () => {
  assert.deepEqual(matchPath('/api/world', '/api/world'), {})
  assert.deepEqual(matchPath('/api/:id', '/api/abc'), { id: 'abc' })
  assert.deepEqual(matchPath('/:file', '/app.js'), { file: 'app.js' })
  assert.equal(matchPath('/api/world', '/api/other'), null, '段内容不同就不该匹配')
  assert.equal(matchPath('/api/world', '/api/world/extra'), null, '段数不同就不该匹配')
  assert.equal(matchPath('/:file', '/'), null, '空段不该被命名段吃掉')
  assert.deepEqual(matchPath('/api/:id', '/api/%E4%B8%AD%E6%96%87'), { id: '中文' }, '命名段要解码')
})

test('matchPath：末尾的 `*` 匹配剩余全部段（R15 补的，否则静态资源放不进子目录）', () => {
  assert.deepEqual(matchPath('/*', '/app.js'), { rest: 'app.js' })
  assert.deepEqual(matchPath('/*', '/vendor/three/x.js'), { rest: 'vendor/three/x.js' })
  assert.deepEqual(matchPath('/*', '/a/b/c/d.txt'), { rest: 'a/b/c/d.txt' }, '层数不写死')
  assert.deepEqual(matchPath('/assets/*', '/assets/img/a.png'), { rest: 'img/a.png' })
  assert.equal(matchPath('/assets/*', '/other/a.png'), null, '`*` 前面的固定段仍要匹配')

  // **关键**：逐段解码，不整段解码——整段解码会把 `%2F` 变成真的斜杠，
  // 于是一个编码过的分隔符就能伪造出目录层级（路径穿越的经典手法）。
  const params = matchPath('/*', '/a%2F..%2Fb.txt')
  assert.equal(params.rest, 'a/../b.txt', '解出来要保留一个"看起来像上跳"的段，交给下游按段处理')
  assert.ok(!params.rest.includes('\u0000'))
})

// ── 静态路径安全 ────────────────────────────────────────────────────────────

test('前缀要按整段匹配：/agent-world-x 不该被本插件吞掉', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/agent-world-x/api/world`)
    assert.equal(res.status, 404, '相邻插件的路径被我们吞掉会极难查')

    const ok = await fetch(`${base}${PREFIX}/api/world`)
    assert.equal(ok.status, 200)
  })
})

test('未知路由的 404 要列出已注册的路由（可下手）', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PREFIX}/api/根本没有`)
    assert.equal(res.status, 404)
    const body = await res.json()
    // 走到的是 `/api/*` 的兜底（不是静态面板的"文件类型不对"）——
    // 打错端点的人需要看到的是**已注册的 API 列表**，而不是一句关于 MIME 的话。
    assert.match(body.error, /没有这个 API 端点/)
    assert.match(body.error, /\/api\/world/, '要列出已注册的 API')
    assert.match(body.error, /\/api\/events/)
  })
})

// ── 快照 ────────────────────────────────────────────────────────────────────

test('POST /api/activate：切到某个会话自己的世界', async () => {
  const service = createPluginState(resolveConfig({ autoStart: false, scene: 'scene.default-town' }))
  service.ensureWorld()
  const runtime = createRuntime({ service, tickMs: 100 })
  const hub = createEventHub()
  let activated = null
  const handler = createHandler(PREFIX, {
    service,
    runtime,
    source: hub,
    tickMs: 100,
    activateSession: (sessionId) => {
      activated = sessionId
      const world = service.currentWorld()
      return world
    },
    deactivateSession: () => { activated = 'off' },
  })
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PREFIX}/api/activate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-a' }),
    })
    assert.equal(res.status, 200)
    assert.equal(activated, 'session-a')
    const off = await fetch(`${base}${PREFIX}/api/deactivate`, { method: 'POST' })
    assert.equal(off.status, 200)
    assert.equal(activated, 'off')
  })
})

test('GET /api/session：返回这个世界对应的会话（有 title 用 title，否则 teamName）', async () => {
  const service = createPluginState(resolveConfig({ autoStart: false, scene: 'scene.default-town' }))
  service.ensureWorld()
  const runtime = createRuntime({ service, tickMs: 100 })
  const hub = createEventHub()
  const handler = createHandler(PREFIX, {
    service,
    runtime,
    source: hub,
    tickMs: 100,
    worldSession: async () => ({ id: 'agent-world:captain-g2', teamName: 'Agent World G2', title: '夜班小镇' }),
  })
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PREFIX}/api/session`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { id: 'agent-world:captain-g2', teamName: 'Agent World G2', title: '夜班小镇' })
  })
})

test('GET /api/world：快照里没有事件环形缓冲，但有调色板与运行时诊断', async () => {
  const { handler, runtime } = makeDeps()
  runtime.advance(12)

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PREFIX}/api/world`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /application\/json/)
    assert.equal(res.headers.get('cache-control'), 'no-store', '缓存会让面板看起来像卡住了')

    const snap = await res.json()
    assert.equal(snap.type, 'snapshot')
    assert.equal(snap.v, 1)
    assert.equal(snap.world.tick, 12)
    assert.equal(snap.world.events, undefined, '快照刻意不带事件历史——面板要轮询它')

    // 面板读不到内容库，所以配色必须随快照发出。
    assert.equal(typeof snap.palette, 'object')
    // ⚠️ **不要在这里钉死具体色值**（R32 改的）。颜色是**内容**，改一套皮肤就该只是改内容；
    // 而把 `#6F7D5A` 写进测试，等于让"换配色"变成一次测试改动——那会让下一个人以为
    // 颜色是代码约定。这里该守的是**约定**：键在、值是一个合法颜色。
    for (const token of ['ground.engineering', 'role.lead', 'ink', 'fog']) {
      assert.match(
        snap.palette[token] ?? '',
        /^#[0-9a-fA-F]{6}$/,
        `调色板必须带上 ${token}，且是 #RRGGBB（实际：${snap.palette[token]}）`,
      )
    }

    assert.equal(snap.runtime.running, false)
    assert.equal(snap.runtime.tickMs, 100)
    assert.equal(snap.runtime.diagnostics.ticks, 12)
    // 渲染层靠它算"纸条飞到哪了"。不发给它，面板就得自己抄一遍这个数字，
    // 改一处就会让纸条落点与"已送达"对不上。
    assert.equal(snap.runtime.messageDeliveryTicks, 10)

    // ⚠️ 不写死包列表（R62 起多了 `pack.office`）：装哪些包是内容选择，
    // 这条测试要守的是"快照里报出了包"+ 顺序稳定。
    // 包列表是**装载顺序**（后面的包覆盖前面的），不是字母序——所以别断言"已排序"。
    // 要守的是"报出来了、而且内置包都在"。
    const packIds = snap.content.packs.map((p) => p.id)
    assert.ok(packIds.length > 0, '快照里应当报出装载了哪些包')
    for (const id of ['pack.default', 'pack.pixel', 'pack.office']) {
      assert.ok(packIds.includes(id), `快照里应当有 ${id}`)
    }
    // ⚠️ 不写死条数（R62 起站点库 = 原版办公室的 24 个座位 + 手搭的 10 个）。
    // 要守的是"报出了每个库的种类与条数"，不是某一个具体数字。
    for (const kind of ['districts', 'stations', 'models', 'actions', 'maps']) {
      const lib = snap.content.libraries.find((l) => l.kind === kind)
      assert.ok(lib, `快照的库清单里应当有 ${kind}`)
      assert.ok(typeof lib.count === 'number' && lib.count > 0, `${kind} 的条数应当是正数`)
    }
  })
})

test('world.districts 的 ground 是 token（面板负责查表，服务端负责给表）', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const snap = await (await fetch(`${base}${PREFIX}/api/world`)).json()
    const engineering = snap.world.districts.find((d) => d.id === 'district.engineering')
    assert.equal(engineering.ground, 'skin.ground.engineering')
    // 面板要剥掉 `skin.` 前缀再查表——两边的约定在这里钉住（约定，不是某个色值）。
    assert.match(snap.palette[engineering.ground.slice('skin.'.length)] ?? '', /^#[0-9a-fA-F]{6}$/)
  })
})

// ── 命令 ────────────────────────────────────────────────────────────────────

test('POST /api/command：入队而不是立刻执行（确定性要求）', async () => {
  const { handler, service, runtime } = makeDeps()
  const tickBefore = service.currentWorld().tick

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PREFIX}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: { kind: 'pause' } }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.accepted, true)
    assert.equal(body.command, '暂停世界')
    assert.equal(body.pending, 1)
  })

  // 关键：世界**没动**——命令要等下一步的 ingest 段。
  assert.equal(service.currentWorld().paused, false, '命令不该在 HTTP 请求里立刻生效')
  assert.equal(service.currentWorld().tick, tickBefore)

  runtime.advance(1)
  assert.equal(service.currentWorld().paused, true, '推进一步之后才该生效')
  assert.equal(runtime.pending, 0)
})

test('POST /api/command：坏命令给 400 并列出可用 kind', async () => {
  const { handler, service } = makeDeps()
  await withServer(handler, async (base) => {
    const post = (body) =>
      fetch(`${base}${PREFIX}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    let res = await post({ command: { kind: '飞起来' } })
    assert.equal(res.status, 400)
    let body = await res.json()
    assert.match(body.error, /pause/)
    assert.match(body.error, /resume/)

    res = await post({})
    assert.equal(res.status, 400)
    body = await res.json()
    assert.match(body.error, /command/)

    res = await post({ command: null })
    assert.equal(res.status, 400)

    // 坏 JSON 也要给 400 而不是 500。
    res = await fetch(`${base}${PREFIX}/api/command`, { method: 'POST', body: '{ 不是 json' })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /JSON/)
  })
  assert.equal(service.currentWorld().paused, false, '一条坏命令都不该生效')
})

test('POST /api/command：超大的请求体被拒（不用读进内存）', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PREFIX}/api/command`, {
      method: 'POST',
      body: JSON.stringify({ command: { kind: 'pause' }, padding: 'x'.repeat(70 * 1024) }),
    })
    assert.equal(res.status, 413)
  })
})

// ── 静态面板 ────────────────────────────────────────────────────────────────





// ── 装配：apply 真的把面板挂上去了吗 ────────────────────────────────────────

test('apply：有 webServer 时注册**一个**前缀路由，且清理可调用（热重载不泄漏）', async () => {
  const { apply } = await import('../lib/index.js')

  const registered = []
  const disposers = []
  const logs = { info: [], warn: [], error: [] }
  let disposerCalled = 0

  const webServer = {
    register: (route) => {
      registered.push(route)
      return () => {
        disposerCalled += 1
      }
    },
  }

  const effect = (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  const ctx = {
    tools: { register: () => {} },
    logger: () => ({
      info: (m) => logs.info.push(m),
      warn: (m) => logs.warn.push(m),
      error: (m) => logs.error.push(m),
    }),
    effect,
    inject: (names, cb) => {
      const host = { webServer, effect }
      if (names.every((n) => host[n] !== undefined)) cb(host)
    },
  }

  apply(ctx, { autoStart: false, persistEveryTicks: 0 })

  assert.equal(registered.length, 1, '整个插件只该占一个路由座位——多占就有撞车的风险')
  assert.equal(registered[0].kind, 'prefix')
  assert.equal(registered[0].path, '/agent-world')
  assert.equal(typeof registered[0].handler, 'function')
  assert.ok(
    logs.info.some((m) => m.includes('/agent-world/')),
    `日志里要给出面板地址，否则用户不知道该开哪个页面：${logs.info.join(' | ')}`,
  )

  // 清理链要能真的走到路由的 disposer。
  // 四个：运行时定时器、手写对话桥、agent-teams 套壳端口、这条路由——都属于"热重载必须摘干净"的东西。
  // （R37 加了第三个：套壳路径下的队长会话也是我们建的。）
  assert.equal(disposers.length, 4, `应当挂四个清理（运行时 + 手写桥 + 套壳端口 + 路由），实际 ${disposers.length}`)
  for (const dispose of disposers) dispose()
  assert.equal(disposerCalled, 1, '清理必须把路由摘掉')
})

test('apply：没有 webServer 时**不注册也不报错**（软依赖的真实语义）', async () => {
  const { apply } = await import('../lib/index.js')
  const logs = { info: [], warn: [], error: [] }
  const ctx = {
    tools: { register: () => {} },
    logger: () => ({
      info: (m) => logs.info.push(m),
      warn: (m) => logs.warn.push(m),
      error: (m) => logs.error.push(m),
    }),
    effect: () => {},
    inject: () => {}, // 依赖缺席 ⇒ 永不回调
  }

  apply(ctx, { autoStart: false, persistEveryTicks: 0 })

  assert.deepEqual(logs.error, [], 'headless 环境下没有 webServer 是正常的，不该报错')
  assert.ok(
    !logs.info.some((m) => m.includes('面板与 API')),
    '没挂上面板就不该说挂了',
  )
  assert.ok(logs.info.some((m) => m.includes('已就绪')), '世界本身应当照常就绪')
})

test('端到端：apply 注册的处理器挂到真服务器上，API 能取到（页面已交给 Slow Vale 适配层）', async () => {
  const { apply } = await import('../lib/index.js')

  let route = null
  const effect = (fn) => fn()
  const ctx = {
    tools: { register: () => {} },
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    effect,
    inject: (names, cb) => {
      const host = { webServer: { register: (r) => { route = r; return () => {} } }, effect }
      if (names.every((n) => host[n] !== undefined)) cb(host)
    },
  }

  apply(ctx, { autoStart: false, persistEveryTicks: 0, scene: 'scene.default-town' })
  assert.ok(route)

  await withServer(route.handler, async (base) => {
    const snap = await (await fetch(base + '/agent-world/api/world')).json()
    assert.equal(snap.type, 'snapshot', 'API 必须可达：旧面板删了，API 不能跟着没')
  })
})

// ── 处理器自身的鲁棒性 ──────────────────────────────────────────────────────

test('处理器把异常翻成状态码，而不是把栈吐给调用方', async () => {
  const handler = createHttpHandler(
    PREFIX,
    [
      {
        method: 'GET',
        pattern: '/boom',
        handler: () => {
          throw new HttpError(418, '我是茶壶')
        },
      },
      {
        method: 'GET',
        pattern: '/crash',
        handler: () => {
          throw new Error('内部细节：秘密路径 /etc/shadow')
        },
      },
    ],
    () => {},
  )

  await withServer(handler, async (base) => {
    const teapot = await fetch(`${base}${PREFIX}/boom`)
    assert.equal(teapot.status, 418)
    assert.match((await teapot.json()).error, /茶壶/)

    const crash = await fetch(`${base}${PREFIX}/crash`)
    assert.equal(crash.status, 500)
    // 能诊断就行，但不该是原始栈。
    assert.ok(!/at .*router\.ts/.test(await crash.text()))
  })
})

test('readJsonBody：空体返回 undefined，坏 JSON 抛 400', async () => {
  const fakeReq = (chunks) =>
    ({
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield Buffer.from(c)
      },
    })

  assert.equal(await readJsonBody(fakeReq([])), undefined)
  assert.deepEqual(await readJsonBody(fakeReq(['{"a":1}'])), { a: 1 })
  await assert.rejects(() => readJsonBody(fakeReq(['{bad'])), (e) => e.status === 400)
  await assert.rejects(() => readJsonBody(fakeReq(['x'.repeat(70 * 1024)])), (e) => e.status === 413)
})

test('applyCommand / buildSnapshot：没有世界时给 503 而不是崩', () => {
  const service = createPluginState(resolveConfig({ autoStart: false, scene: 'scene.default-town' }))
  const runtime = createRuntime({ service, tickMs: 100 })
  const deps = { service, runtime, tickMs: 100 }

  assert.throws(() => buildSnapshot(deps), (e) => e.status === 503)
  assert.throws(() => applyCommand(deps, { command: { kind: 'pause' } }), (e) => e.status === 503)
})

// ── R46：流水线目录随快照下发（看板要按流水线分组，中文名是内容）────────────────

test('R46：快照带 taskSets 目录（id → 中文名），前端不必猜中文', () => {
  const service = createPluginState(resolveConfig({ autoStart: false, scene: 'scene.default-town' }))
  service.open('目录小镇')
  service.dispatch('task.quick-fix')
  const runtime = createRuntime({ service, tickMs: 100 })
  const snap = buildSnapshot({ service, runtime, tickMs: 100 })
  const quick = snap.taskSets.find((s) => s.id === 'task.quick-fix')
  assert.ok(quick, 'taskSets 里必须有派过的那条流水线')
  assert.equal(quick.name, '快速修一个 bug', '名字来自内容库，不在前端写死（红线）')
  assert.ok(snap.taskSets.length >= 3, '三套内置流水线都该在目录里')
})

test('R227：快照带统一空间（nav + 障碍 + 实体），且吸附点没有落进墙里', () => {
  const service = createPluginState(resolveConfig({ autoStart: false, scene: 'scene.office' }))
  service.open('空间小镇')
  const runtime = createRuntime({ service, tickMs: 100 })
  const snap = buildSnapshot({ service, runtime, tickMs: 100 })
  const space = snap.scene.space
  assert.ok(space, '有底图的场景必须下发 space（渲染器不再自己 fetch 碰撞体）')
  assert.ok(space.audit.blockedCells > 0, 'office 场景必须有 blocked 格')
  assert.ok(space.audit.fineRects > 0, '精细碰撞体应当被读进来')
  assert.ok(space.obstacles.length >= space.audit.fineRects, '障碍 = 精细碰撞体 + 补格')
  assert.equal(space.audit.slotsBlocked, 0, '吸附点不能落在 blocked 格里')
  if (space.audit.override !== true) {
    assert.ok(space.audit.artCells > 0, 'office 有美术占位格（家具层明显有东西）')
  }
  assert.ok(space.obstacles.length >= space.audit.fineRects + space.audit.artCells, '障碍 = 精细几何 + 美术占位')
  assert.ok(space.entities.length >= 20, '站点应当被收进实体表')
})

test('R542：快照里每人带 skills（派生由组合根注入，路由只说搬不重算）', () => {
  const service = createPluginState(resolveConfig({ autoStart: false, scene: 'scene.default-town' }))
  service.open('手艺小镇')
  const runtime = createRuntime({ service, tickMs: 100 })

  // 不注入时：字段存在但是空数组（面板据此显示「还没有记录」，不会崩）
  const bare = buildSnapshot({ service, runtime, tickMs: 100 })
  for (const agent of bare.world.agents) {
    assert.ok(Array.isArray(agent.skills), '每个角色都该有 skills 数组')
    assert.equal(agent.skills.length, 0, '没注入口时不该编出数据')
  }

  // 注入时：原样搬运，路由不加工
  const rows = [{ skill: 'code', label: '工程', level: 2, points: 80, sample: 10, failed: 0, lastUsedTick: 42 }]
  const injected = buildSnapshot({
    service,
    runtime,
    tickMs: 100,
    skillsOf: (_world, agentId) => (agentId === bare.world.agents[0].id ? rows : []),
  })
  assert.deepEqual(injected.world.agents[0].skills, rows, '注入什么就下发什么')
  assert.equal(injected.world.agents[1].skills.length, 0, '别人不该跟着有数据')
})
