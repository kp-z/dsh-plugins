# 把 xcity 装进 DSH（可复现的步骤）

> 这份文档存在的唯一原因：装这件事踩了五次坑，每次都是**不同的**一环。按顺序做，不要跳。

## 一、包本身要有三样东西

```json
// packages/dsh-xcity/package.json
{
  "name": "dsh-xcity",
  "exports": {
    "./client": { "default": "./lib/client.iife.js" },
    "./cordis.patch.yml": "./cordis.patch.yml"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["slots", "betterSidebar"] }
  }
}
```

- **dsh.bundle.patch**：宿主按它去读包里的 patch，patch 里的 insert 才是真正的插入动作；
- **dsh.client**：没有这一段，客户端包**永远不会被加载**（我在这上面浪费了两次重启）；
- **exports 两个路径都要有**：宿主用 require.resolve 找客户端产物。

## 二、包自带的 patch：路径必须绝对

```yaml
- insert:
    - id: xcity
      name: dsh-xcity
      config:
        slowvale:
          enabled: true
          port: 7788
          assetsDir: ~/dsh-plugins/slowvale-mirror/site   # 绝对路径
```

**相对路径会静默失败**：App 进程的 cwd 不是仓库根，existsSync 不通过时桥就不启动，
症状是"插件加载了但没有 7788"。

## 三、profile 三件事（缺一不可）

```json
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": { "dsh-xcity": "link:~/dsh-plugins/packages/dsh-xcity" },
  "dsh": { "profile": { "bundles": ["…", "dsh-xcity"] } }
}
```

然后**必须真的跑一次 pnpm install**：

```bash
cd ~/.dsh/profiles/<profile> && pnpm install --prefer-offline
grep -c dsh-xcity pnpm-lock.yaml      # 必须 > 0
```

手改 package.json + 手工符号链接**不够**——宿主按 lockfile 的依赖图找插件。

## 四、验证（别靠肉眼）

```bash
curl -s -o /dev/null -w "%{http_code}
" http://127.0.0.1:7788/                           # 期望 200
curl -s -o /dev/null -w "%{http_code}
" http://127.0.0.1:<dsh端口>/agent-world/api/world  # 期望 200
lsof -ti tcp:7788 | xargs -I{} ps -o command= -p {}    # 应该是 DeepSeek Harness 本体，不是 node 脚本
```

客户端半体**没法用 curl 验**（宿主走 dsh-app:// 协议，HTTP 一律 404，连 spellbook 也是）。
在 DSH 窗口 Cmd+R 刷新后才会被取到；排查就开控制台看 [dsh-xcity] 开头的警告。

## 五、装好之后

```bash
curl -X POST -H "content-type: application/json" \
     -d '{"characterId":"role.lin","characterName":"林野"}' \
     http://127.0.0.1:7788/api/xcity/spawn
# → {"ok":true,"sessionId":"xcity-rolelin-xxxx"}

node packages/dsh-xcity/scripts/xcity-bind.mjs bind role.lin xcity-rolelin-xxxx agent-1
```

绑完的判据：curl -s http://127.0.0.1:7788/api/xcity/bindings —— bindings 是角色→会话，
agents 是 agentId→角色→会话。
