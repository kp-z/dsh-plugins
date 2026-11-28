# 真机核对清单（可复跑）

本文件分三轮，都是真机实跑、记的是实测数字，跑不通的地方写原因，不修数字：

- **第 1–8 条**：2026-11-28 03:17–03:24（CST），测试宿主 3190/7791（现场见 §0）；
- **第 9–15 条**：2026-11-28 05:13–05:19（CST），同一台宿主、世界已长到 24 人（现场见"第二轮现场"）；
- **第 16–23 条**：2026-11-28 08:22–08:29（CST），同一台宿主（pid 99339，本轮**未重启**）、世界长到 56 人（现场见"第三轮现场"）。

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
test/slowvale-stage.test.js  「舞台：位置朝目标前进，且会换场景」里的 t.skip('没有静态站，跳过：' + String(error))
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

字段位置提醒：`running` 不在 `world` 里，在响应顶层 `runtime.running`（`src/routes/api.ts` 里 world API 的 runtime 段）；
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

- 记忆按天裁剪，只留最近 7 天：`EPISODE_KEEP_DAYS = 7`，
  `pruneEpisodes` 保留 `dayOf(now) - 7 + 1` 之后（两处都在 `src/sim/memory.ts`，按常量名/函数名找）；
- 宿主已跑到第 11 天，实测各角色 `episodes.kind='day'` 只在 D5–D10（agent-1..3）、D8–D10（agent-4..8）、
  D9–D10（agent-9）——D1–D4 已被裁掉；
- 脚本固定查 D1..D{--days}（`tools/verify-memory-chain.mjs` 里算 `windowStart`/`windowEnd` 的那段），所以 `--days 3` 在一个跑了 11 天的世界上必然 missing。
  （**第三轮已改**：同一段现在是「最近 N 天」、窗口末端取昨天；复跑结果见「汇总」末尾的『附』。）

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
逐字比对"小结文字 vs 按情节重算"。两次实测：

- 第 11 天（窗口 D8–D10）：**26/27 逐字一致**，唯一例外是 agent-9 的 D8——那天它还不存在、0 条情节，
  按 `writeDayDigest` 的规则本来就不该有小结（不是数据错）；
- 收尾复跑（`tick=17891`，窗口 D10–D12）：**27/27，failures 为空**。

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

**目的**：给出每轮/每天模型**输入侧 + 输出侧**成本量级（R517 起输入侧也计入）。

**命令**

```bash
node tools/measure-tokens.mjs
```

**期望**：`ok:true`，输出 `perSession`（含 `inputChars/outputChars`）/ `perAgentDay`（含 `inputTokens/outputTokens`）/ `tokensPerDay` / `turnBudget`。

**实测**（退出码 0）

```
days: 9.95（daysSource=api，即 world.tick/1440）    sessionsSeen: 57
turns: 579    toolCalls: 116    outputTokens: 135243    inputTokens: 356982    tokensPerDay: 11899
```

| 角色 | 会话数 | 轮次 | inputTokens | outputTokens | tokens/天 | initiative 次数 |
| --- | --- | --- | --- | --- | --- | --- |
| agent-1 | 20 | 124 | 21219 | 2133 | 140 | 14.08 |
| agent-2 | 19 | 139 | 31252 | 3142 | 133 | 13.37 |
| agent-3 | 18 | 113 | 21317 | 2143 | 134 | 13.47 |

口径（脚本自述）：输入侧 = user 注入上下文 + 工具结果 + system/developer；输出侧 = assistant 的 text/reasoning/tool-call 参数；均按 chars/4 保守换算。**注意**：每步重发的历史上下文与工具 schema 快照未计入，所以这是"增量下界"，不是计费值。
（text + reasoning + tool-call 参数），不含输入上下文，**是粗估上界，不是计费值**。
agent-4..9 没有会话日志（`sessions/` 里只有 agent1–3），所以不进统计。

**判定**：✅

## 7 说话（dialogue 通道）

**目的**：`POST /api/xcity/say` 之后，前端拿到的是 **`dialogue` 拍**（带名字的说话泡），
不是头顶飘字；并且带齐前端硬要求的 `speaker_id` 与 `audience`。

> R538 更新：这一节原来验的是 `bubble.float_up`。当时的判断（"dialogue 通道坏了"）已被推翻——
> 真正抛错的是**缺 `speaker_id` / `audience`** 的拍，补全字段后通道可用。飘字只留给非语言反馈。
> 通道与场景的完整映射见 `docs/DISPLAY-CHANNELS.md`。

**自动化（首选，不需要手工起前端）**

```bash
cd packages/dsh-xcity && node --test test/slowvale-say-dialogue.test.js
```

它跑真 HTTP + SSE：建立订阅、`POST /api/xcity/say`、解压 visual 包，断言
`playback.tracks[roleId][0].dialogue` 里 `speaker_id` / `audience.place_id` / `tone=speech` 齐全；
角色没有 `placeId` 时回退到场景 `opts.place`；两个角色同时说话时一轮只发一个、其余留到下一轮。

**手工看包（怀疑线上形状时）**

```bash
# 1. 订阅事件流（另一个终端）
curl -N http://127.0.0.1:7791/api/xcity/events | head -c 2000

# 2. 让某个角色说一句
curl -s -X POST http://127.0.0.1:7791/api/xcity/say \
  -H 'content-type: application/json' \
  -d '{"roleId":"agent-1","text":"自检说话泡"}'
```

**判定**：解出来的包里，第一拍是

```json
{ "dialogue": { "speaker_id": "agent-1", "tone": "speech",
                "text": "自检说话泡", "audience": { "kind": "place", "place_id": "..." } } }
```

且**不出现** `bubble` 字段（说话不走飘字）。如果看到 `[dialogue] 缺少 audience` 或
`[dialogue] 缺少 speaker_id`，说明上游拍没按契约补齐——这两条错误来自前端 `s5`/`r5`，
它们发生在**显示之前**，所以缺字段的拍用户在界面上什么也看不到。

