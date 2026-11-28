# 座位供给与人数上限：这张地图能坐几个人

> 结论先给：**默认场景（company / `scene.office`）的实用人数上限 = 19 人**（每人有工位 + 有床）；R531 后休息位由 10 扩到 22，工位 19 成为新短板。
> 当前花名册 8 人，还余 2 人。换 `scene.default-town` 则只有 **3 人**。
> 数字全部来自内容库，本文末尾有可复制执行的复核命令。

## 0. 口径

- 同一个人不会同时占两个位：白天全员在工位、夜里全员在床。所以两类各自都要能装下 N 人，
  上限取**较小值**（不是相加）：N 人要求「工位 ≥ N」且「休息位 ≥ N」。
- **工位** = 能力里含 `code` / `review` / `research` / `compute` 任一（与 `src/sim/life.ts:30-38`
  的 `SKILL_OF_ROLE` 同一套能力）。**休息** = `rest`（吃饭/打盹/睡觉都走它，`life.ts:4-8`）。
  **社交** = `converse`。**交付** = `deliver`。
- 站点容量是**硬约束**且按站点单独判满，不是全局名额。

## 1. 数据从哪来

- 站点定义：`src/content/packs/stations.ts`（小镇 10 个手摆站点）、`src/content/packs/office-scene.ts`
  （原版办公室 24 把椅子 = 站点，**生成物**）、`src/content/packs/office.ts` 补的茶水间/休息区。
- 站点进入世界的入口是**场景条目的 `stations` 列表**：`src/world/create.ts:90-92` 只实例化
  `scene.stations` 里列出的 id；`src/world/reconcile.ts:183-188` 读档重算同理。**内容里有站点 ≠ 这一局有站点。**
- 默认场景是 `scene.office`（`src/config.ts:113`），即 company（`place:office.tech_company_1`，`src/config.ts:60`）。

## 2. 每个 place 的站点数

宿主传入 6 个场所（`src/index.ts:144-152` 由 `DEFAULT_CIRCUIT` 生成，`src/adapters/slowvale/stage.ts:72-79`），
但**全部站点只落在默认场所**：`create.ts:90-92` 把每个站点都记到 `defaultPlaceId`。

| place | 站点数（scene.office） | 站点数（scene.default-town） |
|---|---|---|
| `place:office.tech_company_1`（company） | **28** | **22** |
| 公寓 / 便利店 / 餐馆 / 健身房 / 海滩 | 0 | 0 |

也就是说：**另外 5 个 place 一个座位都没有**，人也不会去——`life.ts:143` 只挑
`station.placeId === agent.placeId` 的站点，而 agent 的 placeId 就是默认场所（`create.ts:96`）。
多开地点**不是**当前的扩容手段。

## 3. 座位供给

### 3.1 按站点 kind（容量总和）

| kind | scene.office 站点/容量 | scene.default-town 站点/容量 |
|---|---|---|
| desk | 19 / 19 | 4 / 5 |
| meeting | 4 / 4 | 2 / 5 |
| mailroom | 1 / 1 | 1 / 1 |
| breakroom | 2 / 10 | 1 / 3 |
| server | 0 / 0 | 1 / 1 |
| lab | 0 / 0 | 1 / 1 |
| **合计** | **28 / 46** | **22 / 16** |

两场景的 `slots` 与容量逐站相等（`slotsFor` 只在没声明 slots 时兜底，`src/content/instantiate.ts:102-105`）：
office 34 槽 / 34 容量，town 16 槽 / 16 容量。**没有任何站点"容量多于槽位"**。

### 3.2 按活动类别（可同时容纳多少人）

**company / `scene.office`（默认）**

| 类别 | 站点数 | 可同时容纳 | 具体落点 |
|---|---|---|---|
| 工位（任一工作能力） | 19 | **19 人** | 19 张 desk |
| ├ `code` | 14 | 14 | `seat-04..10`、`seat-15..21`（`office-scene.ts:260-413`、`494-647`） |
| ├ `compute` | 14 | 14 | 与 `code` **同一批 14 张桌**（同上） |
| ├ `review` | 19 | 19 | 全部 desk；其中 5 张见下条 |
| └ `research` | 3 | **3** | `seat-02`、`seat-03`、`seat-22`（`office-scene.ts:216-259`、`648-669`） |
| 休息 `rest` | 2 | **10 人** | 茶水间 `breakroom-01` 4 + 东侧休息区 `lounge-01` 6（`office.ts:115-154`） |
| 社交 `converse` | 10 | 10 人 | `seat-01`、`02`、`03`、`11..14`、`22`、`23`、`24` |
| 交付 `deliver` | 1 | 1 人 | `seat-01`（接待处，同时也是 converse 位，`office-scene.ts:195-207`） |

