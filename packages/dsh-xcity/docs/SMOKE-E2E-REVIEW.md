# 冒烟脚本安全审查（task-44）

**审查对象**：`packages/dsh-xcity/tools/smoke-e2e.mjs`
sha256 `74dd7b4b1a65911282264568dead8396e9d73223c5d101af46036cac13862d42`，595 行 / 26587 B / mtime 2026-11-28 07:02:19。

**方法**：只读。静态通读 + `node --check` + grep 出全部 rm/cp/kill/spawn 调用 + 读现场进程与 `.smokehome` 残留。
**未执行脚本本体**（它会 build、起宿主、烧真 token），功能正确性（三单是否真 done）不在本卡范围。

**结论一句话**：隔离方向对（独立 home + 独立端口 + 不 kill 任何非自己进程），但**卡面点名的两处硬要求没落地**：
rm -rf 没有路径守卫；`.smokehome` 没进 .gitignore，而脚本正把真凭据复制进去。
按现在这版跑，最可能造成的损失不是「跑失败」，是「真 API key 被 git add 进去」和「Ctrl-C 后留下一个占 3290 的野生宿主」。

---

## 一、卡面 5 个检查点，逐条结论

| # | 检查点 | 结论 | 关键行 |
|---|---|---|---|
| 1 | 是否 kill 不属于自己的进程 / kill -9 端口监听者 | **合格**。只对 `hostState.child`（唯一 spawn 的那一个）发信号；detached 起的即进程组组长，杀整组；全文件无 `lsof`/`pkill`/`killall`，SIGKILL 也只打在 `-child.pid` 上 | 146、149、541、579 |
| 2 | 端口是否可能落到 3190 / 7791 / 7788 | **合格（fail-closed）**。3290/7891 是常量且不开放为参数，`FORBIDDEN_PORTS` 先断言；桥端口由模板 7791 改写而来，改完还查残留 | 39-41、446-448、222-228 |
| 3 | DSH_HOME 是否可能指向 .testhome / 真实 home；rm 路径守卫 | **不合格**。只有一个 `SMOKE_HOME === SOURCE_HOME` 断言；卡面要求的「路径含 .smokehome、≠ /、≠ 用户 home」显式 assert 不存在，三处 rm 裸调 | 445、196、549、589 |
| 4 | 失败/异常/超时路径是否也清理 | **部分合格**。StepError / EnvError / [7] 超时都会走 catch 里的 kill+删；**信号退出与父进程被强杀不覆盖**（全文件无 `process.on`） | 568-595 |
| 5 | 两份并发跑的互斥 | **不合格**。端口检查是 check-then-act，两份可同时通过；且两份共用同一个 `.smokehome`，后者会在 [3a] 把前者刚建好的 home 删掉 | 446-449、196 |

---

## 二、必须先修（P0）

### F1 递归删除没有任何路径守卫（行 196 / 549 / 589）

三处 `rmSync(SMOKE_HOME, { recursive: true, force: true })` 都是裸调，唯一「保护」是第 36 行的常量定义：

```js
36: const SMOKE_HOME = join(pkgRoot, '.smokehome')
```

- 行 445 只断言 `SMOKE_HOME === SOURCE_HOME`（防 .testhome），既不校验 basename，也不校验 ≠ `/`、≠ 用户 home。
- 于是「安全」完全押在常量不被改上。任何一次顺手把 SMOKE_HOME 改成 `process.env.DSH_HOME` 或 `join(homedir(), …)`，
  196 / 549 / 589 就变成对用户目录的 `rm -rf`；而且第一处删除（196）在 prepareHome 里，
  开工前只经过 445 那条「不校验路径形状」的断言——refactor 之后没有任何东西会拦住它。
- 卡面原话：「必须显式 assert 路径里含 .smokehome 且不等于 / 与 ~」。这一条现在不存在。

建议（只增加一个函数，符合「如无必要勿增实体」）：

```js
function assertSmokeHome() {   // 三处 rm 之前都调用
  const p = resolve(SMOKE_HOME)
  if (p !== join(resolve(pkgRoot), '.smokehome')) throw new EnvError('SMOKE_HOME 不是约定的绝对路径')
  if (!p.includes('.smokehome') || basename(p) !== '.smokehome') throw new EnvError('路径里没有 .smokehome')
  if (p === '/' || p === resolve(homedir()) || p === resolve(SOURCE_HOME)) throw new EnvError('拒绝对该路径递归删除')
}
```