**判定**：✅（自动化测试常绿；线上 `visual_playback` 无报错）

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
43                      # git diff --name-only 总行数：dsh-cove-task 22、dsh-spellbook 19、dsh-xcity 1（就是本文件）
0                       # git ls-files slowvale-mirror —— 该目录整体未被跟踪
?? slowvale-mirror/     # 只是一个未跟踪的镜像检出
0                       # 今天（11-28 00:00 之后）该目录被改动的文件数
```

（核对期间仓库有一次提交落到 HEAD——`4112467`，所以"46 行"是核对开始时的数、`43 行` 是收尾时的数；
两者都不含 `slowvale-mirror`。）

最新 mtime 是 `2026-11-27 11:20`（上一轮的镜像同步，共 9 个文件），本轮没有文件被动过。

注意：`git diff` 看不到未跟踪目录，所以单靠第一条不足以证明"前端没动"；
`git ls-files`（0）+ `find -newermt`（0）才是这条的实证。

**判定**：✅

## 第二轮现场（第 9–15 条的运行环境）

首轮现场见 §0；本轮同机不同时点，规模也从 9 人长到 24 人，所以单列，不与上面混着看。

| 项 | 值 |
| --- | --- |
| Web / 桥 | http://127.0.0.1:3190 / http://127.0.0.1:7791（同一进程 pid 46048） |
| 正式 Desktop | 7788（pid 22874，**未触碰、未重启**） |
| 世界 | `world-1nb10jy-b`，`seed=3586027534` |
| 规模 | 24 人 / 18 张单 / 78 条活动 |
| 本轮 tick | 开跑 80916（第 57 天）→ 收尾 83824（第 59 天）；`paused=false`、`runtime.running=true` |
| 宿主存活 | `runtime.diagnostics`：ticks=12067、resets=0、dispatches=1、errors=0（宿主从存档第 50 天接上继续跑，不是新世界） |
| 状态目录 | `packages/dsh-xcity/.testhome/profiles/xcity-3/state` |

本轮 7 条都是只读：GET 快照 + 读 `world.json` / `events.jsonl` / 会话日志。
没有 `build` / `test`，没有派单，没有重启宿主。以下命令都在包目录执行：

```bash
cd packages/dsh-xcity
```

## 9 承诺裁决（verify-commitments）

**目的**：kept / missed 的裁决有没有证据撑住——正向抽查 missed（窗口里不该有任何证据）、
反向抽查 kept（窗口里必须有证据），两边都不许出"suspicious"。

**命令**

```bash
node tools/verify-commitments.mjs --base http://127.0.0.1:3190
```

**期望**：`ok:true`，`suspicious` 为空；`stale` 可非 0（活动环过期，脚本头部写明了这条豁免）。

**实测**（两次，退出码都是 0）

| 采点 | tick | commitments | 分布（按 id） | 按原始行 | missedChecked / keptChecked | stale | meetBlind | suspicious |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 80979 | 20 | kept 8 / missed 12 / open 0 / released 0 | kept 16 / missed 24 | 10 / 2 | 6 | 10 | `[]` |
| 2 | 83346 | 20 | kept 6 / missed 14 / open 0 / released 0 | kept 12 / missed 28 | 10 / 3 | 3 | 10 | `[]` |

第 2 次的覆盖下界：`coverage.episodeFloor=73441`、`activityFloor=82997`（两条证据通道各自还看得见的起点）。

分布会在两次之间变（kept 8→6），因为承诺有一条是"到期未兑现才判 missed"，世界在跑。

**判定**：✅（两次都 `suspicious=[]`）

## 10 关系证据（verify-with）

**目的**：情节里"和谁"（`episode.with`）必须有交互证据——同地点、时间重叠、且**双方都在社交活动里**；
另外 `work`/`study` 情节不该带"同行者"（干活的人不是同伴）。

**命令**

```bash
node tools/verify-with.mjs --base http://127.0.0.1:3190
```

**期望**：`ok:true`；`breakdown.workWith=0`；`unproven=[]`。

**实测：同一命令五次，4 红 1 绿**

| 采点 | tick | 参数 | ok | sampled / proven | unproven | workWith / socialWith | stale | claims |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 81012 | 默认 | false | 21 / 18 | 4 | 0 / 21 | 244 | 265 |
| 2 | 82721 | 默认 | false | 19 / 18 | 1 | 0 / 19 | 262 | 281 |
| 3 | 83348 | 默认 | true | 7 / 7 | 0 | 0 / 7 | 298 | 305 |
| 4 | 85280 | `--sample 20` | false | 23 / 22 | 1 | 0 / 23 | 260 | 283 |
| 5 | 85283 | `--sample 5` | false | 23 / 22 | 1 | 0 / 23 | 260 | 283 |

第 1 次卡点原文（stderr）：

```
VERIFY FAIL unproven · 卡在: agent-1@80452(with=agent-11:no-overlap), agent-4@80455(with=agent-11:no-overlap),
agent-19@80435(with=agent-11:no-overlap), agent-19@80435(with=agent-21:no-overlap)
```

第 2 次：`agent-2@81951(with=agent-10:no-overlap)`。
第 4/5 次：`agent-12@84711(with=agent-7:no-overlap)`——注意 `--sample 20` 与 `--sample 5` 结果一字不差
（每个角色只剩 1 条可核的 claim，sample 再大也抽不出更多），所以这不是抽样运气问题。

**原因（不是记忆写错，是证据环太浅）**：

- 活动环当时是固定 64 条（`src/sim/activity.ts` 的 `ACTIVITY_KEEP_FLOOR`；现行实现是 `activityKeepFor(world) = max(64, 24 × 人数)`，本条记的是第二轮那会儿的 64），24 人分 64 条 ⇒ 每人只留 **2–5 条**，
  整环只覆盖 **444–876 tick（7.4–14.6 游戏小时）**；而情节留 7 天（`EPISODE_KEEP_DAYS=7`，约 10080 tick）。
- 复核第 1 次那 4 条：tick=82683 时对手 `agent-11` 环里只剩 2 条、环底 **82026 > 80452**（`agent-21` 环底 81896），
  也就是对手的覆盖窗口根本不在环里——"没证据"是因为证据被挤掉，不是因为没发生。
- 第 4/5 次同款：tick=85355 复核 `agent-12@84711`，自己的 meet 是 84671–84711（正好压在情节 tick 上），
  而 `agent-7` 环里只剩 3 条、环底 **84728 > 84711**——又是"自己还在、对手被挤掉"。
- `tools/verify-with.mjs` 里算 `stale` 的那段只判"**自己**那条活动还在不在"，不判"**对手**那条还在不在"；
  于是当自己那条还在环里、对手那条已经过期时，会落到 `no-overlap` 而不是 `stale`。
- 第 3 次之所以绿：298 条 claim 已经 `stale`（305 条里只剩 7 条还可核），而这 7 条恰好都对得上。
  也就是说这条命令在 24 人世界上的常态是"红 1–4 条"，绿只出现在"可核样本恰好都干净"的时刻。

环的深度/跨度可复算：

```bash
curl -s http://127.0.0.1:3190/agent-world/api/world | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const w=JSON.parse(s).world;const a=w.activities??[];const comp=a.filter(x=>x.status!=="active");const per=new Map();for(const x of a){per.set(x.agentId,(per.get(x.agentId)??0)+1)};const from=Math.min(...a.map(x=>x.startedAt)),to=Math.max(...a.map(x=>x.endedAt??x.endsAt??x.startedAt));console.log(JSON.stringify({tick:w.tick,agents:w.agents.length,rows:a.length,completed:comp.length,perAgent:[Math.min(...per.values()),Math.max(...per.values())],spanTicks:to-from,spanHours:Math.round((to-from)/60*10)/10}))})'
```

实测两次：`{tick:82683, rows:74, completed:64, perAgent:[2,5], spanTicks:876, spanHours:14.6}`、
`{tick:83295, rows:79, completed:64, perAgent:[2,5], spanTicks:444, spanHours:7.4}`。

**判定**：❌（按卡面口径 `unproven=0` 不成立：五次里四次红）；`workWith=0` ✅（五次都是 0）

## 11 派单公平（verify-fairness）

**目的**：最新一批 N 张单是不是"每张都有人、没人拿两张"（按顺序一人一张，不是堆给一个人）。

**命令**

```bash
node tools/verify-fairness.mjs --base http://127.0.0.1:3190
```

**期望**：`ok:true`；本批每张有 `owner`；无 `duplicate-owner`（`distinctOwners == requiredOwners`）。

**实测**（退出码 0，两次）

```
batch: tasks=3  createdAtTicks=[71621]  ids=[task-16, task-17, task-18]
byOwner: {agent-1:1, agent-2:1, agent-3:1}
workers: available=24  idleNow=0（第一次采点是 1）  requiredOwners=3  distinctOwners=3
tasks: task-16 done/agent-1、task-17 done/agent-2、task-18 done/agent-3
```

注意本批是 **tick=71621（第 50 天）** 派的——之后宿主再没派过单，脚本等到的是"最后一批"，
不是"刚派的"；判定只看这一批的内部公平性，与派单时间无关。

**补记（不进 ok 判据）**：历史累计 `awarded` = agent-1 10、agent-2 5、agent-3 3、agent-4..24 全 0。
18 张单全在 3 个会话角色身上，其余 21 人一张没接过——"同批公平"成立，但**跨批累积严重倾斜**。

**判定**：✅

## 12 存档预算（measure-snapshot）

**目的**：单份存档多大、谁占的、会长到多少；预算 `budgetBytes = 2 MiB = 2097152`。

**命令**

```bash
node tools/measure-snapshot.mjs
```

**期望**：`ok:true`，`projection.verdict="ok"`（`projectedBytes <= 2097152`）。

**实测**（退出码 0，两次采点；中间跨了一次游戏日边界）

| 采点 | day | 落盘 bytes | 紧凑 jsonBytes | episodes | 人均 B / 情节 | growth B/人/天 | 默认 projection | ratio | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 58 | 574109 | — | 1539 | 10480 / 64.1 | 180.7 | 574128 | 0.27 | ok |
| 2 | 59 | 547752 | 294116 | 1475 | 10006 / 61.5 | 169.6 | 547774 | 0.26 | ok |

采点 2 比 1 小了 **26357 B**：跨日触发记忆裁剪（episodes 1539 → 1475），裁剪真的在生效。

构成（采点 2）：`world.agents` 240142 B（0.44）、`world.agents[].episodes` 210239 B（0.38）、
`(键名与缩进)` 253687 B（0.46）——四成体积是 pretty-print 的键名与缩进。

余量推演（同一份存档，只改 `--agents` / `--days`）：

| 参数 | projectedBytes | ratio | verdict |
| --- | --- | --- | --- |
| `--agents 24 --days 30` | 347680 | 0.17 | ok |
| `--agents 24 --days 90` | 832927 | 0.40 | ok |
| `--agents 48 --days 90` | 1560798 | 0.74 | ok |

口径提醒：projection 只让 agent 记忆按"人 × 天"线性长，而 episodes 另有 7 天 / 150 条上限，
所以这是**上界估算**；`verdict=ok` 意思是"按线性增长也不会破 2 MiB"，不是"永远不破"。

**判定**：✅

## 13 运行期成本（runtime.turnCost）

**目的**：每轮输入体积有没有计数与超限提示（插件拿不到计费 token，只能看字符量级）。

**命令**

```bash
curl -s http://127.0.0.1:3190/agent-world/api/world | grep -o '"turnCost":{[^}]*}'
```

**期望**：响应 `runtime.turnCost` 存在，字段齐全 = `turns / inputChars / outputChars / avgInputChars / warns`
（`src/runtime/turn-cost.ts` 的 `TurnCostSnapshot`）。

**实测**（退出码 0）

```text
"turnCost":{"turns":65,"inputChars":198882,"outputChars":8777,"avgInputChars":3060,"warns":1}
```

- 5 个字段齐；`inputChars / turns = 198882 / 65 = 3059.7`，与 `avgInputChars=3060` 自洽。
- `warns=1`：65 轮里有 1 轮输入超过提示线 120000 字符（`DEFAULT_WARN_INPUT_CHARS`）。
- 三次取样（tick 82834 / 83032 / ≥83520）数值完全一致，因为按**轮**结算：计划一天只问一次，
  日内不动；跨日（tick 83520）也没有立刻 +1——新一天的计划在 06:30 才触发。
- 这**不是计费**：字符数 ≠ token，只用来发现上下文膨胀（见 `src/runtime/turn-cost.ts` 头部）。

**判定**：✅

## 14 记忆决策（计划提示词里的「昨天你怎么过的」）

**目的**：06:30 的计划提示词里带前一天日小结，模型才可能"按昨天安排今天"（R516 补的结构性空缺）。

**命令**

```bash
LOG=$(ls -t .testhome/sessions/*/xcity-agent1*/session.v4.jsonl.zstd | head -1)
zstd -dc "$LOG" | grep -c '昨天你怎么过的'
zstd -dc "$LOG" | grep -oE '## 昨天你怎么过的.{0,60}' | tail -1
```

**期望**：计数 ≥1（每条计划提示词各 1 次）；最后出现的那段是**前一天的真实小结**，不是空段。

**实测**（05:19，三个有会话日志的角色）

| 角色 | 命中次数 | 最新一段 |
| --- | --- | --- |
| agent-1 | 18 | `## 昨天你怎么过的\n第58天：和人聊了聊×3、吃了顿饭×2、干活×2、学习×2、睡了一觉×1` |
| agent-2 | 14 | `## 昨天你怎么过的\n第58天：和人聊了聊×4、学习×3、吃了顿饭×2、睡了一觉×1、干活×1` |
| agent-3 | 19 | `## 昨天你怎么过的\n第58天：干活×3、学习×3、吃了顿饭×2、和人聊了聊×2、睡了一觉×1` |

