# 前端能力清单：动作 / 状态 / 产出

> 数据全部从构建产物（site/assets）与内容层（assets/**）读出，不是设计稿推测。
> 口径：`enumLabels-*.js` 的 106 个枚举域、`GameView-*.js` 的动作表与活动表、`objects.json`/`interactions.json`。

## 一、动作（角色能做什么）

### 1. 精灵动作：30 个（前端只认这些名字）

```
pool walk run phone pickup gift read push_cart work farm_work
workout jog basketball fishing eat eat_drink idle sit sleep
bark happy traveling wash bathe soak attack hurt faint punch stab
```

来源：`GameView` 的动作表（`nL`）。适配层必须把内核状态映射到这张表，
否则角色只会站着——前端的 `anim` 只认这些值。

### 2. 业务动作 ActionKind：362 个

覆盖唱歌/演出、开店、订单、耕作、装修、犯罪、医疗、裁缝等。
例：`start_busking` 街头卖唱、`write_song_stage` 构思歌曲、`moment_publish` 发动态。

### 3. 操作型动作

| 域 | 数量 | 例子 |
| --- | --- | --- |
| FarmOperation 农活 | 8 | 翻地/播种/浇水/施肥/除草/除虫/铲除死苗/收割 |
| PetOperation 宠物 | 5 | 寻找野猫/耐心陪伴/投喂/摸摸/陪玩 |
| PlayerGesture 手势 | 5 | 摸头/拥抱/亲一口/脑瓜崩/揪脸 |
| NPCInteractionType | 1 | 闲聊 |

## 二、活动（角色正在做什么，决定头顶徽章与进度）

61 个 Activity 类，例：
`SleepActivity`、`CookingActivity`、`ProgrammerActivity`、`GymExerciseActivity`、
`TravelActivity`、`HaircutActivity`、`MakeFurnitureActivity`、`MartialMatchActivity`。

前端把它显示成 `active_activity: {activity_type, subkind}` → 徽章，配合进度条。

> 缺口：`role_public_statuses` 目前只投影 `{status:"offline"}`，没有 `active_activity`，
> 所以头顶永远没有"在做什么"的徽章与进度。

## 三、状态与统计

| 域 | 数量 | 取值 |
| --- | --- | --- |
| HealthLevel 健康 | 4 | 健康/亚健康/体弱/虚弱 |
| StaminaLevel 体力 | 5 | 精疲力尽/疲惫/正常/精力充沛/活力满满 |
| MoodLevel 心情 | 3 | 好/一般/不好 |
| FullDegreeLevel 饱腹 | 3 | 低/中/高 |
| DrunkLevel 醉度 | 4 | 清醒/微醺/醉了/烂醉 |
| SickSeverity 病情 | 3 | 小病/中病/大病 |
| SkillType 技能 | 11 | 唱功/烹饪/体能/编程/服务/农业/钓鱼/医术/裁缝/调酒/驯兽 |
| ProficiencyLevel 熟练度 | 4 | 学徒/熟手/精通/大师 |
| EmploymentTier 雇佣 | 2 | 主业/副业 |
| JobLevel 岗位级 | 4 | 初级/普通/资深/主管 |
| FamiliarityTier 熟识 | 3 | 挚友/朋友/认识 |
| BondType 关系 | 3 | 情侣/室友/同事 |
| TimePeriod 时段 | 7 | 清晨/上午/中午/下午/傍晚/夜晚/深夜 |
| Weather 天气 | 5 | 晴天/多云/雨天/暴风雨/雪天 |
| WorkDayPattern 排班 | 3 | 每天/工作日/周末 |

另有 `InjuryKind`、`DiseaseChain`、`BuffKind`、`EffectKind`、`RoleMemoryKind`、
`RoleEventKind`、`SocialTag`、`TemperamentTag` 等（共 106 个枚举域）。

## 四、产出（世界会生成什么）

| 类别 | 域 | 数量 | 例子 |
| --- | --- | --- | --- |
| 金钱流水 | TransactionKind | 115 | 工资/绩效奖金/房租水电/演唱打赏/演出场地费/交易分成… |
| 物品 | ItemType | 12 | 食材/食物/酒/药品/衣物/家具/家电/卡牌/收藏品/日用/杂物/宠物名牌 |
| 农业 | FarmCrop | 13 | 水稻/小麦/番茄/辣椒/棉花/甘蔗/大豆/葱蒜洋葱土豆/蓝染果 |
| 店铺 | BusinessKind | 8 | 餐厅/健身房/服装工作室/造型沙龙/家具工坊/作坊/超市/酒吧 |
| 订单 | RestaurantOrderStatus / FurnitureOrderStatus | 9 / 5 | 排队/制作/出餐/配送/事故 |
| 品质 | CraftQuality | 3 | 普通/精制/上品 |
| 新闻 | NewsTopic | 12 | 民生/医疗/餐饮/治安/就业/商业/财经/健身/时尚/田园/科技/人物 |
| 收藏 | CardRarity / SongRarity | 4 / 4 | 普通/稀有/史诗/传说 |

内容层：32 张地图、3549 个场景物件、7 类交互点、6 套卡牌、13 种作物、9 猫 6 狗。

## 五、我们驱动到什么程度

| 能力 | 状态 |
| --- | --- |
| 走动/干活/收工（walk/work/idle） | 已有（agentActivity → 工位 → findPath） |
| 短信往返（玩家 ↔ 角色 ↔ 会话） | 已有 |
| 日志流（最近 50 条世界事件） | 已有（standalone notice） |
| 场景/在场/时钟/天气 | 已有投影 |
| 头顶"正在做什么"徽章 + 进度 | 缺：没有 active_activity |
| 金钱流水/物品/订单/农活/卡牌 | 缺：内核没有对应建模 |

结论：30 个精灵动作我们只用了 3 个（walk/work/idle）；61 个活动类一个都没投影；
产出侧的 115 种流水、12 类物品、8 种店铺全部还没接。
