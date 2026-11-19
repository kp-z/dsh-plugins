# 会话结束后「先讲人话、再自动播报」插件的调研

> 调研时间 2026-11-19　环境 macOS (arm64) + DSH Desktop (Electron) + web profile
> 结论先行：**现成插件没有一个做「先整理成人话再播」**——它们要么把原文念出来，
> 要么只念「会话名 + 第几轮 + 成没成」。所以这件事必须自己做，但**有大量可直接复用的部件**。

---

## 1. 生态盘点（8 个最接近的）

| 插件 | 触发与内容 | 语音 | 与我们的差距 |
| --- | --- | --- | --- |
| `flashyiyi/dsh-voice-announcer` ★1 | `turn/end` → 念「会话名：第 N 轮结束」+ 成功/报错文案 | edge-tts 内置（零依赖，流式），sapi 离线 | **不念内容**。底座最接近，BSD-3，可参考 |
| `1624318455/dsh-plugin-tts` ★61 | 把助手回复原样念出来，auto-read 开关 | Edge TTS | 原文朗读 = 长、废话多、代码念不出 |
| `Yuuyuko-uu/dsh-tts-bridge` ★262 | 把会话文本丢给 DeepSeek 网页端朗读 | 网页端 | 同上，且要浏览器常开 |
| `ppy-web/dsh-plugin-xiaomi-mimo-tts` ★64 | 小米 MiMo / 豆包 Seed TTS，浏览器语音 | 云端 | 只解决「发声」，不解决「说什么」 |
| `beiyege-01/dsh-voice-ai-girlfriend` ★1089 | Qwen3-TTS 声音克隆 + 句子级流式朗读 | 本地克隆 | 朗读原文，音色克隆反而增加复杂度 |
| `xcw520/dsh-dania-voice` ★30 | GPT-SoVITS 本地音色 | 本地 | 原文朗读，模型重 |
| `haoku123/dsh-voice` ★6 | 全双工：ASR → LLM → 逐句朗读 + 真打断 | msedge-tts + 浏览器 SSE 播放 | 是「边生成边念」，我们要「结束后一次性播」 |
| `qishuilalala/dsh-voice-mode` ★34 | 全双工语音模式，按句朗读 + 字幕 | 同上 | 同上 |

GitHub 搜 `dsh tts` 共 276 个仓库、`dsh voice` 637 个，**没有一个把「摘要/概括」写进检索词命中**：
输入侧（ASR）和发声侧（TTS）很卷，**输出侧的表达改写是空白**。

## 2. 为什么必须有「整理」这一步（实测）

同一份收尾报告，两种念法：

| 文件 | 内容 | 时长 |
| --- | --- | --- |
| `compare-raw.mp3` | 原文（含 Markdown、代码、行内代码、列表） | **19.6 s** |
| `compare-spoken.mp3` | 改写成 2 句口语 | **9.5 s** |

原文的 ```ts\ndelay = Math.min(...)``` 会被念成一串英文标识符和符号；路径 `src/auth/retry.ts`
念成「s r c 斜杠 auth 斜杠 retry 点 t s」。所以整理不是「锦上添花」，是**可听性的前置条件**。

## 3. TTS 选型（本机实测）

| 引擎 | 自然度 | 成本 | 离线 | 延迟（实测） | 备注 |
| --- | --- | --- | --- | --- | --- |
| **Edge TTS**（zh-CN-XiaoxiaoNeural 等 14 个中文音色） | 好（神经网络） | 免费 | 否 | 68 字 → 2.1–3.9 s 出整段；282 字 → 6.7 s | 已验证可用（2026-11-19），老域名 200、新域名 403（需正确 key 与 Sec-MS-GEC） |
| macOS `say`（Tingting/Meijia/Eddy…） | 一般（拼接感） | 免费 | 是 | 1.4 s | 只做兜底；设置里装「增强/高级」音色会明显变好 |
| Qwen3-TTS / MiniMax / 豆包 Seed | 最好（近人） | 按字计费 | 否 / 需 key | 未测（无 key） | 留成可插拔 provider |
| 本地 Qwen3-TTS（mlx-audio） | 好 | 免费 | 是 | 首包慢（模型加载） | Apple Silicon 可行，模型 ~GB 级 |
| GPT-SoVITS / CosyVoice | 好 | 免费 | 是 | 慢 | 适合音色克隆，不适合「每轮都播」 |