同一条提示词的上下文也核过（agent-1，第 58 天那次计划）：`你是谁` 段是
`角色：lead；干活劲头 80/100；责任心 70/100`（persona 不再是空串），
`昨天` 段排在 `今天已经发生的事` 之前，正文写"现在是 06:30，新的一天开始了"。

口径限制：24 人里只有 agent-1..3 有会话日志（其余 21 人是纯模拟，不跑模型），
所以这条只能对 3 个真会话核对；21 个纯模拟角色没有提示词可查。

**判定**：✅

## 15 工单记忆（kind=task 的情节）

**目的**：工单做完要在角色记忆里留痕（`recordTaskEpisode`，由 `src/sim/step.ts` 处理 `taskComplete` 命令时调用），
不能只有"吃了顿饭"没有"我干成了什么"。

**命令**

```bash
curl -s http://127.0.0.1:3190/agent-world/api/world | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
const w=JSON.parse(s).world, DAY=1440, dayOf=t=>Math.floor(Math.max(0,t)/DAY)+1
const eps=w.agents.flatMap(a=>(a.episodes??[]).filter(e=>e.kind==="task").map(e=>({agent:a.id,tick:e.tick,day:e.day,summary:e.summary})))
const floorDay=dayOf(w.tick)-6
const doneInWindow=(w.tasks??[]).filter(t=>t.status==="done"&&typeof t.finishedAtTick==="number"&&dayOf(t.finishedAtTick)>=floorDay).map(t=>t.id)
const done=(w.tasks??[]).filter(t=>t.status==="done").length
console.log(JSON.stringify({tick:w.tick,day:dayOf(w.tick),doneTasks:done,taskEpisodes:eps.length,episodes:eps,doneInWindow},null,1))
})'
```

