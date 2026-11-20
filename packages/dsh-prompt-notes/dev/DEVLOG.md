# 开发日志

> 每次运行在**末尾追加**一条（最新在最下）。格式：时间 · 里程碑 · 做了什么 · 验证证据 · 发现的问题 · 下次从哪继续。
> 写给「完全没看过代码的人」也能看懂：先说问题是什么、为什么会这样、怎么修的；关键代码贴在条目里。

---

## 2026-11-19 夜 · v0.2.0 收尾 + 隔离测试环境（人工 + 本会话）

**做了什么**
- v0.2：三种便签（提示词 / 技能 / MCP）× 三种作用域（全局 / 工作区 / 会话）+「系统」页 + 横向拟物界面；31 项单测；demo 页面。
- 搭建**隔离测试实例**：`scripts/e2e.sh`（`DSH_HOME=/tmp/pn-test-home`，端口 48990，清除继承的 `DSH_PROFILE*` 环境变量），不碰用户的 `~/.dsh` 与 52559。
- 新增真实冒烟测试 `test/e2e/smoke.mjs` 与 MCP 测试桩 `test/fixtures/echo-mcp.mjs`。

**在真实系统里发现并修掉的 3 个 bug**（假 ctx 的单测全绿，但真实系统里是坏的）

1. **路由 404**。插件把路由前缀注册成 `'/@kpeace/dsh-prompt-notes/'`（带尾斜杠），而 webServer 的前缀按路径段匹配，别的插件都写成 `'/@kpeace/dsh-spellbook'`。修：`path: ROUTE_PREFIX.replace(/\/$/, '')`，并在处理函数里校验请求路径以 `ROUTE_PREFIX` 开头。
2. **会话级技能挂不上**：`cannot get property "skills" without inject`。Cordis 要求访问 `ctx.<服务>` 时，当前 fiber 链上声明过该依赖；`agent.ctx` 是另一棵树，没声明。修：
   ```js
   agent.ctx.inject(['skills'], (actx) => {
     const undo = actx.skills.registerProvider(/* … */)
     actx.effect(() => undo)
   })
   ```
3. **工作区作用域会悄悄失效**：`workingDirectory` / `agents` 同样没声明，而旧的 `optional()` 辅助函数把异常**吞掉**，于是 cwd 永远是 `undefined`。修：改为在 `ctx.inject([name], cb)` 回调里取到服务存进持有者 `svc`，并删除吞异常的辅助函数。

   同时让单测里的假 ctx 复刻这条约束（未声明就取服务会抛错），这样以后同类 bug 单测就能抓到。

**真实验证证据**（隔离实例，`node test/e2e/smoke.mjs` 7/7）
- 提示词标记出现在真实 `systemPrompt.assemble()` 的 `prompt-notes:injected` 段；
- 技能出现在真实 `skills.list()`，`provider=prompt-notes`；
- MCP 经真实 `mcpManager` 连上测试桩：`state=connected`，`tools=1`，`mcpCount=1`；
- 总开关撤回三条通道；删除便签后全部消失。

**尚未验证**：会话 / 工作区作用域在真实会话里的行为、`tools.guard`（→ M1）。

**下次从哪继续**：M1。

---

## 2026-11-20 00:00–00:45 · M1 真实会话里的作用域验证（+ M2 的第一半：MCP 只在有活动会话时起进程）

**问题是什么**

v0.2 里「作用域」只在假 ctx 的单测里验证过。假 ctx 只能近似 Cordis 的规则（比如「没声明依赖就取服务会抛错」是我自己复刻的），而作用域依赖三个**只有真实系统才有**的东西：
1. `systemPrompt.assemble({ agent })` 里那个 `context.agent` 到底会不会传进 section 的 text 回调；
2. `agent.ctx` 上注册的 skill 提供方，是否真的只对那一个 agent 可见；
3. `workingDirectory.get(agent.session)` 是否真的给出会话的 cwd。

所以这一轮的交付物不是新功能，而是**一条能反复跑的真实测试**：`test/e2e/scope.mjs`。

**关键发现：不用模型、不用浏览器也能造真会话**

浏览器点「新对话」时，前端只发了一个普通 HTTP JSON-RPC（用 `browser_execute` 抓到的）：

```json
POST /api/session/create
{"type":"client-request","rpcId":"…","method":"session/create",
 "payload":{"args":{"request":{"sessionId":"session-xxx","cwd":"/tmp/somewhere"}}}}
```

会话 id 由**调用方自己选**，`cwd` 也可以直接给（不给就用实例的默认目录）。于是测试脚本可以：
```js
const res = await fetch(base + '/api/session/create', { method:'POST', headers:{ cookie, 'content-type':'application/json' },
  body: JSON.stringify({ type:'client-request', rpcId: crypto.randomUUID(), method:'session/create',
    payload: { args: { request: { sessionId, cwd } } } }) })
```
建出来的会话有真 Agent、真 fiber 树、真 cwd —— 和用户点按钮得到的东西一样，但不需要模型（不跑 turn、不发 prompt），也不占住浏览器。

**测试覆盖了什么**（`node test/e2e/scope.mjs`，23/23 全绿，约 16 秒）

两个会话 A、B 各给不同 cwd，然后：
1. 会话级 prompt 只进 A 的 assemble 结果，B 里没有；
2. 工作区级 prompt 在 A（cwd 命中）里有，B 里没有；
3. 会话级 skill 只出现在 A 的 `skills.list`（provider = prompt-notes），B 里没有 —— 这条直接证明 `agent.ctx.inject(['skills'], …)` 在真实 Cordis 树上成立；
4. 工作区级 skill 按 cwd 出现 / 不出现；
5. 面板 `/state?session=` 的状态相对观察者正确：A 看到 `injected`，B 看到 `elsewhere`（同一份 notes，两种视图）；
6. 会话级 MCP：钉在会话 C 上，C 活着时登记并连上（面板对 C 显示 `injected`、对 B 显示 `elsewhere`）；登记是全局的，所以 B 的工具列表里也看得到它 —— 这一层由 `tools.guard` 兜底，见下面 M2①；
7. 实例日志里没有 Cordis 的 `without inject`、也没有「会话提供方挂载失败」；
8. **冷启动**：重启隔离实例 → 该会话变成「冷」的（`/system` 里 `session.found=false`）→ 钉在它身上的 MCP 不再有进程（`/system` 的 `mcp` 列表里消失）→ 用同一个 `session/create` RPC 原地恢复 → 会话级 skill 与 MCP 都回来了。

第 8 条是这轮最有价值的检查。provider 是注册在 `agent.ctx` 上的，进程重启后那棵树没了；它能回来，说明恢复会话会重新触发 `agent/created`，`attach()` 又挂了一次：

```js
c.on('agent/created', ({ agent }) => { attach(agent) })   // 新建与恢复都走这里
```

重启的实现（`stop` 后 `start`，换一次性令牌所以要重新换 cookie）：
```js
execFileSync(e2e, ['stop'])
spawn(e2e, ['start'], { stdio: 'ignore', detached: true }).unref()
// 轮询 scripts/e2e.sh url，拿到新 URL 后用 tokened URL 换 cookie
```

**没做到的（诚实记录）**