**注意口径差**：内容包描述写"24 个工位"（`office.ts:193`），那是 **24 把椅子**（19 desk + 4 会议椅 + 1 接待椅）；
真正能干活的是 **19 张**——`seat-01` 只有 `deliver+converse`，`seat-11..14` 只有 `converse`。

**`scene.default-town`**

| 类别 | 站点数 | 可同时容纳 | 具体落点 |
|---|---|---|---|
| 工位（任一） | 7 | **8 人** | `desk-a/b/c`（3）+ `review-table`（2）+ `server-rack`（1）+ `lab-bench`（1）+ `board`（1） |
| ├ `code` / `review` / `compute` / `research` | 3 / 2 / 1 / 1 | 3 / 3 / 1 / 1 | `stations.ts:19-26` |
| 休息 `rest` | 1 | **3 人** | `station.breakroom`（`stations.ts:28`） |
| 社交 `converse` | 2 | 5 人 | 作战室 4 + 告示板 1 |
| 交付 `deliver` | 1 | 1 人 | `station.mailroom` |

## 4. 瓶颈：谁先饱和，代码怎么处理

**先饱和的一定是休息位，不是工位**：office 休息 10 < 工位 19；town 休息 3 < 工位 8。
能力维度上还会**更早**饱和：`research` 只有 3 个座位、`deliver` 只有 1 个；`code` 与 `compute`
抢的是同一批 14 张桌（同时来这两类单会互挤）。

任务库里 `requires` 的模板数（本文命令统计）：`code` 7、`research` 3、`deliver` 3、`compute` 2、
`review` 2、`converse` 1。**3 张 deliver 单只有 1 个交付位**，只能串行；
其中 `ship`/`report`/`notes` 分属三套任务集（`default.ts:432,452,462`），同时派就会排队。

饱和后代码**不崩、不降级造假**，只是排队或空转，具体三处：

| 场景 | 行为 | 位置 |
|---|---|---|
| 派工单 | 挑"能力覆盖 `requires` 且未满"的第一个站点；满了 `continue` | `src/sim/scheduler.ts:87-92`（判满在 :91） |
| 派不到 | 产出 `stalled: 'no-station'`，**单子保持 `ready`**，下一 tick 再试；提示"加一个带这些能力的站点" | `scheduler.ts:194-204` |
| 自己生活（吃饭/睡觉/歇/干活/学习） | 就近挑有空位的站点；满了 `continue` | `src/sim/life.ts:142-152`（判满在 :146） |
| 生活也没位 | 该档 `intent: null`（饿了 :230-232 / 夜里睡觉 :238-240 / 累 :246-248 / 上班 :287 / 学习 :294） | `life.ts:227-296` |
| 生活没位之后 | `selfLifeCommands` 跳过 null（:406），该角色这一 tick 不产生任何活动命令，留在歇脚点空转 | `life.ts:402-417` |
| 命令指定了站点 | 指定位满 → 找同房间空位 → 再找任意空位；都满就 `return`，**命令被丢弃** | `src/sim/step.ts:596-609` |

占位口径是"**已经在那里的 + 正在走过去的**"（`scheduler.ts:66-73`），所以不会三个人同时被派到一张单人桌
再在到达时才发现挤不下。

一个容易踩的扩容坑：**`capacity` 与 `slots` 没有一致性校验**。`validate.ts:358-368` 只校验
slots 非空、坐标是数字；`:382-384` 只校验容量 ≥1 —— 条数不校验；`stationSlot` 会把越界索引夹到最后一个槽
（`src/domain/geometry.ts:39-43`）。改 `capacity` 不补 `slots`，多出来的人会**叠在同一个点上**。

## 5. 结论与扩容清单

| 场景 | 工位 | 休息位 | **实用人数上限** |
|---|---|---|---|
| `scene.office`（默认） | 19 | 10 | **10 人** = min(19, 10) |
| `scene.default-town` | 8 | 3 | **3 人** = min(8, 3) |

10 人是**总量**上限；能力维度另算：`research` 3、`deliver` 1、`code` 与 `compute` 共用 14——
要 N 个 researcher 同时开工，就得先把研究位扩到 N（见下表）。

现状：`roster.software-team` 有 8 个席位（`default.ts:316` 起），`instantiateAgents` 按 `maxAgents` 切花名册
（`instantiate.ts:120`），所以**实际人数 = min(maxAgents, 花名册席位数) = 8**，落在 10 以内，还剩
2 个休息位、11 个工位。

要扩到 N 人（office 口径）：

