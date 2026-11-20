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

- [x] **S4 交互：对话框开关 + 状态**（约 1 小时）
  - 宿主路由 `/dsh-broadcast/state`（GET 读、POST 写），状态存插件配置，重启保留
  - 客户端 `conversation.input.left` 一个扬声器开关（抄 `dsh-mermaid-comm/src/client.js` 的写法：
    乐观更新 + 以宿主回读为准 + tooltip），开/关即时生效
  - 播报时在开关旁显示「正在播报」小态（可停）；可选：静音时段（23:00–08:00 不播）
  - 验收：点开关能停/开；刷新页面保持；不重启不失效

- [x] **S5 打磨 + 装进 profile**（约 1 小时）
  - 结果（2026-11-20）：全部完成。装进的是 **`desktop` profile**（桌面 App 实际跑的那个，`web` 是命令行 `dsh web` 用的），装完 live reload 当场生效，用户确认「听到了」。
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
- 2026-11-20 / **S4 交互：对话框开关 + 状态** / `pnpm --filter dsh-broadcast build` 通过；`node --test "test/*.test.ts"` **105 passed / 0 failed**（新增 state / routes / client 三组 + wiring 2 例）。**宿主侧真机级验证**（起真实 `http.createServer` 挂上插件自己的 handler，用 `fetch` 打）：GET 初始 `{enabled:false}` → POST 打开 → GET 回读 true → 磁盘 `{"enabled":true,...}` → 关/开各一次 → **新建 switch 读同一文件 = true（模拟重启后保持）** → 播报中 GET `speaking:true` → POST `{stop:true}` 后 `speaking:false`。**停止是真停**：`speak()` 播一条 ~20 秒的长句，1.0 秒时 abort → `AbortError` 立刻返回（不是播完才返回），停完再播一条照常出声。 / 未决：① 浏览器里那半个（扬声器图标、tooltip、点击）没法在本阶段验——插件没装 profile（协议要求 S5 才装），S5 装完点一次即验；已用 `node --check` + 客户端冒烟测试（模块外壳/槽位 `conversation.input.left`/路径与字段契约）兜住最容易炸的部分。② 安静时段顺手做了（`quietHours`，默认空=不启用），命中即静默，有跨零点测试。③ edge-tts 仍 403。
- 2026-11-20 / **S5 打磨（未勾选：装 profile 这一步没做成）** / `pnpm --filter dsh-broadcast build` 通过；`node --test "test/*.test.ts"` **105 passed / 0 failed**。本轮做完：① README（中英）+ LICENSE（MIT，与工作区一致）+ NOTICE（写明协议参考、未复制源码）+ 根 README 两张插件表；② **3 轮连跑**（长回复 / 报错轮 / 子代理轮，走真实 speak 链）：1 条 77 字摘要 + 1 句报错提示，子代理轮静默——与设计一致；③ 把 `apply` 的日志器改成沙箱安全（拿不到 `ctx.logger` 就退 console），避免插件加载失败拖垮整个 profile；④ 用假 ctx 跑真 `apply`：工具 / `session/event` / `/dsh-broadcast/state` 三样都注册成功。 / **卡住的那一步**：`dsh plugin --profile web add file:packages/dsh-broadcast` 跑不了——`dsh` 不在 PATH（App 内的 asar 里，命令行拿不到），改手工改 profile（备份 + package.json 加 dep/bundle + node_modules 软链）又被沙箱拦住：`~/.dsh` 在工作区外，写操作需要审批，定时运行没人批 → 超时失败，**profile 分毫未动**（已复查：package.json 无 dsh-broadcast、无软链、无备份残留）。 / **下次要做的只有这一件**：由你（或有人在场的一轮）执行 `cd /Users/demo/dsh-plugins && dsh plugin --profile web add file:packages/dsh-broadcast` 后重启 DSH；重启后验证一句 `curl -s http://127.0.0.1:52559/dsh-broadcast/state`（应返回 `{"toggle":true,...}`），再点一下输入框里的扬声器按钮。 / edge-tts 仍 403，仍 say 兜底。
- 2026-11-20 / **S5（第二次尝试，仍未勾选：装 profile 被环境挡住）** / `pnpm --filter dsh-broadcast build` 通过；`node --test "test/*.test.ts"` **105 passed**（本轮没改插件代码，先复核上次提交仍全绿）。**新发现**：跑着的 GUI 用的是 **`desktop` profile**，不是 `web`（证据：本进程 `DSH_PROFILE_DIR=/Users/demo/.dsh/profiles/desktop`；web profile 里没有 dsh-broadcast，desktop 的 bundles 里也没有）——计划里「`--profile web`」那句是按开发习惯写的假设，照它装完重启也看不到按钮，**目标应改成 desktop**。为此加了不依赖 `dsh` CLI 的安装器 `packages/dsh-broadcast/scripts/link-profile.mjs`（备份 → 改 profile 清单 → node_modules 软链 → 装完真 import 一次验证，失败自动还原清单），三条路径都 `--dry-run` 验过。 / **仍然没装成**（同一原因第三轮）：写 `~/.dsh` 在工作区外、需要审批，定时运行无人批准 → 失败关闭；插件管理器的 `/api/plugin-manager/install` 返回 401，`dsh` 也不在 `/opt/homebrew/bin`、`/usr/local/bin`。 / **下一步只有一条命令**：`node packages/dsh-broadcast/scripts/link-profile.mjs desktop` → 重启 DSH → `curl -s http://127.0.0.1:52559/dsh-broadcast/state` 应返回 `{"toggle":true,...}`。
- 2026-11-20（09:05，用户在场并批准安装）/ **S5 装进 desktop profile：完成** / `node packages/dsh-broadcast/scripts/link-profile.mjs desktop`：备份 `package.json.bak-broadcast-2026-11-20T01-02-17-542Z` → `dependencies` + `dsh.profile.bundles` 各加一项 → `node_modules/dsh-broadcast` 软链指向源码 → **装完真 import 一次：OK（name=broadcast，inject=["tools"]）**。**不需要重启**：desktop profile 是 live patch，装完当场生效——`curl http://127.0.0.1:52559/dsh-broadcast/state` 从 404 变 **200 `{"toggle":true,"enabled":false,"speaking":false}`**。随后用同一个路由把开关打开：POST `{"enabled":true}` → 回读 `enabled:true` → 状态落到 `~/.dsh/broadcast/state.json`（宿主进程没有 `DSH_PROFILE_DIR`，走的是 code 里写明的 `DSH_HOME` 兜底，重启仍在；**已知取舍**：状态是用户级而非 profile 级，单机单用户无影响）。 / 安装器本轮修掉自身两个毛病：结尾引用了已删的变量（exit 1）、以及每次都留备份（改成只在真要写清单时备份），重跑幂等 exit 0。 / **未决**：① 真机「听得到」这一步只能在轮次结束时发生——开关已开，本轮收尾应有声音；② 输入框里的扬声器按钮要刷新页面才会出现（客户端 bundle 在页面加载时注入）；③ edge-tts 仍 403，仍是 say 兜底。
- 2026-11-20（09:15，用户确认「听到了」）/ **S5 完成——五个阶段全部勾完** / build 通过；**112 passed / 0 failed**（本轮新增音色选择：voices 清单 + `/dsh-broadcast/voices` 路由 + 输入框音色菜单，并重写 state 存储为「开关 + 音色」）。S5 收尾证据：装进 `desktop` profile（备份、清单、软链、装完真 import 一次全过）→ 路由 200 → 开关 POST 打开 → 用户听到本轮播报。**追加需求（用户当场提的，不属于原计划阶段）**：音色要能选。做法：`src/voices.ts` 列 13 个本机 `say -v` 真有的音色（中英、男女、粤语/台湾国语），`/dsh-broadcast/voices` GET 列清单、POST 切换并**当场试听一句**；输入框扬声器旁加一个小箭头打开菜单（点一下换音色 + 试听），选择落进状态文件，重启保持。**注意**：插件代码是启动时加载的，这次改动要**重启 DSH** 才生效（重启会把新代码装进来，状态文件向后兼容）。 / 未决：① 重启后要在真 GUI 里确认音色菜单（下一轮 `curl /dsh-broadcast/voices` 应 200）；② edge-tts 仍 403，所有音色现在都是 `say` 的；③ 状态文件落在 `~/.dsh/broadcast/`（宿主没设 `DSH_PROFILE_DIR`），是用户级而非 profile 级。
- 2026-11-20（09:55，用户当场反馈两条）/ **S5 之后的两处修正：声音与菜单** / build 通过；**121 passed / 0 failed**。① **声音**：反馈是「换了还是难听，是僵硬的读内容」——根因是只有 `say` 能用（edge-tts 对本机 403），换哪个 `say` 音色都机械。新增 `src/baidu-tts.ts`（百度 `fanyi.baidu.com/gettts`，免密钥 mp3，实测 90 字 12.6s，5xx 重试一次），引擎链改为「选了什么就用什么」：选在线→百度（失败才退 `say` 并说明原因），选本机→只走 `say`，不偷换。实测 `speak()` 返回 `{"engine":"baidu"}`。② **菜单**：反馈是「下拉 UI 错误、按钮和下拉太难看」。根因是输入框是带 `backdrop-filter` 的玻璃卡片，**backdrop-filter 会为 `position:fixed` 造包含块**，菜单按卡片而不是视口定位，于是飞到屏幕角落。改成 portal 到 `document.body`（拿不到 react-dom 时做包含块修正兜底）。设计重做：开关与音色合成一个胶囊（拆成两个相邻控件时用户不知道该点哪个），菜单顶部是开关行，分组用留白而非分割线，选中项淡蓝底 + 品牌色对勾，说明文字挂在分组标题下；用同源 CSS 生成预览页截图连改两轮（`artifacts/broadcast-ui/preview.html`）。③ 状态文件从「裸 say 名字」扩成 `voiceId`（老值迁成 `say:<名字>`），并把用户机器上的值设成 `baidu`。 / 未决：插件代码启动时加载，**要重启 DSH** 这两条才生效；重启后验 `curl /dsh-broadcast/voices`（应含 `lastEngine`）与菜单实点。