`tools.guard` 的**拒绝路径**没有在真实系统里跑：要触发一次 `mcp__<名>__*` 调用，必须让模型发出 tool call，而测试刻意不调模型（慢、要钱、不稳定）。退路是按 PLAN 写的——判定逻辑仍在单测「apply: MCP 作用域 guard」里覆盖，e2e 只验证它依赖的观察者解析（第 1、2、5 条就是同一个 `appliesTo` 和同一个 cwd 来源）。这一步留到 M2：M2 会把「不适用的会话连工具都看不到」做成可观察的（`tools.restrict` + `/system` 的 `tools.mcpCount`），那时就不需要真调用了。

**顺手记下的三个疑点（进 PLAN 的缺陷池，未改代码）**

- 工作区 target 若写成符号链接路径（`/tmp/x`）而会话 cwd 是物理路径（`/private/tmp/x`），`pathWithin` 的纯字符串 `resolve()` 会判不适用。正常路径下 target 来自 `viewer.cwd`，两者一致，所以没动。
- 插件热重载时「已经活着的 agent」靠一次性 sweep 补挂，而那一步依赖 `svc.agents` 已由另一个 `ctx.inject` 填入；重启场景由 `agent/created` 兜住，e2e 没暴露。
- `/system` 每观察者缓存 3 秒：写完便签立刻读可能看到旧值（测试用轮询容忍）。

**M2 的第一半：MCP 只在「有适用的活动会话」时才起进程**（`index.js`）

**问题是什么。** v0.2 只要有一张启用的 MCP 便签就 `mcpManager.register`，不管它的作用域是否适用。于是一张钉在「某个会话」上的便签，在用户根本没打开那个会话时也会拉起一个子进程：占内存、启动时可能跑命令、面板上也看不出它其实用不到。MCP 的「全局」指的是**工具挂到所有会话上**，不等于**无条件启动**。

**怎么改。** 加一个纯判定 `mcpWanted(note)`：

```js
const mcpWanted = (note) => {
  if (note.scope === 'global') return true
  const listed = svc.agents?.list?.()
  if (!Array.isArray(listed)) return true            // 拿不到活动会话 → 退回 v0.2 行为
  if (note.scope === 'session') return listed.some((a) => a.id === note.target)
  const wd = svc.workingDirectory
  if (typeof wd?.get !== 'function') return true
  return listed.some((a) => {
    try { return pathWithin(wd.get(a.session), note.target) } catch { return false }
  })
}
```

为什么不需要引用计数：路由层的 `conflict()` 已经保证**全库 MCP 名唯一**，一个名字只对应一张便签，所以「该不该活」只由那张便签的 scope 决定。

**什么时候重算。** 便签变了有 `store.subscribe`；这轮补的是「便签没变、但活着的会话变了」（关掉会话 → 该停；再打开 → 该起）。没有可靠的「agent 销毁」事件可依赖（`docs/agent-lifecycle.md` 只列了创建方向的事件），所以在**已有的** 2 秒 poll tick 里顺带比对一次「活动会话签名」：

```js
const reconcileIfLiveChanged = () => {
  if (!mcpManager) return
  const listed = svc.agents?.list?.()
  if (!Array.isArray(listed)) return
  const wd = svc.workingDirectory
  const sig = listed.map((a) => `${a.id}:${wd?.get?.(a.session) ?? ''}`).join('|')
  if (sig === liveSig) return      // 没变化就不碰注册表：免得每 2 秒重试一次失败的注册、刷日志
  liveSig = sig
  reconcileMcp(mcpManager)
}
```

只在签名变化时重算，而不是每 2 秒无脑重算，是因为失败的注册（比如名字和用户自己配的撞了）每 2 秒会打一次 warn，日志会脏。

**验证。** 单测 33/33（新增 2 条：只有 S2 活着时全局的登记、会话级/工作区级不登记；S1 加入后两秒内出现；S1 撤掉后消失；以及「拿不到 agents 服务就退回总是登记」）。真实实例里 scope.mjs 的第 6、8 项从「一直登记」变成「随会话生死」三态（活着 → 连上；重启后冷 → 没有进程；恢复 → 又连上）。删掉唯一一张 MCP 便签后 `pgrep -fl echo-mcp` 立刻没有输出 —— 子进程确实跟着注册撤销退出了，不是僵尸。

**这次**没做 M2 的第二半（`tools.restrict` 把不适用会话的工具从列表里藏起来）。它必须在「连接成功之后、且知道工具名」时跑，并且要在连接状态 / 会话 / cwd 每次变化时重算，属于另一块独立的风险面；而这半已经让「不适用的 MCP 根本不启动」成立，先把这块吞下更划算。

**改动清单**

- 新增 `test/e2e/scope.mjs`（23 项检查，含一次可选重启；`PN_SCOPE_RESTART=0` 跳过）；
- `index.js`：`mcpWanted` + `reconcileIfLiveChanged`（poll tick 内，不新增定时器）+ `ctx.on('agent/created')`；
- `test/host.test.js`：新增 2 条 MCP 生命周期单测（31 → 33）；
- `package.json` 加 `"e2e:scope": "node test/e2e/scope.mjs"`；
- `dev/PLAN.md`：勾掉 M1、更新现状、补缺陷池、M2 标注①已完成、速查加一行；
- 顺带清掉了测试 HOME 里上一轮手工验证留下的 3 张便签（`REAL-GLOBAL` / `e2e-skill` / `echo`），让下次运行从干净状态开始。
- 全绿：`npm test` 33/33、`npm run check`、`node test/e2e/smoke.mjs` 7/7、`node test/e2e/scope.mjs` 23/23。

**下次从哪继续**：M2 的第二半（连接成功后在不适用的活动 agent 上 `tools.restrict({deny})`，验收点：`/system?session=<不适用>` 的 `tools.mcpCount` 变小）。

---

## 2026-11-20 01:30–01:35 · M2 第二半：把不适用的 MCP 工具真正从工具列表里藏起来

**问题是什么**

上一轮做完 M2 第一半之后，MCP 只在「有适用的活动会话」时才起进程了。但还剩一个洞：**只要那一个进程活着，它连上之后注册的 `mcp__<名>__*` 工具就会出现在所有会话的工具列表里**。会话 A 钉了某个 MCP，会话 B 不该看到它，可 B 的模型仍然在工具表里看到这些东西——它可能去调，然后被 `tools.guard` 拒掉，白烧一次往返；更糟的是工具描述本身常常泄露「这个服务器能做什么」。

`guard` 只能管「调用」，管不了「列表」。要让工具根本不出现，得用 `tools.restrict({ deny })`。

**为什么不能顺手就做**

两个硬约束（都在 `@deepseek-ai/dsh-tools` 里）：
1. **只能在 `agent.ctx` 上调**。`restrict()` 的实现第一步就是 `scopeOf(this.ctx)`，根 ctx 上没有 scope，直接抛
   `tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent`。
2. **只能点名「此刻已经注册的全局工具」**。它会用 `view(scope).restrictableNames` 校验，出现没见过的名字就抛
   `tools.restrict() names unknown global tool …`。

所以时序只能是：MCP 连上 → 服务器把工具 schema 注册进来 → 我们才拿得到工具名 → 才能 restrict。而且连接状态会变（断线重连、晚一点才连上），所以**不能只做一次**，得反复对齐。

**怎么做的**（`index.js`）

第一步，把「这个工具名属于哪张便签」抽成一个纯函数，guard 和 restrict 共用（顺手修掉 guard 里 `n.mcp` 可能不存在的隐患）：

