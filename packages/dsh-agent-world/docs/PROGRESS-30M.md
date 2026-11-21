# PROGRESS

## 2026-11-21 17:30 · 第 10 个半小时（一次干净切换 + 启动失败的原因）

**实验**：只做**一次**场景切换（office → convenience_store，tick=40 时触发），之后不动。

**结果**：
- `/game/state/scene?scene=convenience_store` 被请求了 1 次 ✅（切换被前端认了）
- `Image` 构造函数调用次数 **0** —— 是的，连 Image 对象都没造出来
- 页面上出现错误块：**「现场画面未能启动，请重新加载」**
- 控制台没有新的 warn/error（说明这次失败走的是组件内部的失败态，不是抛异常）

**结论**：场景切换路径通了（fetch 成功），但 Phaser 侧**从未进入 preload**——
连 `load.image(...)` 的执行痕迹都没有。所以不是"加载失败"，是"没开始加载"。

**下一轮（17:30）**：读 boot 失败态的触发源。
`chrome.fishtank.boot_failed` 这个文案由组件的 `onBootError` 设置；
要找的是「谁调用了 onBootError」——顺着它在 bundle 里定位，就能知道它认为"什么算失败"。
这比继续猜 preload 更直接：**它自己说了失败，我们只要问它为什么**。
