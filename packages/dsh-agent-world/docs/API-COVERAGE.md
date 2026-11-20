# 服务端 API 清单与覆盖情况

从 Slow Vale 构建产物里抽出的**全部**调用点：135 个端点，按前缀分组。
当前适配层已实现 **17** 个（其余走空结构与 501 显式未实现）。

## 分组

| 前缀 | 条数 | 已实现 | 说明 |
|---|---|---|---|
| `/game` | 69 | 5 | 游戏内 69 条：快照、手机、日志、市场、玩家操作 |
| `/admin` | 29 | 0 | 管理台 29 条（前端页面已存在） |
| `/shop` | 14 | 0 | 内购与能量（本地版即可，不做真实支付） |
| `/auth` | 6 | 3 | 账号与会话（本地账号，免密即可） |
| `/role` | 5 | 2 | 角色列表与创建 |
| `/world` | 4 | 4 | 世界卡、公告、准入 |
| `/push` | 2 | 0 | 推送设备注册（本地可空实现） |
| `/survey` | 2 | 1 | 问卷闸门 |
| `/widget` | 1 | 0 | 外部挂件会话 |
| `/registry` | 1 | 0 | 物品/配方注册表（可先空） |
| `/config` | 1 | 1 | 运行时配置 |
| `/admission-invites` | 1 | 1 | 准入邀请码 |

## 明细

### game（69 条，已实现 5）

| | 方法 | 路径 | 调用方 |
|---|---|---|---|
| ✅ | GET | `/game/blocks` | app |
| ✅ | POST | `/game/blocks` | app |
| ⬜ | DELETE | `/game/blocks/{id}` | app |
| ⬜ | GET | `/game/business/grocery/trades` | app |
| ⬜ | GET | `/game/custom-dishes` | app |
| ⬜ | GET | `/game/custom-drinks` | app |
| ⬜ | GET | `/game/farm/report` | app |
| ⬜ | GET | `/game/finance/transactions` | app |
| ⬜ | GET | `/game/home/furniture-layout` | HomeFurnitureEditor |
| ⬜ | PUT | `/game/home/furniture-layout` | HomeFurnitureEditor |
| ⬜ | GET | `/game/logs/catch-up` | app |
| ⬜ | GET | `/game/logs/recent` | app |
| ⬜ | GET | `/game/map/presences` | app |
| ⬜ | GET | `/game/market` | app |
| ⬜ | GET | `/game/market/bars` | app |
| ⬜ | GET | `/game/moments` | app |
| ⬜ | GET | `/game/moments/activity` | app |
| ⬜ | GET | `/game/moments/head` | app |
| ⬜ | GET | `/game/moments/profiles/{id}` | app |
| ⬜ | GET | `/game/moments/{id}` | app |
| ⬜ | GET | `/game/moments/{id}/comments` | app |
| ⬜ | GET | `/game/moments/{id}/likes` | app |
| ⬜ | GET | `/game/moments/{id}/photo` | app |
| ⬜ | GET | `/game/music/history` | app |
| ⬜ | GET | `/game/music/income` | app |
| ⬜ | GET | `/game/music/people` | app |
| ⬜ | GET | `/game/music/songs` | app |
| ⬜ | GET | `/game/music/songs/{id}` | app |
| ⬜ | GET | `/game/newspaper/issues` | app |
| ⬜ | GET | `/game/newspaper/issues/{id}` | app |
| ⬜ | GET | `/game/package` | app |
| ⬜ | GET | `/game/phone/apps/marketplace/listings` | app |
| ⬜ | GET | `/game/phone/apps/{id}` | app |
| ⬜ | GET | `/game/phone/contacts` | app |
| ⬜ | GET | `/game/phone/delivery/orders` | app |
| ⬜ | GET | `/game/phone/group/messages` | app |
| ⬜ | GET | `/game/phone/my-business` | app |
| ⬜ | GET | `/game/phone/shopping/orders` | app |
| ⬜ | GET | `/game/phone/singer` | app |
| ⬜ | GET | `/game/phone/sms/thread` | app |
| ⬜ | GET | `/game/phone/sms/threads` | app |
| ⬜ | POST | `/game/player/call` | app |
| ⬜ | POST | `/game/player/call/hang-up` | app |
| ⬜ | POST | `/game/player/call/line` | app |
| ⬜ | GET | `/game/player/calls` | app |
| ⬜ | GET | `/game/player/conversation` | app |
| ⬜ | POST | `/game/player/declutter` | app |
| ⬜ | GET | `/game/player/declutter-quota` | app |
| ⬜ | POST | `/game/player/gesture` | app |
| ⬜ | GET | `/game/player/interaction-quota` | app |
| ⬜ | POST | `/game/player/message` | app |
| ⬜ | POST | `/game/player/outfit-suggestion` | app |
| ⬜ | POST | `/game/player/personality-reset` | app |
| ⬜ | GET | `/game/player/shop` | app |
| ⬜ | GET | `/game/player/stance` | app |
| ⬜ | POST | `/game/player/sticky-note` | app |
| ⬜ | POST | `/game/player/sticky-note/clear` | app |
| ⬜ | POST | `/game/player/urgent-message` | app |
| ⬜ | POST | `/game/player/wallet/pay` | app |
| ⬜ | POST | `/game/player/wallet/sync` | app |
| ⬜ | GET | `/game/recap` | app |
| ⬜ | GET | `/game/relationship-map` | app |
| ⬜ | POST | `/game/report` | app |
| ⬜ | GET | `/game/role-changes` | app |
| ⬜ | GET | `/game/role-memories` | app |
| ⬜ | GET | `/game/role-profile` | app |
| ✅ | GET | `/game/state/scene` | app |
| ✅ | GET | `/game/state/world` | app |
| ✅ | POST | `/game/stream-ticket` | GameView |