### F2 `.smokehome/` 没进 .gitignore，而脚本把真凭据复制进去（行 235 / 237）

- 行 235：`cpSync(credentials, join(SMOKE_HOME, '.credentials.yaml'))`，源是 `.testhome/.credentials.yaml`（778 B，真实 key）。
- `packages/dsh-xcity/.gitignore` 只忽略了 `.testhome/`（第 9 行），**没有 `.smokehome/`**。
- 现场实证（工作区里现在就有一份）：

```
$ git status --porcelain -uall packages/dsh-xcity/.smokehome
?? packages/dsh-xcity/.smokehome/.credentials.yaml
?? packages/dsh-xcity/.smokehome/profiles/xcity-3/cordis.patch.yml
...
$ git check-ignore -v packages/dsh-xcity/.smokehome/.credentials.yaml
（无输出 = 未被忽略）
```

任何一次 `git add -A`（很多 agent 工作流会这么干）都会把 778 B 的真 API key 提进仓库；`--keep` 还会让它长期留盘。
这是本脚本最可能造成不可逆后果的一条。修法两步：`.gitignore` 第 9 行旁补 `.smokehome/`，并清掉当前工作区已有的 `.smokehome`。

---

## 三、会真咬人（P1）

### F3 没有信号兜底，detached 宿主会变成野生进程（行 246-255 与 568-595）

宿主是 `spawn(..., { detached: true })`，自成进程组。父进程若没走完 catch 就消失（Ctrl-C、SIGTERM、`kill -9` 本脚本、
休眠后被打断），宿主**不被连坐**，继续占着 3290/7891：下一局在 [1] 直接 exit 2，而脚本不提供任何定位信息。

更别扭的是后续链路：下一次失败退出会走到 589 行删掉 `.smokehome`——**把唯一能说明「上一个宿主 pid 是谁、日志写了什么」的证据一并删了**。

建议：宿主起来后把 pid 写进 `.smokehome/host.pid`；注册 `process.once('SIGINT'|'SIGTERM')` 走同一个 cleanup；
端口占用报错时**只读**地读出 host.pid 并提示「上一局宿主 pid=X 仍在，请人工确认后处理」（仍不 kill）。

### F4 宿主退出判定只看 exitCode，信号致死会被当成还活着

- 行 260：`hostState.exitCode = code`，而 `exit` 事件在信号致死时 `code === null`（`signal` 才是 'SIGTERM'）。
- 用到它的四处：143（killHost 早退）、157/160（waitHostExit）、173（assertHostAlive）。
- 后果：收尾若是信号致死，`waitHostExit(10_000)` 白等 10s，再 SIGKILL（空放），再等 5s → **每次正常收尾多付 15s**；
  启动期若宿主信号死亡，则空转到 90s 才报「世界没起来」。
- 修法一行：判死条件统一成 `child.exitCode !== null || child.signalCode !== null`，或自己维护 `exited` 标志。

### F5 两份并发没有互斥

- 446-449 是「先查再起」（TOCTOU）：A、B 同时查 3290/7891 都空 → 都通过 → 后到者宿主 bind 失败退出。
- 更糟的是 B 在 [3a] 直接 `rmSync` 掉 A 正在用的 `.smokehome`（同一常量路径）——A 的世界落盘目录被抽走。
- 卡面「端口占用即失败」只覆盖串行场景。建议加原子锁：`mkdirSync(join(pkgRoot,'.smokehome.lock'))`，
  EEXIST 时读其中 pid 判陈旧（进程不存在则接管），否则 exit 2。

---

## 四、次要（P2，不阻塞）