**期望**：`taskEpisodes > 0`，且条数等于"保留窗口（最近 7 天）内完成的工单数"。

**实测**（同一命令，两次采点，退出码 0）

第 58 天（tick=83133）：

```json
{
 "tick": 83133, "day": 58, "doneTasks": 18, "taskEpisodes": 2,
 "episodes": [
  { "agent": "agent-2", "tick": 73800, "day": 52, "summary": "工单「核对工单状态 #6」做完了" },
  { "agent": "agent-3", "tick": 74648, "day": 52, "summary": "工单「出巡检结论 #6」做完了" }
 ],
 "doneInWindow": ["task-17", "task-18"]
}
```

第 59 天（tick=83824）：`taskEpisodes=0`、`doneInWindow=[]`（day 52 的两条按 7 天窗口被裁掉了，
`episodeDays` 只剩 53–59）。

"只有 2 条"不是漏写：18 张单完成时都调了写记忆那一行，事件流里一条不少——

```bash
grep -c '"type":"task.completed"' .testhome/profiles/xcity-3/state/events.jsonl
```

实测 `18`（与 `doneTasks=18` 一致）。消失的是**留存**：`EPISODE_KEEP_DAYS=7`（`src/sim/memory.ts`），
day 1–2 的 3 张、day 28–50 的 13 张共 16 张早已出窗；只剩 day 52 的两张，它们在进入第 59 天时也出窗。
所以这条的正确口径是"窗口内完成的工单有没有留痕"，不是"存档里有没有 task 情节"——后者会随天数归零。

