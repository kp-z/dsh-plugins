# PROGRESS

## 2026-11-21 20:00 · 第 15 个半小时（场景 id 最终定为 place id）

**这一小时做**：把 `scene` 字段从「资源键」改回「place id」，并加了 furniture.json 兜底。

**为什么改回 place id**（证据链）：
1. 真配置里的 `scene_by_place` 只有 14 条，**不包括 `company`/`restaurant`/`gym`**；
2. 前端 `$1(scene, scene_by_place)` 对不在表里的 scene 做反查 → 查到 0 个 → 抛
   `场景 company 对应 0 个地点，无法反查`；
3. 而 `B1(placeId, scene_by_place)` 会先读拓扑 `Tr[placeId].scene` 得到资源键——
   **说明 scene 该是 place id，资源键只存在于拓扑里**。

改完后：反查错误消失、`does not cover` 也消失、`/game/state/scene` 的请求是 place id。

**仍然存在**：`场景资源加载无进展: scene=place:outdoor.sunset_beach`，
preload 里 `preloadCommonAssets` 跑了（34 个 UI 素材被加载），但地图贴图仍然 0。

**回归确认**：agent-world 794/795 通过（1 跳过）；前端 2401/2401 逐字节一致。

**下一轮（20:00）**：preload 的第二段只有三行，逐个排除：
`i9(this)`（Np.has(assetKey) 为假时会跳过）、`g==="farm"` 分支、`textures.exists(bg)`。
最可疑的是第三行的判定——如果 `assetTextureKey('bg')` 在某些场景下与已存在的纹理同名，
就会"以为加载过"，直接跳过。