### admin（29 条，已实现 0）

| | 方法 | 路径 | 调用方 |
|---|---|---|---|
| ⬜ | POST | `/admin/admission-invites` | app |
| ⬜ | GET | `/admin/admission-invites` | app |
| ⬜ | POST | `/admin/admission-invites/{id}/revoke` | app |
| ⬜ | GET | `/admin/business` | adminConsole |
| ⬜ | GET | `/admin/business/shop` | adminConsole |
| ⬜ | GET | `/admin/business/shops` | adminConsole |
| ⬜ | GET | `/admin/city` | adminConsole |
| ⬜ | GET | `/admin/food` | adminConsole |
| ⬜ | GET | `/admin/items` | adminConsole |
| ⬜ | GET | `/admin/items/census` | adminConsole |
| ⬜ | GET | `/admin/items/lineage` | adminConsole |
| ⬜ | GET | `/admin/jobs/report` | adminConsole |
| ⬜ | GET | `/admin/jobs/report/people` | adminConsole |
| ⬜ | GET | `/admin/money` | adminConsole |
| ⬜ | GET | `/admin/overview` | adminConsole |
| ⬜ | GET | `/admin/reports` | adminConsole |
| ⬜ | POST | `/admin/reports/{id}/resolve` | adminConsole |
| ⬜ | POST | `/admin/shop/grant-energy` | app |
| ⬜ | GET | `/admin/shop/orders` | app |
| ⬜ | GET | `/admin/survey-gate` | app |
| ⬜ | PUT | `/admin/survey-gate` | app |
| ⬜ | GET | `/admin/users` | adminConsole |
| ⬜ | GET | `/admin/users/{id}` | adminConsole |
| ⬜ | POST | `/admin/users/{id}/ban` | adminConsole |
| ⬜ | GET | `/admin/worlds` | adminConsole |
| ⬜ | PUT | `/admin/worlds/{id}/community-group-qr` | adminConsole |
| ⬜ | DELETE | `/admin/worlds/{id}/community-group-qr` | adminConsole |
| ⬜ | PUT | `/admin/worlds/{id}/community-link` | adminConsole |
| ⬜ | DELETE | `/admin/worlds/{id}/community-link` | adminConsole |

### shop（14 条，已实现 0）

