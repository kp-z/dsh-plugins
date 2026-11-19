# dsh-broadcast 开发计划（会话结束语音播报）

> 目标：每轮对话结束后，把「这一轮干了什么、结果如何、有没有需要你拍板的」整理成
> **2–3 句能听懂的普通话**，用接近真人的音色自动播出来。
> 交互入口：对话框里的一个开关。

## 一句话验收

打开开关 → 让 DSH 干一件活 → 它干完，**不等你点任何东西**，几秒后自己开口说人话；
关掉开关 → 一声不响。中途新会话结束 → 新播报接管，不叠音。

---

## 定时运行协议（每个整点触发一次，务必照做）

1. 先读本文件，找到**第一个未勾选**的阶段。
2. 只做这一个阶段；做完就在本文件把它勾上，并在末尾「运行日志」加一行。
3. 每个阶段收尾**必须**：`pnpm --filter dsh-broadcast build` + `node --test test/` 全绿 → `git add -A && git commit`。
   跑不过就不许勾选，把失败原因写进运行日志，下一次继续。
4. **不要**在没有测试通过的情况下装进 web profile（会拖垮宿主）。
5. 除非阶段明确要求，不要动 `packages/` 里其他插件。

---

## 阶段表

- [x] **S1 骨架 + 能出声**（约 1 小时）
  - 建包 `packages/dsh-broadcast`：package.json / tsconfig / cordis.patch.yml / src/config.ts / src/index.ts
  - 配置项：`enabled`（默认 **false**）、`voice`（默认 `zh-CN-XiaoxiaoNeural`）、`rate`、`volume`、`engine`（edge-tts | say | auto）
  - 移植 edge-tts 客户端（来自 `flashyiyi/dsh-voice-announcer`，**BSD-3-Clause，保留署名**，见 `NOTICE`），
    失败（403/超时）自动回落 macOS `say`
  - 播放后端：`afplay`（macOS）/ `ffplay`（存在则用）/ `say`（离线）
  - 临时文件落到 `os.tmpdir()/dsh-broadcast/`，播完即删
  - 注册调试工具 `broadcast_say(text)`：手动触发一次播报——**这是 S1 的唯一验收手段**
  - 测试：播放器选择逻辑、语音参数拼接、失败回落（打桩）
  - 验收：`broadcast_say("你好，我是播报") `真出声；build + test 全绿

- [x] **S2 触发 + 文本清洗**（约 1 小时）
  - `ctx.on('session/event')`：按 `sessionId` 累积当轮的 `assistant/message` 文本与工具名
  - `turn/end` 判定：只播 `reason.kind === 'completed'`；`error` / `aborted` 播一句短提示（可关）
  - 过滤：子代理会话默认静默、回复 < 30 字不播、同会话 2s 去抖防连播
  - 清洗 `sanitize.ts`：剥代码块 / 行内代码 / 路径 / URL / Markdown 标记 / 表格 / 表情 / 链接文字
  - 降级文案：不调模型时取「首段前 80 字」，保证 S2 单独就能用
  - 测试：用**真实会话片段**做样本，断言清洗后不含 `\``\`` / `/` / `http` / `*`；turn/end 判定表驱动

- [x] **S3 说人话（核心）**（约 1.5 小时）
  - `ctx.get('llm').stream()` + `agentDefaultModel.currentSelection()`（照 `dsh-contract-butler/src/hostAi.ts` 的注入式写法，**不自建密钥通道**）
  - prompt 约束：中文口语、2–3 句、≤ 80 字、先说结论、提一句「要不要你拍板」、
    **不念**代码/路径/英文标识符/列表/编号；数字说成中文口语（12 → 十二）
  - 输出清洗：去引号、去「好的/总结如下」前缀、去 Markdown、截到句号
  - 三级回落：LLM → 本地截断 → 原始首句；LLM 超时 6s 不阻塞播放
  - 缓存 `(sessionId, turn)` 去重，重复 turn/end 不重复播
  - 测试：prompt 构造、输出清洗、回落链（假 stream 注入）
  - 验收：拿 3 段真实长回复，对比「原文 / 本地截断 / LLM 改写」的可听性

- [ ] **S4 交互：对话框开关 + 状态**（约 1 小时）
  - 宿主路由 `/dsh-broadcast/state`（GET 读、POST 写），状态存插件配置，重启保留
  - 客户端 `conversation.input.left` 一个扬声器开关（抄 `dsh-mermaid-comm/src/client.js` 的写法：
    乐观更新 + 以宿主回读为准 + tooltip），开/关即时生效
  - 播报时在开关旁显示「正在播报」小态（可停）；可选：静音时段（23:00–08:00 不播）
  - 验收：点开关能停/开；刷新页面保持；不重启不失效

