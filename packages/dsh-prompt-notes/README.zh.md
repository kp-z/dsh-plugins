# @kpeace/dsh-prompt-notes

DSH 右侧栏的「便签」：一本横向便签簿，管理常驻**提示词、技能、MCP**。图钉决定是否生效，每张可按**作用域**生效：所有会话 / 某个工作区 / 单个会话。

![便签簿](docs/preview.svg)

| 纸色 | 类型 | 去向 |
|---|---|---|
| 黄 | 提示词 | system prompt 的一个段 |
| 蓝 | 技能 | 技能目录，模型按描述按需加载 |
| 绿 | MCP | `mcpManager`，工具以 `mcp__<名>__*` 出现 |
| 描图纸 | 系统 | 只读：DSH 已有的提示段、上下文、技能、MCP；可复制成自己的便签 |

没有便签时三条通道都是空的，装上不改变任何请求。

## 安装

依赖 [dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar)。

```sh
dsh plugin --profile <profile> add <本目录绝对路径>
```

桌面版用 Plugins → Add plugin。**更新后需重启 DSH**（Host 半体在启动时载入）；只改前端刷新页面即可。

## 配置（均可省略）

```yaml
- id: prompt-notes
  name: @kpeace/dsh-prompt-notes
  config:
    maxChars: 8000   # 每个会话里提示词便签的字数预算；0 = 不限
    order: 100       # system prompt 段位置（0 = persona，500 = plan policy）
    file: ~          # 数据文件，默认 $DSH_HOME/prompt-notes/notes.json
    mcp: true        # false = 不登记任何 MCP 便签（MCP 会启动本地进程）
    pollMs: 2000     # 探测数据文件被外部改动的间隔（毫秒）
    enabled: true    # false = 整个插件休眠
```

## 作用域

「适用」永远相对一个观察者（会话 id + 工作目录）。工作区 = 会话 cwd 在该目录之内。

| 通道 | 过滤方式 |
|---|---|
| 提示词 | 每次组装 system prompt 时现算，下一轮生效 |
| 技能 | 全局 + 工作区走全局提供方；会话级走挂在该会话上的提供方，随会话消亡 |
| MCP | 只在存在适用的活动会话时才启动进程；不适用的会话看不到它的工具（`tools.restrict`），调用时再由 `tools.guard` 兜底 |

## 助手工具

`note_list` · `note_create` · `note_update` · `note_delete`，与面板走同一套校验。助手创建的 MCP 便签一律未钉住；已钉住的 MCP 便签只能改装饰字段；删除进回收站，助手不能恢复。

## 分享

面板里「导入 / 导出」：导出一张、一组或全部；导入先预览再确认，同名冲突可选重命名（默认）/ 跳过 / 覆盖。**导入的 MCP 一律未钉住**，预览会列出钉上后将执行的命令；非本插件的文件会被拒绝。

## 行为

- 提示词按**创建先后**注入，编辑某条不会打乱其余内容的缓存前缀；预算只算提示词，放不下的整条放弃、不截断。
- 注入段 `interpolate: false`：便签里写 `{{` 不会让模型调用失败，也不会被替换。
- 数据是单个 JSON（v3），可手改；写入原子、先重读再写。坏文件备份为 `.corrupt-<时间>`，手改写坏的单条备份为 `.invalid-<时间>`；v1 / v2 自动升级。
- 删除是软删除：面板给 8 秒「撤销」，文件里保留最近 50 条 / 30 天。
- 写接口需自定义请求头并拒绝跨站来源；新建的 MCP 便签默认未钉住；`mcp: false` 可整体禁用。
- 技能可设「何时使用」与调用方（两者 / 仅模型 / 仅用户）。

## 局限

- 隐藏工具有最多 2 秒的延迟：MCP 刚连上、或会话刚切换目录的瞬间，不适用的会话仍可能短暂看到工具。
- `tools.guard` 的拒绝分支没有用真实的模型工具调用验证过，只有单测覆盖。
- 助手创建的**提示词**便签默认钉住（会注入下一次会话）。
- 外观经 DOM 度量检查（对比度、溢出），没有经人眼确认。

## 开发

```sh
npm test && npm run check     # 单测 + 语法
scripts/e2e.sh setup && scripts/e2e.sh start   # 隔离的真实 DSH 实例（/tmp，端口 48990，不碰你的 profile）
npm run e2e && npm run e2e:scope && npm run e2e:share && npm run e2e:robust
npm run demo                  # 重建 demo/demo.html（单文件，模拟后端）
```

开发过程与取舍见 `dev/DEVLOG.md`。