```js
const mcpOwnerOf = (notes, toolName) => {
  let owner
  for (const n of notes) {
    if (n.kind !== 'mcp' || !n.mcp?.name) continue
    if (!toolName.startsWith(`mcp__${n.mcp.name}__`)) continue
    if (!owner || n.mcp.name.length > owner.mcp.name.length) owner = n   // 最长前缀优先
  }
  return owner
}
```

第二步，每个 tick 对每个**活动的** agent 算一次「它现在能看到哪些 `mcp__*`、其中哪些不该给它看」，只在 deny 集合变化时才动注册表：

```js
const applyMcpRestrictions = () => {
  const tools = svc.tools
  if (!tools?.definitions || !tools?.restrict) return
  const notes = store.snapshot().notes
  for (const agent of svc.agents?.list?.() ?? []) {
    const names = tools.definitions(agent).map((d) => d.name)      // 不 clone，只取名字
    const viewer = viewerOfAgent(svc, agent)
    const deny = names.filter((name) => {
      if (!name.startsWith('mcp__')) return false
      const owner = mcpOwnerOf(notes, name)
      return Boolean(owner) && owner.scope !== 'global' && !appliesTo(owner, viewer)
    })
    const sig = deny.slice().sort().join(',')
    if (restricted.get(agent.id)?.sig === sig) continue             // 没变化就一点不干
    …旧限制先 lift，再按需 agent.ctx.inject(['tools'], (t) => t.tools.restrict({ deny }))…
  }
}
```

几个刻意的选择：
- **用 `definitions()` 而不是 `schemas()`**：后者会 `projectToolSchema(…, true)` 深拷贝每个定义，我们只要名字。
- **不新增定时器**：挂在已有的 2 秒 `store.poll()` tick 里（第一半已经这么做了），再加上 `store.subscribe`（改便签立刻生效）。
- **失败只 warn 一次**：`restrict` 可能因为「刚读到名字、下一秒服务器断了」而抛错。失败**不记账**（下个 tick 重试），但同一个 `agent|deny 集合` 只打一次日志，免得刷屏。
- **限制随 agent 消亡**：`t.effect(() => () => lift())` 注册在 `agent.ctx` 上，会话关掉时自动撤；我们自己再按 `liveIds` 清理一遍兜底。
- **guard 保留**：restrict 有 ≤2 秒的窗口（见下），那段时间 guard 仍然是最后一道门。

**验证**

单测 33 → 35，新增两条（假 ctx 也补了 `tools.definitions` / `agent.ctx.tools.restrict`，并且**复刻了真实的两条约束**：根 ctx 上调 restrict 会抛、点名未注册的工具会抛）：
- 两个会话 S1/S2、两个 MCP（一个全局、一个钉 S1）：只有 S2 被 deny `mcp__sess__read`，全局的不 deny；把便签改成全局后限制立刻撤掉。
- 一开始没有工具名（服务器还没连上）→ 不调 restrict、不抛错；把名字塞进去、过一个 tick → S2 的限制出现。这就是「连接状态变化要重算」。

真实实例（`node test/e2e/scope.mjs`，24 项通过 + 1 条 SKIP 说明，全绿）：
- 钉在会话 C 上的 MCP 连上后，`/system?session=C` 里这个服务器 `tools ≥ 1`（C 看得到）；
- `/system?session=B` 里同一个服务器 `tools = 0`、`tools.mcpCount = 0`（B 看不到）——**这就是 M2 的验收点**；
- 重启 → C 变冷 → 进程没有、工具没有；恢复 C → 进程回来、C 的工具也回来；
- `smoke.mjs` 7/7 仍全绿（全局 MCP 不受 restrict 影响），实例日志里 `[prompt-notes]` 零条警告。

**已知局限**（已写进 PLAN 缺陷池）**

- restrict 在 2 秒的 tick 里对齐：MCP 刚连上、或会话刚 `cd` 到另一个目录的那 ≤2 秒里，不适用会话仍会短暂看到 `mcp__*`。要消掉这个窗口，得挂到 `mcpManager` 的连接状态事件上（目前没有稳定的事件名可依赖，先留着）。
- `mcpOwnerOf` 按名字前缀判断归属：如果别的插件注册了同前缀的工具名，归属会判错。MCP 名全局唯一（路由层的 `conflict()` 保证）把这个概率压得很低。

**改动清单**：`index.js`（`mcpOwnerOf` + `applyMcpRestrictions` + 把 `tools` 服务存进 `svc`）、`test/host.test.js`（假 ctx 补 `definitions`/`restrict` + 2 条单测）、`test/e2e/scope.mjs`（把「全局可见」的断言换成「主人看得见 / 别人看不见」，并补恢复后工具回来的一条）、`dev/PLAN.md`（勾掉 M2、更新现状、补两条已知局限）。

**下次从哪继续**：M3（外观简约 + 文字精简）。做之前先在 `demo/` 里出两个减法方案，再动 `client.js`。

---

## 2026-11-20 03:00–03:10 · M3 外观简约 + 文字精简

**问题是什么**

用户对当前外观的评价是「挺好，可以稍微再简约一点」，并给出了方向：**减法**——收敛纹理、倾斜幅度、装饰（胶带 / 回形针等）、字体种类；不要加新装饰。保留三样东西：图钉 = 开关、图章 = 作用域、纸色 = 类型。

上一轮（v0.2）的纸条上叠了：噪点纹理（一张 SVG 湍流 data URI，每张纸都要跑一次滤镜）、胶带 / 回形针（纯装饰）、两层 `drop-shadow`、随机倾斜（±0.55°，未钉住时放大到 ×2.6 + 1.4°）、和纸胶带的锯齿 clip-path + 斜纹、图章的旋转 + `mix-blend-mode: multiply`。另外编辑页里有 4 组没人会读的说明文字。

**两个方案（都在真 demo 里量过，不是凭感觉）**

`demo/` 本来就是「真前端代码 + 浏览器内假后端」，所以方案对比就是改 `client.js` → `node demo/build.mjs` → 用本地 HTTP 服务打开量尺寸（`file://` 被浏览器工具拒绝，用 `python3 -m http.server 48991` 临时起一个）。

- **方案 A（保守）**：只做两件最安全的减法——删掉噪点纹理、删掉胶带 / 回形针，倾斜减半。
- **方案 B（在 A 之上再收一层）**：A + 标签页 / 胶头 / 和纸胶带 / 图章的「质感层」全部压平（渐变 → 平色、锯齿 clip-path → 一条素色左标、图章不旋转不叠底）、纸条投影两层 → 一层；再删 4 组文案。

实测对比（同一份 mock 数据，同一套度量脚本）：

| 指标 | 现状 v0 | 方案 A | 方案 B（采纳） |
|---|---|---|---|
| 噪点纹理（svg data URI） | 1 | 0 | 0 |
| `clip-path` | 2 | 2 | 1 |
| `drop-shadow` | 6 | 6 | 3 |
| `mix-blend-mode` | 3 | 3 | 1 |
| 渐变层 | 26 | 26 | 21 |
| `client.js` 体积 | 75.9 KB | 74.8 KB | 73.1 KB |
| 纸条最大倾斜 | 0.55° | 0.24° | 0.24° |
| 300px 页签溢出（中文） | 30px | 30px | 0 |
| 300px 页签溢出（英文） | >51px | >51px | 0 |