| | 方法 | 路径 | 调用方 |
|---|---|---|---|
| ⬜ | POST | `/shop/apple/cancel` | app |
| ⬜ | POST | `/shop/apple/checkout` | app |
| ⬜ | POST | `/shop/apple/transaction` | app |
| ⬜ | POST | `/shop/boost` | app |
| ⬜ | POST | `/shop/cancel-checkout` | app |
| ⬜ | POST | `/shop/checkout` | app |
| ⬜ | POST | `/shop/energy` | app |
| ⬜ | GET | `/shop/entries` | app |
| ⬜ | POST | `/shop/entry-ticket` | app |
| ⬜ | POST | `/shop/items/use` | app |
| ⬜ | GET | `/shop/month-card` | app |
| ⬜ | GET | `/shop/orders` | app |
| ⬜ | POST | `/shop/overview` | app |
| ⬜ | POST | `/shop/refresh` | app |

### auth（6 条，已实现 3）

| | 方法 | 路径 | 调用方 |
|---|---|---|---|
| ⬜ | POST | `/auth/delete-account` | app |
| ✅ | POST | `/auth/login` | app |
| ✅ | GET | `/auth/me` | app |
| ⬜ | PATCH | `/auth/me/preferences` | app |
| ⬜ | POST | `/auth/register` | app |
| ✅ | POST | `/auth/select-role` | app |

### role（5 条，已实现 2）

| | 方法 | 路径 | 调用方 |
|---|---|---|---|
| ⬜ | POST | `/role/create` | app |
| ⬜ | GET | `/role/creation-tags` | app |
| ✅ | GET | `/role/list` | app |
| ✅ | GET | `/role/world/{id}/characters` | app |
| ⬜ | POST | `/role/{id}/delete` | app |

### world（4 条，已实现 4）

| | 方法 | 路径 | 调用方 |
|---|---|---|---|
| ✅ | POST | `/world/create` | app |
| ✅ | GET | `/world/list` | app |
| ✅ | GET | `/world/{id}/bulletins` | app |
| ✅ | GET | `/world/{id}/info` | app |

### push（2 条，已实现 0）

| | 方法 | 路径 | 调用方 |
|---|---|---|---|
| ⬜ | POST | `/push/devices` | app |
| ⬜ | POST | `/push/devices/{id}/opened` | app |

### survey（2 条，已实现 1）

| | 方法 | 路径 | 调用方 |
|---|---|---|---|
| ✅ | GET | `/survey/current` | app |
| ⬜ | POST | `/survey/current/submit` | app |

### widget（1 条，已实现 0）

| | 方法 | 路径 | 调用方 |
|---|---|---|---|
| ⬜ | POST | `/widget/session` | app |

### registry（1 条，已实现 0）

| | 方法 | 路径 | 调用方 |
|---|---|---|---|
| ⬜ | GET | `/registry/{id}` | app |

### config（1 条，已实现 1）

| | 方法 | 路径 | 调用方 |
|---|---|---|---|
| ✅ | GET | `/config` | app |

### admission-invites（1 条，已实现 1）

| | 方法 | 路径 | 调用方 |
|---|---|---|---|
| ✅ | POST | `/admission-invites/check` | app |

## 面板巡检与实现方法（本轮）

### 结论：能全部实现，但要靠"面板巡检 → 日志报错 → 补形状"这个循环

已经在 135 个端点里实现了 17 个，靠这个循环把主要面板从"全崩"推到"5/7 干净"：

| 面板 | 状态 | 卡在哪 |
| --- | --- | --- |
| 手机 | ✅ 0 错误 | 需 /config.phone_apps（12 个 app，顺序被前端硬校验） |
| 背包 | ✅ 0 错误 | 需 /config.item_categories |
| 日志 | ✅ 0 错误 | — |
| 回顾 | ✅ 0 错误 | — |
| 互动 | ⚠ 1 | /game/player/conversation 有一组固定数组字段（messages/suggestions/…） |
| 角色 | ⚠ 1 | 读的不是 role-profile，是另外两个端点（role-memories / role-changes） |
| 资产 | ⚠ 1 | 金额来自某个视图字段，尚未定位到具体 endpoint |

### 方法（可复用）

1. slowvale.debug 打开 → 后端注入 __svlog，把前端 console/异常收进页面；
2. 点一个面板 → 读第一条 error；
3. 错误消息几乎总是"缺什么"，直接照着补；
4. 重跑巡检脚本（一次点完 7 个面板，输出每个面板的错误数）。

这一轮 4 个面板转绿，全部收敛在 6 次迭代内。剩下 2 个不是难，是还没点对：需要把"面板 → 请求"的对应关系记下来。

