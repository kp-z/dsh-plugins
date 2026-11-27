# 真机核对清单（可复跑）

本文件的每一条都在 **2026-11-28 03:17–03:24（CST）** 的测试宿主上真跑过一遍；数字是实测，
跑不通的地方写原因，不修数字。

## 0 环境与前置

| 项 | 值 |
| --- | --- |
| Web | http://127.0.0.1:3190 |
| 桥 | http://127.0.0.1:7791 |
| 正式 Desktop | 7788（**本轮未触碰、未重启**） |
| 宿主进程 | pid 4895（`lsof -nP -iTCP -sTCP:LISTEN` 同时持有 3190/7791） |
| 世界 | `world-1nb10jy-b`，`seed=3586027534` |
| 世界 tick | 开跑 13806（第 10 天） → 收工时 17203（第 12 天）；`runtime.diagnostics.resets=0` |
| 状态目录 | `packages/dsh-xcity/.testhome/profiles/xcity-3/state` |

命令目录约定：除第 8 条在仓库根执行外，其余都在包目录下执行。

```bash
cd packages/dsh-xcity
```

只读约定：除 `npm run build` / `npm test`（会重建 `lib/`）外，其余命令都是只读 GET/POST，
不写世界、不派单、不启进程。构建与测试期间宿主没有中断（tick 一路推进，`resets=0`）。

## 1 构建与全量测试

**目的**：确认 `src/` 能编译、全量单测无红。

**命令**

```bash
npm run build
npm test
```

**期望**：两条都退出码 0；`node --test` 的 `fail` 为 0。

**实测**

| 命令 | 退出码 | 关键输出 |
| --- | --- | --- |
| `npm run build` | 0 | `tsc -p tsconfig.json && node scripts/build-assets.mjs` → `[build] vendor + client.iife.js 已同步到 lib`，无 tsc 报错 |
| `npm test` | 0 | `tests 1039 / pass 1038 / fail 0 / skipped 1 / cancelled 0 / todo 0 / duration_ms 7015.87` |

`npm test` 是 `npm run build && node --test test/`，所以构建跑了两次（都成功）。

跳过的那 1 条：

```
test/slowvale-stage.test.js:19  t.skip('没有静态站，跳过：' + String(error))
⇒ 舞台：位置朝目标前进，且会换场景 … TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received undefined
```

即环境缺静态站资产，不是本轮改动引起的失败。

**判定**：✅

## 2 世界推进

**目的**：确认世界真的在跑（tick 单调不减、没暂停）。

**命令**

```bash
curl -s -o /tmp/w1.json http://127.0.0.1:3190/agent-world/api/world
sleep 5
curl -s -o /tmp/w2.json http://127.0.0.1:3190/agent-world/api/world
node -e 'const fs=require("fs");for(const f of ["/tmp/w1.json","/tmp/w2.json"]){const j=JSON.parse(fs.readFileSync(f,"utf8"));console.log(f,"tick="+j.world.tick,"paused="+j.world.paused,"running="+j.runtime.running)}'
```

**期望**：两次 `tick` 单调不减（100ms/tick 下 5s 约 +50）；`running=true`。

**实测**

```
/tmp/w1.json tick=17154 paused=false running=true
/tmp/w2.json tick=17203 paused=false running=true
```

另一次 5s 采样（同法）：`16626 → 16675`，`elapsedSec=5.01`，`tickDelta=49`，`monotonic=true`，
`running` 两次都是 true，`runtime.diagnostics.ticks 5326 → 5375`，`agents=9`，`tasks=3`，`tickMs=100`。

字段位置提醒：`running` 不在 `world` 里，在响应顶层 `runtime.running`（`src/routes/api.ts:351`）；
`world` 侧对应的信号是 `paused`。

**判定**：✅

## 3 三工单闭环

**目的**：确认三张工单都有人做、做完了、有交付文字。

**命令**

```bash
node tools/verify-tasks.mjs --base http://127.0.0.1:3190 --bridge http://127.0.0.1:7791
```