**为什么选 B**：A 的问题是把纹理去了、但「质感层」还在——胶带变成素色标签后仍然带锯齿和斜纹，纸条还是两层投影，图章还在叠底旋转，300px 下英文页签依然装不下。B 每一项都指向同一个方向（少一层渲染、少一个不确定的混色），并且没有动那三样「身份」：图钉还是图钉（开关）、图章还是图章（作用域，只是不再歪着）、纸色还是那五色（类型）。B 之后 `drop-shadow` 从 6 降到 3，11 张纸条每次滚动少跑 3 次滤镜——这是可感知的代价，不只是审美。

**关键的几处改动**（`client.js`）

```js
// 1) 噪点纹理整条删掉（它是一张 120×120 的 SVG 湍流图，铺在簿面、每张纸、弹层上）
- background: GRAIN + ",linear-gradient(#fffdf0,#fbf3d4)"
+ background: linear-gradient(#fffdf0,#fbf3d4)

// 2) 倾斜减半
- var r = rot(n.id, on ? 0.55 : 1.1);      // 纸条
+ var r = rot(n.id, on ? 0.28 : 0.55);
- .pn-slip.is-off{ transform:rotate(calc(var(--pn-r) * 2.6 + 1.4deg)) }
+ .pn-slip.is-off{ transform:rotate(calc(var(--pn-r) * 1.6 + .6deg)) }

// 3) 和纸胶带（分组标题）→ 一条素色左标：去掉锯齿 clip-path、斜纹、投影
- .pn-washi{ background:repeating-linear-gradient(135deg,…),#f2c4a0; clip-path:polygon(…);
-            transform:rotate(-.8deg); box-shadow:0 1px 2px … }
+ .pn-washi{ border-left:3px solid; border-radius:0 3px 3px 0; background:rgba(60,45,10,.06) }
+ .pn-g-injected .pn-washi{ border-left-color:#3f8a4f }   // 状态色只留在这一根竖线上

// 4) 窄面板先让计数退场，五个索引标签才放得下（英文标签比中文长得多）
.pn-root{ container-type:inline-size }
@container (max-width:340px){ .pn-tab-n{ display:none } }
```

**删掉的文案**（中英成对删，`STR` 里 106 个 key 中英仍然一一对应，脚本核对过）

1. `skillHint`「技能会出现在模型的技能目录里，按描述被按需加载。」→ 表单里 `fSkillDesc` 的占位符已经写着「一句话描述：模型靠它决定何时加载」，同一件事说两遍。
2. `mcpScopeHint`「MCP 进程是全局的；非全局作用域靠调用时拦截——工具仍会出现在工具列表里。」→ **这句已经过时**：M2 之后不适用的会话根本看不到这些工具。留着是错的，删掉比改短更省。
3. `scopeGlobalD / scopeWorkspaceD / scopeSessionD`（「所有会话 / 目录之内的会话 / 仅这一个会话」）→ 三个按钮本来就写着「全局 / 工作区 / 会话」，下面那行小字是复读。
4. `sysIntro`「这是模型在这个会话里实际会看到的、不是便签贡献的部分（只读）。」→ 标题 + 每一行已经说明了；**保留** `sysNoSession`（「没有活动会话」才是真会让人迷路的状态）。

顺手删了两个随之变成死代码的 CSS 选择器（`.pn-hint`、`.pn-scopebtn small`），作用域按钮从「标签 + 小字两行」变成一行居中。

**验收（全部用 DOM 度量，观感未经人眼确认）**

- **对比度**：对最亮的那张纸（trace `#f7f6f1`，对深墨最不利）算，墨色 `#2f2410` 14.06、次级墨 7.57、三级墨 6.20，状态/图章色 5.02–8.77，开关印字 5.22、ON 绿 4.92、Dymo 反白 11.86、主按钮白字 5.05 —— **最小 4.92，全部 ≥ 4.5**；图章去掉 `mix-blend-mode` 之后颜色就是声明的颜色，比之前更好预测。
- **宽度**：300 / 380 / 560px，中文与英文各量一遍，`.pn-root / .pn-tabs / .pn-tools / .pn-scroll / .pn-foot / .pn-slip / .pn-slip-foot` 全部 `scrollWidth - clientWidth = 0`；300px 下打开编辑页，`.pn-sheet / .pn-sheet-body / .pn-scopes / .pn-sheet-foot` 也全是 0。
- **真实实例**：在隔离实例的右侧栏（542×766）里打开便签页，两张便签正常渲染（提示词 / 技能），`--pn-r` 只有 0.14° / 0.01°，分组标题是「生效中 2」，胶带 / 回形针节点已不存在，根元素与滚动区都无横向溢出。
- `npm test` 35/35、`npm run check`、`node test/e2e/smoke.mjs` 7/7 全绿；`demo/demo.html` 已重建（217 KB）。

**已知局限**：观感只能靠尺寸 / 对比度 / DOM 结构判断——**没有经过人眼确认**，这一步要等用户看一眼（如果觉得哪里还花，优先继续删，不要加）。`@container` 需要较新的 Chromium/WebKit（DSH 桌面端满足）。

**改动清单**：`client.js`（减法 + 删文案 + 容器查询）、`demo/demo.html`（重建）、`dev/PLAN.md`（勾掉 M3、更新现状）。

**下次从哪继续**：M4（助手工具 `note_list / note_create / note_update / note_delete`）。

---

## 2026-11-20 04:30–04:40 · M4 助手工具（note_list / note_create / note_update / note_delete）

**问题是什么**

到这一轮为止，便签只能由**人**在面板里写。模型自己有一堆「想让它记住」的东西（这个仓库的约定、用户的口头偏好、该用哪个技能），却只能写在回答里，下一次会话就没了。M4 就是给模型四个工具，让它能把这类东西写成便签——和用户自己写的便签存在同一个文件里，一样出现在面板里，一样可编辑、可删。

**为什么不能简单转发到 HTTP 路由**

面板的写接口没有「谁在写」这个概念，但助手有两个额外的风险面：

1. **MCP 便签 = 本机执行一条命令。** 钉上（enabled）会在 DSH 的权限下 spawn 一个子进程。这个决定只能由人做，所以助手创建的 MCP 便签一律未钉住，而且助手不能把任何 MCP 便签改成启用。
2. **改一张已在跑的 MCP 便签的命令，等于换一条命令去跑。** `reconcileMcp` 看到 entry 变了会「撤销 + 重登记」，于是 `command: node` 可以变成任何东西。所以助手**只能改 MCP 便签的标题 / 备注 / 标签**，`mcp` / `enabled` / `scope` / `target` 一律拒绝。

另外两条克制：一次调用只动一张便签（不批量），列表里的正文有总额度（6000 字），免得模型一调就把整个便签簿灌进上下文。

**怎么做的**

第一步，把「写」这件事从路由里抽出来，两条路径共用同一份规则（`src/mutations.js`）。路由原来自己内联了「校验 → 冲突 → 写盘」，助手再抄一遍必然会漂移：

```js
// src/mutations.js
export async function createNote(store, raw) {
  const parsed = parseNoteInput(raw)                    // 和面板同一套校验
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
  await store.mutate((doc) => {
    if (doc.notes.length >= LIMITS.notes) { problem = …; return }
    const dup = conflictOf(doc.notes, parsed.value)     // 重名判定也挪进了 notes.js
    if (dup) { problem = …; return }
    doc.notes.push({ id: randomUUID(), createdAt: now, updatedAt: now, ...parsed.value })
  })
  …
}
```

