# PROGRESS

## 2026-11-21 18:30 · 第 12 个半小时（找到场景切换的真入口）

**读到的关键代码**（host 内部的场景切换）：

```js
function O(scene, ...) {
  r?.ensureScene(scene)
  const current = F() || scene
  return current?.mapKey === scene
    ? true                                   // 认为"已经在那个场景了"，什么都不做
    : (Kc(r?.game), f.add(scene),
       current ? (l.leaveScene(current), current.scene.start(scene, { from: current.mapKey }), true)
               : r?.game?.scene ? (r.game.scene.start(scene, { from: null }), true) : false)
}
function _() { return c.committedScene }     // 场景由 committedScene 决定
```

**这就是卡点的形状**：
`current?.mapKey === scene` 会命中一个**"实例存在但从未 start"**的场景，
于是 `O()` 直接返回 `true`——**永远不启动 preload**。

而 Phaser 只在 `scene.start()` 之后才跑 preload。

**为什么之前的切换没救回来**：我们切到 `convenience_store` 时，
`F()` 仍可能返回一个"当前"实例（例如初始 key），使等值判断命中。

**下一轮（18:30）**：验证这个"假命中"。
方法：让 `committedScene` 连续切到**两个都没被创建过**的场景（例如 park → beach），
若仍不 start，就说明 `F()` 总是返回非空；再考虑让初始 `initialSceneKey` 为空。
