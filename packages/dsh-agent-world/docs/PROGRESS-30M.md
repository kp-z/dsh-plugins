# PROGRESS

## 2026-11-21 17:00 · 第 9 个半小时（单场景对照实验）

**实验**：只暴露一个地点（`place:office.tech_company_1`），人不动、场景不切换。

**结果**：
- 画布仍然起来（2050×1608）；
- `/assets/maps/**/*.png` 仍是 **0**；
- 新出现一条 display-gap 警告：`place.name 未登记: place:office.tech_company_1`
  （它的命名表里没有这个 place；属展示层警告，不影响加载）。

**结论（对照实验的价值）**：单场景也没画出背景 → 问题不在"多场景互相干扰"。
前端的场景 **preload 只在"场景切换"时被触发**，而单场景永远没有切换。

**这解释了两件事**：
1. 首帧不会加载任何贴图（因为初始那次不算切换）；
2. 多场景时看到的 `场景资源加载无进展: scene=convenience_store` 才是真实路径——
   切换确实触发了 preload，但 preload 里没排队任何文件。

**下一轮（17:00）**：既然"切换才触发"，就**制造一次干净的单次切换**：
从 office 切到 convenience_store 一次、之后不再切，观察这唯一一次 preload 有没有请求。
同时 hook `Image` 构造函数本身（而不只是 src setter），确认有没有 Image 对象被造出来。