**期望**：`ok:true`；每张任务都有 `owner`、状态 `done`、`output` 非空；stderr 为空。

**实测**（退出码 0）

```
ok: true, ticks: 13908, byStatus: { done: 3 }
task-1 盘点小镇现状  owner=agent-1  outputHead=已盘点：tick=1001，3人全在岗，26站点占3，3张工单呈串行依赖链…
task-2 核对工单状态  owner=agent-2  outputHead=全板无失败/死锁单：task-2 的 0% 是会话代跑机制非卡死…
task-3 出巡检结论    owner=agent-1  outputHead=巡检结论已交付：task-1/2 完成、task-3 收口，链条正常但工单供给是瓶颈…
```

9 个 agent 的 `skills` 从 `/agent-world/api/personas` 读到了（agent-1 三个技能、agent-4..9 各 3-4 个），
`commitments` 计数：agent-1/2 各 12，agent-3 13，agent-4 1，其余 0。

**判定**：✅

## 4 三日记忆链

**目的**：确认"第 1–3 天有日小结 + 情节都有证据 + 承诺兑现/违约都有记录"。

**命令**

```bash
node tools/verify-memory-chain.mjs --base http://127.0.0.1:3190 --days 3
```

**期望**：`ok:true`（D1..D3 日小结各一条、抽查全对、kept/missed 都 ≥1）。

**实测：失败（退出码 1）**

```
VERIFY FAIL digest-missing · 卡在: agent-1 缺 D1,D2,D3 · agent-2 缺 D1,D2,D3 · … · agent-9 缺 D1,D2,D3
  · base http://127.0.0.1:3190 · state …/packages/dsh-xcity/.testhome/profiles/xcity-3/state
```

9 个 agent 全部"缺 D1,D2,D3"。原因不是记忆链坏了，是**窗口对不上**：

- 记忆按天裁剪，只留最近 7 天：`EPISODE_KEEP_DAYS = 7`（`src/sim/memory.ts:12`），
  `pruneEpisodes` 保留 `dayOf(now) - 7 + 1` 之后（`src/sim/memory.ts:91-94`）；
- 宿主已跑到第 11 天，实测各角色 `episodes.kind='day'` 只在 D5–D10（agent-1..3）、D8–D10（agent-4..8）、
  D9–D10（agent-9）——D1–D4 已被裁掉；
- 脚本固定查 D1..D{--days}（`tools/verify-memory-chain.mjs:117-119`），所以 `--days 3` 在一个跑了 11 天的世界上必然 missing。

**补充核对（非卡面命令）**：把同一套判定（日小结齐不齐 / 抽查证据 / 承诺分布）搬到**保留窗口**上跑。
做法：Node 读 `GET /agent-world/api/world` + `state/events.jsonl`（只认最后一代、同角色 ±2 tick 或活动区间 ±1），
脚本 98 行，本轮放在 `/tmp/xcity-memchain-window.mjs`（未入库）。实测（`tick=16920`，第 12 天，窗口 D9–D11）：

```
digests:  checked 27 / missing 0
samples:  total 81 / matched 81 / mismatches 0
promises: kept 30 · missed 2 · released 10 · open 2
events:   67026 行 / 最后一代保留 6759 条 / 11 代 / tickRange [8,16899] / 索引 9 个 agent
```

另一条内部一致性（一条命令，可原样跑）：日小结文字必须由当天真实情节计数得来，
逐字比对"小结文字 vs 按情节重算"——在第 11 天（窗口 D8–D10）实测 **26/27 逐字一致**，
唯一例外是 agent-9 的 D8：那天它还不存在、0 条情节，按 `writeDayDigest` 的规则本来就不该有小结。