第二步，`src/tools.js` 只做「工具这一层」的规则，写操作全部委托给上面那三个函数：

```js
// 助手建的 MCP 便签一律未钉住：钉上等于在本机启动一条命令，只能由人决定。
if ((input.kind ?? 'prompt') === 'mcp') delete input.enabled

// 已在跑的 MCP 便签只许改装饰字段
if (note.kind === 'mcp') {
  const blocked = ['mcp', 'enabled', 'scope', 'target'].filter((k) => k in args)
  if (blocked.length) throw new Error(`only the user can change ${blocked.join(', ')} on an MCP note; …`)
}
```

第三步，**不引入 `@deepseek-ai/dsh-tools` 依赖**。`defineTool()` 做的两件事是：把参数 DSL 转成 JSON Schema、包一层参数校验。我们直接给注册表喂「已经成形的 JSON Schema + 自己的校验」就够了（`register()` 只要求 `output { schema, render }`，`parameters` 会被原样投影给模型）：

```js
{
  name: 'note_create',
  description: '… MCP notes are ALWAYS created unpinned and the assistant cannot enable one …',
  parameters: { type: 'object', additionalProperties: false, required: ['body'], properties: { … } },
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
  async execute(args, exec) { … 返回一段文本 … },
}
```

`execute` 返回的是**值**（一段 JSON 文本），`render` 才把它包成内容块——第一版把这两个搞反了（execute 返回内容块、schema 却声明 string），单测立刻炸了，正好说明 schema 和返回值必须对齐。

**验证**

单测 35 → 41（新增 `test/tools.test.js` 6 条）：四个名字与参数是纯 JSON、描述里写清「不能启用 MCP」；提示词默认钉住而 MCP 强制未钉住；缺技能描述 / MCP 重名会被拒且不写盘；不能改类型；MCP 便签改 enabled / mcp / scope 全被拒；删除幂等；列表按 kind 过滤、`applies` 相对当前会话、正文额度有上限。

真实实例里怎么证明「模型真的多了这四个工具」：`/system` 只回工具数量，而工具章节（`tool:bash` 等都是各工具包自己贡献的段）不会自动给新工具生成，所以不能靠章节名。做法是**同一实例上做 A/B**：把注册那一行换成 `(() => () => {})`，重建会话读 `tools.count` = **40**；恢复注册再读 = **44**。差的 4 个就是这四个工具（`_ 真实会话，非假 ctx`）。`smoke.mjs` 7/7、`scope.mjs` 24 项通过 + 1 条 SKIP 也都仍然全绿。

顺带一条经验：中途怀疑「注册成功了吗」，先在 `index.js` 里临时 `warn('DEBUG registered:', …definitions().map(d=>d.name))`，看到四个名字都在，才把怀疑范围收窄到「注册了但没进 agent 的工具集」，再用 A/B 确认真值。调试完把 DEBUG 行删干净（`grep DEBUG index.js` 为空）。

**已知局限 / 有意的取舍**

- 助手建的**提示词**便签默认钉住（会真的注入下一次会话）。这是 M4 明确的口径（只对 MCP 强制未钉住），而且便签在面板里一眼可见、可删；如果以后要更保守，改成「助手建的一律未钉住」只是 `note_create` 里的一行。
- 工具描述是英文（模型面向，和 DSH 自带的工具目录一致）；面板里新增的用户可见文案本轮为 0，所以没有中英文对齐问题。
- `note_update` 不能改类型——要换类型只能删了重建。

**改动清单**：新增 `src/mutations.js`（写路径共用）、`src/tools.js`（四个工具 + 边界）、`test/tools.test.js`（6 条）；`src/routes.js` 改为调用 `mutations`；`src/notes.js` 新增 `conflictOf`；`index.js` 在 tools 的 inject 里注册并在卸载时撤销。

**下次从哪继续**：M5（导入 / 导出分享）。

---

## 2026-11-20 06:00–06:12 · M5 分享（导出 / 导入）

**问题是什么**

便签现在只在一个人自己的 `DSH_HOME/prompt-notes/notes.json` 里。想把一套「团队编码要求 + 三个技能」给同事，只能让人家照着手抄。M5 就是给这条路：导出一份 JSON，对方粘贴进去、先看会变成什么样、再决定导入。

**风险点（这轮的设计基本都在处理这些）**

1. **导入 = 别人往你的环境里塞东西。** 一份文件里可能带一张钉着的 MCP 便签——那等于在本机执行别人的命令。所以导入的 MCP **一律未钉住**，而且预览里必须原样列出「钉上之后会执行的那一行命令」。
2. **默认不能覆盖。** 同事发来的文件里，id 或者技能名很容易和你的撞。默认**重命名**而不是覆盖，且预览把每条动作写清楚。
3. **半途失败最糟。** 导入是「先预览、后确认」两步，两步用**同一个** `planImport()` 算计划，所以预览说「跳过」就真的不会写；写的时候一次 `mutate` 提交全部，不会出现导入一半的便签簿。
4. **不能因为一条坏就整份失败**，也不能让一份超大文件把服务撑爆。

**怎么做的**

纯逻辑放在 `src/share.js`，路由只做 HTTP 形状：

```js
// 导出：只挑可分享的字段（不含运行时状态）
export function packBundle(notes, { ids } = {}) {
  return { format: '@kpeace/dsh-prompt-notes', version: 1, exportedAt: new Date().toISOString(),
           notes: picked.map(pick) }
}

// 预览与导入共用同一份计划
export function planImport(existing, incoming, strategy = 'rename') → { actions, counts, warnings }
```

判定顺序（每条便签）：
1. **同 id** → `skip` 不动 / `overwrite` 替换（保留原 id 与 createdAt）/ `rename` 换新 id 再当新便签处理；
2. **名字冲突**（MCP 名全局唯一；技能名在同一 scope+target 内唯一）→ `skip` / `overwrite`（换掉那一条）/ `rename`（`go-review` → `go-review-2`）；
3. 否则新建。

同一份文件里自己撞自己也要处理：新占用的名字立刻记进集合，所以文件里两条同名技能会变成 `go-review`、`go-review-2`。技能名的「占用」是个复合键 `${name}|${scope}|${target}`，而 MCP 名是纯名字——第一版把两者混用成一个 `Set` 直接查 `has(name)`，单测立刻抓到（技能的重命名永远不触发）。

另外 `parseBundle()` 把校验分两层：文件级（format / version / 体积 / 条数）错就整体拒绝；条目级走 `parseNoteInput`，坏的条目进 `dropped` 并带原因，好的照收。导入的 MCP 在这里就被改成 `enabled:false`，不依赖调用方记得。

**UI：只加一个入口**

标题行在「查看实际注入的文本」旁边多了一个图标（托盘 + 向上箭头），点开是一个弹层：

- 顶栏：`导出全部` / `复制` / 关闭
- 中间：一个等宽文本框（导出内容就填在这里，也可以直接粘贴别人的文件）
- 一行：`预览` + 冲突策略（重命名 / 跳过 / 覆盖）
- 预览结果：`新建 0 · 重命名 2 · 覆盖 0 · 跳过 0`，逐条动作与原因，MCP 的待执行命令行；被丢弃的条目数
- 底部：`确认导入`（没预览过是灰的）

新增文案 15 条，中英成对（`share / exportAll / shareHint / importPreview / importConfirm / conflictOn / sRename / sSkip / sOverwrite / badJson / importedN / actCreate / actRename / actOverwrite / actSkip / droppedN`）。没有新页签、没有新菜单结构。