**判定**：✅（机制在，且第 58 天窗口内 2 条对得上）／注意：第 59 天起为 0，属留存到期而非缺写

## 第三轮现场（第 16–23 条的运行环境）

首轮见 §0、第二轮见「第二轮现场」。本轮是**同一台宿主没重启**、世界从 24 人长到 56 人之后的复跑，所以规模与上面的数字不可直接比。

| 项 | 值 |
| --- | --- |
| Web / 桥 | http://127.0.0.1:3190 / http://127.0.0.1:7791（同一进程 pid 99339，**本轮未重启**） |
| 正式 Desktop | 7788（pid 22874，**未触碰、未重启**） |
| 世界 | `world-1nb10jy-b`，`seed=3586027534` |
| 规模 | 56 人 / 18 张单（全 done）/ 26 站点、总容量 34 |
| 本轮 tick | 开跑 190988（第 133 天）→ 收尾 194571（第 136 天）；`paused=false`、`runtime.running=true` |
| 宿主存活 | `runtime.diagnostics`：ticks 13888 → 17471、resets=0、errors=0、dispatches=0、stalled=[] |
| 实例起点 | 由 `world.tick − runtime.diagnostics.ticks` 反推 = **177100**（相隔 4s 的两次采样都是 177100，见第 19 条） |
| 状态目录 | `packages/dsh-xcity/.testhome/profiles/xcity-3/state` |

除第 22 条（`smoke-e2e` 会自己 `npm run build`、自起 3290/7891、结束时自删 `.smokehome`）外，其余 7 条都是只读 GET + 读本地会话日志：不写世界、不派单、不启进程、不重启宿主。命令都在包目录执行：

```bash
cd packages/dsh-xcity
```

第 22 条跑完的隔离复核：3290 / 7891 已无监听；`.smokehome` 与 `.smokehome.lock` 都已删除；3190/7791 仍是 pid 99339、7788 仍是 pid 22874；本轮宿主 `resets=0`、`errors=0`，tick 一路推进。

## 16 意图归因（verify-intent）

**目的**：「这些人为什么没有自选动作」不能靠猜——把 `intentStats` 的每个出口拆成一张表，并和现场（人数/座位/state/工单）做一致性交叉。

**命令**

```bash
node tools/verify-intent.mjs --base http://127.0.0.1:3190 --seconds 15
```

**期望**：`ok:true`；`byReason` 按**全表**打印（键名缺了只进 notes、不判失败）；`cross` 三条都 ok。

**实测**（退出码 0；样本 16、失败样本 0；context 采点 tick 191267）

counts 读快照顶层 `runtime.intentStats`（自世界启动以来**累计**）：

| 出口 | total（累计） | 本窗口 delta |
| --- | --- | --- |
| ok | 600549 | 3078 |
| not-available | 383292 | 5447 |
| no-rest-station | 33741 | 469 |
| hungry-no-breakroom | 0 | 0 |
| need-null | 0 | 0 |
| night-no-rest | 0 | 0 |
| no-social-station | 0 | 0 |
| no-work-station | 0 | 0 |
| task-ready | 0 | 0 |

- `total=1017582`，正好等于表内 9 项之和（见下面第一条 cross）。
- 没产生自选动作的累计 **417033** 次（= total − ok）；本窗口里 `not-available` 涨得比 `ok` 快（5447 vs 3078），与 56 人 / 34 座对得上。
- context：56 人；站点 26 / 总容量 34 / 采点时占用 16；state = idle 20 / walking 15 / sleeping 11 / working 6 / talking 4；18 张单全部 done。

cross（三条全 ok）：

| check | expect | actual |
| --- | --- | --- |
| total-is-sum | total === Σ byReason | 1017582 = 1017582 |
| task-ready-has-ready-task | 窗口内新增 task-ready ⇒ 窗口里出现过 status=ready 的单 | newTaskReady 0 / readyMax 0 |
| not-available-has-busy-agent | 窗口内新增 not-available ⇒ 窗口里有人不满足 available() | newNotAvailable 5447 / unavailableMax 39 |

口径提醒（脚本头部写明）：counts 是累计、context 是那一刻，两张表不在同一时间轴，所以只有「窗口内新增」才要求现场作证；历史累计对不上现场不算矛盾。

**判定**：✅

## 17 无座与排队（verify-unseated）

**目的**：人多座少（56 人 / 容量 34）时，无座的到底是「抢不到座」还是「根本没想去坐」；排队会不会叠在同一格；会不会被一个人长期占住。

**命令**

```bash
node tools/verify-unseated.mjs --base http://127.0.0.1:3190 --seconds 15
```

**期望**：`ok:true`（= tick 稳定 + `dupMax <= 2` + `unseatedShare` 有值）；`stalls` 为空。

**实测**（退出码 0；样本 16、失败样本 0；`ticksPerSecond 9.86`；tickRange [191301, 191449]）

| 组 | 关键数字 |
| --- | --- |
| seats | 站点 26 / 总容量 34 / 占用峰值 19 / **无座峰值 44** / 无座占比 0.725 |
| waiting | 到目标站距离均值 16.78、p90 37.15（147 个人次可测；unmeasurable：无目标 503、跨 place 0）；无目标站的峰值 36 人；同 place 同坐标叠人 `dupMax=2`；无座却在做站点类活动 0 |
| rotation | 连续无座时长 p50 88 / p95 148 / max 148 tick（≈9–15 秒，70 段）；单次座位占用 p50 0.08 / p95 0.15 / max 0.15 分钟；超过 2 分钟的持有 **0** |
| fairness | 有目标的无座人次 147：目标站还空着 147、被长期占住 0；座位持有者 31 人，top3 占比 0.191 |

`details.stalls=[]`；叠人只有一处（`place:office.tech_company_1` 坐标 `30,-2`，agent-26 + agent-27，1 个采样点）。