**默认选 Edge TTS**：免费、音色多、中文自然、零 npm 依赖（协议自己实现即可）；
macOS 的 `say` 作为断网兜底；云端/本地大模型留 provider 插槽。

## 4. 真正的坑：播放在 macOS 上没人管

`dsh-voice-announcer` 的播放路径是 **ffplay（Windows/macOS 都要装 ffmpeg）或 sapi（仅 Windows）**。
本机实测：

```
which ffplay  →  (空)      # 没装
which afplay  →  /usr/bin/afplay
```

也就是说**直接 fork 这个插件，在这台 Mac 上会一声不响**。播放后端必须自己写一层：
`afplay`（macOS）/ `ffplay`（有就流式）/ `say`（离线兜底）/ PowerShell sapi（Windows）。

## 5. 结论：自己开一个包，复用三个部件

新包 `packages/dsh-broadcast`（暂名，中文「播报」）：

```
session/event ──▶ turn/end(completed) ──▶ 收集本轮 assistant/message 文本 + 工具调用
                                             │
                                    ① 本地清洗（去代码块/路径/Markdown/URL）
                                             │
                                    ② 宿主 llm 改写：2–3 句口语，≤80 字
                                             │  （失败 → 取首段前 80 字）
                                    ③ TTS：edge-tts（默认）→ say 兜底
                                             │
                                    ④ 播放：afplay / ffplay / sapi，串行队列，新播报抢占
```

复用什么、不复用什么：

| 部件 | 做法 | 理由 |
| --- | --- | --- |
| edge-tts 协议（WebSocket + Sec-MS-GEC + 新域名） | **移植** `dsh-voice-announcer/src/edge-tts.ts`（BSD-3，署名） | 最容易随时间失效的一段，别人已经踩过 2026-10 的 403 |
| `session/event` 订阅与解码 | 复用本仓 `dsh-agent-world/src/bridge/decode.ts` 的形状 | 已在真机跑通（`assistant/message` → `data.message.content[].text`） |
| 宿主模型调用 | 复用 `dsh-contract-butler/src/hostAi.ts` / `dsh-daily/src/ai.ts` 的注入式写法 | `ctx.get('llm').stream()`，不自建密钥通道 |
| 播放层、摘要层、播报卡片 UI | **自己写** | fork 的播放层在 macOS 不可用；产品形态相反（它是「报幕」，我们是「讲清楚这轮干了什么」） |

## 6. 落地计划（按可交付切）

**P1 能响**（约 400 行）：`turn/end` 订阅 → 文本清洗 → 本地截断 → edge-tts → afplay。
配置：开关、音色、语速、是否播子代理、最短长度阈值。

**P2 像人话**：接宿主 `llm` 做 2–3 句改写；prompt 约束「先结论、说清要不要你拍板、不念代码和路径」；
按 `sessionId + turn` 缓存去重；报告链路失败时回落到本地截断（不静默）。

**P3 好用**：客户端播报卡片（正在说什么 + 波形 + 暂停/重播）、音色试听、
安静时段（夜间不播）、只播非当前会话、多会话排队与抢占。

## 7. 风险与已备好的退路

| 风险 | 退路 |
| --- | --- |
| edge-tts 域名/取 token 再变（2026-10 已发生过一次 403） | 厂商域名可配；失败自动 `say`；错误在设置页可见，不静默 |
| 摘要多一次模型调用，延迟 +1–3 s | 摘要 ≤80 字（TTS 本身 2 s）；先本地清洗能让兜底也可听 |
| 每轮都播会很吵 | 只有 `reason.kind === 'completed'` 且回复 ≥ N 字才播；子代理默认静默；同一会话 2 s 去抖 |
| 打断正在播的播报 | 单队列 + 新播报抢占（旧的手动补播从卡片里点） |