**验证**

- 单测 41 → 50（`test/share.test.js` 8 条 + 路由 1 条）：格式/版本/体积/条数拒绝；坏条目丢弃好条目照收；MCP 强制未钉住；三种策略 × 三种冲突；同文件自撞；`applyImport` 一次性写；导出→导入回环；预览不写盘。
- 真实实例 `test/e2e/share.mjs`（15 项）：导出 → **删掉** → 预览（`create: 2` + 命令行）→ 导入 → 两张回来、MCP 未钉住、id 全新 → **导入的提示词出现在真实 `assemble()` 的 `prompt-notes:injected` 段** → 坏文件 400 且状态不变。
- 面板在真实右侧栏（542×766）里点了一遍：`导出全部` 得到 692 字节的 `@kpeace/dsh-prompt-notes` 文件（2 条），`预览` 显示 `新建 0 · 重命名 2 …`，`确认导入` 回 `已导入 2 条`（因为同 id，所以全是「重命名」——符合默认策略），弹层与正文区横向溢出均为 0。观感未经人眼确认。

**已知局限**：没有「只导出当前筛选 / 选中的那一张」的 UI（API 支持 `?ids=`，面板目前只做「全部」）；导入不保留来源与签名（谁分享的、是否被改过），这一点写进了 `store.js` 的 TODO。

**改动清单**：新增 `src/share.js`、`test/share.test.js`、`test/e2e/share.mjs`；`src/routes.js` 加三个端点；`client.js` 加 `ShareSheet` + 一个图标按钮 + 15 条中英文案；`package.json` 加 `e2e:share`；`demo/demo.html` 重建。

**下次从哪继续**：M6（稳健性与无障碍：软删除与撤销、200 条性能、数据文件损坏的真实恢复、键盘可达、reduced-motion、文案 key 一致性）。

---

## 2026-11-20 07:30–07:45 · M6 稳健性与无障碍

**问题是什么**

前面五个里程碑都在加功能，这一轮全是「让它别坏」和「让它能用键盘用」：删除是硬删（手滑就没了）、200 条便签会不会卡、数据文件被写坏会不会把实例带崩、纸条是「按钮里套按钮」（无效的嵌套交互元素）、页签和弹层只有鼠标能用、动画没有尊重系统的「减少动效」、中英文案可能悄悄对不上。

**① 软删除 + 撤销**（`src/store.js` / `src/mutations.js` / 路由 / 面板）

文件升到 v3，多一个 `trash` 区：

```json
{ "version": 3, "paused": false, "notes": [], "trash": [{ "deletedAt": "...", "note": {...} }] }
```

- `deleteNote` 不再把便签扔掉，而是 `doc.trash.unshift({ deletedAt, note })`；
- `restoreNote` 从 trash 里取回来（**同一个 id**，所以撤销之后位置不变）；
- `pruneTrash` 在读盘和写盘前都跑：只留最近 50 条、30 天内的。它只是「撤销」，不是归档。
- 面板：删除后出现一条 `已移入回收站 · <标题> 撤销` 的横幅，8 秒后自己消失；点撤销会 `POST /notes/:id/restore` 再刷新。
- MCP 便签进 trash 时，因为它已经不在 `notes` 里了，`reconcileMcp` 会顺带把子进程撤掉——「删除 = 停止」这条行为没变。

**② 200 条便签的度量**（真实实例，`test/e2e/robust.mjs`）

| 读的地方 | 200 条时 |
|---|---|
| `GET /state` | 中位 **3.6ms**（最大 4.5ms），响应 80.6 KB |
| 真实 `assemble()`（`GET /system`） | **6.2ms**，注入段 6000 字 |
| 纯函数 `planInjection(200)` | **0.07ms** |
| 纯函数 `describeNotes(200)` | **0.05ms** |

结论：200 条不需要虚拟滚动，也不需要缓存；只有 `renderSection` 的预算截断在起作用（200 条里只有 70 条塞进了 8000 字预算）。

**③ 数据文件写坏**（同一个 e2e）

把 `notes.json` 写成半截 JSON，真实实例的表现：
- 接口全部照常 200（便签簿按空处理），没有崩、没有卡住；
- 坏文件被备份成 `notes.json.corrupt-<时间>`（这一条以前只在单测里验证过，这次在真进程里确认）；
- 真实 `assemble()` 仍然答得出来（只是注入段为空）；
- 把文件修好，2 秒内 200 条全部回来。

**④ 无障碍：三个真问题**

1. **嵌套交互元素**：纸条原来是 `<div role="button">` 里面套着图钉 `<button>` —— 屏幕阅读器和键盘焦点都会错乱。改成：外层 `.pn-slip` 只负责旋转与投影，**纸面 `.pn-paper` 才是按钮**，图钉作为纸面的兄弟节点浮在上面。验证：`root.querySelectorAll('[role=button] button')` = 0。
2. **页签方向键**：整条 `role="tablist"` 接一个 `onKeyDown`，`←/→/Home/End` 切换并把焦点带到新页签（真机验证：`全部 → 全局 → 全部`，焦点跟着走）。
3. **弹层焦点陷阱**：`Sheet` 里按 Tab 到最后一个可聚焦元素时绕回第一个（Shift+Tab 反向），Esc 关闭。测试里踩到一个坑：用 `new KeyboardEvent('keydown', { key: 'Tab' })` 合成事件时**忘了 `cancelable: true`**，`preventDefault()` 无效，于是第一次测出来「陷阱没生效」——补上 `cancelable` 之后 `defaultPrevented=true`、焦点正确绕回。真实键盘事件本来就是可取消的，所以产品行为没问题，是测试写错了。

**⑤ prefers-reduced-motion**

加了一条回归测试：扫出所有声明了 `transition:` 的类，检查 `@media (prefers-reduced-motion:reduce)` 里都关掉了。它**当场抓到一个漏网的 `.pn-pin-shadow`**（图钉下的小阴影有 opacity 过渡），补上之后通过。

**⑥ 中英文案一致性**（`test/i18n.test.js`，4 条）

- 中英 key 集合必须完全相等；
- 代码里 `t("字面量")` 用到的 key 两侧都要有值；
- `t("mcpState_" + x)` 这种动态拼接的前缀，两侧都要有对应 key；
- 每条中英的 `{变量}` 要一致（否则切语言时数字就丢了），且不能是空串。

第一版把动态前缀也当成字面量查，报了一个 `mcpState_` 的假失败——正则里跳过以 `_` 结尾的 key 即可。

**测试自身踩到的两个坑**（都修了，值得记下来）

- `/system` 每个观察者有 3 秒缓存。最初这条度量先 `await` 一次 `/system` 就拿结果断言，于是偶尔读到上一轮的旧缓存，断言「注入段含标记」时随机失败。修法：用一个独立的 `?cwd=/tmp/pn-robust-perf` 换缓存键，并轮询到标记真的出现为止。
- 直接改写 `notes.json` 时，store 靠 `mtimeMs:size` 判断文件变过。连续两次写入若落在同一毫秒、大小又碰巧相同，它就不重读。修法：每次写盘后用 `utimesSync` 把 mtime 推后 1–3ms。