```bash
node --input-type=module -e 'const j=await(await fetch("http://127.0.0.1:3190/agent-world/api/world")).json(),w=j.world,DAY=1440,dayOf=t=>Math.floor(Math.max(0,t)/DAY)+1,now=dayOf(w.tick),win=[now-3,now-2,now-1],LABEL={meal:"吃了顿饭",sleep:"睡了一觉",rest:"歇了一会儿",social:"和人聊了聊",work:"干活",study:"学习"};const rows=[];for(const a of w.agents??[]){for(const d of win){const eps=a.episodes??[],d1=eps.find(e=>e.kind==="day"&&e.day===d),mine=eps.filter(e=>e.day===d&&e.kind!=="day"),c=new Map();for(const e of mine){const l=LABEL[e.kind]??e.kind;c.set(l,(c.get(l)??0)+1)}const exp=[...c.entries()].sort((x,y)=>y[1]-x[1]).map(([l,n])=>l+"×"+n).join("、"),act=d1===undefined?null:String(d1.summary).replace(/^第\d+天：/,"");rows.push({agent:a.id,day:d,ok:d1!==undefined&&act===exp,episodes:mine.length,expected:exp,actual:act})}}const bad=rows.filter(r=>!r.ok);console.log(JSON.stringify({tick:w.tick,window:win,checked:rows.length,ok:bad.length===0,failures:bad},null,1))'
```

注：窗口随世界推进而滑动，重跑会得到不同天数区间，这是正常的；判定只看 `ok` 与 `failures`。

**判定**：❌（卡面命令，原因如上）／✅（保留窗口内的机制）

## 5 并发与重连

**目的**：9 人同场时 tick 不停、不抢座、人数稳定、断线重连能续上。

**命令**

```bash
node tools/verify-scale.mjs --base http://127.0.0.1:3190 --bridge http://127.0.0.1:7791 --agents 9 --seconds 20
```

**期望**：`ok:true`；`stalls=0`、`seatConflicts=0`、`agentCountStable=true`、`reconnect.ok=true`。

**实测**（退出码 0）

```
ok: true            ticksPerSecond: 9.8     stalls: 0     seatConflicts: 0
agentCountStable: true   agentCount: 9      samples: 21   failedSamples: 0
tickRange: [14645, 14841]
reconnect: ok=true advanced=true  baseline {seq:1115} → after {seq:1116}  frames 4 → 2  epoch 未变
notes: ["起点 9 人，9 人已坐下"]
```

`--agents 9` 与实测世界人数一致（9），所以没有出现"人数不符"的 note。

**判定**：✅

## 6 token 成本

**目的**：给出每轮/每天模型输出侧成本量级。

**命令**

```bash
node tools/measure-tokens.mjs
```

**期望**：`ok:true`，输出 `perSession` / `perAgentDay` / `totalPerDay`。

**实测**（退出码 0）

```
days: 9.95（daysSource=api，即 world.tick/1440）    sessionsSeen: 57
turns: 376    toolCalls: 116    estTokens: 73788    totalPerDay: 7419
```

| 角色 | 会话数 | 轮次 | estTokens | tokens/天 | initiative 次数 | 次/天 |
| --- | --- | --- | --- | --- | --- | --- |
| agent-1 | 20 | 124 | 21219 | 2133 | 140 | 14.08 |
| agent-2 | 19 | 139 | 31252 | 3142 | 133 | 13.37 |
| agent-3 | 18 | 113 | 21317 | 2143 | 134 | 13.47 |

口径（脚本自述）：`estTokens = ceil(assistantChars / 4)`，只算模型**输出**侧
（text + reasoning + tool-call 参数），不含输入上下文，**是粗估上界，不是计费值**。
agent-4..9 没有会话日志（`sessions/` 里只有 agent1–3），所以不进统计。

**判定**：✅

## 7 头顶对话

**目的**：`POST /api/xcity/say` 之后，前端按 `bubble.float_up` 渲染头顶气泡，且不报 `visual_playback`。

**命令 A（包断言，可原样跑）**