### 排期建议（按可见价值，不按前缀）

| 批 | 范围 | 条数 | 说明 |
| --- | --- | --- | --- |
| B1 | 手机 + 日志 + 回顾 + 角色 + 互动 + 资产 | ~25 | 主界面全部可点；形状已探到一半 |
| B2 | moments / newspaper / music / business / farm / finance | ~20 | 生活面板，多数是列表 + 空态 |
| B3 | market / shop / wallet / 玩家操作 | ~20 | 有真实语义，需世界模型 |
| B4 | admin 29 + push + widget + auth 其余 | ~35 | 后台与杂项，可用空结构收口 |

B1+B2 是"复现前端"的边界（所有可见面板能开、能显示空态）；B3 开始才是"有内容"。

## 结构层落地状态

### 已做

新增 src/adapters/slowvale/shapes.ts —— **形状表**：路径正则 → 合法空响应。
路由在兜底前先查它，所以 60+ 个端点从"返回 {}"升级为"返回前端能消费的空态"。

覆盖到的族：日志、手机（短信/联系人/群/订单/生意/歌手/应用）、朋友圈（列表/详情/评论/点赞/照片/活动/档案）、
市场与财经、音乐、报纸、农场、自定义菜品、角色记忆与变化、关系图、地图 presence、回顾、包裹、
玩家操作回执、商店、管理台、推送/挂件/问卷/偏好/角色创建删除。

### 巡检结果（7 个码头面板）

| 面板 | 错误 | 备注 |
| --- | --- | --- |
| 角色 | 0 | 需要 config.proficiency_exp_thresholds + attribute_effects.rows |
| 背包 | 0 | 需要 config.item_categories |
| 手机 | 0 | 需要 config.phone_apps（12 项、顺序硬校验） |
| 互动 | 0 | conversation 的固定数组字段（含 interactions） |
| 日志 | 0 | — |
| 资产 | 2 | 仍报"金钱必须是有限数字: NaN"，金额来源未定位 |
| 回顾 | 1 | 读某处的 day_number，未定位到具体响应 |

### 这一轮新增的"配置契约"（都是硬校验）

| 键 | 位置 | 少了会怎样 |
| --- | --- | --- |
| phone_apps | /config | 整块手机打不开（顺序也会校验） |
| item_categories | /config | 背包崩 |
| phone_bank / phone_stocks | /config | 资产面板崩 |
| proficiency_exp_thresholds | /config | 角色面板崩 |
| effect_source_labels | /config | 角色面板的效果来源标签 |
| place_type | place_topology | 地点类型未登记直接抛 |
| attribute_effects.{sources,rows} | viewer.core / attributes | 角色面板两处 |

## B2 巡检结果（手机内的 12 个 App）

| App | 错误 | 需要的契约 |
| --- | --- | --- |
| 招聘 | 0 | — |
| 银行 | 0 | config.phone_bank.{loan_salary_multiplier, loan_min_credit, max_active_loans}；role.finance.{loans, debt} |
| 找房 | 0 | — |
| 外卖 | 0 | — |
| 购物 | 0 | — |
| 股票 | 0 | — |
| 生意 | 0 | — |
| 我是歌手 | 0 | — |
| 武道大会 | 0 | — |
| 新闻 | 0 | — |
| 朋友圈 | 0 | moments 响应要 posts/items 数组 |
| 扭蛋 | 2 | 仍缺一个价格字段（"金钱必须是有限数字: undefined"） |

**12 个 App 里 11 个 0 错误。**

### 本轮新增的契约

| 契约 | 位置 | 少了会怎样 |
| --- | --- | --- |
| phone_bank.{loan_salary_multiplier, loan_min_credit, max_active_loans} | /config | 银行面板算额度得到 NaN |
| phone_gacha.{card_sets, base_price_by_count, daily_draw_limit, happy_hour} | /config | 扭蛋面板崩 |
| role.finance.{loans, debt} | viewer.core | 银行面板读 M.value.loans 直接抛 |
| clock.game_time.{modern_time, day_of_week} | 快照 clock | HUD 的时间/星期是 null |
| role.package.{money, items} | viewer.core | 卡牌/背包归属计算 |
