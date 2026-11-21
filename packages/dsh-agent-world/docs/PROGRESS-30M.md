# PROGRESS

## 2026-11-21 19:30 · 第 14 个半小时（**真配置一上，preload 就跑起来了**）

**做了一件一直该做的事**：从线上服务端把 `/api/config` 原样取下来，存成
`src/adapters/slowvale/data/config.ts`，`/config` 直接返回它。

**结果（决定性变化）**：
- 之前：**任何**素材都不请求；
- 现在：`/assets/ui/bubbles_32x32.png`、`/assets/sprites/pickup_items.png`、
  `/assets/characters/char_01.png`、`/assets/ui/badges/*.png` 全都被请求了。

这些正是 `preloadCommonAssets()` 里排的文件——**说明场景 preload 真的在跑了**。

**真配置的规模**：29 个键，其中 `scene_by_place` 14 条、`phone_apps` 12 项（有顺序）。
自己拼不可能拼对；而且它顺便告诉我们：我们自造的 place id（`place:office.tech_company_1`、
`place:downtown.city_gym`…）**在规则表里是合法的**（`A1` 的 numbered_prefix/exact 规则能匹配）。

**新卡点（很具体）**：
preload 跑了 `preloadCommonAssets`（UI/徽章/角色表都加载了），
但**没有走到 `load.image(bg, …/background.png)` 那一行**。
中间只剩两段：`i9(this)` 与 `g === "farm"` 分支。而 `i9` 需要
`/assets/maps/<scene>/furniture.json` —— 我们镜像是 **404**（文件不存在）。

**下一轮（19:30）**：给 `/assets/maps/*/furniture.json` 一个合法的空对象
（由适配层补，不写产物），看 preload 能否继续到 bg；
如果不能，就把 `preloadCommonAssets` 的整段读完，找它后面的中断点。