口径提醒（脚本 notes 原文）：「无座峰值 44 人 > 空座总额，说明有人在有座位时也没去坐」「无座峰值里最多 36 人没有 targetStation：站在歇脚点、没有想去哪，这类不算抢不到座（fairness 只归因有目标的）」。

**判定**：✅

## 18 承诺兑现率（verify-kept-rate）

**目的**：第二轮只核了「裁决有没有证据」（第 9 条），这里核**兑现率本身**与「为什么没成」。

**命令**

```bash
node tools/verify-kept-rate.mjs --base http://127.0.0.1:3190 --days 3
```

**期望**：`ok:true`（= `keptRate !== null`；脚本不写死阈值，要判阈值必须显式 `--target`）；`counts` 按承诺 id 去重；`missedReasons` 四类齐全。

**实测**（退出码 0；tick 191614；窗口 [187294, 191614]）

| 项 | 值 |
| --- | --- |
| counts | kept 11 / missed 1 / open 0 / released 0（按 id）；`rows=24`（按行算恒为 2 倍） |
| keptRate | **0.9167** |
| missedReasons.distribution | one-slept 0 / different-place 0 / **no-overlap 1** / unknown 0 |
| coverage | activityFloor 184911、activities 1354 |

唯一那条 missed（原文）：

```text
cmt-131-agent-1-agent-2-1fhnsj3  「把今天的维修单分给三个人」  dueTick 187710
reason=no-overlap   窗口 [187611,187890]
facts: 双方都在 place:office.tech_company_1；coPresent span [187611,187807]；meetOverlap=null
```

即两人确实同处一室、时间也重叠，只是没有触发 meet——按脚本口径归 `no-overlap`，不是把它说成「没见面」。

**判定**：✅

## 19 承诺进记忆（verify-commitment-memory）

**目的**：裁决（kept / missed）有没有写进**双方各自**的情节记忆（`守约：…` / `没做完：…`）。

**命令**

```bash
# --since 取「本实例起点」：world.tick − runtime.diagnostics.ticks 反推，间隔 4s 的两次采样都是 177100
node -e 'const g=async()=>await(await fetch(process.argv[1])).json();const a=await g();await new Promise(r=>setTimeout(r,4000));const b=await g();console.log(a.world.tick-a.runtime.diagnostics.ticks,b.world.tick-b.runtime.diagnostics.ticks)' http://127.0.0.1:3190
node tools/verify-commitment-memory.mjs --base http://127.0.0.1:3190 --since 177100
```

**期望**（卡面）：`ok:true`、`hitRate = 1`、`missing = []`。

**实测：失败（退出码 1）**

```text
ok:false   reason=memory-missing   tick 191643
checked:   kept 24 / missed 4      stale 0      hitRate 0.857
missing:   7 边 / 4 条承诺（全是 kept）
note:      已裁决 28 条，窗口内核对 28 条，双方情节齐 24 条；漏写 7 边，涉及 4 条承诺
```

4 条承诺与它们的 dueTick：`cmt-127-agent-1-agent-3-31amra` 182340、`cmt-127-agent-2-agent-3-19z08iy` 182340、
`cmt-127-agent-2-agent-3-1br0sk0` 182400（以上第 127 天）、`cmt-128-agent-1-agent-3-yiu5be` 183870（第 128 天）。

**原因（两类，都能从快照复算；都不是「没写」）**

1. **口径差一天 → 6 边（第 127 天那三条）**。工具按 `tick − 7×1440` 算窗口起点：191643 − 10080 = 181563，落在**第 127 天中段**；
   而记忆是按**天边界**裁的——`src/sim/memory.ts` 的 `pruneEpisodes` 保留 `dayOf(now) − 7 + 1` 之后，
   tick 191643 是第 134 天 ⇒ 真实底线是第 128 天 0 点（tick 182880），比工具算的起点晚 **1317 tick**。
   于是第 127 天的承诺被判「该有记忆」，而它们的记忆**已经正常出窗**。
   这批情节确实存在过：tick 190988（第 133 天）的快照里 agent-2 还有 32 条 day-127 情节、agent-3 有 18 条；
   到 tick 191955（第 134 天）两者最小情节天都变成 128，day-127 整段消失。
2. **150 条上限真挤掉 → 1 边（第 128 天那条的 agent-1 侧）**。`EPISODE_MAX = 150`（同文件），
   而 agent-1 第 130–133 天分别写 21 / 45 / 34 / 50 条，150 条只够 3–7 天：
   tick 191955 时 agent-1 自己的情节只剩第 130–133 天（150 条），第 128–129 天已被条数上限挤掉，
   比 7 天窗口更早失效。同一条承诺 agent-3 那一侧有记忆（`守约：答应captain的「跟队长报本周维修单收尾情况」兑现了`），
   而写通路是双边同一次循环（`settleCommitments` → `appendEpisode`），所以不是「只写一边」。

**判定**：❌（卡面的 `hitRate=1` 不成立）；失败在留存与口径，不在写入

## 20 成本（verify-cost × measure-tokens）

**目的**：成本口径要**两份独立实现对上**——`measure-tokens` 自己说自己对不算证据。

**命令**（两条必须用同一个 `--days`，否则 `tokensPerDay` 的分母不同）

```bash
node tools/measure-tokens.mjs --days 41     # 老实现：usage 为主 + chars/4 兜底
node tools/verify-cost.mjs --days 41        # 独立实现：只认模型写进日志的 usage
```

**期望**：totals 逐项相等（input / output / cacheRead / turns）；`ok:true`；`missingRatio < 1%`。

**实测**（两条都退出码 0，隔不到一分钟）