```bash
cat > /tmp/xcity-say-check.mjs <<'EOF'
// 订阅桥上的事件流 → POST 一句头顶对话 → 解出 visual 包，断言走的是 bubble.float_up
// 用法：node /tmp/xcity-say-check.mjs [bridge] [roleId] [text]
const bridge = (process.argv[2] ?? 'http://127.0.0.1:7791').replace(/\/+$/, '')
const roleId = process.argv[3] ?? 'agent-1'
const text = process.argv[4] ?? '清单自检'
const { gunzipSync } = await import('node:zlib')

const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 12000)
const res = await fetch(bridge + '/api/game/stream', { headers: { accept: 'text/event-stream' }, signal: controller.signal })
if (!res.ok || res.body === null) throw new Error('/api/game/stream → HTTP ' + res.status)
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
const frames = []
let sayResult = null
let sayAwaited = false
const posted = fetch(bridge + '/api/xcity/say', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ roleId, text }),
}).then((r) => r.json())

try {
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let cut = buffer.indexOf('\n\n')
    while (cut !== -1) {
      const raw = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      cut = buffer.indexOf('\n\n')
      const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')
      if (data === '') continue
      let envelope = null
      try { envelope = JSON.parse(data) } catch { continue }
      frames.push(envelope)
      if (!sayAwaited) { sayAwaited = true; sayResult = await posted }
      if (envelope.kind === 'visual' && typeof envelope.payload_gz === 'string') {
        const packet = JSON.parse(gunzipSync(Buffer.from(envelope.payload_gz, 'base64')).toString('utf8'))
        const beats = packet?.playback?.tracks?.[roleId] ?? []
        const beat = beats[0] ?? {}
        const out = {
          ok: beat?.bubble?.float_up === true && beat?.bubble?.text === text && beat.dialogue === undefined && beat.body === undefined,
          sayResult,
          tick_marker: envelope.tick_marker,
          packet_tick_marker: packet.tick_marker,
          playbackKind: packet?.playback?.kind,
          beat,
          frameKinds: [...new Set(frames.map((f) => f.kind))],
        }
        clearTimeout(timeout)
        controller.abort()
        console.log(JSON.stringify(out, null, 1))
        process.exit(out.ok ? 0 : 1)
      }
    }
  }
} catch (error) {
  if (error.name !== 'AbortError') throw error
}
clearTimeout(timeout)
console.log(JSON.stringify({ ok: false, reason: 'no-visual-frame', sayResult, frameKinds: [...new Set(frames.map((f) => f.kind))] }, null, 1))
process.exit(1)
EOF

node /tmp/xcity-say-check.mjs http://127.0.0.1:7791 agent-1 "清单自检"
```

**实测输出**（退出码 0）

```json
{
 "ok": true,
 "sayResult": { "ok": true },
 "tick_marker": "tick-16194",
 "packet_tick_marker": "tick-16194",
 "playbackKind": "independent",
 "beat": { "bubble": { "text": "清单自检", "float_up": true } },
 "frameKinds": [null, "visual"]
}
```

即：`playback.kind=independent`、信封与包内 `tick_marker` 一致、第一拍就是 `bubble.float_up`，
没有 `dialogue` 也没有 `body`。

**命令 B（前端运行时）**：浏览器打开 `http://127.0.0.1:7791/world/w1?role_id=agent-1`，
在控制台装钩子后发一句，5s 后读回：

```js
window.__sayCheck = { texts: [], errors: [] };
const T = window.Phaser.GameObjects.Text.prototype;
const orig = T.setText;
T.setText = function (v) { try { window.__sayCheck.texts.push(String(v)); } catch (e) {} return orig.call(this, v); };
window.addEventListener('error', (e) => __sayCheck.errors.push('error:' + (e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => __sayCheck.errors.push('rejection:' + ((e.reason && e.reason.message) || e.reason)));
const ce = console.error;
console.error = function (...a) { __sayCheck.errors.push('console.error:' + a.map((x) => (x && x.message) || String(x)).join(' ')); return ce.apply(console, a); };
```

```bash
curl -s -X POST http://127.0.0.1:7791/api/xcity/say -H 'content-type: application/json' \
  -d '{"roleId":"agent-1","text":"自检气泡7019"}'
```