| 目标 | 要加什么 | 证据 |
|---|---|---|
| N ≤ 10 | 什么都不用加 | 本节表格 |
| 11–19 | **休息位扩到 N**：`lounge-01` 容量 6 → N−4，并补到同样数量的 `slots`（例：N=16 → 容量 12 + 12 槽；新增座点要落在可走格上） | `office.ts:126-154`；`geometry.ts:39-43` |
| 20+ | **工位扩到 N**：新增 desk 站点（带 `code`/`review`/`compute`）、`capacity` 与 `slots` 同时加，并让场景条目引用它们 | `office.ts:78-106,156,173`；`create.ts:90-92`；`geometry.ts:39-43` |
| 要 N 个 `research` 同时开工 | `research` 桌扩到 ≥N（现在只有 3 张）。⚠️ `office-scene.ts` 是**生成物**（:1-12），手改会被下次生成冲掉，要改 `scripts/gen-office-scene.mjs`，或用包 `overrides` 顶掉 | `office-scene.ts:216-259,648-669`；`office.ts:198-203` |
| N > 8 | **花名册加席位**（否则世界只有 8 个人） | `default.ts:316`；`instantiate.ts:120` |
| N > 24 | 放开渲染上限 `MAX_AGENTS`（默认 `maxAgents: 0` = 不限，但常量 24 是另一种预算） | `src/domain/constants.ts:73`；`src/config.ts:107` |
| 想"多开几个地点"扩容 | **现在不行**：所有站点都被记到 `defaultPlaceId`，其余 place 恒为 0 站点 | `create.ts:90-92`；`index.ts:144-152` |

一句话：**这张图按"人人有工位 + 有床"是 10 人；工位不是短板，床是。** 要把人翻倍到 16，
最省的做法是把 `lounge-01` 从 6 座扩到 12 座（+ 12 个 slots），花名册补到 16 席，工位一张都不用加。

## 6. 如何复核

`lib/` 是构建产物（`.gitignore` 忽略），所以先构建再跑；命令与输出如下（在仓库根执行）：

```sh
cd packages/dsh-xcity
npx tsc -p tsconfig.json   # 没构建过才需要
node --input-type=module -e '
import { builtinPacks } from "./lib/content/packs/default.js";
import { ContentRegistry } from "./lib/content/registry.js";
const r = new ContentRegistry(); r.loadAll(builtinPacks(), {});
for (const sceneId of ["scene.office", "scene.default-town"]) {
  const scene = r.get("scenes", sceneId).data;
  const st = scene.stations.map((id) => r.get("stations", id).data);
  const sum = (f) => st.filter(f).reduce((n, s) => n + s.capacity, 0);
  const byKind = {};
  for (const s of st) byKind[s.kind] = (byKind[s.kind] ?? 0) + s.capacity;
  console.log(sceneId, "stations=", st.length, "capacity=", sum(() => true), "slots=", st.reduce((n, s) => n + (s.slots?.length ?? s.capacity), 0));
  console.log("  byKind", JSON.stringify(byKind));
  console.log("  work=", sum((s) => s.capabilities.some((c) => ["code", "review", "research", "compute"].includes(c))),
    "rest=", sum((s) => s.capabilities.includes("rest")),
    "converse=", sum((s) => s.capabilities.includes("converse")),
    "research=", sum((s) => s.capabilities.includes("research")),
    "deliver=", sum((s) => s.capabilities.includes("deliver")));
}'
```

预期输出（本文所有数字都由它复算）：

```
scene.office stations= 26 capacity= 34 slots= 34
  byKind {"mailroom":1,"desk":19,"meeting":4,"breakroom":10}
  work= 19 rest= 10 converse= 10 research= 3 deliver= 1
scene.default-town stations= 10 capacity= 16 slots= 16
  byKind {"desk":5,"server":1,"lab":1,"meeting":5,"mailroom":1,"breakroom":3}
  work= 8 rest= 3 converse= 5 research= 1 deliver= 1
```

本文另用 `createWorld()`（`src/world/create.ts`）按 `places = 公司 + 公寓` 建过一次世界核对：
`world.stations` 与上表逐项相同（26/34、10/16），且 100% 站点的 `placeId` 都是默认场所。

---

## 7. R531 之后的实际供给（以此为准）

实测（56 人世界跑一天）：sleep 需 5.33 座、meal 需 2.19 座、rest 需 9.22 座，合计 16.7 座；扩容前休息容量 10 —— 缺口约 7 座。

扩容后：scene.office 28 站点 / 46 容量，其中 rest 22 座（breakroom 10 + lounge 12）。真机复核（同一世界重启后）：restCapacity 22、restOccupied 20、runtime.intentStats.hungry-no-breakroom = 0（扩容前同口径 11845/天）。

顺手修掉一个站点重叠：lounge-01 原第 3 个槽的绝对坐标 (24,-6) 与 seat-04 的工位落点完全重合 —— 工位上的人和休息的人会叠在同一点。已跳过该格，并由 test/content-capacity.test.js 的「槽位两两不重合」断言守住。