| 字段 | measure-tokens | verify-cost | 差 |
| --- | --- | --- | --- |
| sessions | 87 | 87 | 0 |
| turns（含 usage） | 1424（1423 / 估算 1） | 1424（1423 / 无 usage 1） | 0 |
| inputTokens | 1657517 | 1657517 | **0** |
| outputTokens | 313038 | 313038 | **0** |
| cacheReadTokens | 39788672 | 39788672 | **0** |
| billable | 1970946（含 391 estimated） | 1970555（只认 usage） | +391 |
| tokensPerDay | 48072 | 48062 | +10 |

对上的就是前四项（严格相等）。差的那 10 也有出处：`391 / 41 ≈ 9.5`，即 `measure-tokens` 把唯一那轮没带 usage、
用 `chars/4` 估出来的 391 token 也算进 billable，`verify-cost` 只认 usage。这是口径差异、不是歧义，已写明。

`verify-cost` 的其它数：`tokensPerTurn` p50 737 / p95 3772 / max 92564；带缓存口径 `tokensPerTurnWithCache`
p50 19217 / p95 88568 / max 128391；`missingRatio 0.0007`；`sessionsWithZeroTurns 4`；缓存占比 0.96。
分角色（轮次 / 输入 / 输出 / 缓存命中）：agent-1 558 / 584602 / 106112 / 13652608、agent-2 456 / 633191 / 118301 / 17169536、
agent-3 410 / 439724 / 88625 / 8966528。

口径提醒：`--days 41` 是第二轮的世界天数，本轮已到第 134 天；`--days` 只影响 `tokensPerDay` 的分母、不影响 totals（两个工具都不外推）。
按本轮天数折算（world.tick / 1440 ≈ 134 天）：1970555 / 134 ≈ 14706 tokens/天。

**判定**：✅（totals 对上；`tokensPerDay` 的 10 已解释）

## 21 计划记忆（verify-plan-memory）

**目的**：06:30 的计划提示词里带「你还记得」段，而且**三个角色记得的不是同一份**（记忆按人分，不共享）。

**命令**

```bash
node tools/verify-plan-memory.mjs
```

**期望**：三人都 `found:true`、`items` 条数 1..5、`cross.distinct = 3`。

**实测**（退出码 0；只读会话日志，`sessions=87`）

| 角色 | 会话 | found | items | 构成（工单 / 守约 / 没做完 / 其他） |
| --- | --- | --- | --- | --- |
| agent-1 | xcity-agent1-mwzkhjka | true | 5 | 1 / 4 / 0 / 0 |
| agent-2 | xcity-agent2-mwzkhjkz | true | 5 | 1 / 4 / 0 / 0 |
| agent-3 | xcity-agent3-mwzkhjli | true | 5 | 0 / 5 / 0 / 0 |

`cross: { ok:true, distinct:3 }`，note：三份记忆各不相同。样例（agent-1）：`第133天：守约：答应小铁的「把过期的灭火器报给队长换」兑现了`、
`第133天：工单「核对本周维修单完成情况」`——承诺与工单两类记忆都进了计划提示词。

**判定**：✅

## 22 一键端到端（smoke-e2e）

**目的**：从「空世界」到「三单完成 + 记忆 + 成本」只有一条命令；隔离（自己的 home、自己的端口）由脚本自己断言。

**命令**

```bash
node tools/smoke-e2e.mjs          # 默认 600s；自起 3290/7891，绝不碰 3190/7791/7788
```

**期望**：退出码 0；末行 JSON `ok:true`、`tasks.done=3`、`memoryEpisodes=3`。

**实测（本轮真跑了一次）：退出码 0，`seconds=198.2`（墙钟 3m18s，含 `npm run build`）**

```text
[1] 参数与环境  web 3290 / bridge 7891 都空着；已持锁 .smokehome.lock（+0.0s）
[2] build       ok（+0.0s）
[3] 备独立 DSH_HOME：复制 profile（跳过 state/characters）、只改 stateDir/bindingsFile 与桥端口、凭据只读复制（+8.2s）
[4] 起宿主       pid=15781，世界 tick=2、8 人；只给前 3 人开会话（+8.2s）
[5] spawn 三会话 xcity-agent1/2/3（+9.8s）
[6] bindings    写 bindings + agents.json，回读 3 个插槽全部指向本轮会话（+9.8s）
[7] 三单串行    task-1 done@683（agent-3）→ task-2 done@1280（agent-1）→ task-3 done@1793（agent-2）（+197.5s）
[8] 记忆        kind=task 情节 3 条，三张单标题各有对应记忆
[9] 成本        30 轮 / 98482 tokens / 缓存占比 0.86 / 窗口 1.25 游戏日 → 78786 tokens/天
[10] 收尾       杀宿主 pid=15781（code=0 signal=null），删除 .smokehome（+197.8s）
{"ok":true,"tick":1793,"tasks":{"done":3,"failed":0,"pending":0},"memoryEpisodes":3,"cost":{"turns":30,"tokensPerDay":78786},"seconds":198.2}
```

**跑完复核（不进 ok 判据）**：3290 / 7891 已无监听；`.smokehome` 与 `.smokehome.lock` 都已删除；
3190/7791 仍是 pid 99339、7788 仍是 pid 22874；同一次核对里本轮宿主 `resets=0`、`errors=0`、tick 继续推进（190988 → 194571）。

**判定**：✅

## 23 存档体积（measure-snapshot）

**目的**：单份存档多大、谁占的、会不会破 2 MiB（`SNAPSHOT_BUDGET_BYTES = 2 MiB`，`src/sim/memory.ts`）。

**命令**

```bash
node tools/measure-snapshot.mjs
```

**期望**：`ok:true`，`projection.verdict="ok"`。

**实测**（退出码 0）