| # | 问题 | 行 |
|---|---|---|
| F6 | `--timeout` 不是全局预算：只有 [7] 看 deadline；build、起宿主（固定 90s）、等桥（60s）、spawn（60s×3）、measure-tokens 都不受它约束，最坏远超 600s | 441、497、455、265、282、302、413 |
| F7 | startHost 把「快照里没有 world」当致命：272 行把 readWorld 的 StepError 直接上抛，启动瞬间拿到 `{world:null}` 就整局失败而不是重试到 90s；同类写法在 288-290 是死分支（getJson 不抛 StepError） | 268-273、288-290 |
| F8 | 失败汇总 JSON 字段不齐：卡面要求末行含 tick/tasks/memoryEpisodes/cost，失败时只有 `{ok,reason,step,seconds}`；另有从未被调用的 `fail()` 与未使用的 `IN_FLIGHT_STATUSES` | 591-593、70-76、45 |
| F9 | 检查通过后、宿主 bind 前被抢端口 → 宿主退出 → 报 exit 1（步骤失败），而卡面把端口占用归为 2（环境错）；TOCTOU 的自然结果，知道即可 | 448 vs 260/267 |

---

## 五、只读检查记录（可复现）

```
$ node --check tools/smoke-e2e.mjs          # exit 0；审查前后 sha 一致（未在被改写的中途判读）
$ grep -nE "rmSync|cpSync|writeFileSync|process.kill|child.kill|spawn\(|spawnSync\(" tools/smoke-e2e.mjs
```

全部危险调用与触发条件：

| 行 | 调用 | 触发条件 | 越界可能 |
|---|---|---|---|
| 196 | `rmSync(SMOKE_HOME, recursive)` | 每次正常启动进 [3] prepareHome 的第一句 | 靠常量保证，无 assert（F1） |
| 549 | `rmSync(SMOKE_HOME, recursive)` | 成功收尾且没给 `--keep` | 同上 |
| 589 | `rmSync(SMOKE_HOME, recursive)` | 任意异常退出（EnvError/StepError）且目录存在、非 --keep | 同上；**并会删掉上一局 `--keep` 留下的 home**（F3） |
| 146 | `process.kill(-child.pid, 'SIGTERM')` | killHost：有宿主句柄且未判死 | 只作用于自己 spawn 的进程组 |
| 149 | `child.kill('SIGTERM')` | 146 抛错时的兜底 | 同上 |
| 541 | `process.kill(-hostState.child.pid, 'SIGKILL')` | 成功路径 SIGTERM 后 10s 未退 | 同上 |
| 579 | 同上（带 null 守卫） | 异常路径 SIGTERM 后 10s 未退 | 同上 |
| 246 | `spawn(CLI, [--profile, --port 3290, --host 127.0.0.1, --no-open])` | [4] 起宿主 | env `DSH_HOME=.smokehome`、cwd 在 home 内，不碰正式环境 |
| 455 | `spawnSync('npm', ['run','build'])` | [2] 自己构建 | 只写 `lib/`（编译产物），无删除 |
| 413 | `spawnSync(node, measure-tokens --testhome .smokehome)` | [9] 成本核对 | 只读 .smokehome |
| 235/237 | `cpSync` 凭据 / 默认模型 | [3c] | 只在 .smokehome 内（但未 gitignore，见 F2） |

端口现场（审查时）：`3190/7791 = pid 72455`（测试宿主）、`7788 = pid 22874`（正式 Desktop）、`3290/7891 = 空闲`。
本脚本对这三个禁用端口无任何读写（无 lsof、无 kill、无 bind）。

隔离实测（只读现有 `.smokehome`）：

```
profiles/xcity-3/cordis.patch.yml
  3:    stateDir: …/packages/dsh-xcity/.smokehome/profiles/xcity-3/state
 10:      port: 7891
 12:      bindingsFile: …/packages/dsh-xcity/.smokehome/profiles/xcity-3/characters/bindings.json
```

路径与桥端口改写确实生效，世界不会写回 `.testhome`；`.smokehome/sessions`、`state` 也都在本局 home 内。

---

## 六、修法排序（按「不做就会出事」）

1. **F2**：`.gitignore` 加 `.smokehome/` + 清掉现有残留（5 分钟，收益最大）。
2. **F1**：抽 `assertSmokeHome()`，三处 rm 前都调用（约 15 行）。
3. **F3**：pid 落盘 + SIGINT/SIGTERM 走同一 cleanup；端口占用报错带 host.pid（约 20 行）。
4. **F4**：判死条件加 `signalCode`（1 行，顺带省掉每次 15s）。
5. **F5**：`.smokehome.lock` 原子锁（约 15 行，防「两个 agent 同时跑冒烟」这种迟早会发生的事）。
