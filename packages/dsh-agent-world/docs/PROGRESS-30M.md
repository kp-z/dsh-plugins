# PROGRESS

## 2026-11-21 16:30 · 第 8 个半小时（读到了 preload 源码）

**读到的关键代码**（GameView 里场景类的 preload）：

```js
preload() {
  const g = this.assetKey
  this.preloadCommonAssets(), i9(this)
  if (!this.textures.exists(this.assetTextureKey('bg')))
    this.load.image(this.assetTextureKey('bg'), ni(`${this.mapBase}/background.png`))
  ...
  const x = this.deps.mapData[g]      // ← 用 assetKey 取地图数据
  for (const A of x.objects) ...      // ← x 未定义就抛，preload 中断
}
```

**由此得到两条判据**：
1. 只要 preload 真的跑起来，`background.png` 一定在 `load.image` 里被排队 → 必然产生请求；
2. 现在一次请求都没有 → **preload 根本没执行**（或者在第一行就抛了）。

**所以问题不在"文件列表空"，而在这个场景实例的 preload 生命周期没被触发。**

**下一轮（16:30）**有两个方向，按代价排序：
1. **验证 preload 是否执行**：在 `Image.prototype.src` 的 setter 里加时间戳与调用栈
   （已有钩子，但需要保留栈），看有没有对象被构造但未赋值 URL；
2. **缩小变量**：只让世界提供一个场景（拓扑只留 `place:office.tech_company_1`），
   排除"31 个场景互相干扰"。如果单场景能画出背景，再逐个放回来。

方向 2 更符合"抓主要矛盾"：先把一个场景跑通，再谈多场景。