| 项 | 值 |
| --- | --- |
| 落盘 bytes | **1390235**（day 134 / 56 人 / 1862 条情节 / 62 条承诺 / 18 张单） |
| 紧凑 jsonBytes | 819318 |
| 构成 top3 | `world.activities` 446031（0.32）、`world.agents` 342244（0.25）、`agents[].episodes` 270077（0.19）；`(键名与缩进)` 570968（0.41） |
| 人均 | 6112 B / 33.3 条情节 / 145 B 每条；`growth.bytesPerAgentPerDay = 45.6` |
| projection | projectedBytes 1390130 / budget 2097152 ⇒ ratio **0.66**、verdict **ok** |

与第二轮同一命令对比：落盘 547752（ratio 0.26）→ 1390235（0.66）。增长的主因是 `world.activities`：
活动环已按人数扩容（`src/sim/activity.ts` 的 `activityKeepFor(world) = max(64, 24 × 人数)`，56 人 ⇒ 1344 行），
这一项就占 446 KB / 0.32，比 `agents[]`（0.25）还大。

口径提醒：`verdict=ok` 的意思是「按线性增长也不会破 2 MiB」，不是「永远不破」；activities 由 `activityKeepFor` 封顶、
episodes 由 7 天 / 150 条封顶，所以这 0.66 是**上界**估算，余量还有 0.34。

**判定**：✅

## 汇总

| # | 项 | 退出码 | 判定 | 关键数字 |
| --- | --- | --- | --- | --- |
| 1 | 构建 + 全量测试 | 0 / 0 | ✅ | 1039 tests / 1038 pass / 0 fail / 1 skip（缺静态站） |
| 2 | 世界推进 | 0 | ✅ | tick 16626→16675（5.01s，Δ49），running=true，paused=false |
| 3 | 三工单闭环 | 0 | ✅ | 3/3 done，owner+output 齐 |
| 4 | 三日记忆链 | 1 | ❌ 卡面命令 / ✅ 保留窗口 | missing D1–D3 ×9（保留期 7 天）；D9–D11：27/27 小结、81/81 证据、kept 30 / missed 2 |
| 5 | 并发与重连 | 0 | ✅ | 9 人、stalls 0、抢座 0、重连 seq 1115→1116 |
| 6 | token 成本 | 0 | ✅ | 41.37 天 / 72 会话 / 579 轮 / 输入 356982 + 输出 135243 tokens / 11899 per day（输入占 0.73） |
| 7 | 说话（dialogue） | 0 | ✅ | dialogue 拍带 speaker_id/audience，`test/slowvale-say-dialogue` 常绿 |
| 8 | 前端零改动 | 0 | ✅ | diff 0 行、未跟踪目录 0 改动文件 |

### 第二轮（第 9–15 条，24 人 / 第 57–59 天）

| # | 项 | 退出码 | 判定 | 关键数字 |
| --- | --- | --- | --- | --- |
| 9 | 承诺裁决 | 0 / 0 | ✅ | 20 条承诺（kept 6 / missed 14），抽查 missed 10 + kept 3，stale 3，suspicious 0 |
| 10 | 关系证据 | 1 / 1 / 0 / 1 / 1 | ❌ 不稳定 | workWith 恒 0；unproven 4 → 1 → 0 → 1 → 1；环里每人只剩 2–5 条、跨度 7.4–14.6 h |
| 11 | 派单公平 | 0 | ✅ | 第 6 批 3 张各 1 个 owner（agent-1/2/3），duplicate-owner 0 |
| 12 | 存档预算 | 0 | ✅ | 落盘 547752 B（0.26 × 2 MiB）；48 人×90 天推演 1560798（0.74）仍 ok |
| 13 | 运行期成本 | 0 | ✅ | turns 65 / 输入 198882 字符 / 输出 8777 / 均 3060 / 超限 1 轮 |
| 14 | 记忆决策 | 0 | ✅ | 3 个真会话最后一条计划提示词都带「昨天你怎么过的」（18/14/19 次） |
| 15 | 工单记忆 | 0 | ✅ 窗口内 | 第 58 天 2 条 kind=task（对应 task-17/18）；第 59 天出窗归 0，18 条 task.completed 一条不少 |

### 第三轮（第 16–23 条，56 人 / 第 133–136 天）

| # | 项 | 退出码 | 判定 | 关键数字 |
| --- | --- | --- | --- | --- |
## 24 成长（近期手感，R542）

**目的**：确认真机世界算得出「每人各技能练了多少、几级」，并且这一行真的会进人设提示词。

**命令 A（来源复算，只读存档）**

```bash
cd packages/dsh-xcity && npm run build >/dev/null && node tools/verify-growth.mjs
```

预期：首行存档路径；第二行形如
`世界：tick=… 角色=3 活动=74（保留窗口 72，每人保底 24）工单=0（done 0）`；
随后每人一行 `· kp（agent-1）：code 4 级 352 分 / 练 44 次 / 最近 t…` + 一行提示词文案。

**命令 B（集成：这一行真的进 prompt）**

```bash
cd packages/dsh-xcity && node --test test/persona-skill-line.test.js test/skills.test.js
```

预期 `pass 19 / fail 0`（3 条集成 + 16 条单元）。

**判据**

1. 提示词行只在**有记录且达到 L1** 时出现；`skillLine` 为空时不出现「0 级」这类虚构资历。
2. 门槛表与「8 分/次」一致：`L1=32(练 4 次) L2=72(9) L3=160(20) L4=280(35) L5=440(55)`；
   练 3 次进不了 L1（24 分），封顶要 55 次。
3. 窗口公平：3 人上限 72，**每人保底 24 条**；三个人忙闲悬殊时闲人的记录不被删
   （`test/activity-ring.test.js` 里 70/10/10 那一条）。
4. 口径不变量：这是**近期手感**，活动窗口滚动会回落——不是惩罚，也不是一辈子资历。

**已知边界**：一辈子累计需要新字段（`Agent.proficiency`），属于新概念，**未做**；
衰减参数（graceDays/perDay/floor/降级防抖）也**未标定**。两者都在 `docs/research/GROWTH.md` 里，等用户点头。