**验收**：单测 50 → 57；`smoke` 7/7、`scope` 24 项、`share` 15 项、`robust` 9 项全绿。真实面板里逐条点过：纸条没有一个嵌套按钮、页签方向键可用、弹层 Tab 绕回、删除后撤销把便签捡回来（2 → 1 → 2）。观感未经人眼确认。

**改动清单**：`src/store.js`（v3 + trash + prune）、`src/mutations.js`（软删除 / 恢复）、`src/routes.js`（restore 端点）、`client.js`（纸条结构、页签键盘、焦点陷阱、撤销横幅、reduced-motion 补漏、新文案 4 条）、`test/i18n.test.js`、`test/e2e/robust.mjs`、`test/host.test.js`（回收站两条）、`package.json`（`e2e:robust`）、`demo/demo.html` 重建。

**下次从哪继续**：M7（技能字段补全：`whenToUse`、调用策略）。

---

## 2026-11-20 09:06–09:18 · M7 技能字段补全（whenToUse + 调用策略）

**问题是什么**

技能便签原来只有「名字 + 一句描述 + 正文」。而 DSH 的技能注册表认两个更细的东西：

- `whenToUse`：一句话说明「什么时候该用我」，会进候选、进摘要，也出现在模型看到的技能目录里；
- `invocation: { modelInvocable, userInvocable }`：谁能调用它。注册表保留四种组合——给模型看的目录只列 `modelInvocable` 的，给人用的命令只列 `userInvocable` 的。以前我们把两个都硬编码成 true，等于替用户做了决定。

**怎么做的**（数据模型先改，UI 只加必要的两个控件）

`src/notes.js` 的 `validateKind('skill')` 多校验两个字段，并刻意**不把默认值写进文件**：

```js
const whenToUse = typeof s.whenToUse === 'string' ? s.whenToUse.replace(/\s+/g, ' ').trim() : ''
if (whenToUse.length > LIMITS.whenToUse) return fail(`「何时使用」超过 ${LIMITS.whenToUse} 字`)
…
note.skill = { name: s.name, description }
if (whenToUse) note.skill.whenToUse = whenToUse                 // 没写就不落盘
if (!modelInvocable || !userInvocable) note.skill.invocation = { modelInvocable, userInvocable }  // 两者都可调用是默认
```

两个都关掉会被拒（`至少要留一种调用方式`）——那种技能在两个面上都看不见，写进去只会让人困惑。

`skillCandidate()` 把它们带进候选（`whenToUse` 只在有值时出现，`invocation` 给默认值），`skillDefinition()` 复用同一份摘要，所以模型真正加载技能时看到的也是同一套策略。`/system` 的技能列表多回传 `whenToUse` / `userInvocable`，助手工具的 `note_create` 参数里也补了这两个字段。

编辑页只多了一个可选输入框（「何时使用（可选）」）和一个三选一的分段控件（两者 / 仅模型 / 仅用户），没有新增任何解释性句子——这条正好符合「少文字」。

**踩到的一个真问题：部分更新的合并语义**

`parseNoteInput` 对技能对象是「合并」而不是「替换」。于是第一版编辑页只送变化的字段，结果：
- 把「何时使用」清空 → 服务端合并回旧值，**永远删不掉**；
- 从「仅用户」切回「两者」 → 合并回旧策略，**改不回来**。

修法是编辑页**整体送这个技能对象**（名字、描述、whenToUse、invocation 全给），由服务端把默认值再剔除。助手工具那条路保留「没给就不动」的语义，想清空就显式给空串——这两条都写进了单测，免得下次又踩。

**验证**

- 单测 57 → 60：默认值不落盘；`whenToUse` 超长 / `invocation` 非布尔 / 两个都 false 都被拒；`skillCandidate` 与定义都带字段；助手工具建、改技能也能带这些字段（含「显式空串清空」）。
- 真实实例（`smoke.mjs` 8/8，多了一条）：建一张 `whenToUse = "when <mark>"`、`{ modelInvocable:false, userInvocable:true }` 的技能便签，真实 `skills.list` 回 `whenToUse`、`modelInvocable=false`、`userInvocable=true`。
- 面板里（真实右侧栏）点了一遍：编辑页出现「何时使用」输入框与三选一控件（0 溢出）；选「仅用户」保存后文件里多了 `invocation`、真实技能列表变 `modelInvocable:false`；再清空并切回「两者」，文件里两个字段都被剔除、列表恢复 `true/true`。观感未经人眼确认。

**没验证的**：注册表按 `modelInvocable` 过滤「模型看到的技能目录」这一层没有单独断言（`/system` 不暴露那一份目录文本）。我们验证到的是「字段真的进了注册表的候选与摘要」——过滤是 `dsh-skill` 自己的职责，它的 README 写明了四种组合的语义。

**改动清单**：`src/notes.js`（校验 + 候选/定义 + LIMITS.whenToUse）、`src/system.js`（回传字段）、`src/tools.js`（技能 schema + 回执）、`client.js`（两个控件 + 4 条中英文案 + 整体送技能对象）、`test/host.test.js`、`test/tools.test.js`、`test/e2e/smoke.mjs`、`demo/demo.html` 重建。

**下次从哪继续**：M8（打包与文档：文件清单、README 中英、CHANGELOG、版本 0.3.0）。

---

## 2026-11-20 晚 · M8 打包与文档 + M9 最终回归与最终报告

### M8 打包与文档

**① 包里装的东西对不对。** `npm pack --dry-run` 列出 21 个文件，没有 `dev/`、`demo/`、`test/`、`scripts/`，有 `src/`、`docs/`、`locale/`。光看清单不够，又做了一个更硬的检查：真的打成 `.tgz`，解到 `/tmp` 里一个**没有 node_modules、不在仓库里**的目录，直接 `import('index.js')` 与 `src/notes.js`——都成功，说明 `index.js` 没有偷偷依赖包外的文件。

**② 文档比代码旧一整天。** README、`locale/*.json`、`docs/preview.svg` 的修改时间都是昨晚 23:05，**早于 M1–M7**。所以文档没提：助手工具、导入导出、回收站、技能字段、MCP「只在有活动会话时才启动」，预览图画的还是有胶带、回形针的旧外观。已全部重写，并且按「少文字」原则收紧（中文 README 89 → 83 行；英文 79 → 83 行，因为补了四个功能的说明）。每条事实都对过实现或 e2e：备份后缀 `.corrupt-` / `.invalid-`、8 秒撤销、保留 50 条 / 30 天、拒绝外来文件、导入的 MCP 一律未钉住。

**③ 顺手发现的一个真问题：工具描述对模型撒了谎。** 助手工具 `note_delete` 的描述写的是 *"Permanent: the note stops being injected"*（永久删除）。但 M6 之后删除是**软删除**——便签进了 `trash`，面板给 8 秒撤销。工具描述是给模型看的，模型会据此向用户保证「删了就没了」，这是错的。修法是改描述，并加一条测试把「工具删除 = 进回收站」钉住，以后行为再变，描述就不会悄悄失真：

```js
// src/tools.js
description: 'Delete one note by id. It stops being injected / registered immediately. It goes to a trash the user can undo from; the assistant cannot restore it.',

// test/tools.test.js
assert.deepEqual(store.snapshot().trash.map((t) => t.note.id), [made.note.id])
assert.doesNotMatch(byName.note_delete.description, /permanent/i)
assert.match(byName.note_delete.description, /trash/i)
```

