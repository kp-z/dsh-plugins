# dsh-broadcast · 会话结束语音播报

**每一轮干完，DSH 自己开口说一句人话。** 两到三句普通话，接近真人的音色，声音从宿主发出来
（不需要浏览器标签页开着）。对话输入框里的扬声器按钮负责开和关。

## 为什么要「先改写、再播」，而不是直接念回复

拿本工作区里三轮真实回复实测（macOS `say` + `afinfo`，205 词/分）：

| 回复长度 | 直接念洗完的原文 | 改写后 |
| --- | --- | --- |
| 4 903 字 | **261 秒** | **7.5 秒** |
| 4 570 字 | **345 秒** | **14.8 秒** |
| 4 208 字 | **329 秒** | **13.4 秒** |

原文全是代码块、路径和表格，路径会被念成「s r c 斜杠 auth 斜杠 retry 点 t s」。
所以链路固定是：**收集这一轮 → 让宿主的模型说成 2–3 句 → 念这几句**。

## 每一轮它做什么

1. 订阅 `session/event`，按会话累积这一轮的 `assistant/message` 正文和工具名。
2. 在 `turn/end` 判定要不要开口：总开关关着不播、回复短于 30 字不播、子代理会话默认静默、
   同会话 2 秒去抖、安静时段不播。报错 / 中止 / 卡住的轮次只念一句短提示，不念摘要。
3. 请**宿主自己的模型**（`ctx.get('llm').stream()`，路由取 `agentDefaultModel.currentSelection()`）
   说 2–3 句口语、不超过 80 字。模型缺席、6 秒没响应、或者返回空内容时，回落到
   「洗过的首段」，再不行就退到「原文首句」。
4. 用 **edge-tts**（默认 `zh-CN-XiaoxiaoNeural`）合成，`afplay` 播放；edge-tts 失败（403 / 断网）
   自动回落到系统 `say`。音频落在 `os.tmpdir()/dsh-broadcast/`，播完即删。
5. 播放串行化：两个会话同时结束不会叠音；正在播的那条能从输入框按钮上直接点停。

## 开关

`conversation.input.left` 里一个扬声器图标。**真值住在宿主**（持久化到
`$DSH_PROFILE_DIR/broadcast/state.json`，所以刷新页面、重启 DSH 都保持），按钮只是遥控器：
点下去先乐观更新，再以宿主回读为准。正在播报时，同一个按钮变成「停止」。

## 配置项

| 配置 | 默认值 | 作用 |
| --- | --- | --- |
| `enabled` | `false` | 总开关。默认关：先装、先试听，别半夜被声音吓一跳。 |
| `voice` | `zh-CN-XiaoxiaoNeural` | edge-tts 音色（它的中文音色都能用）。 |
| `rate` | `'+8%'` | 语速；回落 `say` 时会换算成 `-r`。 |
| `volume` | `100` | 音量 0–100（SSML prosody）。 |
| `engine` | `auto` | `auto` = 先 edge 再 say；`say` = 只离线；`edge` = 只在线。 |
| `maxChars` | `80` | 播报字数上限。80 字约 16 秒，再长是「听不下去」而不是「听不完」。 |
| `minChars` | `30` | 回复短于这个字数就不开口。 |
| `announceSubagent` | `false` | 是否也播子代理会话。 |
| `announceFailure` | `true` | 报错 / 中止 / 卡住时念一句短提示。 |
| `quietHours` | `''` | 安静时段（本地时间，如 `23:00-08:00`，跨零点也行）；空串 = 不启用。 |
| `debounceMs` | `2000` | 同一会话两次播报的最小间隔。 |
| `useModel` | `true` | 是否让模型改写；关掉就只用本地截断。 |
| `modelTimeoutMs` | `6000` | 模型预算；超了就回落本地文案，**绝不让播放干等**。 |

## 安装

```bash
dsh plugin --profile web add file:packages/dsh-broadcast
# 然后重启 dsh
```

装成桌面 App 的 DSH 里没有 `dsh` 命令，而且**它跑的是 `desktop` profile，不是 `web`**——
装错地方重启后看不到按钮。用自带的安装器装进 App 真正启动的那个 profile：

```bash
node packages/dsh-broadcast/scripts/link-profile.mjs desktop --dry-run   # 先看会改什么
node packages/dsh-broadcast/scripts/link-profile.mjs desktop             # 备份 → 改清单 → 软链 → 真 import 验证
# 重启 DSH，然后：curl -s http://127.0.0.1:52559/dsh-broadcast/state
```

## 调试

调试工具 `broadcast_say(text)` 随时可用（不受总开关控制），会告诉你这次到底是哪个引擎出的声：

```
已播报（say 兜底，8241ms）；回落原因：edge-tts 连接失败（握手被拒或网络不可达）
```

## 说明与边界

- edge-tts 是微软的**非官方**接口，域名/签名随时可能变；一旦失效，插件回落到 `say` 并在结果里
  说明原因，不会静默失败。
- 每轮多一次模型调用（输出 ≤ 80 token）。
- 不留痕：音频播完即删，持久化的只有那个开关。