**实测**：`{"ok":true}`；5s 后页面内读到
`rendered: ["自检气泡7019"]`（Phaser Text 里真的出现了这句 → 气泡被创建）、
`errorCount: 0`（window.error / unhandledrejection / console.error 三路钩子都没抓到东西）。

关于 `visual_playback`：前端快照里这个名字只出现 **1 次**，是错误上报器的 stage 标签
（`GameView-BxeQpG1q.js`：`onPlaybackFailed` → `gn(…, { stage: "visual_playback", … })`），
不是包字段；`float_up` 的渲染入口是同一文件里的
`g.bubble?.text && g.bubble.float_up && this.sprite && this._spawnFloatText(ln(g.bubble.text))`。
所以"不报 visual_playback"等价于上报器没被触发——上面 `errorCount: 0` 就是在验这一点。

**判定**：✅

## 8 前端零改动

**目的**：确认本轮没有改 Slow Vale 前端镜像（`slowvale-mirror/`）。

**命令**（仓库根执行）

```bash
cd ../..
git diff --name-only | grep -i slowvale-mirror || echo "(no match: 0 行)"
git diff --name-only | wc -l
git ls-files slowvale-mirror | wc -l
git status --porcelain --untracked-files=normal slowvale-mirror
find slowvale-mirror -newermt '2026-11-28 00:00:00' -type f | wc -l
```

**期望**：第一条无输出（0 行）；`slowvale-mirror` 不出现在任何已跟踪改动里。

**实测**

```
(no match: 0 行)
46                      # git diff --name-only 总行数，全在别的包（dsh-cove-task / dsh-spellbook …）
0                       # git ls-files slowvale-mirror —— 该目录整体未被跟踪
?? slowvale-mirror/     # 只是一个未跟踪的镜像检出
0                       # 今天（11-28 00:00 之后）该目录被改动的文件数
```

最新 mtime 是 `2026-11-27 11:20`（上一轮的镜像同步，共 9 个文件），本轮没有文件被动过。

注意：`git diff` 看不到未跟踪目录，所以单靠第一条不足以证明"前端没动"；
`git ls-files`（0）+ `find -newermt`（0）才是这条的实证。

**判定**：✅

## 汇总

| # | 项 | 退出码 | 判定 | 关键数字 |
| --- | --- | --- | --- | --- |
| 1 | 构建 + 全量测试 | 0 / 0 | ✅ | 1039 tests / 1038 pass / 0 fail / 1 skip（缺静态站） |
| 2 | 世界推进 | 0 | ✅ | tick 16626→16675（5.01s，Δ49），running=true，paused=false |
| 3 | 三工单闭环 | 0 | ✅ | 3/3 done，owner+output 齐 |
| 4 | 三日记忆链 | 1 | ❌ 卡面命令 / ✅ 保留窗口 | missing D1–D3 ×9（保留期 7 天）；D9–D11：27/27 小结、81/81 证据、kept 30 / missed 2 |
| 5 | 并发与重连 | 0 | ✅ | 9 人、stalls 0、抢座 0、重连 seq 1115→1116 |
| 6 | token 成本 | 0 | ✅ | 9.95 天 / 57 会话 / 376 轮 / 73788 estTokens / 7419 per day |
| 7 | 头顶对话 | 0 | ✅ | bubble.float_up 落到页面 Phaser Text，errorCount 0 |
| 8 | 前端零改动 | 0 | ✅ | diff 0 行、未跟踪目录 0 改动文件 |

## 需要决定的两件事

1. **`--days` 语义与保留期冲突**（影响第 4 条能否在任何时候通过）：
   `verify-memory-chain.mjs` 查的是 D1..D{--days}，而记忆只留最近 7 天。
   宿主跑到第 8 天以后，这条命令必然失败。要么改成"最近 N 天"，要么在工具头部写明"只用于刚跑满 N 天的新世界"。
2. **1 条测试常年 skip**（`test/slowvale-stage.test.js:19`，缺静态站）：
   要么补静态站 fixture 让它真跑，要么把 skip 原因写进验收口径，避免以后把"skipped 1"当成噪音忽略。