**④ 版本与发布物**：版本 0.3.0；新增 `CHANGELOG.md` 并加进 `files`；`cordis.patch.yml` 的注释补上了 `mcp` / `pollMs` / `enabled` 三个配置项（原来只写了三个）；locale 简介与实际功能对齐。

### M9 最终回归

**一个测试环境的缺陷，差点让回归卡住——前因后果：**

`scripts/e2e.sh start` 用来启动隔离的测试 DSH 实例。我用它时反复出现「命令十分钟都不返回」。夜里我以为是「实例没脱离调用方」，加了 `setsid` 就当修好了；今天又卡了一次，才查到真正的原因：

```bash
# 旧写法
( cd "$DIR" && env … perl … web --port 48990 < /dev/null >> LOG 2>&1 & echo $! > PID )
```

shell 里 `A && B &` 的意思是「把**整条 `A && B`** 放进后台」，而重定向 `< /dev/null >> LOG` 只套在最后一个命令上。结果后台里多出一个子 shell（`ps` 里显示成 `bash ./scripts/e2e.sh start`，父进程已死、被 1 号进程收养），它的标准输出**仍然是调用方的管道**，而且它要陪着实例一直活下去。凡是用 `start | sed …` 这种管道接输出的人，管道的写端一直有人拿着，永远等不到「结束」——于是整条命令挂住。用文件接输出就没事，这也是为什么夜里没暴露。

修法：重定向挂在整个子 shell 上，并用 `exec` 让子 shell 直接「变成」实例，不留中间人：

```bash
# 新写法
( cd "$DIR" && exec env … perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' "$NODE" "$CLI" web --no-open --port "$PORT" \
  ) < /dev/null >> "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"
```

验证：同样用管道接输出，`start` 3 秒返回；`ps` 里没有残留 shell；记录的 pid 与端口上实际监听的 pid 一致（都是 94618）。

**回归结果**（全部是针对隔离实例 `/tmp/pn-test-home`、端口 48990 的真实运行）：

| 项目 | 结果 |
|---|---|
| 单测 | 60 / 60 |
| 语法检查 `npm run check` | 通过 |
| `smoke`（提示词、技能、MCP 三通道 + 总开关 + 删除） | 8 / 8 |
| `scope`（会话 / 工作区作用域，会话级技能与 MCP，重启与恢复） | 24 / 24，另有 1 条 SKIP（见下） |
| `share`（导出 → 删除 → 预览 → 导入回环，外来文件被拒） | 15 / 15 |
| `robust`（200 条便签、数据文件写坏、修好后恢复） | 8 / 8 |
| `demo` 构建 | 225 KB，成功 |
| `npm pack` | 21 个文件，解出后独立可加载 |

两处核对：
- 实例日志里有 **1 条** `[prompt-notes]` 警告：`notes file unreadable … starting empty; a copy was kept`。这是 `robust` 故意把数据文件写坏时，插件按设计打的——不是错误。没有任何 `without inject`。
- `robust` 实际只有 **8** 项检查（源码里 8 个 `check(`）。M6 条目里写的「9 项」是我数错了，以此为准。

200 条便签的性能（三次运行，随机器负载浮动）：`GET /state` 中位数 3.6 / 8.3 / 4.9 毫秒，真实 `assemble` 4.5–6.2 毫秒。结论不变：不需要虚拟滚动或缓存。

---

## 最终报告（给不看代码的人）

### 这个插件是什么

DSH 右侧栏里的「便签」：一本便签簿，把你想让模型**一直记住**的东西放上去。三种便签——**提示词**（一段规则）、**技能**（模型按需加载的一份说明）、**MCP**（给模型接上一个外部工具服务）。每张便签有一枚图钉，钉上就生效；每张可以选**作用域**：所有会话、某个工作区目录里的会话、或某一个会话。「系统」页把 DSH 自己已经注入的内容也摆出来（只读），可以一键复制成自己的便签。

没有便签时什么都不注入，装上不会改变任何一次请求。

### 做了什么（M1–M9）

| 里程碑 | 一句话 |
|---|---|
| M1 | 在真实会话里验证作用域，修掉 3 个只有真实系统才暴露的 bug |
| M2 | MCP 只在有适用的活动会话时才启动，不适用的会话看不到它的工具 |
| M3 | 外观更简约、文案更少 |
| M4 | 助手工具：能列出 / 创建 / 修改 / 删除便签（助手建的 MCP 一律不启用） |
| M5 | 导入 / 导出（先预览再确认；导入的 MCP 一律不启用） |
| M6 | 删除可撤销；200 条不卡；数据文件写坏不崩；键盘可用 |
| M7 | 技能可设「何时使用」与调用方 |
| M8 | 包清单、文档、版本 0.3.0、CHANGELOG |
| M9 | 最终回归，以及上面那个测试环境缺陷的修复 |

### 真实验证过的（不是只有单测）

在一个**与你的 DSH 完全隔离的真实 DSH 实例**里验证（它的数据在 `/tmp`，端口 48990，不碰你的 profile 和 52559）：
- 提示词确实出现在真实组装的 system prompt 里；技能确实出现在真实技能目录里；MCP 确实连上并出现在真实工具列表里；
- 会话级、工作区级便签只对适用的会话生效；不适用的会话看不到 MCP 工具；
- 重启实例、会话变「冷」再恢复，会话级技能和 MCP 会重新挂上；
- 导出再导入能回环，外来文件被拒绝；
- 200 条便签、数据文件写坏、修好后恢复。

### 没有验证的（诚实清单）

1. **外观没有人眼确认。** 做这件事的模型看不了图，只做了尺寸、溢出、对比度（纸上文字 ≥ 4.5:1）的度量。请你亲眼看一下，尤其是浅色主题。
2. **`tools.guard` 的拒绝分支**（会话 A 的模型去调只属于会话 B 的 MCP 工具时被拦下）没有用真实的模型工具调用验证，只有单测。夜里的 e2e 里这一条是 SKIP。主要防线是「工具根本不出现在列表里」（这一条是真实验证过的），guard 只是兜底。
3. 注册表按 `modelInvocable` 过滤「模型看到的技能目录」这一层，没有单独断言；验证到的是字段真的进了注册表。
4. 你自己的 profile 里装的是链接版本，加载的是 14:19 那次重启时的代码；之后只改了 `note_delete` 的描述（Host 半体）。

### 已知局限

- 隐藏 MCP 工具有最多 2 秒延迟：MCP 刚连上、或会话刚切换目录的瞬间，不适用的会话可能短暂看到它的工具（调用仍会被拒）。
- 助手创建的**提示词**便签默认钉住（下一次会话就会注入），因为在面板里一眼可见、可删；只有 MCP 被强制不钉住。
- 工作区路径是纯字符串比较，不解析符号链接（如 macOS 的 `/tmp` 与 `/private/tmp`）。

### 给你的下一步

1. **重启 DSH**（Host 半体只在启动时加载），刷新页面，在右侧栏找「便签」。你现有的 3 张便签（都是提示词、全局、已启用）在 `~/.dsh/prompt-notes/notes.json` 里，数据文件已经是 v3，不需要迁移，也不会丢。
2. 亲眼看一下外观，不满意的地方告诉我具体哪里。
3. 想看效果先不装：双击 `demo/demo.html`（单文件，模拟后端）。

### 没做、也不建议现在做的

- 把 `dev/` 提交进仓库：它是开发过程记录。**我没有执行任何 git 操作**，所有改动都在工作区里，你来决定提交什么。