- [ ] **S5 打磨 + 装进 profile**（约 1 小时）
  - 全量测试 + 真机连跑 3 轮（含报错轮、长回复轮、子代理轮）
  - README（中英）+ LICENSE + NOTICE（署名 voice-announcer 的 edge-tts 部分）
  - 更新根 README 插件表
  - `dsh plugin --profile web add file:packages/dsh-broadcast` → 重启 → 真机播报确认
  - 最后才装：装之前必须 build + test 全绿

---

## 关键设计取舍（别推翻，除非有更好理由）

| 决定 | 理由 |
| --- | --- |
| 默认音色 `zh-CN-XiaoxiaoNeural` | 实测 68 字 2.1–3.9s 出整段；温暖、长句稳，最像人 |
| 摘要 ≤ 80 字 | TTS 播 80 字约 16 秒；再长就是「听不下去」而不是「听不完」 |
| 宿主 `llm` 而非自建 HTTP | 密钥/模型/配额归宿主管，插件抄一份就是 401/403 |
| 播放放宿主（afplay/ffplay/say） | 机器上没 ffplay；`afplay` 系统自带，且不用管浏览器标签在不在 |
| 开关默认关 | 半夜装插件不能被声音吓一跳；也让用户先试听再开 |
| 不 fork voice-announcer | 它的播放层在 macOS 不可用；产品形态是「报幕」不是「讲清楚」 |

## 运行日志

（每次运行的收尾追加一行：日期 / 完成阶段 / 验证命令结果 / 未决问题）

- 2026-11-20 / **S1 骨架 + 能出声** / `pnpm --filter dsh-broadcast build` 通过（tsc 无错）；`node --test "test/*.test.ts"` **26 passed / 0 failed**；`broadcast_say` 同一条代码路径实测出声：engine=auto 时 edge-tts 失败 → 回落 `say`（4.9s 播完/web 实测峰值 0.644、rms 0.116 非静音，`afplay` 播放成功）。 / **未决**：edge-tts 在线合成当前不可用——新端点 `api.msedgeservices.com` 握手 403、老端点 `speech.platform.bing.com` 返回 404（curl 与 Node WebSocket 两种方式都验过），`auto` 已自动回落 `say`；协议实现按「端点可配 + 失败回落」保留，等厂商接口恢复或改接别的 provider 再验。
- 2026-11-20 / **S2 触发 + 文本清洗** / `pnpm --filter dsh-broadcast build` 通过；`node --test "test/*.test.ts"` **66 passed / 0 failed**；**真机回放**（取 `~/.dsh/sessions` 里一个真实 v4 会话的 11 轮事件，喂进 `createSessionListener`）：9 次 speak + 2 次 notice（aborted / blocked），产出文案 27–78 字、无 Markdown 残留；把其中一段真出声（say 兜底 12.3s）。清洗器对真实 2581 字长回复：2581 → 1322 字，反引号 / 斜杠 / http / 星号 / 表格 / 文件名 / `344px` 全部消失，首段 35 字直接可念。 / **未决**：① 模型用英文回复时文案仍是英文（S3 的改写约束负责）；② 被剥掉的行内代码会留下「来自真实的，」这种空档（S3 重写解决）；③ edge-tts 仍 403，仍走 say 兜底。
- 2026-11-20 / **S3 说人话（核心）** / `pnpm --filter dsh-broadcast build` 通过；`node --test "test/*.test.ts"` **82 passed / 0 failed**（新增 prompt / summarizer 两组 + wiring 3 例）。**真实数据**（3 段真机长回复，4208 / 4570 / 4903 字）：原文洗完朗读 **261–345 秒**，本地截断只有 **7.5–14.8 秒**——这就是必须做「说人话」的量化理由（`say -o` + `afinfo` 实测时长）。**整链实测**（真回复 4570 字 → 提示词 system 269 字 / user 1915 字 → 假流两句话 → 清洗成 24 字 → 真出声 8.2 秒）。 / **未决**：模型这一级用的是**打桩的流**，真模型调用没在插件外验过——`ctx.get('llm')` 只在宿主进程里存在，而按协议本阶段不装 profile；S5 真机连跑时补这一验（回落到本地的三条路径已全部覆盖）。edge-tts 仍 403，继续 say 兜底。 / 依 `dsh-contract-butler/src/hostAi.ts` 的注入式写法与 `dsh-llm` 的 `GenerateOptions`/`StreamChunk` 类型核对过请求与 chunk 形状。
